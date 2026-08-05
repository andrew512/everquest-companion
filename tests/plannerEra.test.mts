// PLANNER ERA TESTS — the layer that stops the planner recommending Velious loot (era.ts).
//
// THE BUG, RESTATED SO THE PIN CANNOT DRIFT FROM IT: the effect browser offered Primal Velium
// weapons for the Avatar proc. All of them drop off Sleeper's Tomb warders — Velious content EQ
// Legends has not opened. Nothing on an item says so; the only evidence is the drop zone. So this
// suite proves two things and nothing else:
//
//   1. THE VERDICT IS RIGHT ON REAL DATA. Sleeper's Tomb reads out-of-era; Upper Guk reads
//      in-era; junk reads unknown; and the whole assertion runs against the REAL committed
//      catalog, not a fixture (the plannerSourceIndex precedent).
//   2. THE ORDERING IS THE SEMANTIC, not today's constant. `CURRENT_ERA` is one line that flips
//      when Kunark launches, so the tests exercise `eraVerdictAt` at each era instead of hard-
//      coding "kunark is out" — the day the flip happens this file must stay green unchanged.
//
// COVERAGE IS A FLOOR, NEVER AN EXACT COUNT (AGENTS.md: frozen numbers rot). Measured 2026-08-04
// over the 192 distinct catalog zone strings / 8,214 mob-zone links: 159 names resolve, carrying
// 8,128 links (99.0%). The floors below sit meaningfully under that, so a rescrape that adds
// zones cannot turn this red — but a fold that quietly stops resolving `Kael Drakkel` will.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_ERA,
  ERA_ORDER,
  eraRank,
  eraVerdict,
  eraVerdictAt,
  zoneEra,
  type Era
} from '../src/shared/planner/era'
import { ZONES, zoneKey } from '../src/shared/zones'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData } from '../src/shared/types'

const catalog = mobsJson as unknown as MobData

/** Every distinct zone string the catalog states, with how many mob pages state it. */
const CATALOG_ZONES = ((): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const mob of catalog.mobs) {
    for (const zone of mob.zones ?? []) counts.set(zone, (counts.get(zone) ?? 0) + 1)
  }
  return counts
})()

// ---- the Avatar case (the reason this module exists) ----------------------------------------

test("the Avatar donors' zone reads out-of-era: Primal Velium is Sleeper's Tomb, and that is Velious", () => {
  // Found by the catalog, not by hand: every mob whose loot list names a Primal Velium item.
  // Measured 2026-08-04: 7 mobs (the four warders, the Master of the Guard, the Final Arbiter,
  // the Progenitor), 8 distinct weapons, ONE zone between them.
  const droppers = catalog.mobs.filter((m) => (m.drops ?? []).some((d) => /^Primal Velium /i.test(d)))
  assert.ok(droppers.length >= 5, `only ${String(droppers.length)} Primal Velium droppers found`)
  for (const mob of droppers) {
    const zones = mob.zones ?? []
    assert.ok(zones.length > 0, `${mob.name} states no zone`)
    assert.equal(eraVerdict(zones), 'out-of-era', `${mob.name} ${JSON.stringify(zones)}`)
  }

  // And the zone itself, stated directly so the pin survives a rescrape that renames the mobs.
  assert.equal(zoneEra("Sleeper's Tomb"), 'velious')
  assert.equal(eraVerdict(["Sleeper's Tomb"]), 'out-of-era')
})

