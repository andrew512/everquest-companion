// THE quest-list sort orders, pure. useQuestList filters, then calls exactly one comparator
// from here, then re-pins favorites — so a new order is a case in this file and a line in
// SORT_OPTIONS, and nothing else moves.
//
// Every comparator is TOTAL: each one bottoms out in quest name (then class), so the list has
// one deterministic order per key and never shuffles on re-render.

import type { QuestProgress } from './useProgress'

export type SortKey = 'recent' | 'closest' | 'least-missing' | 'name' | 'class' | 'island'

/**
 * "What did my last drops affect" is the question the tab is usually open to answer, so
 * recency leads.
 */
export const DEFAULT_SORT: SortKey = 'recent'

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Most recent drop' },
  { value: 'closest', label: 'Closest to done' },
  { value: 'least-missing', label: 'Fewest missing' },
  { value: 'name', label: 'Quest name (A-Z)' },
  { value: 'class', label: 'By class' },
  { value: 'island', label: 'By island' }
]

export function isSortKey(v: unknown): v is SortKey {
  return SORT_OPTIONS.some((o) => o.value === v)
}

/** The universal last resort: name, then class (names repeat across classes — sharedItems.ts). */
function byName(a: QuestProgress, b: QuestProgress): number {
  return a.name.localeCompare(b.name) || a.className.localeCompare(b.className)
}

const ISLAND_RE = /^island\s+(\d+)$/i

/**
 * The part of a required-item row each derivation below reads — structural, like
 * poskyDroppers' DropperSource, so both the live `ItemProgress` and the raw bundled
 * `PoskyItem` satisfy them and neither derivation drags a React module into a node test.
 */
interface ItemWhere {
  where: string
}
interface ItemDropped {
  lastLootedAt?: number
}

/**
 * Which Sky island a quest starts you on, or undefined when the data does not say.
 *
 * There is no island field on a quest — only `where` per required ITEM, and most of those read
 * "Plane of Sky" or empty. So the quest's island is the LOWEST numbered island any of its items
 * names: 88 of the 95 committed quests name exactly one island anyway, 6 name two (this picks the
 * earlier, which is where progression starts you), and 1 names none and stays undefined. A guessed
 * island would be a fabricated progression order (law 1), so that one sorts with the unknowns.
 */
export function questIsland(q: { items: readonly ItemWhere[] }): number | undefined {
  let lowest: number | undefined
  for (const it of q.items) {
    const m = ISLAND_RE.exec(it.where.trim())
    if (!m) continue
    const n = Number(m[1])
    if (lowest === undefined || n < lowest) lowest = n
  }
  return lowest
}

/**
 * A quest's "most recent drop" key: the NEWEST time any item it requires last dropped.
 * undefined when none of them ever has — the absence the sort is required to honour rather
 * than round down to zero.
 */
export function questDropRecency(items: readonly ItemDropped[]): number | undefined {
  let newest: number | undefined
  for (const it of items) {
    const t = it.lastLootedAt
    if (t !== undefined && (newest === undefined || t > newest)) newest = t
  }
  return newest
}

/**
 * Keyed quests first, ordered by `key`; unkeyed ones ALL below, ordered by name.
 * The shape both "no drops yet" and "no island in the data" need: absence is not a low value,
 * it is a missing answer, and it must not interleave with real ones.
 */
function byOptional(
  key: (q: QuestProgress) => number | undefined,
  order: (a: number, b: number) => number
): (a: QuestProgress, b: QuestProgress) => number {
  return (a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka === undefined || kb === undefined) {
      if (ka === kb) return byName(a, b)
      return ka === undefined ? 1 : -1
    }
    return order(ka, kb) || byName(a, b)
  }
}

export function compareQuests(sort: SortKey): (a: QuestProgress, b: QuestProgress) => number {
  switch (sort) {
    // Newest drop first. A quest none of whose items has ever dropped has NO recency —
    // it sorts below every quest that has one, by name.
    case 'recent':
      return byOptional((q) => q.lastDropAt, (x, y) => y - x)
    case 'closest':
      return (a, b) =>
        b.ratio - a.ratio || a.missing.length - b.missing.length || byName(a, b)
    case 'least-missing':
      return (a, b) => a.missing.length - b.missing.length || b.ratio - a.ratio || byName(a, b)
    case 'name':
      return byName
    case 'class':
      return (a, b) => a.className.localeCompare(b.className) || byName(a, b)
    case 'island':
      return byOptional(questIsland, (x, y) => x - y)
  }
}

/** Non-mutating sort — the caller's array is filter output it may still be holding. */
export function sortQuests(quests: readonly QuestProgress[], sort: SortKey): QuestProgress[] {
  return [...quests].sort(compareQuests(sort))
}
