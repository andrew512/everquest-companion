// EXALTATION PLANNER — the donor index, asserted against the REAL committed corpus
// (src/main/data/items.json, 11,247 records / 11,351 keys as of the 2026-08-03 scrape).
//
// This is the file that decides whether the Planner has anything to show: the pane is a browser
// over `buildPlannerDonors`, so "the Proc tab is empty" and "every Improved Healing donor
// vanished" are both failures of THIS function, and both are invisible in a hand-written fixture.
// So it runs the SHIPPED builder over the SHIPPED bytes. No Electron (effectIndex.ts is
// Electron-free on purpose — the mobSearch precedent), nothing skips.
//
// Assertions are FLOORS and IDENTITIES, never today's counts (AGENTS.md "frozen numbers rot" —
// the wiki gains item pages and a rescrape must be able to grow this file without turning the
// suite red). The floors sit under what the 2026-08-04 build measured:
//
//     click 816 · proc 448 · focus 143 · worn 104   = 1,511 donor rows
//     from 1,550 effect-bearing pages of 11,155 (196 alias keys skipped, 49 socketless
//     `Effect:` rows excluded, 3 duplicate-page rows collapsed)
//
// The identities are the interesting half: one row per (key, effect, socket) with NO duplicates,
// and every slot token canonical. Both are properties the UI depends on and neither is a count.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import {
  PLANNER_SEARCH_LIMIT,
  buildPlannerDonors,
  buildPlannerIndex,
  searchPlannerItems
} from '../src/main/planner/effectIndex'
import { EQUIP_SLOTS, SOCKET_TYPES } from '../src/shared/planner/types'
import { eraFromTag, layeredVerdict, zoneEra } from '../src/shared/planner/era'
import { isClassAbbr } from '../src/shared/classCombo'

const file = itemsJson as unknown as ItemDbFile
const index = buildPlannerIndex(file)
const donors = index.donors

/** Per-socket floors — under the measured build, so a growing corpus stays green. */
const FLOORS = { proc: 400, click: 800, focus: 100, worn: 90 } as const

const bySocket = (socket: string): number => donors.filter((d) => d.socket === socket).length

test('the corpus yields a populated donor index (per-socket floors)', () => {
  const measured = Object.fromEntries(SOCKET_TYPES.map((s) => [s, bySocket(s)]))
  // Printed because this is the number the planner's usefulness IS — a wave that halves it
  // should be able to see that it did.
  console.log('planner donors', { total: donors.length, ...measured, stats: index.stats })
  for (const [socket, floor] of Object.entries(FLOORS)) {
    assert.ok(
      bySocket(socket) >= floor,
      `only ${bySocket(socket)} ${socket} donors — expected >= ${floor}`
    )
  }
  // D2: the wiki spells procs `Combat Effect:`, so `kind:'proc'` is 0 in the corpus and every
  // proc row here arrives via the combat→proc fold. A zero here means that fold broke.
  assert.ok(bySocket('proc') > 0, 'no proc donors at all — the combat→proc fold (D2) is broken')
  assert.equal(buildPlannerDonors(file).length, donors.length, 'both entry points must agree')
})

test('(key, effect, socket) is a ROW IDENTITY — alias keys and duplicate pages collapse', () => {
  // Two ways one item can be read twice: its `|itemname` alias key (196 of them), and a second
  // wiki page for the same item ("10 Dose Ethiras Poison Antidote" without the apostrophe, the
  // four elemental Holgresh Mojo Stick pages, a guide page whose |itemname is an item). Either
  // would render the same donor twice in the browser and make "which row did I plan" ambiguous.
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const d of donors) {
    const id = [d.key, d.effect, d.socket].join(' :: ')
    if (seen.has(id)) dupes.push(id)
    seen.add(id)
  }
  assert.deepEqual(dupes, [], `duplicate donor rows: ${dupes.slice(0, 5).join(', ')}`)
  assert.ok(index.stats.aliasKeys > 0, 'the corpus is expected to carry |itemname alias keys')
  assert.ok(index.stats.pages >= 11_000, `only ${index.stats.pages} pages walked`)
})