test('every mob the catalog places in a Velious zone reads out-of-era under a classic server', () => {
  // The generalisation of the Avatar case. Kael Drakkel alone is 343 mob pages — this is the bulk
  // of what the planner was mis-recommending, and none of it may read as farmable today.
  let checked = 0
  for (const mob of catalog.mobs) {
    const zones = mob.zones ?? []
    if (zones.length !== 1 || zoneEra(zones[0]) !== 'velious') continue
    checked++
    assert.equal(eraVerdictAt(zones, 'classic'), 'out-of-era', `${mob.name} in ${zones[0]}`)
    // ...and in-era the moment the server ships Velious. The verdict is a comparison, not a list.
    assert.equal(eraVerdictAt(zones, 'velious'), 'in-era', `${mob.name} in ${zones[0]}`)
  }
  assert.ok(checked >= 1_400, `only ${String(checked)} single-zone Velious mobs checked`)
})

// ---- the three verdicts ----------------------------------------------------------------------

test('a classic zone is in-era, at every era the game will ever be on', () => {
  assert.equal(zoneEra('Upper Guk'), 'classic')
  assert.equal(eraVerdict(['Upper Guk']), 'in-era')
  for (const era of ERA_ORDER) assert.equal(eraVerdictAt(['Upper Guk'], era), 'in-era', era)
  // The log's own spelling of the same place, and the alias, agree — one zone, one era.
  assert.equal(zoneEra('The City of Guk'), 'classic')
  assert.equal(zoneEra('Lower Guk'), 'classic')
})

test('junk, prose and ambiguity read UNKNOWN — never a nearest guess (law 12)', () => {
  // Real catalog strings, every one of them. A matcher that split concatenations on capitals or
  // stripped the `?` would be inventing a fact the wiki never stated.
  for (const junk of [
    'Everfrost PeaksLake Rathetear',
    'DreadlandsEmerald JungleCity of Mist',
    'Western Plains of KaranaNorthern Plains of Karana',
    'Kithicor Forest Misty Thicket',
    'Most starting zones',
    'Various',
    'Various Zones',
    'also in Chardok?',
    'West Cabilis?',
    'Field of Bone?',
    'Kelethin (Greater Faydark)',
    'Lake of Ill Omen.',
    'West Freeport OR East Freeport'
  ]) {
    assert.equal(zoneEra(junk), null, `"${junk}" must not resolve`)
    assert.equal(eraVerdict([junk]), 'unknown', `"${junk}" must read unknown`)
  }
  // The AMBIGUOUS city names zones.ts deliberately refuses (each is 2-3 different map files).
  for (const ambiguous of ['Freeport', 'Kaladim', 'Neriak', 'Qeynos', 'Felwithe', 'Guk', 'Karana']) {
    assert.equal(zoneEra(ambiguous), null, `"${ambiguous}" is ambiguous and must not resolve`)
  }
  // Degenerate input never throws and never resolves.
  for (const blank of ['', '   ', 'xyzzy']) assert.equal(zoneEra(blank), null)
  // No zones at all — a quest reward or a crafted item. Silence, not a warning (law 1).
  assert.equal(eraVerdict([]), 'unknown')
})

test('a KNOWN zone with no era claim reads unknown, not out-of-era', () => {
  // New Sebilis Expedition is EQL-new content the player has actually walked; it belongs to no
  // 1999-2000 expansion, so the table makes no era claim. Calling that "out-of-era" would be a
  // lie about a place you can zone into right now.
  assert.equal(zoneEra('New Sebilis Expedition'), null)
  assert.equal(eraVerdict(['New Sebilis Expedition']), 'unknown')
  // Same for the Live-EQ hub zones the map table carries but EQL cannot reach.
  for (const later of ['The Bazaar', 'The Nexus', 'Plane of Knowledge', 'The Guild Lobby']) {
    assert.equal(zoneEra(later), null, later)
  }
})

test('one reachable zone wins: a mixed drop list is in-era, not out', () => {
  // A mob that spawns in both Lower Guk and Kael Drakkel is still a Lower Guk camp. The verdict
  // asks "can I farm this", not "is every source reachable".
  assert.equal(eraVerdict(['Kael Drakkel', 'Lower Guk']), 'in-era')
  assert.equal(eraVerdict(['Lower Guk', 'Kael Drakkel']), 'in-era')
  // Unresolvable dirt beside a real zone neither helps nor hurts.
  assert.equal(eraVerdict(['Various', "Sleeper's Tomb"]), 'out-of-era')
  assert.equal(eraVerdict(['Various', 'Lower Guk']), 'in-era')
})

