// planner/usePlans.ts — the exaltation sets themselves: load, edit, persist, and which one you
// were looking at.
//
// TWO STORAGE TIERS, on purpose (design §6). The SETS are character-scoped knowledge and live in
// the electron-store under `ProgressState.exaltPlans`, reached over IPC. Which set is selected and
// which mode is open are MACHINE-class UI preferences with no meaning on another machine, so they
// live in raw `localStorage` under `eq.planner.*` — the same tier as `eq.view` (appViews.ts) and
// `eq.combat.scope`.
//
// WRITES ARE DEBOUNCED WHOLE-ARRAY SAVES. A plan is small (a name, ≤3 classes, ≤18 slots) and the
// user edits it in bursts — typing a name is one keystroke per character — so the array is written
// ~500 ms after the last change rather than per edit. React state is the source of truth in
// between, so the UI never waits on the round trip.
//
// THE FOUR CALLS ARE `window.eq`'s OWN (wave 2B landed them): `plannerDonors`,
// `plannerSearchItems`, `getExaltPlans`, `setExaltPlans` are declared in the preload and typed
// there, so nothing in this feature declares a bridge shape of its own. Main re-validates a
// written plan against the closed slot/socket/class allowlists and silently drops what does not
// fit — the renderer is never the authority on what a stored plan may contain.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import type {
  ClassesProvenance,
  EquipSlot,
  ExaltPlan,
  PlanSlot,
  PlanSocket,
  SocketType
} from '@shared/planner/types'

// ---- UI preferences (machine-class, raw localStorage) ------------------------------

export type PlannerMode = 'effects' | 'board' | 'farm'

const SET_KEY = 'eq.planner.set'
const MODE_KEY = 'eq.planner.mode'
const MODES: PlannerMode[] = ['effects', 'board', 'farm']

/** The persisted mode, bounced to Effects when the stored string is not one this build renders. */
export function loadMode(): PlannerMode {
  const v = localStorage.getItem(MODE_KEY)
  return v !== null && (MODES as string[]).includes(v) ? (v as PlannerMode) : 'effects'
}

function loadSelectedId(): string | null {
  return localStorage.getItem(SET_KEY)
}

// ---- pure plan edits ----------------------------------------------------------------

/** "Set 1", "Set 2", … — the first number this character is not already using. */
function nextSetName(plans: readonly ExaltPlan[]): string {
  const taken = new Set(plans.map((p) => p.name))
  for (let n = 1; ; n++) {
    const name = `Set ${String(n)}`
    if (!taken.has(name)) return name
  }
}

function newId(): string {
  return crypto.randomUUID()
}

/**
 * A new set FOLLOWS detection (V2). It is seeded from the inferred combo exactly as before, but
 * the seed is no longer a one-time stamp: until the user edits the trio, a loadout switch moves
 * the set's filter with it.
 */
function freshPlan(name: string, classes: readonly ClassAbbr[]): ExaltPlan {
  const now = Date.now()
  return {
    id: newId(),
    name,
    classes: [...classes],
    classesProvenance: 'detected',
    createdAt: now,
    updatedAt: now,
    slots: {}
  }
}

/** Replace one plan, stamping `updatedAt`. Every mutation below funnels through this. */
function withPlan(
  plans: readonly ExaltPlan[],
  id: string,
  edit: (plan: ExaltPlan) => ExaltPlan
): ExaltPlan[] {
  return plans.map((p) => (p.id === id ? { ...edit(p), updatedAt: Date.now() } : p))
}

/** A copy under its own id and name — "Set 1 (copy)". Slots are deep-copied one level: the
 *  socket records are replaced wholesale by the editor, never mutated in place. */
function copyOf(plan: ExaltPlan, name: string): ExaltPlan {
  const now = Date.now()
  const slots: ExaltPlan['slots'] = {}
  for (const [slot, planSlot] of Object.entries(plan.slots)) {
    if (planSlot) slots[slot as EquipSlot] = { ...planSlot, sockets: { ...planSlot.sockets } }
  }
  return { ...plan, id: newId(), name, createdAt: now, updatedAt: now, slots }
}

/**
 * Write one set's trio, optionally restamping where it came from (V2).
 *
 * `provenance` omitted = "keep whatever it was" — which is what the detection binding and the
 * disagree chip both want. Passing `'user'` is what a hand edit does, and it is one-way: nothing
 * in the UI hands a pinned set back to inference, because that would be the app deciding to stop
 * respecting a decision the user made.
 */
