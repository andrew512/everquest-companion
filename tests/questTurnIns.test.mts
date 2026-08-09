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
//      `completedQuests` entry floors the count at one and never counts as since-the-dump.
//   2. THE SUBTRACTION (features/inventory/reconcile.ts): N turn-ins eat N of everything the
//      quest required, the quest reads 0/N afterwards, and the copy you refarm afterwards SHOWS.
//   3. THE WINDOW (JOS-128's baseline, applied to consumption): a dump already reflects the
//      turn-ins made before it was written, so under a dump-reading count source only the
//      turn-ins since the baseline are still owed. This is the case that decides whether the
//      refarm is visible at all under 'inventory'/'both'.
//   4. THE FILTER (features/posky/questCompletion.ts): "hide completed" means has-every-item-now,
//      never has-ever-turned-in.
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
import { hasEveryItem } from '../src/renderer/src/features/posky/questCompletion'
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

test('a pre-JOS-131 store floors at one turn-in, and contributes NOTHING to the since count', () => {
  const legacy = progress({ completedQuests: [CLAW_KEY] })
  const resolved = resolveTurnIns(legacy, {}, 5000)
  assert.equal(resolved.all[CLAW_KEY], 1, 'the old flag is one real, undated turn-in')
  assert.equal(
    resolved.since?.[CLAW_KEY],
    0,
    'undated cannot be placed after a baseline, and inventing a date would be law 1 all over'
  )
})

test('since-the-baseline counts only the strictly later instants (JOS-128 rule, one definition)', () => {
  const stored = progress({ questTurnIns: { [CLAW_KEY]: [4000, 5000, 6000] } })
  const resolved = resolveTurnIns(stored, {}, 5000)
  assert.equal(resolved.all[CLAW_KEY], 3)
  assert.equal(resolved.since?.[CLAW_KEY], 1, 'the tie at the baseline goes to the dump')
  assert.equal(
    resolveTurnIns(stored, {}).since,
    undefined,
    'no baseline means no window at all, never a window starting at zero'
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

test('THE WINDOW: a dump-reading source does NOT re-subtract a turn-in the dump already saw', () => {
  // The story, in order: two claws looted and handed in at t=1000. `/outputfile inventory` at
  // t=5000 — the dump does not list them, because they are gone. One claw refarmed at t=6000.
  const BASELINE = 5000
  const shared = {
    log: { 'sphinx claw': 3, 'wind rune geza': 1 },
    logSince: { 'sphinx claw': 1 },
    inv: {},
    lootNames: { 'sphinx claw': 'Sphinx Claw' },
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 },
    turnInsSince: { [CLAW_KEY]: 0 }
  }
  for (const countSource of ['inventory', 'both'] as const) {
    const { net } = reconcile({ ...shared, countSource })
    assert.equal(
      net['sphinx claw'],
      1,
      `${countSource}: the refarmed claw survives — subtracting the pre-dump turn-in again would eat it`
    )
  }
  // The all-time log source owes all of them, because its base is all-time too. Same ledger,
  // opposite window, and both add up.
  const { net } = reconcile({ ...shared, countSource: 'log' })
  assert.equal(net['sphinx claw'], 1, 'log: 3 ever looted minus the 2 handed in')
  assert.equal(BASELINE, 5000)
})

test('a turn-in made SINCE the dump is still subtracted under a dump-reading source', () => {
  const { net } = reconcile({
    log: { 'sphinx claw': 2 },
    logSince: { 'sphinx claw': 2 },
    inv: {},
    lootNames: {},
    countSource: 'inventory',
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 },
    turnInsSince: { [CLAW_KEY]: 1 }
  })
  assert.equal(net['sphinx claw'], 0, 'looted after the dump, handed in after the dump')
})

test('with no baseline at all, nothing is windowed and the all-time counts apply', () => {
  const { net } = reconcile({
    log: { 'sphinx claw': 2 },
    inv: { 'sphinx claw': 2 },
    lootNames: {},
    countSource: 'both',
    quests: QUESTS,
    turnIns: { [CLAW_KEY]: 1 }
  })
  assert.equal(net['sphinx claw'], 0, 'pre-JOS-128 behaviour, unchanged by this ticket')
})

// =============================================================================
// 4 + 5. The filter's meaning, and the badge's copy
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

test('the badge counts from the second turn-in on', () => {
  assert.equal(turnInBadgeLabel(1), 'Turned in')
  assert.equal(turnInBadgeLabel(2), 'Turned in x2')
  assert.equal(turnInBadgeLabel(11), 'Turned in x11')
})
