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
// Showing a toast is FIRE-AND-FORGET: a producer never waits on a notification.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ToastRequest } from '../shared/toast'
import type { OverlayConfig, OverlayKind } from '../shared/types'

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

  // ---- global fight selection (docs/plans/combat-overlay-parity.md P4) ----
  // It lives in THIS slice rather than beside the combat snapshot because it is a CROSS-WINDOW
  // fact, not a combat one: main holds it precisely so the Combat tab and the fight overlays
  // (separate renderer processes) can agree. The overlay bridge carries the same three members
  // under the same names — that structural identity is what lets ONE renderer hook drive both
  // surfaces (`useGlobalFight`), and it is pinned by tests/fightSelection.test.mts.
  /** The currently selected fight ('__live__' or an 'e<n>' encounter id). */
  getFightSelection: (): Promise<string> => ipcRenderer.invoke(IPC.fightSelectionGet),
  /** "The user picked this fight." Fire-and-forget; main validates and fans out. */
  setFightSelection: (id: string): void => ipcRenderer.send(IPC.fightSelectionSet, id),
  /** Subscribe to selection changes made anywhere in the app. Payload {fightId}. */
  onFightSelection: (cb: (s: { fightId: string }) => void): (() => void) => {
    const listener = (_e: unknown, s: { fightId: string }): void => cb(s)
    ipcRenderer.on(IPC.onFightSelection, listener)
    return () => ipcRenderer.removeListener(IPC.onFightSelection, listener)
  },

  // ---- celebration toasts (docs/plans/celebration-toasts.md) ----
  /**
   * "Celebrate this." Called by the app's EXISTING always-mounted celebration detectors — the
   * same callbacks that fire the bossDefeat / questComplete app signals, so the live-only
   * discipline is owned in one place. Main re-validates the request, resolves the reward item
   * card and forwards it to the toast overlay window.
   */
  showToast: (req: ToastRequest): void => ipcRenderer.send(IPC.toastShow, req),

  // ---- the Preferences panel's door to `overlays.toast` -------------------------------
  // The overlay windows read their own config through the overlay bridge; the MAIN window
  // needs one read for exactly one kind, so it is spelled kind-first here rather than exposing
  // a general per-kind config surface to the app. (Its WRITE twin, `setToastConfig`, existed
  // for the sound picker alone and went with it on 2026-08-05 — the panel's two remaining
  // controls are the window's open-state and its lock, and both have their own calls.)
  /** Read the toast overlay's persisted config (duration + lock + bounds). */
  getToastConfig: (): Promise<OverlayConfig> => ipcRenderer.invoke(IPC.overlayGetConfig, 'toast'),
  /**
   * Lock (click-through) / unlock (position it) the toast window. A separate call from the
   * config patch above because this one is APPLIED to the live window as well as persisted —
   * `overlay:setConfig` only stores.
   */
  setToastLocked: (locked: boolean): void => ipcRenderer.send(IPC.overlaySetLocked, 'toast', locked)
}
