// displayFire — "this alert fired; put its line on screen"
// (docs/plans/alert-text-overlays.md §4).
//
// Its own file rather than four more lines inside player.tsx, for two reasons: that file's
// `playAlertNow` is the audio path and should gain exactly ONE statement, and the per-firing id
// sequence below needs a single owner. Every firing path already converges on `playAlertNow` —
// the main-side module delta, a renderer-only 'app' signal, and the row's ▶ — so one call there
// is one call from everywhere.
//
// IT RUNS BEFORE THE AUDIO PLAN, and that ordering is the contract. The master mute is a promise
// that the app makes no NOISE, and the cross-alert coalescer (audioThrottle.ts) exists to stop a
// smear of simultaneous SOUNDS — three sounds at once carry less than one. Neither is true of
// text: a card is a thing you see, three lines stack and read fine, and three buffs fading at
// once is precisely when you want all three named. So a muted app still draws, and a burst still
// draws every line.
//
// A CLOSED OVERLAY IS SILENT, but that is main's call (main/alertOverlay.ts), not this file's:
// the renderer does not track which overlay windows are open, and a second copy of that state
// here could only ever disagree with the one that owns the windows.
//
// Value imports from `shared/` stay RELATIVE — the repo-wide rule for anything node:test loads.

import type { AlertDef } from '@shared/types'
import type { SpeechFiring } from '@shared/speechText'
import { displayTextFor, type AlertTextRequest } from '../../../../shared/alertDisplay'
import { DEFAULT_ALERT_OVERLAY } from '../../../../shared/alertOverlays'

/**
 * Distinguishes two firings of the SAME alert, which is the whole reason lines stack instead of
 * replacing each other (alertTextQueue.ts refuses to dedupe, and this is what makes that safe).
 * Session-scoped and monotonic — it is a React key, never anything durable.
 */
let seq = 0

/**
 * Build the request one firing draws, or null when this alert draws nothing.
 *
 * PURE and exported so the id-minting and the field defaulting are pinned by a test rather than
 * by reading the caller. `nextId` is a parameter for the same reason: a function that read the
 * module counter would be untestable for the one property that matters (two firings of one alert
 * produce two different ids).
 */
export function alertTextRequest(
  def: Pick<AlertDef, 'name' | 'id' | 'display'>,
  firing: SpeechFiring | null,
  nextId: number
): AlertTextRequest | null {
  const display = def.display
  if (!display) return null
  const text = displayTextFor(def, firing)
  if (!text) return null
  // ONLY WHAT THE ALERT OVERRODE. Every absent field is filled from the TARGET OVERLAY's own
  // defaults, which live in the store and are therefore main's to read (main/alertOverlay.ts).
  // Filling them here would need a renderer-side copy of that config, and a copy is a second
  // answer that goes stale the moment the user changes a default in Preferences.
  return {
    id: `${def.id}:${String(nextId)}`,
    overlay: display.overlay ?? DEFAULT_ALERT_OVERLAY,
    text,
    ...(display.font ? { font: display.font } : {}),
    ...(display.fontSize !== undefined ? { fontSize: display.fontSize } : {}),
    ...(display.color ? { color: display.color } : {}),
    ...(display.durationMs !== undefined ? { durationMs: display.durationMs } : {})
  }
}

/**
 * Draw this firing, if the alert asked to be seen. Fire-and-forget: an alert never waits on the
 * window it just wrote to.
 */
export function showAlertDisplay(def: AlertDef, firing?: SpeechFiring | null): void {
  const req = alertTextRequest(def, firing ?? null, seq++)
  if (req) window.eq.showAlertText(req)
}
