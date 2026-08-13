// planner/gearSet.ts — A NAMED GEAR SET: a virtual loadout, one item per equipment cell
// (JOS-286, phase 5 of the gear planner).
//
// WHAT A SET IS. The Gear tab's search surface answers "what is out there"; a set answers "what
// would I look like wearing this". So a set is a CELL MAP — `PLAN_SLOTS` (types.ts) is the cell
// model and this file does not invent a second one: the eighteen equip slots, the second
// ear/wrist/ring (JOS-67, because you wear two of each) and the two any-slots (JOS-104). One item
// per cell, and assigning to an occupied cell DISPLACES what was there, because that is what
// putting a ring on a finger does.
//
// MORE THAN ONE SET (owner ruling). The list is the document — "Raid", "Manaburn", "The one I can
// actually afford" — and nothing here knows which one is selected; that is a UI preference and
// lives where the exaltation planner's does (localStorage, `usePlans.ts`'s two tiers).
//
// EVERY ASSIGNMENT CARRIES ITS OWN PLUS-STATE, AND THAT IS THE OWNER'S BOTH-MODES RULING. The
// tab's GLOBAL slider stays exactly as phase 3 shipped it — it restates the whole corpus at one
// `+N` so you can compare candidates fairly — and it answers a different question from the one a
// set asks. A set is a plan for SPECIFIC items, and the items in a real plan are at different
// tiers: the sword you have merged five times and the helm you just looted. So the state travels
// with the assignment (`GearAssignment.state`), the cell's numbers are `scaleGearRow` at THAT
// state, and the totals add those up. Neither slider reads the other's value at any point.
//
// PURE (types + folds, relative value imports, no React/IPC/fs), so the node runner drives it and
// both tsconfigs see it — the `gearOwnership.ts` / `inventorySlots.ts` precedent. The arithmetic
// lives next door in `gearSetTotals.ts`; this file owns the SHAPE and the edits.

import { ITEM_UPGRADE_BASE, normalizeUpgradeState, type ItemUpgradeState } from '../itemUpgrade'
import {
  ANY_CELLS,
  PLAN_SLOTS,
  cellsForSlot,
  type EquipSlot,
  type PlanSlotId
} from './types'

// ---- the shape ------------------------------------------------------------------------------

/**
 * ONE ITEM IN ONE CELL, at the plus-state this plan wants it at.
 *
 * `key` is `itemKey(name)` — the corpus join key every index in this app shares (the gear index,
 * the ownership fold, the loot history), so a cell resolves to its numbers with a map lookup and
 * nothing else. `name` is carried beside it for the same reason `PlanSlot.hostName` is: a set
 * must still read as a plan on a machine whose corpus no longer has the row.
 */
export interface GearAssignment {
  /** `itemKey(name)` — the corpus join key */
  key: string
  /** the item's display name, as the corpus spells it */
  name: string
  /**
   * THIS ITEM'S OWN plus-state, tracked per assignment (the owner's both-modes ruling above).
   * Always stored normalized (`normalizeUpgradeState`), so no reader has to defend against a
   * fraction its own denominator cannot hold.
   */
  state: ItemUpgradeState
}

/**
 * A named virtual loadout. Persisted per character under `ProgressState.gearSets`, validated in
 * both directions by `src/main/planner/validate.ts` — the `ExaltPlan` arrangement, deliberately,
 * down to the additive optional store key.
 */
export interface GearSet {
  /** `crypto.randomUUID()` — stable across renames, the React key and the CRUD handle */
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** one item per cell, keyed by `PlanSlotId` — the twenty-three `PLAN_SLOTS` cells */
  slots: Partial<Record<PlanSlotId, GearAssignment>>
}

/**
 * The cells a set draws, in board order — `PLAN_SLOTS` itself, re-exported rather than copied.
 * A second list would be a second opinion about how many ears a character has.
 */
export const GEAR_SET_CELLS: readonly PlanSlotId[] = PLAN_SLOTS

// ---- where an item goes ----------------------------------------------------------------------

/**
 * The cells an item COULD occupy, in board order: the cells of every slot its page states, then
 * the two any-slots.
 *
 * THE ANY-CELLS COME LAST, and that is the same judgement `cellsForSlot` makes by leaving them
 * out entirely: they are the extra places, not the natural home for a breastplate. Offering them
 * at all is JOS-104's point — the game gives you two places that constrain nothing — so a ring
 * whose two finger cells are full can still be planned into one, but only after the fingers.
 *
 * An item whose page states NO slot cannot happen in the gear index (a row exists BECAUSE it has
 * one), so the empty-slots arm is the honest fallback rather than a live path: it offers the two
 * places that constrain nothing, which is all anyone could say about it.
 */
