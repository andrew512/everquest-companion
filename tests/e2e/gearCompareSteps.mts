/**
 * THE GEAR TAB'S COMPARISON CARD (JOS-338) — hover a search row and the app tells you what you are
 * wearing in the slots that item would go in, and how old that claim is.
 *
 * A MODULE RATHER THAN MORE OF `gear.e2e.mts`, the `gearColumnSteps.mts` / `gearWishSteps.mts`
 * precedent: everything this needs is already standing in the host spec, and that file sits at the
 * repo's 400-code-line factoring ceiling.
 *
 * WHAT NEEDS A REAL APP HERE, given `tests/gearCompare.test.mts` owns the join and every word of the
 * card without a DOM:
 *
 *   1. A REAL POINTER ON A REAL ROW OPENS IT. The anchor, MUI's popper, the `plannerInventory` IPC
 *      and main's parse of the staged dump are four separate parts, and only a running app has all
 *      four. A card that never opens passes every unit test ever written for it.
 *   2. THE EQUIPPED HALF IS THE STAGED DUMP'S. The host spec stages the committed
 *      `Primitive_freeport-Inventory.txt` into the throwaway install, so `Primary  Thelvorn, Blade
 *      of Light +5` and `Secondary  Whitened Treant Fists` are facts on disk that have to travel
 *      main's parser, `equippedHosts`' cell assignment, the IPC and the renderer join to reach a
 *      hovered row. The number beside them is computed here from `scaleGearRow`, never typed.
 *   3. THE JOS-143 REGRESSION, WHICH IS THE WHOLE RISK OF THE TICKET. This table has carried "no
 *      popper on these dense rows" since it shipped, because twice (JOS-127, JOS-143) a card
 *      belonging to a row under a dropdown toolbar opened upward across it and ate the clicks aimed
 *      at the controls. So the card is opened and then, WITH IT OPEN, the toolbar's era toggle and
 *      search box, the row's own wish heart (JOS-335) and the item name's Loot link are all
 *      hit-tested — `document.elementFromPoint` skips a `pointer-events: none` node, so this
 *      measures exactly what "the click still lands" means.
 *   4. IT CLOSES WHEN THE POINTER LEAVES (JOS-293's leave discipline, measured rather than trusted).
 *
 * IT LEAVES THE TAB AS IT FOUND IT: search box empty, both pickers cleared, pointer parked off the
 * table, no card open — the steps after it in `gear.e2e.mts` were written against that state.
 */
import type { Page } from 'playwright-core'
import { check, countOf, hoverAt, note, settle, settleGone } from './appHarness.mjs'
import { clearPicks, pickIn } from './gearFilterSteps.mjs'
import type { GearRow } from '../../src/shared/planner/gear'
import { scaleGearRow } from '../../src/shared/planner/gearScale'
// The card's own words, so the expectation is COMPUTED from the module under test's own spelling
// rather than typed into this file (and a change to the spelling turns the unit test red first).
import { compareStats, compareText } from '../../src/renderer/src/features/gear/gearCompare'

const ROW = '[data-testid="gear-row"]'
const CARD = '[data-testid="gear-compare-card"]'
const SEARCH = '[data-testid="gear-search"] input'
const SLOT_PICKER = '[data-testid="gear-slot"]'
const ERA_TOGGLE = '[data-testid="gear-era-toggle"]'
const WISH = '[data-testid="gear-wish"]'
const NAME_LINK = '[data-testid="planner-donor-name"]'

const rowOf = (key: string): string => `${ROW}[data-item-key="${key}"]`

const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

/** One equipped cell of the open card, as plain values a check can read. */
interface CardCell {
  cell: string
  name: string
  empty: boolean
  delta: string
}

interface CardRead {
  present: boolean
  item: string
  stats: string
  /** the "simulated at Tier N" line — absent at base, which is where this step runs */
  simulated: boolean
  cells: CardCell[]
  freshness: string
  /** the no-dump hint drew instead of the equipped half */
  noDump: boolean
}

const NO_CARD: CardRead = { present: false, item: '', stats: '', simulated: false, cells: [], freshness: '', noDump: false }

/**
 * Read the open card.
 *
 * NO NAMED FUNCTION BINDINGS inside `page.evaluate` (repo law — tsx/esbuild's `keepNames` wraps
 * `const f = …` in a `__name` helper that lives in the NODE bundle, and the page dies on
 * `ReferenceError: __name is not defined`). Inline callbacks are fine; a `const` one is not.
 */
