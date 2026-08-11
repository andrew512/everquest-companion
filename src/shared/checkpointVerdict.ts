// ============================================================================
// checkpointVerdict.ts — WHAT THE STARTUP CHECKPOINT LOADER DECIDED (JOS-208 phase 3).
// ============================================================================
//
// The fold cache turns a launch's cold read of the whole log into a restore plus a tail — when it is
// on, and when nothing about the file or the build has changed under it. Every one of those doubts
// lands on the SAME path (cold-replay), which is what makes the feature safe and also what makes it
// invisible: a launch that took nine seconds because the cache was refused looks exactly like a
// launch that never had one.
//
// So the verdict is written down, in both places a triage session already reads: `perf-startup.json`
// and the one-line startup summary in `errors.log`. "Why did it cold-start" is answered before
// anybody has to ask the user to go and look.
//
// ITS OWN FILE, not a section of `shared/perf.ts`, for the reason that file's own header gives about
// its neighbours: perf.ts sits at the repo's 400-code-line factoring ceiling and the house answer is
// a split. This one is ZERO-IMPORT, so perf.ts's stated property — nothing heavy is dragged in
// behind it when `storeMigrations.ts` loads it before electron-store exists — is unchanged.
//
// NOTHING HERE EVER LEAVES THE MACHINE. The fleet's half of this feature is two counts
// (`shared/telemetry.ts`'s checkpoint shadow pair); this is the local diagnostic, and the closed
// vocabularies below are what keep it a diagnostic rather than a channel: no path, no character, no
// free text.

/** The three answers. `refused` always carries the loader's own reason word. */
export type CheckpointOutcome = 'off' | 'restored' | 'refused'

/**
 * WHICH OF THE THREE WRITES PRODUCED THE CHECKPOINT A LAUNCH RESTORED FROM.
 *
 *   'replay' — written moments after the historical fold finished. The fold had just been proven,
 *              so it is remembered right there; this is the write that makes the feature survive a
 *              process that is KILLED rather than quit (electron-vite's dev watcher, a crash, a
 *              task-manager end — none of which fire a quit event).
 *   'quiet'  — a periodic rewrite at an idle moment, so a long session does not leave the next
 *              launch a tail measured in hours.
 *   'quit'   — the clean-shutdown write. The freshest possible final word, and the only one that is
 *              synchronous (see `foldCache/loader.ts`'s `writeCheckpointSync`).
 *   'unknown'— the container predates the field. Still a valid checkpoint; just silent about its
 *              provenance.
 *
 * WHAT IT IS FOR is diagnosis, and it was earned: the owner ran this feature for a day with the
 * preference on and never got a speedup, because the only write was `quit` and his dev app never
 * quits — and no readout anywhere could have told him so.
 */
export type CheckpointOrigin = 'quit' | 'replay' | 'quiet' | 'unknown'

/** The closed set, for the parsers at both ends. */
export const CHECKPOINT_ORIGINS: readonly CheckpointOrigin[] = ['quit', 'replay', 'quiet', 'unknown']

/**
 * The loader's decision for this launch.
 *
 * `reason` is `RestoreRefusal` from `main/foldCache/loader.ts` — a CLOSED vocabulary of shapes
 * (`missing`, `shape`, `identity:size`, `decode:…`), never free text and never a path.
 */
export interface CheckpointVerdict {
  outcome: CheckpointOutcome
  /** Why the cache was not used. Present only when `outcome` is 'refused'. */
  reason?: string
  /** The byte the fold was restored to — the tail replay's starting point. 'restored' only. */
  offset?: number
  /** WHICH WRITE produced the container that was restored. 'restored' only. */
  origin?: CheckpointOrigin
}

/** A finite, non-negative whole number, or 0 — the same cleaning `shared/perf.ts` applies. */
const whole = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0

/** The verdict's clause in the startup summary line, in the same voice as its neighbours. */
export function describeCheckpoint(v: CheckpointVerdict): string {
  if (v.outcome === 'off') return 'checkpoint off'
  if (v.outcome === 'restored') {
    // The ORIGIN rides the restored clause because it is the half that names a MISSING write: a
    // reader who only ever sees `from quit` on a machine that is killed rather than quit is looking
    // at the bug this field was added for.
    return `checkpoint restored at byte ${String(whole(v.offset))} (written at ${v.origin ?? 'unknown'})`
  }
  return `checkpoint refused (${v.reason === undefined || v.reason === '' ? 'unstated' : v.reason})`
}

/**
 * Shape check for the verdict read back off disk. Absent from every profile written before JOS-208
 * phase 3, which is exactly what "that launch did not say" means — and an outcome this build cannot
 * read is DROPPED rather than guessed at, the same rule a foreign phase name follows.
 */
export function parseCheckpointVerdict(raw: unknown): CheckpointVerdict | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const outcome = (['off', 'restored', 'refused'] as const).find((v) => v === o.outcome)
  if (outcome === undefined) return null
  const origin = CHECKPOINT_ORIGINS.find((v) => v === o.origin)
  return {
    outcome,
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
    ...(typeof o.offset === 'number' ? { offset: whole(o.offset) } : {}),
    ...(origin === undefined ? {} : { origin })
  }
}
