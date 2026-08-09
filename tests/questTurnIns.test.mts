// ============================================================================
// JOS-131 — a Sky turn-in SUBTRACTS what it consumed, and COUNTS ITSELF.
// ============================================================================
//
// THE REPORT, in the owner's words (2026-08-09): a Sky farmer wants to run quests more than
// once, and today a completed quest stays 5/5 forever, so refarming a second copy is invisible.
// The design: a turn-in subtracts the turned-in items from the inventory model rather than
// pinning the quest at complete, a badge says how many times you have handed it in, and multiple
// turn-ins work by default.
//
// What this suite pins, all of it against the REAL pure production code:
//   1. THE LEDGER (shared/questTurnIns.ts): the log's turn-ins merged with the persisted ones by
//      INSTANT, so re-detecting a stored turn-in is one event and not two; a pre-JOS-131
//      `completedQuests` entry floors the count at one.
//   2. THE SUBTRACTION (features/inventory/reconcile.ts): N turn-ins eat N of everything the
//      quest required, the quest reads 0/N afterwards, and the copy you refarm afterwards SHOWS.
//   3. THE WINDOW, RE-DECIDED (JOS-141). JOS-131 windowed consumption by TIME: under a
//      dump-reading count source it subtracted only the turn-ins made after the dump was
//      generated, because JOS-128's reset had already taken the earlier ones out of the base.
//      The owner reverted that reset on 2026-08-09 (a dump only covers what was open when it was
//      written, so resetting to it ate banked Sky items), so the window is now by SOURCE: the LOG
//      is a record of what you ever LOOTED and still contains everything a turn-in ate, so it
//      owes all of them; a DUMP is an observation of what you are HOLDING and already has them
//      taken out, so it owes none. No generation instant is consulted anywhere.
//   4. THE FILTERS (features/posky/questCompletion.ts): "hide completed" means has-every-item-now,
//      never has-ever-turned-in — and since JOS-145 the other reading is a SECOND, independent box
//      (`everTurnedIn`) rather than a re-argument of the first, because a player farming each quest
//      once wants the done ones gone and a player refarming does not. The pair is pinned here as
//      two predicates that never read each other's input.
//   5. THE BADGE's copy, including the count from the second turn-in on.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TURN_INS_PER_QUEST,
  mergeTurnInInstants,
  resolveTurnIns,
  sanitizeTurnInInstants,
  sanitizeTurnInLedger,
  turnInBadgeLabel,
  turnInsToPersist
} from '../src/shared/questTurnIns'
import { everTurnedIn, hasEveryItem } from '../src/renderer/src/features/posky/questCompletion'
import { reconcile } from '../src/renderer/src/features/inventory/reconcile'
import { questKey } from '../src/renderer/src/features/posky/keys'
import { itemCountKey } from '../src/renderer/src/lib/itemName'
import type { PoskyQuest, ProgressState } from '../src/shared/types'

// A hand-built quest: the subtraction is arithmetic over the required counts, so a synthetic
// quest states the case far more clearly than a real one whose item list can be re-scraped.
const CLAW: PoskyQuest = {
  className: 'Beastlord',
  name: 'Test of Claw',
  giver: 'Gorgalosk',
  items: [
    { name: 'Sphinx Claw', count: 2, who: [], where: 'Island 4' },
    { name: 'Wind Rune Geza', count: 1, who: [], where: 'Island 1' }
  ]
}
const CLAW_KEY = questKey(CLAW)
const QUESTS = [CLAW]

const progress = (p: Partial<ProgressState>): ProgressState => ({
  inventory: {},
  completedQuests: [],
  ...p
})

// =============================================================================
// 1. The ledger: two sources, merged by instant
// =============================================================================

test('sanitize keeps whole non-negative instants, sorted and deduped, and drops the rest', () => {
  assert.deepEqual(
    sanitizeTurnInInstants([3000, 1000, 3000, -5, Number.NaN, 'x', null, 2000.7]),
    [1000, 2000, 3000]
  )
  assert.deepEqual(sanitizeTurnInInstants('not a list'), [])
  assert.equal(
    sanitizeTurnInInstants(Array.from({ length: 500 }, (_, i) => i + 1)).length,
    MAX_TURN_INS_PER_QUEST,
    'a renderer-supplied list is capped at the boundary, not trusted'
  )
})

test('a ledger drops keys left with nothing, so an emptied quest does not linger', () => {
  assert.deepEqual(sanitizeTurnInLedger({ a: [5], b: [], c: 'junk' }), { a: [5] })
  assert.deepEqual(sanitizeTurnInLedger(undefined), {})
})

