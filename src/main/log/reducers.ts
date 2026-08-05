// The pure reducer core for the log-derived kill tracker. Historically this file
// held a monolithic reduceEvent() that folded every feature (loot/turnins/kills/
// levels/AA) into one LogStore. That fold now lives per-feature in the extension
// modules (src/main/modules/*), which each own their slice and expose it over the
// generic module transport. What remains here is the shared, unit-testable kill
// logic the kills module reuses — so the "counts as a kill" filter has exactly
// one definition. Keep this pure and side-effect-free.

import type { LogEvent } from '../../shared/logEvents'
import { killTotals, type KillMap } from '../../shared/kills'

/**
 * Whether a `death` event counts as a kill for the kills tracker. Self-slain
 * always counts; slain-by counts only when the killer isn't you. (Same filter the
 * legacy reduceEvent used.)
 */
export function isCountedKill(ev: Extract<LogEvent, { kind: 'death' }>): boolean {
  if (!ev.bySelf && ev.killer && /^you\b/i.test(ev.killer)) return false
  return true
}

/** One counted kill, as `recordKill` folds it. */
export interface KillRecord {
  /** the CANONICAL (lowercase) mob name — the map key. */
  key: string
  /** the raw slain-line name, kept for the UI. */
  display: string
  tier: number
  ts: number
}

/**
 * Fold a counted kill into a KillMap in place. Pure; used by the kills module.
 * Keying by the canonical name folds the two casings EQ emits (sentence-start
 * "A froglok…" vs mid-sentence "a froglok…") into a single entry; the display is
 * set once, from the first-seen kill.
 *
 * THE FOLD WRITES ONE THING: the per-tier run (`tiers[tier]`). The four scalars are then
 * re-derived from the whole map by `killTotals`, never incremented alongside it — that is
 * what keeps "bestTier" and "lastTs" from describing two different kills, which is exactly
 * the misattribution this shape replaced (see shared/kills.ts).
 */
export function recordKill(kills: KillMap, kill: KillRecord): void {
  const { key, display, tier, ts } = kill
  const k = (kills[key] ??= { count: 0, bestTier: 0, firstTs: 0, lastTs: 0, display, tiers: {} })
  const run = (k.tiers[tier] ??= { count: 0, firstTs: ts, lastTs: ts })
  run.count += 1
  run.firstTs = Math.min(run.firstTs, ts)
  run.lastTs = Math.max(run.lastTs, ts)
  Object.assign(k, killTotals(k.tiers))
}
