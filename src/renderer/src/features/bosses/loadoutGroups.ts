// The PURE half of the roster's "by class loadout" sectioning: which cards go under which
// combo interval. Split out of BossSections.tsx so the join is unit-testable without a DOM —
// it is the layer the Lord of Ire misattribution actually lived in.
//
// THE RULE, stated once. A card is a TIER RUN, not a target: one target's kills at one
// instance tier, which carry their own first/last timestamps (shared/kills.ts). Each run joins
// the combo intervals at ITS OWN most recent kill and is badged with ITS OWN tier, so a
// section header ("you were running these classes") is true of every card beneath it. The old
// rule joined at the target's overall `lastTs` while painting its overall `bestTier`, so a mob
// killed at d4 in one loadout and d0 in a later one showed a d4 badge under the later loadout.
//
// Two runs of the same target that land in the SAME interval merge back into one card: the
// header's claim holds for both, and one target must not appear twice under one header.
// A single-tier target therefore produces exactly the card it produced before this change.
//
// The interval layer itself is untouched and stays revisable — nothing here stamps an interval
// id onto a kill (world-model law 10); the join happens at read, every time.

import { groupByCombo } from '../../../../shared/comboIndex'
import { addTierRun, tierRuns } from '../../../../shared/kills'
import type { ComboInterval } from '../../../../shared/classCombo'
import type { KillTierRun } from '../../../../shared/kills'
import { projectStatus, type TargetStatus } from './bossStatus'

/** One card: what it draws (a tier run of the target) and the whole target behind it. */
export interface LoadoutCard {
  /** the target projected onto this card's tier run(s) — badge, dates and count all agree */
  s: TargetStatus
  /** the target's COMPLETE kill record, for the mob page a click opens */
  whole: TargetStatus
}

/** One loadout section: the interval covering its cards (null = none does) and the cards. */
export interface LoadoutGrouping {
  key: string
  interval: ComboInterval | null
  rows: LoadoutCard[]
}

/** A tier run awaiting its join: the run's own last kill is the timestamp it joins on. */
interface RunRow {
  ts: number
  status: TargetStatus
  tier: number
  run: KillTierRun
}

function runRows(list: readonly TargetStatus[]): RunRow[] {
  const rows: RunRow[] = []
  for (const status of list) {
    if (!status.killed) continue
    for (const run of tierRuns(status.tiers)) {
      if (run.lastTs <= 0) continue
      rows.push({ ts: run.lastTs, status, tier: run.tier, run: { count: run.count, firstTs: run.firstTs, lastTs: run.lastTs } })
    }
  }
  return rows
}

/** Merge the runs that landed in one interval back into one card per target. */
function cardsFor(rows: readonly RunRow[]): LoadoutCard[] {
  const byTarget = new Map<string, { whole: TargetStatus; tiers: Record<number, KillTierRun> }>()
  for (const row of rows) {
    let entry = byTarget.get(row.status.target.name)
    if (!entry) {
      entry = { whole: row.status, tiers: {} }
      byTarget.set(row.status.target.name, entry)
    }
    addTierRun(entry.tiers, row.tier, row.run)
  }
  return [...byTarget.values()].map((e) => ({ s: projectStatus(e.whole, e.tiers), whole: e.whole }))
}

/**
 * Defeated targets, split into tier runs and time-joined to the combo intervals. Undefeated
 * targets carry no timestamp to join on and are not returned here — the view keeps them in
 * their own trailing section rather than dropping or attributing them.
 */
export function loadoutGroups(
  intervals: readonly ComboInterval[],
  list: readonly TargetStatus[]
): LoadoutGrouping[] {
  return groupByCombo(intervals, runRows(list)).map((g) => ({
    key: g.interval?.id ?? 'unknown',
    interval: g.interval,
    rows: cardsFor(g.rows)
  }))
}
