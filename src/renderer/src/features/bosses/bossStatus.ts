// Pure boss-status derivation shared by BossView (cards + confetti) and App (the
// app-wide "raid target defeated" snackbar), so both agree on exactly what counts
// as a defeat and when a NEW defeat happened.

import type { KillMap, KillTierRun, RaidTarget } from '@shared/types'
// RELATIVE value import: this module is unit-tested under node/tsx, which has no `@shared`
// alias (the mobSearch.ts precedent — AGENTS.md, Toolchain gotchas).
import { addTierRun, killTotals } from '../../../../shared/kills'

export interface TargetStatus {
  target: RaidTarget
  killed: boolean
  /** highest tier across `tiers` — for a per-tier row this IS that row's tier. */
  bestTier: number
  count: number
  firstTs: number
  lastTs: number
  /**
   * The per-instance-tier breakdown of this target's kills, folded across every one of its
   * roster `match` names. A card grouped by class loadout is built from ONE of these runs, so
   * the tier it badges and the timestamp it joins on come from the same kills (shared/kills.ts).
   */
  tiers: Record<number, KillTierRun>
}

/**
 * Canonical match key: lowercase + strip a single leading article. EQ writes the
 * same mob with a capitalized article at sentence start ("A thunder spirit
 * princess" on slain-by lines) and lowercase mid-sentence, and roster `match`
 * names ("Thunder Spirit Princess") carry no article at all — so both sides must
 * be article-insensitive or the princess (killed by a charmed pet, hence a
 * slain-by line) reads as undefeated.
 */
function matchKey(name: string): string {
  return name.toLowerCase().replace(/^(?:an?|the) /, '').trim()
}

/**
 * Re-key a KillMap by the article-insensitive match key. Kill-map keys are already
 * canonical lowercase (kills module keys via idKey), so this only strips leading
 * articles; if two article variants ever collide, the higher-count entry wins.
 */
export function lowerKillMap(kills: KillMap): KillMap {
  const m: KillMap = {}
  for (const [name, info] of Object.entries(kills)) {
    const k = matchKey(name)
    const prev = m[k]
    if (!prev || info.count > prev.count) m[k] = info
  }
  return m
}

/** Fold a target's roster `match` names against the (article-insensitive) kill map. */
export function statusFor(target: RaidTarget, killByLower: KillMap): TargetStatus {
  const tiers: Record<number, KillTierRun> = {}
  let killed = false
  for (const name of target.match) {
    const info = killByLower[matchKey(name)]
    if (!info) continue
    killed = true
    for (const [tier, run] of Object.entries(info.tiers)) addTierRun(tiers, Number(tier), run)
  }
  // The scalars are a fold of `tiers`, exactly as KillInfo's are — one source, no drift.
  return { target, killed, ...killTotals(tiers), tiers }
}

/**
 * The same target seen through ONE of its tier runs: the card a loadout section draws. Every
 * scalar is re-derived from the given runs, so the badge, the dates and the count all describe
 * the same kills — which is the whole point of the per-tier record. A target with a single
 * tier projects to a status identical to its unprojected self (pinned in tests).
 */
export function projectStatus(s: TargetStatus, tiers: Record<number, KillTierRun>): TargetStatus {
  return { target: s.target, killed: true, ...killTotals(tiers), tiers }
}

export function allStatuses(targets: RaidTarget[], kills: KillMap): TargetStatus[] {
  const lower = lowerKillMap(kills)
  return targets.map((t) => statusFor(t, lower))
}

/**
 * ANY roster-boss kill (Task #24): a target whose total kill `count` increased
 * since the previous snapshot — including a REPEAT kill at the same-or-lower tier
 * (which `newDefeats` deliberately ignores). Drives confetti + card flash +
 * snackbar for every kill. Compares a previous status snapshot (keyed by target
 * name) to the current one; returns the targets that were just killed again.
 */
export function bossKills(
  prev: Map<string, TargetStatus>,
  next: TargetStatus[]
): TargetStatus[] {
  const out: TargetStatus[] = []
  for (const s of next) {
    if (!s.killed) continue
    const before = prev.get(s.target.name)
    const prevCount = before?.count ?? 0
    if (s.count > prevCount) out.push(s)
  }
  return out
}

/**
 * A NEW defeat = a boss that just went from unkilled → killed (prev count 0), or
 * whose best instance tier increased. Compares a previous status snapshot (keyed
 * by target name) to the current one; returns the targets that newly qualify.
 * This is the subset of `bossKills` that additionally earns the bossDefeat sound —
 * a first defeat at a new tier only, so repeat kills stay silent (Task #24).
 */
export function newDefeats(
  prev: Map<string, TargetStatus>,
  next: TargetStatus[]
): TargetStatus[] {
  const out: TargetStatus[] = []
  for (const s of next) {
    if (!s.killed) continue
    const before = prev.get(s.target.name)
    const wasKilled = before?.killed ?? false
    const prevTier = before?.bestTier ?? 0
    if (!wasKilled || s.bestTier > prevTier) out.push(s)
  }
  return out
}
