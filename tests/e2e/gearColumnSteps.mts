/**
 * The Gear tab's COLUMN PICKER, its configurable filter bar, and the width law that holds when a
 * chosen set is wider than the pane (JOS-297). A module rather than more of `gear.e2e.mts`, the
 * `gearSetSteps.mts` precedent: everything these steps need is already standing in the host spec,
 * and that file is at the repo's 400-code-line factoring ceiling.
 *
 * WHAT NEEDS A REAL APP HERE, given `tests/gearColumnPrefs.test.mts` owns the model without a DOM:
 *
 *   * THE WIDTH. `gearTableLayout` states pixels past ten columns and the table states a minimum —
 *     but whether that produces a scrollbar INSIDE the list box or a page that slides sideways is a
 *     fact about `tableLayout: fixed`, a flex row with `minWidth: 0`, and a real Chromium. No unit
 *     test can see it. This spec measures all three boxes in one breath: the list overflows, the
 *     document does not, the content area does not.
 *   * THE FIXED-HEIGHT CONTRACT. The windowing hook's every index assumes each row is exactly
 *     `ROW_HEIGHT`, and eighteen columns is precisely the situation in which a cell would wrap and
 *     desync it. So the rows are MEASURED, not trusted.
 *   * THE SORT ON A PICKED COLUMN, with the numbers read back at the plus-state the host spec left
 *     the global selector at — the picker must not have moved the arithmetic, only what is drawn.
 *   * PERSISTENCE ACROSS A PROCESS. `localStorage` is a real file under the temp `userData` dir, so
 *     the second launch is what proves an EXPLICIT choice beat the derivation rather than merely
 *     agreeing with it: it asserts a column the derivation would always draw (AC, a core column) is
 *     ABSENT, and one it would never draw (CHA) is present.
 */
import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'
import { scaleGearRow, gearRatio } from '../../src/shared/planner/gearScale'
import type { GearRow } from '../../src/shared/planner/gear'
import type { ItemUpgradeState } from '../../src/shared/itemUpgrade'

const ROW = '[data-testid="gear-row"]'
const TABLE = '[data-testid="gear-table"]'
const COUNT = '[data-testid="gear-count"]'
const SEARCH = '[data-testid="gear-search"] input'
const COLUMNS_TOGGLE = '[data-testid="gear-columns-toggle"]'
const COLUMNS_RESET = '[data-testid="gear-columns-reset"]'
const FILTERS_TOGGLE = '[data-testid="gear-filters-toggle"]'
const SLOT_SELECT = '[data-testid="gear-slot"]'
const EFFECT_SELECT = '[data-testid="gear-effect"]'
const THRESHOLD_CHIP = '[data-testid="gear-threshold-chip"]'

/** The dense row height GearTable states, and the number `useWindowedRows` is handed. */
const ROW_HEIGHT = 37

/**
 * What the picker is asked for. Fourteen keys on top of the core four, which is eighteen numeric
 * columns — comfortably past the ten a percentage budget can serve at a legible floor, and that is
 * the whole point of the list.
 *
 * The seven attributes lead it because they are what the owner named: *ALL stats should be there
 * (STR, DEX, etc.)*. `WIS` and `DMG` are at the end for a different reason — the numbers step below
 * reads them off the fixture row, and PICKING them rather than leaning on a threshold to derive
 * them is exactly the independence this ticket adds.
 */
const PICK: readonly string[] = [
  'STR',
  'STA',
  'AGI',
  'DEX',
  'INT',
  'CHA',
  'END',
  'ATTACK',
  'HASTE',
  'SV_FIRE',
  'SV_COLD',
  'SV_MAGIC',
  'WIS',
  'DMG'
]

export interface GearColumnFixture {
  /** the same base row the host spec pins, so the expected numbers are computed and never typed */
  row: GearRow
  /** the plus-state the host spec left the GLOBAL selector at */
  state: ItemUpgradeState
}

function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  return settle(fn, (ok) => ok, { timeoutMs: ms })
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

