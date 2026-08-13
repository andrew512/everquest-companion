// GEAR SETS — the cell model, the per-item plus-state, the totals and the diff (JOS-286, phase 5).
//
// Pure model only: `shared/planner/gearSet.ts` and `gearSetTotals.ts` touch no React, no storage
// and no IPC, so they run under the node runner exactly like `gearFilter` and `gearOwnership`
// before them.
//
// WHAT THIS FILE IS FOR, in four sentences:
//
//  1. A SET IS A CELL MAP AND ASSIGNING DISPLACES. `PLAN_SLOTS` is the model — two ears, two
//     wrists, two rings, two any-slots — so a third ring has to take somebody's place, and the
//     displaced item has to be REPORTED rather than dropped on the floor.
//  2. THE UPLIFT IS APPLIED PER ASSIGNMENT. `sumGear` refused to apply the ` +N` uplift because a
//     dump names an item and only a suffix says what state it is in (its own header). A set states
//     the state, so the totals here are `scaleGearStats` at EACH assignment's own plus-state — and
//     the test proves it by asking phase 0's `scalePrimary` directly rather than typing a number.
//  3. THE PERCENT REFUSAL SURVIVES. `HASTE` is spelled back out with its `%`, so `sumGear`'s
//     `statInteger` refuses it and it lands in `unsummed` as the individual values. A set that
//     totalled haste would be inventing a stacking rule no source in this repo states (law 6).
//  4. THE DIFF IS AGAINST THE REAL BODY. The equipped side is built from `equippedHosts` over the
//     COMMITTED 295-line dump, so the comparison is exercised against the same twenty-four rows
//     the character sheet and the planner's Inventory tab read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { normalizeStatKey, scaleFlat, scalePrimary, type ItemUpgradeState } from '../src/shared/itemUpgrade'
import { GEAR_STAT_KEYS, type GearRow } from '../src/shared/planner/gear'
import { equippedHosts } from '../src/shared/planner/inventorySlots'
import {
  assignToCell,
  assignedCount,
  assignmentAt,
  cellForItem,
  cellsForItem,
  clearCell,
  emptyGearSet,
  filledCells,
  setCells,
  withCellState,
  type GearSet
} from '../src/shared/planner/gearSet'
import {
  GEAR_STAT_SPELLING,
  assignmentBlock,
  assignmentStats,
  equippedRead,
  gearSetDiff,
  gearSetTotals,
  statBlockFromVector
} from '../src/shared/planner/gearSetTotals'
import { PLAN_SLOTS } from '../src/shared/planner/types'

// =================================================================================
// FIXTURES
// =================================================================================

function row(over: Partial<GearRow> & Pick<GearRow, 'key' | 'name'>): GearRow {
  return {
    searchKey: over.name.toLowerCase(),
    slots: [],
    classes: [],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats: {},
    effects: [],
    ...over
  }
}

/** Thelvorn's base vector, as `tests/gearIndex.test.mts` asserts the corpus states it. */
const THELVORN = row({
  key: 'thelvorn, blade of light',
  name: 'Thelvorn, Blade of Light',
  slots: ['PRIMARY'],
  stats: { WIS: 15, DMG: 20, DELAY: 26, WEIGHT: 3 }
})

/** A ring, so the paired-cell rule has something to fill both fingers with. */
const RING = row({
  key: 'ring of pureblood',
  name: 'Ring of Pureblood',
  slots: ['FINGER'],
  stats: { AC: 5, STR: 4, HP: 20 }
})

const RING2 = row({
  key: 'ring of the shissar',
  name: 'Ring of the Shissar',
  slots: ['FINGER'],
  stats: { AC: 3, STA: 12 }
})

const RING3 = row({ key: 'band of steel', name: 'Band of Steel', slots: ['FINGER'], stats: { AC: 2 } })

/**
 * The two haste items whose stacking no source states — the refusal's fixture. HANDS before WAIST
 * is the board order (`PLAN_SLOTS`), which is the order the unsummed list states them in.
 */
const HASTE_A = row({ key: 'haste gloves', name: 'Haste Gloves', slots: ['HANDS'], stats: { HASTE: 36, AC: 8 } })
const HASTE_B = row({ key: 'haste belt', name: 'Haste Belt', slots: ['WAIST'], stats: { HASTE: 21 } })

const CORPUS = [THELVORN, RING, RING2, RING3, HASTE_A, HASTE_B]
const lookup = (key: string): GearRow | undefined => CORPUS.find((r) => r.key === key)

