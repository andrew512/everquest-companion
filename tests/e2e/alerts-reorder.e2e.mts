/**
 * Headless Electron spec for JOS-175 — THE ALERTS LIST KEEPS THE ORDER YOU PUT IT IN.
 *
 * WHAT A PLAYER ASKED FOR (0.16.0 report): reorder alerts by dragging. The owner's ruling on
 * 2026-08-09 took the folders half of that ask off the table; this is the reorder half, whole.
 *
 * WHY IT IS AN E2E SPEC AND NOT A UNIT TEST. `tests/alertReorder.test.mts` pins the ordering
 * RULES and the JSON round trip they rest on, which is everything that can be seen without an
 * app. It cannot see the two things the ticket is actually about:
 *
 *   1. THE ORDER ON SCREEN IS THE ORDER IN THE STORE. Three parts have to agree — the row the
 *      gesture moved, the array main wrote, and the list the view re-renders from main's answer —
 *      and each one is on the far side of an IPC round trip from the last.
 *   2. IT SURVIVES A RESTART. The app is QUIT here and relaunched on the SAME userData dir (the
 *      telemetry/overlay-sync pattern), so the second launch reads the order off disk exactly the
 *      way tomorrow's session will. Nothing about that is observable in one process.
 *
 * HOW THE GESTURE IS DRIVEN, honestly. The grip is a drag source AND a button that takes
 * ArrowUp/ArrowDown (useAlertReorder.ts) — the keyboard path exists because a list you can only
 * reorder by dragging is a list some people cannot reorder at all, and it is also the path a
 * headless window can drive as a CONDITION rather than as a bet on a compositor that may never
 * composite. So the arrow keys move the row here, and the drag is exercised in the same run by
 * `page.dragAndDrop`, whose outcome is reported either way: a drag that Chromium declines to
 * synthesize in a hidden window is a note about the harness, never a silent pass and never a
 * failure charged to the app. Both paths end in the same call and the same stored array.
 *
 * Run: `npm run test:e2e -- alerts-reorder`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const ROW = '[data-testid="alert-row"]'
const GRIP = '[data-testid="alert-reorder-grip"]'

/** The ids of the alert rows, top to bottom, as the list is rendering them right now. */
function renderedOrder(page: Page): Promise<string[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-alert-id') ?? '?'), ROW)
}

/** The ids main has stored, in stored order — the answer that has to survive the restart. */
function storedOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { eq: { listAlerts: () => Promise<{ id: string }[]> } }).eq
      .listAlerts()
      .then((defs) => defs.map((d) => d.id))
  ) as Promise<string[]>
}

/** Open the Alerts tab and wait for the list to have rows. */
async function openAlerts(page: Page): Promise<string[]> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector(ROW, { timeout: 30_000 })
  return settle(() => renderedOrder(page), (ids) => ids.length > 0, { timeoutMs: 20_000 })
}

/** Wait for the rendered order to become `want` (the write is a round trip through main). */
function settleOrder(page: Page, want: string[]): Promise<string[]> {
  return settle(
    () => renderedOrder(page),
    (ids) => ids.join('>') === want.join('>'),
    { timeoutMs: 15_000 }
  )
}

/**
 * THE KEYBOARD PATH: focus one row's grip and nudge it one place down.
 *
 * Focused through the DOM rather than by tabbing to it — the row carries two Selects and five
 * icon buttons, so a tab count would be a layout assertion in disguise.
 */
async function nudgeDown(page: Page, id: string): Promise<void> {
  await page.focus(`[data-alert-id="${id}"] ${GRIP}`)
  await page.keyboard.press('ArrowDown')
}

/** The claim the whole feature rests on: what is on screen is what is stored. */
async function checkScreenMatchesStore(page: Page, tag: string): Promise<string[]> {
  const shown = await renderedOrder(page)
  const stored = await settle(
    () => storedOrder(page),
    (ids) => ids.join('>') === shown.join('>'),
    { timeoutMs: 10_000 }
  )
  check(
    `[${tag}] the order on screen is the order main has stored`,
    shown.join('>') === stored.join('>'),
    `screen ${shown.join(' > ')} · store ${stored.join(' > ')}`
  )
  return shown
}