test('every emitted token is canonical — slots, classes, sockets, tiers', () => {
  const slots = new Set<string>(EQUIP_SLOTS)
  const sockets = new Set<string>(SOCKET_TYPES)
  for (const d of donors) {
    for (const s of d.slots) assert.ok(slots.has(s), `${d.name}: non-canonical slot ${s}`)
    for (const c of d.classes) assert.ok(isClassAbbr(c), `${d.name}: non-canonical class ${c}`)
    assert.ok(sockets.has(d.socket), `${d.name}: unknown socket ${d.socket}`)
    assert.ok([1, 2, 3, 4].includes(d.tierRequired), `${d.name}: bad tier ${d.tierRequired}`)
    assert.ok(d.key.length > 0 && d.name.length > 0, 'every row must be identifiable')
    assert.equal(typeof d.hasteLocked, 'boolean')
  }
  // Law 1's tripwire: an unrecognized slot spelling must turn this red, never be dropped quietly.
  assert.deepEqual(index.stats.unknownSlotTokens, [], 'unknown slot tokens in the corpus')
})

test('R2 has real work to do: a large slotless minority can never legally donate', () => {
  // WHY THIS IS PINNED IN THE CORPUS TEST. The effect browser's default filter drops donors with
  // no equipment slot, because R2 only lets an exaltation move between items that SHARE a slot —
  // so a donor with none shares a slot with nothing. That filter is only defensible if the corpus
  // really does carry a mass of slotless rows (it is the potion aisle) AND they really are a
  // minority (a filter that hid most of the planner would be a bug, not a rule).
  //
  // MEASURED 2026-08-04: 287 of 1,508 rows — click 220/813, proc 67/448, focus 0/143, worn 0/104.
  // Floors and identities only; a rescrape may move every one of those numbers.
  const slotless = donors.filter((d) => d.slots.length === 0)
  const per = Object.fromEntries(
    SOCKET_TYPES.map((s) => [s, slotless.filter((d) => d.socket === s).length])
  )
  console.log('planner slotless donors', { total: slotless.length, ...per })

  assert.ok(slotless.length >= 150, `only ${slotless.length} slotless donors — the filter would be pointless`)
  assert.ok(
    slotless.length * 2 < donors.length,
    `${slotless.length} of ${donors.length} rows are slotless — a default filter must never hide the majority`
  )
  // The shape of the mass, as an IDENTITY rather than a count: the consumable sockets carry it.
  // Focus and worn effects only ever appear on things you wear, and if that ever stops being true
  // the browser's default is hiding real worn/focus donors and this test is the one that says so.
  assert.equal(per.focus, 0, 'a slotless FOCUS donor appeared — re-check the default filter')
  assert.equal(per.worn, 0, 'a slotless WORN donor appeared — re-check the default filter')
})

test('R1 holds per socket: the extraction tier comes from the rules, not from here', () => {
  const tiers = new Map<string, Set<number>>()
  for (const d of donors) {
    const set = tiers.get(d.socket) ?? new Set<number>()
    set.add(d.tierRequired)
    tiers.set(d.socket, set)
  }
  // One tier per socket type, and the four are the unlock thresholds: focus +1 … proc +4.
  assert.deepEqual([...(tiers.get('focus') ?? [])], [1])
  assert.deepEqual([...(tiers.get('click') ?? [])], [2])
  assert.deepEqual([...(tiers.get('worn') ?? [])], [3])
  assert.deepEqual([...(tiers.get('proc') ?? [])], [4])
})