function freshSet(): GearSet {
  return emptyGearSet('set-1', 'Set 1', 1_754_200_000_000)
}

/** Assign a row into its natural cell, the way the `+` on a search row does. */
function add(set: GearSet, item: GearRow, state?: ItemUpgradeState): GearSet {
  return assignToCell(set, cellForItem(set, item.slots), assignmentAt(item, state)).set
}

// =================================================================================
// THE CELL MODEL
// =================================================================================

test('the cell model IS `PLAN_SLOTS` — no second opinion about how many ears you have', () => {
  assert.deepEqual(setCells(freshSet()).map((c) => c.cell), [...PLAN_SLOTS])
  assert.equal(setCells(freshSet()).length, 23)
  assert.equal(assignedCount(freshSet()), 0)
})

test('an item is offered its own slot`s cells first and the two any-slots last (JOS-104)', () => {
  assert.deepEqual(cellsForItem(['FINGER']), ['FINGER', 'FINGER2', 'ANY1', 'ANY2'])
  assert.deepEqual(cellsForItem(['PRIMARY']), ['PRIMARY', 'ANY1', 'ANY2'])
  // A two-slot item offers both, in board order, deduped.
  assert.deepEqual(cellsForItem(['SECONDARY', 'PRIMARY']), ['SECONDARY', 'PRIMARY', 'ANY1', 'ANY2'])
  // An item the corpus places nowhere still has the two places that constrain nothing.
  assert.deepEqual(cellsForItem([]), ['ANY1', 'ANY2'])
})

test('rings fill FINGER, FINGER2, then the two any-slots — and the fifth displaces the first', () => {
  const one = add(freshSet(), RING)
  assert.equal(one.slots.FINGER?.key, RING.key)
  const two = add(one, RING2)
  assert.equal(two.slots.FINGER?.key, RING.key, 'the first ring stays put')
  assert.equal(two.slots.FINGER2?.key, RING2.key)

  // Both fingers are taken and the game gives two places that constrain nothing (JOS-104), so the
  // third and fourth land THERE rather than displacing anybody. That is the game's own answer.
  const four = add(add(two, RING3), RING3)
  assert.deepEqual(filledCells(four).map((c) => c.cell), ['FINGER', 'FINGER2', 'ANY1', 'ANY2'])

  // Now there is genuinely nowhere free, so the FIRST candidate takes the hit. Refusing would
  // leave the user's click doing nothing at all, which is the one answer nobody can debug.
  const cell = cellForItem(four, RING3.slots)
  assert.equal(cell, 'FINGER')
  const { set: five, displaced } = assignToCell(four, cell, assignmentAt(RING3))
  assert.equal(five.slots.FINGER?.key, RING3.key)
  assert.equal(displaced?.key, RING.key, 'the displaced item must be reported, never dropped silently')
  assert.equal(assignedCount(five), 4, 'displacing does not grow the set')
})

test('clearing a cell removes the KEY, not just the value — and leaves the rest alone', () => {
  const set = add(add(freshSet(), RING), RING2)
  const cleared = clearCell(set, 'FINGER')
  assert.equal('FINGER' in cleared.slots, false)
  assert.equal(cleared.slots.FINGER2?.key, RING2.key)
  assert.deepEqual(filledCells(cleared).map((c) => c.cell), ['FINGER2'])
})

test('a plus-state is stored NORMALIZED, and a cell with nothing in it has no state to move', () => {
  const set = add(freshSet(), RING, { full: 3, fraction: 99 })
  // 2^3 - 1 = 7 is the ceiling the game's own item window states (normalizeUpgradeState).
  assert.deepEqual(set.slots.FINGER?.state, { full: 3, fraction: 7 })
  // Tier 0 banks nothing at all.
  assert.deepEqual(withCellState(set, 'FINGER', { full: 0, fraction: 5 }).slots.FINGER?.state, {
    full: 0,
    fraction: 0
  })
  assert.equal(withCellState(set, 'HEAD', { full: 4, fraction: 0 }), set, 'no item, no state')
})

// =================================================================================
// THE SPELLING TABLE (the inverse of phase 0's alias table)
// =================================================================================

test('every spelled key folds BACK to its own key through phase 0`s normalizeStatKey', () => {
  for (const [key, spelling] of Object.entries(GEAR_STAT_SPELLING)) {
    assert.equal(normalizeStatKey(spelling), key, `${spelling} must fold to ${key}`)
  }
})

