// ============================================================================
// shared/outputs/inventory.ts — the DEEP model of an EQ `/outputfile inventory` dump.
// ============================================================================
//
// This is the substrate a future character sheet reads. It is TYPES + PURE derivations
// only: no fs, no Electron, no renderer deps, so both tsconfigs see it and the node test
// runner imports it directly. The text→model parser lives beside the other pure main-side
// parsers (`src/main/outputs/inventoryParse.ts`, mirroring the `parseMap.ts` precedent);
// this file owns what the rows MEAN.
//
// THE LAW OF THIS MODEL: it states what the FILE states, and nothing more. Every field
// below is either a verbatim column, a mechanical split of one, or a derivation whose
// evidence is written down next to it. Where the file is silent (see "what the file does
// NOT say" below) the model stays silent too — a guess here would become a character
// sheet asserting a game fact nobody measured.
//
// ---------------------------------------------------------------------------
// THE MEASURED SHAPE (Primitive_freeport-Inventory.txt, 295 lines, 2026-08-05)
// ---------------------------------------------------------------------------
// The file is TWO tab-separated tables separated by a blank line. A table starts at a
// header row whose SECOND column is literally `Name`; the header's FIRST column names the
// table (`Location`, then `KeyRing`) — that is the only section signal the file gives.
//
//   Location   Name                                ID      Count   Slots     (5 columns)
//   Any Slot   Brigandine Tunic +1                 3307    1       10
//   Any Slot-Slot2  Empty                          0       0       0
//   Face-Slot7 Polished Mithril Mask (Exaltation)  4505    1       10
//   General 1  Spacious Rucksack                   177751  1       24
//   General 1-Slot9   Kelin`s Seven Stringed Lute +1        11573  1  10
//   General 1-Slot9-Slot7  Kelin`s … Lute (Exaltation)      11573  1  10
//
//   KeyRing    Name    ID                                             (header, 4 columns)
//   Equipment  Boots of the Long Road   177708                        (3 columns)
//
// LOCATION IS A PATH. A row's Location is `<base>` followed by zero or more `-Slot<n>`
// segments; each segment descends one level into the slots the parent row's item PROVIDES.
// The chain is terminal, and the separator is specifically `-Slot<digits>` — NOT a bare
// `-`: the real file contains `Personal-Depot1`, a compound BASE token whose hyphen means
// nothing of the kind. A parser that splits on `-` invents a `Depot1` sub-slot of a
// `Personal` row that does not exist.
//
// DUPLICATE BASE TOKENS ARE REAL AND LOAD-BEARING. `Ear`, `Wrist`, `Fingers` and
// `Any Slot` each appear TWICE at top level (two ears, two wrists, two rings, two
// any-slot items) and their children repeat the same paths (`Ear-Slot7` twice). Rows are
// therefore attached to the MOST RECENT row bearing the parent path — correct because the
// client emits a parent immediately before its own children, and the only rule under
// which the first Ear keeps its four sockets and the second Ear keeps its own.
//
// ---------------------------------------------------------------------------
// WHAT THE FILE DOES *NOT* SAY (do not invent these)
// ---------------------------------------------------------------------------
// * Whether a child row is BAG CONTENTS or an EXALTATION SOCKET. Both are spelled
//   `-Slot<n>`, and `Slots` is just "how many child slots this row's item provides" (24
//   for a Spacious Rucksack, 8 for a Backpack, 10 for every ordinary item). The file only
//   ever volunteers the distinction through a child's NAME — `<Item> (Exaltation)` — which
//   is why `exaltation` is a name-derived fact on the CHILD and there is deliberately no
//   `childKind` on the parent. `looksLikeContainer()` below offers the structural guess as
//   an opt-in predicate with its evidence attached; it is never baked into the data.
// * What a trailing `*` on a name means (`Bandages*`, `Backpack*`). It is preserved
//   verbatim in `name` and flagged in `starred`, uninterpreted.
// * Which of two `Ear` rows is the left ear. There is no such column.
// * Anything about an `Empty` row beyond "this slot exists and holds nothing".

import type { HeldCounts } from '../types'