async function shownCount(page: Page): Promise<number> {
  const text = await textOf(page, COUNT)
  return Number((/[\d,]+/.exec(text)?.[0] ?? '0').replace(/,/g, ''))
}

/** Type into the search box and let the DEFERRED filter land — the count settling IS the condition. */
async function typeAndSettle(page: Page, value: string): Promise<number> {
  await page.fill(SEARCH, value, { timeout: 15_000 })
  let last = -1
  await settle(
    async () => {
      const shown = await shownCount(page)
      const stable = shown === last
      last = shown
      return stable
    },
    (ok) => ok,
    { timeoutMs: 15_000 }
  )
  return last
}

/** One numeric cell of one row, as text. `''` is both "not on screen" and "states none" (by design). */
function cellText(page: Page, key: string, column: string): Promise<string> {
  return page.evaluate(
    ([k, c]) => {
      const cell = document
        .querySelector(`[data-testid="gear-row"][data-item-key="${k}"]`)
        ?.querySelector(`[data-testid="gear-cell-${c}"]`)
      return cell instanceof HTMLElement ? cell.innerText.trim() : ''
    },
    [key, column]
  )
}

/**
 * THE THREE BOXES, in one read. `list` is how far the table overflows its own scroller — which is
 * where a wide column set is SUPPOSED to go. `doc` and `content` are the page, which must never
 * move sideways no matter how many columns are asked for.
 */
function overflowX(page: Page): Promise<{ list: number; doc: number; content: number }> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="gear-list"]')
    const content = document.querySelector('main')?.firstElementChild as HTMLElement | null
    return {
      list: list === null ? -1 : list.scrollWidth - list.clientWidth,
      doc: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      content: content === null ? -1 : Math.max(0, content.scrollWidth - content.clientWidth)
    }
  })
}

/** Every mounted row's height, deduped — the windowing hook's precondition, measured. */
function rowHeights(page: Page): Promise<number[]> {
  return page.evaluate((sel) => {
    const seen = new Set<number>()
    for (const el of document.querySelectorAll(sel)) seen.add(Math.round(el.getBoundingClientRect().height))
    return [...seen]
  }, ROW)
}

/** Open a picker menu, click a list of options, and close it with the platform's own gesture. */
async function pick(page: Page, toggle: string, testId: string, keys: readonly string[]): Promise<void> {
  await page.click(toggle, { timeout: 15_000 })
  for (const key of keys) {
    await page.click(`[data-testid="${testId}-option-${key}"]`, { timeout: 15_000 })
  }
  await page.keyboard.press('Escape')
  await until(async () => (await countOf(page, `[data-testid="${testId}-option-${keys[0] ?? 'AC'}"]`)) === 0, 10_000)
}

// =================================================================================

/**
 * 1. THE PICKER PUTS ANY STAT ON THE TABLE, AND EVERY ONE OF THEM SORTS.
 *
 * The gap the owner hit was never the sort machinery — `sortGearRows` has always taken any
 * `GearStatKey` — it was that a key with no column had no header to click. So the assertion is
 * exactly that: for every key picked, a header exists that carries the sort control.
 */
async function stepPick(page: Page): Promise<boolean> {
  await typeAndSettle(page, '')
  const before = await countOf(page, '[data-testid^="gear-sort-"]')
  await pick(page, COLUMNS_TOGGLE, 'gear-columns', PICK)

  const grew = await until(async () => (await countOf(page, '[data-testid^="gear-sort-"]')) > before, 15_000)
  const after = await countOf(page, '[data-testid^="gear-sort-"]')
  if (!check('picking stats puts them on the table as columns', grew, `${String(before)} headers → ${String(after)}`)) {
    return false
  }

  const missing: string[] = []
  for (const key of PICK) {
    if ((await countOf(page, `[data-testid="gear-sort-${key}"]`)) !== 1) missing.push(key)
  }
  check(
    'every picked stat gets a SORTABLE header - the exposure is the whole of "all columns sortable"',
    missing.length === 0,
    missing.length === 0 ? `${String(PICK.length)} picked, all sortable` : `no header for ${missing.join(' ')}`
  )
  // The chip says the choice is now the user's, not the app's.
  check(
    'the Columns chip counts what is drawn',
    (await textOf(page, COLUMNS_TOGGLE)).includes(String(after - 1)),
    (await textOf(page, COLUMNS_TOGGLE)).replace(/\s+/g, ' ').trim()
  )
  return missing.length === 0
}

