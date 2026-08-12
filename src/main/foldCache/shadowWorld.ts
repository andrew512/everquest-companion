// ============================================================================
// shadowWorld.ts — A SECOND, THROWAWAY FOLD, BESIDE THE LIVE ONE (JOS-208 phase 3).
// ============================================================================
//
// The shadow verifier needs two fold worlds that are NOT the app's: one restored from the container
// on disk, one folded cold from the log. Building them is this file's whole job; deciding when to
// build them and what to do with the answer is `shadow.ts`.
//
// WHY A SECOND WORLD RATHER THAN THE LIVE ONE. The live registry is being served to five windows and
// is folding a live tail; anything that reset it, ticked it with a pinned clock, or handed it a blob
// would be experimenting on the user's session. Two fresh worlds can be ticked to the SAME instant,
// compared, and dropped — which is also the only way the comparison can be apples-to-apples, since
// every published snapshot that carries a live clock (the respawn rows' ordering) is a function of
// when it was asked.
//
// IT IS THE SAME CONSTRUCTION `pipeline.ts` MAKES, and it has to be: a differential test that folds
// two different programs proves nothing. Same `createModules` list in the same order, the same
// store-derived inputs read fresh from the same getters, the same overlays, the same derived-event
// producers subscribed last. Three deliberate differences, each argued:
//
//   * ITS OWN `MobLootIndex`. The app's is a shared singleton that the `consider` module folds INTO
//     — handing the live one to a shadow fold would have a throwaway world writing into the state
//     the user's session is reading. The unit is checkpointed inside `consider`'s blob, so a fresh
//     index is exactly what the warm arm restores over anyway.
//   * ITS OWN `CombatEngine` — which phase 3 deliberately did NOT build, on the argument that
//     nothing reads engine state back so its presence could not change a compared snapshot. That
//     was true only while the engine was outside the container. It is a checkpointed unit now
//     (JOS-208 phase 4) and its `snapshot(now)` is one of the compared payloads, so a verifier
//     without one would be blind to the single largest blob in the file. It costs what the note
//     said it costs — the engine's own fold, twice, for the duration of a check — which is why the
//     sampling is what it is (dev 50% / 30 min, fleet 2% / 24 h) and why a check is a rare event
//     rather than a background hum.
//   * NO IPC. The registry is constructed with a no-op delta emitter, so nothing this world folds
//     can reach a window.
//
// THE SPELL DB IS A SINGLETON AND `createModules` RE-INSTALLS IT. That is safe rather than
// overlooked: `loadSpellDb()` is cached, `applyOverlayCorrections` is documented idempotent, the
// overlays come from the same two sources the launch used, and nothing else in the app installs a
// DB after wiring — so the second call re-installs an equal object into the parser, which is a
// no-op with extra steps.

import { CombatEngine } from '../combat/engine'
import { LogBus, type LogEventListener } from '../log/bus'
import { EpochDetector } from '../log/epochDetector'
import { SessionDetector } from '../log/sessionDetector'
import { baselineOverlay, loadUserOverlay } from '../data/overlayPersistence'
import { lookupItem } from '../itemLookup'
import { lookupMob } from '../mobLookup'
import { MobLootIndex } from '../mobLookupParse'
import { ModuleRegistry } from '../modules/registry'
import { createModules } from '../modules/wiring'
import { getAlerts, getBuffTrustPrefs } from '../store'
import { getRespawnPrefs } from '../storeRespawn'
import { combatPublished } from './publishedFold'
import { isCheckpointable, CHECKPOINTED_MODULE_IDS, COMBAT_FOLD_ID, type FoldUnit } from './serialize'
import type { CharacterRef } from '../../shared/types'

/** One throwaway fold: everything the verifier needs to drive it and read it. */
export interface ShadowWorld {
  bus: LogBus
  registry: ModuleRegistry
  /** This world's own engine — one of the compared payloads since phase 4. */
  combat: CombatEngine
  /** EVERYTHING THE CONTAINER CARRIES, in `attach.ts`'s order — modules, engine, then producers. */
  units: FoldUnit[]
}

/**
 * Build a throwaway fold world for `ref`.
 *
 * The character ref is set on the character module exactly as `session.ts` sets it on the live one,
 * because that module PUBLISHES the ref (logPath and mtime among it) and a world that skipped this
 * would diverge on a fact that has nothing to do with the checkpoint.
 */
