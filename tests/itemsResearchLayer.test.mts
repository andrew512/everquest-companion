// THE CURATED ITEM-KNOWLEDGE LAYER, re-derived from the committed corpus (JOS-25).
//
// `src/main/data/itemsResearch.json` is hand-curated and merges OVER the wiki record, which makes
// it the one file in the item pipeline that can state a wrong answer LOUDLY: a stale entry does
// not look stale, it looks like scraped fact. Two of its three tables restate something the item
// pages themselves say (GM-event prose, bard instrument families), so this file re-derives BOTH
// from `items.json` and fails on any disagreement in either direction. A rescrape that moves a
// family or retires a page turns the suite red instead of leaving the curated answer winning.
//
// The third table (`summoned`) is owner-observation, has no corpus witness, and is deliberately
// not re-derived here — only its provenance is checked.
//
// WHAT "CLEARLY MARKED" MEANS, and why it is a test rather than a comment (the awaiting-sample
// law): an entry is admitted only when the page states a GM hand-out in UNHEDGED words AND names
// no drop source, quest or recipe anywhere. Five pages in the corpus mention a GM and are absent
// on purpose; `AMBIGUOUS` below names all five, so re-admitting one is a deliberate edit to this
// file rather than a silent widening of a regex.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import { itemKey, knowledgeFromDb, type ItemDbEntry, type ItemDbFile } from '../src/main/itemsDb'
import {
  INSTRUMENT_FAMILIES,
  ITEMS_RESEARCH,
  type InstrumentFamily
} from '../src/main/itemsResearch'

const file = itemsJson as unknown as ItemDbFile
const entries = Object.values(file.items ?? {})

/** One record → the key the layer is looked up by (`|itemname` when the page states one). */
const keyOf = (e: ItemDbEntry): string => itemKey(knowledgeFromDb(e).name)

/** Every page, by that key — the layer's whole address space. */
const pages = new Map<string, ItemDbEntry>(entries.map((e) => [keyOf(e), e]))

// ---- the GM-event half ---------------------------------------------------------------

/**
 * The UNHEDGED phrasings, quoted from the corpus. Anchored per shape rather than a loose
 * `/gm/` sweep, because the four rejects below all contain "GM" and three contain "GM item".
 */
const GM_PROSE = [
  /(^|\s)GM Event Item\.($|\s)/i,
  /Obtained during a GM event\./i,
  /Given out in a GM event\./i,
  /(^|\s)GM Event item for /i
]

/**
 * The five pages that mention a GM and are NOT flagged, with the reason each fails the bar.
 * Named individually so a future sweep cannot quietly absorb one.
 */
const AMBIGUOUS: Record<string, string> = {
  "dabner's staff of recall": 'carries |gmitem AND a real |dropsfrom mob — a hand-out beside a live drop is not unfarmable',
  'shield of hatred': 'hedged: "Possibly a GM Event item?"',
  'da oogly stick': 'says GM item, never GM event',
  'gnome sandwich': 'says GM item occasionally handed out, never GM event',
  'stone of gnoming': 'says GM Only item — and that it is SOLD in Sunset Home'
}

/** Does this page state a farm route of any kind? A GM hand-out beside one is not unfarmable. */
function farmable(e: ItemDbEntry): boolean {
  const k = knowledgeFromDb(e)
  return (
    (k.dropsFrom?.length ?? 0) > 0 ||
    k.quest ||
    k.questUses.length > 0 ||
    (k.recipes?.length ?? 0) > 0 ||
    (k.playerCrafted ?? false)
  )
}

/** The pages the committed prose clearly marks — the set the layer's `gmEvent` must equal. */
function derivedGmEvent(): Set<string> {
  const out = new Set<string>()
  for (const e of entries) {
    const prose = e.summary ?? ''
    if (!GM_PROSE.some((re) => re.test(prose))) continue
    if (farmable(e)) continue
    out.add(keyOf(e))
  }
  return out
}

// ---- the instrument half -------------------------------------------------------------

/**
 * The wiki's four spellings of one family, and the two PLACES it writes them: the stats block
 * (`Wind Resonance: 12`, `Stringed Instrument`) and `|focus_effect` (`Brass Resonance 14`, which
 * the scrape folds in as a focus effect). Both are the item's own page stating its own family.
 */
const FAMILY_OF: [RegExp, InstrumentFamily][] = [
  [/^wind\b/i, 'wind'],
  [/^(string|stringed)\b/i, 'string'],
  [/^brass\b/i, 'brass'],
  [/^percussion\b/i, 'percussion'],
  [/^all instrument types$/i, 'all']
]
const INSTRUMENT_LINE = /resonance|instruments?\b|instrument types/i

/** Every line on a page that claims an instrument family, from either place. */
function instrumentLines(e: ItemDbEntry): string[] {
  const stats = e.stats
  if (!stats) return []
  const flags = [...stats.flags, ...stats.extras].filter((l) => INSTRUMENT_LINE.test(l))
  const focus = stats.effects.filter((x) => x.kind === 'focus' && INSTRUMENT_LINE.test(x.name))
  return [...flags, ...focus.map((x) => x.name)]
}

