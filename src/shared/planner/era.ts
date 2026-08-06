// planner/era.ts — "is this loot even in the game yet?", answered from ZONE PROVENANCE.
//
// THE BUG THIS EXISTS FOR: the first cut of the exaltation planner offered ten Primal Velium
// weapons for the Avatar proc. Every one of them drops off a warder in Sleeper's Tomb — Velious
// content EQ Legends has not opened. The item corpus cannot catch that: it is scraped from a wiki
// that documents Kunark and Velious wholesale (Kael Drakkel alone is 343 catalog mobs), and NO
// FIELD ON AN ITEM CARRIES AN ERA. The only evidence in the data is where the thing drops, so the
// era question is really a zone question, and the zone answers live in the one hand-authored
// zone-knowledge table (`src/shared/zones.ts`, world-model law 12).
//
// This module is the thin, pure layer over that table:
//   * `zoneEra` resolves a DIRTY catalog zone string to an expansion, or to `null`.
//   * `eraVerdict` folds a donor's whole zone list into one of three answers a UI can render.
//
// SINCE 2026-08-04 THERE IS A SECOND WITNESS, and the model is LAYERED EVIDENCE. It turns out the
// wiki does state an era after all — not on the item, but as a coloured banner template at the top
// of 7,315 of the 11,247 item pages (`{{Velious Era}}`, read by `main/itemLookupParse.ts`). It is
// weaker evidence than a zone (it is a section heading, and its tokens name places as often as
// expansions), so it never overrules one: `layeredVerdict` asks the zones first and consults
// `eraFromTag` ONLY when they came back `unknown`. That is what finally answers for the quest
// rewards, the crafted goods and the 126 catalog-orphan donors no zone ever placed.
//
// WHAT IT REFUSES TO DO. The catalog's zone strings include real dirt: initialisms (`BBM`, `WFP`),
// prose (`Most starting zones`, `Various`), concatenations where a wiki table cell ran two links
// together (`Everfrost PeaksLake Rathetear`, `DreadlandsEmerald JungleCity of Mist`), hedges
// (`West Cabilis?`, `also in Chardok?`) and genuinely ambiguous city names (`Freeport` is three
// map files). Every one of those resolves to `null`. Splitting a concatenation on capital letters
// or fuzzy-matching a hedge would manufacture knowledge the source never stated — law 12 again —
// and the cost of being wrong here is telling the owner a farmable item is unreachable (or the
// reverse). A name that isn't knowledge stays unknown, and `unknown` is a first-class verdict.
//
// MEASURED over the committed catalog (2026-08-04, `src/renderer/src/data/eqlegends/mobs.json`):
// 192 distinct zone strings across 8,214 (mob, zone) links. 159 of the 192 resolve to an era —
// 109 classic (4,985 links), 29 kunark (1,464), 21 velious (1,679) — and because what is left is
// overwhelmingly one-mob junk, that is 8,128 of the 8,214 links, 99.0% BY WEIGHT. The 33
// unresolved names carry 86 links between them, and 54 of those 86 are two honest non-zones:
// `Various` (22) and the EQL-new `New Sebilis Expedition` (32, a real place with no historic
// expansion to name). `tests/plannerEra.test.mts` pins floors under all of it.
//
// PURE: no Node, no Electron, no renderer. Relative imports so the node test runner loads it
// directly (the shared/planner house style).

import { ZONES, zoneKey, type ZoneEntry, type ZoneEra } from '../zones'

/**
 * An EverQuest expansion the planner can rank.
 *
 * A SUPERSET of `ZoneEra` by exactly one member. `ZoneEra` is what the zone table may claim, and
 * it stops at Velious on purpose: the Luclin-and-later zones in `zones.ts` (Bazaar, Nexus, Plane
 * of Knowledge) are deliberately unannotated, because EQ Legends' versions of them are hubs the
 * player can walk into and calling them out-of-era would be a lie. But 25 item PAGES open with
 * `{{Luclin Era}}`, and `eraFromTag` has to be able to say what that means — so 'luclin' is an era
 * the planner names without being an era a zone claims. The union direction (`ZoneEra | 'luclin'`)
 * is the compile-time proof that every zone era is rankable here; `zones.ts` is untouched.
 */
export type Era = ZoneEra | 'luclin'

/**
 * The eras in RELEASE ORDER. This ordering is the whole semantic of "in era": classic (1999) ⊂
 * Kunark (April 2000) ⊂ Velious (December 2000) ⊂ Luclin (December 2001), because an expansion
 * never retires the content before it. Index = rank.
 */
export const ERA_ORDER: readonly Era[] = ['classic', 'kunark', 'velious', 'luclin']

