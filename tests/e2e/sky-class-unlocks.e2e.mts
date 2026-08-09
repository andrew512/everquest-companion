/**
 * Headless Electron integration test for THE CLASSES TAB (JOS-148) — Sky class-unlock progress,
 * closest to done first, star to pin.
 *
 * WHY THIS NEEDS A REAL APP. The arithmetic and the ordering are unit-tested against the real pure
 * code (tests/skyClassUnlocks.test.mts). What no unit test can see is the CHAIN, and this tab has
 * TWO of them meeting on one row: a turn-in travelling chokidar to Tailer to parseEvent to the
 * turnins module to IPC to the renderer's JOS-131 ledger, and an achievement line travelling the
 * same road through a MODULE THAT DID NOT EXIST BEFORE THIS TICKET. JOS-87 is the standing
 * reminder that a chain like that breaks at seams every unit test is happy with, and a brand new
 * module's snapshot/delta wiring is exactly such a seam.
 *
 * THE HEADLINE ASSERTION is the one the research earned (posted to JOS-148 before this was
 * written): appending ONE achievement line flips a class to unlocked WITHOUT its turn-in count
 * moving at all. That is the owner's real Paladin — unlocked at level 11, 2 of 4 tests handed in —
 * and a derived-only tab would have called it locked forever.
 *
 * EVERY LINE SHAPE IS COPIED FROM THE OWNER'S REAL LOG, never invented (the awaiting-sample law):
 *   `You have completed achievement: Primary Class Unlock - Paladin`   (verbatim, real line 198310)
 *   `--You have looted an Azarack Skin from Protector of Sky's corpse.--`   (verbatim)
 *   `--You have looted a Wind Rune Heda from an azarack's corpse.--`        (both halves observed)
 *   `You offered 1 <Item> to <NPC>.` / `You complete the trade with <NPC>.` (shapes verbatim)
 * The quest driven here is Beastlord Test of Azarack, for the same reason sky-turnin.e2e.mts uses
 * it: it is the only quest in the committed data whose giver is Animist Kratho and whose item list
 * is exactly those two, so one trade matches one quest.
 *
 * NUMBERS ARE RELATIVE, NEVER FROZEN. The fixture's own history decides how many tests each class
 * starts with turned in, and the committed Sky data can gain a quest — so every assertion here is
 * a DELTA against what the tab read a moment ago, or a property (order, source) that holds at any
 * count. The one absolute is Paladin's total of 4, which is the wiki's count and the scrape's.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- sky-class-unlocks`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const TAB_CLASSES = '[data-testid="posky-tab-classes"]'
const PANE = '[data-testid="posky-classes"]'
const NOTE = '[data-testid="class-unlock-note"]'
const ROW = '[data-testid^="class-unlock-row-"]'
const rowOf = (cls: string): string => `[data-testid="class-unlock-row-${cls}"]`

/** The class whose unlock is OBSERVED here, and the verbatim line that states it. */
const UNLOCK_LINE = 'You have completed achievement: Primary Class Unlock - Paladin'
/** Paladin has four tests in the committed data, and the wiki agrees (research, JOS-148). */
const PALADIN_TOTAL = 4

/** The Beastlord quest whose turn-in must move the Beastlord row, and the lines that do it. */
const GIVER = 'Animist Kratho'
const ITEMS = ['Azarack Skin', 'Wind Rune Heda'] as const
const LOOT = [
  `--You have looted an ${ITEMS[0]} from Protector of Sky's corpse.--`,
  `--You have looted a ${ITEMS[1]} from an azarack's corpse.--`
]
const TURN_IN = [
  ...ITEMS.map((i) => `You offered 1 ${i} to ${GIVER}.`),
  `You complete the trade with ${GIVER}.`
]

