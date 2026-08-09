/**
 * Headless Electron integration test for THE BOSSES TAB'S WEEK VIEW (JOS-152).
 *
 * TWO ASKS FROM ONE RAID COORDINATOR, and this spec is the half neither can be proved without a
 * real app:
 *
 *   1. (01KZM0T1YNREY466752BQZVFBR) "the Bosses view forgets which tab you were on." The
 *      unit-testable part of the fix is a `useState` initialiser reading localStorage, and a test
 *      of THAT would pass while the feature stayed broken, because the bug was never in the read.
 *      It is the LIFECYCLE: `App`'s `ViewContent` mounts exactly one feature view at a time, so
 *      leaving the tab destroys `BossView` and everything it was holding. Every assertion below
 *      is therefore bracketed by a NAVIGATION, and the trip out asserts the toolbar is GONE first
 *      - an unmount that never happened would make the rest of this spec a tautology. The
 *      sky-filters spec makes the same argument at length for the same reason.
 *
 *   2. (01KZM0WD1DWQAXBB6EA0BZHE4A) the per-difficulty ladder. What is asserted here is that the
 *      rungs EXIST, that there are five of them per card in base-first order, and that they
 *      belong to the WEEK view and to no other - i.e. that the derivation reaches the screen.
 *
 * WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT: which rungs are GREEN. "Cleared this week" is a
 * comparison against the real clock, and the committed e2e fixture's kills sit at fixed dates, so
 * any expected colour here would be true only until the next Tuesday 08:00 Pacific and would then
 * rot silently (AGENTS.md: frozen numbers rot). The colours are pinned where the clock is an
 * ARGUMENT rather than an ambient fact - tests/bossLockouts.test.mts replays the same fixtures at
 * three named instants either side of one reset. So the rung's `data-cleared` is read only to
 * prove every rung STATES an answer, never to say which.
 *
 * TWO LAUNCHES, ONE userData DIR. The tab round trip and the RESTART are different promises;
 * `makeUserData()` hands both launches the same dir, so launch 2 reads the localStorage launch 1
 * wrote through a real process exit.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- bosses-week` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settle,
  settleGone
} from './appHarness.mjs'
import { launchApp, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'

const NAV_BOSSES = '[data-testid="nav-bosses"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
/** The toggle group under test, and its two buttons. */
const MODE = '[data-testid="boss-mode"]'
const MODE_OVERALL = '[data-testid="boss-mode-overall"]'
const MODE_WEEK = '[data-testid="boss-mode-week"]'
/** The preference itself, as BossView stores it. Read back so the spec pins the KEY too: a
 *  rename that kept the round trip working would still break an existing user's saved choice. */
const KEY = 'eq.bosses.mode'
const CARD = '[data-testid="boss-card"]'
const LADDER = '[data-testid="boss-difficulty-ladder"]'

/** Which mode the toggle group is showing as selected. `null` when it is not mounted. */
function modeState(page: Page): Promise<string | null> {
  return page.evaluate((sel) => {
    const on = document.querySelector(`${sel} .Mui-selected`)
    return on?.getAttribute('data-testid')?.replace('boss-mode-', '') ?? null
  }, MODE)
}

/** What the renderer has actually stored, verbatim. `null` when the key was never written. */
function storedMode(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), KEY)
}

/** Every ladder's rung labels, one string per card, e.g. "D0,D1,D2,D3,D4". */
function ladderLabels(page: Page): Promise<string[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((row) =>
        [...row.children].map((n) => n.textContent ?? '').join(',')
      ),
    LADDER
  )
}