test('every summable vector key HAS a spelling — a new stat cannot vanish out of the totals', () => {
  const structural = new Set(['AC', 'DMG', 'DELAY', 'DMG_BONUS', 'BACKSTAB', 'RANGE', 'WEIGHT'])
  for (const key of GEAR_STAT_KEYS) {
    if (structural.has(key)) continue
    assert.ok(GEAR_STAT_SPELLING[key] !== undefined, `${key} has no spelling and would be dropped`)
  }
})

test('the block splits saves from stats and keeps the structural numbers out of both', () => {
  const block = statBlockFromVector({ AC: 10, STR: 5, SV_FIRE: 7, DMG: 20, DELAY: 26, WEIGHT: 3 })
  assert.equal(block.ac, 10)
  assert.deepEqual(block.stats, [{ key: 'STR', value: '+5' }])
  assert.deepEqual(block.saves, [{ key: 'SV FIRE', value: '+7' }])
  assert.equal(block.dmg, 20)
  assert.equal(block.atkDelay, 26)
  assert.equal(block.weight, '3.0')
})

// =================================================================================
// THE TOTALS — the uplift, per assignment
// =================================================================================

test('the totals apply the uplift PER ASSIGNMENT, at each item`s own plus-state', () => {
  // Two rings, two different states. Neither number is typed here: both come from phase 0.
  const set = add(add(freshSet(), RING, { full: 5, fraction: 0 }), RING2, { full: 0, fraction: 0 })
  const totals = gearSetTotals(set, lookup)

  const at5: ItemUpgradeState = { full: 5, fraction: 0 }
  const wantAc = scalePrimary(5, at5) + 3
  const wantStr = scalePrimary(4, at5)
  const wantHp = scalePrimary(20, at5)

  assert.equal(totals.ac, wantAc, 'AC sums the SCALED ring and the base one')
  assert.equal(totals.stats.find((s) => s.label === 'Strength')?.total, wantStr)
  assert.equal(totals.stats.find((s) => s.label === 'HP')?.total, wantHp)
  assert.equal(totals.stats.find((s) => s.label === 'Stamina')?.total, 12, 'the base ring is unmoved')
  assert.equal(totals.counted, 2)
  assert.equal(totals.unknown, 0)

  // …and moving ONE cell's slider moves only that cell's contribution.
  const moved = gearSetTotals(withCellState(set, 'FINGER2', at5), lookup)
  assert.equal(moved.stats.find((s) => s.label === 'Stamina')?.total, scalePrimary(12, at5))
  assert.equal(moved.stats.find((s) => s.label === 'Strength')?.total, wantStr, 'the other ring did not move')
})

test('an upgraded item can contribute the SYNTHETIC SV VOID save (phase 0`s voidSynth)', () => {
  const synth = row({
    key: 'two triggers',
    name: 'Two Triggers',
    slots: ['HEAD'],
    stats: { STR: 12, STA: 9 },
    voidSynth: true
  })
  const set = assignToCell(freshSet(), 'HEAD', assignmentAt(synth, { full: 4, fraction: 0 })).set
  const totals = gearSetTotals(set, (k) => (k === synth.key ? synth : undefined))
  assert.equal(totals.saves.find((s) => s.label === 'SV Void')?.total, 4)
  // …and at base there is nothing to synthesize.
  assert.equal(gearSetTotals(add(freshSet(), synth), (k) => (k === synth.key ? synth : undefined)).saves.length, 0)
})

test('percent-valued stats are STATED, never added — sumGear`s refusal, reached unchanged', () => {
  const set = add(add(freshSet(), HASTE_A), HASTE_B)
  const totals = gearSetTotals(set, lookup)
  assert.equal(totals.stats.find((s) => s.label === 'Haste'), undefined, 'haste may never be a total')
  const haste = totals.unsummed.find((u) => u.label === 'Haste')
  assert.deepEqual(haste?.values, ['+36%', '+21%'], 'the individual values, in board order')
  // The rest of the item still sums normally — the refusal is per VALUE, not per item.
  assert.equal(totals.ac, 8)

  // …and the flat rule still applies to haste per item, which is why the values move with the
  // slider even though nothing adds them up.
  const merged = gearSetTotals(withCellState(set, 'HANDS', { full: 3, fraction: 0 }), lookup)
  assert.deepEqual(merged.unsummed.find((u) => u.label === 'Haste')?.values, [
    `+${String(scaleFlat(36, { full: 3, fraction: 0 }))}%`,
    '+21%'
  ])
})