/**
 * The top-level Location tokens that are EQUIPMENT slots — a CLOSED set, measured from the
 * real dump (every top-level token that is not a numbered container). `Any Slot` is the
 * client's own spelling of the slot-agnostic equipment slot; `Held` and `Ammo` are its
 * own tokens too. Anything outside this list parses to `{ kind: 'unknown' }` rather than
 * being coerced into the nearest member — a token we have never seen is a token whose
 * meaning we do not know.
 *
 * NOTE these are the CLIENT's tokens and are deliberately NOT reconciled with
 * `shared/planner/types.ts`'s `EquipSlot` (which is normalized from WIKI tokens):
 * `Fingers` vs `FINGER`, `Any Slot` with no wiki counterpart at all. A future character
 * sheet that needs the join gets a hand-authored, evidence-verified table (law 12), never
 * a fuzzy match.
 */
export const EQUIP_LOCATIONS = [
  'Any Slot',
  'Ammo',
  'Arms',
  'Back',
  'Chest',
  'Ear',
  'Face',
  'Feet',
  'Fingers',
  'Hands',
  'Head',
  'Held',
  'Legs',
  'Neck',
  'Primary',
  'Range',
  'Secondary',
  'Shoulders',
  'Waist',
  'Wrist'
] as const

export type EquipLocationToken = (typeof EQUIP_LOCATIONS)[number]

const EQUIP_SET: ReadonlySet<string> = new Set<string>(EQUIP_LOCATIONS)

/** The numbered storage containers, and the base-token pattern that names each one. */
export type ContainerKind = 'general' | 'bank' | 'sharedBank' | 'personalDepot'

const CONTAINER_PATTERNS: readonly { re: RegExp; container: ContainerKind }[] = [
  { re: /^General (\d+)$/, container: 'general' },
  { re: /^Bank(\d+)$/, container: 'bank' },
  { re: /^SharedBank(\d+)$/, container: 'sharedBank' },
  { re: /^Personal-Depot(\d+)$/, container: 'personalDepot' }
]

/**
 * A row's top-level place: an equipment slot, a numbered storage slot, or honestly
 * unknown. `raw` always carries the base token verbatim, including for `unknown`, so a
 * consumer can display what the game said even when we cannot classify it.
 */
export type InventoryPlace =
  | { kind: 'equip'; token: EquipLocationToken; raw: string }
  | { kind: 'container'; container: ContainerKind; index: number; raw: string }
  | { kind: 'unknown'; raw: string }

/** Classify a base Location token (the part before any `-Slot<n>` chain). */
export function parsePlace(base: string): InventoryPlace {
  if (EQUIP_SET.has(base)) return { kind: 'equip', token: base as EquipLocationToken, raw: base }
  for (const { re, container } of CONTAINER_PATTERNS) {
    const m = re.exec(base)
    if (m) return { kind: 'container', container, index: Number.parseInt(m[1], 10), raw: base }
  }
  return { kind: 'unknown', raw: base }
}

/**
 * Split a Location into its base token and its `-Slot<n>` chain (outermost first).
 * END-anchored on the chain so `Personal-Depot1` keeps its hyphen and yields no sub-slots.
 */
export function splitLocationPath(location: string): { base: string; path: number[] } {
  const m = /^(.*?)((?:-Slot\d+)+)$/.exec(location)
  if (!m) return { base: location, path: [] }
  const path = [...m[2].matchAll(/-Slot(\d+)/g)].map((x) => Number.parseInt(x[1], 10))
  return { base: m[1], path }
}

/** The `-Slot<n>`-stripped parent Location of a row, or null when the row is top level. */
export function parentLocation(location: string): string | null {
  const stripped = location.replace(/-Slot\d+$/, '')
  return stripped === location ? null : stripped
}

/**
 * A name split into the parts the client actually spells out. `base` is what the item is;
 * `tier` is the ` +N` upgrade suffix (END-anchored, same rule as the renderer's
 * `normalizeItemName` — the counting boundary, law 2); `exaltation` marks the client's own
 * `<Item> (Exaltation)` spelling for a socketed exaltation; `starred` records a trailing
 * `*` whose meaning the file never states.
 */
export interface ParsedItemName {
  base: string
  tier?: number
  exaltation: boolean
  starred: boolean
}

const EXALTATION_SUFFIX = ' (Exaltation)'

