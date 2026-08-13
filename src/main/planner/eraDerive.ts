// planner/eraDerive.ts — LAYER 3 OF THE ERA JOIN: the era an item never states, read off the way
// the corpus says you would GET it (JOS-333).
//
// THE REPORT THIS EXISTS FOR. The owner photographed three gear rows the app chips `era?` whose
// wiki pages are visibly covered in red `OUT OF ERA` pills: Dwarven Breastplate (Enchanted Imbued),
// Silver Full Breastplate, Scaled Mystic Breastplate. JOS-328 had already swept the corpus for
// out-of-era markers on those pages and found none, and that sweep was CORRECT — the pills are not
// on the page, they are on its LINKS.
//
// THE MECHANISM, characterized live 2026-08-13 before a line of this was written (seven requests,
// each announced on the ticket first). The pill is not parser output, not a template and not a
// gadget: eqlwiki runs a custom skin whose ResourceLoader module `skins.EQLImmersive.eraFilter`
// walks every internal `a[href]` on a rendered page, maps each href to its target title, and asks a
// custom `action=eqlmetadata` endpoint for that target's `outOfEra`. Targets that come back true get
// `class="eql-era-out-link"`, and the pill is CSS on that class. Four modes cycle off the header
// clock button — Off, On (pill), Outline, and Hide, which removes whole table ROWS owning an
// out-of-era link. The module's documented fallback, for when the custom endpoint fails, is the
// specification in the open: `action=query&prop=categories` on the TARGET, matched against
// `mw.config.wgEQLEraOutKeys`. That config on a live page read
// `[kunark, velious, luclin, chardok, chardokrevamp, holevp, warrensfearhaterevamp, fearhaterevamp,
// epics, epicquests, unknown]` at `wgEQLEraConfigRevision` 156232 — the exact `out` set of
// `PAGE_ERA` in `shared/planner/era.ts`, at the exact `Template:PageEra` revid that file already
// cites. `eraBadge(tag) == 'out'` IS the wiki's predicate. We hold it for 7,560 committed pages,
// so the derivation is a graph walk over bytes we already ship and needed no new scraping.
//
// GROUND TRUTH, taken from that same endpoint the same day and quoted here because the three rows
// below are what anyone will check first:
//   Small Breastplate Mold          outOfEra TRUE   (our eraTag `Epics`)
//   Scaled Mystic Armor Quests      outOfEra TRUE   (a quest page, start zone East Cabilis)
//   Cultural Tradeskills: Human     outOfEra TRUE   (an armour-SET page, and see the refusal below)
//   Full Breastplate Mold           outOfEra false
//   Silver Full Breastplate         outOfEra false  (the ITEM is in era; its LINK is not)
//
// ---------------------------------------------------------------------------------------------
// THE RULE (owner rulings, 2026-08-13, twice, and the second one widened the first)
// ---------------------------------------------------------------------------------------------
//
// ONE out-of-era edge is enough. The first cut of this ticket asked for the opposite — mark it out
// only when EVERY stated path is out — and the owner overturned it mid-build, verbatim: treat any
// reference to out-of-era as fairly definitive, because *these datasources lean the other way, they
// would carry out-of-era gear by accident, not mark in-era gear out*. The second note widened it to
// any piece: the awarding quest, the tradeskill parts, zone reworks, other classes' versions.
//
// IT SPEAKS ONLY INTO SILENCE. A row whose own page states an era, or whose drop zones place it,
// keeps the layer 1-2 verdict it already had. This file is consulted by `layeredVerdict`'s callers
// only where the answer was `unknown`, so the strength order is untouched and no existing verdict
// can move. The consequence is worth stating plainly: layer 3 can only ever HIDE rows from the
// default era-filtered table, never reveal them.
//
// THE OTHER HALF OF THE SECOND RULING IS NOT IMPLEMENTED, ON PURPOSE, and this is the record of
// why. The owner also leaned the opposite way: an item eqlwiki carries that does NOT exist in other
// versions of the game is probably definitively IN era, because EQL ships original items. That is a
// claim about CROSS-VERSION EXISTENCE, and this repo holds exactly one wiki. There is no in-corpus
// signal that separates "EQL invented this" from "nobody has written the P99 page yet" — the P99
// date filings JOS-328 refused are the standing proof that absence on one wiki means nothing — so
// implementing it would be guessing in the one direction that SHOWS a player content that is not
// there. Recorded as the owner's lean for a future heuristic with a real second source, not acted
// on now (law 1).
//
// ABSENCE IS STILL NOT EVIDENCE (law 1). An item with no recipe, no quest and no drop list gets no
// derivation — it stays `era?`. An edge whose target is not in the corpus gets no derivation. A
// quest we cannot find in the quest catalog gets none. The rule is "one edge we can READ says out",
// never "we could not find an in-era path".
//
// ---------------------------------------------------------------------------------------------
// THE FOUR EDGES, strongest first, and what each one is worth
// ---------------------------------------------------------------------------------------------
//
//  1. `component` — a `|playercrafted` INGREDIENT whose own page the wiki badges out of era. This
//     is the pill itself, on the exact link the owner's Dwarven Breastplate screenshot shows: the
//     recipe needs a Small Breastplate Mold, and that mold's page carries `{{Epics Era}}`, which the
//     register calls out. Bought components count — a mold you cannot buy on this server is a wall
//     whatever else the recipe asks for. 308 pages.
//  2. `yield` — the recipe's `|yieldItem` when it is a DIFFERENT page from this one and that page is
//     badged out. Rare, and kept because a combine whose product is out-of-era content is not a
//     combine this server runs. 0 pages in today's corpus; it costs nothing and it is the shape a
//     rescrape could produce.
//  3. `quest` — a related quest whose START ZONE is an expansion later than `CURRENT_ERA`. This is
//     the Scaled Mystic Breastplate case, and it is the one edge that is NOT the wiki's own pill: we
//     read `startZone` out of the committed quest catalog and put it through the same `zones.ts`
//     table layer 1 uses. It agrees with the wiki where we can check it (Scaled Mystic Armor Quests
//     starts in East Cabilis and `eqlmetadata` calls the page out of era), and the tooltip says
//     "starts in" rather than claiming a badge. 106 pages.
//     EVERY related quest counts, not only the ones that hand the item out. `role` is present only
//     on the quest-catalog uses, so filtering on it would silently drop the whole `|relatedquests`
//     family — which is precisely the family the owner's screenshot shows badged — and the widened
//     ruling makes any out-of-era reference sufficient anyway.
//     WHERE IT IS MORE AGGRESSIVE THAN THE WIKI, measured against `eqlmetadata` on four of the quest
//     pages this edge fires for: Scaled Mystic Armor Quests, Shaman Skull Quests and Warrior Pike
//     Quests all come back `outOfEra: true`, and Necromancer Skullcap Quests comes back FALSE while
//     we call it out (it starts in West Cabilis, a Kunark city). That is the honest cost of a zone
//     inference and it is worth paying in this direction: you cannot walk to West Cabilis on a
//     classic server, and the chip says "starts in West Cabilis" rather than claiming a badge. Six
//     gear rows ride on that one disagreement.
//  4. `component-zone` — an ingredient the wiki does NOT badge, which the recipe says you can ONLY
//     get by killing for it, and which drops in resolvable zones that are every one a later
//     expansion. High Quality Brute Hide (Dreadlands / Frontier Mountains / Warsliks Woods only),
//     Excellent Sabertooth Tiger Hide (Kunark plus Tower of Frozen Shadow). This is our zone table
//     rather than the wiki's badge, so it sorts LAST and its sentence says so. It reads the same
//     three witnesses the app uses for the item itself — the catalog's zones for that ingredient
//     UNION the ones its page names — because reading fewer witnesses could call an ingredient
//     unreachable that the catalog knows drops in Lower Guk. 49 pages, and see `droppedOnly` below
//     for the 27 it stopped claiming once the recipe's own `sources` were consulted.
//
// NOT AN EDGE, deliberately:
//   * `|recipes` (recipes this item is an INGREDIENT of) — that is what the item is FOR, not how you
//     get it. Walking it would mark a classic bone chip out of era for being usable in a Velious
//     combine, which is the opposite of the question.
//   * DROP ZONES. They are layer 1 and they already spoke: a row only reaches this file when NO zone
//     resolved, so there is nothing here for a drop zone to add.
//   * TRANSITIVE CLOSURE. The walk is ONE hop. An ingredient that is itself crafted is resolved by
//     its own page and its own zones, not by re-walking its recipe — the corpus's `Crafted` chains
//     run four deep in places, and a rule whose answer depends on how far you chose to walk is not a
//     rule anyone can check against a screenshot.
//
// ---------------------------------------------------------------------------------------------
// THE ONE OWNER EXAMPLE THIS DOES NOT FLIP, and exactly why (law 1, stated rather than buried)
// ---------------------------------------------------------------------------------------------
//
// SILVER FULL BREASTPLATE stays `era?`. Its rendered page carries exactly one out-of-era pill, and
// the link under it is `[[Cultural Tradeskills: Human]]` — the armour-SET page, which `eqlmetadata`
// confirms is out of era. Every one of its seven recipe components is in era (checked against the
// same endpoint), and it has no quests. So the edge that would flip it is real, and we cannot see
// it: the item corpus enumerates `embeddedin Template:Itempage` and holds ITEM pages only, an armour
// set page is not one, and the `|notes` prose that links it is stored markup-STRIPPED, so the row
// does not even carry the target's title.
//
// MEASURED, so the follow-up is a decision and not a discovery: over the era? rows, 824 link at
// least one non-item page from `|notes`, and they point at just 152 DISTINCT pages — 622 of those
// rows at the nine `Cultural Tradeskills: <Race>` armour-set pages. One `eqlmetadata` POST takes
// 450 titles, so the wiki's own verdict for all 152 is ONE request, and a fifth edge would need
// exactly two things: link targets kept by `parseItemWikitext`, and that answer committed beside
// the corpus. Not done here because this ticket's brief is explicit that the derivation runs over
// committed data with no new scraping, and a worker does not widen that on its own.
//
// ---------------------------------------------------------------------------------------------
// THE CENSUS, measured 2026-08-13 over the committed corpus (11,213 pages / 11,375 keys, the
// JOS-328 rebuild). A COUNT OF WHAT IS THERE, not a threshold — the sweep asserts floors.
// ---------------------------------------------------------------------------------------------
//
//   CORPUS PAGES with a derivation: 463 — component 308 · quest 106 · component-zone 49 · yield 0.
//   GEAR ROWS carrying one:         361. One of them changes nothing: the renderer folds the MOB
//                                   CATALOG's zones in as well and had already placed it, which is
//                                   the safety valve working rather than a miss.
//   GEAR ROWS, 6,814 both sides:    in-era 2,319 (unchanged) · out-of-era 3,367 -> 3,727 ·
//                                   era? 1,128 -> 768.
//   Default era-filtered table:     3,447 -> 3,087 of 6,814.
//
// 360 rows leave the default view. They are one coherent shelf and it is worth naming, because a
// number that size deserves to be recognizable: racial CULTURAL SMITHING armour whose recipes call
// for a hammer, mold or gem the wiki badges out of era (Elven Smithy Hammer 73 rows, Teir`dal
// Smithy Hammer 40, Imbued Emerald 28, Brute Hide 24, the ten Small Plate molds 7 apiece), plus the
// Kunark-hide leather families and the racial armour quest chains that start in Cabilis.
//
// PURE and ELECTRON-FREE, the `effectIndex.ts` posture: value imports are RELATIVE, nothing reads a
// file, the ITEM corpus is handed in (main already inlines it once for itemLookup) and the two small
// catalogs this needs are imported here because they have no other caller to pass them in.
// `tests/eraDerive.test.mts` drives the rules on hand-written records and
// `tests/plannerEraCorpus.test.mts` sweeps the real committed bytes.

