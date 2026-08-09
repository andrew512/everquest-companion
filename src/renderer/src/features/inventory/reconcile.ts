import type { CountSource, PoskyQuest } from '@shared/types'
import { itemCountKey } from '../../lib/itemName'
import { questKey } from '../posky/keys'

export interface InventoryRow {
  key: string
  name: string
  /** times looted (from the log) */
  log: number
  /** count in the inventory export */
  inv: number
  /** base held per the active count source */
  base: number
  /** consumed by turned-in quests */
  consumed: number
  /** net available after turn-ins */
  net: number
  /** names of completed quests that consumed this item */
  consumedBy: string[]
}

export interface ReconcileInput {
  /** loot counts keyed by lowercased item name */
  log: Record<string, number>
  /** inventory-export counts keyed by lowercased item name */
  inv: Record<string, number>
  /**
   * Loot counts for everything looted AFTER the export was generated (JOS-128) — the same
   * fold as `log`, narrowed by the dump's baseline instant. UNDEFINED means no baseline is
   * known: either no dump has ever been loaded, or the store predates JOS-128 and has not
   * been reloaded since. Its presence is what switches the dump-reading sources onto
   * baseline-then-accumulate; absent, they behave exactly as they did before.
   */
  logSince?: Record<string, number>
  /** display names keyed by lowercased item name (from loot events) */
  lootNames: Record<string, string>
  countSource: CountSource
  completedKeys: string[]
  quests: PoskyQuest[]
}

export interface ReconcileResult {
  rows: InventoryRow[]
  /** net held counts (base minus turn-in consumption), keyed lowercased */
  net: Record<string, number>
}

/**
 * Re-key the inventory-export counts onto the normalized counting key so a
 * `Sphinx Claw +1` in the export pools with a base `Sphinx Claw` (Task #42). The
 * `log` map arrives already normalized (useProgress.logCounts), but the raw
 * inventory export names do not, so fold them here (summing collisions).
 *
 * `nameByKey` is filled in place — display names are claimed first-writer-wins, and
 * the call order in `reconcile` (loot names, then export names, then quest item
 * names) is what decides which spelling the user sees.
 */
function foldInventoryByKey(
  inv: Record<string, number>,
  nameByKey: Record<string, string>
): Record<string, number> {
  const invByKey: Record<string, number> = {}
  for (const [rawK, n] of Object.entries(inv)) {
    const k = itemCountKey(rawK)
    invByKey[k] = (invByKey[k] ?? 0) + n
    nameByKey[k] ??= rawK
  }
  return invByKey
}

/**
 * Base held count per key, per the active count source.
 *
 * THE DUMP IS A BASELINE (JOS-128, owner design). A loaded export RESETS what we think you
 * hold; log-derived loot then accumulates on top of it from the instant it was generated. So
 * the two dump-reading sources answer `export + looted since export`, and the deleted item a
 * 0.14.0 user reported is gone the moment they reload, because the dump no longer lists it and
 * nothing since re-added it.
 *
 * What each source means, and why 'both' changed:
 *   'log'       all-time looted, never consults the dump. Unchanged. It CANNOT see a deletion;
 *               that is what "ever looted" means, not a defect to paper over here.
 *   'inventory' the dump, plus loot since the dump.
 *   'both'      the same, when a dump is loaded; the all-time log when none is. It used to be
 *               `max(log, dump)` per item, and that maximum was precisely the never-resets
 *               behavior: the all-time log count outvoted the dump that no longer listed the
 *               item, so no reload could ever lower it. With accumulation there is nothing
 *               left for a maximum to rescue — a dump that lists the item plus everything
 *               looted since IS the higher, truer number.
 *
 * `logSince` undefined means no baseline is known, and then both dump-reading sources fall
 * back to their pre-JOS-128 behavior rather than guessing a start instant.
 */
function baseCounts(
  log: Record<string, number>,
  invByKey: Record<string, number>,
  countSource: CountSource,
  logSince?: Record<string, number>
): Record<string, number> {
  const base: Record<string, number> = {}
  for (const k of new Set([...Object.keys(log), ...Object.keys(invByKey), ...Object.keys(logSince ?? {})])) {
    const l = log[k] ?? 0
    const i = invByKey[k] ?? 0
    if (countSource === 'log') {
      base[k] = l
    } else if (logSince === undefined) {
      base[k] = countSource === 'inventory' ? i : Math.max(l, i)
    } else {
      base[k] = i + (logSince[k] ?? 0)
    }
  }
  return base
}

/** What the turned-in quests ate: counts per item key, plus the quest names that ate it. */
function questConsumption(
  quests: PoskyQuest[],
  completed: Set<string>,
  nameByKey: Record<string, string>
): { consumed: Record<string, number>; consumedBy: Record<string, string[]> } {
  const consumed: Record<string, number> = {}
  const consumedBy: Record<string, string[]> = {}
  for (const q of quests) {
    if (!completed.has(questKey(q))) continue
    for (const it of q.items) {
      const k = itemCountKey(it.name)
      const need = it.count > 0 ? it.count : 1
      consumed[k] = (consumed[k] ?? 0) + need
      ;(consumedBy[k] ??= []).push(q.name)
      nameByKey[k] ??= it.name
    }
  }
  return { consumed, consumedBy }
}

/**
 * Reconcile held items from the loot log and the inventory export, then subtract
 * everything consumed by quests the user has marked as turned in — so a drop that
 * was handed in for one quest no longer counts toward another quest that needs it.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { log, inv, logSince, lootNames, countSource, completedKeys, quests } = input
  const completed = new Set(completedKeys)

  const nameByKey: Record<string, string> = { ...lootNames }
  const invByKey = foldInventoryByKey(inv, nameByKey)
  const base = baseCounts(log, invByKey, countSource, logSince)
  const { consumed, consumedBy } = questConsumption(quests, completed, nameByKey)

  const net: Record<string, number> = {}
  const allKeys = new Set([...Object.keys(base), ...Object.keys(consumed)])
  const rows: InventoryRow[] = []
  for (const k of allKeys) {
    const b = base[k] ?? 0
    const c = consumed[k] ?? 0
    const n = Math.max(0, b - c)
    net[k] = n
    if (b === 0 && c === 0) continue
    rows.push({
      key: k,
      name: nameByKey[k] ?? k,
      log: log[k] ?? 0,
      inv: invByKey[k] ?? 0,
      base: b,
      consumed: c,
      net: n,
      consumedBy: consumedBy[k] ?? []
    })
  }
  rows.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name))
  return { rows, net }
}