export function cellsForItem(slots: readonly EquipSlot[]): PlanSlotId[] {
  const out: PlanSlotId[] = []
  for (const slot of slots) {
    for (const cell of cellsForSlot(slot)) if (!out.includes(cell)) out.push(cell)
  }
  for (const cell of ANY_CELLS) out.push(cell)
  return out
}

/** Is this cell empty in this set? */
export function cellIsFree(set: GearSet, cell: PlanSlotId): boolean {
  return set.slots[cell] === undefined
}

/**
 * WHERE A SEARCH ROW LANDS when the user clicks add: the first FREE cell the item can occupy,
 * and — when every one of them is taken — the FIRST, which is the cell whose occupant is then
 * displaced.
 *
 * Falling back to the first rather than refusing is the gesture the user made: they clicked add
 * on a ring while wearing two, and "nothing happened" is the one answer that leaves them
 * wondering whether the button works. The displaced item is RETURNED by `assignToCell`, so the
 * surface can say whose place was taken.
 */
export function cellForItem(set: GearSet, slots: readonly EquipSlot[]): PlanSlotId {
  const cells = cellsForItem(slots)
  return cells.find((c) => cellIsFree(set, c)) ?? cells[0]
}

// ---- the edits -------------------------------------------------------------------------------

/** A fresh assignment at base — the state an item you have not merged is in. */
export function assignmentAt(
  item: { key: string; name: string },
  state: ItemUpgradeState = ITEM_UPGRADE_BASE
): GearAssignment {
  return { key: item.key, name: item.name, state: normalizeUpgradeState(state) }
}

/**
 * Put an item in a cell. Returns the new set AND whoever was there — assigning DISPLACES, and
 * the caller is expected to say so rather than to lose an item silently.
 *
 * The set is rebuilt rather than mutated: the previous object is a React memo another render
 * still holds.
 */
export function assignToCell(
  set: GearSet,
  cell: PlanSlotId,
  assignment: GearAssignment
): { set: GearSet; displaced: GearAssignment | null } {
  const displaced = set.slots[cell] ?? null
  const next: GearSet = {
    ...set,
    slots: { ...set.slots, [cell]: { ...assignment, state: normalizeUpgradeState(assignment.state) } }
  }
  return { set: next, displaced }
}

/**
 * Empty a cell. Rebuilt key by key rather than spread-and-`delete`: a computed `delete` is banned
 * by the lint config, and an explicit rebuild is what "this cell is empty now" means anyway
 * (`usePlans.withSocket`'s precedent).
 */
export function clearCell(set: GearSet, cell: PlanSlotId): GearSet {
  const slots: Partial<Record<PlanSlotId, GearAssignment>> = {}
  for (const [id, assignment] of Object.entries(set.slots)) {
    if (assignment && id !== cell) slots[id as PlanSlotId] = assignment
  }
  return { ...set, slots }
}

/**
 * Move ONE cell's plus-state. The per-item slider's whole write path — nothing else in the set
 * changes, which is what makes "this helm at +3 and that sword at +7" expressible at all.
 *
 * A cell with nothing in it answers with the set unchanged: there is no state without an item.
 */
export function withCellState(set: GearSet, cell: PlanSlotId, state: ItemUpgradeState): GearSet {
  const assignment = set.slots[cell]
  if (assignment === undefined) return set
  return {
    ...set,
    slots: { ...set.slots, [cell]: { ...assignment, state: normalizeUpgradeState(state) } }
  }
}

/** One cell of a set, for a caller walking the board. */
export interface GearSetCell {
  cell: PlanSlotId
  assignment: GearAssignment | null
}

/** Every cell in board order, filled or not — the pane draws all twenty-three. */
export function setCells(set: GearSet): GearSetCell[] {
  return GEAR_SET_CELLS.map((cell) => ({ cell, assignment: set.slots[cell] ?? null }))
}

/** Only the filled cells, in board order — what the totals fold and the diff walk. */
export function filledCells(set: GearSet): { cell: PlanSlotId; assignment: GearAssignment }[] {
  return setCells(set).flatMap((c) => (c.assignment === null ? [] : [{ cell: c.cell, assignment: c.assignment }]))
}

/** How many cells this set has an item in. The header's one number. */
export function assignedCount(set: GearSet): number {
  return filledCells(set).length
}

/** An empty set under a fresh id. The id is the caller's — `crypto.randomUUID` is not shared code. */
export function emptyGearSet(id: string, name: string, now: number): GearSet {
  return { id, name, createdAt: now, updatedAt: now, slots: {} }
}
