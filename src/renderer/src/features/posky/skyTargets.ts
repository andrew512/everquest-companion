// ============================================================================
// skyTargets.ts — the Targets tab's whole model: "who do I still kill", cross-quest.
// ============================================================================
//
// GitHub issue #30, landed as JOS-417 from community PR #34 (johnsideserf) — this module and the
// tab it feeds are that contribution, integrated. The tracker says what each quest needs; the
// player's real question on the islands is the inversion — which mobs are still worth pulling,
// across every quest at once. This module is that inversion as a pure fold: no React, no data
// bundle, relative value imports, pinned by tests/skyTargets.test.mts (half against the committed
// catalog, the poskyDroppers precedent).
//
// THE NEED SET IS THE QUESTS THAT STILL WANT SOMETHING, and `firstTimeOnly` decides whether a
// quest you have already run is one of them — the JOS-155 shape, ported from the Ready tab rather
// than invented. Default ON, so the default reading is never-turned-in (`everTurnedIn`, the Ready
// tab's first-time predicate; a reward-inferred completion reads turnIns >= 1 through the same
// predicate and needs no special case). OFF is the refarmer's reading, and it is the reason this
// is a parameter rather than a constant: JOS-131 made a turn-in SUBTRACT what it consumed, so a
// quest you ran drops back to 0/N and is genuinely work again — hard-coding the first-time rule
// would empty this tab permanently for exactly the player deepest into the grind. Both readings
// run the identical fold below; the flag reaches nothing but which quests enter it.
//
// The CALLER supplies the visible (not-ignored) quest set; ignoring is the one flag that means
// "never show me this", and it is decided upstream in useQuestList exactly once — this module does
// not re-filter (the Ready tab's rule).
//
// SHORTFALL AGGREGATES PER COUNTING KEY, NEVER PER QUEST. `computeQuestProgress` clamps `have`
// per quest and allocates nothing across quests, so a per-quest `have < need` filter would read
// two quests each "satisfied" by the same single held copy — and Sky quests contend for items
// heavily (sharedItems.ts). The rule: totalNeed summed over the need set, minus the UNCAPPED
// `held` (same counting key ⇒ same held number on every occurrence), floored at zero. There is
// deliberately NO per-quest allocation of the held copies — any split (first-wins, proportional)
// would be invented semantics; the aggregate is the only number the data can vouch for, so the
// aggregate is the only number shown.
//
// CLASSIFICATION IS THE SCRAPE'S OWN WORDS (law 1, never a guess):
//   * resolved `droppers` fold into mob cards — dedupe by `page` per item so a twice-listed
//     mob cannot inflate its coverage (the questKillTargets rule, cross-quest);
//   * an unresolved item whose `who` starts with "random drop" (case-insensitive PREFIX — the
//     literal sentinel carries an em dash, and copyNoEmDash.test.mts rejects that character in
//     any src/renderer string literal) is the collective random-drop entry;
//   * anything else unresolved goes to the no-known-source list — shown as missing data, never
//     dropped and never guessed at.
//
// THE ORDER IS COUNTED, NOT GUESSED: mobs by distinct needed items covered, descending, then
// name — killing the top row closes the most of what is left. Items inside a card and both
// special lists read alphabetically: deterministic, explainable, nothing invented. Islands ride
// per mob from the items that mob is the target for, in island-number order.
//
// A CARD'S IDENTITY IS THE WIKI PAGE, NEVER THE NAME — and there is no era or difficulty variant
// hiding behind that today. MEASURED over the committed catalog (JOS-417, 2026-08-19): the 7,872
// mob rows carry NO era annotation at all (`MobEntry` is page/name/level/zones/drops/loc — the
// `eraTag` the item DB carries has no counterpart here), and of the 65 rows the Sky-zone gate
// admits, ZERO share a name with another. So page identity and name identity coincide, and the
// two are not being conflated by luck: `page` is what the dedupe keys on, which is the reading
// that stays correct the day the catalog does grow a second page for one name — it would draw two
// cards, each with its own level and its own drop list, rather than silently merging two mobs.
// The measurement is pinned in tests/skyTargets.test.mts so it cannot rot in silence.

