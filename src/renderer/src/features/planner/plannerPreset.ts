// planner/plannerPreset.ts — BROWSING ONE SOCKET OF ONE ITEM (V8, docs/plans/planner-v2.md).
//
// The planner had one way in: pick an effect, then say which slot it lands in. The owner asked for
// the other one, which is how the game itself presents the decision — you open an item, you see
// its sockets, and you fill one. That is what the Inventory tab's cells are now: the host, then
// its four sockets with their unlock tiers, and clicking a socket takes you to the effect browser
// ALREADY NARROWED to what can legally go there.
//
// IT IS A FILTER PRESET OVER THE EXISTING BROWSER, not a second browser. Three facts travel:
// the socket (which of the four), the slot (where the host is worn), and the host itself — and
// the host's own class list, looked up once, because R2 only lets an exaltation into an item that
// shares a class with it.
//
// THE HOST'S CLASSES ARE LOOKED UP, NOT ASSUMED. An auto-filled host comes from an inventory dump,
// which states no classes at all, and a hand-picked one was chosen before this preset existed. So
// the lookup goes through main's item index by EXACT KEY (`plannerSearchItems` ranks the typed
// name first, and the answer is taken only when the key matches — a name match alone would be the
// fuzzy join law 12 forbids). An item the index does not carry, or one whose page stated no class
// list, yields `[]` — which is UNKNOWN and therefore filters nothing (law 1).

import { useEffect, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import type { PlanSlotId, SocketType } from '@shared/planner/types'

/** Which socket of which host the browser is currently filtered to. */
export interface BrowsePreset {
  /** the CELL you clicked — the browser filters by `equipSlotOf(slot)` and WRITES to this (JOS-67) */
  slot: PlanSlotId
  socket: SocketType
  /** `itemKey(name)` of the host — the identity the class lookup matches on */
  hostKey: string
  hostName: string
}

/**
 * The host's usable classes, or `[]` while unknown (still loading, not in the index, or the page
 * stated none). Re-runs when the preset changes; an answer for a stale preset is dropped.
 */
export function useHostClasses(preset: BrowsePreset | null): ClassAbbr[] {
  const [classes, setClasses] = useState<ClassAbbr[]>([])
  const key = preset?.hostKey ?? null
  const name = preset?.hostName ?? null

  useEffect(() => {
    setClasses([])
    if (key === null || name === null) return
    let alive = true
    void window.eq
      .plannerSearchItems(name)
      .then((hits) => {
        if (!alive) return
        setClasses(hits.find((h) => h.key === key)?.classes ?? [])
      })
      .catch(() => {
        /* main never rejects; an unknown class list filters nothing */
      })
    return () => {
      alive = false
    }
  }, [key, name])

  return classes
}
