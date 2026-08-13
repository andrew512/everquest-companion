// gear/useGearSets.ts — the Gear tab's SETS: load, edit, persist, and which one you were looking
// at (JOS-286, phase 5).
//
// THIS IS `usePlans.ts` FOR THE OTHER DOCUMENT, and it is deliberately the same shape down to the
// two storage tiers: the SETS are character-scoped knowledge and live in the electron-store under
// `ProgressState.gearSets`, reached over IPC and re-validated in main; which set is selected and
// whether the pane is open are MACHINE-class UI preferences with no meaning on another machine, so
// they live in raw `localStorage` under `eq.gear.*` — the same tier as `eq.planner.set`.
//
// WRITES ARE DEBOUNCED WHOLE-ARRAY SAVES, and they FLUSH ON UNMOUNT. A set is small (a name and up
// to twenty-three cells) and the user edits it in bursts — dragging a per-item slider is one write
// per pixel — so the array is written ~500 ms after the last change, with React state as the truth
// in between. The unmount flush is the half that is easy to forget: this view unmounts the moment
// you switch tabs, and a slider dragged 200 ms before that switch would otherwise be cancelled
// with the timer and silently lost (`usePlans.useDebouncedSave` learned this first).
//
// SEARCH STAYS THE DEFAULT SURFACE (owner ruling). Nothing here is required to render the table:
// no set, no selection and no pane is the state the tab opens in, and every method below is a
// no-op until the user makes one.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ItemUpgradeState } from '@shared/itemUpgrade'
import type { GearRow } from '@shared/planner/gear'
import {
  assignToCell,
  assignmentAt,
  cellForItem,
  clearCell,
  emptyGearSet,
  withCellState,
  type GearAssignment,
  type GearSet
} from '@shared/planner/gearSet'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'

const SET_KEY = 'eq.gear.set'
const OPEN_KEY = 'eq.gear.setsOpen'
const SAVE_DEBOUNCE_MS = 500

/** "Set 1", "Set 2", … — the first number this character is not already using (usePlans's rule). */
function nextSetName(sets: readonly GearSet[]): string {
  const taken = new Set(sets.map((s) => s.name))
  for (let n = 1; ; n++) {
    const name = `Set ${String(n)}`
    if (!taken.has(name)) return name
  }
}

/** Replace one set, stamping `updatedAt`. Every mutation below funnels through this. */
function withSet(sets: readonly GearSet[], id: string, edit: (set: GearSet) => GearSet): GearSet[] {
  return sets.map((s) => (s.id === id ? { ...edit(s), updatedAt: Date.now() } : s))
}

/**
 * WHAT AN ASSIGNMENT JUST DID, said once. Assigning DISPLACES (gearSet.ts), and an item that
 * vanished out of a cell without a word is the failure mode this exists to prevent — so the pane
 * gets one sentence naming the cell and whoever was in it.
 */
export interface AssignNote {
  /** monotonic, so the same sentence twice still re-announces itself */
  seq: number
  text: string
}

export interface GearSetsApi {
  sets: GearSet[]
  /** false until the first load settles — a data-availability flag, not an error */
  ready: boolean
  selected: GearSet | null
  select: (id: string) => void
  /** whether the pane is on screen. Sets are ADDITIVE UI (owner ruling) — this starts closed. */
  open: boolean
  setOpen: (open: boolean) => void
  /** create a set named "Set N" and select it */
  create: () => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  /** put a search row in the selected set's natural cell, displacing whoever was there */
  assign: (row: GearRow) => void
  /** empty one cell of the selected set */
  clear: (cell: PlanSlotId) => void
  /** move ONE cell's plus-state — the per-item slider's whole write path */
  setCellState: (cell: PlanSlotId, state: ItemUpgradeState) => void
  /** the last displacement, for the pane to state */
  note: AssignNote | null
}

interface Loaded {
  sets: GearSet[]
  setSets: Dispatch<SetStateAction<GearSet[]>>
  ready: boolean
}

