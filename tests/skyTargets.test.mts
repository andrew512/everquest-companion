// ============================================================================
// skyTargets — the Targets tab's whole model: "who do I still kill", cross-quest.
// ============================================================================
//
// GitHub issue #30, landed as JOS-417 from community PR #34 (johnsideserf). The quest tracker
// says what each quest needs; players invert it in their heads to the question they walk the
// islands with. This suite pins the inversion as a pure fold, half against the COMMITTED data (the
// poskyDroppers precedent: goldens over posky.json + the real catalog) and half against synthetic
// quests where the committed data cannot express the case (partial holdings, turn-in counts).
//
// WHAT IS PINNED, and the argument for each:
//   1. THE NEED SET is the quests that still want something, and `firstTimeOnly` (default ON)
//      decides whether an already-run quest is one of them — `everTurnedIn`, the Ready tab's
//      first-time predicate, ported with its default. A completion inferred from a held reward
//      would read turnIns >= 1 and be excluded by the same predicate — no special case, which is
//      the point of resting on the count rather than on a flag.
//   2. SHORTFALL AGGREGATES PER COUNTING KEY, never per quest. `computeQuestProgress` clamps
//      `have` per quest with no cross-quest allocation, so a per-quest `have < need` filter
//      would read two quests each "satisfied" by the same single held copy. The rule:
//      totalNeed summed over the need set, minus the UNCAPPED `held`, floored at zero.
//   3. CLASSIFICATION IS THE SCRAPE'S OWN WORDS: resolved droppers fold into mob cards; an
//      unresolved item whose `who` starts with "random drop" (case-insensitive prefix — never
//      the literal sentinel, which carries an em dash `tests/copyNoEmDash.test.mts` would
//      reject) is the collective entry; anything else unresolved is the no-known-source list.
//      Never a guessed mob (law 1).
//   4. THE ORDER IS COUNTED: mobs by distinct needed items covered, desc, then name — the
//      questKillTargets order, cross-quest. Items inside a card, and both special lists,
//      alphabetical: deterministic and explainable, nothing invented.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skyTargets, type TargetsQuest, type TargetsQuestItem } from '../src/renderer/src/features/posky/skyTargets'
import { isSkyMob, skyDroppersFor, type DropperMob } from '../src/renderer/src/features/posky/poskyDroppers'
import type { MobEntry, PoskyQuest } from '../src/shared/types'
import poskyRaw from '../src/renderer/src/data/eqlegends/posky.json' with { type: 'json' }
import mobsRaw from '../src/renderer/src/data/eqlegends/mobs.json' with { type: 'json' }

const QUESTS: PoskyQuest[] = (poskyRaw as { quests: PoskyQuest[] }).quests
const MOBS: MobEntry[] = (mobsRaw as { mobs: MobEntry[] }).mobs

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A synthetic dropper — the catalog shape with only the fields the fold reads. */
function mob(name: string, page = name): DropperMob {
  const entry = { name, page, zones: ['Plane of Sky'] } as MobEntry
  return { name, page, zones: ['Plane of Sky'], entry }
}

/** One quest item as the fold consumes it; droppers default to none. */
function item(p: {
  name: string
  need?: number
  held?: number
  droppers?: DropperMob[]
  where?: string
  who?: string[]
}): TargetsQuestItem {
  return {
    name: p.name,
    need: p.need ?? 1,
    held: p.held ?? 0,
    droppers: p.droppers ?? [],
    where: p.where ?? 'Island 1',
    who: p.who ?? []
  }
}

/** A quest as the fold consumes it. `turnIns` defaults to never-turned-in. */
function quest(p: {
  className?: string
  name: string
  turnIns?: number
  items: TargetsQuestItem[]
}): TargetsQuest {
  return {
    className: p.className ?? 'Warrior',
    name: p.name,
    turnIns: p.turnIns ?? 0,
    items: p.items
  }
}

/** A REAL quest row from the committed data, resolved through the real dropper index. */
function realQuest(q: PoskyQuest, turnIns = 0): TargetsQuest {
  return {
    className: q.className,
    name: q.name,
    turnIns,
    items: q.items.map((it) => ({
      name: it.name,
      need: it.count > 0 ? it.count : 1,
      held: 0,
      droppers: skyDroppersFor(it.name, it.who),
      where: it.where,
      who: it.who
    }))
  }
}

// ---------------------------------------------------------------------------
// 1. The need set
// ---------------------------------------------------------------------------

test('a quest turned in once contributes nothing (AE1)', () => {
  const q = quest({ name: 'Test of Done', turnIns: 1, items: [item({ name: 'Sky Pearl', droppers: [mob('Gorgalosk')] })] })
  const model = skyTargets([q])
  assert.equal(model.mobs.length, 0)
  assert.equal(model.randomDrop.length, 0)
  assert.equal(model.unsourced.length, 0)
})

