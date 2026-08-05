// useModule — the one hook every module-backed view uses to stay live.
//
// It replaces the hydrate/subscribe race each view used to hand-roll:
//   1. hydrate via getModuleSnapshot(moduleId) → { seq, state },
//   2. subscribe to module:delta filtered by moduleId,
//   3. apply deltas IN ORDER via the caller's applyDelta(state, delta),
//      rejecting dupes (delta.seq <= known seq),
//   4. re-hydrate on onCharacter (state was fully rebuilt in main). The only
//      real gap source is a remount/switch, and re-hydration covers it — so
//      instead of trying to detect a mid-stream gap (delta seqs batch many
//      events, so there's no reliable "expected next" to compare against) we
//      lean on the full-snapshot re-fetch that onCharacter already triggers.
//
// Deltas that arrive between the getModuleSnapshot call and the subscription are
// not lost: we subscribe BEFORE awaiting the snapshot and buffer, then replay the
// buffer (dropping anything already covered by the snapshot's seq).
//
// The optional `stale` predicate covers the ONE gap the above cannot: a delta the held
// baseline is unable to absorb because it was written under a different SHAPE (main restarted
// on new code while this window kept running — routine in dev, and the update path in
// general). A per-key merge across that boundary silently preserves old-shaped entries
// forever, so the module says so and the hook re-hydrates instead of merging. See
// shared/kills.ts (KILLS_SHAPE_VERSION), the first module to need it.

import { useEffect, useRef, useState } from 'react'
import type { ModuleDelta } from '@shared/types'

// `Delta` used to appear ONCE in the signature, which no-unnecessary-type-parameters reads as
// removable (it was suppressed here: every call site passes its own delta shape explicitly, and
// widening the parameter to `unknown` would make each module's typed applyDelta unassignable —
// parameters are contravariant, so the type parameter IS the safety). `stale` is its second
// use, so the suppression is no longer needed; the reasoning still is.
export function useModule<Snap, Delta>(
  moduleId: string,
  applyDelta: (state: Snap, delta: Delta) => Snap,
  stale?: (state: Snap, delta: Delta) => boolean
): Snap | null {
  const [state, setState] = useState<Snap | null>(null)
  // Latest applyDelta without making the effect depend on its identity.
  const applyRef = useRef(applyDelta)
  applyRef.current = applyDelta
  const staleRef = useRef(stale)
  staleRef.current = stale

  useEffect(() => {
    let cancelled = false
    // Known seq: the highest LogEvent seq folded into `state`. -1 until hydrated.
    let knownSeq = -1
    // Deltas that arrive before hydration completes, replayed after.
    const buffered: ModuleDelta<Delta>[] = []
    let hydrated = false
    // The state the folds have produced so far, mirrored out of setState so `stale` can be
    // asked BEFORE a delta is applied (a React updater is the wrong place to start an IPC).
    let current: Snap | null = null

    const applyOne = (d: ModuleDelta<Delta>): void => {
      if (d.moduleId !== moduleId) return
      if (d.seq <= knownSeq) return // dupe or already-covered
      if (current != null && staleRef.current?.(current, d.delta) === true) {
        // This baseline cannot absorb this delta. Re-fetch rather than merge; the fresh
        // snapshot carries whatever shape main is on now, and the delta is re-covered by seq.
        hydrate()
        return
      }
      knownSeq = d.seq
      setState((prev) => {
        if (prev == null) return prev
        const next = applyRef.current(prev, d.delta)
        current = next
        return next
      })
    }

    const hydrate = (): void => {
      hydrated = false
      buffered.length = 0
      current = null
      void window.eq.getModuleSnapshot<Snap>(moduleId).then((snap) => {
        if (cancelled || !snap) return
        knownSeq = snap.seq
        setState(snap.state)
        current = snap.state
        hydrated = true
        // Replay anything that landed during the await, in seq order.
        for (const d of buffered.sort((a, b) => a.seq - b.seq)) applyOne(d)
        buffered.length = 0
      })
    }

    const offDelta = window.eq.onModuleDelta<Delta>((d) => {
      if (d.moduleId !== moduleId) return
      // Buffer until hydrated so a delta racing the snapshot isn't lost or applied
      // against null state; the hydrate replay drops any already covered by seq.
      if (!hydrated) {
        buffered.push(d)
        return
      }
      applyOne(d)
    })

    // Re-hydrate on a character switch (main rebuilt everything under a new ref).
    const offChar = window.eq.onCharacter(() => hydrate())

    hydrate()

    return () => {
      cancelled = true
      offDelta()
      offChar()
    }
  }, [moduleId])

  return state
}