/**
 * A row's `N of M`, off the row's own data attributes. `null` until the row is on screen.
 *
 * NOT off the sentence: the first run of this spec parsed "0 of 44 tests left" as `0 of 44`,
 * because the total and the tests-left count sit adjacent in the rendered text with nothing a
 * regex can anchor on. The attributes carry the same values the sentence is built from.
 */
function progressOf(page: Page, cls: string): Promise<[number, number] | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const turned = el.getAttribute('data-turned-in')
    const total = el.getAttribute('data-total')
    if (turned === null || total === null) return null
    return [Number(turned), Number(total)] as [number, number]
  }, rowOf(cls))
}

/** A row's unlock source: 'observed', 'derived', or '' when it is not unlocked at all. */
function sourceOf(page: Page, cls: string): Promise<string | null> {
  return page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute('data-source') ?? null,
    rowOf(cls)
  )
}

/** A row's whole text, for the unlock-state assertions. Empty when it is not mounted. */
function rowText(page: Page, cls: string): Promise<string> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', rowOf(cls))
}

/** The class names in the order they are drawn. The order IS the feature, so it is read directly. */
function rowOrder(page: Page): Promise<string[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('class-unlock-row-', '')
    )
  , ROW)
}

/** Click a row's star. It is the row's first button, and the only one on it. */
async function star(page: Page, cls: string): Promise<void> {
  await page.click(`${rowOf(cls)} button`, { timeout: 15_000 })
}

/** Open the Sky tab, then the Classes tab, and wait for the pane. */
async function openClasses(page: Page): Promise<boolean> {
  await page.click(NAV_SKY, { timeout: 30_000 })
  await page.waitForSelector(TAB_CLASSES, { timeout: 60_000 })
  await page.click(TAB_CLASSES, { timeout: 15_000 })
  const shown = await page.waitForSelector(PANE, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('the Classes tab opens onto its own pane', shown)
}

/** Every class in the committed data gets a row, and the tab says where its answers come from. */
async function stepRows(page: Page): Promise<void> {
  const rows = await settle(() => countOf(page, ROW), (n) => n > 0, { timeoutMs: 30_000 })
  // 16 is what the committed scrape holds and what EQ has; a floor rather than an equality so a
  // future class cannot turn this red for being new.
  check('every class in the Sky data gets a row', rows >= 16, `rows=${String(rows)}`)
  const note = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', NOTE)
  check(
    'the tab states the ordering, the star, and where each unlock reading came from',
    note.includes('Fewest tests left first') &&
      note.includes('Star a class') &&
      note.includes('unlocked by a line in your log') &&
      note.includes('read from a complete set of turn-ins'),
    note.slice(0, 240)
  )
  check(
    '…and it says outright that a turn-in never claims an unlock by itself',
    note.includes('prints nothing about unlocking'),
    note.slice(0, 240)
  )
}

/** Fewest remaining first, read off the rows themselves rather than from the model. */
async function stepOrder(page: Page): Promise<void> {
  const remaining = await page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => Number(el.getAttribute('data-remaining')))
  , ROW)
  const ordered = remaining.every((n, i) => i === 0 || remaining[i - 1] <= n)
  check('CLOSEST TO DONE LEADS - the rows are ordered by tests remaining', ordered, remaining.join(','))
}

/**
 * THE HEADLINE: one achievement line, and the class is unlocked with its turn-in count untouched.
 *
 * Paladin is the owner's real case. Before the line, the row reads its turn-ins and nothing else;
 * after it, the row says the LOG said so, and `N of 4` has not moved a digit. Nothing but the
 * observed source can produce that state, which is the whole reason the source exists.
 */
