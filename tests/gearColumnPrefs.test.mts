// GEAR TAB — the column picker, the configurable filter bar, and the width law that holds when a
// chosen set is wider than the pane (JOS-297). Pure model only: `gearColumns.ts` and `gearPrefs.ts`
// touch no React, no storage and no IPC, so they run under the node runner like `gearFilter` before
// them.
//
// WHAT THIS FILE IS FOR, in one sentence per claim the ticket makes:
//
//   1. THE PICKER PERSISTS, AND EXPLICIT BEATS DERIVED. A stored choice wins outright, an absent
//      key falls back to the derived seed, and a stored EMPTY list is a choice rather than an
//      absence — the one distinction a naive `?? []` would erase.
//   2. EVERY EXPOSED KEY SORTS. The picker offers thirty-three keys and every one of them is a
//      working sort axis in BOTH directions, with an absent value LAST either way — which is the
//      property that makes "expose it on every header" safe rather than a promise.
//   3. THE WIDTHS FIT OR THE TABLE SCROLLS. Percentages while they can serve the set at a legible
//      floor, stated pixels plus a table minimum past that — and the pixel total is what the pane
//      scrolls sideways INSIDE itself. The e2e measures the scrolling; this measures the numbers.
//   4. A HIDDEN CONTROL IS NOT FILTERING. `inertFilters` is asserted field by field, including the
//      one whose inert value is NOT its default (era ships ON).
//
// The row fixtures here are SYNTHETIC, unlike `gearFilter.test.mts`'s: nothing below asserts a
// number the corpus states, only that the model treats every key in the vocabulary alike. Using
// two real items would have meant hand-writing thirty-three stats twice for no extra proof.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEAR_STAT_KEYS, type GearRow, type GearStats } from '../src/shared/planner/gear'
import {
  CORE_COLUMNS,
  MAX_PERCENT_COLUMNS,
  PICKABLE_COLUMNS,
  columnsFor,
  gearTableLayout,
  sortWithin,
  visibleColumns
} from '../src/renderer/src/features/gear/gearColumns'
import {
  DEFAULT_GEAR_FILTERS,
  DEFAULT_GEAR_SORT,
  sortGearRows,
  sortValue,
  type GearFilters,
  type GearSort,
  type GearSortKey
} from '../src/renderer/src/features/gear/gearFilter'
import {
  GEAR_CONTROLS,
  GEAR_CONTROL_LABEL,
  controlsVisible,
  inertFilters,
  sanitizeColumns,
  sanitizeControls,
  toggleColumn,
  toggleControl
} from '../src/renderer/src/features/gear/gearPrefs'

// =================================================================================
// FIXTURES
// =================================================================================

function row(name: string, stats: GearStats): GearRow {
  return {
    key: name.toLowerCase(),
    name,
    searchKey: name.toLowerCase(),
    slots: [],
    classes: [],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats,
    effects: []
  }
}

/** Every indexed key at `n`, with DELAY forced so the derived RATIO moves the same way DMG does. */
function everyStat(n: number, delay: number): GearStats {
  const out: GearStats = {}
  for (const key of GEAR_STAT_KEYS) out[key] = n
  out.DELAY = delay
  return out
}

/** High (ratio 2.0), low (ratio 0.25), and a row that states nothing at all. */
const HIGH = row('High', everyStat(20, 10))
const LOW = row('Low', everyStat(5, 20))
const NONE = row('None', {})
const ROWS: readonly GearRow[] = [NONE, HIGH, LOW]

function filters(over: Partial<GearFilters> = {}): GearFilters {
  return { ...DEFAULT_GEAR_FILTERS, ...over }
}

// =================================================================================
// 1. THE PICKER: EXPLICIT BEATS DERIVED, AND ABSENT IS NOT EMPTY
// =================================================================================

test('no stored choice means the columns are DERIVED, exactly as the shipped tab derived them', () => {
  const derived = columnsFor(null, filters({ thresholds: [{ key: 'HP_REGEN', min: 2 }] }), DEFAULT_GEAR_SORT)
  assert.deepEqual(
    derived.map((c) => c.key),
    visibleColumns(filters({ thresholds: [{ key: 'HP_REGEN', min: 2 }] }), DEFAULT_GEAR_SORT).map((c) => c.key),
    'the seed is the same function the tab already used'
  )
  assert.deepEqual(derived.map((c) => c.key), [...CORE_COLUMNS, 'HP_REGEN'])
})

