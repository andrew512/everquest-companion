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
// PURE: types plus a fold, no fs and no Electron, so both tsconfigs see it and the node runner
// drives it against the real 295-line dump (`tests/plannerInventory.test.mts`).

import { parseItemName, walkEntries, type InventoryDump, type InventoryEntry } from '../outputs/inventory'
import type { EquipLocationToken } from '../outputs/inventory'
import type { EquipSlot } from './types'

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
  slot: EquipSlot
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
 * The dump → what is equipped, one entry per planner slot.
 *
 * FIRST WINS, and that is the only rule the file supports: `Ear`, `Wrist`, `Fingers` and
 * `Any Slot` each appear TWICE at top level (two ears, two rings…) and there is no column saying
 * which is left. The planner plans one socket set per slot TYPE (R2, types.ts), so it takes the
 * first one the client wrote and never pretends to know about the second.
 */
export function equippedHosts(dump: InventoryDump): InventoryHost[] {
  const out: InventoryHost[] = []
  const seen = new Set<EquipSlot>()
  for (const entry of walkEntries(dump.items)) {
    const slot = equippedSlot(entry)
    if (slot === null || seen.has(slot)) continue
    seen.add(slot)
    const parsed = parseItemName(entry.name)
    const host: InventoryHost = { slot, name: parsed.base }
    if (parsed.tier !== undefined) host.tier = parsed.tier
    out.push(host)
  }
  return out
}