/** Move the first row down one with the arrow keys, and prove the whole chain moved with it. */
async function checkKeyboardReorder(page: Page, before: string[]): Promise<string[]> {
  const want = [before[1], before[0], ...before.slice(2)]
  await nudgeDown(page, before[0])
  const after = await settleOrder(page, want)
  if (
    !check(
      'pressing the down arrow on a row’s grip moves it one place down the list',
      after.join('>') === want.join('>'),
      `was ${before.join(' > ')} · now ${after.join(' > ')} · wanted ${want.join(' > ')}`
    )
  ) {
    return after
  }
  check(
    'nothing is lost by a reorder — the same alerts, rearranged',
    [...after].sort().join('|') === [...before].sort().join('|'),
    `${String(before.length)} before, ${String(after.length)} after`
  )
  return checkScreenMatchesStore(page, 'after the keyboard nudge')
}

/**
 * THE DRAG PATH, exercised for real and reported honestly.
 *
 * `page.dragAndDrop` synthesizes the pointer sequence Chromium turns into HTML5 drag events. In a
 * window that is never shown it may decline to start a drag at all — which says something about
 * the harness, not about the app — so a drag that produces no movement is a NOTE. A drag that
 * moves the list to the WRONG place is still a failure.
 */
async function checkDragReorder(page: Page, before: string[]): Promise<string[]> {
  const moved = before[before.length - 1]
  const target = before[0]
  const want = [moved, ...before.filter((id) => id !== moved)]
  try {
    await page.dragAndDrop(`[data-alert-id="${moved}"] ${GRIP}`, `[data-alert-id="${target}"]`, {
      timeout: 10_000
    })
  } catch (err) {
    note(`the harness could not synthesize a drag in this window — ${String(err).slice(0, 90)}`)
    return before
  }
  const after = await settleOrder(page, want)
  if (after.join('>') === before.join('>')) {
    note('a synthesized drag started but moved nothing in this hidden window; the keyboard path above carries the assertion')
    return before
  }
  check(
    'dragging the bottom row onto the top row puts it at the top',
    after.join('>') === want.join('>'),
    `was ${before.join(' > ')} · now ${after.join(' > ')} · wanted ${want.join(' > ')}`
  )
  return checkScreenMatchesStore(page, 'after the drag')
}

/** THE TICKET'S ACCEPTANCE: quit, relaunch on the same userData, and read the order back. */
async function checkSurvivesRestart(
  log: FixtureLog,
  userData: string,
  want: string[]
): Promise<void> {
  const { app, close } = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(app)
    const after = await openAlerts(page)
    check(
      'the order you left the app in is the order it opens in',
      after.join('>') === want.join('>'),
      `left ${want.join(' > ')} · reopened ${after.join(' > ')}`
    )
    await checkScreenMatchesStore(page, 'after the restart')
    if (failures.length) await dumpArtifacts(page, 'alerts-reorder-restart-FAIL')
  } finally {
    await close()
  }
}

async function main(): Promise<void> {
  buildIfStale()

  // ONE staged install and ONE userData dir across BOTH launches — that pair is what makes the
  // second launch a restart of the same app rather than a fresh install with no order to keep.
  const log = stageFixture('e2e-voice.log')
  const userData = makeUserData()
  let left: string[] = []

  console.log('launch 1: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-voice.log…')
  const first = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    page = await mainWindow(first.app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    const start = await openAlerts(page)
    if (
      check(
        'the alerts list renders the seeded alerts, and a grip on every row',
        start.length >= 3 && (await page.$$(GRIP)).length === start.length,
        `${String(start.length)} rows: ${start.join(' > ')}`
      )
    ) {
      await checkScreenMatchesStore(page, 'at rest')
      const nudged = await checkKeyboardReorder(page, start)
      left = await checkDragReorder(page, nudged)
      check(
        'the list is genuinely in a different order than it started in',
        left.join('>') !== start.join('>'),
        `started ${start.join(' > ')} · left ${left.join(' > ')}`
      )
    }
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'alerts-reorder-FAIL')
  } finally {
    await first.close()
  }

  if (left.length > 0) {
    console.log('launch 2: the same userData dir, to read the order back off disk…')
    await checkSurvivesRestart(log, userData, left)
  } else {
    check('the first launch left an order to restart onto', false)
  }

  await removeUserData(userData)
  await log.dispose()
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