export function parseItemName(name: string): ParsedItemName {
  let base = name
  const exaltation = base.endsWith(EXALTATION_SUFFIX)
  if (exaltation) base = base.slice(0, -EXALTATION_SUFFIX.length)
  const starred = base.endsWith('*')
  if (starred) base = base.slice(0, -1)
  const tierMatch = / \+(\d+)$/.exec(base)
  if (tierMatch) base = base.slice(0, tierMatch.index)
  return {
    base,
    tier: tierMatch ? Number.parseInt(tierMatch[1], 10) : undefined,
    exaltation,
    starred
  }
}

/** One row of the `Location` table, with the rows nested under it attached. */
export interface InventoryEntry {
  /** the Location column, verbatim */
  location: string
  /** the base token of `location`, classified */
  place: InventoryPlace
  /** the `-Slot<n>` chain, outermost first; `[]` for a top-level row */
  path: readonly number[]
  /** the Name column, verbatim (keeps ` +N`, `*` and `(Exaltation)`) */
  name: string
  /** `name` decomposed — see ParsedItemName */
  parsedName: ParsedItemName
  /** the ID column; 0 when the column is absent or non-numeric */
  itemId: number
  /** the Count column; 0 when absent or non-numeric */
  count: number
  /** the Slots column: how many child slots THIS row's item provides (bag capacity for a
   *  bag, socket capacity for an ordinary item — the file does not distinguish them) */
  slots: number
  /** `Empty` (or a blank name) — the slot exists and holds nothing */
  empty: boolean
  /** rows whose Location is this row's Location plus one more `-Slot<n>` */
  children: InventoryEntry[]
  /** true when this row's parent Location was never seen; the row is kept at top level
   *  rather than being attached to a guessed parent */
  orphan: boolean
  /** 1-based line number in the source text */
  line: number
}

/** One row of the `KeyRing` table (3 columns: category, name, id). */
export interface KeyRingEntry {
  /** the first column — `Equipment` and `Activated` in the real dump */
  category: string
  name: string
  parsedName: ParsedItemName
  itemId: number
  line: number
}

/** A row we could not read as its section's shape (kept so it is diagnosable, never silent). */
export interface RawOutputRow {
  section: string
  columns: readonly string[]
  line: number
}

/** A parsed `/outputfile inventory` dump. */
export interface InventoryDump {
  /** the `Location` table, nested */
  items: InventoryEntry[]
  /** the `KeyRing` table */
  keyRing: KeyRingEntry[]
  /** rows belonging to a section header we do not recognize — retained, never interpreted */
  unknownSections: RawOutputRow[]
  /** rows of a known section that did not have that section's column count */
  malformed: RawOutputRow[]
  /** section names seen, in file order (`['Location', 'KeyRing']` for the real dump) */
  sections: string[]
}

/** Depth-first walk over every entry (parents before children). */
export function* walkEntries(entries: readonly InventoryEntry[]): Generator<InventoryEntry> {
  for (const e of entries) {
    yield e
    yield* walkEntries(e.children)
  }
}

/**
 * The KeyRing categories whose rows are HELD ITEMS — a closed set, and today it holds one
 * member (JOS-66).
 *
 * `Equipment` is a STORAGE LOCATION, not a claimed appearance. The evidence, all measured:
 *
 *   * A reporter's v0.6.3 dump carries his Plane of Sky quest items there and NOWHERE else
 *     — `Light Woolen Mask` (20821) and `Light Woolen Mantle +1` (20823), both NO DROP LORE
 *     Bard quest items, beside `Symbol of Marr +2`, `Bracelet of Cessation +4`,
 *     `Bracelet of Quiescence +2` and `Black Silk Cape`
 *     (`tests/fixtures/jos66-sky-keyring-Inventory.txt`, his six lines verbatim). He ran
 *     `/outputfile inventory`, read those names back out of his own file, and reported the
 *     Sky tab as wrong for saying he had none. A registry of appearances is not where a
 *     player keeps the item he is about to hand to a quest NPC.
 *   * The keyring is DISJOINT from the item table: in the owner's real 295-line dump, ZERO
 *     of the 36 `Equipment` rows names an item the `Location` table also lists (raw name).
 *     So counting them adds copies rather than double-counting ones already counted — which
 *     is exactly why the reporter's Mask reads as zero today.
 *   * One item appears on MULTIPLE rows at one item id (`Boots of the Long Road` 177708:
 *     base once, `+1` twice). A collection of distinct appearances cannot print a duplicate
 *     row; a bin holding real copies can, and does.
 *
 * `Activated` stays OUT (awaiting-sample law). Its single observed member whole-corpus is
 * `Guise of the Deceiver` — an illusion clicky, the classic shape of a consumed item traded
 * for a permanent claim — and one row is no evidence about whether that category holds a
 * copy or a receipt. It ships when a dump proves which.
 */