import { itemCountKey, normalizeItemName } from '../../lib/itemName'
import { everTurnedIn } from './questCompletion'
import {
  dropperNameOrder,
  isRandomDropWho,
  islandNumber,
  islandOf,
  mergeDroppers,
  type DropperMob
} from './poskyDroppers'

/** One quest item as the fold reads it — the `ItemProgress` fields it consumes, structural. */
export interface TargetsQuestItem {
  name: string
  need: number
  /** UNCAPPED held count (`ItemProgress.held`) — the per-quest clamped `have` is never read. */
  held: number
  droppers: readonly DropperMob[]
  where: string
  who: readonly string[]
}

/** One quest as the fold reads it — `QuestProgress`, structurally. */
export interface TargetsQuest {
  className: string
  name: string
  turnIns: number
  items: readonly TargetsQuestItem[]
}

/** One still-needed item: the aggregate shortfall and every need-set quest that wants it. */
export interface NeededItem {
  name: string
  /** summed required count across the need set, minus held, floored at zero — always > 0 here */
  shortfall: number
  quests: { className: string; questName: string; need: number }[]
  /** where it drops, island-number order; empty when posky states no island */
  islands: string[]
}

/** One mob still worth killing, with everything it can still yield. */
export interface TargetMob {
  mob: DropperMob
  /** distinct needed items this mob drops — the sort key, always `items.length` */
  covers: number
  islands: string[]
  items: NeededItem[]
}

export interface SkyTargetsModel {
  mobs: TargetMob[]
  /** needed items with no kill target that posky calls a random drop (the Wind Runes) */
  randomDrop: NeededItem[]
  /** needed items nothing committed can source — missing data, stated rather than hidden */
  unsourced: NeededItem[]
}

/** Per counting key, everything the need set says about one item, accumulated before deciding. */
interface ItemAgg {
  name: string
  totalNeed: number
  held: number
  droppers: readonly DropperMob[]
  /** true the moment ANY contributing quest's `who` states the random-drop sentinel — a flag
   *  rather than a frozen `who` array, so classification can never depend on fold order. */
  isRandom: boolean
  islands: Set<string>
  quests: { className: string; questName: string; need: number }[]
}

/** Item lines and both remainder lists read alphabetically — local to this pane, no counterpart
 *  elsewhere to drift from. Mob order is `dropperNameOrder`, the one comparator the Quests tab's
 *  own kill targets use, imported rather than copied so the two tabs can never disagree about
 *  which mob leads a tie. */
const byItemName = (a: NeededItem, b: NeededItem): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase())

const sortIslands = (islands: Set<string>): string[] =>
  [...islands].sort((a, b) => islandNumber(a) - islandNumber(b))

/** Fold one quest item into its counting key's aggregate. */
function recordItem(byKey: Map<string, ItemAgg>, q: TargetsQuest, it: TargetsQuestItem): void {
  const key = itemCountKey(it.name)
  const agg = byKey.get(key) ?? {
    name: it.name,
    totalNeed: 0,
    held: it.held,
    droppers: it.droppers,
    isRandom: false,
    islands: new Set<string>(),
    quests: []
  }
  agg.totalNeed += it.need
  agg.isRandom = agg.isRandom || isRandomDropWho(it.who)
  // Prefer the BASE display name over a `+N` variant, the deriveLootNames rule.
  if (agg.name !== normalizeItemName(agg.name) && it.name === normalizeItemName(it.name)) {
    agg.name = it.name
  }
  // THE UNION, NOT THE FIRST ANSWER (JOS-417). Two quests wanting the same counting key resolve
  // droppers SEPARATELY, and `skyDroppersFor` reads each row's own `who` as its layer 1 — so the
  // two lists are only guaranteed equal while layer 1 stays silent, which is a measurement about
  // today's scrape (poskyDroppers' header: nine values, none of them a mob name) and not an
  // invariant. First-wins would make the card set depend on which quest folded first the day that
  // measurement changes. `mergeDroppers` is the module's own union, deduped by page.
  agg.droppers =
    agg.droppers.length === 0 ? it.droppers : mergeDroppers(agg.droppers, it.droppers)
  const island = islandOf(it.where)
  if (island !== undefined) agg.islands.add(island)
  agg.quests.push({ className: q.className, questName: q.name, need: it.need })
  byKey.set(key, agg)
}

