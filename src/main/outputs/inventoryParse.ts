// ============================================================================
// outputs/inventoryParse.ts — text → InventoryDump. The PURE half of the inventory kind.
// ============================================================================
//
// File-system-free (`text -> InventoryDump`, nothing else), mirroring the
// `parseInventoryText`/`loadInventory` and `parseMap`/`packs` splits. That is what lets
// tests/outputsInventory.test.mts run under plain `node --import tsx --test` with no
// Electron and never skip. File RESOLUTION lives in `discovery.ts`, watching in
// `watch.ts`, and the MEANING of every field in `shared/outputs/inventory.ts` — read that
// header first; it carries the measured shape and the "what the file does not say" list.
//
// The rules that are easy to get wrong, all measured against the real dump:
//
//   * A SECTION HEADER is any row whose SECOND column is literally `Name`; its FIRST
//     column names the section (`Location`, then `KeyRing`). That is the only section
//     signal in the file, and it is why the KeyRing header (4 columns, trailing empty) is
//     not mistaken for a keyring row.
//   * `-Slot<n>` — NOT a bare `-` — is the path separator. `Personal-Depot1` is one base
//     token; splitting on `-` invents a sub-slot that does not exist.
//   * A row attaches to the MOST RECENTLY SEEN row bearing its parent path, because base
//     tokens repeat (two `Ear` rows, each with its own `Ear-Slot7`).
//   * A row whose parent path was never seen is kept at TOP LEVEL and flagged `orphan` —
//     never re-parented by guesswork, never dropped.
//   * A malformed row is COUNTED, never thrown on (the parseMap precedent): one bad line
//     in a dump must not blank a character sheet.

import type {
  InventoryDump,
  InventoryEntry,
  KeyRingEntry,
  RawOutputRow
} from '../../shared/outputs/inventory'
import {
  heldCountsFromDump,
  parseItemName,
  parentLocation,
  parsePlace,
  splitLocationPath
} from '../../shared/outputs/inventory'
import type { HeldCounts } from '../../shared/types'

/** The item table's section name (its header's first column). */
const ITEM_SECTION = 'Location'
/** The keyring table's section name. */
const KEYRING_SECTION = 'KeyRing'

interface ParseState {
  section: string
  dump: InventoryDump
  /** Location string → the most recent row bearing it (see the duplicate-token note). */
  byPath: Map<string, InventoryEntry>
}

/** A column as a non-negative integer; absent / non-numeric reads as 0. */
function int(col: string | undefined): number {
  const n = Number.parseInt((col ?? '').trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/** A section header is any row whose second column is literally `Name`. */
function isSectionHeader(cols: readonly string[]): boolean {
  return cols.length >= 2 && cols[1].trim() === 'Name'
}

function raw(section: string, cols: readonly string[], line: number): RawOutputRow {
  return { section, columns: [...cols], line }
}

/**
 * Attach a freshly built row to its parent, or keep it at top level. `orphan` is true only
 * when the row NAMED a parent we never saw — a top-level row is not an orphan.
 */
function attach(state: ParseState, entry: InventoryEntry): void {
  const parentKey = parentLocation(entry.location)
  const parent = parentKey === null ? undefined : state.byPath.get(parentKey)
  if (parent) {
    parent.children.push(entry)
  } else {
    entry.orphan = parentKey !== null
    state.dump.items.push(entry)
  }
  state.byPath.set(entry.location, entry)
}

/** One row of the `Location` table: 5 columns (Location, Name, ID, Count, Slots). */
function addItemRow(state: ParseState, cols: readonly string[], line: number): void {
  // The old parser required 4 columns before it would read a Count; anything shorter was
  // dropped. Same floor here, but the dropped row is recorded instead of vanishing.
  if (cols.length < 4) {
    state.dump.malformed.push(raw(state.section, cols, line))
    return
  }
  const location = cols[0].trim()
  const name = cols[1].trim()
  const { base, path } = splitLocationPath(location)
  const entry: InventoryEntry = {
    location,
    place: parsePlace(base),
    path,
    name,
    parsedName: parseItemName(name),
    itemId: int(cols[2]),
    count: int(cols[3]),
    slots: int(cols[4]),
    empty: name === '' || name === 'Empty',
    children: [],
    orphan: false,
    line
  }
  attach(state, entry)
}

/** One row of the `KeyRing` table: 3 columns (category, Name, ID) — no Count, no Slots. */
function addKeyRingRow(state: ParseState, cols: readonly string[], line: number): void {
  if (cols.length < 3) {
    state.dump.malformed.push(raw(state.section, cols, line))
    return
  }
  const name = cols[1].trim()
  const entry: KeyRingEntry = {
    category: cols[0].trim(),
    name,
    parsedName: parseItemName(name),
    itemId: int(cols[2]),
    line
  }
  state.dump.keyRing.push(entry)
}

/**
 * Parse a `/outputfile inventory` dump.
 *
 * Rows before any header read as the item table — that is both the old parser's behavior
 * and the only sane default for a file whose first line IS the item header.
 *
 * Rows under a section header we do not recognize go to `unknownSections` VERBATIM and are
 * never interpreted (and so never reach `heldCountsFromDump`). This is the one deliberate
 * behavior difference from the old parser, which would have counted any ≥4-column row of a
 * future third table into held item counts as though it were inventory. That was never a
 * contract — it was the absence of a section concept — and counting rows of a table whose
 * shape we have never seen is exactly the guess this engine exists to refuse.
 */
export function parseInventoryDump(text: string): InventoryDump {
  const state: ParseState = {
    section: ITEM_SECTION,
    dump: { items: [], keyRing: [], unknownSections: [], malformed: [], sections: [] },
    byPath: new Map()
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = line.split('\t')
    if (isSectionHeader(cols)) {
      state.section = cols[0].trim()
      state.dump.sections.push(state.section)
      // A new section starts a new path space; nothing nests across tables.
      state.byPath.clear()
      continue
    }
    if (state.section === ITEM_SECTION) addItemRow(state, cols, i + 1)
    else if (state.section === KEYRING_SECTION) addKeyRingRow(state, cols, i + 1)
    else state.dump.unknownSections.push(raw(state.section, cols, i + 1))
  }
  return state.dump
}

/**
 * The flat held-counts view of a dump's text — EXACTLY what `parseInventoryText`
 * (inventory/parseInventory.ts) returns, expressed here so the equivalence test can call
 * the production code path without dragging in the fs/Electron layer above it.
 */
export function inventoryHeldCounts(text: string): HeldCounts {
  return heldCountsFromDump(parseInventoryDump(text))
}
