// ============================================================================
// policy.ts — WHEN TO WRITE, AND WHETHER TO VERIFY (JOS-208 phase 3).
// ============================================================================
//
// The two scheduling decisions this feature makes, kept PURE and Electron-free for the reason
// `flag.ts` states about the third one: a rule gets a test, and a rule that can only be tested by
// launching an app is a rule nobody re-checks. The callers supply the clock, the draw and the
// readings; this file decides. `schedule.ts` and `shadow.ts` are the wiring.
//
// NEITHER DECISION CAN MAKE THE APP WRONG. The design's uniform-state ruling says a checkpoint at
// any byte position is as valid as one at any other, and a verification is a read-only comparison
// in a throwaway world. So both rules are free to be simple: the worst a bad answer costs is a
// longer tail next launch, or a background fold nobody needed.

// -------------------------------------------------------------------------- the write schedule

/**
 * How long after the historical fold finishes the `replay` write happens.
 *
 * NOT ZERO, deliberately. Serializing every module is one synchronous turn (the states must be a
 * single observation — loader.ts's `serializeStates` says why), and the seconds right after
 * `replayDone` belong to the renderer hydrating and painting its first real frame. Four seconds
 * puts the turn after that and still well inside the window before a dev watcher's next kill.
 */
export const CHECKPOINT_AFTER_REPLAY_MS = 4_000

/** How often the quiet-point rule is EVALUATED — and the resolution of its idleness test. */
export const QUIET_CHECK_INTERVAL_MS = 60_000

/** Shortest gap between two `quiet` writes on time alone. */
export const QUIET_MIN_INTERVAL_MS = 15 * 60_000

/** …or this many new bytes, whichever comes first. Roughly an evening of heavy raiding. */
export const QUIET_MIN_BYTES = 8 * 1024 * 1024

/** What the quiet-point rule is given. */
export interface QuietWriteInput {
  /** The tail's current checkpoint offset — the end of the last COMPLETE line it emitted. */
  offset: number
  /** The same reading one whole check interval ago. Equal ⇒ nothing has been logged since. */
  previousOffset: number
  /** The offset of the last checkpoint this session wrote. */
  writtenOffset: number
  nowMs: number
  /** When that last checkpoint was written. */
  lastWriteMs: number
}

/**
 * IS A QUIET-POINT REWRITE DUE?
 *
 * Three conditions, all of which must hold:
 *   1. THERE IS SOMETHING NEW. `offset > writtenOffset`, or the rewrite is a copy.
 *   2. THE LOG IS IDLE. `offset === previousOffset` — no complete line for a whole check interval.
 *      A write during a raid would serialize every module in the middle of the fight the user is
 *      watching the meter for.
 *   3. IT IS WORTH IT. Enough new bytes to shorten the next launch's tail materially, or enough
 *      wall clock that the session has drifted a long way from its last write.
 *
 * "IDLE" IS MEASURED WITHOUT A CLOCK IN THE FOLD, and that is the interesting part. The obvious
 * test — "no event for N seconds" — needs a `Date.now()` on the per-event path, which is both the
 * app's hottest loop and a wall-clock read inside a fold path (the determinism audit's whole
 * subject). Comparing two readings of an offset that already exists costs nothing and says the
 * same thing.
 */
export function quietWriteDue(i: QuietWriteInput): boolean {
  if (i.offset <= i.writtenOffset) return false
  if (i.offset !== i.previousOffset) return false
  const enoughBytes = i.offset - i.writtenOffset >= QUIET_MIN_BYTES
  const enoughTime = i.nowMs - i.lastWriteMs >= QUIET_MIN_INTERVAL_MS
  return enoughBytes || enoughTime
}

// ------------------------------------------------------------------------ the shadow sample

/** How often a DEV or owner build verifies, and the shortest gap between two of its runs. */
export const SHADOW_DEV_SAMPLE = 0.5
export const SHADOW_DEV_MIN_GAP_MS = 30 * 60_000
/** …and an opted-in installed build: rarely, and never twice in a day. */
export const SHADOW_FLEET_SAMPLE = 0.02
export const SHADOW_FLEET_MIN_GAP_MS = 24 * 60 * 60_000

/** What the sampling rule is given. */
export interface ShadowSampleInput {
  /** Is the fold cache on at all? Off ⇒ nothing to verify, and nothing may cost anything. */
  enabled: boolean
  /** A dev or owner build — verifies far more often, because that is where a defect gets fixed. */
  dev: boolean
  /** When the last verification ran, from the store. 0 ⇒ never. */
  lastRunMs: number
  nowMs: number
  /** `Math.random()`'s value, injected so a test can state the draw instead of hoping for one. */
  draw: number
}

/**
 * SHOULD THIS LAUNCH VERIFY?
 *
 * The design's words are "never runs the identity reads cold twice in a row — sample, do not
 * always-verify", and both halves are here. A verification is a FULL cold read of the log prefix,
 * i.e. precisely the cost the whole checkpoint exists to remove; running it every launch would hand
 * the slow launch back and call it instrumentation.
 *
 * Three gates, cheapest first: the feature is on; the minimum gap has passed (the "twice in a row"
 * rule, expressed in TIME so it also holds across a day of dev restarts); and the sample says yes.
 */
export function shouldRunShadow(i: ShadowSampleInput): boolean {
  if (!i.enabled) return false
  const gap = i.dev ? SHADOW_DEV_MIN_GAP_MS : SHADOW_FLEET_MIN_GAP_MS
  // A `lastRunMs` in the FUTURE (a clock that moved back, a settings file copied between machines)
  // is treated as "just ran" rather than as "long overdue" — hence the absolute value. The cost of
  // waiting is a measurement that arrives later; the cost of not waiting is the cold read this
  // feature exists to avoid, on a machine that has already had one.
  if (i.lastRunMs > 0 && Math.abs(i.nowMs - i.lastRunMs) < gap) return false
  return i.draw < (i.dev ? SHADOW_DEV_SAMPLE : SHADOW_FLEET_SAMPLE)
}

/**
 * The environment override, in the shape `EQ_FOLD_CACHE` already reads (flag.ts): `1` forces a
 * verification on this launch, `0` forbids one, anything else leaves it to the sample. It exists
 * for the same two callers that one does — the owner, who wants to provoke the check by hand, and
 * the e2e spec, which has to observe the whole path end to end without waiting for a 2% draw.
 */
export function shadowOverride(env: string | undefined): boolean | null {
  const v = env?.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'off') return false
  return null
}

// ------------------------------------------------------------------------ the comparison

/**
 * Canonical JSON — object keys sorted at every level — so two snapshots holding the same facts in a
 * different insertion order are the same string.
 *
 * Both arms are built by the same code, so key order should already agree; relying on that would be
 * relying on an accident. A FALSE divergence is the one failure this instrument cannot afford — the
 * counter it feeds is expected to be zero forever, so a single spurious one is a fire drill and, if
 * it recurs, a feature switched off for no reason.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
    return Object.fromEntries(entries)
  })
}

/** Which modules' published snapshots differ. Empty is the expected answer, forever. */
export function divergentModules(
  warm: Record<string, unknown>,
  cold: Record<string, unknown>
): string[] {
  const ids = new Set([...Object.keys(warm), ...Object.keys(cold)])
  return [...ids].filter((id) => canonical(warm[id]) !== canonical(cold[id])).sort()
}
