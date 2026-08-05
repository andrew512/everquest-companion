// planner/effectIndex.ts — the committed item corpus → the two indices the Exaltation Planner
// serves over IPC (docs/plans/exaltation-planner.md §4.1):
//
//   * DONORS — one row per (item, effect): "Ghoulbane carries Nullify Undead, it is a proc, and
//     the item must be merged to +4 before that proc can be extracted."
//   * ITEMS  — one searchable row per item, effect-bearing or not, for the Board's HOST picker
//     ("which sword am I socketing this into"), with the precomputed lowercase `searchKey` the
//     standing search law asks for.
//
// PURE and ELECTRON-FREE on purpose (the mobSearch precedent, now repo-wide): value imports are
// RELATIVE, nothing here reads a file, and `tests/plannerEffectIndex.test.mts` runs the shipped
// builder over the REAL committed bytes. The JSON import lives in the IPC handler, not here, so
// a test pays for the 7 MB only when it wants it.
//
// D1 — why MAIN: items.json is already inlined into main's bundle for itemLookup. Importing it
// into the renderer as well would double it; the effect-bearing subset is ~1.5k rows, which is a
// few hundred KB over IPC, fetched once.
//
// TWO DEDUPES, MEASURED 2026-08-04 against the committed corpus (11,351 keys / 11,155 pages):
//   1. ALIAS KEYS. A page contributes up to two keys — its title and its `|itemname` when they
//      differ (196 of them). Walking `items` naively would emit every effect on those pages
//      twice. Skipped by PAGE identity.
//   2. DUPLICATE PAGES FOR ONE ITEM — which the brief did not predict and the data does. Six
//      effect-bearing item names are written up on more than one page: apostrophe variants
//      ("10 Dose Ethiras Poison Antidote" beside "10 Dose Ethira's Poison Antidote",
//      "Packmasters Lash"), the four elemental "Holgresh Mojo Stick (Air/Earth/Fire/Water)"
//      pages, and a guide page whose `|itemname` IS an item ("Nyrod's Guide to Thurgadin Gate
//      Pots" → Vial of Velium Vapors). Three of those produce a genuinely duplicate
//      (key, effect, socket) row. The row identity is that triple, so the second one is dropped
//      — and when the pages disagree (they do: Casting Time 2.0 vs 4.0, a `Req Level` on one
//      side only), the ITEM'S OWN PAGE wins over the variant, decided by `canonical` below and
//      never by which key the JSON happened to list first.
//
// Everything the rows say about slots, classes, sockets, tiers and haste is read out of the
// shared planner modules — this file measures the corpus, it never re-states a rule.
//
// WIKI DROP SOURCES ride along on every donor row (`wikiSources`, from the item page's own
// `|dropsfrom`). They are the SECOND witness to "where does this drop": the renderer already
// inverts the mob catalog's `|known_loot`, and the two sides of the wiki omit different things —
// measured 2026-08-04, 126 effect-bearing donors are neither quest nor crafted and have no
// catalog source at all, and 43 of those name a zone on their own page. Serving both and joining
// them at the consumer is the honest arrangement; this file never merges or ranks them.
//
// THE PAGE'S ERA BANNER rides along the same way (`eraTag`, the `{{Velious Era}}` token). It is
// the last-resort witness for the donors neither source places — 94 of those 126 carry one — and
// like `wikiSources` it is carried VERBATIM: `shared/planner/era.ts` is the only file that decides
// what a token means, and the renderer is the only place the two witnesses are folded together.

import { itemKey, knowledgeFromDb, type ItemDbEntry, type ItemDbFile } from '../itemsDb'
import {
  isHasteEffect,
  normalizeClasses,
  normalizeSlotTokens,
  socketTypeOf
} from '../../shared/planner/normalize'
import { extractionTier } from '../../shared/planner/rules'
import type { ClassAbbr } from '../../shared/classCombo'
import type { ItemEffect } from '../../shared/itemStats'
import type { ItemDropSource } from '../../shared/types'
import type {
  EquipSlot,
  PlannerDonor,
  PlannerItemHit,
  SocketType
} from '../../shared/planner/types'

/** A host-picker row plus its precomputed lowercase name — computed once per build, not per keystroke. */
export interface PlannerItemRow extends PlannerItemHit {
  searchKey: string
}

