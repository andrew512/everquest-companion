// preload/overlayTextSize.ts — the overlays' text size, on the APP bridge (JOS-405).
//
// Its own module, spread into `api` in index.ts, for the same reason `./overlaySnap.ts`,
// `./uiScale.ts`, `./perf.ts` and `./graphics.ts` are: that file is at the repo's 400-code-line
// factoring ceiling and the answer to that is a split, not a widened threshold. On `window.eq`
// these three members are indistinguishable from the ones written out there.
//
// THE OVERLAY WINDOWS HAVE THEIR OWN TWO (preload/overlay.ts), under the same names. That is not
// duplication to be tidied away later — it is the fight-selection trio's arrangement, for the same
// reason: two very different windows decide one thing with this value, and a second NAME for one
// signal is how they end up disagreeing about it.
//
// The setter is a MERGE-PATCH and resolves to what was ACTUALLY stored — main re-validates through
// `shared/overlayTextScale.ts`, the same normalizer the store reader uses — so the Preferences
// controls render main's answer rather than assuming their own request landed.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { OverlayTextSizePrefs } from '../shared/overlayTextScale'

export const overlayTextSizeBridge = {
  /** The shared size and whether it is in force. `{ 1, false }` on an install that never chose. */
  getOverlayTextSize: (): Promise<OverlayTextSizePrefs> =>
    ipcRenderer.invoke(IPC.overlayTextSizeGet),
  /** Merge-patch it; every open overlay window is resized before this promise resolves. */
  setOverlayTextSize: (patch: Partial<OverlayTextSizePrefs>): Promise<OverlayTextSizePrefs> =>
    ipcRenderer.invoke(IPC.overlayTextSizeSet, patch),
  /**
   * Main's push, for the presses this window did not make.
   *
   * Twelve overlay windows carry an A− / A+ that moves the shared size, so a Preferences pane left
   * open while somebody scales their fight meter would otherwise print a stale percentage — the
   * `onCloseToTray` argument, on a value with more controls than any other in the app.
   */
  onOverlayTextSize: (cb: (p: OverlayTextSizePrefs) => void): (() => void) => {
    const listener = (_e: unknown, p: OverlayTextSizePrefs): void => cb(p)
    ipcRenderer.on(IPC.onOverlayTextSize, listener)
    return () => ipcRenderer.removeListener(IPC.onOverlayTextSize, listener)
  }
}
