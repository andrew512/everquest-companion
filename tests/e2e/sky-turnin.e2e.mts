/**
 * Headless Electron integration test for THE SKY TURN-IN, END TO END (JOS-131).
 *
 * THE ASK, in the owner's words (2026-08-09): a Sky farmer wants to run quests more than once, and
 * today a completed quest stays 5/5 forever, so refarming a second copy is invisible. A turn-in
 * should SUBTRACT the turned-in items from the inventory model rather than pin the quest at
 * complete; a badge shows that you turned it in and how many times; multiple turn-ins work by
 * default.
 *
 * WHY THIS NEEDS A REAL APP. The arithmetic is unit-tested against the real pure code
 * (tests/questTurnIns.test.mts). What no unit test can see is the CHAIN: a trade line in the log
 * travelling chokidar → Tailer → parseEvent → the turnins module → IPC → the renderer's ledger →
 * a write back into electron-store → the progress push → the row on screen. JOS-87 is this repo's
 * standing reminder that a chain like that can break at a seam every unit test is happy with. So
 * every assertion below is driven by APPENDING LINES to the log the app is tailing, and read off
 * the quest row a user would be looking at.
 *
 * EVERY LINE SHAPE IS COPIED FROM THE OWNER'S REAL LOG, never invented (the awaiting-sample law):
 *   `--You have looted an Azarack Skin from Protector of Sky's corpse.--`   (verbatim)
 *   `--You have looted a Wind Rune Heda from an azarack's corpse.--`        (both halves observed)
 *   `You offered 1 <Item> to <NPC>.`                                        (shape verbatim)
 *   `You complete the trade with <NPC>.`                                    (shape verbatim)
 * The quest is Beastlord Test of Azarack because it is the only quest in the committed data whose
 * giver is Animist Kratho and whose whole item list is those two — so the trade below matches one
 * quest and exactly one.
 *
 * THE SECOND TURN-IN IS STAMPED A MINUTE AFTER THE FIRST, deliberately: EQ timestamps are
 * second-resolution and the ledger merges turn-ins by INSTANT, so two handed in inside one second
 * are one event by design (shared/questTurnIns.ts states that limit). It also hands in nothing it
 * looted a second time, which the app is right to trust: the log said the trade completed.
 *
 * TWO LAUNCHES, AND THE SECOND ONE TAILS A FRESH LOG. That is the point of it — the store, not the
 * log, has to remember. Launch 2 gets the SAME userData dir and a NEWLY STAGED fixture with none
 * of launch 1's appended lines, which is the truncated-log / character-epoch case the persistence
 * exists for. A second launch on the same log would have re-derived the count and proved nothing.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- sky-turnin`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const SEARCH = '[data-testid="posky-search"]'
const HIDE_COMPLETED = '[data-testid="posky-hide-completed"]'
const BADGE = '[data-testid="posky-turned-in"]'
const ROW = '.MuiAccordion-root'
const COUNTS = '[data-testid="posky-counts"]'

/** The quest under test, and the two lines that put its items in your bags. */
const QUEST = 'Beastlord Test of Azarack'
const GIVER = 'Animist Kratho'
const ITEMS = ['Azarack Skin', 'Wind Rune Heda'] as const
const LOOT = [
  `--You have looted an ${ITEMS[0]} from Protector of Sky's corpse.--`,
  `--You have looted a ${ITEMS[1]} from an azarack's corpse.--`
]
/** One completed trade: an offer per item, then the line that closes the group. */
const TURN_IN = [...ITEMS.map((i) => `You offered 1 ${i} to ${GIVER}.`), `You complete the trade with ${GIVER}.`]

/** How many turn-ins the badge claims. `null` when there is no badge — never confused with 0. */
function badgeCount(page: Page): Promise<number | null> {
  return page.evaluate((sel) => {
    const n = document.querySelector(sel)?.getAttribute('data-count')
    return n === null || n === undefined ? null : Number(n)
  }, BADGE)
}

/** The badge's words, as the user reads them. Empty when it is not there. */
function badgeLabel(page: Page): Promise<string> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', BADGE)
}

/** "have/need" off the quest row's own progress caption. `null` until the row exists. */
function itemsHeld(page: Page): Promise<string | null> {
  return page.evaluate((sel) => {
    const text = document.querySelector(sel)?.textContent ?? ''
    const m = /(\d+)\/(\d+) items/.exec(text)
    return m ? `${m[1]}/${m[2]}` : null
  }, ROW)
}

/** How many quests the filters leave, off the counts line. `null` when it is not mounted. */
function filteredCount(page: Page): Promise<number | null> {
  return page.evaluate((sel) => {
    const m = /(\d+) of (\d+) quests/.exec(document.querySelector(sel)?.textContent ?? '')
    return m ? Number(m[1]) : null
  }, COUNTS)
}

/** Open the Sky tab and narrow the list to the one quest this spec is about. */
async function openQuest(page: Page): Promise<boolean> {
  await page.click(NAV_SKY, { timeout: 30_000 })
  const shown = await page.waitForSelector(SEARCH, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!shown) return false
  await page.fill(`${SEARCH} input`, QUEST)
  const only = await settle(() => filteredCount(page), (n) => n === 1, { timeoutMs: 15_000 })
  return check(`the search narrows the tab to ${QUEST} alone`, only === 1, `filtered=${String(only)}`)
}

