// toastQueue — the celebration toast's QUEUE, as a pure reducer.
//
// Every timing rule the toast has (docs/plans/celebration-toasts.md T8) lives here as data
// arithmetic over an explicit `dtMs`, with no `setTimeout`, no `Date.now()` and no DOM: the
// component owns exactly one interval and dispatches `tick`. That is what makes "hover pins the
// card", "the clock resumes with a grace period" and "a burst of four leaves the oldest behind"
// testable in `npm test` instead of by watching the screen.
//
// THE RULES:
//   * A card holds for its own `durationMs` (main fills it from the toast config), then plays a
//     300 ms exit and is gone.
//   * Hovering a card PAUSES its clock — and only its clock. Two stacked cards run independent
//     timers, so pinning the top one does not freeze the one below it.
//   * Leaving a card resumes it with a ~1.5 s GRACE floor, so a card you were reading does not
//     vanish the instant your pointer crosses its edge.
//   * The queue is capped at 3. A fourth arrival evicts the OLDEST (index 0), which is the one
//     that has been on screen longest — never the one that just arrived.
//   * Arrival order IS render order: index 0 draws at the top, newest underneath.
//   * A repeat `id` REFRESHES the card already on screen (it is the dedupe key) rather than
//     stacking a duplicate — two kills of the same boss in one pull is one card, re-clocked.
//
// A card that has begun EXITING cannot be caught by the pointer: it is fading and its hit box
// is going away, and "sometimes a hover re-opens it" is a worse contract than "the card left".

import type { ToastPayload } from '@shared/toast'

/** Most cards on screen at once; a fourth evicts the oldest. */
export const TOAST_CAP = 3
/** Enter animation (slide-down + fade). The reducer does not time it — CSS does — but the
 *  component needs the same number, and one definition is how they stay equal. */
export const TOAST_ENTER_MS = 250
/** Exit animation. The card stays in state (fading) for exactly this long. */
export const TOAST_EXIT_MS = 300
/** Floor the clock is restored to when the pointer leaves a pinned card. */
export const TOAST_GRACE_MS = 1500
/** Used when a payload names no duration of its own (main normally fills it from the config). */
export const TOAST_FALLBACK_MS = 6000

export interface ToastCardState {
  payload: ToastPayload
  /** ms of hold time left before the exit starts. */
  remainingMs: number
  /** the pointer is over this card — its clock is paused */
  pinned: boolean
  /** ms into the exit animation, or null while the card is still holding */
  exitingMs: number | null
}

export type ToastAction =
  | { type: 'show'; payload: ToastPayload }
  | { type: 'tick'; dtMs: number }
  | { type: 'hover'; id: string; over: boolean }
  | { type: 'dismiss'; id: string }

function fresh(payload: ToastPayload): ToastCardState {
  return {
    payload,
    remainingMs: payload.durationMs ?? TOAST_FALLBACK_MS,
    pinned: false,
    exitingMs: null
  }
}

/** A new arrival: refresh a card with the same id, else append and evict past the cap. */
function show(state: ToastCardState[], payload: ToastPayload): ToastCardState[] {
  const at = state.findIndex((c) => c.payload.id === payload.id)
  if (at >= 0) {
    const next = state.slice()
    // Keep the pin: refreshing a card the user is actively reading must not yank it away.
    next[at] = { ...fresh(payload), pinned: state[at].pinned }
    return next
  }
  const appended = [...state, fresh(payload)]
  return appended.length > TOAST_CAP ? appended.slice(appended.length - TOAST_CAP) : appended
}

/** Advance one card's clocks by `dtMs`. Returns null when the card is finished and drops out. */
function tickCard(card: ToastCardState, dtMs: number): ToastCardState | null {
  if (card.exitingMs !== null) {
    const exitingMs = card.exitingMs + dtMs
    return exitingMs >= TOAST_EXIT_MS ? null : { ...card, exitingMs }
  }
  if (card.pinned) return card
  const remainingMs = card.remainingMs - dtMs
  return remainingMs > 0 ? { ...card, remainingMs } : { ...card, remainingMs: 0, exitingMs: 0 }
}

/** Pointer in/out over one card: pause its clock, or resume it with the grace floor. */
function hover(state: ToastCardState[], id: string, over: boolean): ToastCardState[] {
  return state.map((c) => {
    if (c.payload.id !== id || c.exitingMs !== null) return c
    if (over) return { ...c, pinned: true }
    return { ...c, pinned: false, remainingMs: Math.max(c.remainingMs, TOAST_GRACE_MS) }
  })
}

/** The queue's whole behaviour. Pure: same state + same action ⇒ same result, always. */
export function toastReduce(state: ToastCardState[], action: ToastAction): ToastCardState[] {
  switch (action.type) {
    case 'show':
      return show(state, action.payload)
    case 'tick': {
      const next = state.map((c) => tickCard(c, action.dtMs)).filter((c): c is ToastCardState => c !== null)
      // Identity is preserved when nothing moved, so a paused, fully-pinned queue does not
      // re-render the window 10× a second over the game.
      return next.length === state.length && next.every((c, i) => c === state[i]) ? state : next
    }
    case 'hover':
      return hover(state, action.id, action.over)
    case 'dismiss': {
      const next = state.filter((c) => c.payload.id !== action.id)
      return next.length === state.length ? state : next
    }
  }
}
