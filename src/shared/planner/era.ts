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
 * An EverQuest expansion, as the zone table states it. Re-exported under the planner's own name
 * because era is a PLANNER concept built on a ZONE fact — callers in `features/planner` should
 * not have to import from the map layer to name it.
 */
export type Era = ZoneEra

/**
 * The three eras in RELEASE ORDER. This ordering is the whole semantic of "in era": classic
 * (1999) ⊂ Kunark (April 2000) ⊂ Velious (December 2000), because an expansion never retires the
 * content before it. Index = rank.
 */
export const ERA_ORDER: readonly Era[] = ['classic', 'kunark', 'velious']

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
