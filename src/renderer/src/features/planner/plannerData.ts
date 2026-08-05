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
import {
  CURRENT_ERA,
  eraFromTag,
  eraRank,
  layeredVerdict,
  zoneEra,
  type Era,
  type EraVerdict
} from '@shared/planner/era'
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

/**
 * The two PERSISTED, machine-side toggles the browser applies on top of `DonorFilters`. They live
 * apart from it because they are remembered across sessions (`eq.planner.*`) and shared with Farm
 * mode, while the filters above are this mount's own state. Passed as one object so the filter
 * keeps four parameters (the measured `max-params` ceiling).
 */
export interface DonorView {
  /** hide donors whose only known sources are outside `CURRENT_ERA`. Default ON. */
  eraOnly: boolean
  /** show donors with NO equipment slot — the R2 escape hatch. Default OFF. */
  nonEquip: boolean
}

export const DEFAULT_VIEW: DonorView = { eraOnly: true, nonEquip: false }

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
 * WHERE THIS DONOR LIVES, IN EXPANSION TERMS (shared/planner/era.ts owns both tables).
 *
 * The committed corpus is scraped from a wiki that documents every expansion, so more than half
 * of the proc donors drop in Kunark or Velious zones that this server has not opened. Planning
 * around them is not planning — it is a shopping list for a game that isn't running yet.
 *
 * THREE WITNESSES, FOLDED HERE BECAUSE THIS IS WHERE ALL THREE ARE IN HAND:
 *   1. the MOB CATALOG's zones for this key (`sourceIndex`, the renderer's own inversion of
 *      `|known_loot`), and
 *   2. the zones the ITEM PAGE named (`wikiSources`, from `|dropsfrom`) — main serves them
 *      verbatim precisely so the union happens once, here. Either one placing the donor in a
 *      reachable zone settles it.
 *   3. the page's own `{{X Era}}` banner (`eraTag`), consulted ONLY when neither zone list
 *      resolved to anything. That is what finally answers for quest rewards, crafted goods, and
 *      the donors the catalog never links.
 *
 * A donor none of the three place stays `unknown` — the row is visible and says so, because "we
 * don't know where this comes from" must never be dressed up as "it's out of era".
 */
export interface DonorEra {
  verdict: EraVerdict
  /** the era the chip names: the LATEST among its source zones, else the tag's. Null when silent. */
  era: Era | null
  /** which witness produced `era` — the chip's tooltip must not claim a zone we never saw */
  by: 'zone' | 'tag' | null
}

/**
 * What the era join needs from a donor. A LOOSE shape rather than `DonorRow` because a plan can
 * name a (key, effect) pair the corpus has no row for — Board and Farm pass `{ key }` alone then,
 * and the answer degrades to the catalog's zones, which is exactly the evidence available.
 */
export type EraSubject = Pick<PlannerDonor, 'key'> & Partial<Pick<PlannerDonor, 'wikiSources' | 'eraTag'>>

// Release order comes from era.ts (`eraRank`) — the planner never re-states which expansion came
// first. Only the DISPLAY spelling lives here.
const ERA_LABEL: Record<Era, string> = {
  classic: 'Classic',
  kunark: 'Kunark',
  velious: 'Velious',
  luclin: 'Luclin'
}

/** The era the app is currently scoped to, spelled for a tooltip. */
export const CURRENT_ERA_LABEL = ERA_LABEL[CURRENT_ERA]

// Built on demand and kept for the window's life: every input is immutable committed data. The
// identity is the EVIDENCE, not just the key — the same key reaches this function with a corpus
// row (zones + tag) or as a bare `{ key }`, and those two are entitled to different answers.
const ERA_CACHE = new Map<string, DonorEra>()

/** The LATEST expansion any of these zones claims, or null when none of them resolves. */
function latestZoneEra(zones: readonly string[]): Era | null {
  let era: Era | null = null
  for (const zone of zones) {
    const z = zoneEra(zone)
    if (z !== null && (era === null || eraRank(z) > eraRank(era))) era = z
  }
  return era
}

/** Catalog zones ∪ the zones the item page named. One list, deduped, order irrelevant to a fold. */
function eraZones(subject: EraSubject): string[] {
  const catalog = sourcesFor(subject.key).flatMap((s) => s.zones)
  const page = (subject.wikiSources ?? []).flatMap((s) => (s.zone === undefined ? [] : [s.zone]))
  return [...new Set([...catalog, ...page])]
}

export function donorEra(subject: EraSubject): DonorEra {
  const id = `${subject.key} ${subject.eraTag ?? ''} ${String(subject.wikiSources?.length ?? 0)}`
  const hit = ERA_CACHE.get(id)
  if (hit) return hit
  const zones = eraZones(subject)
  const fromZone = latestZoneEra(zones)
  const fromTag = subject.eraTag === undefined ? null : eraFromTag(subject.eraTag)
  const era = fromZone ?? fromTag
  const value: DonorEra = {
    verdict: layeredVerdict(zones, subject.eraTag),
    era,
    by: fromZone !== null ? 'zone' : era === null ? null : 'tag'
  }
  ERA_CACHE.set(id, value)
  return value
}