import { itemKey, type ItemDbEntry, type ItemDbFile } from '../itemsDb'
import { itemBaseName } from '../../shared/itemStats'
import {
  CURRENT_ERA,
  eraBadge,
  eraRank,
  layeredVerdict,
  zoneEra,
  type Era,
  type EraDerivation,
  type EraDerivationBasis
} from '../../shared/planner/era'
import questsJson from '../../renderer/src/data/eqlegends/quests.json'
import mobsJson from '../../renderer/src/data/eqlegends/mobs.json'
import type { ItemCraftIngredient, MobData, QuestData, QuestEntry } from '../../shared/types'

/**
 * WHICH EDGE WINS when an item has several. Strongest first, and "strongest" means closest to the
 * wiki's own rendered answer: the two badge edges are the pill verbatim, the quest edge is our zone
 * table applied to a page the wiki also calls out, and the zone edge is our zone table alone.
 */
const BASIS_ORDER: readonly EraDerivationBasis[] = ['component', 'yield', 'quest', 'component-zone']

/** What one derivation pass needs beside the corpus. Injectable so a test can drive small ones. */
export interface EraDeriveCatalogs {
  /** quest name AND page title → the catalog row (the item states either spelling) */
  questByName: ReadonlyMap<string, QuestEntry>
  /** itemKey → every zone the mob catalog places a dropper of it in */
  catalogZones: ReadonlyMap<string, readonly string[]>
}