/**
 * 2. A SET WIDER THAN THE PANE SCROLLS INSIDE THE TABLE'S OWN BOX — never sideways on the page.
 *
 * This is JOS-260's law at width. The percentage budget cannot make a `tableLayout: fixed` table
 * wider than its container, so past ten numeric columns the layout states PIXELS and a table
 * minimum; the list box, which was already `overflow: auto` for the vertical case, is what absorbs
 * it. Both halves are measured, because either one alone would pass while the feature was broken.
 */
async function stepWidth(page: Page): Promise<void> {
  const mode = await page.getAttribute(TABLE, 'data-layout', { timeout: 15_000 })
  check('a column set past the percentage floor switches the table to stated pixel widths', mode === 'pixel', String(mode))

  const over = await overflowX(page)
  check(
    'the wide table scrolls horizontally INSIDE the gear list, which is its own box',
    over.list > 0,
    `list overflows by ${String(over.list)}px`
  )
  check(
    '…and the PAGE never scrolls sideways for it - not the document, not the content area',
    over.doc === 0 && over.content === 0,
    `document +${String(over.doc)}px · content area +${String(over.content)}px`
  )

  // THE FIXED-HEIGHT CONTRACT, MEASURED. Eighteen columns is exactly when a cell would wrap.
  const heights = await rowHeights(page)
  check(
    'every row is still exactly one clipped line tall - the windowing hook`s whole precondition',
    heights.length === 1 && Math.abs((heights[0] ?? 0) - ROW_HEIGHT) <= 1,
    `heights seen: ${heights.join(' ') || 'none'}`
  )
}

/**
 * 3. SORTING BY A PICKED COLUMN, and the absent-last rule that goes with it.
 *
 * `STR` is a stat most of the corpus does not state, which is what makes it the right column to
 * prove the rule on: descending must rank the rows that STATE a strength, and must never rank a
 * silent row among them as though it read zero.
 */
async function stepSortPicked(page: Page): Promise<void> {
  await page.click('[data-testid="gear-sort-STR"]', { timeout: 15_000 })
  const ready = await until(async () => {
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="gear-cell-STR"]')]
        .map((c) => (c as HTMLElement).innerText.trim())
        .filter((t) => t !== '').length
    )
    return seen > 1
  }, 15_000)
  if (!check('sorting by a picked stat leaves rows on screen that state it', ready)) return

  const values = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="gear-cell-STR"]')].map((c) => (c as HTMLElement).innerText.trim())
  )
  const numbers = values.filter((t) => t !== '').map(Number)
  check(
    'a picked column ranks the visible rows highest first, like any other',
    numbers.every((n, i) => i === 0 || (numbers[i - 1] ?? 0) >= n),
    numbers.slice(0, 6).join(' ')
  )
  const firstBlank = values.indexOf('')
  check(
    'and a row stating no STR never outranks one that states it - absent is not zero',
    firstBlank === -1 || values.slice(firstBlank).every((t) => t === ''),
    `first blank at ${String(firstBlank)} of ${String(values.length)}`
  )
}

/**
 * 4. THE NUMBERS ARE STILL `scaleGearRow`'s, AT THE PLUS-STATE THE SELECTOR IS AT.
 *
 * The picker changes what is DRAWN and nothing that is computed, so the cells must read exactly
 * what the host spec's upgrade step already proved they read — now beside twelve columns that were
 * not on screen when it did. The expectation is computed here rather than typed, the same discipline
 * the host spec keeps.
 */