export function withClasses(
  plans: readonly ExaltPlan[],
  id: string,
  classes: readonly ClassAbbr[],
  provenance?: ClassesProvenance
): ExaltPlan[] {
  return withPlan(plans, id, (p) => {
    const next: ExaltPlan = { ...p, classes: [...classes] }
    // Assigned rather than spread so a set that has never carried the field does not gain an
    // explicit `undefined` — the absent key IS the `user` reading, and it must stay absent.
    const from = provenance ?? p.classesProvenance
    if (from !== undefined) next.classesProvenance = from
    return next
  })
}

/**
 * Write (or clear, with `null`) one socket of one slot. Creates the slot record on demand.
 * Rebuilt rather than spread-and-deleted: a computed `delete` is banned by the lint config, and
 * an explicit rebuild is what "clearing a socket" means anyway.
 */
export function withSocket(
  plan: ExaltPlan,
  slot: EquipSlot,
  socket: SocketType,
  planned: PlanSocket | null
): ExaltPlan {
  const existing = plan.slots[slot] ?? { sockets: {} }
  const sockets: Partial<Record<SocketType, PlanSocket>> = {}
  for (const [kind, value] of Object.entries(existing.sockets)) {
    if (value && kind !== socket) sockets[kind as SocketType] = value
  }
  if (planned !== null) sockets[socket] = planned
  return { ...plan, slots: { ...plan.slots, [slot]: { ...existing, sockets } } }
}

/**
 * Set (or clear, with `null`) the HOST item of one slot, keeping whatever is socketed there.
 *
 * Clearing a host does NOT clear the sockets: the effects you want in your head slot are still
 * the effects you want when you change your mind about which helm carries them. The Board says so
 * by keeping the socket lines and marking the cell hostless.
 */
export function withHost(
  plan: ExaltPlan,
  slot: EquipSlot,
  host: { key: string; name: string } | null
): ExaltPlan {
  const existing = plan.slots[slot] ?? { sockets: {} }
  const next: PlanSlot = { sockets: existing.sockets }
  if (host !== null) {
    next.hostKey = host.key
    next.hostName = host.name
  }
  return { ...plan, slots: { ...plan.slots, [slot]: next } }
}

// ---- the hook ------------------------------------------------------------------------

export interface PlansApi {
  plans: ExaltPlan[]
  /** false until the first load settles — a data-availability flag, not an error */
  ready: boolean
  selected: ExaltPlan | null
  select: (id: string) => void
  mode: PlannerMode
  setMode: (m: PlannerMode) => void
  /** create a set named "Set N" with the given target classes, and select it */
  create: (classes: readonly ClassAbbr[]) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
  /**
   * Edit the trio BY HAND — which pins it (`classesProvenance: 'user'`, V2). Detection stops
   * overwriting the set from here on and starts offering itself as a chip instead.
   */
  setClasses: (id: string, classes: readonly ClassAbbr[]) => void
  /**
   * Write the trio WITHOUT changing where it came from: the detection binding uses it to keep a
   * following set current, and the disagree chip uses it to apply one detected answer to a pinned
   * set without handing the filter back to inference forever.
   */
  adoptClasses: (id: string, classes: readonly ClassAbbr[]) => void
  /** write/clear one socket of the SELECTED set (the only set the browser can edit) */
  setSocket: (slot: EquipSlot, socket: SocketType, planned: PlanSocket | null) => void
  /** pick (or clear) the host item of one slot of the SELECTED set */
  setHost: (slot: EquipSlot, host: { key: string; name: string } | null) => void
}

const SAVE_DEBOUNCE_MS = 500

/**
 * Debounced whole-array persistence. Skips the very first render (that array IS what was loaded).
 *
 * AND FLUSHES ON UNMOUNT, which is the half that is easy to forget: the view unmounts the moment
 * you switch tabs, and without the flush a rename typed 200 ms before that switch would be
 * cancelled with the timer and silently lost. `latest` carries the array into the cleanup because
 * the unmount effect deliberately has no dependencies.
 */
