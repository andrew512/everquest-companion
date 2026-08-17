// ============================================================================
// skyCleanup.test.mts — THE CLEANUP TAB'S WHOLE RULE, without a browser (JOS-389).
// ============================================================================
//
// The tab is a list of rows and a warning; the DECISION is `features/posky/cleanup.ts`, and it is
// the part that can be wrong in a way that costs a player an item. So every case the ticket named
// is driven here against the real module, and the SENTENCES are asserted too — the row's copy is
// produced by the model precisely so it can be pinned without a DOM.
//
// The five cases the brief asked for, in order below:
//   1. a shared item held while ANOTHER quest that needs it is un-turned-in — excluded
//   2. an item whose only quest was turned in twice, with enough in hand for one more set — K = 1
//   3. an item at have 3 / need 4 — the "X of Y" line rather than a "keep them"
//   4. a Dragon-Hoard-shaped extra dump lane — the place reads whatever the client called it
//   5. an override zeroing the count — the row leaves the list
//
// The dump case is SYNTHETIC and its test name says so, following `tests/carryAll.test.mts`: no
// dump anywhere carries hoard rows, so the subject is this module's classification of a shape and
// never a claim about what EverQuest prints.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { carryAll } from '../src/shared/carryAll'
import {
  CLEANUP_CAVEAT,
  cleanupRows,
  decisionLine,
  dumpLocationsFrom,
  locationsLine,
  placeLabel,
  rewardTierLine,
  setsLine,
  timesLine,
  turnInHeading,
  type CleanupQuest
} from '../src/renderer/src/features/posky/cleanup'

/** The Beastlord quest the e2e drives too: one drop, one rune, one reward. */
const AZARACK: CleanupQuest = {
  key: 'Beastlord::Beastlord Test of Azarack',
  className: 'Beastlord',
  name: 'Beastlord Test of Azarack',
  giver: 'Animist Kratho',
  reward: 'Azarack Skin Wristwraps',
  items: [
    { name: 'Azarack Skin', count: 1 },
    { name: 'Wind Rune Heda', count: 1 }
  ]
}

/** A second claimant on one drop — the shape `sharedItems.ts` maps, and case 1's whole subject. */
const CLAW_BEAST: CleanupQuest = {
  key: 'Beastlord::Test of Claw',
  className: 'Beastlord',
  name: 'Test of Claw',
  giver: 'Animist Kratho',
  reward: 'Claw Wristwraps',
  items: [{ name: 'Sphinx Claw', count: 1 }]
}
const CLAW_PALADIN: CleanupQuest = {
  key: 'Paladin::Test of Love',
  className: 'Paladin',
  name: 'Test of Love',
  giver: 'Priest of Marr',
  reward: 'Symbol of Love',
  items: [{ name: 'Sphinx Claw', count: 1 }]
}

// ---- 1. one un-turned-in claimant keeps the item off the screen -------------------------

test('a shared item is NOT listed while another quest that needs it has never been turned in', () => {
  const held = { 'sphinx claw': 3 }
  const stillWanted = cleanupRows(
    [CLAW_BEAST, CLAW_PALADIN],
    { [CLAW_BEAST.key]: 1, [CLAW_PALADIN.key]: 0 },
    held
  )
  assert.deepEqual(stillWanted, [], 'the Paladin has never run his, so the claws are not spare')

  // …and the moment the last claimant is handed in, the SAME holdings are listed. One rule, two
  // answers, so the exclusion above cannot be an accident of the fixture.
  const spare = cleanupRows(
    [CLAW_BEAST, CLAW_PALADIN],
    { [CLAW_BEAST.key]: 1, [CLAW_PALADIN.key]: 2 },
    held
  )
  assert.equal(spare.length, 1)
  assert.equal(spare[0].name, 'Sphinx Claw')
  assert.equal(spare[0].quantity, 3)
  // BOTH turn-ins are on the row: the point of the screen is what you would be giving up, and two
  // quests want this claw.
  assert.deepEqual(
    spare[0].turnIns.map((t) => [t.name, t.times]),
    [
      ['Test of Claw', 1],
      ['Test of Love', 2]
    ]
  )
})

test('the Wind Rune case: currency shared by every Test stays off the tab until every Test is run', () => {
  const rows = cleanupRows(
    [AZARACK, { ...CLAW_BEAST, items: [{ name: 'Wind Rune Heda', count: 1 }] }],
    { [AZARACK.key]: 3, [CLAW_BEAST.key]: 0 },
    { 'azarack skin': 2, 'wind rune heda': 9 }
  )
  assert.deepEqual(rows.map((r) => r.name), ['Azarack Skin'], 'nine runes are not spare')
})

// ---- 2. turned in twice, and the bags are good for one more run --------------------------