test('the anchor row: Improved Healing is a FOCUS donor extractable at +1', () => {
  // A named row rather than a shape check — floors can be met by garbage. Improved Healing is the
  // focus family every healer plans around; the corpus states it on 30+ pages.
  const healing = donors.filter((d) => /^Improved Healing/i.test(d.effect))
  assert.ok(healing.length > 0, 'no Improved Healing donors at all')
  for (const d of healing) {
    assert.equal(d.socket, 'focus', `${d.name} carries ${d.effect} as ${d.socket}, expected focus`)
    assert.equal(d.tierRequired, 1)
    assert.equal(d.hasteLocked, false)
  }
  // R3's other half, on the same principle: haste effects are FLAGGED, never dropped.
  assert.ok(donors.some((d) => d.hasteLocked), 'no haste-locked donors — R3 is not being applied')
})

test('donors carry the item page’s OWN drop sources (`|dropsfrom`)', () => {
  const withWiki = donors.filter((d) => (d.wikiSources?.length ?? 0) > 0)
  const withZone = withWiki.filter((d) => d.wikiSources?.some((s) => s.zone !== undefined))
  console.log('planner wikiSources', { rows: withWiki.length, withZone: withZone.length })

  // FLOORS under the 2026-08-04 build (804 rows carry sources, 796 of them naming a zone) —
  // this is the second witness to "where does this drop", beside the renderer's mob-catalog
  // inversion, and a parser change that silently stops reading the field must turn this red.
  assert.ok(withWiki.length >= 700, `only ${withWiki.length} donors carry wikiSources`)
  assert.ok(withZone.length >= 700, `only ${withZone.length} name a zone`)

  for (const d of withWiki) {
    for (const s of d.wikiSources ?? []) {
      assert.ok(s.mob.length > 0, `${d.name}: an unnamed drop source`)
      // Absent means UNKNOWN; an empty string would render as a zone chip with no zone in it.
      assert.ok(s.zone === undefined || s.zone.length > 0, `${d.name}: empty zone string`)
      assert.doesNotMatch(s.mob, /\[\[|\{\{|<\w/, `${d.name}: unstripped markup in "${s.mob}"`)
    }
  }
  // Mob-only entries are real (8 rows): a page that lists mobs under no heading states a mob and
  // no zone, and that is kept rather than dropped.
  assert.ok(
    withWiki.some((d) => d.wikiSources?.some((s) => s.zone === undefined)),
    'no zone-less wiki sources at all — the mob-only shape stopped parsing'
  )
})

test('the Coldain anchor: a Velious donor the mob catalog cannot place', () => {
  // The owner saw the Coldain Velium weapons as era-unknown. MEASURED against the scrape cache:
  // eight of the nine carry NO `|dropsfrom` at all (they are VENDOR SOLD — their provenance sits
  // in `|soldby`, unparsed), and exactly one states a source. That one is the anchor, because it
  // is the shape the whole task is for: a wiki-stated zone that resolves to VELIOUS.
  const sword = donors.find((d) => d.key === 'coldain velium short sword')
  assert.ok(sword, 'Coldain Velium Short Sword is no longer a donor')
  assert.deepEqual(
    sword.wikiSources?.map((s) => s.zone),
    ['Eastern Wastes'],
    'the sword must still name its zone'
  )
  assert.equal(zoneEra('Eastern Wastes'), 'velious')

  // …and the general form: donors whose only stated zone is Velious content exist in numbers.
  const velious = donors.filter(
    (d) => (d.wikiSources?.length ?? 0) > 0 && d.wikiSources?.every((s) => s.zone !== undefined && zoneEra(s.zone) === 'velious')
  )
  assert.ok(velious.length >= 50, `only ${velious.length} donors are Velious-only by wiki source`)
})

test('donors carry the page-top era banner (`eraTag`) — the last-resort witness', () => {
  const tagged = donors.filter((d) => d.eraTag !== undefined)
  const mapped = tagged.filter((d) => eraFromTag(d.eraTag ?? '') !== null)
  const tokens = [...new Set(tagged.map((d) => d.eraTag ?? ''))].sort()
  console.log('planner eraTag', { rows: tagged.length, mapped: mapped.length, tokens })

  // FLOOR under the 2026-08-04 build (1,258 of 1,508 donor rows carry a banner). A parser change
  // that silently stops reading the template must turn this red, not quietly drop 700 donors back
  // into `era?`.
  assert.ok(tagged.length >= 1_000, `only ${tagged.length} donors carry an eraTag`)

  // The table has to actually cover what the corpus says. A NEW token appearing in a rescrape is
  // allowed (it reads as `null` = unknown, which is honest) — the table going stale wholesale is
  // not, so this is a ratio floor rather than a set identity.
  const covered = (100 * mapped.length) / tagged.length
  assert.ok(covered >= 95, `eraFromTag maps only ${covered.toFixed(1)}% of tagged donors`)

  for (const d of tagged) {
    assert.doesNotMatch(d.eraTag ?? '', /[{}|]|\bEra\b/, `${d.name}: raw markup in eraTag "${d.eraTag ?? ''}"`)
    assert.equal(d.eraTag, (d.eraTag ?? '').trim(), `${d.name}: untrimmed eraTag`)
  }
})

test('the Coldain anchor, layer 2: no zone anywhere, but the page says Velious', () => {
  // The sibling of the `|dropsfrom` anchor above, and the case the banner layer exists for: eight
  // of the nine Coldain Velium weapons are VENDOR SOLD, so neither the mob catalog nor the item
  // page places them — before the banner they read `era?` and stayed in a classic-era player's
  // farm list forever. The page opens `{{Velious Era}}`, and that is now enough to say so.
  const sword = donors.find((d) => d.key === 'coldain velium long sword')
  assert.ok(sword, 'Coldain Velium Long Sword is no longer a donor')
  assert.equal(sword.wikiSources, undefined, 'the long sword states no drop source')
  assert.equal(sword.eraTag, 'Velious')
  assert.equal(eraFromTag(sword.eraTag), 'velious')
  // The whole family agrees — this is a set of pages, not one lucky row.
  const coldain = donors.filter((d) => d.key.startsWith('coldain velium'))
  assert.ok(coldain.length >= 5, `only ${coldain.length} Coldain Velium donors`)
  for (const d of coldain) assert.equal(d.eraTag, 'Velious', d.name)

  // WITHOUT a zone the layered verdict is the banner's; with one, the zone still wins.
  assert.equal(layeredVerdict([], sword.eraTag), 'out-of-era')
  assert.equal(layeredVerdict(['Lower Guk'], sword.eraTag), 'in-era')
})

test('host search: substring, prefix-first, shortest-first, capped', () => {
  const hits = searchPlannerItems(index.items, 'ghoulbane')
  assert.ok(hits.length > 0, 'Ghoulbane must be findable')
  assert.equal(hits[0].name.toLowerCase(), 'ghoulbane')

  // Prefix beats mid-name, and the plain item beats its longer neighbours.
  const cloaks = searchPlannerItems(index.items, 'cloak of')
  assert.ok(cloaks.length > 1)
  assert.ok(
    cloaks[0].name.toLowerCase().startsWith('cloak of'),
    `prefix hit expected first, got ${cloaks[0].name}`
  )
  const prefixRun = cloaks.findIndex((h) => !h.name.toLowerCase().startsWith('cloak of'))
  assert.ok(prefixRun === -1 || prefixRun > 0, 'prefix hits must come before mid-name hits')

  // Capped, case-insensitive, and empty means empty (the UI shows its browse list instead).
  assert.ok(searchPlannerItems(index.items, 'a').length <= PLANNER_SEARCH_LIMIT)
  assert.deepEqual(searchPlannerItems(index.items, '   '), [])
  assert.deepEqual(
    searchPlannerItems(index.items, 'GHOULBANE')[0],
    searchPlannerItems(index.items, 'ghoulbane')[0]
  )

  // The host picker searches EVERY item, not just effect-bearing ones — a plain sword is a
  // perfectly good host — and one row per item key.
  assert.ok(index.items.length > donors.length, 'the item index must cover the whole corpus')
  assert.equal(new Set(index.items.map((i) => i.key)).size, index.items.length, 'one row per key')
})