/** Everything the need set says, per counting key. The one membership filter is HERE. */
function accumulateNeeds(
  quests: readonly TargetsQuest[],
  firstTimeOnly: boolean
): Map<string, ItemAgg> {
  const byKey = new Map<string, ItemAgg>()
  for (const q of quests) {
    if (firstTimeOnly && everTurnedIn(q)) continue
    for (const it of q.items) recordItem(byKey, q, it)
  }
  return byKey
}

/** One aggregate as the pane's item line — or nothing, when the holdings already cover it. */
function toNeeded(agg: ItemAgg): NeededItem | null {
  const shortfall = Math.max(0, agg.totalNeed - agg.held)
  if (shortfall === 0) return null
  return { name: agg.name, shortfall, quests: agg.quests, islands: sortIslands(agg.islands) }
}

interface MobAcc {
  mob: DropperMob
  islands: Set<string>
  items: NeededItem[]
}

/** Fold one needed item onto every mob that drops it — per ITEM dedupe by page, so a page listed
 *  twice on one item cannot inflate its coverage (the questKillTargets rule). */
function foldIntoMobs(mobsByPage: Map<string, MobAcc>, needed: NeededItem, droppers: readonly DropperMob[]): void {
  const seen = new Set<string>()
  for (const m of droppers) {
    if (seen.has(m.page)) continue
    seen.add(m.page)
    const hit = mobsByPage.get(m.page) ?? { mob: m, islands: new Set<string>(), items: [] }
    hit.items.push(needed)
    for (const island of needed.islands) hit.islands.add(island)
    mobsByPage.set(m.page, hit)
  }
}

/**
 * The Targets model, from the quests the user can see.
 *
 * `firstTimeOnly` (default true — the header argues it) is the ONE knob and it reaches nothing but
 * which quests enter the fold: a quest you have already handed in still wants its items back, and
 * a refarmer unticking the box gets exactly the same arithmetic over a wider need set. It is the
 * Ready tab's toggle (JOS-155) with the same default and the same meaning, deliberately, so a
 * player only has to learn the rule once.
 */
export function skyTargets(
  quests: readonly TargetsQuest[],
  firstTimeOnly = true
): SkyTargetsModel {
  const mobsByPage = new Map<string, MobAcc>()
  const randomDrop: NeededItem[] = []
  const unsourced: NeededItem[] = []
  for (const agg of accumulateNeeds(quests, firstTimeOnly).values()) {
    const needed = toNeeded(agg)
    if (needed === null) continue
    if (agg.droppers.length > 0) foldIntoMobs(mobsByPage, needed, agg.droppers)
    else if (agg.isRandom) randomDrop.push(needed)
    else unsourced.push(needed)
  }
  const mobs: TargetMob[] = [...mobsByPage.values()]
    .map((e) => ({
      mob: e.mob,
      covers: e.items.length,
      islands: sortIslands(e.islands),
      items: [...e.items].sort(byItemName)
    }))
    .sort((a, b) => (a.covers === b.covers ? dropperNameOrder(a.mob, b.mob) : b.covers - a.covers))
  randomDrop.sort(byItemName)
  unsourced.sort(byItemName)
  return { mobs, randomDrop, unsourced }
}