/** The era chip's whole content, or null when the donor is in-era and there is nothing to say. */
export interface EraChipInfo {
  /** what the chip reads: an expansion name, `out of era`, or `era?` */
  label: string
  /** the `era?` case — chipped quietly, because it is a fact about our tables, not about the item */
  unknown: boolean
  /** why it says that, naming the witness — a banner is not a drop zone and must not pose as one */
  tooltip: string
}

const UNKNOWN_TOOLTIP =
  'Nothing places this donor: no mob catalog zone, no zone on its page, and no era banner. We will not claim it is out of era.'

/**
 * The one chip the era join draws.
 *   out-of-era → the expansion's name ("Velious") — shown only while the filter is OFF
 *   unknown    → `era?` — nothing states an era, and we will not guess one
 *   in-era     → null, the normal case, which needs no decoration
 */
export function eraChip(subject: EraSubject): EraChipInfo | null {
  const { verdict, era, by } = donorEra(subject)
  if (verdict === 'in-era') return null
  if (verdict === 'unknown') return { label: 'era?', unknown: true, tooltip: UNKNOWN_TOOLTIP }
  const label = era === null ? 'out of era' : ERA_LABEL[era]
  return {
    label,
    unknown: false,
    tooltip:
      by === 'tag'
        ? `No zone places this donor; its wiki page is banner-tagged ${label}.`
        : `This donor's sources are in ${label}.`
  }
}

/** Does the current-era filter hide this donor? Only a POSITIVE out-of-era verdict ever does. */
export function eraHides(subject: EraSubject, eraOnly: boolean): boolean {
  return eraOnly && donorEra(subject).verdict === 'out-of-era'
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

// ---- the equippability rule (R2) ----------------------------------------------------

const NONEQUIP_KEY = 'eq.planner.nonequip'

/**
 * NO EQUIPMENT SLOT ⇒ NO LEGAL DONATION. This is R2, not a heuristic: an exaltation may only be
 * socketed into an item that SHARES the donor's equipment slot, so a donor the wiki gives no slot
 * shares a slot with nothing and can never be the source of one.
 *
 * MEASURED over the committed corpus (2026-08-04, `buildPlannerDonors`): 287 of 1,508 donor rows
 * are slotless — 220 of the 813 click rows (the potion mass: "10 Dose Blood of the Wolf" and its
 * nine hundred cousins) and 67 of the 448 proc rows (poisons and weapon coatings, which are
 * consumed rather than worn). Zero focus and zero worn rows are slotless, which is itself the
 * tell: those two effect families only ever appear on things you wear.
 *
 * SO THE DEFAULT FILTER DROPS THEM — and the toggle below is the escape hatch, because an empty
 * slot list is "the page stated none" (law 1), which is USUALLY a consumable and occasionally a
 * wiki gap. The rows are shown chipped `no slot` rather than silently trusted or silently lost.
 */
export function isNonEquippable(donor: Pick<PlannerDonor, 'slots'>): boolean {
  return donor.slots.length === 0
}

/**
 * The "non-equippable" toggle, DEFAULT OFF, persisted machine-side beside the era key. Absent
 * value means off — the opposite default to the era toggle, and deliberately so: era hides things
 * you cannot reach YET, this hides things the rules say can never donate at all.
 */
export function useNonEquip(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(NONEQUIP_KEY) === '1')
  const set = useCallback((v: boolean) => {
    localStorage.setItem(NONEQUIP_KEY, v ? '1' : '0')
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
 * The browser's filter: equippability, then socket type, then slot, then trio compatibility, then
 * era, then the text match.
 *
 * `trioOnly` keeps UNKNOWN rows. Hiding a donor whose page never stated a class list would be the
 * planner asserting a fact the wiki declined to state; the row is shown and chipped instead. The
 * SLOT half is different in kind and that is why it is filtered by default: an absent slot is not
 * an unknown the user can resolve by squinting at it, it is R2 saying no.
 */
export function filterDonors(
  rows: readonly DonorRow[],
  filters: DonorFilters,
  planClasses: readonly ClassAbbr[],
  view: DonorView = DEFAULT_VIEW
): DonorRow[] {
  const needle = filters.text.trim().toLowerCase()
  return rows.filter((d) => {
    if (!view.nonEquip && isNonEquippable(d)) return false
    if (d.socket !== filters.socket) return false
    if (filters.slot !== null && !d.slots.includes(filters.slot)) return false
    if (filters.trioOnly && classFit(d, planClasses) === 'no') return false
    if (eraHides(d, view.eraOnly)) return false
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
