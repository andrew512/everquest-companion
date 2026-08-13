// gear/gearColumns.ts — WHICH numeric columns the table draws, and how wide they are.
//
// THE PROBLEM THIS SOLVES. `GEAR_STAT_KEYS` is 32 keys wide and the ticket asks to sort by ANY of
// them, regens and backstab included. Thirty-two columns is not a table anyone can read, so the
// column list is DERIVED: a small always-on core, plus a column for every stat currently being
// thresholded and for whatever the table is sorted by. Filter on `HP_REGEN` and the regen column
// appears; sort by `BACKSTAB` and the backstab column appears; clear them and the table narrows
// back down.
//
// AND SINCE JOS-297 THAT DERIVATION IS THE SEED, NOT THE ANSWER (owner feedback on the shipped
// tab: *ALL stats should be there*). The derivation was a bet that asking about a stat is the only
// way anyone says they want to see it, and the bet was wrong: a player comparing two breastplates
// wants the seven attributes on screen without inventing seven thresholds to conjure them. So the
// picker offers the WHOLE vocabulary (`PICKABLE_COLUMNS` — every `GearStatKey` plus `RATIO`) and
// an explicit choice WINS; absent a choice the derivation still runs, unchanged, which is what
// keeps the tab's first screen exactly what it was. The distinction the storage layer has to
// preserve is therefore ABSENT vs EMPTY: no stored key means "derive", a stored `[]` means "the
// user asked for no numeric columns at all", and the two must never fold together.
//
// EVERY DRAWN NUMERIC COLUMN IS SORTABLE, and that has always been true of the machinery
// (`sortGearRows` takes any `GearSortKey`) — the gap the owner hit was EXPOSURE: a key with no
// column had no header to click. The picker closes it by construction, so there is no second list
// of "sortable keys" here to drift from the drawn ones.
//
// WIDTHS: PERCENTAGES WHILE THEY FIT, PIXELS WHEN THEY DO NOT — and both halves are JOS-260's law
// rather than a preference. The table is `tableLayout: fixed` (a windowed table whose columns
// re-measure per slice moves its row heights under a hook whose every index assumes they cannot —
// LootTables.tsx states the full argument). Under percentages the numeric columns SHARE a fixed
// budget: N columns each take `NUMERIC_BUDGET / N`, the identity columns take a constant, and the
// NAME column states no width at all so it absorbs the slack. That budget has a FLOOR
// (`MIN_NUMERIC_WIDTH`), and the floor is what used to cap the derived count — past ten numeric
// columns a percentage can only be bought by making every column illegible, because percentages
// cannot make a fixed table wider than its box. So past ten the layout switches to STATED PIXELS
// plus a `minWidth` on the table: the table becomes wider than the pane and the pane, which is
// already `overflow: auto`, scrolls it SIDEWAYS INSIDE ITSELF. The page never scrolls sideways —
// that is the whole point of the switch, and `tests/e2e/gearColumnSteps.mts` measures both.
//
// PURE AND NODE-TESTABLE (relative value imports, the house law): this file decides the shape of
// the table, so `tests/gearFilter.test.mts` can assert that a threshold brings its column with it
// and `tests/gearColumnPrefs.test.mts` that a chosen set of thirty overflows on purpose.

import { GEAR_PERCENT_STAT_KEYS, GEAR_STAT_KEYS, type GearStatKey } from '../../../../shared/planner/gear'
import type { GearFilters, GearSort, GearSortKey } from './gearFilter'

/**
 * The columns that are always there: armour, the two pools every class reads, and the weapon
 * ratio. Ratio earns its permanent place because it is the one number the plus-state selector
 * MOVES for a reason that is not obvious (DELAY never scales — phase 0), and watching it move is
 * half of what the selector is for.
 */
export const CORE_COLUMNS: readonly GearSortKey[] = ['AC', 'HP', 'MP', 'RATIO']

/**
 * How many derived columns may join the core before the table stops being readable. Past this the
 * extra thresholds still FILTER — they just stop drawing a column of their own, which is the
 * honest trade: the rows on screen are all answers to those thresholds anyway.
 *
 * THE CAP IS ON THE DERIVATION, NEVER ON THE PICKER. A derived column is one the app decided to
 * add on the user's behalf, and there is a number past which that guessing stops being helpful; a
 * PICKED column was asked for by name, and refusing it would be the app arguing with the person
 * who typed it. Picked sets past `MAX_PERCENT_COLUMNS` pay in horizontal scroll instead.
 */
export const MAX_DERIVED_COLUMNS = 6

/** Percent of the table the numeric columns share between them. */
const NUMERIC_BUDGET = 52
/** …and the floor one column may shrink to, which is what caps the derived count above. */
const MIN_NUMERIC_WIDTH = 5

