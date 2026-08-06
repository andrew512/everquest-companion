// preload/dev.ts — the dev-only slice of the app bridge (JOS-61). One method.
//
// A separate file for FILE MASS, not for scope: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the rule here is to split rather than ratchet (perf.ts, graphics.ts
// and windows.ts are the same pattern). Spread into `api` there, so `window.eq.restartApp()`
// sits exactly where it would have if it were written inline.
//
// THE METHOD EXISTS IN EVERY BUILD; WHAT IT DOES DOES NOT. The bridge is a door — main decides
// what is on the other side of it, and in a packaged build the handler answers `false` having
// done nothing (src/main/ipc/dev.ts). The only caller is compiled out of production bytes
// anyway (`DEV_TOOLS`, anchored on `import.meta.env.DEV`).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

export const devBridge = {
  /**
   * Relaunch the app — DEV BUILDS ONLY. Resolves `true` when the restart was performed and
   * `false` when a packaged build refused it; in the happy case the process is gone before the
   * reply arrives, so nothing should be sequenced after this promise.
   */
  restartApp: (): Promise<boolean> => ipcRenderer.invoke(IPC.devRestart)
}
