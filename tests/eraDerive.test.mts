// LAYER 3 OF THE ERA JOIN — the rules, on records small enough to read (JOS-333).
//
// `src/main/planner/eraDerive.ts` decides that an item nothing states an era for is nevertheless
// out of era, because the way the corpus says you would GET it points at content this server has
// not opened. The rule is blunt by owner ruling — ONE out-of-era edge is enough — so what matters
// is exactly where it REFUSES, and every refusal below is a case the corpus actually contains.
//
// The corpus sweep lives in `tests/plannerEraCorpus.test.mts` and asserts what these rules do to
// 11,213 committed pages, including the three rows the owner photographed. This file is the
// vocabulary: hand-written records, no committed bytes, so a failure here names a RULE.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCatalogZones,
  buildEraDerivations,
  buildQuestIndex,
  deriveEra,
  outOfEraEdges,
  type EraDeriveCatalogs
} from '../src/main/planner/eraDerive'
import { itemKey, type ItemDbEntry, type ItemDbFile } from '../src/main/itemsDb'
import type { ItemCraftIngredient, MobData, QuestData } from '../src/shared/types'

// ---- the smallest world the rules can be asked about ------------------------------------------

function item(page: string, extra: Partial<ItemDbEntry> = {}): ItemDbEntry {
  return { page, ...extra }
}

function corpusOf(...entries: ItemDbEntry[]): Map<string, ItemDbEntry> {
  return new Map(entries.map((e) => [itemKey(e.page), e]))
}

function recipe(ingredients: ItemCraftIngredient[], yieldItem?: string): ItemDbEntry['craftedBy'] {
  return [{ tradeskill: 'Blacksmithing', ingredients, ...(yieldItem === undefined ? {} : { yieldItem }) }]
}

