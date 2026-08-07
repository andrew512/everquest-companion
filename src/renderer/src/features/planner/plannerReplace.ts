// planner/plannerReplace.ts — WOULD THIS ADD OVERWRITE SOMETHING? (JOS-42 refinement 3.)
//
// A socket holds exactly one effect (R1), so "Add to set" on a socket that is already filled is
// not an add — it is a silent discard of a decision the user made earlier. The control has to say
// so BEFORE the click, which means something has to answer "what is in the socket this row would
// write to", and that question has two halves the view should not be improvising:
//
//   * WHICH SOCKET WOULD IT WRITE? Under a browse preset it is exact — you clicked that socket of
//     that item. Without one, a donor whose slots resolve to a SINGLE board CELL implies its target
//     (that cell, the donor's own socket type). Anything else does NOT: the slot menu is the
//     question being asked, and claiming a replace before the cell is chosen would be guessing
//     which one the user meant. `replacesFor` answers `null` there, and the MENU carries the
//     warning per cell instead (EffectBrowser's SlotMenu).
//     CELLS, NOT SLOTS, SINCE JOS-67: a ring donor names one equip slot and TWO places to wear it,
//     so `targetCells` below expands through `cellsForSlot` and a FINGER donor now opens the menu
//     it used to skip. That is the whole reason the expansion is here rather than inline in the
//     view — "which cells could this land in" is the same question the replace warning asks.
//   * AND IS IT THE SAME ROW? Re-adding the effect that is already sitting there replaces nothing.
//     The row is chipped "in set" and a button reading "Replace Improved Healing III" while adding
//     Improved Healing III would be nonsense.
//
// PURE, and node-tested (`tests/plannerReplace.test.mts`) rather than reachable only through a
// launched app: the e2e can only exercise whichever socket the machine's own data happens to leave
// occupied, and it legitimately skips when nothing does. Relative value imports, house law.

import { cellsForSlot } from '../../../../shared/planner/types'
import type {
  EquipSlot,
  ExaltPlan,
  PlanSlotId,
  PlanSocket,
  SocketType
} from '../../../../shared/planner/types'

/** What a row needs to state about itself for the question to be answerable. */
export interface ReplaceSubject {
  key: string
  effect: string
  socket: SocketType
  slots: readonly EquipSlot[]
}

/**
 * Every board CELL this donor could be written into, in board order (JOS-67). A two-slot sword
 * gives PRIMARY and SECONDARY as before; a ring gives FINGER 1 and FINGER 2, which is the fix.
 * Deduped by construction — `cellsForSlot` reads one ordered list and a donor never repeats a slot.
 */
export function targetCells(donor: Pick<ReplaceSubject, 'slots'>): PlanSlotId[] {
  return donor.slots.flatMap((s) => cellsForSlot(s))
}

/** The socket of a plan a write would land in — `cell:socket`, the key the map below uses. */
export type SocketKey = string

/** `cell:socket → the effect planned there`. Folded once per plan change, read by every row. */
export function plannedBySocket(plan: ExaltPlan): ReadonlyMap<SocketKey, PlanSocket> {
  const out = new Map<SocketKey, PlanSocket>()
  for (const [cell, planSlot] of Object.entries(plan.slots)) {
    for (const [socket, planned] of Object.entries(planSlot?.sockets ?? {})) {
      if (planned) out.set(`${cell}:${socket}`, planned)
    }
  }
  return out
}

/** The effect a write to (cell, socket) would displace, or null — including "it is already this". */
export function outgoing(
  occupied: ReadonlyMap<SocketKey, PlanSocket>,
  slot: PlanSlotId,
  socket: SocketType,
  donor: ReplaceSubject
): string | null {
  const there = occupied.get(`${slot}:${socket}`)
  if (!there) return null
  if (there.donorKey === donor.key && there.effect === donor.effect) return null
  return there.effect
}

/** The preset's shape, as far as this question is concerned (features/planner/plannerPreset.ts). */
export interface ReplaceTarget {
  slot: PlanSlotId
  socket: SocketType
}

/**
 * What clicking THIS ROW'S add button would replace, or null. See the header for the two cases
 * where the answer is null despite the plan being non-empty.
 */
export function replacesFor(
  occupied: ReadonlyMap<SocketKey, PlanSocket>,
  preset: ReplaceTarget | null,
  donor: ReplaceSubject
): string | null {
  if (preset !== null) return outgoing(occupied, preset.slot, preset.socket, donor)
  const cells = targetCells(donor)
  const only = cells.length === 1 ? cells[0] : null
  return only === null ? null : outgoing(occupied, only, donor.socket, donor)
}
