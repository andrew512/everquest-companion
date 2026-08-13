/**
 * JOS-286, phase 5 — GEAR SETS: named virtual loadouts, on the Gear tab's own table.
 *
 * A step module rather than a spec of its own (the plannerSteps.mts / suggestRowSteps.mts
 * precedent): everything these steps need — a launched app, the staged `/outputfile inventory`
 * dump, the mounted table, the ownership join — is already standing in `gear.e2e.mts`, and a
 * second Electron launch to click a `+` would buy nothing but forty seconds. It also keeps that
 * spec under the repo's 400-code-line factoring ceiling, which is the other reason files split
 * here.
 *
 * WHY THESE CLAIMS NEED A REAL APP. `tests/gearSet.test.mts` owns the model, the arithmetic and
 * the diff without a DOM — the cell rules, the uplift per assignment, `sumGear`'s percent refusal,
 * the comparison against `equippedHosts`. What no unit test can see is the CHAIN: a `+` on a
 * WINDOWED search row → a cell in a pane → phase 0's uplift at THAT cell's own slider → the
 * totals row → a debounced whole-array write over IPC → main's validator → electron-store → a
 * SECOND LAUNCH that reads it all back. Every link is a different process, transport or file.
 *
 * THE EXPECTED NUMBERS ARE COMPUTED, NOT TYPED. `scalePrimary` is imported and asked, so this file
 * can never drift from the arithmetic it is checking; the BASE vector it asks about belongs to the
 * host spec (which copied it from `tests/gearIndex.test.mts`, which asserts it against the real
 * corpus), so a rescrape turns THAT file red first and names the corpus rather than the UI.
 */
import type { Page } from 'playwright-core'
import { check, countOf, settle, settleCount } from './appHarness.mjs'
import { scalePrimary } from '../../src/shared/itemUpgrade'
import type { GearRow } from '../../src/shared/planner/gear'

// The table's own selectors, restated here rather than imported, on the same terms every step
// module in this directory restates the ones it drives.
const ROW = '[data-testid="gear-row"]'
const SEARCH = '[data-testid="gear-search"] input'

const SETS_TOGGLE = '[data-testid="gear-sets-toggle"]'
const SETS_PANE = '[data-testid="gear-sets-pane"]'
const SETS_EMPTY = '[data-testid="gear-sets-empty"]'
const SET_NEW = '[data-testid="gear-set-new"]'
const SET_NOTE = '[data-testid="gear-set-note"]'
const SET_FILLED = '[data-testid="gear-set-filled"]'
const SET_UNSUMMED = '[data-testid="gear-set-unsummed"]'
const SET_DIFF_SUMMARY = '[data-testid="gear-set-diff-summary"]'
const SET_DIFF_ROW = '[data-testid="gear-set-diff-row"]'
/** The set cell the host spec's weapon lands in, and the one every step below reads. */
const PRIMARY_CELL = '[data-testid="gear-set-cell"][data-cell="PRIMARY"]'

/**
 * The second PRIMARY weapon, purely so DISPLACEMENT has two names to be about. Ghoulbane states
 * `DMG 15 / Delay 34` and nothing summable, which is deliberate: the totals must come back to the
 * planned weapon's WIS when it is put back, rather than being some blend of the two.
 */
const DISPLACER = 'Ghoulbane'

/**
 * A haste item, because the UNSUMMED list is the visible half of `sumGear`'s refusal and a set
 * with no percent-valued stat in it would never draw one. `Belt of Contention` states `HASTE 21%`
 * (plus STR/STA/AC, which DO sum) and wears in a cell nothing else here wants.
 */
const HASTE_ITEM = 'Belt of Contention'

/** The per-item tier these steps plan at. WHOLE tiers: that is all a ` +N` suffix ever says. */
const CELL_TIER = 3

/**
 * What the HOST SPEC owns about the item under test: its corpus ROW (name, join key and the base
 * vector `tests/gearIndex.test.mts` asserts against the corpus) and the sentence the Owned column
 * draws for it. Passed in rather than restated, so there is exactly one copy of the fixture in the
 * suite and a rescrape turns the corpus test red before it turns this one red.
 */
export interface GearSetFixture {
  row: GearRow
  /** `ownedCellText`'s answer for this item, which a set cell must reuse VERBATIM */
  owned: string
}

/** The WIS the fixture states at base — the one stat these steps follow through the whole chain. */
function baseWis(fixture: GearSetFixture): number {
  return fixture.row.stats.WIS ?? 0
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  return settle(fn, (ok) => ok, { timeoutMs: ms })
}

/** One sub-element of one set cell, as text. `''` covers both absent and empty — and an EMPTY cell
 *  draws none of these, so `''` is also how "nothing is in it" reads. */