test('an item whose only quest was turned in twice, with a full set left, says KEEP and how many', () => {
  const rows = cleanupRows([AZARACK], { [AZARACK.key]: 2 }, { 'azarack skin': 3, 'wind rune heda': 1 })
  // BOTH held items are spare here, rune included: with this quest the only claimant on either and
  // the quest turned in, nothing un-run still wants them. The rune is only universal currency when
  // the OTHER 94 quests are in the set, which is the case the test above drives.
  assert.deepEqual(rows.map((r) => r.name), ['Azarack Skin', 'Wind Rune Heda'])
  const row = rows[0]
  assert.equal(row.key, 'azarack skin')
  assert.equal(row.quantity, 3)
  const [t] = row.turnIns
  assert.equal(t.times, 2)
  assert.equal(t.sets, 1, 'three skins and one rune is exactly one more turn-in')
  assert.equal(turnInHeading(t), 'Animist Kratho - Beastlord Test of Azarack (Beastlord)')
  assert.equal(timesLine(t), 'turned in 2 times')
  assert.equal(
    decisionLine(t),
    'keep them: turning in again gives another Azarack Skin Wristwraps, two Azarack Skin Wristwraps merge into +1'
  )
  assert.equal(setsLine(t), 'you hold enough for 1 more turn-in')
})

test('the set count is the MIN over the required items, so a missing rune is one short', () => {
  const rows = cleanupRows([AZARACK], { [AZARACK.key]: 1 }, { 'azarack skin': 4 })
  const [t] = rows[0].turnIns
  assert.equal(t.sets, 0, 'four skins and no rune is no turn-in at all')
  assert.equal(setsLine(t), null)
  assert.equal(t.have, 1, 'one skin counts toward the two items it asks for')
  assert.equal(t.need, 2)
  assert.equal(decisionLine(t), 'you hold 1 of the 2 needed for another turn-in')
})

test('two full sets read as two, and a quest wanting five per run needs ten for them', () => {
  const five: CleanupQuest = {
    key: 'Monk::Test of Wu',
    className: 'Monk',
    name: 'Test of Wu',
    giver: 'Master Wu',
    reward: 'Wu Fighting Belt',
    items: [{ name: 'Sphinx Claw', count: 5 }]
  }
  const rows = cleanupRows([five], { [five.key]: 1 }, { 'sphinx claw': 10 })
  const [t] = rows[0].turnIns
  assert.equal(t.sets, 2)
  assert.equal(setsLine(t), 'you hold enough for 2 more turn-ins')
  assert.equal(timesLine(t), 'turned in 1 time')
})

// ---- 3. short of a set: the row states the gap -------------------------------------------

test('an item at have 3 / need 4 states the gap instead of arguing to keep', () => {
  const four: CleanupQuest = {
    key: 'Ranger::Test of Bark',
    className: 'Ranger',
    name: 'Test of Bark',
    giver: 'Treant Elder',
    reward: 'Barkhide Tunic',
    items: [{ name: 'Treant Bark', count: 4 }]
  }
  const rows = cleanupRows([four], { [four.key]: 1 }, { 'treant bark': 3 })
  assert.equal(rows.length, 1, 'three of a four-item set is still spare - the quest is done')
  const [t] = rows[0].turnIns
  assert.equal(t.sets, 0)
  assert.equal(t.have, 3)
  assert.equal(t.need, 4)
  assert.equal(decisionLine(t), 'you hold 3 of the 4 needed for another turn-in')
  assert.equal(setsLine(t), null)
})

// ---- 4. where the dump says it is --------------------------------------------------------

/** A tab-separated dump, written the way the client writes one (carryAll.test.mts's helper). */
const synth = (...lines: string[]): string => `${lines.join('\r\n')}\r\n`

test('SYNTHETIC: an extra item-shaped section becomes a place named the way the client named it', () => {
  const text = synth(
    'Location\tName\tID\tCount\tSlots',
    'General 1\tSpacious Rucksack\t177751\t1\t24',
    'General 1-Slot1\tSphinx Claw\t100\t1\t10',
    'General 1-Slot2\tSphinx Claw +1\t100\t1\t10',
    'Bank3\tSphinx Claw\t100\t1\t10',
    '',
    "Dragon's Hoard\tName\tID\tCount\tSlots",
    "Dragon's Hoard1\tSphinx Claw\t100\t2\t10"
  )
  const places = dumpLocationsFrom(carryAll(parseInventoryDump(text)).rows)
  assert.deepEqual(places['sphinx claw'], [
    // Two bag slots fold into one place with a count, and the `+1` variant folds onto the base
    // counting key exactly as `reconcile` folds it (law 2).
    { label: 'General', count: 2 },
    { label: 'Bank', count: 1 },
    { label: "Dragon's Hoard", count: 2 }
  ])
  assert.equal(locationsLine(places['sphinx claw']), "General 2, Bank 1, Dragon's Hoard 2")
})