test('an explicit choice WINS - it is not re-seeded with the core or with the thresholds', () => {
  const chosen: GearSortKey[] = ['STR', 'CHA']
  // A threshold on HP_REGEN and a sort on AC: under the derivation BOTH would draw a column.
  const columns = columnsFor(chosen, filters({ thresholds: [{ key: 'HP_REGEN', min: 2 }] }), DEFAULT_GEAR_SORT)
  assert.deepEqual(columns.map((c) => c.key), chosen, 'exactly what was asked for, in that order')
  assert.ok(!columns.some((c) => c.key === 'AC'), 'a core column the user removed stays removed')
  assert.ok(!columns.some((c) => c.key === 'HP_REGEN'), 'a threshold cannot conjure a column back')
})

test('a stored EMPTY list is a CHOICE, and never the same thing as no choice at all', () => {
  assert.deepEqual(sanitizeColumns([]), [], 'an empty array survives as an empty array')
  assert.equal(sanitizeColumns(null), null, 'nothing stored stays nothing stored')
  assert.equal(sanitizeColumns(undefined), null)
  assert.deepEqual(columnsFor([], filters(), DEFAULT_GEAR_SORT), [], 'chosen-none draws no numeric columns')
  assert.ok(
    columnsFor(null, filters(), DEFAULT_GEAR_SORT).length > 0,
    'while stored-nothing still draws the derived core - the two must never fold together'
  )
})

test('a stored choice DEGRADES rather than erroring, whatever another build wrote', () => {
  assert.equal(sanitizeColumns('AC,HP'), null, 'a string is not a choice')
  assert.equal(sanitizeColumns({ AC: true }), null, 'nor is an object')
  assert.deepEqual(sanitizeColumns(['AC', 'NOT_A_STAT', 'name', 42, 'HP']), ['AC', 'HP'], 'unknown keys drop out')
  assert.deepEqual(sanitizeColumns(['HP', 'AC', 'HP']), ['HP', 'AC'], 'repeats collapse, stored order survives')
  assert.deepEqual(sanitizeColumns(['RATIO']), ['RATIO'], 'the derived ratio is a pickable column')
})

test('the picker offers the WHOLE vocabulary - every indexed stat, plus ratio, and never the name', () => {
  assert.equal(PICKABLE_COLUMNS.length, GEAR_STAT_KEYS.length + 1)
  for (const key of GEAR_STAT_KEYS) assert.ok(PICKABLE_COLUMNS.includes(key), `${key} is offered`)
  assert.ok(PICKABLE_COLUMNS.includes('RATIO'))
  assert.ok(!PICKABLE_COLUMNS.includes('name' as GearSortKey), 'the item column is not optional')
  // The seven attributes the owner named by hand, on screen without inventing a threshold for each.
  for (const key of ['STR', 'STA', 'AGI', 'DEX', 'WIS', 'INT', 'CHA'] as const) {
    assert.ok(PICKABLE_COLUMNS.includes(key), `${key} is one click away`)
  }
})

test('a toggle keeps VOCABULARY order, and the first click promotes the seed unchanged but for it', () => {
  const seed: GearSortKey[] = [...CORE_COLUMNS]
  const added = toggleColumn(seed, 'STR')
  assert.ok(added.includes('STR'))
  for (const key of seed) assert.ok(added.includes(key), `${key} survived the promotion`)
  // STR comes before HP and MP in the corpus's order, so the result is re-ordered, not appended.
  assert.deepEqual(added, PICKABLE_COLUMNS.filter((k) => added.includes(k)))
  assert.deepEqual(toggleColumn(added, 'STR'), seed.slice().sort((a, b) => order(a) - order(b)))
})

function order(key: GearSortKey): number {
  return PICKABLE_COLUMNS.indexOf(key)
}

// =================================================================================
// 2. EVERY EXPOSED KEY SORTS, IN BOTH DIRECTIONS, WITH ABSENT LAST
// =================================================================================

test('every key the picker offers is a working sort axis - the exposure IS the sortability', () => {
  for (const key of PICKABLE_COLUMNS) {
    assert.notEqual(sortValue(HIGH, key), undefined, `${key} reads a number off a row that states it`)
    assert.equal(sortValue(NONE, key), undefined, `${key} reads nothing off a row that states none`)
  }
})