/** The one load: this character's stored sets — `[]` when it has none, never an error. */
function useLoadedSets(): Loaded {
  const [sets, setSets] = useState<GearSet[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void window.eq
      .getGearSets()
      .then((loaded) => {
        if (alive) setSets(loaded)
      })
      .catch(() => {
        /* main never rejects; an unreadable store yields no sets, not a crash */
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])
  return { sets, setSets, ready }
}

/** Debounced whole-array persistence, flushed on unmount. See the header. */
function useDebouncedSave(sets: GearSet[], ready: boolean): void {
  const latest = useRef(sets)
  const pending = useRef(false)
  const first = useRef(true)

  useEffect(() => {
    latest.current = sets
    if (!ready) return
    if (first.current) {
      first.current = false
      return
    }
    pending.current = true
    const t = setTimeout(() => {
      pending.current = false
      void window.eq.setGearSets(latest.current)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [sets, ready])

  useEffect(() => {
    return () => {
      if (pending.current) void window.eq.setGearSets(latest.current)
    }
  }, [])
}

/**
 * The Gear tab's set state. Mount ONCE per view (GearView owns it) — two mounts would each hold
 * their own copy of the array and race each other's debounced saves.
 */
export function useGearSets(): GearSetsApi {
  const { sets, setSets, ready } = useLoadedSets()
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(SET_KEY))
  const [open, setOpenState] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const [note, setNote] = useState<AssignNote | null>(null)
  const seq = useRef(0)

  useDebouncedSave(sets, ready)

  const selected = useMemo(
    () => sets.find((s) => s.id === selectedId) ?? sets[0] ?? null,
    [sets, selectedId]
  )

  // Keep the persisted selection pointing at a set that exists — a deleted set must not leave the
  // pane highlighting nothing on the next launch (usePlans's rule, same failure).
  useEffect(() => {
    if (selected === null) localStorage.removeItem(SET_KEY)
    else if (selected.id !== selectedId) localStorage.setItem(SET_KEY, selected.id)
  }, [selected, selectedId])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    localStorage.setItem(SET_KEY, id)
  }, [])

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    localStorage.setItem(OPEN_KEY, next ? '1' : '0')
  }, [])

  // Built OUTSIDE the state updater and only then appended: a `setSelectedId` from inside an
  // updater would fire twice under StrictMode's double-invoke (usePlans's `add`).
  const create = useCallback(() => {
    const fresh = emptyGearSet(crypto.randomUUID(), nextSetName(sets), Date.now())
    setSets((prev) => [...prev, fresh])
    setSelectedId(fresh.id)
    localStorage.setItem(SET_KEY, fresh.id)
    setOpen(true)
  }, [sets, setSets, setOpen])

  const say = useCallback((text: string) => {
    seq.current += 1
    setNote({ seq: seq.current, text })
  }, [])

  const selectedIdOrNull = selected?.id ?? null

  // THE CELL AND THE DISPLACEMENT ARE DECIDED HERE, NOT INSIDE THE UPDATER. A state updater must
  // stay pure — StrictMode double-invokes it — so announcing from inside would say the same
  // sentence twice and bump the sequence twice. `selected` is the set the user is looking at, and
  // the updater below re-applies exactly the decision made against it.
  const assign = useCallback(
    (row: GearRow) => {
      if (selected === null) return
      const cell = cellForItem(selected, row.slots)
      const displaced = selected.slots[cell] ?? null
      setSets((prev) => withSet(prev, selected.id, (set) => assignToCell(set, cell, assignmentAt(row)).set))
      announce(say, cell, row.name, displaced)
    },
    [selected, setSets, say]
  )

  const edits = useMemo(
    () => ({
      rename: (id: string, name: string) => setSets((prev) => withSet(prev, id, (s) => ({ ...s, name }))),
      remove: (id: string) => setSets((prev) => prev.filter((s) => s.id !== id)),
      clear: (cell: PlanSlotId) => {
        if (selectedIdOrNull === null) return
        setSets((prev) => withSet(prev, selectedIdOrNull, (s) => clearCell(s, cell)))
      },
      setCellState: (cell: PlanSlotId, state: ItemUpgradeState) => {
        if (selectedIdOrNull === null) return
        setSets((prev) => withSet(prev, selectedIdOrNull, (s) => withCellState(s, cell, state)))
      }
    }),
    [selectedIdOrNull, setSets]
  )

  return { sets, ready, selected, select, open, setOpen, create, assign, note, ...edits }
}

/**
 * The displacement sentence. Pulled out of the updater so the updater stays a pure-ish fold and
 * so the wording lives in one place: a cell that was empty says what landed, a cell that was not
 * says what left as well as what landed.
 */
function announce(
  say: (text: string) => void,
  cell: PlanSlotId,
  name: string,
  displaced: GearAssignment | null
): void {
  const where = planSlotLabel(cell)
  say(
    displaced === null
      ? `${name} → ${where}.`
      : `${name} → ${where}, displacing ${displaced.name}.`
  )
}
