// ============================================================================
// outputs/baseline.ts — WHEN a dump was generated, WHAT it covered, and what "since" means.
// ============================================================================
//
// JOS-128. A 0.14.0 user deleted an item in game, hit Reload Inventory, and the Companion still
// said they had it. The mechanism was not double-counting: it was that NOTHING ever reset. The
// log-derived count is "everything this character has ever looted", and no reload could lower
// it, so `max(log, dump)` re-asserted the deleted item every time.
//
// OWNER DESIGN (2026-08-09): an inventory outputfile load is the BASELINE. It RESETS the model
// to exactly what the dump says, and log-derived inventory events accumulate FROM THAT POINT
// FORWARD. This file owns the one question that makes "that point" knowable, and it is pure:
// no fs, no Electron, so tests/inventoryBaseline.test.mts drives it under plain node.
//
// WHERE THE GENERATION INSTANT COMES FROM — two sources, measured, in this order:
//
//   1. THE LOG, and it is the authoritative one. EQ prints `Outputfile Complete: <file>` when
//      the dump finishes writing; the parser claims it as an `outputFile` event
//      (parseSession.ts). Its timestamp is EQ's own, parsed by the same `parseTs` that stamps
//      every loot row, so a baseline-versus-loot comparison happens inside ONE time base
//      instead of across two clocks. Matching is on the FILE NAME, because
//      `/outputfile inventory [optional filename]` lets the player choose it and the only
//      honest join is against the file we actually read.
//
//   2. THE FILE'S MTIME, as fallback — already carried end to end as `inventorySource.loadedAt`.
//      Measured on the owner's machine (2026-08-09) against the log line for the SAME dump:
//      mtime lands 767 ms after the log stamp, same second, same wall clock. Its failure modes
//      are stated rather than hidden, because a wrong baseline is silent:
//        * A dump COPIED between machines, restored from a backup, or touched by cloud sync
//          carries the copy time. That baseline is too LATE, so real loot after the true
//          generation is wrongly ignored and the model under-counts.
//        * A hand-edited dump gets the same treatment.
//        * mtime is an OS wall clock; a loot `ts` is parsed from a log timestamp that carries
//          no zone, so a DST boundary can slide the two an hour apart in either direction.
//      A fallback baseline is still enormously better than no baseline: without one there is no
//      reset at all, which is the bug.
//
//   3. THE FILE'S CONTENT: there is no third source. The dump is a header row (Location, Name,
//      ID, Count, Slots), then rows, then the KeyRing table. It carries no date anywhere,
//      verified against the real 295-row dump.
//
// SECOND RESOLUTION, AND THE `>` THAT FOLLOWS FROM IT. EQ log timestamps have one-second
// resolution, so both sources are floored to the second and an event counts as "since the
// baseline" only when it is STRICTLY LATER. The tie is broken toward the dump on purpose: an
// item looted in the same second the dump was written is already IN the dump, and counting it
// again re-creates the over-count this ticket is about. The cost is the mirror case — an item
// looted in that same second but just AFTER the write is missed until the next reload, one
// item for at most one second, and the next dump states the truth.

import type { ContainerKind, InventoryDump } from './inventory'

/** Where a dump's generation instant came from — the log's own receipt, or the file's mtime. */
export type InventoryBaselineSource = 'log' | 'mtime'

/**
 * A STORAGE the dump can speak about. Named here rather than beside `ContainerKind` because it
 * is what gets PERSISTED, and because `storagesCoveredBy` pins the two together with a total
 * map: a container kind added over there is a compile error until it is added here.
 */
export type InventoryStorage = 'equip' | 'general' | 'bank' | 'sharedBank' | 'personalDepot' | 'keyRing'

/** A dump's generation instant, and which of the two sources answered. */
export interface InventoryBaseline {
  /** Epoch ms, floored to the second (see the header). */
  ts: number
  source: InventoryBaselineSource
}

/**
 * What we know about the dump the persisted held counts came from — `ProgressState.inventorySource`.
 *
 * Everything past `loadedAt` is ADDITIVE and OPTIONAL (the `exaltPlans` precedent): a store
 * written before JOS-128 has none of it, every reader defaults, and a missing baseline simply
 * means the accumulate rule cannot apply until the next reload writes one. No schema bump and
 * no migration step.
 */
export interface InventorySource {
  path: string
  /** The file's mtime, ISO. What the freshness line renders. */
  loadedAt: string
  /** Epoch ms the dump was GENERATED, floored to the second. Absent on a pre-JOS-128 store. */
  generatedAt?: number
  /** Which of the two sources answered. Absent whenever `generatedAt` is. */
  generatedFrom?: InventoryBaselineSource
  /**
   * WHICH STORAGES THIS BASELINE ACTUALLY SAW (the JOS-132 spike's finding). The dump is an
   * everything-dump in principle, but some storages are written only under conditions the file
   * never states, so a storage MISSING from a dump means "this dump does not say", not "empty".
   */
  storagesCovered?: InventoryStorage[]
}

