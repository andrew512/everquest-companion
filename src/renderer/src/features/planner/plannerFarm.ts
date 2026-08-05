// planner/plannerFarm.ts — the set, turned into a route: what is still missing, and where it is.
//
// This is the arithmetic behind Farm mode (design §5.4), kept out of the view so the interesting
// part is one pure function over plain data.
//
// WHY A DONOR IS LISTED UNDER ONE ZONE AND NOT ALL OF THEM. Roughly a third of donors drop in
// several zones, and listing each under every zone turns a route into a concordance: eight
// headings, the same four items under each, no idea where to actually go. So every donor is
// assigned to ONE primary zone — the zone that holds the most of THIS SET'S other needs — and
// keeps an "also" note naming the rest. The rollup then reads the way the feature was asked for:
// "go to Lower Guk, it feeds four sockets."
//
// Ties break ALPHABETICALLY, not by catalog order. Two zones that feed the same number of needs
// are equally good answers, and a stable, statable rule beats "whichever the scrape listed first"
// — a rescrape must never silently re-route the list.
//
// THE FOUR NON-ZONE HEADINGS ARE HONEST STATES, NOT LEFTOVERS. A quest reward and a crafted item
// have no camp; a mob whose page states no home zone is a real camp with an unstated address; a
// donor with no source at all is a fact about our knowledge, not about the game. Each says which
// one it is rather than being dropped into a zone we invented.

import type { EquipSlot, ExaltPlan, ExtractTier, SocketType } from '@shared/planner/types'
import { extractionCost, extractionTier } from '@shared/planner/rules'
import { mergeItemSources } from '../../lib/itemSources'
import type { DonorRow } from './plannerData'
import { donorFor } from './plannerData'
import { sourcesFor, type PlannerSource } from './sourceIndex'
import type { DonorProgress } from './plannerProgress'

/** One planned socket, resolved against the corpus, the catalog and your own progress. */
export interface FarmNeed {
  slot: EquipSlot
  socket: SocketType
  effect: string
  donorKey: string
  /** the donor's display name — the corpus's when it has the row, else the key itself */
  donorName: string
  /** null when the corpus carries no row for this (key, effect) pair */
  donor: DonorRow | null
  /** the merge tier the effect extracts at — known from the SOCKET even without a donor row */
  tierRequired: ExtractTier
  /** every mob EITHER witness names — the mob catalog first, then page-only mobs (`mergedSources`) */
  sources: readonly PlannerSource[]
  /** distinct zones across every source, catalog order first */
  zones: string[]
  progress: DonorProgress
}

export type FarmGroupKind = 'zone' | 'quest' | 'crafted' | 'unstated' | 'unknown'

export interface FarmRow extends FarmNeed {
  /** the donor's OTHER zones — the "also: …" note */
  also: string[]
}

export interface FarmGroup {
  /** the zone name, or the heading for one of the four non-zone kinds */
  title: string
  kind: FarmGroupKind
  rows: FarmRow[]
}

const HEADINGS: Record<Exclude<FarmGroupKind, 'zone'>, string> = {
  quest: 'Quests',
  crafted: 'Crafted',
  unstated: 'Zone unstated',
  unknown: 'No known source'
}

/** Non-zone groups always follow the zones, in this order. */
const TAIL: Exclude<FarmGroupKind, 'zone'>[] = ['quest', 'crafted', 'unstated', 'unknown']

/**
 * BOTH WITNESSES TO "WHO DROPS THIS", AS ONE CAMP LIST — `lib/itemSources.mergeItemSources`.
 *
 * The rule (catalog row wins whole on a case-folded mob match; a page-only mob contributes a bare
 * name) lives in lib/ because the Loot tab's drill-down needs the identical fold for the identical
 * reason. Its header states why. This rollup only decides what to DO with the merged list.
 */

/**
 * Every planned socket of a set, resolved. Includes the ones already satisfied — the caller
 * decides what "still needed" means (Farm mode drops `ready`, so a finished set empties out).
 */