export function buildShadowWorld(ref: CharacterRef): ShadowWorld {
  const bus = new LogBus()
  const modules = createModules({
    alertDefs: getAlerts(),
    buffTrust: getBuffTrustPrefs(),
    respawnPrefs: getRespawnPrefs(),
    overlays: [baselineOverlay(), loadUserOverlay()],
    lookupItem,
    lookupMob,
    ownLoot: new MobLootIndex(),
    emitDerived: (ev, live) => {
      bus.emitDerived(ev, live)
    }
  })
  const registry = new ModuleRegistry({ emitDelta: () => undefined })
  for (const mod of modules.ordered) registry.register(mod)
  registry.reset()
  modules.character.setCharacter(ref)
  registry.attach(bus)

  // The engine, wired exactly as pipeline.ts wires it: the roster pull installed BEFORE it ever
  // folds a line (the registry is attached above, so the roster module has already consumed the
  // event the engine is about to), then the player's own name injected before the first line, then
  // the subscription — after the registry's, before the producers'.
  const combat = new CombatEngine()
  combat.setRoster(modules.roster)
  combat.reset()
  combat.setPlayerName(ref.name)
  bus.subscribe((ev, live) => {
    combat.ingestEvent(ev, live)
  })

  // The two derived-event producers, subscribed LAST — the order pipeline.ts documents, and the
  // one that makes an `epoch` arrive after every module has seen the event that provoked it.
  const epoch = new EpochDetector()
  const sessions = new SessionDetector()
  const observeEpoch: LogEventListener = (ev, live) => {
    if (ev.kind === 'epoch') return
    const epochEv = epoch.observe(ev)
    if (epochEv) bus.emitDerived(epochEv, live)
  }
  const observeSession: LogEventListener = (ev, live) => {
    if (ev.kind === 'offlineGap') return
    const gap = sessions.observe(ev)
    if (gap) bus.emitDerived(gap, live)
  }
  bus.subscribe(observeEpoch)
  bus.subscribe(observeSession)

  // The SAME composition `attach.ts` uses: registry modules, then the engine, then the producers.
  const candidates: { id: string }[] = [...modules.ordered, combat, epoch, sessions]
  return { bus, registry, combat, units: candidates.filter(isCheckpointable) }
}

/**
 * THE PUBLISHED STATE of every compared module, after a go-live sweep at `nowMs`.
 *
 * The tick is the sweep — `session.ts`'s one `registry.tick(Date.now())` before the first publish —
 * and BOTH arms are ticked with the SAME instant. That is not a fudge: it is the only way to compare
 * two folds that were built at two different moments, and it is exactly what the differential
 * harness does with its pinned clock.
 *
 * `state`, NOT the whole `{seq, state}` snapshot, and that is the one deliberate weakening in this
 * verifier. A module's `seq` is its PRIVATE REVISION COUNTER (JOS-87), not a fold output: it counts
 * everything that could have changed the state, INCLUDING the second inputs that are deliberately
 * not in a checkpoint — a user editing their respawn watch list or a combo correction bumps it, and
 * a cold re-fold of the log alone can never reproduce that count. Comparing it here would report a
 * divergence every time somebody used the app, on a counter whose expected value is zero forever
 * and whose non-zero is a kill switch. What `seq` MUST satisfy — that it survives the round trip —
 * is asserted where the arrangement is controlled and the assertion means something:
 * `tests/foldCheckpointDifferential.test.mts` compares the whole snapshot, and so does the e2e
 * restart-compare. This is the fleet's instrument, and its subject is the fold's ANSWER.
 */
export function shadowSnapshots(world: ShadowWorld, nowMs: number): Record<string, unknown> {
  world.registry.tick(nowMs)
  const out: Record<string, unknown> = {}
  for (const id of CHECKPOINTED_MODULE_IDS) out[id] = comparable(id, world.registry.snapshot(id)?.state)
  // The engine publishes through its own IPC rather than the module transport, so it is fetched
  // rather than looked up — and it is ticked by the SAME pinned instant, because `snapshot(now)`
  // evaluates deferred closure and sweeps the charm binds. Two folds compared at two different
  // instants would differ on every fight that closed in between.
  //
  // `setLive()` first, because that closure is gated on `hydrating` (phase 4 — a replay is not a
  // moment in time) and both of these worlds have only ever folded. It is the same statement
  // `session.ts` makes when the scan hands over, and it is what the app's own engine has already
  // done by the time a verification runs.
  world.combat.setLive()
  out[COMBAT_FOLD_ID] = combatPublished(world.combat, nowMs)
  return out
}

/**
 * THE ONE PUBLISHED FIELD THIS VERIFIER DOES NOT COMPARE, and why — stated here rather than
 * silently dropped, because an instrument with a blind spot has to name it.
 *
 * `buffs.overlay` is the LEARNED MESSAGE OVERLAY: which sentence the game printed for which spell,
 * with an observation COUNT per pairing. It is not a pure function of (byte prefix, fold inputs),
 * which is the property this whole feature rests on. Its counts are seeded at construction from
 * `<userData>/message-overlay.json` — the overlay the LAST session persisted — and the fold then
 * adds this launch's observations on top. So the number depends on the install's launch history,
 * and a cold re-fold of the prefix from TODAY's seed counts every observation the seed already
 * contains a second time.
 *
 * MEASURED, on the e2e restart-compare's own fixture: 22 → 44 → 88 across three cold launches. That
 * is a pre-existing defect in the app rather than in the checkpoint — a cold launch has always
 * re-mined the whole log into a seed that already held it — and the checkpoint incidentally FIXES
 * it, because a restored launch mines only the tail. Either way the two arms cannot agree, and a
 * divergence counter whose expected value is zero forever must not fire on a difference that is
 * neither arm being wrong.
 *
 * IT IS COMPARED WHERE THE ARRANGEMENT IS CONTROLLED: `tests/foldCheckpointDifferential.test.mts`
 * seeds both arms with the committed baseline and nothing else, and `tests/e2e/fold-restart.e2e.mts`
 * drops the persisted file before each launch for exactly this reason. What is lost here is fleet
 * coverage of one published field; what is bought is a counter that means what it says.
 */
function comparable(id: string, state: unknown): unknown {
  if (id !== 'buffs' || typeof state !== 'object' || state === null) return state
  const { overlay: _overlay, ...rest } = state as Record<string, unknown>
  return rest
}
