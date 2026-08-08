// ============================================================================
// replayGate.ts — nothing rides the mouse or the screen until parsing is done.
// ============================================================================
//
// THE DEFECT (JOS-62, reported live by the owner): in-game mouselook is JERKY while the app is
// still reading the log. It is not the renderer and it is not the GPU — it is a Win32 message
// hook, and it belongs to us.
//
// A LOCKED overlay is click-through via `setIgnoreMouseEvents(true, {forward:true})`, and on
// Windows Electron implements that `forward` with a low-level mouse hook (WH_MOUSE_LL) owned by
// the MAIN process. Every system mouse event — including the ones EverQuest is reading to turn
// the camera — is then delivered through OUR message loop. During the historical replay that
// loop is folding the log in ~12 ms slices (log/replaySlicer.ts), so each mouse event waits
// behind whichever slice is running. The cursor ring already refuses to forward for exactly this
// reason (see the comment at its `setIgnoreMouseEvents` call in windows.ts); this module says the
// same thing about the meters, for the seconds where it matters.
//
// So while a historical replay is running:
//
//   1. NO WINDOW OF OURS FORWARDS MOUSE EVENTS. A locked overlay is still click-through — it is
//      just click-through the cheap way, `setIgnoreMouseEvents(true)` with no hook at all. The
//      only thing it loses is the hover sensor that reveals its pin, and that is not a loss,
//      because of (2).
//   2. THE OVERLAYS AND THE RING ARE NOT ON SCREEN. They would be showing half-parsed state
//      anyway ("Reading log…"), so there is nothing to hover, nothing to raise, and nothing to
//      composite over the game.
//   3. THE 8 ms CURSOR SAMPLER DOES NOT RUN (presenceEffects.ts). Its gate already knows how to
//      say "the ring is not on screen, so read nothing"; the replay is one more reason.
//
// WHY A MODULE OF ITS OWN. Three files have to agree about this one boolean — windows.ts (which
// owns every show/hide and the `forward` flag), presenceEffects.ts (which owns the ring's
// existence and the sampler) and session.ts (which owns the replay and is therefore the only
// thing entitled to set it). A flag living in any one of them is a flag the other two import
// through a cycle. This module imports only the E2E flag and two leaves of shared/ — neither of
// which imports anything back — which is what keeps the predicates below plain unit tests
// (tests/replayGate.test.mts) instead of claims.
//
// WHAT IT IS NOT. It is not a second opinion about anything persisted. The overlays' locked
// flag, their open flag and the ring's `enabled` all stay exactly where they were; this gate
// only changes what they MEAN for the duration of the fold, and every restore re-reads the
// persisted value rather than a copy taken on the way in.

import { E2E } from './e2e'
import type { OverlayKind } from '../shared/types'
import { isNotifierOverlayKind } from '../shared/alertOverlays'

/**
 * Is a historical replay folding right now?
 *
 * ONE flag for the whole app, and it covers BOTH replays: the cold-start `scanLog` and the
 * shorter fold a character switch runs through the same code (session.ts `tailCharacter` is the
 * one seam, so there is no third caller to forget).
 */
let replaying = false

/** Is a historical replay folding right now? */
export function historicalReplayRunning(): boolean {
  return replaying
}

/**
 * Open or close the gate. Only session.ts calls this, and it pairs the call with re-applying the
 * window state — the flag alone changes nothing about windows that already exist.
 */
export function setHistoricalReplayRunning(running: boolean): void {
  replaying = running
}

// -------------------------------------------------------------------------- the predicates
//
// Each is stated PURELY (a function of its arguments) and then bound to this module's flag. The
// pure form is what tests pin; the bound form is what call sites read, so no call site can
// assemble the condition slightly differently from the one next to it.

/**
 * May a window be shown right now? PURE.
 *
 * `e2e` FIRST AND UNCONDITIONAL, because the headless harness's whole contract is that no window
 * is ever shown (src/main/e2e.ts) — this gate may only ever REMOVE a show, never add one. That is
 * what makes the feature inert under `EQ_E2E=1` structurally rather than by inspection: both
 * terms sit in the same conjunction, so no state of the replay flag can make this true when
 * `e2e` is.
 *
 * The MAIN window is deliberately not covered: it shows its "Reading log…" state during the
 * replay, which is the honest thing for it to do and the only window the user asked for.
 */
export function mayShowWindows(e2e: boolean, replayRunning: boolean): boolean {
  return !e2e && !replayRunning
}

/** May an overlay / the ring be shown right now? (Bound form of `mayShowWindows`.) */
export function windowsMayShow(): boolean {
  return mayShowWindows(E2E, replaying)
}

/**
 * Does this kind's click-through mode install the WH_MOUSE_LL forwarding hook? PURE.
 *
 * TWO reasons not to, and they are independent:
 *   * no NOTIFIER forwards at all (shared/alertOverlays.ts). A notifier is a window that is
 *     empty almost all of the time, and forwarding exists to serve a HOVER SENSOR — the thing
 *     that re-enables capture over a meter's pin button. The toast has none (its capture is
 *     driven by its queue, JOS-40) and an alert text overlay has none either, because it never
 *     captures the mouse at all: a combat alert must not eat the click you aimed at the mob
 *     under it. Both would be paying a system-wide hook for a sensor that does not exist.
 *   * NOBODY forwards during a replay — the hook's cost lands on the user's own mouselook, and
 *     the window it exists for is not even on screen (JOS-62).
 */
export function overlayForwardsMouse(kind: OverlayKind, replayRunning: boolean): boolean {
  return !isNotifierOverlayKind(kind) && !replayRunning
}

/** Should this kind's ignore-mouse call forward? (Bound form of `overlayForwardsMouse`.) */
export function overlayMouseForward(kind: OverlayKind): boolean {
  return overlayForwardsMouse(kind, replaying)
}

/**
 * What the cursor ring should be doing. PURE — and the sampler gate lives here, so "the 8 ms poll
 * does not run during the replay" is a unit test rather than something to re-measure by hand.
 *
 *   'off'       — the feature is switched off: no window, no stream (destroy what exists).
 *   'suspended' — there is nowhere to put the ring (the EQ window has never been seen) or a
 *                 replay is folding: keep whatever window exists, hidden and parked, and read
 *                 NOTHING. A replay deliberately does not even create the window — a page load
 *                 for a hidden window is main-process work at the one moment main has none to
 *                 spare, and the fold's end re-evaluates all of this anyway.
 *   'idle'      — the window exists and is positioned, but the ring is not active right now
 *                 (alt-tabbed away, mouselook hiding the cursor). Warm, hidden, not sampling.
 *   'run'       — visible and streaming.
 */
export type RingDisposition = 'off' | 'suspended' | 'idle' | 'run'

export function ringDisposition(o: {
  enabled: boolean
  hasBounds: boolean
  active: boolean
  replayRunning: boolean
}): RingDisposition {
  if (!o.enabled) return 'off'
  if (o.replayRunning || !o.hasBounds) return 'suspended'
  return o.active ? 'run' : 'idle'
}
