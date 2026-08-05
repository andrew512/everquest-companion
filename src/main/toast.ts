// toast.ts — main's half of the CELEBRATION TOAST (docs/plans/celebration-toasts.md).
//
// ONE HOP IN, TWO HOPS OUT. The main window's always-mounted celebration detectors say what
// happened (`toast:show`, a ToastRequest); this module answers the two questions only main can:
//
//   1. WHAT DOES THE REWARD LOOK LIKE — `lookupItem` (cache-first, local posky before wiki) plus
//      the pure `toastItemCard` formatter, so the overlay receives a finished card. The overlay
//      bundle is MUI-free and fetches NOTHING (T5): if the item's knowledge is not in the
//      payload, it is not on screen.
//   2. WHAT DOES IT SOUND LIKE — the toast's own `{packId, soundId}` + volume live in
//      `overlays.toast` (main-owned electron-store), and the audio stack lives in the MAIN
//      window (T7). So main reads the config and asks that window to play it: one more caller
//      of the existing alert player, not a second audio path, and never the overlay.
//
// LIVE-ONLY DISCIPLINE IS THE DETECTORS' (T4/celebrations law). There is deliberately NO gate
// here: `useBossKills` and `useProgress` already own "a LIVE transition, never hydration", and a
// second predicate in this file could only ever disagree with them.
//
// A CLOSED TOAST OVERLAY IS SILENT. Nothing is rendered and nothing is played when the window
// is not open — the sound belongs to the toast, not to the event (the event already has its own
// alert). That also makes the Preferences switch honest: off means off, everywhere.

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { logError } from './errorLog'
import { lookupItem } from './itemLookup'
import { getOverlayConfig } from './store'
import { getOverlayWindow, sendToMain } from './windows'
import {
  DEFAULT_TOAST_CONFIG,
  toastItemCard,
  validateToastRequest,
  type ToastItemCard,
  type ToastPayload,
  type ToastRequest
} from '../shared/toast'

/** What `toast:sound` carries to the main window's alert player. */
export interface ToastSound {
  packId: string
  soundId: string
  volume: number
}

/**
 * Resolve the embedded reward card, or undefined when there is nothing honest to draw.
 *
 * Never throws and never blocks the toast: an offline/unknown item yields NO card rather than a
 * fabricated one (world-model law 1), and the title still fires on time.
 */
async function resolveItemCard(name: string | undefined): Promise<ToastItemCard | undefined> {
  if (!name) return undefined
  try {
    const k = await lookupItem(name)
    // A lookup that found no page still carries the name we asked with; a card of just a name
    // is worth drawing (it IS the reward), so only a hard failure drops the card.
    return toastItemCard(k)
  } catch (err) {
    logError('main:toastItemLookup', { item: name, error: String(err) })
    return undefined
  }
}

/**
 * Push a finished payload at the toast overlay. A window that is still loading its page (the
 * first toast after the overlay is switched on, and every toast in the e2e harness's first
 * moments) would silently drop the send, so the push waits for `did-finish-load` instead.
 */
function sendToToastOverlay(payload: ToastPayload): void {
  const w = getOverlayWindow('toast')
  if (!w || w.isDestroyed()) return
  const wc = w.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.onToast, payload))
  else wc.send(IPC.onToast, payload)
}

/** Ask the MAIN window to play this toast's line, when one is configured (null = mute). */
function playToastSound(volume: number, sound: { packId: string; soundId: string } | null): void {
  if (!sound) return
  sendToMain(IPC.onToastSound, { ...sound, volume } satisfies ToastSound)
}

/** Build the wire payload for a validated request (item card already resolved). */
function buildPayload(req: ToastRequest, item: ToastItemCard | undefined, durationMs: number): ToastPayload {
  const payload: ToastPayload = {
    id: req.id,
    kind: req.kind,
    title: req.title,
    durationMs: req.durationMs ?? durationMs
  }
  if (req.subtitle) payload.subtitle = req.subtitle
  if (req.focus) payload.focus = req.focus
  if (item) payload.item = item
  return payload
}

/**
 * The whole flow for one request: validate, bail if the overlay is off, resolve the card, then
 * fan out. Exported for the tests that drive it without an IPC round trip.
 */
export async function showToast(input: unknown): Promise<boolean> {
  const req = validateToastRequest(input)
  if (!req) return false
  const cfg = getOverlayConfig('toast')
  if (!cfg.open) return false
  const toastCfg = cfg.toast ?? DEFAULT_TOAST_CONFIG
  const item = await resolveItemCard(req.itemName)
  sendToToastOverlay(buildPayload(req, item, toastCfg.durationMs))
  playToastSound(toastCfg.volume, toastCfg.sound)
  return true
}

export function registerToastIpc(): void {
  ipcMain.on(IPC.toastShow, (_e, req: unknown) => {
    void showToast(req).catch((err: unknown) => logError('main:toastShow', err))
  })
}
