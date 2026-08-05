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

import { useCallback, useEffect, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import type { EquipSlot, PlannerDonor, SocketType } from '@shared/planner/types'
import { CURRENT_ERA, eraRank, eraVerdict, zoneEra, type Era, type EraVerdict } from '@shared/planner/era'
import { sourcesFor } from './sourceIndex'

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

/** One fetch per window — the corpus is compiled-in bytes, so a second call cannot differ. */
async function fetchDonors(): Promise<DonorRow[]> {
  const rows = await window.eq.plannerDonors()
  CACHE = rows.map(toRow)
  return CACHE
}

export interface DonorsState {
  donors: DonorRow[]
  /** false until the first fetch settles */
  ready: boolean
}

export function useDonors(): DonorsState {
  const [donors, setDonors] = useState<DonorRow[]>(() => CACHE ?? [])
  const [ready, setReady] = useState(CACHE !== null)

  useEffect(() => {
    if (CACHE !== null) return
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
  }, [])

  return { donors, ready }
}

/**
 * `donorKey → every row that key carries`. An item with a proc AND a click is TWO rows under one
 * key, so the planned effect picks the row — Board and Farm both resolve a `PlanSocket` this way.
 */
export function indexDonors(rows: readonly DonorRow[]): Map<string, DonorRow[]> {
  const index = new Map<string, DonorRow[]>()
  for (const row of rows) {
    const list = index.get(row.key)
    if (list) list.push(row)
    else index.set(row.key, [row])
  }
  return index
}

/** The row a planned socket refers to, or null when the corpus does not carry that pair. */
export function donorFor(
  index: ReadonlyMap<string, DonorRow[]>,
  donorKey: string,
  effect: string
): DonorRow | null {
  return index.get(donorKey)?.find((d) => d.effect === effect) ?? null
}

// ---- era scoping --------------------------------------------------------------------

/**
 * WHERE THIS DONOR LIVES, IN EXPANSION TERMS (shared/planner/era.ts owns the zone→era table).
 *
 * The committed corpus is scraped from a wiki that documents every expansion, so more than half
 * of the proc donors drop in Kunark or Velious zones that this server has not opened. Planning
 * around them is not planning — it is a shopping list for a game that isn't running yet.
 *
 * The verdict is derived from the donor's DROP zones. A donor with no drop source at all (a quest
 * reward, a crafted item) gets `[]`, which is `unknown` — the row stays visible and says so,
 * because "we don't know where this comes from" must never be dressed up as "it's out of era".
 */
export interface DonorEra {
  verdict: EraVerdict
  /** the LATEST era among its source zones — what the chip names; null when nothing states one */
  era: Era | null
}

// Release order comes from era.ts (`eraRank`) — the planner never re-states which expansion came
// first. Only the DISPLAY spelling lives here.
const ERA_LABEL: Record<Era, string> = { classic: 'Classic', kunark: 'Kunark', velious: 'Velious' }

/** The era the app is currently scoped to, spelled for a tooltip. */
export const CURRENT_ERA_LABEL = ERA_LABEL[CURRENT_ERA]

// Keyed by donor KEY (the verdict depends only on where the item drops), built on demand and kept
// for the window's life: the zone lists it reads are immutable committed data.
const ERA_CACHE = new Map<string, DonorEra>()

export function donorEra(key: string): DonorEra {
  const hit = ERA_CACHE.get(key)
  if (hit) return hit
  const zones = [...new Set(sourcesFor(key).flatMap((s) => s.zones))]
  let era: Era | null = null
  for (const zone of zones) {
    const z = zoneEra(zone)
    if (z !== null && (era === null || eraRank(z) > eraRank(era))) era = z
  }
  const value: DonorEra = { verdict: eraVerdict(zones), era }
  ERA_CACHE.set(key, value)
  return value
}

/**
 * The one chip the era join draws, or null when there is nothing to say.
 *   out-of-era → the expansion's name ("Velious") — shown only while the filter is OFF
 *   unknown    → `era?` — no source zone states an era, and we will not guess one
 */
export function eraChipLabel(key: string): string | null {
  const { verdict, era } = donorEra(key)
  if (verdict === 'unknown') return 'era?'
  if (verdict === 'out-of-era') return era === null ? 'out of era' : ERA_LABEL[era]
  return null
}

/** Does the current-era filter hide this donor? Only a POSITIVE out-of-era verdict ever does. */
export function eraHides(key: string, eraOnly: boolean): boolean {
  return eraOnly && donorEra(key).verdict === 'out-of-era'
}

const ERA_KEY = 'eq.planner.era'

/**
 * The "Current era" toggle, DEFAULT ON, persisted machine-side like every other planner UI pref.
 * Effects and Farm each read it on mount; they are never on screen at the same time, so one
 * localStorage-backed value is the whole synchronisation story.
 */
export function useEraOnly(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(ERA_KEY) !== '0')
  const set = useCallback((v: boolean) => {
    localStorage.setItem(ERA_KEY, v ? '1' : '0')
    setOn(v)
  }, [])
  return [on, set]
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
  planClasses: readonly ClassAbbr[],
  eraOnly = false
): DonorRow[] {
  const needle = filters.text.trim().toLowerCase()
  return rows.filter((d) => {
    if (d.socket !== filters.socket) return false
    if (filters.slot !== null && !d.slots.includes(filters.slot)) return false
    if (filters.trioOnly && classFit(d, planClasses) === 'no') return false
    if (eraHides(d.key, eraOnly)) return false
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