function cellPartOf(page: Page, cell: string, testId: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el instanceof HTMLElement ? el.innerText.trim() : ''
  }, `[data-testid="gear-set-cell"][data-cell="${cell}"] [data-testid="${testId}"]`)
}

/** The same, for the cell the host spec's weapon lives in. */
function cellPart(page: Page, testId: string): Promise<string> {
  return cellPartOf(page, 'PRIMARY', testId)
}

/** Empty one cell, through the button the user has. */
function clearCell(page: Page, cell: string): Promise<void> {
  return page.click(`[data-testid="gear-set-cell"][data-cell="${cell}"] [data-testid="gear-set-cell-clear"]`, {
    timeout: 15_000
  })
}

/**
 * One TOTALS row's number. The row reads `Wisdom  +19 ·1`, so the first signed integer in it is
 * the total — no label in `sumGear`'s vocabulary carries a digit, which is what makes that safe.
 */
function totalOf(page: Page, label: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el instanceof HTMLElement ? (/[+-]\d+/.exec(el.innerText)?.[0] ?? '') : ''
  }, `[data-testid="gear-set-total"][data-label="${label}"]`)
}

/**
 * Find an item in the table and click the `+` its row carries. The CONDITION is that row existing
 * — never a count settling — because the search box is deferred and the row is windowed, and "the
 * row I am about to click is mounted" is exactly what the click needs to be true.
 */
async function addFromSearch(page: Page, term: string, key: string): Promise<boolean> {
  await page.fill(SEARCH, term, { timeout: 15_000 })
  const found = (await settleCount(page, `${ROW}[data-item-key="${key}"]`, 1, { timeoutMs: 20_000 })) === 1
  if (!found) return false
  await page.click(`${ROW}[data-item-key="${key}"] [data-testid="gear-add"]`, { timeout: 15_000 })
  return true
}

/** Focus a slider and drive it with the keyboard — the same path the control gives a user. */
async function driveSlider(page: Page, sel: string, keys: readonly string[]): Promise<void> {
  await page.focus(sel, { timeout: 15_000 })
  for (const key of keys) await page.press(sel, key, { timeout: 15_000 })
}

/** What the planned weapon's WIS reads at the per-item tier — phase 0's answer, asked not typed. */
function plannedWis(fixture: GearSetFixture): string {
  return `+${String(scalePrimary(baseWis(fixture), { full: CELL_TIER, fraction: 0 }))}`
}

/** The cell's plus label, in the item window's own words. */
const PLANNED_PERCENT = `+${String(CELL_TIER * 10)}%`

// =================================================================================
// THE STEPS
// =================================================================================

/** THE PANE OPENS AND MAKES SETS — more than one, which is the owner's ruling. */
async function stepOpen(page: Page): Promise<boolean> {
  check('the table has no `+` on any row until there is a set to add to', (await countOf(page, '[data-testid="gear-add"]')) === 0)

  await page.click(SETS_TOGGLE, { timeout: 15_000 })
  const opened = await until(async () => (await countOf(page, SETS_PANE)) === 1, 15_000)
  if (!check('the Sets chip opens a pane beside the table, without disturbing the search', opened)) return false
  check('…and a pane with no sets in it says what the one button does', (await countOf(page, SETS_EMPTY)) === 1)

  await page.click(SET_NEW, { timeout: 15_000 })
  await page.click(SET_NEW, { timeout: 15_000 })
  const two = await until(async () => (await textOf(page, SETS_TOGGLE)).includes('2'), 15_000)
  check(
    'a character may have MORE THAN ONE set (the owner`s ruling)',
    two,
    (await textOf(page, SETS_TOGGLE)).replace(/\s+/g, ' ').trim()
  )
  check('a fresh set states how many of the twenty-three cells it fills', (await textOf(page, SET_FILLED)).startsWith('0 of 23'))
  return two
}

/**
 * ADDING FROM A SEARCH ROW — the natural gesture — and the phase-4 vocabulary a cell reuses.
 *
 * The place text is `ownedCellText`'s, the SAME sentence the table's Owned column draws
 * (`Equipped +5` for this row, off the staged dump). That re-use is the ticket's own instruction
 * and it is what keeps a set from growing a second wording for "where is this thing".
 */