async function stepNumbersUnmoved(page: Page, fixture: GearColumnFixture): Promise<void> {
  await typeAndSettle(page, fixture.row.name.split(',')[0] ?? fixture.row.name)
  const scaled = scaleGearRow(fixture.row, fixture.state)
  const want = {
    dmg: String(scaled.stats.DMG),
    wis: String(scaled.stats.WIS),
    ratio: gearRatio(scaled.stats)?.toFixed(2) ?? ''
  }
  const got = {
    dmg: await cellText(page, fixture.row.key, 'DMG'),
    wis: await cellText(page, fixture.row.key, 'WIS'),
    ratio: await cellText(page, fixture.row.key, 'RATIO')
  }
  check(
    'a picked-wide table still states scaleGearRow`s answer at the selector`s plus - the picker draws, it does not compute',
    got.dmg === want.dmg && got.wis === want.wis && got.ratio === want.ratio,
    `screen ${got.dmg}/${got.wis}/${got.ratio} · scaleGearRow ${want.dmg}/${want.wis}/${want.ratio}`
  )
  // A column the item does not state is BLANK beside the ones it does — never a zero it never had.
  check(
    '…and a picked column this item states nothing for is blank, not a zero it never had',
    (await cellText(page, fixture.row.key, 'STR')) === '',
    `reads "${await cellText(page, fixture.row.key, 'STR')}"`
  )
}

/**
 * 5. RESET GOES BACK TO THE DERIVED SEED — the state that has no stored key, made reachable.
 *
 * And with it the width law reverses: the derived set has always fitted the percentage budget, so
 * the list stops overflowing. That is the continuity claim in `gearColumns.ts`, measured.
 */
async function stepReset(page: Page): Promise<void> {
  await typeAndSettle(page, '')
  await page.click(COLUMNS_TOGGLE, { timeout: 15_000 })
  await page.click(COLUMNS_RESET, { timeout: 15_000 })
  await page.keyboard.press('Escape')

  const back = await until(async () => (await page.getAttribute(TABLE, 'data-layout')) === 'percent', 15_000)
  check('resetting the picker returns the columns to following the filters and the sort', back)
  const gone = await until(async () => (await countOf(page, '[data-testid="gear-sort-CHA"]')) === 0, 10_000)
  check('…so a stat nothing is filtering or sorting on stops drawing a column', gone)
  const over = await overflowX(page)
  check(
    '…and the derived set fits the pane again, with no sideways scroll anywhere',
    over.list <= 1 && over.doc === 0 && over.content === 0,
    `list +${String(over.list)}px · document +${String(over.doc)}px`
  )
}

/**
 * 6. THE FILTER BAR IS CONFIGURABLE, AND A HIDDEN CONTROL STOPS FILTERING.
 *
 * The half that is easy to get wrong is not the hiding — it is what happens to the narrowing the
 * hidden control was applying. Leaving it on would hold rows back behind a chip nobody can see,
 * which is the JOS-67 law's exact failure. So the count must GROW when the control goes and come
 * back down when it returns: the user's own value survives, it simply stops being applied.
 *
 * THE INERTNESS ARM IS PROVEN ON THE THRESHOLDS, NOT ON THE SLOT SELECT — measured, not assumed.
 * The host spec leaves BOTH on, but its two thresholds (`wis 10`, `dmg 1`) already select for
 * weapons, and every weapon in this corpus stating WIS 10+ turns out to be flagged PRIMARY: dropping
 * the slot filter changes the count by zero, so it could never tell an inert filter from a live one.
 * The thresholds are the pair that actually moves the number.
 */
