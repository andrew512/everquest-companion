// preload/graphics.ts — the graphics-compatibility half of the app bridge (JOS-40).
//
// Its own module, spread into `api` in index.ts, for the same reason `./perf.ts` is one: that
// file is at the repo's 400-code-line factoring ceiling and the answer to that is a split, not a
// widened threshold. On `window.eq` these two methods are indistinguishable from the ones
// written out there.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { GraphicsPrefs } from '../shared/graphicsPrefs'

export const graphicsBridge = {
  /** The persisted graphics switches. Both off by default. */
  getGraphicsPrefs: (): Promise<GraphicsPrefs> => ipcRenderer.invoke(IPC.graphicsPrefsGet),
  /**
   * Merge-patch them; resolves to what was ACTUALLY stored.
   *
   * Neither switch changes this session: software rendering is decided before Electron is ready
   * (next launch) and a window's transparency is fixed when it is created (next overlay open).
   * The Preferences labels say so — see src/main/ipc/graphics.ts for why there is no channel
   * that would let them pretend otherwise.
   */
  setGraphicsPrefs: (patch: Partial<GraphicsPrefs>): Promise<GraphicsPrefs> =>
    ipcRenderer.invoke(IPC.graphicsPrefsSet, patch)
}
