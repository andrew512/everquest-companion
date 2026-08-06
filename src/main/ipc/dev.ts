// IPC: the dev-only restart button (JOS-61 — see ../devRestart.ts for the reasoning).
//
// REGISTERED UNCONDITIONALLY, REFUSED WHEN PACKAGED. The dev-triage surface takes the other
// route (`if (!app.isPackaged && !E2E)` around the registration itself) because its module
// reaches devDependencies that are not in a shipped build at all. This one is four lines of
// Electron's own API, so the honest shape is the reverse: one handler that always exists and
// says no in a packaged build. The refusal is then something a test can OBSERVE — an absent
// handler and a handler that declines are indistinguishable from the renderer, and only one of
// them is a decision this code made.
//
// The renderer half is stripped from production bytes independently (`DEV_TOOLS`, anchored on
// `import.meta.env.DEV`), so this is the second lock, not the only one.

import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { performDevRestart } from '../devRestart'

export function registerDevIpc(): void {
  ipcMain.handle(IPC.devRestart, () => performDevRestart(app))
}