test('an assignment the corpus cannot resolve is UNKNOWN and contributes to nothing', () => {
  const set = assignToCell(
    add(freshSet(), RING),
    'HEAD',
    assignmentAt({ key: 'djarns amethyst ring', name: 'Djarn`s Amethyst Ring' })
  ).set
  const totals = gearSetTotals(set, lookup)
  assert.equal(totals.counted, 1)
  assert.equal(totals.unknown, 1)
  assert.equal(totals.ac, 5, 'the unknown item added nothing')
})

test('a cell states its own contribution in the totals row`s words', () => {
  const stats = assignmentStats(assignmentBlock(THELVORN, { full: 2, fraction: 3 }))
  // WIS 15 at the owner's checkpoint is phase 0's answer, asked here rather than typed.
  assert.deepEqual(stats, [{ label: 'Wisdom', value: `+${String(scalePrimary(15, { full: 2, fraction: 3 }))}` }])
})

// =================================================================================
// THE DIFF — against the REAL equipped rows
// =================================================================================

const REAL_DUMP = readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
const WORN = equippedHosts(parseInventoryDump(REAL_DUMP)).map((h) => ({
  ...h,
  key: h.name.toLowerCase()
}))

test('the equipped read fills cells from the REAL dump, and says what it had to assume', () => {
  const read = equippedRead(WORN)
  assert.ok(filledCells(read.set).length >= 20, 'the committed dump wears twenty-plus things')
  // Every filled cell is a `PLAN_SLOTS` cell — `equippedHosts` already answers in that vocabulary.
  for (const { cell } of filledCells(read.set)) assert.ok(PLAN_SLOTS.includes(cell))
  // A ` +N` in the name becomes a whole-tier state; a name without one is read at BASE and counted.
  const stated = WORN.filter((h) => h.tier !== undefined)
  assert.ok(stated.length > 0, 'the owner has merged things')
  const first = stated[0]
  assert.deepEqual(read.set.slots[first.slot]?.state, { full: first.tier ?? 0, fraction: 0 })
  assert.equal(read.unstated, WORN.length - stated.length)
})

test('the diff states a difference, and an empty cell is not a proposal to strip you', () => {
  const worn = equippedRead(WORN)
  // A set holding ONE thing the character is not wearing: every number it states is a gain.
  const mine = add(freshSet(), RING, { full: 5, fraction: 0 })
  const totals = { set: gearSetTotals(mine, lookup), equipped: gearSetTotals(worn.set, lookup) }
  const diff = gearSetDiff(totals, { set: mine, equipped: worn.set })

  assert.equal(diff.cellsChanged, 1, 'only the cell the set names can change')
  assert.equal(diff.ac.set, scalePrimary(5, { full: 5, fraction: 0 }))
  assert.equal(diff.ac.delta, diff.ac.set - diff.ac.equipped)
  assert.ok(diff.changed > 0, 'a set the character is not wearing must state a difference')
  const str = diff.stats.find((r) => r.label === 'Strength')
  assert.equal(str?.delta, (str?.set ?? 0) - (str?.equipped ?? 0))
})

test('planning the SAME item at a HIGHER tier is a change — that is what a merge plan is', () => {
  const worn = equippedRead(WORN)
  const cell = filledCells(worn.set)[0]
  const same = assignToCell(freshSet(), cell.cell, cell.assignment).set
  const higher = withCellState(same, cell.cell, { full: cell.assignment.state.full + 1, fraction: 0 })

  const at = (set: GearSet): ReturnType<typeof gearSetDiff> =>
    gearSetDiff(
      { set: gearSetTotals(set, lookup), equipped: gearSetTotals(worn.set, lookup) },
      { set, equipped: worn.set }
    )
  assert.equal(at(same).cellsChanged, 0, 'the same item at the same tier changes nothing')
  assert.equal(at(higher).cellsChanged, 1)
})

test('the diff never touches the unsummed list — you cannot subtract what you cannot add', () => {
  const mine = add(freshSet(), HASTE_A)
  const worn = equippedRead(WORN)
  const totals = { set: gearSetTotals(mine, lookup), equipped: gearSetTotals(worn.set, lookup) }
  const diff = gearSetDiff(totals, { set: mine, equipped: worn.set })
  const labels = [diff.ac, ...diff.stats, ...diff.saves].map((r) => r.label)
  assert.equal(labels.includes('Haste'), false)
  // …and both sides still SAY what they carry.
  assert.deepEqual(totals.set.unsummed.find((u) => u.label === 'Haste')?.values, ['+36%'])
})