// ---- the ordering, which is what CURRENT_ERA means -------------------------------------------

test('ERA_ORDER is release order, and eraRank agrees with it', () => {
  assert.deepEqual([...ERA_ORDER], ['classic', 'kunark', 'velious'])
  assert.equal(eraRank('classic'), 0)
  assert.ok(eraRank('classic') < eraRank('kunark'))
  assert.ok(eraRank('kunark') < eraRank('velious'))
  assert.ok(ERA_ORDER.includes(CURRENT_ERA), 'CURRENT_ERA must be one of the three')
})

test('the verdict is a comparison against CURRENT_ERA, not a hardcoded era list', () => {
  const chardok = ['Chardok'] // Kunark
  const guk = ['Lower Guk'] // classic
  const sleeper = ["Sleeper's Tomb"] // Velious

  // TODAY the server is classic, so Kunark loot is out of reach...
  assert.equal(CURRENT_ERA, 'classic', 'EQL ships classic today (R6); flip this line WITH era.ts')
  assert.equal(eraVerdict(chardok), 'out-of-era')

  // ...and the day Kunark launches, flipping CURRENT_ERA is the whole change: classic AND kunark
  // become in-era together, Velious stays out. Asserted through eraVerdictAt so this test does
  // not have to be rewritten on that day.
  const expected: Record<Era, [string, string, string]> = {
    classic: ['in-era', 'out-of-era', 'out-of-era'],
    kunark: ['in-era', 'in-era', 'out-of-era'],
    velious: ['in-era', 'in-era', 'in-era']
  }
  for (const era of ERA_ORDER) {
    const [g, c, s] = expected[era]
    assert.equal(eraVerdictAt(guk, era), g, `Lower Guk @ ${era}`)
    assert.equal(eraVerdictAt(chardok, era), c, `Chardok @ ${era}`)
    assert.equal(eraVerdictAt(sleeper, era), s, `Sleeper's Tomb @ ${era}`)
  }

  // eraVerdict is exactly eraVerdictAt(CURRENT_ERA) — no second opinion.
  for (const zones of [guk, chardok, sleeper, ['Various'], []]) {
    assert.equal(eraVerdict(zones), eraVerdictAt(zones, CURRENT_ERA))
  }
})

// ---- coverage over the real catalog -----------------------------------------------------------

test('the era layer resolves the catalog, by name count AND by mob weight', () => {
  // 192 distinct names / 8,214 links measured 2026-08-04; both floors sit under the measurement
  // with room for a rescrape to add dirt without going red.
  assert.ok(CATALOG_ZONES.size >= 180, `only ${String(CATALOG_ZONES.size)} distinct catalog zones`)

  let names = 0
  let links = 0
  let total = 0
  for (const [zone, count] of CATALOG_ZONES) {
    total += count
    if (zoneEra(zone) === null) continue
    names++
    links += count
  }

  // Measured: 159 of 192 names resolve.
  assert.ok(names >= 140, `only ${String(names)} of ${String(CATALOG_ZONES.size)} catalog zones resolve`)
  // Measured: 8,128 of 8,214 links, 99.0%. The unresolved tail is one-mob junk, so the weighted
  // floor is the number that actually matters to a user staring at the farm rollup.
  assert.ok(total >= 8_000, `only ${String(total)} mob-zone links`)
  const pct = (100 * links) / total
  assert.ok(pct >= 95, `mob-weighted coverage fell to ${pct.toFixed(1)}%`)
})

