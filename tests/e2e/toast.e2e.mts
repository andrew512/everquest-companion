/**
 * Headless Electron smoke test for CELEBRATION TOASTS (docs/plans/celebration-toasts.md).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The pure halves are pinned elsewhere — the payload validator
 * and the item card's formatting in tests/toastPayload.test.mts, the queue/hover timing in
 * tests/toastQueue.test.mts, the top-centre geometry in tests/overlayLayout.test.mts. What no
 * unit test can claim is that the PIECES ARE WIRED: that a fresh install spawns the sixth overlay
 * window on its own (the toast defaults ON since 2026-08-05), that Preferences shows that state
 * rather than a second opinion of it, that a payload sent over the REAL `toast:show` channel
 * crosses main (validation, item resolution, fan-out) and lands in that window's DOM as a card,
 * and that a refused payload lands nowhere.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`, so the toast window here is created, loaded and
 * driven entirely off-screen while the user plays. That is also why this spec drives the app's
 * own bridge rather than clicking a card: a hidden, always-on-top window has no pointer.
 *
 * IT ASSERTS THE DOM, NEVER THE ANIMATION. The card's enter/exit is a CSS transition on
 * transform/opacity; what is checked here is that the card, its title and — for a Sky
 * completion — its reward block with the item's name are actually rendered.
 *
 * Run: `npm run test:e2e` (or `node --import tsx tests/e2e/toast.e2e.mts`).
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import {
  MAIN_ENTRY,
  ROOT,
  USER_DATA,
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  electronBinary,
  failures,
  note,
  reportRun,
  sleep
} from './appHarness.mjs'
import { freshUserData, mainWindow } from './appWindow.mjs'

/** A Sky reward that exists in the committed item DB, so the card resolves with NO network. */
const REWARD = 'Shining Metallic Robes'

/** The toast overlay's page, identified by the `?kind=` query its window was opened with. */
async function findToastWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=toast')) return w
  }
  return null
}

/** Poll until the toast window exists (window creation + page load is asynchronous). */
async function waitForToastWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const w = await findToastWindow(app)
    if (w) return w
    await sleep(400)
  }
  return null
}

/** Send one toast request over the REAL renderer→main channel, exactly as a detector would. */
function send(page: Page, req: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (r) => (window as unknown as { eq: { showToast: (x: unknown) => void } }).eq.showToast(r),
    req
  )
}

/** Every rendered card's text, in stack order. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map(
      (el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/**
 * The switch lives in Preferences → Overlays. It is ON out of the box now (owner, 2026-08-05),
 * so this step asserts the panel AGREES with the window rather than turning anything on — and
 * that the sound controls, which the Alerts module already owns, are gone from it.
 */
async function stepPreferences(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-overlays"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-overlays"]')
  await page.waitForSelector('[data-testid="pref-toast"]', { timeout: 15_000 })
  if (!check('Preferences → Overlays offers the celebration toast', (await countOf(page, '[data-testid="pref-toast"]')) === 1)) {
    return
  }
  // The switch's testid sits on the MUI root, so the checkbox is the input inside it (the
  // telemetry pane's precedent).
  const on = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLInputElement | null)?.checked,
    '[data-testid="pref-toast-enabled"] input'
  )
  check('…with its switch already ON, matching the window that opened itself', on === true, String(on))
  check(
    '…and NO sound controls (the boss/quest alerts own that audio)',
    (await countOf(page, '[data-testid="pref-toast-sound"]')) === 0 &&
      (await countOf(page, '[data-testid="pref-toast-pack"]')) === 0
  )
}

/** A boss kill: a gold title line and nothing else — no reward, no click target. */
async function stepBossToast(main: Page, toast: Page): Promise<void> {
  await send(main, {
    id: 'e2e-boss-1',
    kind: 'bossKill',
    title: 'Lord Nagafen defeated',
    subtitle: 'D2 · Adaptive · Nagafen’s Lair',
    // A long hold on purpose: the later steps assert that a second card STACKS under this one,
    // and a 6 s default would make that a race against the machine rather than a claim about
    // the queue. The payload's own duration is honoured (and capped) by the validator.
    durationMs: 25_000
  })
  await sleep(1000)
  const cards = await cardTexts(toast)
  if (!check('a boss kill sent over `toast:show` renders a card in the toast window', cards.length === 1, `${cards.length} card(s)`)) {
    return
  }
  check('…carrying the kill’s own title', cards[0].includes('Lord Nagafen defeated'), cards[0])
  check('…and its tier/zone subtitle', cards[0].includes('D2'), cards[0])
}

/** A refused payload must reach no window at all — the validator is main's, not the overlay's. */
async function stepRefusal(main: Page, toast: Page): Promise<void> {
  const before = (await cardTexts(toast)).length
  await send(main, { id: 'e2e-bogus', kind: 'somethingElse', title: 'should never render' })
  await send(main, { kind: 'bossKill', title: 'no id either' })
  await sleep(800)
  const after = await cardTexts(toast)
  check(
    'a payload with an unknown kind (or no id) renders NOTHING — main refuses it',
    after.length === before,
    `${after.length} card(s): ${after.join(' | ')}`
  )
}

/** A Sky completion: the title, plus the reward item card MAIN resolved and embedded. */
async function stepQuestToast(main: Page, toast: Page): Promise<void> {
  await send(main, {
    id: 'e2e-quest-1',
    kind: 'skyQuestComplete',
    title: 'Quest complete: Test of Sacrifice',
    subtitle: 'Paladin',
    itemName: REWARD,
    focus: { view: 'posky' },
    durationMs: 25_000
  })
  // Item resolution is local-first (the committed items DB), but give main a beat regardless.
  await sleep(1500)
  const cards = await cardTexts(toast)
  const quest = cards.find((c) => c.includes('Quest complete'))
  if (!check('a Sky completion renders its own card', !!quest, cards.join(' | ') || 'no cards')) return
  check('…titled with the quest', (quest ?? '').includes('Test of Sacrifice'), quest ?? '')
  check(
    '…and embedding the reward item RESOLVED IN MAIN (the overlay fetches nothing)',
    (quest ?? '').includes(REWARD),
    quest ?? ''
  )
  const stacked = cards.length
  check('…stacked under the boss card rather than replacing it', stacked === 2, `${stacked} card(s)`)
}

async function main(): Promise<void> {
  buildIfStale()
  await freshUserData()

  console.log('launch: hidden Electron (EQ_E2E=1) — celebration toasts spec…')
  const app: ElectronApplication = await electron.launch({
    executablePath: electronBinary(),
    args: [MAIN_ENTRY],
    cwd: ROOT,
    env: { ...process.env, EQ_E2E: '1', EQ_E2E_USER_DATA: USER_DATA, NODE_ENV: 'production' },
    timeout: 60_000
  })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })

    // ON OUT OF THE BOX (owner, 2026-08-05: "it should be on by default"). A fresh install has
    // no stored `overlays.toast`, so the DEFAULT decides — and the window is the feature, so the
    // proof is that it exists before anybody has touched a setting.
    const toast = await waitForToastWindow(app)
    if (check('the toast overlay is ON for a fresh install (hidden, under EQ_E2E)', toast !== null)) {
      const t = toast as Page
      check('…which renders nothing at rest', (await countOf(t, '[data-testid="toast-card"]')) === 0)
      await stepPreferences(page)
      await stepBossToast(page, t)
      await stepRefusal(page, t)
      await stepQuestToast(page, t)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'toast-FAIL')
  } finally {
    await app.close().catch(() => undefined)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the toast spec did not complete')
  process.exitCode = 1
})
