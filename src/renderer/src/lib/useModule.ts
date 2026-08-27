// useModule — read a module's served state, and stay current with it.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FOR A COMPONENT AUTHOR — THIS IS THE WHOLE CONTRACT, AND IT IS THE WHOLE THING YOU NEED
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//     const snap = useModule<LootSnap>('loot')
//
//   * You get the module's current state, or `null`. `null` means THERE IS NO STATE YET: still
//     loading, or the engine has nothing to say for this module on this launch. It is never an
//     empty result — draw a loading state, or coalesce with `??` if drawing the empty shape is the
//     honest thing for your surface. Both are ordinary; pick the one your view means.
//   * It stays current by itself. When the world moves, your component re-renders with the new
//     state. There is nothing to subscribe to, nothing to refresh, nothing to tear down.
//   * THE VALUE IS STABLE BY IDENTITY UNTIL IT ACTUALLY CHANGES. That is what it buys you: the
//     snapshot is safe to use directly as a `useMemo`/`useEffect` dependency and safe to pass
//     across a `React.memo` boundary, and it will not churn a memo you built on it. Two components
//     reading the same module hold the SAME object, so `Object.is` means what you assume.
//   * Call it as many times as you like, anywhere. Ten components reading `character` cost what
//     one costs. Mount, unmount and remount freely — none of that is your bookkeeping.
//
// That is the entire component-facing surface. If you find yourself wanting anything else — to
// peek at whether it has hydrated, to force a refresh, to know where a value came from — DO NOT
// widen this hook: that want is a design signal about the surface asking for it, and it should be
// raised as one (owner ruling, 2026-08-26).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BELOW THIS LINE IS FOR SOMEBODY CHANGING THE PLUMBING, NOT FOR SOMEBODY USING IT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// THE MACHINERY IS DELIBERATELY INVISIBLE ABOVE (ruling 18's cache-transparency law, renderer
// edition — the engine's own phrasing is that caching must be so transparent that even its
// consumers cannot tell cached from fetched). Everything the four bullets above quietly rely on
// lives in ONE file, `moduleStore.ts`, and none of it appears in any component:
//
//   * one held snapshot per module, shared by every reader (this is where the identity guarantee
//     comes from, and why N readers are not N copies);
//   * one `module:getSnapshot` round trip per push rather than one per reader;
//   * ONE `onModuleChanged` and ONE `onCharacter` listener for the whole window, owned by the
//     store rather than by each hook instance;
//   * cursor arithmetic (`seq`/`pendingSeq`), in-flight dedupe, and the buffer that makes
//     subscribe-before-hydrate safe;
//   * a frame-coalesced flush, so several modules announcing in one engine beat are one batch;
//   * clearing on a character switch, and dropping the replies still in flight for the old world.
//
// Read that file's header before changing any of it. The hook itself is deliberately four lines:
// there is no behaviour here to get wrong, which is the point of putting all of it behind one
// abstraction rather than in thirty-three call sites.
//
// THE STORE'S TWO MEMBERS ARE `useSyncExternalStore`'s OWN CONTRACT (`subscribe`, `getSnapshot`),
// and that is on purpose rather than incidental: the SELECTOR form (JOS-512 — subscribe to a
// slice, re-render only when that slice moves) is `useSyncExternalStoreWithSelector` over exactly
// the same two members, so it can be added beside this hook without this hook changing at all.

import { useCallback, useSyncExternalStore } from 'react'
import { createModuleStore, scheduleFrame, type ModuleStore } from './moduleStore'

/**
 * The window's ONE store, built on first use.
 *
 * Lazy rather than a module-level `const` for two reasons: `window.eq` is the preload bridge and
 * this module is imported by unit tests where there is no window, and building it on the first
 * subscription rather than on import keeps a launch that never reads a module from installing an
 * IPC listener at all.
 */
let store: ModuleStore | null = null
function moduleStore(): ModuleStore {
  store ??= createModuleStore({ bridge: window.eq, schedule: scheduleFrame })
  return store
}

// `Snap` APPEARS ONLY IN THE RETURN TYPE, which `no-unnecessary-type-parameters` reads as
// removable. It is not: `getModuleSnapshot` answers `unknown`, so widening this to `unknown` would
// type every view's state as `unknown` and move twenty compile errors into runtime. This parameter
// is the only statement anywhere of what a served snapshot's shape IS.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
export function useModule<Snap>(moduleId: string): Snap | null {
  // Both are keyed on `moduleId` alone. A fresh `subscribe` identity would make React tear the
  // subscription down and re-open it on every render, which is the per-hook churn this whole
  // ticket exists to remove.
  const subscribe = useCallback(
    (onChange: () => void) => moduleStore().subscribe(moduleId, onChange),
    [moduleId]
  )
  // THE ONE PLACE THE SHAPE IS NAMED. The store is keyed by a runtime string and answers
  // `unknown`, which is the honest type for it; this call site knows the module id as a literal and
  // is where a caller states what that module's state is. The assertion buys the whole app its
  // typed views — widening it to `unknown` would move twenty compile errors into runtime.
  const read = useCallback(() => moduleStore().getSnapshot(moduleId) as Snap | null, [moduleId])
  return useSyncExternalStore(subscribe, read)
}