test('THE MERGE: a stored turn-in re-detected in the log is ONE event, not two', () => {
  assert.deepEqual(mergeTurnInInstants([1000], [1000]), [1000])
  assert.deepEqual(mergeTurnInInstants([1000], [2000]), [1000, 2000])

  const stored = progress({ questTurnIns: { [CLAW_KEY]: [1000] }, completedQuests: [CLAW_KEY] })
  const detectedAgain = { [CLAW_KEY]: [1000] }
  assert.equal(
    resolveTurnIns(stored, detectedAgain).all[CLAW_KEY],
    1,
    'the identical instant is why this is a list of instants and not a tally'
  )
})

test('a SECOND turn-in of a quest already stored counts twice', () => {
  const stored = progress({ questTurnIns: { [CLAW_KEY]: [1000] }, completedQuests: [CLAW_KEY] })
  const resolved = resolveTurnIns(stored, { [CLAW_KEY]: [1000, 2000] })
  assert.equal(resolved.all[CLAW_KEY], 2)
  assert.deepEqual(resolved.instants[CLAW_KEY], [1000, 2000])
})

test('a pre-JOS-131 store floors at one turn-in', () => {
  const legacy = progress({ completedQuests: [CLAW_KEY] })
  assert.equal(resolveTurnIns(legacy, {}).all[CLAW_KEY], 1, 'the old flag is one real, undated turn-in')
})

test('the ledger answers ONE count, all time — there is no since-the-dump count (JOS-141)', () => {
  const stored = progress({ questTurnIns: { [CLAW_KEY]: [4000, 5000, 6000] } })
  const resolved = resolveTurnIns(stored, {})
  assert.equal(resolved.all[CLAW_KEY], 3)
  assert.deepEqual(Object.keys(resolved).sort(), ['all', 'instants'])
  assert.equal(
    resolveTurnIns.length,
    2,
    'and no baseline instant is passed in: the window is by source now, not by time'
  )
})

test('only the turn-ins the store is missing are written back', () => {
  const stored = progress({ questTurnIns: { [CLAW_KEY]: [1000] } })
  assert.deepEqual(turnInsToPersist(stored, { [CLAW_KEY]: [1000] }), [], 'settles, so no write loop')
  assert.deepEqual(turnInsToPersist(stored, { [CLAW_KEY]: [1000, 2000] }), [
    { key: CLAW_KEY, instants: [1000, 2000] }
  ])
})

// =============================================================================
// 2 + 3. The subtraction, and the window it happens in
// =============================================================================

/**
 * Mirror of `computeQuestProgress`'s per-item clamp (`have = min(need, net[countKey])`), kept off
 * the React-heavy useProgress module the bare test runner cannot load — the same division
 * tests/skyKeyringHeld.test.mts and tests/variantNormalization.test.mts already use. The
 * SUBTRACTION under test is all in `reconcile`, which is imported for real.
 */
function questItem(itemName: string, net: Record<string, number>): { have: number; need: number } {
  const it = CLAW.items.find((i) => i.name === itemName)
  assert.ok(it, `the quest requires ${itemName}`)
  const need = it.count > 0 ? it.count : 1
  return { have: Math.min(need, net[itemCountKey(it.name)] ?? 0), need }
}

/** The same clamp over every required item, which is what `missing` and `hasEveryItem` read. */
function missingItems(net: Record<string, number>): string[] {
  return CLAW.items.filter((it) => questItem(it.name, net).have < questItem(it.name, net).need).map(
    (it) => it.name
  )
}

/** What the tab shows for one item, through the REAL reconcile. */
function have(itemName: string, input: Parameters<typeof reconcile>[0]): { have: number; need: number } {
  return questItem(itemName, reconcile(input).net)
}

const LOG_ONLY = {
  inv: {},
  lootNames: { 'sphinx claw': 'Sphinx Claw' },
  countSource: 'log' as const,
  quests: QUESTS
}

test('THE HEADLINE: a turn-in subtracts what it consumed, so the quest reads 0 again', () => {
  const log = { 'sphinx claw': 2, 'wind rune geza': 1 }
  const before = have('Sphinx Claw', { ...LOG_ONLY, log, turnIns: {} })
  assert.deepEqual([before.have, before.need], [2, 2], 'ready to turn in')

  const after = have('Sphinx Claw', { ...LOG_ONLY, log, turnIns: { [CLAW_KEY]: 1 } })
  assert.deepEqual([after.have, after.need], [0, 2], 'the claws were handed over, so they are gone')
})