/**
 * The widest numeric set percentages can still serve at that floor — ten, which is exactly the
 * core plus `MAX_DERIVED_COLUMNS`. That is not a coincidence and it is worth saying out loud: the
 * derived cap WAS the percentage budget's floor, so every column set the shipped tab could produce
 * stays in percentage mode and looks precisely as it did. Only a picked set can cross the line.
 */
export const MAX_PERCENT_COLUMNS = Math.floor(NUMERIC_BUDGET / MIN_NUMERIC_WIDTH)

/**
 * The pixel widths the table states once percentages cannot serve the set. Each is a legible
 * minimum rather than a taste: a numeric cell holds at most `-12345` or `41%`, an identity cell
 * holds a name that ellipsises. Their SUM is what makes the table wider than the pane, which is
 * what makes the pane scroll it.
 */
const PX = { name: 260, slot: 120, classes: 110, numeric: 78, owned: 150 } as const

export const SLOT_COLUMN_WIDTH = '13%'
export const CLASS_COLUMN_WIDTH = '11%'

/**
 * THE OWNERSHIP COLUMN (JOS-285, phase 4) — appended AFTER `visibleColumns`' numerics, and only
 * when the character has a dump to answer from.
 *
 * IT IS ONE COLUMN, not three. "Do you own it", "where" and "at what +N" are one sentence about
 * one item (`ownedCellText`: `Equipped · Bank +2`), and splitting them into three columns would
 * put three blank cells on every one of the ~6,700 rows a player does not own. It is also NOT a
 * `GearColumn`: those keys are `GearSortKey`s and every one of them is a number the plus-state
 * scaler moves. Ownership is text off a live file, so it lives beside the numeric list rather than
 * inside it — which is exactly why it needs no entry in the shared numeric budget below.
 *
 * NOTHING TO ANSWER FROM ⇒ NO COLUMN. On a machine with no dump AND no loot history, an empty
 * ownership cell would be indistinguishable from "you do not own this" — and the app cannot tell
 * the difference either. So the column is absent and the `/outputfile` freshness line beside the
 * count says why (GearView). Either witness alone is enough to draw it.
 */
export const OWNED_COLUMN_WIDTH = '15%'

export interface GearColumn {
  key: GearSortKey
  /** the header's words — `SV MAGIC`, `HP REGEN`, `Ratio` */
  label: string
  /** rendered with a trailing `%` (HASTE, and the census says only HASTE) */
  percent: boolean
}

const PERCENT_KEYS: ReadonlySet<string> = new Set<string>(GEAR_PERCENT_STAT_KEYS)

/** `HP_REGEN` → `HP REGEN`, `RATIO` → `Ratio`. The underscore is a key's spelling, not a word. */
export function columnLabel(key: GearSortKey): string {
  if (key === 'RATIO') return 'Ratio'
  if (key === 'name') return 'Item'
  return key.replace(/_/g, ' ')
}

function column(key: GearSortKey): GearColumn {
  return { key, label: columnLabel(key), percent: PERCENT_KEYS.has(key) }
}

/**
 * EVERY KEY THE PICKER OFFERS, in the corpus's own order with `RATIO` standing beside the two
 * numbers it is made of. Thirty-three: the thirty-two indexed stats — the seven attributes, the
 * pools, the regens, Attack, Haste, the ten saves, the weapon block and weight — plus the derived
 * ratio. `name` is NOT in it: the item column is not optional, it is what a row IS.
 *
 * DERIVED FROM `GEAR_STAT_KEYS`, never re-typed. A rescrape that widens the vector widens the
 * picker in the same commit, which is the only way "all stats" can stay true.
 */
export const PICKABLE_COLUMNS: readonly GearSortKey[] = GEAR_STAT_KEYS.flatMap<GearSortKey>((key) =>
  key === 'DELAY' ? [key, 'RATIO'] : [key]
)

/**
 * The numeric columns for these filters and this sort: the core, then every thresholded stat, then
 * the sort key — deduped, in that order, capped at `MAX_DERIVED_COLUMNS` derived entries.
 *
 * ORDER IS STABLE ON PURPOSE. The core never moves, so adding a threshold appends a column instead
 * of re-arranging the four the eye has already learned; and a sort key that is already a core
 * column adds nothing at all.
 *
 * THIS IS THE SEED THE PICKER STARTS FROM (JOS-297), and it still runs whenever no explicit choice
 * is stored — see `columnsFor`.
 */