test('SYNTHETIC: the shared bank and the personal depot get the words a player uses', () => {
  const text = synth(
    'Location\tName\tID\tCount\tSlots',
    'SharedBank1\tSphinx Claw\t100\t1\t10',
    'Personal-Depot2\tSphinx Claw\t100\t2\t10',
    'Head\tSphinx Claw\t100\t1\t10'
  )
  const rows = carryAll(parseInventoryDump(text)).rows
  assert.deepEqual(rows.map(placeLabel), ['Shared Bank', 'Personal Depot', 'Worn'])
  assert.equal(locationsLine(dumpLocationsFrom(rows)['sphinx claw']), 'Shared Bank 1, Personal Depot 2, Worn 1')
})

test('an item no loaded dump names says so, rather than saying nothing', () => {
  const rows = cleanupRows([AZARACK], { [AZARACK.key]: 1 }, { 'azarack skin': 2 })
  assert.deepEqual(rows[0].locations, [])
  assert.equal(locationsLine(rows[0].locations), 'location not in the inventory dump')
})

test('the places ride the row when the dump does know them', () => {
  const rows = cleanupRows(
    [AZARACK],
    { [AZARACK.key]: 1 },
    { 'azarack skin': 2 },
    { 'azarack skin': [{ label: 'Bank', count: 2 }] }
  )
  assert.equal(locationsLine(rows[0].locations), 'Bank 2')
})

// ---- 5. the destroyed override takes the row away ----------------------------------------

test('a hand-stated count of 0 removes the row - which is what "I destroyed these" does', () => {
  const quests = [AZARACK]
  const progress = { [AZARACK.key]: 1 }
  assert.equal(cleanupRows(quests, progress, { 'azarack skin': 2 }).length, 1)
  // The button writes an override of 0 through `useProgress.setItemOverride`; `reconcile` then
  // answers 0 for the item, and that is the only input this module reads about holdings.
  assert.deepEqual(cleanupRows(quests, progress, { 'azarack skin': 0 }), [])
  // An item nobody has ever looted or dumped is the same case, and must not draw a phantom row.
  assert.deepEqual(cleanupRows(quests, progress, {}), [])
})

// ---- order, and the copy that is not a row ------------------------------------------------

test('the biggest stack is first, and ties break by name', () => {
  const rows = cleanupRows(
    [CLAW_BEAST, AZARACK, { ...CLAW_PALADIN, items: [{ name: 'Zebuxoruk Feather', count: 1 }] }],
    { [CLAW_BEAST.key]: 1, [AZARACK.key]: 1, [CLAW_PALADIN.key]: 1 },
    { 'sphinx claw': 2, 'azarack skin': 9, 'zebuxoruk feather': 2, 'wind rune heda': 0 }
  )
  assert.deepEqual(rows.map((r) => [r.name, r.quantity]), [
    ['Azarack Skin', 9],
    ['Sphinx Claw', 2],
    ['Zebuxoruk Feather', 2]
  ])
})

test('the caveat is the owner’s sentence, verbatim, and carries no em dash', () => {
  assert.equal(
    CLEANUP_CAVEAT,
    'Cleanup lists items you could destroy because every Sky quest that needs them has been turned in. Destroying is permanent and happens in the game, not here. If you delete something you wanted, that is on you.'
  )
  assert.ok(!/[–—]/.test(CLEANUP_CAVEAT), 'user-facing copy uses a plain dash (JOS-106)')
})

test('the reward tier line appears only when itemTiers has actually observed one', () => {
  assert.equal(rewardTierLine('Azarack Skin Wristwraps', 3), 'your Azarack Skin Wristwraps is +3')
  // Absent means UNKNOWN, never zero (itemTiers.ts's own rule) - so there is no line at all.
  assert.equal(rewardTierLine('Azarack Skin Wristwraps', undefined), null)
  assert.equal(rewardTierLine(undefined, 3), null)
})

test('a quest with no recorded reward still argues to keep, without naming a prize', () => {
  const bare: CleanupQuest = {
    key: 'Rogue::Test of Shadow',
    className: 'Rogue',
    name: 'Test of Shadow',
    items: [{ name: 'Shadow Silk', count: 1 }]
  }
  const [row] = cleanupRows([bare], { [bare.key]: 1 }, { 'shadow silk': 2 })
  const [t] = row.turnIns
  assert.equal(turnInHeading(t), 'Test of Shadow (Rogue)', 'no giver, no dangling dash')
  assert.equal(decisionLine(t), 'keep them: you are holding enough for another turn-in')
})
