// windows.ts — the slice of the main app's bridge that is about the app's OTHER WINDOWS:
// the floating overlays' open-state, and the celebration toast
// (docs/plans/celebration-toasts.md).
//
// A separate file for FILE MASS, not for scope: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the rule here is to split rather than ratchet (perf.ts is the same
// pattern). This object is spread into that bridge, so every method below is an ordinary member
// of the one `window.eq` surface — nothing about the trust boundary changes by being written
// next door.
//
// The toast's two directions are FIRE-AND-FORGET: a producer never waits on a notification, and
// the sound push is a request to play, not a transaction.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ToastRequest } from '../shared/toast'
import type { OverlayConfig, OverlayKind } from '../shared/types'

/** What main asks the main window to play for a toast (src/main/toast.ts ToastSound). */
export interface ToastSoundPush {
  packId: string
  soundId: string
  volume: number
}

export const windowsApi = {
  // ---- the floating overlays' open-state (Task #52; per-kind in Task #54) ----
  /** Toggle a kind's overlay window; resolves to the resulting open-state. */
  toggleOverlay: (kind: OverlayKind): Promise<boolean> => ipcRenderer.invoke(IPC.overlayToggle, kind),
  /** Read the open-state map for all overlay kinds. */
  getOverlayState: (): Promise<Record<OverlayKind, boolean>> => ipcRenderer.invoke(IPC.overlayGetState),
  /** Subscribe to overlay open-state changes (so the TitleBar menu stays in sync). Payload {kind, open}. */
  onOverlayState: (cb: (s: { kind: OverlayKind; open: boolean }) => void): (() => void) => {
    const listener = (_e: unknown, s: { kind: OverlayKind; open: boolean }): void => cb(s)
    ipcRenderer.on(IPC.onOverlayState, listener)
    return () => ipcRenderer.removeListener(IPC.onOverlayState, listener)
  },

  // ---- celebration toasts (docs/plans/celebration-toasts.md) ----
  /**
   * "Celebrate this." Called by the app's EXISTING always-mounted celebration detectors — the
   * same callbacks that fire the bossDefeat / questComplete app signals, so the live-only
   * discipline is owned in one place. Main re-validates the request, resolves the reward item
   * card and forwards it to the toast overlay window.
   */
  showToast: (req: ToastRequest): void => ipcRenderer.send(IPC.toastShow, req),
  /**
   * Subscribe to "play this toast's line" (T7). The overlay bundle has no audio stack, so the
   * MAIN window's alert player is the one that makes the sound — this is its door.
   */
  onToastSound: (cb: (s: ToastSoundPush) => void): (() => void) => {
    const listener = (_e: unknown, s: ToastSoundPush): void => cb(s)
    ipcRenderer.on(IPC.onToastSound, listener)
    return () => ipcRenderer.removeListener(IPC.onToastSound, listener)
  },

  // ---- the Preferences panel's door to `overlays.toast` -------------------------------
  // The overlay windows read their own config through the overlay bridge; the MAIN window
  // needs the same two calls for exactly one kind, so they are spelled kind-first here rather
  // than exposing a general per-kind config surface to the app.
  /** Read the toast overlay's persisted config (sound / volume / duration + lock + bounds). */
  getToastConfig: (): Promise<OverlayConfig> => ipcRenderer.invoke(IPC.overlayGetConfig, 'toast'),
  /** Merge-patch it; resolves to what was ACTUALLY stored (main re-clamps every field). */
  setToastConfig: (patch: Partial<OverlayConfig>): Promise<OverlayConfig> =>
    ipcRenderer.invoke(IPC.overlaySetConfig, 'toast', patch),
  /**
   * Lock (click-through) / unlock (position it) the toast window. A separate call from the
   * config patch above because this one is APPLIED to the live window as well as persisted —
   * `overlay:setConfig` only stores.
   */
  setToastLocked: (locked: boolean): void => ipcRenderer.send(IPC.overlaySetLocked, 'toast', locked)
}
