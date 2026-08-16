// alertOverlay.ts — main's half of ALERT TEXT OVERLAYS (docs/plans/alert-text-overlays.md §4).
//
// ONE HOP, AND NO OPINIONS. The always-mounted AlertPlayer says what an alert fired and what it
// resolved to (`alertText:show`, an AlertTextRequest); this module re-validates it and hands it to
// the one window it names. That is the whole job — unlike `main/toast.ts`, which has a question
// only main can answer (what does the reward item look like?), there is nothing to add here. The
// text was resolved by the renderer that owns the def, the `$<name>` values came off the firing,
// and the overlay bundle fetches nothing.
//
// SO WHY GO THROUGH MAIN AT ALL: renderers cannot talk to each other. The app window and the
// overlay window are separate processes, and main is the only one that can reach both.
//
// THE VALIDATION IS NOT A FORMALITY. This is a renderer→main channel, and what crosses it lands
// in a `style` attribute in ANOTHER window — the repo's rule is that renderer input is
// re-validated at the handler rather than trusted because today's only caller is the app's own UI
// (the `sounds:getData` packId precedent). `validateAlertTextRequest` (shared/alertDisplay.ts)
// rebuilds the request field by field: an unknown overlay or an empty line is dropped, and every
// style value is repaired to a clamped default rather than refused.
//
// A CLOSED OVERLAY IS SILENT (owner decision D3), the toast's law verbatim: nothing is drawn when
// the window is not open. The alert still fired, still made whatever sound it makes, and still
// landed in the event log — off means off, and only for the part that is off.
//
// LIVE-ONLY DISCIPLINE IS THE PLAYER'S. There is deliberately no replay gate here: the alerts
// module already refuses to fire on anything but a live event (`onEvent(ev, live)`), and a second
// predicate in this file could only ever disagree with it.

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { logError } from './errorLog'
import { getOverlayConfig } from './store'
import { getOverlayWindow } from './windows'
import {
  DEFAULT_ALERT_TEXT,
  resolveAlertTextCard,
  validateAlertTextRequest,
  type AlertTextCard
} from '../shared/alertDisplay'
import type { AlertOverlayKind } from '../shared/alertOverlays'

/**
 * Push a finished card at the overlay it names. A window that is still loading its page (the
 * first alert after the overlay is switched on, and every alert in the e2e harness's first
 * moments) would silently drop the send, so the push waits for `did-finish-load` instead — the
 * same guard `sendToToastOverlay` needs, for the same reason.
 */
function sendToAlertOverlay(kind: AlertOverlayKind, card: AlertTextCard): void {
  const w = getOverlayWindow(kind)
  if (!w || w.isDestroyed()) return
  const wc = w.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.onAlertText, card))
  else wc.send(IPC.onAlertText, card)
}

/**
 * The whole flow for one request: validate, bail if the target overlay is closed, fill in
 * whatever the alert did not override, route. Exported for the tests that drive it without an
 * IPC round trip.
 *
 * THE INHERITANCE HAPPENS HERE, on ONE store read that was already being made. The renderer sends
 * only what the alert actually chose, because only main holds the overlay's own look — and the
 * open-state check below has that same config in hand at exactly the right moment. A renderer-side
 * copy of those defaults would be a second answer that could disagree the moment the user changed
 * one in Preferences.
 */
export function showAlertText(input: unknown): boolean {
  const req = validateAlertTextRequest(input)
  if (!req) return false
  const cfg = getOverlayConfig(req.overlay)
  if (!cfg.open) return false
  sendToAlertOverlay(req.overlay, resolveAlertTextCard(req, cfg.alertText ?? DEFAULT_ALERT_TEXT))
  return true
}

export function registerAlertOverlayIpc(): void {
  ipcMain.on(IPC.alertTextShow, (_e, req: unknown) => {
    try {
      showAlertText(req)
    } catch (err) {
      logError('main:alertTextShow', err)
    }
  })
}