test('every exposed key ranks BOTH ways, and an absent value sorts LAST either way', () => {
  for (const key of PICKABLE_COLUMNS) {
    for (const dir of ['desc', 'asc'] as const) {
      const sort: GearSort = { key, dir }
      const values = sortGearRows(ROWS, sort).map((r) => sortValue(r, key))
      const firstAbsent = values.findIndex((v) => v === undefined)
      assert.ok(
        firstAbsent !== -1 && values.slice(firstAbsent).every((v) => v === undefined),
        `${key} ${dir}: a row stating none must never outrank one that states a number`
      )
      const stated = values.slice(0, firstAbsent) as number[]
      assert.equal(stated.length, 2, `${key} ${dir}: both stating rows survived`)
      const ranked = dir === 'desc' ? stated[0] >= stated[1] : stated[0] <= stated[1]
      assert.ok(ranked, `${key} ${dir}: ${String(stated[0])} then ${String(stated[1])}`)
    }
  }
})

test('the sort is confined to what is DRAWN - removing the sorted column moves the lit header', () => {
  const shown = columnsFor(['STR', 'CHA'], filters(), DEFAULT_GEAR_SORT)
  const kept: GearSort = { key: 'STR', dir: 'asc' }
  assert.equal(sortWithin(kept, shown), kept, 'a sort on a drawn column is returned UNCHANGED - same object')
  assert.deepEqual(sortWithin({ key: 'AC', dir: 'desc' }, shown), { key: 'STR', dir: 'desc' }, 'it falls to the first drawn column')
  assert.deepEqual(sortWithin({ key: 'AC', dir: 'desc' }, []), { key: 'name', dir: 'asc' }, 'no numeric columns leaves the item name')
  const byName: GearSort = { key: 'name', dir: 'asc' }
  assert.equal(sortWithin(byName, []), byName, 'the item column is always drawn, so a name sort always holds')
})

// =================================================================================
// 3. THE WIDTHS: PERCENTAGES WHILE THEY FIT, PIXELS WHEN THEY DO NOT
// =================================================================================

test('the derived cap and the percentage floor are the SAME number - nothing the tab could draw before changes', () => {
  const widest = columnsFor(null, filters({ thresholds: GEAR_STAT_KEYS.slice(0, 12).map((key) => ({ key, min: 1 })) }), DEFAULT_GEAR_SORT)
  assert.ok(widest.length <= MAX_PERCENT_COLUMNS, `${String(widest.length)} derived columns stay inside the budget`)
  assert.equal(gearTableLayout(widest.length, true).mode, 'percent')
})

test('percentage mode states percentages that FIT the pane, with the item column absorbing the slack', () => {
  for (const count of [1, 4, 7, MAX_PERCENT_COLUMNS]) {
    const layout = gearTableLayout(count, true)
    assert.equal(layout.mode, 'percent')
    assert.equal(layout.minWidth, 0, 'nothing can overflow a table that IS the pane')
    assert.equal(layout.name, undefined, 'the item column states no width - it takes what is left')
    const stated =
      count * Number(layout.numeric.replace('%', '')) +
      Number(layout.slot.replace('%', '')) +
      Number(layout.classes.replace('%', '')) +
      Number(layout.owned.replace('%', ''))
    assert.ok(stated <= 100, `${String(count)} columns state ${String(stated)}% - the name column needs the rest`)
    assert.ok(stated < 100, 'and there is always something left for the name')
  }
})

test('past the floor the layout switches to PIXELS and states a table minimum - which is what scrolls', () => {
  const narrow = gearTableLayout(MAX_PERCENT_COLUMNS, false)
  const wide = gearTableLayout(MAX_PERCENT_COLUMNS + 1, false)
  assert.equal(narrow.mode, 'percent')
  assert.equal(wide.mode, 'pixel')
  assert.ok(wide.minWidth > 0, 'the table now has a floor of its own')
  assert.notEqual(wide.name, undefined, 'and every column states a width, because the SUM is the point')

  // The floor GROWS with the set: that is the whole mechanism by which a wide choice overflows.
  const wider = gearTableLayout(MAX_PERCENT_COLUMNS + 10, false)
  assert.ok(wider.minWidth > wide.minWidth)
  // …and the Owned column, which is not a numeric and not in the shared budget, pays its own way.
  assert.ok(gearTableLayout(20, true).minWidth > gearTableLayout(20, false).minWidth)

  // A full-vocabulary pick is wider than any window this app runs in - the case the ticket names.
  const everything = gearTableLayout(PICKABLE_COLUMNS.length, true)
  assert.equal(everything.mode, 'pixel')
  assert.ok(everything.minWidth > 2500, `all 33 columns state ${String(everything.minWidth)}px`)
})