test('a reward-inferred completion is excluded by the same predicate (AE2)', () => {
  // A completion inferred from a held reward would floor turnIns to 1; the fold reads the floored
  // count through `everTurnedIn` and needs no separate "inferred" input to know about.
  const q = quest({ name: 'Test of Inferred', turnIns: 1, items: [item({ name: 'Sky Pearl', droppers: [mob('Gorgalosk')] })] })
  assert.equal(skyTargets([q]).mobs.length, 0)
})

// ---------------------------------------------------------------------------
// 1b. …and the toggle that widens it (JOS-417)
// ---------------------------------------------------------------------------

test('firstTimeOnly OFF readmits a turned-in quest that still wants items', () => {
  const q = quest({ name: 'Test of Refarm', turnIns: 2, items: [item({ name: 'Sky Pearl', droppers: [mob('Gorgalosk')] })] })
  assert.equal(skyTargets([q]).mobs.length, 0, 'default ON is the never-turned-in reading')
  const wide = skyTargets([q], false)
  assert.equal(wide.mobs.length, 1)
  assert.equal(wide.mobs[0].items[0].shortfall, 1)
  assert.deepEqual(wide.mobs[0].items[0].quests.map((x) => x.questName), ['Test of Refarm'])
})

test('the toggle reaches MEMBERSHIP only - a refarm holding its items is still absent', () => {
  // The arithmetic under the wider need set is the identical fold: a quest whose holdings already
  // cover it contributes nothing whether or not it has ever been run.
  const held = quest({ name: 'Test of Stocked', turnIns: 1, items: [item({ name: 'Sky Pearl', need: 2, held: 2, droppers: [mob('Gorgalosk')] })] })
  assert.equal(skyTargets([held], false).mobs.length, 0)
})

test('with the box off, a run quest and a fresh one share one aggregate shortfall', () => {
  const ran = quest({ className: 'Cleric', name: 'Test Ran', turnIns: 1, items: [item({ name: 'Sphinx Claw', held: 1, droppers: [mob('Sphinx')] })] })
  const fresh = quest({ className: 'Rogue', name: 'Test Fresh', items: [item({ name: 'Sphinx Claw', held: 1, droppers: [mob('Sphinx')] })] })
  const entry = skyTargets([ran, fresh], false).mobs[0].items[0]
  // Two quests want one each, one copy is held: one short, and both quests are named.
  assert.equal(entry.shortfall, 1)
  assert.deepEqual(entry.quests.map((x) => x.questName).sort(), ['Test Fresh', 'Test Ran'])
})

test('a quest holding everything contributes nothing; an empty input is an empty model', () => {
  const full = quest({ name: 'Test of Full', items: [item({ name: 'Sky Pearl', need: 2, held: 2, droppers: [mob('Gorgalosk')] })] })
  assert.equal(skyTargets([full]).mobs.length, 0)
  const empty = skyTargets([])
  assert.deepEqual([empty.mobs, empty.randomDrop, empty.unsourced], [[], [], []])
})

// ---------------------------------------------------------------------------
// 2. Shortfall aggregates per counting key
// ---------------------------------------------------------------------------

test('two quests sharing one held copy still need one more — never vanishing (the R2 rule)', () => {
  const a = quest({ className: 'Cleric', name: 'Test A', items: [item({ name: 'Sphinx Claw', held: 1, droppers: [mob('Sphinx')] })] })
  const b = quest({ className: 'Rogue', name: 'Test B', items: [item({ name: 'Sphinx Claw', held: 1, droppers: [mob('Sphinx')] })] })
  const model = skyTargets([a, b])
  assert.equal(model.mobs.length, 1)
  const entry = model.mobs[0].items[0]
  // totalNeed 2 across the need set, 1 held -> 1 short. The per-quest clamp would say 0.
  assert.equal(entry.shortfall, 1)
  assert.equal(entry.quests.length, 2)
})