/** A fresh install has never handed this in: no badge, nothing held, and the mobs still to kill. */
async function stepBefore(page: Page): Promise<void> {
  check('a quest never turned in shows NO badge', (await countOf(page, BADGE)) === 0)
  const held = await settle(() => itemsHeld(page), (v) => v !== null, { timeoutMs: 15_000 })
  check('…and reads 0 of the 2 items it needs', held === '0/2', `held=${String(held)}`)
}

/** Loot both items, live, and watch the row fill up. */
async function stepLoot(page: Page, log: FixtureLog, at: Date): Promise<void> {
  log.appendAt(at, ...LOOT)
  const held = await settle(() => itemsHeld(page), (v) => v === '2/2', { timeoutMs: 30_000 })
  if (!check('looting both items live fills the quest to 2/2', held === '2/2', `held=${String(held)}`)) return
  check(
    '…and the row says it is ready to hand in',
    (await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', ROW)).includes(
      'Ready to turn in'
    )
  )
}

/**
 * THE HEADLINE: hand it in, and the items are SPENT. The badge appears, the bar goes back to 0/2,
 * and the quest is farmable again — which before JOS-131 was a row pinned at 2/2 forever.
 */
async function stepTurnIn(page: Page, log: FixtureLog, at: Date): Promise<void> {
  log.appendAt(at, ...TURN_IN)
  const count = await settle(() => badgeCount(page), (n) => n === 1, { timeoutMs: 30_000 })
  if (!check('a turn-in in the log puts a badge on the quest', count === 1, `count=${String(count)}`)) return
  check('…reading "Turned in"', (await badgeLabel(page)) === 'Turned in')
  const held = await settle(() => itemsHeld(page), (v) => v === '0/2', { timeoutMs: 15_000 })
  check(
    'THE TURN-IN SUBTRACTS WHAT IT CONSUMED — the quest is back at 0/2 and can be farmed again',
    held === '0/2',
    `held=${String(held)}`
  )
}

/**
 * The filter's decided meaning (JOS-131, argued in features/posky/questCompletion.ts), asserted
 * where it is visible: "hide completed" hides the quest you hold every item for, and NOT the one
 * you have handed in and are now refarming. Read AFTER the turn-in, so the row on screen is a
 * quest that has been turned in once and holds nothing.
 */
async function stepHideCompleted(page: Page): Promise<void> {
  await page.click(HIDE_COMPLETED, { timeout: 15_000 })
  const still = await settle(() => filteredCount(page), (n) => n !== null, { timeoutMs: 8_000 })
  check(
    'HIDE COMPLETED KEEPS A TURNED-IN QUEST YOU ARE REFARMING — it is work left, not work done',
    still === 1,
    `filtered=${String(still)}`
  )
  check('…and its badge is still there beside it', (await badgeCount(page)) === 1)
  // Leave it as it was found: this box is a stored preference (JOS-90) and launch 2 reads it.
  await page.click(HIDE_COMPLETED, { timeout: 15_000 })
  await settle(() => filteredCount(page), (n) => n === 1, { timeoutMs: 8_000 })
}

/** Multiple turn-ins are the default: hand it in again, and the badge counts. */
async function stepAgain(page: Page, log: FixtureLog, at: Date): Promise<void> {
  log.appendAt(at, ...TURN_IN)
  const count = await settle(() => badgeCount(page), (n) => n === 2, { timeoutMs: 30_000 })
  if (!check('A SECOND TURN-IN COUNTS ITSELF', count === 2, `count=${String(count)}`)) return
  check('…and the badge says so in words', (await badgeLabel(page)) === 'Turned in x2', await badgeLabel(page))
}

/** THE STORE, not the log: a fresh log with none of those lines, and the count is still 2. */
async function stepRemembered(page: Page): Promise<void> {
  if (!(await openQuest(page))) return
  const count = await settle(() => badgeCount(page), (n) => n !== null, { timeoutMs: 30_000 })
  check(
    'THE TURN-INS SURVIVE A RESTART ON A LOG THAT NO LONGER SHOWS THEM',
    count === 2,
    `count=${String(count)}`
  )
}

async function main(): Promise<void> {
  buildIfStale()

  // Owned by this spec: the restart assertion IS the dir outliving a process.
  const userData = makeUserData()
  const log = stageFixture('e2e-copy.log')
  const now = Date.now()
  try {
    console.log('launch 1: loot the items, hand them in twice, and watch the row…')
    const first = await launchOnFixture(log, { userData })
    let page: Page | null = null
    try {
      page = await mainWindow(first.app)
      await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      if (!(await openQuest(page))) {
        throw new Error('never reached the quest row — nothing below can be asserted')
      }
      await stepBefore(page)
      await stepLoot(page, log, new Date(now - 120_000))
      await stepTurnIn(page, log, new Date(now - 60_000))
      await stepHideCompleted(page)
      await stepAgain(page, log, new Date(now))
      if (failures.length) await dumpArtifacts(page, 'sky-turnin-FAIL')
    } finally {
      await first.close()
    }

    console.log('launch 2: the SAME store, a FRESH log — the count must come from the store…')
    const second = await launchOnFixture('e2e-copy.log', { userData })
    let restarted: Page | null = null
    try {
      restarted = await mainWindow(second.app)
      await restarted.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      await stepRemembered(restarted)
      if (failures.length) await dumpArtifacts(restarted, 'sky-turnin-restart-FAIL')
    } finally {
      await second.close()
    }
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