async function stepAssign(page: Page, fixture: GearSetFixture): Promise<boolean> {
  if (!check('the set steps have their weapon to add', await addFromSearch(page, fixture.row.name, fixture.row.key))) {
    return false
  }
  const landed = await until(async () => (await cellPart(page, 'gear-set-cell-name')) === fixture.row.name, 15_000)
  check(
    'clicking + on a search row puts that item in the cell its slot occupies',
    landed,
    await cellPart(page, 'gear-set-cell-name')
  )
  check(
    'the pane says what just happened, naming the cell',
    (await textOf(page, SET_NOTE)).includes('PRIMARY'),
    await textOf(page, SET_NOTE)
  )
  const place = await cellPart(page, 'gear-set-cell-place')
  check(
    'a set cell says WHERE its item is in the Owned column`s own words',
    place === fixture.owned,
    `reads "${place}", wanted "${fixture.owned}"`
  )
  const base = `+${String(baseWis(fixture))}`
  check(
    'the cell states what it contributes, and the TOTALS row states the same number',
    (await cellPart(page, 'gear-set-cell-stats')).includes(base) && (await totalOf(page, 'Wisdom')) === base,
    `${await cellPart(page, 'gear-set-cell-stats')} · totals ${await totalOf(page, 'Wisdom')}`
  )
  return true
}

/** Add the second weapon and wait for it to land wherever the model sends it. */
async function addDisplacer(page: Page, cell: string): Promise<boolean> {
  if (!(await addFromSearch(page, DISPLACER, DISPLACER.toLowerCase()))) {
    check(`the displacement step has ${DISPLACER}`, false)
    return false
  }
  return until(async () => (await cellPartOf(page, cell, 'gear-set-cell-name')) === DISPLACER, 15_000)
}

/**
 * WHERE A SECOND WEAPON GOES, AND WHAT IT TAKES TO DISPLACE ANYBODY.
 *
 * A weapon whose own cell is taken does NOT throw the first one out: the game gives two places
 * that constrain nothing (JOS-104, `ANY SLOT 1/2`), and those are free. Only when there is
 * genuinely nowhere left does the first candidate take the hit — and then the pane NAMES who was
 * displaced, because an item that vanishes out of a plan without a word is the failure this
 * announcement exists to prevent.
 */
async function stepDisplace(page: Page, fixture: GearSetFixture): Promise<void> {
  const toAny1 = await addDisplacer(page, 'ANY1')
  check(
    'a second weapon lands in an ANY slot rather than throwing the first one out (JOS-104)',
    toAny1 && (await cellPart(page, 'gear-set-cell-name')) === fixture.row.name,
    `ANY1 "${await cellPartOf(page, 'ANY1', 'gear-set-cell-name')}" · PRIMARY "${await cellPart(page, 'gear-set-cell-name')}"`
  )
  check('…and so does a third, into the other one', await addDisplacer(page, 'ANY2'))

  // Now there is genuinely nowhere free.
  const swapped = await addDisplacer(page, 'PRIMARY')
  check('assigning with every eligible cell full replaces the FIRST candidate`s occupant', swapped)
  const note = await textOf(page, SET_NOTE)
  check(
    '…and the pane names who was displaced, so nothing vanishes without a word',
    note.includes(fixture.row.name) && note.toLowerCase().includes('displac'),
    note
  )

  // Put the board back — every step below reads the planned weapon's numbers, and nothing else's.
  for (const cell of ['ANY1', 'ANY2', 'PRIMARY']) await clearCell(page, cell)
  const emptied = await until(async () => (await cellPart(page, 'gear-set-cell-name')) === '', 15_000)
  check('a cell can be emptied again, and an empty cell states nothing at all', emptied)
  await addFromSearch(page, fixture.row.name, fixture.row.key)
  await until(async () => (await cellPart(page, 'gear-set-cell-name')) === fixture.row.name, 15_000)
}

/**
 * THE PER-ITEM SLIDER — the owner's both-modes ruling, measured. The cell's own slider moves that
 * cell's numbers AND the totals row, and nothing else.
 */
async function stepPerItemSlider(page: Page, fixture: GearSetFixture): Promise<void> {
  const slider = `${PRIMARY_CELL} [data-testid="gear-set-tier"] input[type="range"]`
  await driveSlider(page, slider, ['Home', ...Array.from({ length: CELL_TIER }, () => 'ArrowRight')])

  const want = plannedWis(fixture)
  const moved = await until(async () => (await totalOf(page, 'Wisdom')) === want, 15_000)
  check(
    'a cell`s own slider restates that cell`s numbers at that plus - scalePrimary`s answer, exactly',
    moved && (await cellPart(page, 'gear-set-cell-stats')).includes(want),
    `cell "${await cellPart(page, 'gear-set-cell-stats')}" · totals ${await totalOf(page, 'Wisdom')} · wanted ${want}`
  )
  check(
    '…and the cell says which plus it is planned at, in the item window`s own words',
    (await cellPart(page, 'gear-set-cell-plus')) === PLANNED_PERCENT,
    await cellPart(page, 'gear-set-cell-plus')
  )
}