test('one item wanted by two quests is one mob entry naming both, with combined shortfall (AE4)', () => {
  const a = quest({ className: 'Cleric', name: 'Test A', items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const b = quest({ className: 'Rogue', name: 'Test B', items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const model = skyTargets([a, b])
  assert.equal(model.mobs.length, 1)
  assert.equal(model.mobs[0].mob.name, 'Sphinx')
  const entry = model.mobs[0].items[0]
  assert.equal(entry.shortfall, 2)
  assert.deepEqual(entry.quests.map((x) => x.questName).sort(), ['Test A', 'Test B'])
})

test('a +N variant folds onto its base item by counting key', () => {
  const a = quest({ className: 'Cleric', name: 'Test A', items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const b = quest({ className: 'Rogue', name: 'Test B', items: [item({ name: 'Sphinx Claw +1', droppers: [mob('Sphinx')] })] })
  const model = skyTargets([a, b])
  assert.equal(model.mobs.length, 1)
  assert.equal(model.mobs[0].items.length, 1)
  assert.equal(model.mobs[0].items[0].shortfall, 2)
})

test('need > 1 with partial holdings reports the exact shortfall', () => {
  const q = quest({ name: 'Test of Two', items: [item({ name: 'Sky Pearl', need: 2, held: 1, droppers: [mob('Gorgalosk')] })] })
  assert.equal(skyTargets([q]).mobs[0].items[0].shortfall, 1)
})

test('an item shared by a turned-in and a never-turned-in quest annotates only the latter', () => {
  const done = quest({ className: 'Cleric', name: 'Test Done', turnIns: 1, items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const open = quest({ className: 'Rogue', name: 'Test Open', items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const model = skyTargets([done, open])
  const entry = model.mobs[0].items[0]
  assert.equal(entry.shortfall, 1)
  assert.deepEqual(entry.quests.map((x) => x.questName), ['Test Open'])
})

// ---------------------------------------------------------------------------
// 3. Classification — the scrape's own words, never a guess
// ---------------------------------------------------------------------------

test('a missing Wind Rune lands in the collective entry and never on a mob (AE5, real data)', () => {
  const rune = QUESTS.flatMap((q) => q.items).find((it) =>
    it.who.some((w) => w.toLowerCase().startsWith('random drop'))
  )
  assert.ok(rune, 'the committed data states random-drop rows')
  const q = quest({ name: 'Test of Wind', items: [item({ name: rune.name, where: rune.where, who: rune.who, droppers: skyDroppersFor(rune.name, rune.who) })] })
  const model = skyTargets([q])
  assert.equal(model.mobs.length, 0)
  assert.equal(model.randomDrop.length, 1)
  assert.equal(model.randomDrop[0].name, rune.name)
  assert.equal(model.randomDrop[0].shortfall, 1)
})

test('a missing item with no known dropper lands in the no-known-source list (AE6, real data)', () => {
  // Azarack Blood: posky states a source in words, the catalog resolves nobody (the
  // poskyDroppers header's measured 3-item remainder).
  const row = QUESTS.flatMap((q) => q.items).find((it) => it.name === 'Azarack Blood')
  assert.ok(row, 'Azarack Blood is in the committed data')
  const droppers = skyDroppersFor(row.name, row.who)
  assert.equal(droppers.length, 0, 'still unresolved in the committed catalog')
  const q = quest({ name: 'Test of Azarack', items: [item({ name: row.name, where: row.where, who: row.who, droppers })] })
  const model = skyTargets([q])
  assert.equal(model.mobs.length, 0)
  assert.equal(model.unsourced.length, 1)
  assert.equal(model.unsourced[0].name, row.name)
})

test('a real never-turned-in quest yields real kill targets from the committed catalog', () => {
  const source = QUESTS.find((q) => q.items.some((it) => skyDroppersFor(it.name, it.who).length > 0))
  assert.ok(source, 'the committed data resolves droppers for some quest')
  const model = skyTargets([realQuest(source)])
  assert.ok(model.mobs.length > 0)
  for (const t of model.mobs) {
    assert.ok(t.covers >= 1)
    assert.ok(t.items.length === t.covers)
    assert.ok(t.items.every((i) => i.shortfall > 0))
  }
})

// ---------------------------------------------------------------------------
// 4. The order is counted
// ---------------------------------------------------------------------------

test('mobs sort by distinct items covered desc, then name; the order is stable', () => {
  const twoItems = quest({
    name: 'Test of Many',
    items: [
      item({ name: 'Sky Pearl', droppers: [mob('Gorgalosk')] }),
      item({ name: 'Sky Sapphire', droppers: [mob('Gorgalosk')] }),
      item({ name: 'Azarack Feather', droppers: [mob('Azarack')] })
    ]
  })
  const first = skyTargets([twoItems])
  assert.deepEqual(first.mobs.map((t) => t.mob.name), ['Gorgalosk', 'Azarack'])
  assert.deepEqual(first.mobs.map((t) => t.covers), [2, 1])
  // Ties break on name: two mobs each covering one item.
  const tied = quest({
    name: 'Test of Ties',
    items: [
      item({ name: 'Sky Pearl', droppers: [mob('Gorgalosk')] }),
      item({ name: 'Azarack Feather', droppers: [mob('Azarack')] })
    ]
  })
  assert.deepEqual(skyTargets([tied]).mobs.map((t) => t.mob.name), ['Azarack', 'Gorgalosk'])
})

test('items inside a card, and both special lists, read alphabetically', () => {
  const q = quest({
    name: 'Test of Order',
    items: [
      item({ name: 'Sky Sapphire', droppers: [mob('Gorgalosk')] }),
      item({ name: 'Azarack Feather', droppers: [mob('Gorgalosk')] })
    ]
  })
  assert.deepEqual(skyTargets([q]).mobs[0].items.map((i) => i.name), ['Azarack Feather', 'Sky Sapphire'])
})

test('a random-drop statement from ANY quest classifies the item - never fold-order-dependent', () => {
  // Quest A states nothing for the item; quest B states the random-drop sentinel. The section
  // assignment must be the same whichever quest folds first: one quest saying "random drop" is
  // the scrape speaking, and first-seen-wins would make the pane depend on iteration order.
  const silent = quest({ className: 'Cleric', name: 'Test Silent', items: [item({ name: 'Wind Rune Ozah', who: [] })] })
  const stated = quest({
    className: 'Rogue',
    name: 'Test Stated',
    items: [item({ name: 'Wind Rune Ozah', who: ['random drop — any Plane of Sky mob'] })]
  })
  for (const order of [[silent, stated], [stated, silent]]) {
    const model = skyTargets(order)
    assert.equal(model.randomDrop.length, 1, 'collective entry regardless of fold order')
    assert.equal(model.unsourced.length, 0)
  }
})

test('a mob listed on two of one item\'s droppers counts that item once', () => {
  const dup = mob('Gorgalosk')
  const q = quest({ name: 'Test of Dupes', items: [item({ name: 'Sky Pearl', droppers: [dup, dup] })] })
  assert.equal(skyTargets([q]).mobs[0].covers, 1)
})

test('islands ride per mob from the items it is the target for', () => {
  const q = quest({
    name: 'Test of Where',
    items: [
      item({ name: 'Sky Pearl', where: 'Island 3', droppers: [mob('Gorgalosk')] }),
      item({ name: 'Sky Sapphire', where: 'Island 5', droppers: [mob('Gorgalosk')] })
    ]
  })
  assert.deepEqual(skyTargets([q]).mobs[0].islands, ['Island 3', 'Island 5'])
})

// ---------------------------------------------------------------------------
// 5. Mob identity: the page, and the union behind it (JOS-417)
// ---------------------------------------------------------------------------

test('two quests resolving DIFFERENT droppers for one item yield both cards, either fold order', () => {
  // `skyDroppersFor` reads each row's own `who` as its layer 1, so two quests wanting the same
  // counting key are not guaranteed to hand back the same list. First-wins would make the card
  // set depend on which quest folded first; the union does not.
  const a = quest({ className: 'Cleric', name: 'Test A', items: [item({ name: 'Sphinx Claw', droppers: [mob('Sphinx')] })] })
  const b = quest({ className: 'Rogue', name: 'Test B', items: [item({ name: 'Sphinx Claw', droppers: [mob('Gorgalosk')] })] })
  for (const order of [[a, b], [b, a]]) {
    const model = skyTargets(order)
    assert.deepEqual(
      model.mobs.map((t) => t.mob.name).sort(),
      ['Gorgalosk', 'Sphinx'],
      'both stated droppers survive the fold'
    )
    // ONE aggregate, two cards pointing at it: two quests wanting one each is a shortfall of 2,
    // and both cards report that same number rather than a per-mob slice of it.
    assert.deepEqual(model.mobs.map((t) => t.items[0].shortfall), [2, 2])
    assert.deepEqual(
      model.mobs.map((t) => t.items[0].quests.map((x) => x.questName).sort()),
      [['Test A', 'Test B'], ['Test A', 'Test B']]
    )
  }
})

test('THE ERA/VARIANT MEASUREMENT: page identity is name identity in the Sky catalog today', () => {
  // The card dedupes on `page`, which is the reading that stays correct if the catalog ever grows
  // a second page for one name (an era or difficulty variant would draw its own card, with its own
  // level and its own drop list, rather than silently merging two mobs). This pins the two facts
  // that make that a non-issue TODAY, so a data change cannot quietly turn it into one.
  const sky = MOBS.filter((m) => isSkyMob(m))
  assert.ok(sky.length > 0, 'the committed catalog knows Plane of Sky mobs')
  const byName = new Map<string, Set<string>>()
  for (const m of sky) {
    const set = byName.get(m.name.toLowerCase()) ?? new Set<string>()
    set.add(m.page)
    byName.set(m.name.toLowerCase(), set)
  }
  const shared = [...byName.entries()].filter(([, pages]) => pages.size > 1)
  assert.deepEqual(shared.map(([n]) => n), [], 'no Sky mob name spans two catalog pages')
  // And there is no era annotation on a mob row at all to key a variant off (the `eraTag` the item
  // DB carries has no counterpart in MobEntry) — so nothing is being dropped by not reading one.
  const withEra = sky.filter((m) => 'eraTag' in m)
  assert.deepEqual(withEra.map((m) => m.page), [], 'MobEntry carries no era tag to honour')
})
