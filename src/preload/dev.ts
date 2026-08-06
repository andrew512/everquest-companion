// preload/dev.ts — the dev-only slice of the app bridge (JOS-61). One method.
//
// A separate file for FILE MASS, not for scope: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the rule here is to split rather than ratchet (perf.ts, graphics.ts
// and windows.ts are the same pattern). Spread into `api` there, so `window.eq.restartApp()`
// sits exactly where it would have if it were written inline.
//
// THE METHOD EXISTS IN EVERY BUILD; WHAT IT DOES DOES NOT. The bridge is a door — main decides
// what is on the other side of it, and in a packaged build the handler refuses having done
// nothing (src/main/ipc/dev.ts). The only caller is compiled out of production bytes anyway
// (`DEV_TOOLS`, anchored on `import.meta.env.DEV`).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { DevRestartResult } from '../shared/devRestart'

export const devBridge = {
  /**
   * Restart the app — DEV BUILDS ONLY.
   *
   * The reply says WHICH restart happened (JOS-63), because they feel different: 'relaunched'
   * means this process is already going away, 'watcher' means main asked the electron-vite
   * watcher to rebuild and relaunch it and the window has a couple of seconds left, and
   * 'refused' means nothing happened. Nothing should be sequenced after this promise — in two
   * of the three cases the process dies while it is in flight.
   */
  restartApp: (): Promise<DevRestartResult> => ipcRenderer.invoke(IPC.devRestart)
}
