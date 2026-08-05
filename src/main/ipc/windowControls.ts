// IPC: everything the renderer says ABOUT WINDOWS — the frameless title-bar controls, the
// floating overlays' open/config/click-through state, the cross-window deep link, and the
// renderer's own error reports.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { E2E } from '../e2e'
import { logError } from '../errorLog'
import { getFightSelection, setFightSelection } from '../fightSelection'
import { getOverlayConfig, setOverlayConfig } from '../store'
import {
  applyOverlayLocked,
  getMainWindow,
  getOverlayWindow,
  isOverlayOpen,
  overlayStateMap,
  setOverlayIgnoreMouse,
  setOverlayOpen
} from '../windows'
import type { AppFocus, AppFocusView, OverlayConfig, OverlayKind } from '../../shared/types'

/** A non-empty display string, or undefined. Trimmed only for the emptiness test — the receiving
 *  view looks the value up verbatim, exactly as the sending window read it. */
function focusText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** The deep link, rebuilt from the fields this boundary names. See the comment at its caller. */
function sanitizeFocus(focus: AppFocus): AppFocus {
  const out: AppFocus = { view: focus.view }
  const mob = focusText(focus.mob)
  if (mob) out.mob = mob
  const quest = focusText(focus.quest)
  if (quest) out.quest = quest
  if (typeof focus.level === 'number' && Number.isInteger(focus.level) && focus.level > 0) {
    out.level = focus.level
  }
  return out
}

export function registerWindowIpc(): void {
  // ---- cross-window deep link (Task #64) ----
  // An overlay row says a thing happened; clicking it asks the APP to answer it properly. Main
  // is the only process that can raise a window it doesn't own, so the hop goes through here.
  //
  // The `view` is re-validated against the closed AppFocusView union rather than trusted
  // because today's only caller is the app's own overlay (the same rule `sounds:getData`'s
  // packId follows): a renderer telling another renderer where to navigate is a capability, and
  // its vocabulary is fixed here. The ANCHORS are forwarded on the same terms: `mob` and `quest`
  // only when non-empty strings (pure display/lookup text in the receiving view, never a path),
  // `level` only as a small positive integer. The forwarded object is REBUILT from those fields,
  // so nothing else the asking window attached ever reaches the app's renderer.
  //
  // E2E never shows a window (src/main/e2e.ts is the whole test mode), so the raise is skipped
  // there; the forward still happens, which is the half a test could observe.
  ipcMain.on(IPC.focusView, (_e, focus: AppFocus) => {
    // The closed vocabulary, restated here on purpose (see above): 'mobs' from the events
    // overlay's con rows, 'posky' from a celebration toast's reward card (optionally anchored at
    // ONE quest), 'leveling' from a level-up toast (anchored at the level that just dinged).
    const views: AppFocusView[] = ['mobs', 'posky', 'leveling']
    if (!focus || !(views as string[]).includes(focus.view)) return
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return
    if (!E2E) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
    w.webContents.send(IPC.onFocusView, sanitizeFocus(focus))
  })

  // ---- frameless window controls (Task #23) ----
  // The React title bar (App.tsx) drives the native window: these mirror the
  // OS min/max/close chrome we removed with `frame: false`. `ipcMain.on` matches
  // the preload's fire-and-forget `send`.
  ipcMain.on(IPC.windowMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getMainWindow()?.close())

  // ---- floating overlay DPS meters (Task #52; per-kind in Task #54) ----
  // Toggle a kind from the main app's TitleBar menu; returns the resulting open-state.
  ipcMain.handle(IPC.overlayToggle, (_e, kind: OverlayKind) =>
    setOverlayOpen(kind, !isOverlayOpen(kind))
  )
  ipcMain.handle(IPC.overlayGetState, () => overlayStateMap())
  ipcMain.handle(IPC.overlayGetConfig, (_e, kind: OverlayKind) => getOverlayConfig(kind))
  ipcMain.handle(IPC.overlaySetConfig, (_e, kind: OverlayKind, patch: Partial<OverlayConfig>) => {
    const next = setOverlayConfig(kind, patch ?? {})
    // Echo the merged config to that kind's overlay window so its UI stays in sync if the change
    // originated elsewhere (keeps the contract honest and cheap).
    getOverlayWindow(kind)?.webContents.send(IPC.onOverlayConfig, { kind, config: next })
    return next
  })
  // Locked (click-through) vs interactive. Persist + apply to the live window + ECHO.
  //
  // The echo is not decoration: this used to be called only BY the overlay that owns the lock
  // (which patches its own state first), so nothing had to tell it. The celebration toast is
  // driven from PREFERENCES as well — "Move it" is in the main window — and a toast overlay
  // that never heard about the change would keep rendering as though it were still locked.
  ipcMain.on(IPC.overlaySetLocked, (_e, kind: OverlayKind, locked: boolean) => {
    const next = setOverlayConfig(kind, { locked })
    applyOverlayLocked(kind, locked)
    getOverlayWindow(kind)?.webContents.send(IPC.onOverlayConfig, { kind, config: next })
  })
  // Fine-grained pass-through toggle: the meters' hover sensor (locked mode), and the toast
  // overlay's queue transitions (empty ⇒ pass everything through; a card on screen ⇒ capture).
  // Whether mouse-move is FORWARDED is decided per kind in windows.ts, in one place.
  ipcMain.on(IPC.overlaySetIgnoreMouse, (_e, kind: OverlayKind, ignore: boolean) => {
    setOverlayIgnoreMouse(kind, ignore)
  })
  ipcMain.on(IPC.overlayClose, (_e, kind: OverlayKind) => setOverlayOpen(kind, false))

  // ---- global fight selection (docs/plans/combat-overlay-parity.md P4) ----
  // A read for a surface that mounted after the last change, and a fire-and-forget write that
  // fans out to every window. The write's argument is renderer input and is shape-checked inside
  // `setFightSelection` (shared/fightSelection.ts) — a zone-session id or a hand-crafted string
  // is dropped there, never broadcast. Nothing here can move a surface's Fight/Overall SCOPE.
  ipcMain.handle(IPC.fightSelectionGet, () => getFightSelection())
  ipcMain.on(IPC.fightSelectionSet, (_e, id: unknown) => {
    setFightSelection(id)
  })

  // Fire-and-forget renderer error reports (window.onerror / unhandledrejection /
  // React ErrorBoundary). `ipcMain.on` (not handle) matches the preload's `send`.
  ipcMain.on(IPC.reportError, (_e, report: { message: string; stack?: string; source: string }) => {
    const source = report?.source ? `renderer:${report.source}` : 'renderer:report'
    logError(source, { message: report?.message, stack: report?.stack })
  })
}
