// planner/plannerData.ts — the donor corpus in the renderer: fetched once, filtered, folded.
//
// WHY A MODULE-SCOPE CACHE. `items.json` is 7.14 MB and stays in MAIN (design D1); the
// effect-bearing subset arrives over ONE IPC call as a few hundred KB of `PlannerDonor` rows.
// That call is made at most once per window: the corpus is committed data, it cannot change while
// the app runs, and re-fetching it every time the tab is opened would be hundreds of KB of
// structured-clone for an identical answer. The promise is cached too, so two mounts in the same
// frame share one round trip.
//
// FILTERING IS PURE AND RENDER-BOUND. ~1.6k rows, a linear scan, sub-millisecond — the standing
// search law (AGENTS.md "UI conventions"): the input echoes instantly, the FILTER runs on a
// deferred value (EffectBrowser owns the `useDeferredValue`), and the lowercase `searchKey` is
// computed ONCE per data change here rather than per keystroke per row.

import { useEffect, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import type { EquipSlot, PlannerDonor, SocketType } from '@shared/planner/types'
import { plannerBridge } from './usePlans'

/** A donor row with its search haystack precomputed. `searchKey` is never displayed. */
export interface DonorRow extends PlannerDonor {
  searchKey: string
}

/** One effect and every donor that carries it — the unit the browser lists. */
export interface EffectGroup {
  effect: string
  socket: SocketType
  /** R3: the effect itself is haste, so NO donor of it can travel. Flagged, never hidden. */
  hasteLocked: boolean
  donors: DonorRow[]
}

/** Whether a donor can be used by the set's target classes. `unknown` is not a pass and not a
 *  fail — the page simply did not state a class list, and the row says so (law 1). */
export type ClassFit = 'fits' | 'unknown' | 'no'

export interface DonorFilters {
  socket: SocketType
  /** raw search text — the caller passes the DEFERRED value */
  text: string
  /** `null` = every slot */
  slot: EquipSlot | null
  /** "usable by the trio", ON by default */
  trioOnly: boolean
}

export const DEFAULT_FILTERS: DonorFilters = {
  // Proc leads: it is the effect players plan around, and the one whose +4 extraction cost makes
  // the farm rollup worth having.
  socket: 'proc',
  text: '',
  slot: null,
  trioOnly: true
}

// ---- the fetch ----------------------------------------------------------------------

function toRow(d: PlannerDonor): DonorRow {
  return { ...d, searchKey: `${d.name} ${d.effect} ${d.detail ?? ''}`.toLowerCase() }
}

let CACHE: DonorRow[] | null = null
let INFLIGHT: Promise<DonorRow[]> | null = null

/** One fetch per window. An absent bridge method resolves to `[]` — see the shim note in usePlans. */
async function fetchDonors(): Promise<DonorRow[]> {
  const rows = (await plannerBridge().plannerDonors?.()) ?? []
  CACHE = rows.map(toRow)
  return CACHE
}

export interface DonorsState {
  donors: DonorRow[]
  /** false until the first fetch settles */
  ready: boolean
  /** the preload has no `plannerDonors` yet (wave 2B) — the browser says so rather than
   *  rendering an empty list that looks like "the game has no procs" */
  unavailable: boolean
}

export function useDonors(): DonorsState {
  const [donors, setDonors] = useState<DonorRow[]>(() => CACHE ?? [])
  const [ready, setReady] = useState(CACHE !== null)
  const unavailable = plannerBridge().plannerDonors === undefined

  useEffect(() => {
    if (CACHE !== null) return
    if (unavailable) {
      setReady(true)
      return
    }
    let alive = true
    INFLIGHT ??= fetchDonors()
    void INFLIGHT.then((rows) => {
      if (!alive) return
      setDonors(rows)
      setReady(true)
    }).catch(() => {
      /* main never rejects; an empty corpus renders the honest empty state */
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [unavailable])

  return { donors, ready, unavailable }
}

// ---- the filter model ---------------------------------------------------------------

/**
 * R2's class half, as a three-valued answer. An empty `planClasses` (a set with no trio picked)
 * asks for NO class filter — it is not a claim that zero classes are wanted.
 */
export function classFit(donor: PlannerDonor, planClasses: readonly ClassAbbr[]): ClassFit {
  if (planClasses.length === 0) return 'fits'
  if (donor.classes.length === 0) return 'unknown'
  return donor.classes.some((c) => planClasses.includes(c)) ? 'fits' : 'no'
}

/**
 * The browser's filter: socket type, then slot, then trio compatibility, then the text match.
 *
 * `trioOnly` keeps UNKNOWN rows. Hiding a donor whose page never stated a class list would be the
 * planner asserting a fact the wiki declined to state; the row is shown and chipped instead.
 */
export function filterDonors(
  rows: readonly DonorRow[],
  filters: DonorFilters,
  planClasses: readonly ClassAbbr[]
): DonorRow[] {
  const needle = filters.text.trim().toLowerCase()
  return rows.filter((d) => {
    if (d.socket !== filters.socket) return false
    if (filters.slot !== null && !d.slots.includes(filters.slot)) return false
    if (filters.trioOnly && classFit(d, planClasses) === 'no') return false
    return needle === '' || d.searchKey.includes(needle)
  })
}

/**
 * Donors → effect groups.
 *
 * ORDER: donor count DESC, then effect name — the effect with the most donors is the one you can
 * realistically go and get, which is the question this pane exists to answer. Within a group the
 * donors keep the corpus order main served them in.
 */
export function groupByEffect(rows: readonly DonorRow[]): EffectGroup[] {
  const groups = new Map<string, EffectGroup>()
  for (const d of rows) {
    const g = groups.get(d.effect)
    if (g) {
      g.donors.push(d)
      g.hasteLocked = g.hasteLocked || d.hasteLocked
    } else {
      groups.set(d.effect, { effect: d.effect, socket: d.socket, hasteLocked: d.hasteLocked, donors: [d] })
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.donors.length - a.donors.length || (a.effect < b.effect ? -1 : a.effect > b.effect ? 1 : 0)
  )
}