async function stepFilterPicker(page: Page): Promise<void> {
  const narrowed = await typeAndSettle(page, '')
  check(
    'the host spec left a slot filter and two stat thresholds on for this step',
    (await countOf(page, SLOT_SELECT)) === 1 && (await countOf(page, THRESHOLD_CHIP)) === 2,
    `${String(await countOf(page, THRESHOLD_CHIP))} chips over ${String(narrowed)} rows`
  )

  // VISIBILITY, on a control whose narrowing this corpus cannot see: any of them can go, and return.
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['slot'])
  check('unpicking a filter takes its control off the toolbar', await until(async () => (await countOf(page, SLOT_SELECT)) === 0, 15_000))
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['slot'])
  check('…and picking it again puts it back', await until(async () => (await countOf(page, SLOT_SELECT)) === 1, 15_000))

  // INERTNESS, on the pair that moves the count.
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['thresholds'])
  const widened = await until(async () => (await shownCount(page)) > narrowed, 15_000)
  check(
    'a hidden control STOPS ITS FILTER - nobody may be held back by a chip they cannot see',
    widened && (await countOf(page, THRESHOLD_CHIP)) === 0,
    `${String(narrowed)} with the thresholds → ${String(await shownCount(page))} without their control`
  )

  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['thresholds'])
  const restored = await until(async () => (await shownCount(page)) === narrowed, 15_000)
  check(
    'putting the control back restores the value it was holding, unchanged',
    restored && (await countOf(page, THRESHOLD_CHIP)) === 2,
    `${String(await shownCount(page))} rows and ${String(await countOf(page, THRESHOLD_CHIP))} chips, wanted ${String(narrowed)} and 2`
  )
}

/**
 * THE WHOLE JOS-297 PASS. Run AFTER the host spec's upgrade step, so the global selector is already
 * at the owner's checkpoint and the numbers step below has a plus-state worth re-reading at.
 *
 * IT LEAVES A CHOICE BEHIND ON PURPOSE: a column set that a derivation could never produce (CHA in,
 * the core AC out) and one hidden filter control, both for the relaunch step to find.
 */
export async function stepGearColumns(page: Page, fixture: GearColumnFixture): Promise<void> {
  await stepFilterPicker(page)

  // OPEN THE CORPUS BACK UP, using the feature under test. The host spec left a slot filter and two
  // stat thresholds on, which between them leave a few dozen rows — too few to say anything about a
  // ranking. Hiding those two controls is the honest way to widen it, because hiding them is
  // DEFINED to make them inert; it also means the derived seed is now just the core four, so every
  // column the picker adds below is unambiguously the picker's doing.
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['slot', 'thresholds'])
  if (!(await stepPick(page))) return
  await stepWidth(page)
  await stepSortPicked(page)
  await stepNumbersUnmoved(page, fixture)
  await stepReset(page)
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['slot', 'thresholds'])

  // The choice the second launch has to find. CHA is never derived here and AC is always derived,
  // so the pair is only explicable as a stored explicit list.
  await pick(page, COLUMNS_TOGGLE, 'gear-columns', ['CHA', 'AC'])
  await pick(page, FILTERS_TOGGLE, 'gear-filters', ['effect'])
  const parked =
    (await countOf(page, '[data-testid="gear-sort-CHA"]')) === 1 &&
    (await countOf(page, '[data-testid="gear-sort-AC"]')) === 0 &&
    (await countOf(page, EFFECT_SELECT)) === 0
  check('the tab is left holding a choice no derivation could have produced', parked)
  if (!parked) note('the relaunch step below cannot prove anything the first launch did not park')
}

/** AND IT ALL COMES BACK — a second launch over the same userData, reading the same localStorage. */
export async function stepGearColumnsRelaunched(page: Page): Promise<void> {
  const mounted = await until(async () => (await countOf(page, TABLE)) === 1, 30_000)
  if (!check('the table mounts on the second launch', mounted)) return

  const cha = await until(async () => (await countOf(page, '[data-testid="gear-sort-CHA"]')) === 1, 15_000)
  check('a picked column comes back after a relaunch, sortable header and all', cha)
  check(
    '…and an EXPLICIT choice beats the derivation across a process: the core AC column stays removed',
    (await countOf(page, '[data-testid="gear-sort-AC"]')) === 0,
    'AC would be drawn by the seed on every launch'
  )
  check(
    'a hidden filter control stays hidden, while the ones that were never unpicked come back',
    (await countOf(page, EFFECT_SELECT)) === 0 && (await countOf(page, SLOT_SELECT)) === 1
  )
}
