// alertTextQueue — the ALERT TEXT overlay's queue, as a pure reducer.
//
// Every timing rule this surface has lives here as arithmetic over an explicit `dtMs`, with no
// `setTimeout`, no `Date.now()` and no DOM: the component owns exactly one interval and dispatches
// `tick`. That is what makes "three alerts firing at once leave three lines" and "each leaves on
// its own clock" testable in `npm test` rather than by watching the screen.
//
// THE RULES:
//   * A line holds for its own `durationMs` (main fills it from the def), then plays a short exit
//     and is gone.
//   * ARRIVALS ALWAYS STACK. Two lines are two lines, and that is the whole feature the owner
//     asked for: an alert must never overwrite one that is still on screen.
//   * Arrival order IS render order: index 0 draws at the top, newest underneath — so a line does
//     not move on screen after you have started reading it.
//   * The queue is capped. A further arrival evicts the OLDEST (index 0), the one that has been
//     up longest — never the one that just arrived, which is the one you were alerted about.
//
// IT IS A SIBLING OF toastQueue.ts, NOT A REUSE OF IT, and the difference is deliberate. Three of
// the toast's five rules are wrong here:
//   * DEDUPE BY ID — a repeat `id` refreshes the toast card in place, because two kills of the
//     same boss in one pull is one celebration. Here it is forbidden: two fires of one alert are
//     two things that happened, and `id` is minted per FIRING precisely so it cannot collide.
//   * HOVER PIN — unreachable. This window never captures the mouse (a combat alert must not eat
//     the click you aimed at the mob under it), so a `hover` action could never be dispatched.
//   * THE GRACE FLOOR — meaningless without pinning, which is what it exists to soften.
// What is genuinely shared is "decrement, exit, drop, preserve identity", about a dozen lines.
// Threading five behaviour flags through the celebration timing to save them would be a worse
// trade than this file.

import type { AlertTextCard } from '@shared/alertDisplay'

/**
 * Most lines on screen at once; a further arrival evicts the oldest.
 *
 * Higher than the toast's 3 because the case is different: celebrations arrive one at a time,
 * while alerts arrive in bursts (a raid wipe, three buffs fading, a pull going wrong) — and a
 * burst is exactly when the user wants to see all of it. Six at the default 28 px still fits the
 * default lane.
 */
export const ALERT_TEXT_CAP = 6

/** Exit animation. The line stays in state (fading) for exactly this long. The reducer does not
 *  time the animation — CSS does — but the component needs the same number, and one definition is
 *  how they stay equal. */
export const ALERT_TEXT_EXIT_MS = 250

/** Used when a card names no duration of its own (main normally fills it from the def). */
export const ALERT_TEXT_FALLBACK_MS = 5000

export interface AlertTextCardState {
  card: AlertTextCard
  /** ms of hold time left before the exit starts. */
  remainingMs: number
  /** ms into the exit animation, or null while the line is still holding. */
  exitingMs: number | null
}

export type AlertTextAction =
  | { type: 'show'; card: AlertTextCard }
  | { type: 'tick'; dtMs: number }

function fresh(card: AlertTextCard): AlertTextCardState {
  return { card, remainingMs: card.durationMs || ALERT_TEXT_FALLBACK_MS, exitingMs: null }
}

/** Advance one line's clocks by `dtMs`. Returns null when it is finished and drops out. */
function tickCard(c: AlertTextCardState, dtMs: number): AlertTextCardState | null {
  if (c.exitingMs !== null) {
    const exitingMs = c.exitingMs + dtMs
    return exitingMs >= ALERT_TEXT_EXIT_MS ? null : { ...c, exitingMs }
  }
  const remainingMs = c.remainingMs - dtMs
  return remainingMs > 0 ? { ...c, remainingMs } : { ...c, remainingMs: 0, exitingMs: 0 }
}

/** The queue's whole behaviour. Pure: same state + same action ⇒ same result, always. */
export function alertTextReduce(
  state: AlertTextCardState[],
  action: AlertTextAction
): AlertTextCardState[] {
  switch (action.type) {
    case 'show': {
      // APPEND, UNCONDITIONALLY. No id lookup, and that absence is the feature.
      const appended = [...state, fresh(action.card)]
      return appended.length > ALERT_TEXT_CAP ? appended.slice(appended.length - ALERT_TEXT_CAP) : appended
    }
    case 'tick': {
      const next = state
        .map((c) => tickCard(c, action.dtMs))
        .filter((c): c is AlertTextCardState => c !== null)
      // Identity is preserved when nothing moved, so an empty or still queue does not re-render
      // the window 10× a second over the game.
      return next.length === state.length && next.every((c, i) => c === state[i]) ? state : next
    }
  }
}