const QUESTS: QuestData = {
  scrapedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  quests: [
    { name: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', startZone: 'East Cabilis' },
    { name: 'A Classic Errand', page: 'A Classic Errand', startZone: 'Plane of Hate' },
    { name: 'A Quest With No Zone', page: 'A Quest With No Zone' }
  ]
}

const NO_MOBS: MobData = { scrapedAt: '2026-01-01T00:00:00.000Z', source: 'test', mobs: [] }

/** Two droppers, so the zone edge has something real to fold: one Kunark-only, one that also drops
 *  in a zone this server ships. */
const MOBS: MobData = {
  scrapedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  mobs: [
    { page: 'a brute', name: 'a brute', zones: ['Warsliks Woods', 'Dreadlands'], drops: ['Brute Hide'] },
    { page: 'a bat', name: 'a bat', zones: ['Plane of Hate'], drops: ['Common Hide'] },
    { page: 'a tiger', name: 'a tiger', zones: ['Lake of Ill Omen'], drops: ['Common Hide'] }
  ]
}

function catalogs(mobs: MobData = MOBS): EraDeriveCatalogs {
  return { questByName: buildQuestIndex(QUESTS), catalogZones: buildCatalogZones(mobs) }
}

const dropped = (name: string): ItemCraftIngredient => ({ name, qty: 1, sources: ['Dropped'] })
const bought = (name: string): ItemCraftIngredient => ({ name, qty: 1, sources: ['Bought'] })

// ---- edge 1: the wiki's own badge on a component ----------------------------------------------

test('a recipe component the wiki badges out of era marks the product out, bought or not', () => {
  // THE OWNER'S EXAMPLE, in miniature. The mold is BOUGHT, and it is still the wall: `{{Epics Era}}`
  // is a claim about the content, not about the shopkeeper, and it is what the wiki draws the pill
  // on. So the badge edge takes no notice of `sources` — which is the opposite of edge 4 below, and
  // the asymmetry is the whole design.
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const product = item('Dwarven Plate Breastplate', { craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const derived = deriveEra(product, corpusOf(mold, product), catalogs())
  assert.deepEqual(derived, { basis: 'component', target: 'Small Breastplate Mold', detail: 'Epics' })
})

test('an IN-era component states nothing, and an unknown component states nothing either', () => {
  const inEra = item('Ordinary Mold', { eraTag: 'Classic' })
  const silent = item('Silent Mold')
  const product = item('A Breastplate', {
    craftedBy: recipe([bought('Ordinary Mold'), bought('Silent Mold'), bought('A Mold Nobody Wrote Up')])
  })
  assert.equal(deriveEra(product, corpusOf(inEra, silent, product), catalogs()), null)
})

test('ONE out-of-era component is enough, even beside components that are fine', () => {
  // The owner's ruling, verbatim in the module header: treat any reference to out-of-era as fairly
  // definitive. The first cut of this ticket asked for every-path-must-be-out; this test is the
  // difference between the two rules.
  const product = item('A Breastplate', {
    craftedBy: recipe([bought('Ordinary Mold'), bought('Small Breastplate Mold')])
  })
  const corpus = corpusOf(item('Ordinary Mold', { eraTag: 'Classic' }), item('Small Breastplate Mold', { eraTag: 'Epics' }), product)
  assert.equal(deriveEra(product, corpus, catalogs())?.basis, 'component')
})

// ---- edge 2: the recipe's yield -----------------------------------------------------------------

test('a recipe whose YIELD is a different, badged page counts; yielding ITSELF does not', () => {
  const other = item('Velium Thing', { eraTag: 'Velious' })
  const product = item('A Combine', { craftedBy: recipe([bought('Ordinary Mold')], 'Velium Thing') })
  assert.deepEqual(deriveEra(product, corpusOf(other, product), catalogs()), {
    basis: 'yield',
    target: 'Velium Thing',
    detail: 'Velious'
  })

  // The normal case: `|yieldItem` names the page it is on. That is not an edge to anywhere.
  const selfYield = item('Velium Thing', { eraTag: 'Velious', craftedBy: recipe([bought('Ordinary Mold')], 'Velium Thing') })
  assert.deepEqual(outOfEraEdges(selfYield, corpusOf(selfYield), catalogs()), [])
})

// ---- edge 3: the awarding / related quest -------------------------------------------------------

test('a related quest that starts in an unopened expansion marks the item out', () => {
  // Scaled Mystic Breastplate's own shape: the use names the ITEM as the quest and the ARMOUR-SET
  // page as the page, so the quest index has to answer to both spellings or this family is missed.
  const bp = item('Scaled Mystic Breastplate', {
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'wiki' }]
  })
  assert.deepEqual(deriveEra(bp, corpusOf(bp), catalogs()), {
    basis: 'quest',
    target: 'Scaled Mystic Breastplate',
    detail: 'East Cabilis'
  })
})

test('a quest we cannot resolve, or that states no start zone, states NOTHING (law 1)', () => {
  const unlisted = item('A Reward', { questUses: [{ quest: 'A Quest Nobody Scraped', source: 'wiki' }] })
  assert.equal(deriveEra(unlisted, corpusOf(unlisted), catalogs()), null)

  const zoneless = item('Another Reward', { questUses: [{ quest: 'A Quest With No Zone', source: 'wiki' }] })
  assert.equal(deriveEra(zoneless, corpusOf(zoneless), catalogs()), null)

  const classic = item('A Third Reward', { questUses: [{ quest: 'A Classic Errand', source: 'wiki' }] })
  assert.equal(deriveEra(classic, corpusOf(classic), catalogs()), null)
})

test('every related quest counts, not only the ones the catalog calls a reward', () => {
  // `role` is present ONLY on quest-catalog uses, so a rule that read it would silently drop the
  // whole `|relatedquests` family — the exact family the owner's screenshot shows badged.
  const turnIn = item('A Turn-in', {
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'quests', role: 'required' }]
  })
  assert.equal(deriveEra(turnIn, corpusOf(turnIn), catalogs())?.basis, 'quest')
})

// ---- edge 4: a component you can only kill for --------------------------------------------------

test('a DROPPED-only component whose every zone is a later expansion marks the item out', () => {
  const hide = item('Brute Hide')
  const product = item('Vale Tunic', { craftedBy: recipe([dropped('Brute Hide')]) })
  assert.deepEqual(deriveEra(product, corpusOf(hide, product), catalogs()), {
    basis: 'component-zone',
    target: 'Brute Hide',
    detail: 'Warsliks Woods, Dreadlands'
  })
})

test('THE GOLD BAR REFUSAL: a component you can BUY is not judged by where it also drops', () => {
  // Measured, not imagined. Gold Bar's catalog droppers all live in Plane of Mischief, so before
  // this guard the zone read hid the whole Gold cultural plate family — while the recipe says the
  // ingredient is Bought, its own page opens `{{Classic Era}}`, and the wiki's own `eqlmetadata`
  // calls it in era. Twelve Platinum rows had the same shape.
  const bar = item('Brute Hide')
  const product = item('Gold Tunic', { craftedBy: recipe([bought('Brute Hide')]) })
  assert.equal(deriveEra(product, corpusOf(bar, product), catalogs()), null)

  // An UNSTATED source list is refused for the same reason: "the page did not say how you get this"
  // is not "you can only kill for it".
  const unstated = item('Quiet Tunic', { craftedBy: recipe([{ name: 'Brute Hide', qty: 1 }]) })
  assert.equal(deriveEra(unstated, corpusOf(bar, unstated), catalogs()), null)
})

