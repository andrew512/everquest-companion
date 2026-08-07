// planner/plannerInventory.ts — WHAT YOU ARE WEARING, in the planner (V7, docs/plans/planner-v2.md).
//
// The Board became the Inventory tab, and an Inventory tab that made you retype eighteen items
// you are already wearing would be a worse form of the character sheet the game already has. So
// each cell fills its host from the character's newest `/outputfile inventory` dump, joined to
// the planner's slots by the hand-authored table in shared/planner/inventorySlots.ts (law 12).
//
// LIVE, WITH NO CLICK ANYWHERE (owner, 2026-08-05: "type the command, watch it fill"). Main
// already watches the dump and pushes `inventory:autoReloaded` when the player rewrites it; this
// hook re-asks on that push, so running `/outputfile inventory` in game fills the tab while it is
// on screen. Main's watcher now also covers the FIRST dump a character ever writes (session.ts),
// which is the case the instructions card is talking to.
//
// AUTO-FILL NEVER TOUCHES THE PLAN. Nothing here writes: the dump answers "what is in that slot
// right now" at RENDER time, and a hand-picked host in the plan always wins (`effectiveHost`).
// That is what makes "my hand-picks win" structurally true rather than a precedence rule someone
// has to maintain — and it also means the auto-filled host follows your gear instead of freezing
// the day you first opened the tab.

import { useCallback, useEffect, useState } from 'react'
import type { PlannerInventory, PlannerInventoryHost } from '@shared/planner/inventorySlots'
import type { PlanSlot, PlanSlotId } from '@shared/planner/types'

export interface PlannerInventoryState {
  /** the parsed dump, or null when this character has never written one */
  inventory: PlannerInventory | null
  /** false until the first read settles — a data-availability flag, not an error */
  ready: boolean
}

/** `PlanSlotId → the item worn in that CELL`, for the cells to read. Empty when there is no dump. */
export type HostsBySlot = ReadonlyMap<PlanSlotId, PlannerInventoryHost>

export function hostsBySlot(inventory: PlannerInventory | null): HostsBySlot {
  return new Map((inventory?.hosts ?? []).map((h) => [h.slot, h]))
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

/** One cell's host: what the user PICKED, else what they are wearing. Null when neither. */
export interface EffectiveHost {
  key: string
  name: string
  /** the ` +N` the dump stated — only ever known for an equipped host; absent means unstated */
  tier?: number
  /** true when this came from the dump rather than from the user */
  equipped: boolean
}

export function effectiveHost(
  planSlot: PlanSlot,
  equipped: PlannerInventoryHost | undefined
): EffectiveHost | null {
  if (planSlot.hostKey !== undefined && planSlot.hostName !== undefined) {
    return { key: planSlot.hostKey, name: planSlot.hostName, equipped: false }
  }
  if (!equipped) return null
  const host: EffectiveHost = { key: equipped.key, name: equipped.name, equipped: true }
  if (equipped.tier !== undefined) host.tier = equipped.tier
  return host
}
