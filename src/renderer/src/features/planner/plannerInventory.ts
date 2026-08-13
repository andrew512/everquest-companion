// planner/plannerInventory.ts — WHAT YOU ARE WEARING, read live from the character's own dump
// (V7, docs/plans/planner-v2.md).
//
// WHAT THIS WAS FOR, AND WHO READS IT NOW — WHICH IS NOBODY, AND THAT WANTS AN INTEGRATOR'S CALL.
//
// It was written for the exaltation planner's Inventory tab, whose cells filled their hosts from
// the character's newest `/outputfile inventory` dump; the Gear tab's sets pane then took the same
// read for its "versus what you are wearing" diff. JOS-326 removed the board (and with it the two
// cell-shaped helpers only the board used, `hostsBySlot` and `effectiveHost`), and JOS-325 retired
// gear sets in the same wave — so as of that pair of merges this hook has NO CALLER.
//
// IT IS LEFT STANDING ON PURPOSE RATHER THAN HALF-REMOVED. Deleting it alone would leave the
// channel behind it dead end to end — `IPC.plannerInventory`, its handler in src/main/ipc/planner.ts
// and its preload method — plus a dangling reference in `features/character/useCharacterSheet.ts`,
// which cites this file by name as the precedent for its own transport. That is one removal across
// four files owned by three tickets, so it belongs to whoever integrates them, not to either
// worker. Retire the whole channel or find it a caller; do not delete just this half.
//
// LIVE, WITH NO CLICK ANYWHERE (owner, 2026-08-05: "type the command, watch it fill"). Main
// already watches the dump and pushes `inventory:autoReloaded` when the player rewrites it; this
// hook re-asks on that push, so running `/outputfile inventory` in game fills the surface while it
// is on screen. Main's watcher also covers the FIRST dump a character ever writes (session.ts).
//
// IT NEVER WRITES ANYTHING. The dump answers "what is in that slot right now" at RENDER time, so
// what it says follows your gear instead of freezing the day you first opened a tab — and no
// stored document can be corrupted by a dump that changed under it.

import { useCallback, useEffect, useState } from 'react'
import type { PlannerInventory } from '@shared/planner/inventorySlots'

export interface PlannerInventoryState {
  /** the parsed dump, or null when this character has never written one */
  inventory: PlannerInventory | null
  /** false until the first read settles — a data-availability flag, not an error */
  ready: boolean
}

/**
 * The character's equipped items, re-read whenever the dump is rewritten.
 *
 * Not module-cached, unlike the donor corpus: that is compiled-in bytes that cannot change while
 * the app runs, and this is a file the player rewrites mid-session on purpose.
 */
export function usePlannerInventory(): PlannerInventoryState {
  const [state, setState] = useState<PlannerInventoryState>({ inventory: null, ready: false })

  const read = useCallback((alive: () => boolean) => {
    void window.eq
      .plannerInventory()
      .then((inventory) => {
        if (alive()) setState({ inventory, ready: true })
      })
      .catch(() => {
        /* main never rejects; no dump is a null answer, not a failure */
        if (alive()) setState({ inventory: null, ready: true })
      })
  }, [])

  useEffect(() => {
    let alive = true
    const live = (): boolean => alive
    read(live)
    // The push carries the path and mtime, and we deliberately ignore both: main is the only
    // thing that knows which dump belongs to the active character, so the answer is re-asked
    // rather than patched from the event.
    const off = window.eq.onInventoryReload(() => read(live))
    return () => {
      alive = false
      off()
    }
  }, [read])

  return state
}