/** Every rung's `data-cleared` bit across the whole view. A rung with none would read ''. */
function rungAnswers(page: Page): Promise<string[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} > *`)].map((n) => n.getAttribute('data-cleared') ?? ''),
    LADDER
  )
}

/** Open the Bosses tab and wait for its toolbar. Safe when the tab is already the open one. */
async function openBosses(page: Page, timeoutMs = 60_000): Promise<boolean> {
  await page.click(NAV_BOSSES, { timeout: 30_000 })
  return page.waitForSelector(MODE, { timeout: timeoutMs }).then(
    () => true,
    () => false
  )
}

/**
 * Leave for another tab, and confirm the Bosses view is really gone. This is the step the bug
 * lived in: the assertion after it means nothing unless `BossView` was actually unmounted here.
 */
async function leaveBosses(page: Page): Promise<boolean> {
  await page.click(NAV_OVERVIEW, { timeout: 30_000 })
  return settleGone(page, MODE, { timeoutMs: 15_000 })
}

/** Away to the Overview and back to Bosses, with the unmount actually asserted in between. */
async function awayAndBack(page: Page): Promise<boolean> {
  if (!check('leaving the Bosses tab unmounts it (the mode toggle is gone)', await leaveBosses(page))) {
    return false
  }
  return check('…and the Bosses tab comes back', await openBosses(page))
}

/** Click a mode button and wait for the group to report the mode we asked for. */
async function setMode(page: Page, button: string, want: string): Promise<string | null> {
  await page.click(button, { timeout: 15_000 })
  return settle(() => modeState(page), (v) => v === want, { timeoutMs: 8_000 })
}

/** A fresh install opens on OVERALL - the key is absent, and absence is the default. */
async function stepDefault(page: Page): Promise<void> {
  check('a fresh install opens the Bosses tab on OVERALL', (await modeState(page)) === 'overall')
  check('…and has written no preference yet', (await storedMode(page)) === null)
  const cards = await settle(() => countOf(page, CARD), (n) => n > 0, { timeoutMs: 30_000 })
  check('…and the roster has cards on it', cards > 0, String(cards))
  check(
    'THE LADDER BELONGS TO THE WEEK VIEW - the overall roster draws none',
    (await countOf(page, LADDER)) === 0
  )
}

/** THE LADDER: five rungs a card, base first, on every card the week view draws. */
async function stepLadder(page: Page): Promise<void> {
  const cards = await countOf(page, CARD)
  const ladders = await settle(() => countOf(page, LADDER), (n) => n === cards, { timeoutMs: 15_000 })
  check(
    'EVERY WEEK-VIEW CARD CARRIES A LADDER, not only the ones with a lock',
    ladders === cards && cards > 0,
    `${String(ladders)} ladders / ${String(cards)} cards`
  )

  const labels = await ladderLabels(page)
  const wrong = labels.filter((row) => row !== 'D0,D1,D2,D3,D4')
  check(
    'EVERY LADDER IS THE FIVE DIFFICULTIES, BASE FIRST',
    labels.length > 0 && wrong.length === 0,
    wrong.length ? `first offender: ${wrong[0]}` : `${String(labels.length)} ladders`
  )

  // Not WHICH answer - see the header. Only that no rung is drawn without one, which is what
  // would happen if the derivation stopped reaching the component.
  const answers = await rungAnswers(page)
  const silent = answers.filter((a) => a !== '0' && a !== '1')
  check(
    'every rung states an answer (cleared or open), and none is drawn without one',
    answers.length === labels.length * 5 && silent.length === 0,
    `${String(answers.length)} rungs, ${String(silent.length)} silent`
  )
}

/** THE HEADLINE: pick This week, leave the tab, come back - it is still This week. */
async function stepWeekSticksAcrossTabs(page: Page): Promise<void> {
  const picked = await setMode(page, MODE_WEEK, 'week')
  if (!check('the This week button selects when clicked', picked === 'week', String(picked))) return
  const stored = await settle(() => storedMode(page), (v) => v === 'week', { timeoutMs: 8_000 })
  check(`the choice is stored under ${KEY}`, stored === 'week', `stored ${String(stored)}`)

  await stepLadder(page)

  if (!(await awayAndBack(page))) return
  const after = await settle(() => modeState(page), (v) => v !== null, { timeoutMs: 8_000 })
  check('THIS WEEK SURVIVES LEAVING AND RETURNING TO THE BOSSES TAB', after === 'week', String(after))
  const ladders = await settle(() => countOf(page, LADDER), (n) => n > 0, { timeoutMs: 15_000 })
  check('…and the ladders come back with it', ladders > 0, String(ladders))
}

/**
 * The other direction, and the reason this is a PREFERENCE rather than a latch: going BACK to
 * Overall has to survive the same round trip. An implementation that only ever remembered the
 * week (a write that skipped the default) would pass the step above and strand a user who
 * changed their mind on the far side of one tab switch.
 */
async function stepOverallSticksToo(page: Page): Promise<void> {
  const picked = await setMode(page, MODE_OVERALL, 'overall')
  if (!check('the Overall button selects again', picked === 'overall', String(picked))) return
  const stored = await settle(() => storedMode(page), (v) => v === 'overall', { timeoutMs: 8_000 })
  check('…and OVERALL is stored too, not merely un-remembered', stored === 'overall', String(stored))

  if (!(await awayAndBack(page))) return
  const after = await settle(() => modeState(page), (v) => v !== null, { timeoutMs: 8_000 })
  check('…so the tab comes back on OVERALL, the way it was left', after === 'overall', String(after))
  check('…with no ladder on it', (await countOf(page, LADDER)) === 0)
}

/** Leave it on This week for launch 2. */
async function stepArmRestart(page: Page): Promise<void> {
  const picked = await setMode(page, MODE_WEEK, 'week')
  check('the tab is left on This week for the restart check', picked === 'week', String(picked))
}

/** THE RESTART: a second process, the same userData dir, the same tab. */
async function stepSurvivesRestart(page: Page): Promise<void> {
  if (!check('the Bosses tab opens after a restart', await openBosses(page))) return
  const after = await settle(() => modeState(page), (v) => v !== null, { timeoutMs: 8_000 })
  check('THIS WEEK SURVIVES A FULL RESTART', after === 'week', String(after))
  check('…and the stored choice crossed the process boundary intact', (await storedMode(page)) === 'week')
  const ladders = await settle(() => countOf(page, LADDER), (n) => n > 0, { timeoutMs: 30_000 })
  check('…and the difficulty ladders are drawn on the tab it opened on', ladders > 0, String(ladders))
}

async function main(): Promise<void> {
  buildIfStale()

  // OWNED BY THIS SPEC, not by either launch: the restart assertion IS the dir outliving a
  // process, so `launchApp` must not delete what it did not create.
  const userData = makeUserData()
  try {
    console.log('launch 1: a fresh install - the default, the ladder, and both round trips…')
    const first = await launchApp({ userData })
    let page: Page | null = null
    try {
      page = await mainWindow(first.app)
      await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      if (!check('the Bosses tab opens', await openBosses(page))) {
        throw new Error('never reached the Bosses tab - nothing below can be asserted')
      }
      await stepDefault(page)
      await stepWeekSticksAcrossTabs(page)
      await stepOverallSticksToo(page)
      await stepArmRestart(page)
      if (failures.length) await dumpArtifacts(page, 'bosses-week-FAIL')
    } finally {
      await first.close()
    }

    console.log('launch 2: the SAME userData dir, a new process - This week must still be there…')
    const second = await launchApp({ userData })
    let restarted: Page | null = null
    try {
      restarted = await mainWindow(second.app)
      await restarted.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      await stepSurvivesRestart(restarted)
      if (failures.length) await dumpArtifacts(restarted, 'bosses-week-restart-FAIL')
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