test('…and the copy you REFARM afterwards shows up, which is the whole ticket', () => {
  // Two claws looted, handed in; a third looted since.
  const log = { 'sphinx claw': 3, 'wind rune geza': 1 }
  const after = have('Sphinx Claw', { ...LOG_ONLY, log, turnIns: { [CLAW_KEY]: 1 } })
  assert.deepEqual([after.have, after.need], [1, 2], '1/2 toward running it a second time')
})

test('TWO turn-ins eat twice as much, and the row says which quest ate it, with the count', () => {
  const { rows, net } = reconcile({
    ...LOG_ONLY,
    log: { 'sphinx claw': 5, 'wind rune geza': 2 },
    turnIns: { [CLAW_KEY]: 2 }
  })
  const claw = rows.find((r) => r.key === 'sphinx claw')
  assert.ok(claw)
  assert.equal(claw.consumed, 4, '2 required x 2 turn-ins')
  assert.deepEqual(claw.consumedBy, ['Test of Claw x2'], 'a -4 row is traceable to one quest run twice')
  assert.equal(net['sphinx claw'], 1)
  assert.equal(net['wind rune geza'], 0, 'never negative: 2 held, 2 consumed')
})

test('consumption never drives a count negative', () => {
  const { net } = reconcile({ ...LOG_ONLY, log: { 'sphinx claw': 1 }, turnIns: { [CLAW_KEY]: 3 } })
  assert.equal(net['sphinx claw'], 0)
})

test('THE WINDOW IS BY SOURCE: a DUMP already reflects every turn-in, so it is never discounted', () => {
  // The story, in order: two claws looted and handed in. `/outputfile inventory` afterwards, with
  // the bank open this time, and the dump lists the ONE claw you refarmed since. Subtracting the
  // turn-in from that observation would be double-subtraction: the two it ate are already not in
  // the file, and the answer would be zero for a claw sitting in the player's bag.
  const shared = {
    log: { 'sphinx claw': 3, 'wind rune geza': 1 },
    inv: { 'sphinx claw': 1 },
    lootNames: { 'sphinx claw': 'Sphinx Claw' },
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 }
  }
  for (const countSource of ['inventory', 'both', 'log'] as const) {
    const { net } = reconcile({ ...shared, countSource })
    assert.equal(net['sphinx claw'], 1, `${countSource}: the refarmed claw shows`)
  }
  // The row says what it actually cost, and under the dump-only source that is nothing.
  const rows = reconcile({ ...shared, countSource: 'inventory' }).rows
  const claw = rows.find((r) => r.key === 'sphinx claw')
  assert.ok(claw)
  assert.deepEqual([claw.base, claw.consumed, claw.net], [1, 0, 1])
  assert.deepEqual(claw.consumedBy, [], 'nothing was taken off this row, so nothing is blamed for it')
})

test("…and a DUMP is a floor under 'both' that the log's turn-ins cannot dig through", () => {
  // The dump saw four claws; the log only ever saw two of them looted, and a turn-in ate two. A
  // max-then-subtract rule would answer 2 and delete two claws the game itself just listed.
  const { net, rows } = reconcile({
    log: { 'sphinx claw': 2 },
    inv: { 'sphinx claw': 4 },
    lootNames: {},
    countSource: 'both',
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 }
  })
  assert.equal(net['sphinx claw'], 4)
  const claw = rows.find((r) => r.key === 'sphinx claw')
  assert.ok(claw)
  assert.equal(claw.consumed, 0, 'the dump answered, so the turn-in cost this row nothing')
})

test('the combined count is MONOTONE in your own loot — one more claw never lowers it', () => {
  const base = {
    inv: { 'sphinx claw': 5 },
    lootNames: {},
    countSource: 'both' as const,
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 }
  }
  // This is why the log witness is discounted BEFORE the maximum rather than after: with
  // max-then-subtract, the answer here walks 5, 5, then 3 as the log passes the dump.
  const seen = [2, 4, 5, 6, 8].map(
    (looted) => reconcile({ ...base, log: { 'sphinx claw': looted } }).net['sphinx claw'] ?? 0
  )
  assert.deepEqual(seen, [5, 5, 5, 5, 6])
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'a count that falls when you loot something is indefensible')
  }
})

// =============================================================================
// 4 + 5. The two filters' meanings, and the badge's copy
// =============================================================================

test('"hide completed" means HAS EVERY ITEM NOW, never has-ever-turned-in', () => {
  assert.equal(hasEveryItem({ needCount: 3, missing: [] }), true, 'nothing left to farm')
  assert.equal(
    hasEveryItem({ needCount: 3, missing: ['Sphinx Claw'] }),
    false,
    'a quest you are refarming is work left, whatever its turn-in count says'
  )
  assert.equal(
    hasEveryItem({ needCount: 0, missing: [] }),
    false,
    'a quest that requires nothing is missing data, not finished'
  )
})

