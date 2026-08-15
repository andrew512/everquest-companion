// eqWindowMode.ts — WHAT PREFERENCES IS TOLD ABOUT EVERQUEST'S DISPLAY MODE (JOS-368).
//
// A player running the game in EXCLUSIVE fullscreen is running it in the one mode an always-on-top
// overlay cannot share: every z-order change over an exclusive-fullscreen game is a display-mode
// switch, which is a black flash and about a second of frozen game. Today nothing says so, and the
// people it happens to blame the game or blame us. So Preferences says it, once, calmly.
//
// THE DECISION IS MAIN'S, AND ONLY THE ANSWER CROSSES. `show` folds three facts the renderer has no
// business re-deriving — the mode read out of `eqclient.ini`, whether this install has any overlay
// open at all, and whether the note was already dismissed at this app version — into the one thing
// a card can act on. A renderer that assembled that itself would be a second opinion about when to
// speak, and the sentence would drift out of step with the condition that earns it.
//
// NOTHING FROM THE INI TRAVELS. `mode` is one of three words (shared/telemetry.ts's enum, reused
// here rather than respelled), so no path, resolution, device name or skin from EverQuest's own
// settings file has a shape in which it could reach a window.

import type { TelemetryEqWindowMode } from './telemetry'

/** What `eq:getWindowNotice` answers, and what a dismissal answers with. */
export interface EqWindowNotice {
  /** EverQuest's `WindowedMode`, folded: 'windowed' | 'exclusive' | 'unknown'. */
  mode: TelemetryEqWindowMode
  /** Should Preferences be showing the note right now? See the header for what it folds. */
  show: boolean
}