/** The family table the corpus states — the set the layer's `instrument` must equal. */
function derivedInstruments(): Map<string, InstrumentFamily> {
  const out = new Map<string, InstrumentFamily>()
  for (const e of entries) {
    const lines = instrumentLines(e)
    if (lines.length === 0) continue
    const fams = new Set(lines.map((l) => FAMILY_OF.find(([re]) => re.test(l.trim()))?.[1]))
    assert.equal(fams.size, 1, `${keyOf(e)} states more than one instrument family: ${lines.join(' | ')}`)
    const fam = [...fams][0]
    assert.ok(fam !== undefined, `${keyOf(e)}: unreadable instrument line ${lines.join(' | ')}`)
    out.set(keyOf(e), fam)
  }
  return out
}

// ---- the tests -----------------------------------------------------------------------

test('every curated entry names a real item and states its provenance', () => {
  const all = Object.entries(ITEMS_RESEARCH)
  assert.ok(all.length > 0, 'the curated layer is empty')
  for (const [key, entry] of all) {
    assert.ok(pages.has(key), `${key}: the layer keys an item the corpus has no page for`)
    assert.ok(entry.source.trim().length > 0, `${key}: a curated entry with no source reads as scraped fact`)
    assert.match(entry.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${key}: no checkedAt date`)
  }
})

test('the GM-event table is exactly what the committed prose clearly marks', () => {
  const flagged = new Set(
    Object.entries(ITEMS_RESEARCH)
      .filter(([, r]) => r.gmEvent === true)
      .map(([k]) => k)
  )
  const derived = derivedGmEvent()
  console.log('gm-event layer', { flagged: flagged.size, derived: derived.size })
  assert.deepEqual([...flagged].sort(), [...derived].sort())
  assert.ok(flagged.size >= 10, `only ${flagged.size} GM-event entries`)

  // Unfarmable is the whole claim — re-asserted on the flagged set itself, not just on the
  // derivation, because a hand-added entry never passes through `derivedGmEvent`.
  for (const key of flagged) {
    const page = pages.get(key)
    assert.ok(page, key)
    assert.equal(farmable(page), false, `${key}: flagged GM-event but the page names a farm route`)
  }

  // The exclusion has to BITE: if none of the ten carried an effect, flagging them would be a
  // statement with no consequence anywhere in the planner.
  const withEffects = [...flagged].filter((k) => (pages.get(k)?.stats?.effects.length ?? 0) > 0)
  assert.ok(withEffects.length >= 4, `only ${withEffects.length} flagged items carry an effect`)
})

test('the five hedged GM pages stay OUT, and each is named with its reason', () => {
  for (const [key, why] of Object.entries(AMBIGUOUS)) {
    assert.ok(pages.has(key), `${key}: the reject list names a page the corpus does not have`)
    assert.ok(why.length > 0)
    assert.equal(ITEMS_RESEARCH[key]?.gmEvent, undefined, `${key} was admitted without review: ${why}`)
  }
  // Dabner's is the one that would have cost a real donor, so it is pinned by its own facts
  // rather than by its absence alone.
  const dabner = pages.get("dabner's staff of recall")
  assert.ok(dabner)
  assert.equal(farmable(dabner), true, "Dabner's Staff of Recall lost the drop source that keeps it farmable")
})

test('the instrument table is exactly what the committed corpus states, both ways', () => {
  const derived = derivedInstruments()
  const filed = new Map<string, InstrumentFamily>()
  for (const [key, entry] of Object.entries(ITEMS_RESEARCH)) {
    if (entry.instrument !== undefined) filed.set(key, entry.instrument)
  }
  const tally: Record<string, number> = {}
  for (const fam of derived.values()) tally[fam] = (tally[fam] ?? 0) + 1
  console.log('instrument layer', { filed: filed.size, derived: derived.size, ...tally })

  assert.deepEqual([...filed.keys()].sort(), [...derived.keys()].sort(), 'the filed table and the corpus disagree about WHICH items are instruments')
  for (const [key, fam] of derived) assert.equal(filed.get(key), fam, `${key}: filed family disagrees with the page`)
  assert.ok(filed.size >= 47, `only ${filed.size} instrument entries`)

  // Every value is one of the five families, and every family the game has is represented —
  // a mapping bug that folded everything into one bucket would still pass a size floor.
  for (const [key, fam] of filed) {
    assert.ok((INSTRUMENT_FAMILIES as readonly string[]).includes(fam), `${key}: ${fam} is not a family`)
  }
  assert.deepEqual([...new Set(filed.values())].sort(), [...INSTRUMENT_FAMILIES].sort())
})

test('an instrument entry never excludes a donor', () => {
  // The instrument table is a GROUPING fact. `excludedDonor` reads `summoned` / `gmEvent` only,
  // so filing 47 families must not have quietly taken 47 items off the planner's donor list.
  for (const [key, entry] of Object.entries(ITEMS_RESEARCH)) {
    if (entry.instrument === undefined) continue
    assert.equal(entry.gmEvent, undefined, `${key}: an instrument entry also claims gmEvent`)
    assert.equal(entry.summoned, undefined, `${key}: an instrument entry also claims summoned`)
  }
})