// ---- the two committed catalogs ---------------------------------------------------------------

/**
 * The quest catalog keyed by BOTH spellings an `ItemQuestUse` can carry. `quest` is the display
 * name and `page` the wiki title; they are usually equal and sometimes are not (Scaled Mystic
 * Breastplate's use names the ITEM as the quest and `Scaled Mystic Armor Quests` as the page), so
 * a lookup that knew only one of them would miss exactly the family this ticket is about.
 *
 * FIRST WRITER WINS, matching every other index in the repo. The catalog is keyed by page title
 * upstream, so a collision here would mean two quests share a display name; the corpus sweep would
 * see it as an unresolved edge rather than a wrong one.
 */
export function buildQuestIndex(catalog: QuestData): Map<string, QuestEntry> {
  const m = new Map<string, QuestEntry>()
  for (const quest of catalog.quests) {
    for (const spelling of [quest.name, quest.page]) {
      const key = spelling.trim().toLowerCase()
      if (key !== '' && !m.has(key)) m.set(key, quest)
    }
  }
  return m
}

/**
 * itemKey → the zones the mob catalog places its droppers in. The renderer builds this same
 * inversion for its own era join (`lib/itemSources.ts`); this is the main-side copy, and it exists
 * because edge 4 has to judge an INGREDIENT the way the app would judge the item — an ingredient
 * whose page names no zone is routinely placed by the catalog, and reading only the page would
 * call it unreachable on no evidence.
 */