/**
 * What EQ Legends currently ships. TODAY IT IS CLASSIC — level 50, Fear/Hate/Sky, no Kunark
 * landmass (docs/plans/exaltation-planner.md R6).
 *
 * WHEN KUNARK LAUNCHES, FLIP THIS ONE LINE. Everything downstream — the out-of-era chips, the
 * farm rollup's filtering, the browser's default hide — is derived from the comparison against
 * this constant, so there is exactly one edit and no second opinion to forget. The tests pin the
 * ordering semantics against `eraVerdictAt` rather than against today's value, so flipping it
 * does not require rewriting them.
 */
export const CURRENT_ERA: Era = 'classic'

/**
 * The ONE display spelling of each era. Lives beside the ordering rather than in whichever UI file
 * needed it first: the era chip, the era filter's tooltip and the browser's era grouping all say
 * "Velious" the same way, and none of them owns the word.
 */
export const ERA_LABEL: Record<Era, string> = {
  classic: 'Classic',
  kunark: 'Kunark',
  velious: 'Velious',
  luclin: 'Luclin'
}

/** Release rank of an era; lower ships earlier. `ERA_ORDER.indexOf` with a name. */
export function eraRank(era: Era): number {
  return ERA_ORDER.indexOf(era)
}

// ---- the reverse index --------------------------------------------------------------------
//
// `zones.ts` indexes FORWARD (a log's long name -> its row) and exposes the catalog's spellings
// per row via `catalogZonesFor`. The planner needs the other direction: it holds a catalog string
// and wants the row. So this builds one map over all three of a row's naming surfaces — its own
// name, its aliases, and the `mobCatalogNames` the fold cannot reach — keyed by the SAME
// `zoneKey` fold, which is what makes `Chardok (Pre-Revamp)`, `Northern Karana (35)` and
// `THE PLANE OF SKY` land on their rows for free.
//
// LAZY, never at module load (the zones.ts / mobSearch posture): a session that never opens the
// Planner pays nothing, and the table is immutable so one build lasts the process.

let INDEX: Map<string, ZoneEntry> | null = null

function index(): Map<string, ZoneEntry> {
  if (INDEX) return INDEX
  const m = new Map<string, ZoneEntry>()
  for (const entry of ZONES) {
    for (const spelling of [entry.name, ...(entry.aliases ?? []), ...(entry.mobCatalogNames ?? [])]) {
      const key = zoneKey(spelling)
      // First writer wins, matching zones.ts's own index. `tests/plannerEra.test.mts` proves the
      // three surfaces never collide across rows, so this guard never actually fires.
      if (key !== '' && !m.has(key)) m.set(key, entry)
    }
  }
  INDEX = m
  return m
}

/**
 * The expansion a CATALOG zone string belongs to, or `null`.
 *
 * `null` means one of two honest things and the caller cannot tell them apart (nor should it):
 * the string is not a zone this app knows (junk, prose, a concatenation, an ambiguous city), or
 * it is a known zone that deliberately carries no era claim (the Luclin/PoP hub zones in the map
 * table, EQL-new content like New Sebilis Expedition). Either way the answer is "we don't know",
 * never a guess.
 */
export function zoneEra(zoneName: string): Era | null {
  const key = zoneKey(zoneName)
  if (key === '') return null
  return index().get(key)?.era ?? null
}

/** How a donor's drop zones read against the era the server is on. */
export type EraVerdict = 'in-era' | 'out-of-era' | 'unknown'

/**
 * Fold a donor's whole zone list into one verdict, against an ARBITRARY era — the testable core,
 * and the function to call when showing "what this would look like after Kunark".
 *
 * - `in-era`     — at least one zone resolved to an era at or before `era`. ANY reachable source
 *                  makes the item farmable, so this wins over an out-of-era sibling zone: a mob
 *                  that spawns in both Lower Guk and Kael Drakkel is still a Lower Guk camp.
 * - `out-of-era` — zones resolved, and every one of them is a later expansion. This is the
 *                  Sleeper's Tomb case the module exists for.
 * - `unknown`    — NOTHING resolved. An empty list lands here too, which is the honest reading:
 *                  a quest reward or a crafted item drops from nobody, and "no drop zones" is not
 *                  evidence of anything (law 1). Callers render it as silence, not as a warning.
 */
export function eraVerdictAt(zoneNames: readonly string[], era: Era): EraVerdict {
  const ceiling = eraRank(era)
  let resolvedAny = false
  for (const name of zoneNames) {
    const found = zoneEra(name)
    if (found === null) continue
    resolvedAny = true
    if (eraRank(found) <= ceiling) return 'in-era'
  }
  return resolvedAny ? 'out-of-era' : 'unknown'
}

/** `eraVerdictAt` against what the server actually ships today. The call sites use this one. */
export function eraVerdict(zoneNames: readonly string[]): EraVerdict {
  return eraVerdictAt(zoneNames, CURRENT_ERA)
}

