// planner/inventorySlots.ts — WHAT YOU ARE ACTUALLY WEARING, in the planner's own slot vocabulary
// (V7, docs/plans/planner-v2.md).
//
// Two closed sets that describe the same eighteen places on a character and agree about almost
// none of the spellings, because they come from different worlds: `EQUIP_LOCATIONS`
// (shared/outputs/inventory.ts) is what the CLIENT writes into a `/outputfile inventory` dump,
// and `EquipSlot` (./types.ts) is normalized from WIKI tokens. `Fingers` vs `FINGER`, `Any Slot`
// with no wiki counterpart at all.
//
// SO THE JOIN IS A HAND-AUTHORED TABLE (law 12: cross-source renames are knowledge, never fuzzy),
// and the outputs model asked for exactly this in writing when it declined to reconcile the two
// itself. Every one of the twenty client tokens is listed below — the eighteen that name a wiki
// slot, and the two that deliberately name none:
//
//   * `Any Slot` is the client's spelling for a slot-agnostic equipment slot. It is a real place
//     to wear something and it is not one of the eighteen, so it maps to nothing rather than to a
//     guess about which slot the wearer meant.
//   * `Held` is the same story from the other side: the wiki's PRIMARY/SECONDARY split does not
//     exist in that token, and picking one would be inventing which hand.
//
// AND THE DUMP IS WHERE WE LEARNED HOW MANY OF EACH YOU WEAR (JOS-67). `Ear`, `Wrist` and `Fingers`
// each print TWICE at top level in the committed 295-line dump — three tokens, twice each, nothing
// else repeating — which is the game itself stating the pair rule that `PLAN_SLOTS` now encodes.
// The table below is unchanged: a client token names a SLOT, and how many cells that slot has is
// types.ts's answer, not this table's.
//
// PURE: types plus a fold, no fs and no Electron, so both tsconfigs see it and the node runner
// drives it against the real 295-line dump (`tests/plannerInventory.test.mts`).

import { parseItemName, walkEntries, type InventoryDump, type InventoryEntry } from '../outputs/inventory'
import type { EquipLocationToken } from '../outputs/inventory'
import { cellsForSlot, type EquipSlot, type PlanSlotId } from './types'

/**
 * The table. Keys are every member of `EQUIP_LOCATIONS`; a `null` value is a token that names no
 * wiki slot and MUST stay unmapped — see the header. `Record` over the token union rather than a
 * loose map, so a client token added to the outputs model turns this file red instead of silently
 * dropping a slot out of the planner.
 */
export const SLOT_OF_LOCATION: Record<EquipLocationToken, EquipSlot | null> = {
  'Any Slot': null,
  Held: null,
  Ammo: 'AMMO',
  Arms: 'ARMS',
  Back: 'BACK',
  Chest: 'CHEST',
  Ear: 'EAR',
  Face: 'FACE',
  Feet: 'FEET',
  Fingers: 'FINGER',
  Hands: 'HANDS',
  Head: 'HEAD',
  Legs: 'LEGS',
  Neck: 'NECK',
  Primary: 'PRIMARY',
  Range: 'RANGE',
  Secondary: 'SECONDARY',
  Shoulders: 'SHOULDERS',
  Waist: 'WAIST',
  Wrist: 'WRIST'
}

/** One equipped item, in planner terms. */
export interface InventoryHost {
  /** the CELL it fills — the second ear/wrist/ring lands in the pair's second cell (JOS-67) */
  slot: PlanSlotId
  /** the item's own name — ` +N`, `*` and ` (Exaltation)` already split off */
  name: string
  /** the ` +N` merge tier the dump stated; absent means the name carried none, NOT tier 0 */
  tier?: number
}

/**
 * An equipped item joined to the planner's item key — what MAIN serves, because `itemKey` is
 * main's definition (itemsDb.ts) and this module must stay dependency-free.
 */
export interface PlannerInventoryHost extends InventoryHost {
  /** `itemKey(name)` — joins the donor corpus and the host picker */
  key: string
}

/** The answer to "what is this character wearing", with the dump it was read from. */
export interface PlannerInventory {
  /** the dump file that was read — the instructions card names it once it exists */
  path: string
  /** the file's mtime: WHEN THE PLAYER dumped, never when we read it */
  loadedAt: string
  hosts: PlannerInventoryHost[]
}

/** A row of the dump's Location table that is a top-level EQUIPPED item, with something in it. */
function equippedSlot(entry: InventoryEntry): EquipSlot | null {
  // `path` empty ⇒ top level: a `-Slot<n>` child is a bag's contents or a socketed exaltation,
  // and neither is the thing being worn in that slot.
  if (entry.path.length > 0 || entry.empty) return null
  if (entry.place.kind !== 'equip') return null
  return SLOT_OF_LOCATION[entry.place.token]
}

/**
 * The dump → what is equipped, one entry per planner CELL.
 *
 * `Ear`, `Wrist`, `Fingers` and `Any Slot` each appear TWICE at top level, because the character
 * wears two of each. This used to keep the FIRST of each and say so in writing: the plan could only
 * hold one cell per slot type, so the second ring had nowhere to go. JOS-67 gave the paired three
 * their second cell (types.ts `PLAN_SLOTS`), so both rows are now taken, IN THE ORDER THE CLIENT
 * WROTE THEM — the dump still has no column saying which ring is left, and the cells are numbered
 * 1 and 2 rather than named, precisely so the app is not claiming to know.
 *
 * `Any Slot` maps to no cell at all (see the table above), so it still contributes nothing; a
 * THIRD row for a slot the game only gives two of would be dropped, which is the honest answer to
 * a dump we cannot place.
 */
export function equippedHosts(dump: InventoryDump): InventoryHost[] {
  const out: InventoryHost[] = []
  const filled = new Set<PlanSlotId>()
  for (const entry of walkEntries(dump.items)) {
    const slot = equippedSlot(entry)
    if (slot === null) continue
    const cell = cellsForSlot(slot).find((c) => !filled.has(c))
    if (cell === undefined) continue
    filled.add(cell)
    const parsed = parseItemName(entry.name)
    const host: InventoryHost = { slot: cell, name: parsed.base }
    if (parsed.tier !== undefined) host.tier = parsed.tier
    out.push(host)
  }
  return out
}