async function stepObservedUnlock(page: Page, log: FixtureLog, at: Date): Promise<void> {
  const before = await settle(() => progressOf(page, 'paladin'), (v) => v !== null, { timeoutMs: 20_000 })
  if (!check('the Paladin row is on screen with its turn-in count', before !== null)) return
  check('…and the committed data gives Paladin four tests', before?.[1] === PALADIN_TOTAL, JSON.stringify(before))
  check('…and it does not yet claim the log unlocked it', (await sourceOf(page, 'paladin')) !== 'observed')

  log.appendAt(at, UNLOCK_LINE)
  const src = await settle(() => sourceOf(page, 'paladin'), (s) => s === 'observed', { timeoutMs: 30_000 })
  if (!check('ONE ACHIEVEMENT LINE UNLOCKS THE CLASS, LIVE', src === 'observed', `source=${String(src)}`)) return
  check(
    '…and the row says so in words rather than only in an attribute',
    (await rowText(page, 'paladin')).includes('the log said so'),
    (await rowText(page, 'paladin')).slice(0, 160)
  )
  const after = await progressOf(page, 'paladin')
  check(
    '…AND THE TURN-IN COUNT NEVER MOVED: the unlock was observed, not derived',
    after?.[0] === before?.[0] && after?.[1] === before?.[1],
    `${JSON.stringify(before)} then ${JSON.stringify(after)}`
  )
}

/** A turn-in still moves the count it belongs to: the two sources are independent. */
async function stepTurnInMovesCount(page: Page, log: FixtureLog, at: Date): Promise<void> {
  const before = await settle(() => progressOf(page, 'beastlord'), (v) => v !== null, { timeoutMs: 20_000 })
  if (!check('the Beastlord row is on screen', before !== null)) return
  log.appendAt(at, ...LOOT, ...TURN_IN)
  const after = await settle(
    () => progressOf(page, 'beastlord'),
    (v) => v !== null && v[0] > (before?.[0] ?? 0),
    { timeoutMs: 30_000 }
  )
  check(
    'A LIVE TURN-IN ADVANCES ITS CLASS COUNT - the derived half is wired too',
    after !== null && after[0] === (before?.[0] ?? 0) + 1,
    `${JSON.stringify(before)} then ${JSON.stringify(after)}`
  )
}

/**
 * The star pins, and JOS-146 says it may: this order's subject is a count of quests, a STANDING
 * property, not an event. So the pin composes rather than destroys.
 *
 * The class starred is whichever row is LAST — the furthest from done there is — so "it moved to
 * the top" cannot be a coincidence of the order it already had.
 */
async function stepPin(page: Page): Promise<void> {
  const order = await rowOrder(page)
  const furthest = order[order.length - 1]
  if (!check('there are rows to pin', order.length > 1, order.join(','))) return
  await star(page, furthest)
  const pinned = await settle(() => rowOrder(page), (o) => o[0] === furthest, { timeoutMs: 15_000 })
  check(
    'STARRING THE FURTHEST-FROM-DONE CLASS PINS IT TO THE TOP',
    pinned[0] === furthest,
    `${furthest} in ${pinned.slice(0, 4).join(',')}`
  )
  await star(page, furthest)
  const back = await settle(() => rowOrder(page), (o) => o[0] !== furthest, { timeoutMs: 15_000 })
  check('…and un-starring puts the closest-first order straight back', back[0] !== furthest, back.slice(0, 4).join(','))
}

async function main(): Promise<void> {
  buildIfStale()

  const log = stageFixture('e2e-copy.log')
  const now = Date.now()
  try {
    const launched = await launchOnFixture(log)
    let page: Page | null = null
    try {
      page = await mainWindow(launched.app)
      await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      if (!(await openClasses(page))) {
        throw new Error('never reached the Classes tab - nothing below can be asserted')
      }
      await stepRows(page)
      await stepOrder(page)
      await stepObservedUnlock(page, log, new Date(now - 120_000))
      await stepTurnInMovesCount(page, log, new Date(now - 60_000))
      await stepOrder(page)
      await stepPin(page)
      if (failures.length) await dumpArtifacts(page, 'sky-class-unlocks-FAIL')
    } finally {
      await launched.close()
    }
  } finally {
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