export function collectNeeds(
  plan: ExaltPlan,
  index: ReadonlyMap<string, DonorRow[]>,
  progressOf: (donorKey: string, tierRequired: ExtractTier) => DonorProgress
): FarmNeed[] {
  const needs: FarmNeed[] = []
  for (const [slotName, planSlot] of Object.entries(plan.slots)) {
    if (!planSlot) continue
    for (const [socketName, planned] of Object.entries(planSlot.sockets)) {
      if (!planned) continue
      const socket = socketName as SocketType
      const donor = donorFor(index, planned.donorKey, planned.effect)
      const tierRequired = donor?.tierRequired ?? extractionTier(socket)
      const sources = mergeItemSources(sourcesFor(planned.donorKey), donor?.wikiSources)
      needs.push({
        slot: slotName as EquipSlot,
        socket,
        effect: planned.effect,
        donorKey: planned.donorKey,
        donorName: donor?.name ?? planned.donorKey,
        donor,
        tierRequired,
        sources,
        zones: [...new Set(sources.flatMap((s) => s.zones))],
        progress: progressOf(planned.donorKey, tierRequired)
      })
    }
  }
  return needs
}

/** Which non-zone heading a zoneless need belongs under. Quest wins over crafted when both. */
function tailKind(need: FarmNeed): Exclude<FarmGroupKind, 'zone'> {
  if (need.sources.length > 0) return 'unstated'
  if (need.donor?.quest === true) return 'quest'
  if (need.donor?.playerCrafted === true) return 'crafted'
  return 'unknown'
}

/** zone → how many of these needs it could supply (a multi-zone donor votes for each of its zones). */
function zoneWeights(needs: readonly FarmNeed[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const need of needs) {
    for (const zone of need.zones) counts.set(zone, (counts.get(zone) ?? 0) + 1)
  }
  return counts
}

/** The zone that feeds the most of the set's other needs; ties alphabetical (see the header). */
function primaryZone(zones: readonly string[], weights: ReadonlyMap<string, number>): string {
  let best = zones[0]
  for (const zone of zones) {
    const better = (weights.get(zone) ?? 0) - (weights.get(best) ?? 0)
    if (better > 0 || (better === 0 && zone < best)) best = zone
  }
  return best
}

/**
 * Needs → the rollup: zone groups first (most needed donors first, ties alphabetical), then the
 * four honest non-zone headings. Every need appears EXACTLY ONCE.
 */
export function groupNeeds(needs: readonly FarmNeed[]): FarmGroup[] {
  const weights = zoneWeights(needs)
  const zones = new Map<string, FarmRow[]>()
  const tails = new Map<FarmGroupKind, FarmRow[]>()

  for (const need of needs) {
    if (need.zones.length === 0) {
      const kind = tailKind(need)
      const list = tails.get(kind)
      const row: FarmRow = { ...need, also: [] }
      if (list) list.push(row)
      else tails.set(kind, [row])
      continue
    }
    const primary = primaryZone(need.zones, weights)
    const row: FarmRow = { ...need, also: need.zones.filter((z) => z !== primary) }
    const list = zones.get(primary)
    if (list) list.push(row)
    else zones.set(primary, [row])
  }

  const zoneGroups: FarmGroup[] = [...zones.entries()]
    .map(([title, rows]) => ({ title, kind: 'zone' as const, rows }))
    .sort((a, b) => b.rows.length - a.rows.length || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))

  const tailGroups: FarmGroup[] = TAIL.filter((kind) => tails.has(kind)).map((kind) => ({
    title: HEADINGS[kind],
    kind,
    rows: tails.get(kind) ?? []
  }))

  return [...zoneGroups, ...tailGroups]
}

/**
 * "needs +4 — ≈15 D0 merges or 1 D4 drop" — the merge cost, read straight out of
 * `extractionCost`'s fields. The arithmetic (2^t − 1, the ×16 D4 multiplier, the pre-plussed
 * drop) lives in shared/planner/rules.ts and is never restated here.
 */
export function costText(tierRequired: ExtractTier): string {
  const cost = extractionCost(tierRequired)
  const drops = cost.d4Copies === 1 ? '1 D4 drop' : `${String(cost.d4Copies)} D4 drops`
  return `needs +${String(cost.tier)} — ≈${String(cost.d0Copies)} D0 merges or ${drops}`
}

/**
 * The camp line for one row: the first mob EITHER witness names for this donor, with its level
 * text VERBATIM (a range as often as a number) when the catalog knew it — a mob only the item page
 * names renders as a bare name, which is exactly what the page stated. Empty when nobody is named.
 */
export function campText(row: FarmNeed): string {
  const first = row.sources[0]
  if (!first) return ''
  const extra = row.sources.length > 1 ? ` +${String(row.sources.length - 1)} more` : ''
  return first.levelText == null ? `${first.mob}${extra}` : `${first.mob} (lvl ${first.levelText})${extra}`
}