export function visibleColumns(filters: GearFilters, sort: GearSort): GearColumn[] {
  const keys: GearSortKey[] = [...CORE_COLUMNS]
  const derived: GearSortKey[] = [...filters.thresholds.map((t) => t.key), sort.key]
  for (const key of derived) {
    if (key === 'name' || keys.includes(key)) continue
    if (keys.length - CORE_COLUMNS.length >= MAX_DERIVED_COLUMNS) break
    keys.push(key)
  }
  return keys.map(column)
}

/**
 * THE COLUMNS ON SCREEN. `null` means nothing has been chosen, so the derivation above answers;
 * anything else — INCLUDING an empty array — is the user's own list and wins outright.
 *
 * An explicit list is NOT re-seeded with the core or with the thresholds. That is the whole
 * meaning of "explicit": a player who removed AC removed AC, and an app that quietly put it back
 * whenever a filter mentioned it would be arguing with a checkbox it drew itself.
 */
export function columnsFor(
  chosen: readonly GearSortKey[] | null,
  filters: GearFilters,
  sort: GearSort
): GearColumn[] {
  return chosen === null ? visibleColumns(filters, sort) : chosen.map(column)
}

/**
 * THE SORT, CONFINED TO WHAT IS ON SCREEN. Removing the column you were sorting by must not leave
 * the table ordered by an invisible number with no lit header to explain it — so the sort falls to
 * the first remaining column, or to the item name when the user asked for no numeric columns.
 *
 * IDENTITY-PRESERVING when the sort is already on a drawn column, so the memo chain downstream
 * re-runs when the sort MOVES and never merely because it rendered.
 */
export function sortWithin(sort: GearSort, columns: readonly GearColumn[]): GearSort {
  if (sort.key === 'name' || columns.some((c) => c.key === sort.key)) return sort
  const first = columns[0]
  return first === undefined ? { key: 'name', dir: 'asc' } : { key: first.key, dir: 'desc' }
}

/** One numeric column's width, as the percentage string the header cell states. */
export function numericWidth(count: number): string {
  const each = count > 0 ? NUMERIC_BUDGET / count : NUMERIC_BUDGET
  return `${String(Math.max(MIN_NUMERIC_WIDTH, Math.round(each * 10) / 10))}%`
}

/**
 * WHAT EVERY COLUMN STATES AS ITS WIDTH, and whether the table has a floor of its own.
 *
 * `minWidth` is 0 in percentage mode — the table IS the pane, and nothing can overflow it. Past
 * `MAX_PERCENT_COLUMNS` it is the summed pixel width, which the table states as a MINIMUM (never a
 * width): a pane wider than the set still fills, a pane narrower than it scrolls horizontally
 * INSIDE its own box. `tableLayout: fixed` and the fixed row height are untouched by either mode —
 * the windowing hook's contract does not know widths exist.
 */
export interface GearTableLayout {
  mode: 'percent' | 'pixel'
  /** the table's own floor in px, or 0 when percentages are doing the work */
  minWidth: number
  /** `undefined` in percentage mode: the item column takes whatever the stated ones leave */
  name: string | undefined
  slot: string
  classes: string
  numeric: string
  owned: string
}

export function gearTableLayout(count: number, hasOwned: boolean): GearTableLayout {
  if (count <= MAX_PERCENT_COLUMNS) {
    return {
      mode: 'percent',
      minWidth: 0,
      name: undefined,
      slot: SLOT_COLUMN_WIDTH,
      classes: CLASS_COLUMN_WIDTH,
      numeric: numericWidth(count),
      owned: OWNED_COLUMN_WIDTH
    }
  }
  return {
    mode: 'pixel',
    minWidth: PX.name + PX.slot + PX.classes + count * PX.numeric + (hasOwned ? PX.owned : 0),
    name: `${String(PX.name)}px`,
    slot: `${String(PX.slot)}px`,
    classes: `${String(PX.classes)}px`,
    numeric: `${String(PX.numeric)}px`,
    owned: `${String(PX.owned)}px`
  }
}

/**
 * A cell's text. ABSENT RENDERS BLANK, never `0` and never a dash: the vector omits a key the item
 * never stated (law 1), and printing `0` would be this table inventing a stat line the wiki does
 * not have. A blank cell in a dense numeric grid reads as "states none", which is what it means.
 */
export function statText(value: number | undefined, key: GearSortKey): string {
  if (value === undefined) return ''
  if (key === 'RATIO') return value.toFixed(2)
  if (key === 'WEIGHT') return value.toFixed(1)
  if (PERCENT_KEYS.has(key)) return `${String(value)}%`
  return String(value)
}

/** The stat keys a column list draws, for a caller that only needs the vector keys. */
export function statKeysOf(columns: readonly GearColumn[]): GearStatKey[] {
  return columns.flatMap((c) => (c.key === 'name' || c.key === 'RATIO' ? [] : [c.key]))
}
