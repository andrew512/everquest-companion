/**
 * appWindow.mts — THE APP UNDER TEST: which window is it, and a userData dir to start it from.
 *
 * Two helpers, their own file, because appHarness.mts is at the repo's 400-code-line factoring
 * ceiling and the answer to that is a split, not a widened threshold (the storeMigrations tests'
 * precedent). Both exist for the same reason: the app now opens a SECOND window at startup.
 *
 * WHY IT EXISTS (2026-08-05). `app.firstWindow()` resolves to whichever window Playwright
 * happened to attach to first, and for as long as this harness has existed that was trivially the
 * app: nothing else was open at startup. Then the celebration toast began defaulting to ON, so a
 * fresh launch creates a SECOND window — the transparent toast strip — moments after the first,
 * and the race is real. Specs began failing in a rotating cast of four or five per run, every one
 * of them with the same artifact DOM: `<div id="overlay-root"><div data-testid="toast-overlay">`.
 * Nothing was wrong with the app; the harness was asserting against the wrong window.
 *
 * The fix is to IDENTIFY the window instead of counting on ordering, and to identify it
 * POSITIVELY. `window.eq` is the main window's bridge alone — the overlays get `eqOverlay`, the
 * cursor ring `eqCursor`; three preloads, three worlds — so a page that answers to
 * `eq.getCombatSnapshot` is the app and nothing else can be. Polling covers the other half of the
 * race: at the instant a window appears its preload may not have run yet.
 */

import { rmSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright-core'
import { USER_DATA, sleep } from './appHarness.mjs'

/** The MAIN application window. Never `app.firstWindow()` — see the header. */
export async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  // Still wait on firstWindow first: it is the cheapest "the app started at all" signal, and its
  // timeout is the one that reports a launch failure honestly.
  await app.firstWindow({ timeout: timeoutMs })
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    for (const w of app.windows()) {
      const isMain = await w
        .evaluate(
          () =>
            typeof (window as unknown as { eq?: { getCombatSnapshot?: unknown } }).eq
              ?.getCombatSnapshot === 'function'
        )
        // A window mid-navigation throws on evaluate; it is simply not the answer yet.
        .catch(() => false)
      if (isMain) return w
    }
    await sleep(200)
  }
  throw new Error('e2e: the MAIN window never appeared (no page exposes window.eq)')
}

/**
 * Wipe the throwaway `userData` so this spec starts from a FRESH INSTALL — with retries.
 *
 * A bare `rmSync` is what every spec used to do, and on Windows it is a race the suite started
 * losing once the app began opening two windows: `app.close()` resolves when Electron says the
 * app is gone, but the OS releases the handles a beat later, and a second window is a second set
 * of handles. The next spec's wipe then throws EPERM before it has launched anything — and,
 * because that spec's own Electron is left running, the spec AFTER it fails the same way. One
 * slow teardown was taking three specs down with it.
 *
 * So the wipe waits instead of failing: a handful of short retries costs nothing when the dir is
 * already free, and the failure it prevents is not a bug in anything it is testing. A dir that is
 * still locked after all of them is a real problem and still throws.
 */
export async function freshUserData(attempts = 12, waitMs = 400): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      rmSync(USER_DATA, { recursive: true, force: true })
      return
    } catch (err) {
      if (i >= attempts) throw err
      await sleep(waitMs)
    }
  }
}