function addDropZones(m: Map<string, string[]>, drop: string, zones: readonly string[]): void {
  const key = itemBaseName(drop).toLowerCase()
  if (key === '') return
  let seen = m.get(key)
  if (seen === undefined) m.set(key, (seen = []))
  for (const zone of zones) if (!seen.includes(zone)) seen.push(zone)
}

export function buildCatalogZones(catalog: MobData): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const mob of catalog.mobs) {
    const zones = mob.zones ?? []
    if (zones.length === 0) continue
    for (const drop of mob.drops ?? []) addDropZones(m, drop, zones)
  }
  return m
}

/** The catalogs as they SHIP. Built once per process, lazily — a session that never opens the Gear
 *  tab pays for neither (the `zones.ts` / mobSearch posture). */
let COMMITTED: EraDeriveCatalogs | null = null

export function committedCatalogs(): EraDeriveCatalogs {
  COMMITTED ??= {
    questByName: buildQuestIndex(questsJson),
    catalogZones: buildCatalogZones(mobsJson)
  }
  return COMMITTED
}

// ---- resolving ONE edge target ----------------------------------------------------------------

/** The zones an item states on its OWN page (`|dropsfrom`), zone headings only. */
function pageZones(entry: ItemDbEntry): string[] {
  return (entry.dropsFrom ?? []).flatMap((s) => (s.zone === undefined ? [] : [s.zone]))
}

/** Would the wiki draw the pill on a link to this page? The register, and nothing else. */
function badgedOut(entry: ItemDbEntry | undefined): entry is ItemDbEntry & { eraTag: string } {
  return entry?.eraTag !== undefined && entry.eraTag !== '' && eraBadge(entry.eraTag) === 'out'
}

/** Is this expansion one the server has not opened? `null` (nothing resolved) is never a yes. */
function unopened(era: Era | null): boolean {
  return era !== null && eraRank(era) > eraRank(CURRENT_ERA)
}

/**
 * MAY THIS COMPONENT BE JUDGED BY WHERE IT DROPS? — only when the recipe says a drop is the ONLY
 * way to get it.
 *
 * This guard is the difference between a rule and a bug, and the bug was measured before the guard
 * existed. Gold Bar's catalog droppers all live in Plane of Mischief, so the zone read called it
 * unreachable and hid the whole Gold cultural plate family; the recipe states the ingredient's
 * source as **Bought**, its own page opens `{{Classic Era}}`, and the wiki's `eqlmetadata` says it
 * is in era. A vendor bar is not gated by where a mob happens to also drop one. Twelve Platinum
 * rows had the same shape.
 *
 * SO: every source the line states must be `Dropped`. An UNSTATED source list says nothing and is
 * refused too (law 1) — "the page did not say how you get this" is not "you can only kill for it".
 * The BADGE edges take no such guard on purpose: a badge is a claim about the CONTENT, and the
 * owner's own example is a bought mold that the wiki nevertheless pills as out of era.
 */
function droppedOnly(sources: readonly string[] | undefined): boolean {
  return sources !== undefined && sources.length > 0 && sources.every((s) => s.trim().toLowerCase() === 'dropped')
}