/**
 * What the build SAW. Kept because the corpus is the thing under test: the floors in
 * `tests/plannerEffectIndex.test.mts` are assertions about these numbers, and `unknownSlotTokens`
 * must stay empty — a rescrape that invents a slot spelling turns the suite red instead of
 * silently dropping items out of the planner (law 1).
 */
export interface PlannerBuildStats {
  /** distinct item PAGES walked */
  pages: number
  /** `|itemname` alias keys skipped because their page was already read */
  aliasKeys: number
  /** pages whose stats block stated at least one effect */
  effectPages: number
  /** effect lines read across those pages */
  effectRows: number
  /** effect lines whose socket the wiki did not state (a bare `Effect:` — excluded, D2/§3.2) */
  socketless: number
  /** rows dropped because another page already stated the same (key, effect, socket) */
  duplicateRows: number
  /** slot tokens `normalizeSlotTokens` did not recognize, verbatim */
  unknownSlotTokens: string[]
}

export interface PlannerIndex {
  donors: PlannerDonor[]
  items: PlannerItemRow[]
  stats: PlannerBuildStats
}

/** Everything about one item page that every effect on it shares. */
interface PageCtx {
  key: string
  name: string
  iconId?: number
  slots: EquipSlot[]
  classes: ClassAbbr[]
  quest: boolean
  playerCrafted: boolean
  /** what the item page's `|dropsfrom` stated; absent when it carried none */
  wikiSources?: ItemDropSource[]
  /** the page-top `{{X Era}}` banner's token; absent when the page opened with none */
  eraTag?: string
  /** the page TITLE keys to the item name — this is the item's own page, not a variant of it */
  canonical: boolean
}

interface Acc {
  seenPages: Set<string>
  /** `${key}\0${effect}\0${socket}` → row */
  donors: Map<string, PlannerDonor>
  donorFromCanonical: Set<string>
  items: Map<string, PlannerItemRow>
  itemFromCanonical: Set<string>
  unknownSlots: Set<string>
  stats: Omit<PlannerBuildStats, 'unknownSlotTokens'>
}

function newAcc(): Acc {
  return {
    seenPages: new Set(),
    donors: new Map(),
    donorFromCanonical: new Set(),
    items: new Map(),
    itemFromCanonical: new Set(),
    unknownSlots: new Set(),
    stats: {
      pages: 0,
      aliasKeys: 0,
      effectPages: 0,
      effectRows: 0,
      socketless: 0,
      duplicateRows: 0
    }
  }
}

/**
 * One stored record → the page context. `knowledgeFromDb` restores the fields the compact record
 * omits, so the name (and therefore the key) is the in-game `|itemname` when the page states one
 * — which is what a loot line spells, and what the rest of the app already keys items by.
 */
function pageContext(entry: ItemDbEntry): {
  ctx: PageCtx
  effects: ItemEffect[]
  unknown: string[]
} {
  const k = knowledgeFromDb(entry)
  const slot = normalizeSlotTokens(k.stats?.slot)
  const key = itemKey(k.name)
  return {
    ctx: {
      key,
      name: k.name,
      iconId: k.iconId,
      slots: slot.slots,
      classes: normalizeClasses(k.stats?.classes),
      quest: k.quest,
      playerCrafted: k.playerCrafted ?? false,
      // Carried through verbatim, not merged with the renderer's catalog index: the two are
      // independent witnesses and the join belongs where both are in hand (design §4.2).
      wikiSources: k.dropsFrom,
      eraTag: k.eraTag,
      canonical: itemKey(entry.page) === key
    },
    effects: k.stats?.effects ?? [],
    unknown: slot.unknown
  }
}

function donorRow(ctx: PageCtx, effect: ItemEffect, socket: SocketType): PlannerDonor {
  return {
    key: ctx.key,
    name: ctx.name,
    iconId: ctx.iconId,
    slots: [...ctx.slots],
    classes: [...ctx.classes],
    effect: effect.name,
    detail: effect.detail,
    socket,
    tierRequired: extractionTier(socket),
    hasteLocked: isHasteEffect(effect.name, effect.detail),
    quest: ctx.quest,
    playerCrafted: ctx.playerCrafted,
    reqLevel: effect.reqLevel,
    // Copied per row (donors are denormalized by effect) so a consumer never has to hold a
    // second index to answer "where does this one drop".
    wikiSources: ctx.wikiSources ? ctx.wikiSources.map((s) => ({ ...s })) : undefined,
    eraTag: ctx.eraTag
  }
}