function useDebouncedSave(plans: ExaltPlan[], ready: boolean): void {
  const latest = useRef(plans)
  const pending = useRef(false)
  const first = useRef(true)

  useEffect(() => {
    latest.current = plans
    if (!ready) return
    if (first.current) {
      first.current = false
      return
    }
    pending.current = true
    const t = setTimeout(() => {
      pending.current = false
      void window.eq.setExaltPlans(latest.current)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [plans, ready])

  useEffect(() => {
    return () => {
      if (pending.current) void window.eq.setExaltPlans(latest.current)
    }
  }, [])
}

interface LoadedPlans {
  plans: ExaltPlan[]
  setPlans: Dispatch<SetStateAction<ExaltPlan[]>>
  ready: boolean
}

/** The one load: this character's stored sets — `[]` when it has none, never an error. */
function useLoadedPlans(): LoadedPlans {
  const [plans, setPlans] = useState<ExaltPlan[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void window.eq
      .getExaltPlans()
      .then((loaded) => {
        if (alive) setPlans(loaded)
      })
      .catch(() => {
        /* main never rejects; an unreadable store yields an empty planner, not a crash */
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])
  return { plans, setPlans, ready }
}

/**
 * The planner's set state. Mount ONCE per view (PlannerView owns it) — two mounts would each hold
 * their own copy of the array and race each other's debounced saves.
 */
export function usePlans(): PlansApi {
  const { plans, setPlans, ready } = useLoadedPlans()
  const [selectedId, setSelectedId] = useState<string | null>(loadSelectedId)
  const [mode, setModeState] = useState<PlannerMode>(loadMode)

  useDebouncedSave(plans, ready)

  const selected = useMemo(
    () => plans.find((p) => p.id === selectedId) ?? plans[0] ?? null,
    [plans, selectedId]
  )

  // Keep the persisted selection pointing at a set that exists — a deleted set must not leave the
  // toolbar highlighting nothing on the next launch.
  useEffect(() => {
    if (selected === null) localStorage.removeItem(SET_KEY)
    else if (selected.id !== selectedId) localStorage.setItem(SET_KEY, selected.id)
  }, [selected, selectedId])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    localStorage.setItem(SET_KEY, id)
  }, [])

  const setMode = useCallback((m: PlannerMode) => {
    setModeState(m)
    localStorage.setItem(MODE_KEY, m)
  }, [])

  // The new set is built OUTSIDE the state updater and only then appended: a `setSelectedId` from
  // inside an updater would fire twice under StrictMode's double-invoke.
  const add = useCallback(
    (plan: ExaltPlan) => {
      setPlans((prev) => [...prev, plan])
      setSelectedId(plan.id)
      localStorage.setItem(SET_KEY, plan.id)
    },
    [setPlans]
  )

  const create = useCallback(
    (classes: readonly ClassAbbr[]) => {
      add(freshPlan(nextSetName(plans), classes))
    },
    [add, plans]
  )

  const duplicate = useCallback(
    (id: string) => {
      const src = plans.find((p) => p.id === id)
      if (src) add(copyOf(src, nextSetName(plans)))
    },
    [add, plans]
  )

  const edits = useMemo(
    () => ({
      rename: (id: string, name: string) =>
        setPlans((prev) => withPlan(prev, id, (p) => ({ ...p, name }))),
      remove: (id: string) => setPlans((prev) => prev.filter((p) => p.id !== id)),
      setClasses: (id: string, classes: readonly ClassAbbr[]) =>
        setPlans((prev) => withClasses(prev, id, classes, 'user')),
      adoptClasses: (id: string, classes: readonly ClassAbbr[]) =>
        setPlans((prev) => withClasses(prev, id, classes))
    }),
    [setPlans]
  )

  const selectedIdOrNull = selected?.id ?? null
  const setSocket = useCallback(
    (slot: EquipSlot, socket: SocketType, planned: PlanSocket | null) => {
      if (selectedIdOrNull === null) return
      setPlans((prev) => withPlan(prev, selectedIdOrNull, (p) => withSocket(p, slot, socket, planned)))
    },
    [selectedIdOrNull, setPlans]
  )

  const setHost = useCallback(
    (slot: EquipSlot, host: { key: string; name: string } | null) => {
      if (selectedIdOrNull === null) return
      setPlans((prev) => withPlan(prev, selectedIdOrNull, (p) => withHost(p, slot, host)))
    },
    [selectedIdOrNull, setPlans]
  )

  return { plans, ready, selected, select, mode, setMode, create, setSocket, setHost, ...edits, duplicate }
}