/** Floor an instant to whole seconds — the resolution EQ log timestamps actually have. */
export function floorToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000
}

/**
 * Resolve a dump's generation instant: the log's own receipt when we have one for this file,
 * the file's mtime otherwise.
 *
 * `path` is the full path of the dump we read; the log prints only a BASE NAME (EQ writes dumps
 * into the install root), so the join compares base names, case-insensitively — Windows paths
 * are case-insensitive and a player who typed a name in a different case wrote the same file.
 *
 * Returns null only when neither source can answer, which today means an unparseable mtime.
 */
export function resolveInventoryBaseline(
  path: string,
  mtimeIso: string,
  writtenAt: (file: string) => number | null
): InventoryBaseline | null {
  const fromLog = writtenAt(baseName(path))
  if (fromLog !== null) return { ts: floorToSecond(fromLog), source: 'log' }
  const mtime = Date.parse(mtimeIso)
  if (Number.isNaN(mtime)) return null
  return { ts: floorToSecond(mtime), source: 'mtime' }
}

/** The last path segment, for either separator. Dumps live in the install root, so this is the
 *  name the log printed. */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Did this event happen AFTER the baseline, i.e. does it accumulate on top of the dump?
 *
 * STRICTLY later, by the second (see the header). `baselineTs` undefined means no baseline is
 * known — a store written before JOS-128, or a dump whose mtime would not parse — and then
 * nothing accumulates, because "since when" has no answer and inventing one would be a guess.
 */
export function isSinceBaseline(ts: number, baselineTs: number | undefined): boolean {
  return baselineTs !== undefined && floorToSecond(ts) > baselineTs
}

// ----- WHAT the baseline covers (the other half of "reset the model") -----
//
// A baseline is an instant AND a scope. The JOS-132 spike found that the inventory dump is an
// everything-dump only in principle: some storages are written only when the game happens to
// have them loaded (the depot when it has been opened, the hoard when its window is), and the
// file says nothing about the difference. So a storage absent from a dump is UNKNOWN, not
// empty, and a viewer that renders absence as "you have none there" is inventing an answer.
//
// EVIDENCE IS THE ROW, NOT THE ITEM. A bank slot holding `Empty` still proves the bank was
// dumped; an item is not required and would be the wrong test (an empty bank is a real state
// this rule must be able to report). MEASURED against the owner's real dump (2026-08-09): it
// evidences equip, general, bank, sharedBank and keyRing, and carries NOT ONE
// `Personal-Depot<n>` row even though the parser has known that pattern since JOS-44 — which
// is the spike's claim, reproduced.
//
// UNCLASSIFIED BASE TOKENS ARE NOT COVERAGE. A storage whose token this build has never seen
// (the hoard is the open question) parses as `place.kind === 'unknown'`, and claiming coverage
// for a storage we cannot name would be worse than saying nothing. The awaiting-sample law
// applies: when a real dump shows the token, it graduates into `ContainerKind` and lands here
// through the total map below, with no change to this rule.

/** Container kind → the persisted storage name. TOTAL on purpose: a new `ContainerKind` is a
 *  compile error until `InventoryStorage` (shared/types.ts) grows to match. */
const CONTAINER_STORAGE: Record<ContainerKind, InventoryStorage> = {
  general: 'general',
  bank: 'bank',
  sharedBank: 'sharedBank',
  personalDepot: 'personalDepot'
}

/** Which storages this dump actually evidenced, in a stable order. */
export function storagesCoveredBy(dump: InventoryDump): InventoryStorage[] {
  const seen = new Set<InventoryStorage>()
  const walk = (rows: InventoryDump['items']): void => {
    for (const row of rows) {
      if (row.place.kind === 'equip') seen.add('equip')
      else if (row.place.kind === 'container') seen.add(CONTAINER_STORAGE[row.place.container])
      walk(row.children)
    }
  }
  walk(dump.items)
  // A KeyRing SECTION is the evidence, not a keyring row: the header proves the game wrote that
  // table, and an empty keyring is a real state.
  if (dump.sections.includes('KeyRing') || dump.keyRing.length > 0) seen.add('keyRing')
  return STORAGE_ORDER.filter((s) => seen.has(s))
}

/** Reading order: what you are wearing, what you are carrying, then what you have stored. */
const STORAGE_ORDER: readonly InventoryStorage[] = [
  'equip',
  'general',
  'bank',
  'sharedBank',
  'personalDepot',
  'keyRing'
]
