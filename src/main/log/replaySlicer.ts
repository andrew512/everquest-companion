// ============================================================================
// replaySlicer.ts — the cooperative scheduler behind the startup replay.
// ============================================================================
//
// docs/plans/chunked-replay.md §1. The historical fold runs ON THE MAIN PROCESS, and until this
// existed the unit of work between two event-loop turns was a 1 MB read chunk — MEASURED at
// 75 ms of main-loop stall on this machine's log (`.bench/replay.jsonl`, 2026-08-04), with four
// stalls past 50 ms in a single 8.6 s replay. Everything on main starves for that long: IPC, the
// perf HUD's own probe, timers.
//
// A TIME BUDGET, NEVER AN EVENT COUNT. Event cost varies by an order of magnitude — a
// combat-dense second is many times the work of a quiet one — so "yield every N events" bounds
// nothing in particular. `performance.now()` since the slice began bounds the block DIRECTLY,
// which is the only quantity anybody cares about.
//
// AND A DUTY CYCLE ON TOP OF IT (JOS-50). Bounding the BLOCK is not the same as bounding the CPU,
// and the difference is what a streamer reported: `setImmediate` resumes the fold almost
// instantly (MEASURED below at 0.01–0.06 ms), so a sliced replay still runs one core flat out for
// its whole duration — 43 s of it on this machine's log, beside EverQuest and OBS. So each
// expired slice now RESTS on a real timer instead, and the fold spends a stated fraction of wall
// time idle. The owner's rule, in his words: better that it finishes stably than quickly.
//
// WHAT IT DELIBERATELY DOES NOT DO: reorder, batch, or parallelize anything. A slicer interleaves
// event-loop turns into the SAME sequential fold; every consumer still sees every event in file
// order with the same `live=false`. That is what makes the goldens a usable oracle for it
// (tests/replayChunking.test.mts folds the same fixtures with and without slicing — and with and
// without resting — and compares the event streams byte for byte). A rest is a pause, and a pause
// cannot change an answer.

import { setImmediate as yieldToLoop, setTimeout as sleep } from 'timers/promises'

/**
 * The slice budget, in milliseconds.
 *
 * 12 ms, chosen against the 50 ms invariant rather than against a frame: it leaves room for one
 * over-budget event (the check happens AFTER an event is folded, so a single expensive line can
 * overshoot) plus the scheduler's own latency, and still lands a whole binary order of magnitude
 * under the threshold the perf HUD calls "warn". Smaller would buy nothing a human can perceive
 * and would spend more of the replay in `setImmediate`.
 */
export const REPLAY_SLICE_MS = 12

/**
 * THE DUTY CYCLE: the fraction of wall-clock time the historical fold is allowed to spend folding.
 *
 * 0.6 — twelve milliseconds of work, eight of rest, repeating. MEASURED end to end and stated here
 * because the number is the whole feature:
 *
 *   * WHY THROTTLE AT ALL. The slice budget bounds LATENCY (nothing on main waits over 50 ms) and
 *     says nothing about CPU. Measured on this machine (Electron 43, Windows 11): a `setImmediate`
 *     yield returns in 0.01–0.06 ms, so the pre-JOS-50 replay held one core at ~100% for its
 *     entire 43 s. That is the spike the report was about.
 *   * WHY 60% AND NOT LESS. The replay is the app catching up with reality; a user who launches
 *     mid-session is waiting for it. 60% costs about two thirds again as much wall clock
 *     (43 s → ~72 s on this log) and leaves a whole 40% of one core to the game beside it. Below
 *     roughly half, the wait starts to dominate the complaint it was meant to fix.
 *   * WHY NOT MORE. 80% leaves a fifth of a core, which on a 4-core streaming box is inside the
 *     noise of the thing being complained about.
 *
 * There is deliberately NO environment variable, and no setting, behind this — same argument as
 * `unchunkedSlicer` below: a knob that turns the throttle off is a knob a support answer will
 * eventually recommend.
 */
export const REPLAY_DUTY = 0.6

/**
 * THE TIMER FLOOR IS THE REASON THIS IS A LEDGER AND NOT A `setTimeout(8)`.
 *
 * MEASURED in the Electron main process on this machine (Windows 11, Electron 43.2.0), 80 samples
 * per row, with a 12 ms burn before each rest — i.e. exactly the shape this scheduler produces:
 *
 *     setTimeout(0)   →  3.6 ms      setTimeout(8)   → 19.2 ms
 *     setTimeout(1)   →  3.6 ms      setTimeout(10)  → 19.2 ms
 *     setTimeout(4)   → 18.5 ms      setTimeout(15)  → 19.2 ms
 *     setTimeout(5)   → 19.0 ms      setTimeout(16)  → 19.3 ms
 *     setImmediate    →  0.05 ms
 *
 * Windows runs a 15.6 ms timer quantum and nothing in this process raises it, so a sleep does not
 * last the time you asked for — it lasts until the next tick edge AFTER that time. The whole
 * work+rest cycle therefore SNAPS TO A GRID: 12 ms of work plus any rest under ~3.6 ms lands one
 * tick later (duty 77%); 12 ms plus anything from 4 to 19 ms lands two ticks later (duty 38%).
 * `setTimeout(8)` — the brief's starting hypothesis for 60% — actually delivers 38%, and no fixed
 * argument delivers 60% at all. The nominal argument is not the measurement.
 *
 * So the rest is BOOKKEPT rather than requested: each slice adds `worked × (1/duty − 1)` ms to a
 * debt, every rest is TIMED and subtracted from it, and a rest the OS overshot leaves a CREDIT
 * that the next slices spend by yielding through `setImmediate` instead of sleeping. The duty
 * converges on the target for any timer resolution — coarse like this box, or 1 ms on a machine
 * where something has raised it — which is the property a fixed sleep cannot have.
 */