test('the big rooms resolve, and to the right expansion', () => {
  // The zones that dominate the catalog by mob count — if any of these silently stopped
  // resolving, the coverage floor above would still pass while the feature quietly broke.
  const ANCHORS: readonly (readonly [string, Era])[] = [
    ['Kael Drakkel', 'velious'], // 343 mobs, the largest zone in the catalog
    ['Skyshrine', 'velious'],
    ['Thurgadin', 'velious'],
    ['Temple of Veeshan', 'velious'],
    ['Plane of Mischief', 'velious'], // a VELIOUS plane, not a classic one
    ['Plane of Growth', 'velious'],
    ['Chardok', 'kunark'],
    ['Chardok (Pre-Revamp)', 'kunark'], // the catalog's page-disambiguation suffix folds away
    ['Firiona Vie', 'kunark'],
    ['East Cabilis', 'kunark'],
    ['Lake of Ill Omen', 'kunark'], // 82 mobs; the row this wave added
    ['Old Sebilis', 'kunark'],
    ['South Qeynos', 'classic'],
    ["Ak'Anon", 'classic'],
    ['Greater Faydark', 'classic'],
    ['Plane of Sky', 'classic'], // Fear/Hate/Sky ARE classic
    ['Plane of Fear', 'classic'],
    ['Plane of Hate', 'classic'],
    ['Paineel', 'classic'], // the late-1999 heretic patch, still months before Kunark
    // Jan-2001 patch zones, NOT original 1999 — and owner-observed out-of-era in EQL
    // (Stonebrunt loot surfacing in the planner was the report, 2026-08-04).
    ['Stonebrunt Mountains', 'velious'],
    ['The Warrens', 'velious'],
    ['Qeynos Aqueducts', 'classic'], // alias of Qeynos Catacombs
    ['BBM', 'classic'], // a mobCatalogNames initialism, reached through the reverse index
    ['WFP', 'classic'],
    ['Permafrost', 'classic'],
    ['The Hole', 'classic'],
    ['Runnyeye', 'classic'], // catalog-only short form added with this wave
    ['Dalnir', 'kunark'], // ditto
    ['Northern Karana (35)', 'classic']
  ]
  for (const [zone, era] of ANCHORS) assert.equal(zoneEra(zone), era, zone)
})

// ---- the table's own era invariants -----------------------------------------------------------

test('every era annotation is one of the three, and most of the table carries one', () => {
  let annotated = 0
  for (const entry of ZONES) {
    if (entry.era === undefined) continue
    annotated++
    assert.ok(ERA_ORDER.includes(entry.era), `${entry.short}: bogus era "${entry.era}"`)
  }
  // Measured 2026-08-04: 122 of the table's 128 rows are annotated; the 6 that are not are the
  // EQL-new New Sebilis Expedition plus five Live-EQ hub zones (Bazaar, Nexus, Plane of
  // Knowledge, Guild Lobby, Barter Hall). A floor, so adding rows never breaks this.
  assert.ok(annotated >= 115, `only ${String(annotated)} of ${String(ZONES.length)} rows carry an era`)
})

test('the reverse index has one row per folded spelling — name, alias and catalog name alike', () => {
  // era.ts indexes all THREE naming surfaces (zones.ts itself only indexes name + aliases), so
  // the no-collision guarantee tests/zones.test.mts proves for two surfaces is re-proved here for
  // three. A collision would mean one catalog string silently claiming another zone's era.
  const seen = new Map<string, string>()
  for (const entry of ZONES) {
    for (const spelling of [entry.name, ...(entry.aliases ?? []), ...(entry.mobCatalogNames ?? [])]) {
      const key = zoneKey(spelling)
      assert.notEqual(key, '', `${entry.short}: "${spelling}" folds to nothing`)
      const prior = seen.get(key)
      assert.ok(
        prior === undefined || prior === entry.short,
        `"${spelling}" (${entry.short}) collides with ${String(prior)} on key "${key}"`
      )
      seen.set(key, entry.short)
    }
  }
})