// ---- the walk ---------------------------------------------------------------------------------

/** ONE ingredient line → its edge, or null. Edges 1 and 4, which share a target lookup. */
function componentEdge(
  ingredient: ItemCraftIngredient,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation | null {
  const target = corpus.get(itemKey(ingredient.name))
  if (badgedOut(target)) return { basis: 'component', target: ingredient.name, detail: target.eraTag }
  if (target === undefined || !droppedOnly(ingredient.sources)) return null
  // The same three witnesses the app uses for the item itself: the catalog's zones for this
  // ingredient UNION the ones its own page names.
  const zones = [...new Set([...pageZones(target), ...(catalogs.catalogZones.get(itemKey(target.page)) ?? [])])]
  if (layeredVerdict(zones, target.eraTag) !== 'out-of-era') return null
  return { basis: 'component-zone', target: ingredient.name, detail: zones.join(', ') }
}

/** Every edge the `|playercrafted` block states — its ingredients, and a yield that is elsewhere. */
function recipeEdges(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation[] {
  const edges: EraDerivation[] = []
  const selfKey = itemKey(entry.page)
  for (const recipe of entry.craftedBy ?? []) {
    for (const ingredient of recipe.ingredients) {
      const edge = componentEdge(ingredient, corpus, catalogs)
      if (edge !== null) edges.push(edge)
    }
    if (recipe.yieldItem === undefined || itemKey(recipe.yieldItem) === selfKey) continue
    const yielded = corpus.get(itemKey(recipe.yieldItem))
    if (badgedOut(yielded)) edges.push({ basis: 'yield', target: recipe.yieldItem, detail: yielded.eraTag })
  }
  return edges
}

/** Every edge `|relatedquests` and the quest catalog state between them. */
function questEdges(entry: ItemDbEntry, catalogs: EraDeriveCatalogs): EraDerivation[] {
  const edges: EraDerivation[] = []
  for (const use of entry.questUses ?? []) {
    const quest = catalogs.questByName.get((use.page ?? use.quest).trim().toLowerCase())
    if (quest?.startZone === undefined) continue
    if (unopened(zoneEra(quest.startZone))) {
      edges.push({ basis: 'quest', target: quest.name, detail: quest.startZone })
    }
  }
  return edges
}

/**
 * One item's out-of-era edges, in no particular order. Exported for the corpus sweep, which reports
 * the census by basis and needs to see all of them rather than just the winner.
 */
export function outOfEraEdges(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation[] {
  return [...recipeEdges(entry, corpus, catalogs), ...questEdges(entry, catalogs)]
}

/** The one edge a row reports, or null when nothing stated points anywhere out of era. */
export function deriveEra(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs = committedCatalogs()
): EraDerivation | null {
  const edges = outOfEraEdges(entry, corpus, catalogs)
  if (edges.length === 0) return null
  for (const basis of BASIS_ORDER) {
    const hit = edges.find((e) => e.basis === basis)
    if (hit !== undefined) return hit
  }
  // Unreachable while `BASIS_ORDER` covers the union — kept so a fifth basis added without a row in
  // the order degrades to "report something" rather than to "report nothing".
  return edges[0]
}

/**
 * THE WHOLE CORPUS → the derivation for every page that has one. Built once beside the gear index
 * (`gearIndex.ts` hands it the same file it is already walking), so the renderer reads a field.
 *
 * KEYED BY PAGE-CANONICAL ITEM KEY, and every entry is walked including the `|itemname` alias keys:
 * an alias key and its page resolve to the same `itemKey(page)`, so the map holds one answer per
 * page and a second pass over the alias is a no-op rather than a duplicate.
 */
export function buildEraDerivations(
  file: ItemDbFile,
  catalogs: EraDeriveCatalogs = committedCatalogs()
): Map<string, EraDerivation> {
  const corpus = new Map(Object.entries(file.items ?? {}))
  const out = new Map<string, EraDerivation>()
  const seen = new Set<string>()
  for (const entry of corpus.values()) {
    if (seen.has(entry.page)) continue
    seen.add(entry.page)
    // A page that already states an era, or that any zone places, is not layer 3's business. Asked
    // with the page's OWN zones only: the renderer folds the catalog in as well and can therefore
    // only be MORE decided than this, so nothing computed here can overrule a witness it never saw.
    if (layeredVerdict(pageZones(entry), entry.eraTag) !== 'unknown') continue
    const derived = deriveEra(entry, corpus, catalogs)
    if (derived !== null) out.set(itemKey(entry.page), derived)
  }
  return out
}