// ---- layer 2: the page's own era banner -------------------------------------------------------
//
// Zones answer "where do I go", which is why they win. But 3,932 item pages state no zone anyone
// can resolve — quest rewards, crafted goods, and the 126 effect donors the mob catalog simply
// never links — and for most of those the wiki DOES make an era claim, in a place that is not an
// item field at all: the coloured banner template at the top of the page (`{{Velious Era}}`).
// `main/itemLookupParse.ts parseEraTag` reads the token; this table is the ONLY place a token
// becomes an expansion, and it is hand-authored (law 12) because the tokens are not expansion
// names — they are the wiki's own section headings, and half of them name a PLACE.
//
// THE MAPPING, token by token, with the reasoning that is not obvious:
//   Sky / Fear / Hate / Temple / Paineel → CLASSIC. These are 1999-2000 classic zones the EQL
//     server ships today; the wiki banners them separately because they are raid/patch content,
//     not because they are a later expansion. `zones.ts` already calls all five classic.
//   Epics / EpicQuests → KUNARK. The epic 1.0 chain is a KUNARK system: it shipped with Kunark
//     (April 2000) and every chain ends at a Kunark turn-in, so a classic-era server has no epic
//     in it whatever zones the intermediate pieces come from. This row READ `classic` until
//     2026-08-05 and the justification for it — "any piece a Kunark zone gates is caught by
//     layer 1" — is FALSE for the thing that matters: the epic WEAPON is a quest reward, it drops
//     off nobody, so layer 1 resolves nothing and layer 2 is the only witness there is.
//     Ragebringer and Spear of Fate rendered as farmable classic loot for exactly that reason
//     (owner, 2026-08-05). 188 pages carry the two tags.
//   Chardok Revamp / Chardok → KUNARK. Chardok is a Kunark zone whatever the revamp did to it.
//   FearHateRevamp → CLASSIC, and this one was MEASURED rather than reasoned. 53 pages carry it;
//     26 of them are named in the EQL mob catalog's loot lists, and every single one of those 26
//     drops off a Plane of Fear (14) or Plane of Hate (12) mob. The catalog is a scrape of THIS
//     server, so the revamp loot is the loot that is live here — mapping it to anything but
//     classic would hide Greenmist armour from a player who can go and camp it tonight.
//   Unknown → null, stated in the table rather than left to fall through: "Unknown" is a claim
//     that the wiki does not know, and it must not become a guess here either.
//
// A token missing from this table is `null` — undefined, never approximate. That is the whole
// reason it is a table and not a regex over the token text.
const TAG_ERA: Readonly<Record<string, Era | null>> = {
  classic: 'classic',
  sky: 'classic',
  fear: 'classic',
  hate: 'classic',
  fearhaterevamp: 'classic',
  temple: 'classic',
  paineel: 'classic',
  epics: 'kunark',
  epicquests: 'kunark',
  kunark: 'kunark',
  chardok: 'kunark',
  'chardok revamp': 'kunark',
  velious: 'velious',
  luclin: 'luclin',
  unknown: null
}

/**
 * The expansion an ITEM PAGE's era banner claims, or `null` when the token names none.
 *
 * Case-folded on lookup, which is what absorbs the corpus's one `{{kunark Era}}` typo without a
 * second table row. Whitespace is already normalized by `parseEraTag`, so "Chardok  Revamp" and
 * "Chardok_Revamp" arrive here spelled one way.
 */
export function eraFromTag(tag: string): Era | null {
  return TAG_ERA[tag.trim().toLowerCase()] ?? null
}

/**
 * THE VERDICT THE UI ASKS FOR: zone provenance first, the page's banner only as a tiebreak.
 *
 * - Layer 1 WINS OUTRIGHT. If any source zone resolves, that answer is final in both directions —
 *   a Velious-banner item that a Lower Guk mob drops is farmable tonight, and a Classic-banner
 *   item whose only dropper lives in Kael Drakkel is not. Where you physically go beats what a
 *   page header says about it, and a banner is a section heading, not a spawn table.
 * - Layer 2 SPEAKS ONLY INTO SILENCE. When nothing resolved — no drop zone, or only dirt — the
 *   banner turns `unknown` into a real answer by the same rank comparison every other verdict
 *   uses. No banner, or one this app cannot read, and the answer stays `unknown` (law 1).
 */
export function layeredVerdictAt(
  zoneNames: readonly string[],
  tag: string | undefined,
  era: Era
): EraVerdict {
  const byZone = eraVerdictAt(zoneNames, era)
  if (byZone !== 'unknown') return byZone
  const tagged = tag === undefined || tag === '' ? null : eraFromTag(tag)
  if (tagged === null) return 'unknown'
  return eraRank(tagged) <= eraRank(era) ? 'in-era' : 'out-of-era'
}

/** `layeredVerdictAt` against what the server actually ships today. The call sites use this one. */
export function layeredVerdict(zoneNames: readonly string[], tag: string | undefined): EraVerdict {
  return layeredVerdictAt(zoneNames, tag, CURRENT_ERA)
}