test('a dropped component the catalog ALSO places in a reachable zone states nothing', () => {
  // `Common Hide` drops off a Plane of Hate bat and a Lake of Ill Omen tiger. Any reachable source
  // makes it farmable, exactly as layer 1 has always folded a zone list.
  const hide = item('Common Hide')
  const product = item('Common Tunic', { craftedBy: recipe([dropped('Common Hide')]) })
  assert.equal(deriveEra(product, corpusOf(hide, product), catalogs()), null)

  // And with no catalog at all it still says nothing: an empty zone list resolves to `unknown`, and
  // unknown is never an accusation.
  assert.equal(deriveEra(product, corpusOf(hide, product), catalogs(NO_MOBS)), null)
})

// ---- which edge gets reported -------------------------------------------------------------------

test('the strongest edge is reported, and it is the wiki badge over our zone reading', () => {
  const product = item('A Mixed Thing', {
    craftedBy: recipe([dropped('Brute Hide'), bought('Small Breastplate Mold')]),
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'wiki' }]
  })
  const corpus = corpusOf(item('Brute Hide'), item('Small Breastplate Mold', { eraTag: 'Epics' }), product)
  const edges = outOfEraEdges(product, corpus, catalogs()).map((e) => e.basis).sort()
  assert.deepEqual(edges, ['component', 'component-zone', 'quest'])
  assert.equal(deriveEra(product, corpus, catalogs())?.basis, 'component')
})

// ---- what the walk deliberately does NOT do -----------------------------------------------------

test('`recipes` (what this item is FOR) is never walked, and neither is a second hop', () => {
  // A bone chip usable in a Velious combine is still a bone chip. Walking `|recipes` would invert
  // the question the derivation is asking.
  const usedIn = item('Bone Chip', { recipes: [{ recipe: 'Velium Thing', tradeskill: 'Blacksmithing' }] })
  assert.deepEqual(outOfEraEdges(usedIn, corpusOf(usedIn, item('Velium Thing', { eraTag: 'Velious' })), catalogs()), [])

  // ONE HOP. `Middle` is crafted from a badged mold, so `Middle` itself derives out — but `Outer`,
  // which is crafted from `Middle`, does not inherit that. `Middle` states no era of its OWN, and a
  // rule whose answer depends on how far you chose to walk cannot be checked against a screenshot.
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const middle = item('Middle', { craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const outer = item('Outer', { craftedBy: recipe([bought('Middle')]) })
  const corpus = corpusOf(mold, middle, outer)
  assert.equal(deriveEra(middle, corpus, catalogs())?.basis, 'component')
  assert.equal(deriveEra(outer, corpus, catalogs()), null)
})

// ---- the file-level build ------------------------------------------------------------------------

test('the build skips any page whose OWN page or drop zones already answered', () => {
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const file: ItemDbFile = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 4,
    items: {
      [itemKey(mold.page)]: mold,
      // states no era, nothing places it: layer 3's business
      silent: item('Silent Plate', { craftedBy: recipe([bought('Small Breastplate Mold')]) }),
      // its own page states an era: layers 1-2 already spoke, layer 3 stays out of it
      tagged: item('Tagged Plate', { eraTag: 'Classic', craftedBy: recipe([bought('Small Breastplate Mold')]) }),
      // a drop zone places it: same
      placed: item('Placed Plate', {
        dropsFrom: [{ mob: 'a bat', zone: 'Plane of Hate' }],
        craftedBy: recipe([bought('Small Breastplate Mold')])
      })
    }
  }
  const built = buildEraDerivations(file, catalogs())
  assert.deepEqual([...built.keys()], ['silent plate'])
  assert.equal(built.get('silent plate')?.target, 'Small Breastplate Mold')
})

test('the build walks PAGES, so an |itemname alias key cannot produce a second answer', () => {
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const plate = item('Silent Plate', { name: 'Silent Plate (in game)', craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const file: ItemDbFile = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 3,
    items: {
      [itemKey(mold.page)]: mold,
      'silent plate': plate,
      // the alias key: the SAME record, filed under the in-game name
      'silent plate (in game)': plate
    }
  }
  const built = buildEraDerivations(file, catalogs())
  assert.deepEqual([...built.keys()], ['silent plate'], 'the alias key produced its own entry')
})