/**
 * Keep at most one row per (key, effect, socket). A later duplicate wins ONLY when it comes from
 * the item's own page and the row already held does not — see dedupe 2 in the header.
 */
function rememberDonor(acc: Acc, ctx: PageCtx, row: PlannerDonor): void {
  // NUL-joined: effect names contain spaces, so a printable separator would let two different
  // (key, effect) pairs share one identity.
  const id = `${row.key}\u0000${row.effect}\u0000${row.socket}`
  if (acc.donors.has(id)) {
    acc.stats.duplicateRows++
    if (!ctx.canonical || acc.donorFromCanonical.has(id)) return
  }
  acc.donors.set(id, row)
  if (ctx.canonical) acc.donorFromCanonical.add(id)
}

/** Same rule for the host-picker index: one row per item key, the item's own page preferred. */
function rememberItem(acc: Acc, ctx: PageCtx): void {
  if (acc.items.has(ctx.key) && (!ctx.canonical || acc.itemFromCanonical.has(ctx.key))) return
  acc.items.set(ctx.key, {
    key: ctx.key,
    name: ctx.name,
    iconId: ctx.iconId,
    slots: [...ctx.slots],
    classes: [...ctx.classes],
    searchKey: ctx.name.toLowerCase()
  })
  if (ctx.canonical) acc.itemFromCanonical.add(ctx.key)
}

function addPage(acc: Acc, entry: ItemDbEntry): void {
  if (acc.seenPages.has(entry.page)) {
    acc.stats.aliasKeys++
    return
  }
  acc.seenPages.add(entry.page)
  acc.stats.pages++

  const { ctx, effects, unknown } = pageContext(entry)
  for (const token of unknown) acc.unknownSlots.add(token)
  rememberItem(acc, ctx)
  if (effects.length === 0) return

  acc.stats.effectPages++
  for (const effect of effects) {
    acc.stats.effectRows++
    const socket = socketTypeOf(effect.kind)
    // A bare `Effect:` whose parenthetical named no socket: the wiki did not say where it goes,
    // and guessing would put an unextractable effect on a farm list. Counted, never emitted.
    if (socket === null) acc.stats.socketless++
    else rememberDonor(acc, ctx, donorRow(ctx, effect, socket))
  }
}

/** The committed file → both indices in ONE pass. */
export function buildPlannerIndex(file: ItemDbFile): PlannerIndex {
  const acc = newAcc()
  for (const entry of Object.values(file.items ?? {})) addPage(acc, entry)
  return {
    donors: [...acc.donors.values()],
    items: [...acc.items.values()],
    stats: { ...acc.stats, unknownSlotTokens: [...acc.unknownSlots] }
  }
}

/** The donor rows alone — the shape `IPC.plannerDonors` serves. */
export function buildPlannerDonors(file: ItemDbFile): PlannerDonor[] {
  return buildPlannerIndex(file).donors
}

/** How many host-picker hits one search may return. Named so the handler and the UI agree. */
export const PLANNER_SEARCH_LIMIT = 50

/**
 * Substring search over item names for the host picker.
 *
 * Ranking, in order: names that START with the query first (typing "ghoul" wants Ghoulbane before
 * "Amulet of the Ghoul"), then the SHORTEST name (the plain item before its variants), then
 * alphabetical so the list never reshuffles between two equally-good hits. Capped at `limit`.
 *
 * Deliberately substring, not fuzzy (law 12): this picks a real item by the name the user is
 * typing; a fuzzy matcher would happily offer a different item that reads nearly the same.
 */
export function searchPlannerItems(
  index: readonly PlannerItemRow[],
  query: string,
  limit: number = PLANNER_SEARCH_LIMIT
): PlannerItemHit[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const hits: { row: PlannerItemRow; rank: number }[] = []
  for (const row of index) {
    const at = row.searchKey.indexOf(q)
    if (at >= 0) hits.push({ row, rank: at === 0 ? 0 : 1 })
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.row.name.length - b.row.name.length ||
      a.row.searchKey.localeCompare(b.row.searchKey)
  )
  return hits.slice(0, Math.max(0, limit)).map(({ row }) => ({
    key: row.key,
    name: row.name,
    iconId: row.iconId,
    slots: row.slots,
    classes: row.classes
  }))
}