function readCard(page: Page): Promise<CardRead> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) {
      return { present: false, item: '', stats: '', simulated: false, cells: [], freshness: '', noDump: false }
    }
    return {
      present: true,
      item: el.getAttribute('data-item-key') ?? '',
      stats: (el.querySelector('[data-testid="gear-compare-stats"]')?.textContent ?? '').trim(),
      simulated: el.querySelector('[data-testid="gear-compare-simulated"]') !== null,
      cells: Array.from(el.querySelectorAll('[data-testid="gear-compare-slot"]')).map((c) => ({
        cell: c.getAttribute('data-cell') ?? '',
        name: (c.querySelector('[data-testid="gear-compare-equipped-name"]')?.textContent ?? '').trim(),
        empty: c.querySelector('[data-testid="gear-compare-empty"]') !== null,
        delta: (c.querySelector('[data-testid="gear-compare-delta"]')?.textContent ?? '').trim()
      })),
      freshness: (el.querySelector('[data-testid="gear-compare-freshness"]')?.textContent ?? '').trim(),
      noDump: el.querySelector('[data-testid="gear-compare-nodump"]') !== null
    }
  }, CARD)
}

/**
 * Is the control the thing at its own centre, or has something been drawn over it?
 *
 * BORROWED VERBATIM FROM `levelingLayoutSteps.mts` (JOS-289), where the same question was asked of
 * a spilling panel. Returns a WORD, so a failure names what covered the control instead of just
 * saying false.
 */
function hitTest(page: Page, s: string): Promise<string> {
  return page.evaluate((q) => {
    const el = document.querySelector(q)
    if (!el) return 'absent'
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return 'collapsed to nothing'
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!top) return 'nothing at its centre'
    if (el.contains(top) || top.contains(el)) return 'hit'
    return `covered by ${top.tagName}.${String(top.className).slice(0, 40)}`
  }, s)
}

/** Point at a row and wait for its card to have an ANSWER in it, not merely to be in the DOM. */
async function openCardOn(page: Page, key: string): Promise<CardRead> {
  if (!(await hoverAt(page, rowOf(key), 0.5, 0.5))) return NO_CARD
  return settle(() => readCard(page), (c) => c.present && c.item === key, { timeoutMs: 20_000 })
}

/** Move the pointer off the table and prove the card went with it. */
async function closeCard(page: Page): Promise<boolean> {
  await page.mouse.move(4, 4)
  await settleGone(page, CARD, { timeoutMs: 10_000 })
  return (await countOf(page, CARD)) === 0
}

/**
 * 1. THE CARD, ON THE ROW THE HOST SPEC ALREADY PINS.
 *
 * Thelvorn is a PRIMARY item and the staged dump wears one at +5, so this single row proves the
 * whole chain AND the most useful case in it: the candidate is compared against a worn copy the
 * player has merged five times, which is why the numbers differ at all. The expected delta is
 * computed from `scaleGearRow` + the card's own `compareText`, so this spec cannot drift from
 * either the arithmetic or the wording.
 */
async function stepCardOpens(page: Page, base: GearRow): Promise<boolean> {
  await page.fill(SEARCH, base.name, { timeout: 15_000 })
  const onScreen = await until(async () => (await countOf(page, rowOf(base.key))) === 1, 20_000)
  if (!check('the comparison step has its row on screen', onScreen)) return false
  check('no card is open until something is pointed at', (await countOf(page, CARD)) === 0)

  const card = await openCardOn(page, base.key)
  if (!check('pointing at a gear row opens its comparison card', card.present, JSON.stringify(card).slice(0, 200))) {
    return false
  }
  check('…and the card is about the row the pointer is on', card.item === base.key, card.item)
  check('the card states the item’s own numbers', card.stats.includes('DMG'), card.stats || '(none)')
  check('…and says nothing about a simulation, because the selector is at base', !card.simulated)
  checkEquippedHalf(card, base)
  checkFreshness(card)
  return true
}

/**
 * THE DUMP'S AGE, ON THE CARD (JOS-253's truth, through `outputAgeLabel`).
 *
 * A floating card that says what you are wearing has to say how old that claim is — and over a
 * staged dump that exists it must NOT be offering the run-the-command hint instead.
 */
function checkFreshness(card: CardRead): void {
  check(
    'the card says how old the dump making that claim is',
    card.freshness.includes('inventory dump') && card.freshness.includes('updated'),
    card.freshness || '(no line)'
  )
  check('…and does not offer the run-the-command hint, because there IS a dump', !card.noDump)
}

/**
 * The half this ticket exists for, read against the file on disk.
 *
 * ONE CELL, because the corpus states one slot for this item — and the name in it is a line of the
 * staged dump. The delta is COMPUTED: the hovered row is at base, the worn copy is at the `+5` its
 * name states, and the expected words come from the card's own `compareText`.
 */