test('a turned-in quest is NOT hidden once its items are spent — the refarm stays visible', () => {
  const log = { 'sphinx claw': 2, 'wind rune geza': 1 }
  const needCount = CLAW.items.reduce((s, it) => s + (it.count > 0 ? it.count : 1), 0)

  const ready = reconcile({ ...LOG_ONLY, log, turnIns: {} }).net
  assert.equal(
    hasEveryItem({ needCount, missing: missingItems(ready) }),
    true,
    'holding everything: "hide completed" takes it off the list'
  )

  const spent = reconcile({ ...LOG_ONLY, log, turnIns: { [CLAW_KEY]: 1 } }).net
  assert.deepEqual(missingItems(spent), ['Sphinx Claw', 'Wind Rune Geza'], 'the turn-in spent them')
  assert.equal(
    hasEveryItem({ needCount, missing: missingItems(spent) }),
    false,
    'so it comes straight back onto the list, turn-in badge and all, by design'
  )
})

test('"hide turned in" means HAS EVER TURNED IN, and one turn-in is as done as ten (JOS-145)', () => {
  assert.equal(everTurnedIn({ turnIns: 0 }), false, 'never handed in is never hidden')
  assert.equal(everTurnedIn({ turnIns: 1 }), true, 'once is the whole threshold')
  assert.equal(everTurnedIn({ turnIns: 7 }), true, 'and there is no dial above it')
})

/**
 * THE ACCEPTANCE CASE, and the only reason JOS-145 exists as a second box rather than a re-argued
 * first one: ONE quest, refarmable and already handed in, which the two toggles must disagree
 * about. The turn-in count and the held items come from the real ledger and the real reconcile, so
 * this is the same quest state the tab would compute, not two hand-written booleans.
 */
test('a refarmable turned-in quest hides under the NEW box and NOT under the old one', () => {
  const log = { 'sphinx claw': 2, 'wind rune geza': 1 }
  const needCount = CLAW.items.reduce((s, it) => s + (it.count > 0 ? it.count : 1), 0)

  // Handed in once, so the log's items are spent and the quest is back to nothing held.
  const stored = progress({ questTurnIns: { [CLAW_KEY]: [1000] } })
  const turnIns = resolveTurnIns(stored, {}).all[CLAW_KEY]
  const net = reconcile({ ...LOG_ONLY, log, turnIns: { [CLAW_KEY]: turnIns } }).net
  const quest = { needCount, missing: missingItems(net), turnIns }

  assert.equal(quest.turnIns, 1)
  assert.equal(
    hasEveryItem(quest),
    false,
    'the OLD box leaves it on the list: every item it needs is gone from your bags'
  )
  assert.equal(
    everTurnedIn(quest),
    true,
    'the NEW box takes it off: you have run this quest, which is the question it asks'
  )
})

/**
 * The pair is INDEPENDENT, which is what "two boxes" has to mean. Neither predicate reads the
 * other's input, so all four tick combinations are a plain AND over two answers — the property a
 * tri-state or a shared key would quietly lose.
 */
test('the two hide-boxes never read each other: all four combinations are a plain AND', () => {
  // Holding everything AND never handed in: the pre-turn-in state, hidden only by the old box.
  const ready = { needCount: 3, missing: [], turnIns: 0 }
  // Handed in AND holding everything again: a full refarm, which BOTH boxes hide.
  const refarmed = { needCount: 3, missing: [], turnIns: 2 }
  // Handed in AND holding nothing: hidden only by the new box (the case above).
  const spent = { needCount: 3, missing: ['Sphinx Claw'], turnIns: 1 }
  // Neither: work in progress, which nothing hides.
  const fresh = { needCount: 3, missing: ['Sphinx Claw'], turnIns: 0 }

  const shown = (q: typeof ready, hideCompleted: boolean, hideTurnedIn: boolean): boolean =>
    !(hideCompleted && hasEveryItem(q)) && !(hideTurnedIn && everTurnedIn(q))

  assert.deepEqual(
    [ready, refarmed, spent, fresh].map((q) => [
      shown(q, false, false),
      shown(q, true, false),
      shown(q, false, true),
      shown(q, true, true)
    ]),
    [
      [true, false, true, false],
      [true, false, false, false],
      [true, true, false, false],
      [true, true, true, true]
    ]
  )
})

test('the badge counts from the second turn-in on', () => {
  assert.equal(turnInBadgeLabel(1), 'Turned in')
  assert.equal(turnInBadgeLabel(2), 'Turned in x2')
  assert.equal(turnInBadgeLabel(11), 'Turned in x11')
})