export const REPLAY_MAX_REST_CREDIT_MS = 32

/**
 * The cooperative scheduler the fold asks "may I keep going?".
 *
 * Deliberately an interface with an injectable clock: a budget is a claim about time, and a claim
 * about time that can only be tested by actually waiting is not tested at all. The same seam is
 * what lets a test drive a duty cycle without spending the wall clock the duty cycle is made of.
 */
export interface Slicer {
  /** Has this slice used its budget? Cheap — one clock read; the fold calls it per event. */
  expired: () => boolean
  /** Hand the event loop back — resting if the duty ledger says rest is owed — then begin a new
   *  slice. */
  yield: () => Promise<void>
  /** How many times this slicer has yielded (diagnostics; the bench does not read it). */
  readonly slices: number
  /** Milliseconds this slicer has spent FOLDING, summed over its slices. */
  readonly workMs: number
  /** Milliseconds it has spent RESTING — the time the timer actually delivered, never the time
   *  that was asked for. `workMs / (workMs + restMs)` is the duty this replay achieved. */
  readonly restMs: number
}

export interface SlicerOptions {
  /** Milliseconds of work per slice. `Infinity` never yields — see `unchunkedSlicer`. */
  budgetMs?: number
  /** Fraction of wall time the fold may spend folding (see REPLAY_DUTY). 1 = never rest, which is
   *  what every equivalence test wants: it is the pre-JOS-50 behaviour exactly. */
  duty?: number
  /** The clock. Injected so tests can drive the budget instead of waiting for it. */
  now?: () => number
  /** How to yield when NO rest is owed. `setImmediate` by design: it runs after the poll phase, so
   *  pending I/O and timers get their turn before the next slice starts. */
  yieldTo?: () => Promise<void>
  /** How to rest when rest IS owed. A real timer — the point of the exercise — and injected for
   *  the same reason the clock is: so a test can state what the OS delivers instead of waiting to
   *  find out. */
  restFor?: (ms: number) => Promise<void>
}

/** A slicer that yields every `budgetMs` of folding, resting to hold `duty`. */
export function createSlicer(opts: SlicerOptions = {}): Slicer {
  const budgetMs = opts.budgetMs ?? REPLAY_SLICE_MS
  // Clamped into [0.05, 1]. Not defensiveness for its own sake: a duty of 0 means "rest forever",
  // which is a hang rather than an error, and a hang in a startup path is the worst possible way
  // for a typo in a future test to announce itself. A twentieth of a core is the floor.
  const duty = Math.min(1, Math.max(0.05, opts.duty ?? REPLAY_DUTY))
  const now = opts.now ?? ((): number => performance.now())
  const yieldTo = opts.yieldTo ?? ((): Promise<void> => yieldToLoop())
  const restFor =
    opts.restFor ??
    (async (ms: number): Promise<void> => {
      await sleep(ms)
    })
  // Rest owed per millisecond of work. duty 0.6 ⇒ 0.667, i.e. 8 ms of rest per 12 ms slice.
  const restPerWorkMs = duty >= 1 ? 0 : (1 - duty) / duty

  let sliceStart = now()
  let deadline = sliceStart + budgetMs
  let slices = 0
  let workMs = 0
  let restMs = 0
  /** Rest owed and not yet taken. Negative = a rest overshot and the next slices have it in hand. */
  let debtMs = 0

  /** Sleep off whatever is owed, and book what the OS actually gave us. */
  const rest = async (): Promise<void> => {
    const from = now()
    await restFor(debtMs)
    const rested = Math.max(0, now() - from)
    restMs += rested
    // The credit is CAPPED (REPLAY_MAX_REST_CREDIT_MS ≈ two Windows timer quanta). A rest that
    // overshot by a quantum is the grid doing its job and must be carried, or the duty lands at
    // 38% instead of 60%. A rest that overshot by half a second is the OS having taken the process
    // away — banking that as credit would buy a burst of dozens of unthrottled slices immediately
    // afterwards, which is precisely the spike this exists to prevent.
    debtMs = Math.max(-REPLAY_MAX_REST_CREDIT_MS, debtMs - rested)
  }

  return {
    expired: () => now() >= deadline,
    yield: async () => {
      slices += 1
      // What this slice cost, charged before anything else: the debt is a function of the work
      // actually done, so an over-budget monster event honestly buys itself more rest.
      const worked = Math.max(0, now() - sliceStart)
      workMs += worked
      debtMs += worked * restPerWorkMs
      if (debtMs > 0) await rest()
      else await yieldTo()
      // The new slice is measured from AFTER the yield returns, never from before it: the time
      // the event loop spent serving everyone else — or resting — is not this fold's budget.
      sliceStart = now()
      deadline = sliceStart + budgetMs
    },
    get slices() {
      return slices
    },
    get workMs() {
      return workMs
    },
    get restMs() {
      return restMs
    }
  }
}

/**
 * THE CONTROL ARM: a slicer that never expires, so the fold runs exactly as it did before this
 * file existed. It is the equivalence oracle's other half and has no other caller.
 *
 * A function parameter rather than an `EQ_REPLAY_UNCHUNKED=1` environment variable (which the plan
 * allowed for) on purpose: an env var is a knob a user can find and a support answer can recommend,
 * and "turn off the thing that keeps the app responsive" must not be reachable from outside this
 * repo's tests. A seam in the signature is visible to the test and to nobody else. The same
 * argument covers `duty` — stated here as 1 for honesty, though a slicer that never yields could
 * never have rested anyway.
 */
export function unchunkedSlicer(): Slicer {
  return createSlicer({ budgetMs: Number.POSITIVE_INFINITY, duty: 1 })
}