export const HELD_KEYRING_CATEGORIES: readonly string[] = ['Equipment']

const HELD_KEYRING_SET: ReadonlySet<string> = new Set(HELD_KEYRING_CATEGORIES)

/**
 * The flat `HeldCounts` view of a dump — what the Sky reconcile, `countSource` and
 * `posky/heldCounts.ts` count as "in the player's possession". Pinned by
 * `tests/outputsInventory.test.mts` against the real dump:
 *
 *   * every row of the `Location` table counts, INCLUDING socket rows and bag rows
 *     themselves (`backpack*` is 3 in the real dump — three bags);
 *   * `Empty`/blank names never count;
 *   * the key is the RAW name lowercased — `+N` variants stay separate here and are folded
 *     onto the counting key downstream by `reconcile`/`itemCountKey` (law 2);
 *   * a Count of 0 or nonsense counts as 1 (the old parser's `count > 0 ? count : 1`);
 *   * a `KeyRing` row in a HELD category counts ONE (see HELD_KEYRING_CATEGORIES). The table
 *     has no Count column at all, and a copy is one row — the duplicate
 *     `Boots of the Long Road +1` rows are two boots, not a count of two on one row.
 *
 * THE ONE DELIBERATE DIVERGENCE from the old flat parser (JOS-66). It dropped every keyring
 * row because they are 3 columns and it required 4; the deep model then inherited that as a
 * stated rule ("a keyring entry is a claimed appearance, not an item sitting in a slot"),
 * which was an INFERENCE nobody had measured, and the reporter's dump refutes it for
 * `Equipment`. `tests/outputsInventory.test.mts` still replays the old algorithm and now
 * asserts the difference is EXACTLY the held keyring rows — so the JOS-44 refactor's
 * equivalence proof survives as "identical on the item table", which is all it ever claimed.
 */
export function heldCountsFromDump(dump: InventoryDump): HeldCounts {
  const counts: HeldCounts = {}
  for (const e of walkEntries(dump.items)) {
    if (e.empty) continue
    const key = e.name.toLowerCase()
    counts[key] = (counts[key] ?? 0) + (e.count > 0 ? e.count : 1)
  }
  for (const k of dump.keyRing) {
    if (!HELD_KEYRING_SET.has(k.category) || k.name === '' || k.name === 'Empty') continue
    const key = k.name.toLowerCase()
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * OPT-IN STRUCTURAL GUESS, never a fact of the model (see the header): does this row's
 * child set look like BAG CONTENTS rather than exaltation sockets?
 *
 * Evidence, measured on the real dump: every bag lists ALL of its slots — `Spacious
 * Rucksack` (Slots 24) has children Slot1..Slot24, each `Backpack` (Slots 8) has
 * Slot1..Slot8 — while every socketed item lists a SPARSE subset of 1..10 (`Face` has
 * {7,8,9}, `Ear` has {7,8,9,10}, `Any Slot` has {2,7}). So "children occupy exactly
 * 1..slots" separates the two in every row of the sample.
 *
 * It is a guess and not a fact because a 10-slot bag and an item with all ten sockets
 * listed would be indistinguishable under it. Callers that need certainty should use the
 * child's own `parsedName.exaltation`, which is stated by the file.
 */
export function looksLikeContainer(entry: InventoryEntry): boolean {
  if (entry.slots <= 0 || entry.children.length !== entry.slots) return false
  const occupied = new Set(entry.children.map((c) => c.path[c.path.length - 1]))
  for (let i = 1; i <= entry.slots; i++) {
    if (!occupied.has(i)) return false
  }
  return true
}