/**
 * THE UNSUMMED LIST STAYS VISIBLE. Whether worn haste stacks is a game rule no source in this repo
 * states, so `sumGear` refuses to add percentages — and a set that hid the refusal behind a
 * disclosure would be turning "we cannot say" into "there is nothing here".
 */
async function stepUnsummed(page: Page): Promise<void> {
  if (!(await addFromSearch(page, HASTE_ITEM, HASTE_ITEM.toLowerCase()))) {
    check(`the unsummed step has ${HASTE_ITEM}`, false)
    return
  }
  const listed = await until(async () => (await countOf(page, SET_UNSUMMED)) === 1, 15_000)
  const text = (await textOf(page, SET_UNSUMMED)).replace(/\s+/g, ' ').trim()
  check(
    'a percent-valued stat is STATED in its own list and never folded into a total',
    listed && text.includes('Haste') && text.includes('%'),
    text
  )
  check('…and the same item`s summable stats are totalled normally', (await totalOf(page, 'Strength')) !== '')
}

/** THE DIFF AGAINST WHAT IS ACTUALLY ON THE CHARACTER (`equippedHosts`, through the staged dump). */
async function stepDiff(page: Page): Promise<void> {
  const summary = (await textOf(page, SET_DIFF_SUMMARY)).replace(/\s+/g, ' ').trim()
  check(
    'the set is compared against what the dump says you are WEARING, and states a difference',
    summary.includes('Against equipped') && summary.includes('move'),
    summary
  )
  check('…row by row, and only for the numbers that moved', (await countOf(page, SET_DIFF_ROW)) > 0)
}

/**
 * THE WRITE REACHED MAIN. The pane debounces whole-array saves, so this asks the app's own door
 * rather than sleeping: `getGearSets` is the read half of the channel the pane writes through, so
 * a settled answer here means main validated it and the store took it.
 */
async function stepPersistedInMain(page: Page): Promise<void> {
  const stored = await until(
    async () =>
      page.evaluate(async () => {
        const sets = await window.eq.getGearSets()
        return sets.length === 2 && sets.some((s) => s.slots.PRIMARY !== undefined)
      }),
    20_000
  )
  check('the sets are written through IPC into this character`s store, validated by main', stored)
}

/** The whole phase-5 pass, in one call. Leaves the pane OPEN and the search box holding a term. */
export async function stepGearSets(page: Page, fixture: GearSetFixture): Promise<void> {
  if (!(await stepOpen(page))) return
  if (!(await stepAssign(page, fixture))) return
  await stepDisplace(page, fixture)
  await stepPerItemSlider(page, fixture)
  await stepUnsummed(page)
  await stepDiff(page)
  await stepPersistedInMain(page)
}

/**
 * THE TWO SLIDERS ARE INDEPENDENT — called AFTER the host spec has driven the GLOBAL one to the
 * owner's checkpoint. That is the whole of the both-modes ruling: the global selector restates the
 * CORPUS so candidates compare fairly, a cell's own slider states what THAT item is planned at,
 * and neither ever reads the other's value.
 */
export async function stepGearSetsIndependent(page: Page, fixture: GearSetFixture): Promise<void> {
  const want = plannedWis(fixture)
  check(
    'moving the GLOBAL plus-state leaves a set cell reading its own planned plus',
    (await totalOf(page, 'Wisdom')) === want && (await cellPart(page, 'gear-set-cell-plus')) === PLANNED_PERCENT,
    `totals ${await totalOf(page, 'Wisdom')} at cell ${await cellPart(page, 'gear-set-cell-plus')}, wanted ${want}`
  )
}

/** AND IT ALL COMES BACK — a second launch over the same userData, reading the same store file. */
export async function stepGearSetsRelaunched(page: Page, fixture: GearSetFixture): Promise<void> {
  const mounted = await until(async () => (await countOf(page, SETS_PANE)) === 1, 30_000)
  check('the pane reopens where it was left (a machine-class preference, like every other one)', mounted)
  if (!mounted) return
  check(
    'both sets survived the relaunch',
    (await textOf(page, SETS_TOGGLE)).includes('2'),
    (await textOf(page, SETS_TOGGLE)).replace(/\s+/g, ' ').trim()
  )
  const name = await cellPart(page, 'gear-set-cell-name')
  check('…and so did the item in its cell', name === fixture.row.name, name)
  check(
    '…at the plus it was planned at, which is the per-item state the store had to carry',
    (await cellPart(page, 'gear-set-cell-plus')) === PLANNED_PERCENT,
    await cellPart(page, 'gear-set-cell-plus')
  )
  check(
    '…and its numbers come back scaled to it, not to base',
    (await totalOf(page, 'Wisdom')) === plannedWis(fixture),
    await totalOf(page, 'Wisdom')
  )
}