function checkEquippedHalf(card: CardRead, base: GearRow): void {
  check(
    'the equipped half names the cell this item would go in, once',
    card.cells.length === 1 && card.cells[0].cell === 'PRIMARY',
    card.cells.map((c) => c.cell).join(', ') || '(no cells)'
  )
  const first = card.cells[0] as CardCell | undefined
  check(
    'and it names what the staged dump says is in that hand, at its own +N',
    first?.name === 'Thelvorn, Blade of Light +5',
    first?.name ?? '(nothing)'
  )

  const worn = scaleGearRow(base, { full: 5, fraction: 0 }).stats
  const wantDmg = compareStats(base.stats, worn).find((s) => s.key === 'DMG')
  const wanted = wantDmg === undefined ? '?' : compareText(wantDmg)
  check(
    'the delta line is the difference between this item and the one on your body',
    wantDmg !== undefined && (first?.delta ?? '').includes(wanted),
    `card says "${first?.delta ?? ''}" · wanted "${wanted}"`
  )
}

/**
 * 2. THE JOS-143 REGRESSION, HIT-TESTED WITH THE CARD OPEN.
 *
 * The card is opened again (the previous step's may have closed on the pointer move) and then four
 * controls are asked whether they are still the thing at their own centre: two in the toolbar ABOVE
 * the list — the place both historical reports failed — and two INSIDE the hovered row itself,
 * which is the pair this ticket could most easily have broken.
 */
async function stepStillClickable(page: Page, key: string): Promise<void> {
  const card = await openCardOn(page, key)
  if (!check('the card is open for the hit test', card.present)) return
  for (const [what, selector] of [
    ['the era toggle in the toolbar above', ERA_TOGGLE],
    ['the search box', SEARCH],
    ['the row’s own wish heart', `${rowOf(key)} ${WISH}`],
    ['the item name’s Loot link', `${rowOf(key)} ${NAME_LINK}`]
  ] as const) {
    const verdict = await hitTest(page, selector)
    check(`with the card open, ${what} is still the thing a click would reach`, verdict === 'hit', verdict)
  }
  check('the card is still open — the hit test measured a live card, not an absent one', (await countOf(page, CARD)) === 1)
  check('and it closes when the pointer leaves the row', await closeCard(page))
}

/**
 * 3. THE SECOND HAND, and the dedupe.
 *
 * A row is taken OFF THE SCREEN rather than named here (AGENTS.md, "frozen numbers rot" — a frozen
 * item name rots the same way when the corpus is rescraped): the slot picker is set to SECONDARY,
 * and whatever the table then shows must be compared against `Whitened Treant Fists`, which is what
 * the staged dump has in that hand. A row that states BOTH hands additionally proves the dedupe —
 * two cells, never one twice — and when the visible set has none, that is a NOTE rather than a
 * failure, because which items state two slots is the corpus's business and not this spec's.
 */
async function stepSecondHand(page: Page): Promise<void> {
  await page.fill(SEARCH, '', { timeout: 15_000 })
  await pickIn(page, SLOT_PICKER, 'SECONDARY')
  const listed = await until(async () => (await countOf(page, ROW)) > 0, 20_000)
  if (!check('the slot picker leaves secondary-hand rows on screen', listed)) {
    await clearPicks(page, SLOT_PICKER)
    return
  }
  const key = await page.evaluate(
    (s) => document.querySelector(s)?.getAttribute('data-item-key') ?? '',
    ROW
  )
  const card = await openCardOn(page, key)
  if (check(`pointing at a secondary-slot row opens its card (${key})`, card.present)) {
    const secondary = card.cells.find((c) => c.cell === 'SECONDARY')
    check(
      'the SECONDARY cell names what the staged dump has in that hand, at its own +N',
      secondary?.name === 'Whitened Treant Fists +4',
      secondary?.name ?? `(no SECONDARY cell; cells: ${card.cells.map((c) => c.cell).join(', ')})`
    )
    const cells = card.cells.map((c) => c.cell)
    check('no cell is compared twice', new Set(cells).size === cells.length, cells.join(', '))
    if (cells.length > 1) {
      check(
        'an item that states two slots is compared against both of them',
        cells.includes('PRIMARY') && cells.includes('SECONDARY'),
        cells.join(', ')
      )
    } else {
      note(`the first secondary row on screen (${key}) states one slot — the two-slot dedupe is pinned in tests/gearCompare.test.mts`)
    }
  }
  await closeCard(page)
  await clearPicks(page, SLOT_PICKER)
}

/** The whole comparison step. Hands the tab back with nothing narrowed and no card open. */
export async function stepGearCompare(page: Page, base: GearRow): Promise<void> {
  if (await stepCardOpens(page, base)) await stepStillClickable(page, base.key)
  await closeCard(page)
  await stepSecondHand(page)
  await page.fill(SEARCH, '', { timeout: 15_000 })
}