// =================================================================================
// 4. THE CONFIGURABLE TOOLBAR: A HIDDEN CONTROL IS NOT FILTERING
// =================================================================================

test('no stored toolbar choice shows every control, and a stored EMPTY one shows none', () => {
  assert.equal(controlsVisible(null).size, GEAR_CONTROLS.length)
  assert.equal(controlsVisible([]).size, 0, 'an empty choice is a choice')
  assert.equal(controlsVisible(['era']).size, 1)
})

test('a stored toolbar choice degrades the same way a column choice does', () => {
  assert.equal(sanitizeControls('era'), null)
  assert.deepEqual(sanitizeControls(['era', 'nope', 'era', 7, 'slot']), ['era', 'slot'])
  assert.deepEqual(sanitizeControls([]), [])
  assert.deepEqual(toggleControl(['era'], 'slot'), ['slot', 'era'], 'the bar draws slot before era, so the list does too')
  assert.deepEqual(toggleControl(['slot', 'era'], 'era'), ['slot'])
  for (const control of GEAR_CONTROLS) {
    assert.ok(GEAR_CONTROL_LABEL[control].length > 0, `${control} has words in the picker`)
  }
})

test('a control that is not on screen is not filtering either - every field goes INERT', () => {
  const busy = filters({
    slot: 'PRIMARY',
    effect: 'proc',
    classes: ['PAL'],
    classOnly: true,
    eraOnly: true,
    ownedOnly: true,
    minRatio: 1.5,
    thresholds: [{ key: 'HP', min: 50 }],
    text: 'thelvorn'
  })
  const hidden = inertFilters(busy, controlsVisible([]))
  assert.equal(hidden.slot, null)
  assert.equal(hidden.effect, 'any')
  assert.deepEqual(hidden.classes, [])
  assert.equal(hidden.classOnly, false)
  assert.equal(hidden.ownedOnly, false)
  assert.equal(hidden.minRatio, null)
  assert.deepEqual(hidden.thresholds, [])
  // INERT, NOT DEFAULT. The era filter SHIPS ON, so its default would still be hiding rows behind a
  // control nobody can see - which is the exact failure this function exists to prevent.
  assert.equal(DEFAULT_GEAR_FILTERS.eraOnly, true, 'era is on by default')
  assert.equal(hidden.eraOnly, false, 'and inert when its chip is gone')
  // SEARCH IS NEVER HIDDEN, so the text is never touched.
  assert.equal(hidden.text, 'thelvorn')
})

test('a control that IS on screen keeps its value untouched, one at a time', () => {
  const busy = filters({ slot: 'PRIMARY', eraOnly: true, minRatio: 1.5, thresholds: [{ key: 'HP', min: 50 }] })
  assert.equal(inertFilters(busy, controlsVisible(['slot'])).slot, 'PRIMARY')
  assert.equal(inertFilters(busy, controlsVisible(['era'])).eraOnly, true)
  assert.equal(inertFilters(busy, controlsVisible(['ratio'])).minRatio, 1.5)
  assert.deepEqual(inertFilters(busy, controlsVisible(['thresholds'])).thresholds, [{ key: 'HP', min: 50 }])
  // The whole bar visible is the identity the shipped tab has always had.
  const all = inertFilters(busy, controlsVisible(null))
  assert.deepEqual(all, busy)
})

test('hiding the threshold control also takes the columns it was deriving - one statement, not two', () => {
  const busy = filters({ thresholds: [{ key: 'HP_REGEN', min: 2 }] })
  const shown = columnsFor(null, inertFilters(busy, controlsVisible(['slot'])), DEFAULT_GEAR_SORT)
  assert.deepEqual(shown.map((c) => c.key), [...CORE_COLUMNS], 'no threshold, no derived column')
})
