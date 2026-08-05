// planner/types.ts — the EXALTATION PLANNER's shared data model (docs/plans/exaltation-planner.md §3.1).
//
// A plan is "which effects do I want socketed where, and which donor item do I farm for each".
// The types here are the seam between three owners: main builds `PlannerDonor` rows out of the
// committed item DB, the renderer edits `ExaltPlan`s, and the store persists them per character.
// Pure types + the pure modules beside them (normalize.ts, rules.ts) — zero runtime deps, so the
// node test runner imports them directly and both tsconfigs see the same file.
//
// Load-bearing constraints encoded here:
//   * EquipSlot is CLOSED and MEASURED. The 18 members are exactly the distinct equip slots the
//     committed corpus states (11,155 item pages, 32 raw tokens → 18 canonical; see normalize.ts).
//     There is deliberately NO CHARM: zero pages in the corpus name one, and a slot no item can
//     ever occupy would render as a permanently empty cell claiming a game fact we never observed.
//   * SocketType omits Ornamentation (R5 — cosmetic, token-gated, not in game) and folds
//     `kind:'combat'` into 'proc' (D2 — the wiki spells procs `Combat Effect:`; measured
//     proc 0 / combat 453).
//   * Empty arrays mean UNKNOWN, never "none" (law 1). A donor with `classes: []` is a donor
//     whose page did not state a usable class list — the UI says so, it does not assume ALL.

import type { ClassAbbr } from '../classCombo'

/**
 * Canonical equipment slots, normalized from the dirty wiki tokens (normalize.ts owns the
 * variant table). One PlanSlot per slot TYPE: FINGER/EAR/WRIST are worn in pairs in game, but
 * exaltation compatibility is per-type (R2), so v1 plans one of each (design §3.1).
 */
export type EquipSlot =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'RANGE'
  | 'AMMO'
  | 'HEAD'
  | 'FACE'
  | 'EAR'
  | 'NECK'
  | 'SHOULDERS'
  | 'BACK'
  | 'CHEST'
  | 'ARMS'
  | 'WRIST'
  | 'HANDS'
  | 'FINGER'
  | 'WAIST'
  | 'LEGS'
  | 'FEET'

/** Every equip slot, in character-sheet order (Board mode's grid order). */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'HEAD',
  'FACE',
  'EAR',
  'NECK',
  'SHOULDERS',
  'BACK',
  'CHEST',
  'ARMS',
  'WRIST',
  'HANDS',
  'FINGER',
  'WAIST',
  'LEGS',
  'FEET',
  'PRIMARY',
  'SECONDARY',
  'RANGE',
  'AMMO'
]

/**
 * The four TRANSFERABLE socket types, in unlock order. Ornamentation is excluded on purpose
 * (R5): it is cosmetic, comes from a Marketplace token rather than a tier, and is not in game.
 */
export type SocketType = 'focus' | 'click' | 'worn' | 'proc'

/**
 * The four socket types as VALUES, in unlock order — the filter toggle's row, and the closed
 * allowlist main re-validates a renderer-supplied plan against (a union alone cannot do that at
 * runtime). Same arrangement as EQUIP_SLOTS above: one list, no second opinion.
 */
export const SOCKET_TYPES: readonly SocketType[] = ['focus', 'click', 'worn', 'proc']

/** The item tier a donor must be merged to before that socket's effect can be EXTRACTED (R1). */
export type ExtractTier = 1 | 2 | 3 | 4

/**
 * One effect as it exists on one donor item — the denormalized row main serves over IPC. An
 * item with three effects contributes three donors; the (key, effect) pair is the row identity.
 */
export interface PlannerDonor {
  /** `itemKey(name)` — the corpus's canonical, `+N`-stripped, case-folded key. */
  key: string
  name: string
  iconId?: number
  /** normalized equip slots; `[]` = the page stated none (quest/tradeskill oddities, non-equippable) */
  slots: EquipSlot[]
  /** normalized classes; `[]` = UNKNOWN (never "nobody"), 16 entries = ALL */
  classes: ClassAbbr[]
  /** effect name as written ("Improved Healing III") */
  effect: string
  /** the parenthetical as written ("Combat, Casting Time: Instant") */
  detail?: string
  /** which socket this effect occupies; `combat` folded to `proc` (D2) */
  socket: SocketType
  /** merge tier required to extract it (R1: focus +1, click +2, worn +3, proc +4) */
  tierRequired: ExtractTier
  /** R3 — haste never travels as an exaltation. Flagged, never hidden. */
  hasteLocked: boolean
  quest: boolean
  playerCrafted: boolean
  reqLevel?: number
}

/**
 * One row of the HOST PICKER's item search (`window.eq.plannerSearchItems`). Deliberately not a
 * `PlannerDonor`: a host is any equippable item, effect-bearing or not, and the picker only needs
 * enough to draw a row and decide slot/class compatibility. Built by src/main/planner/effectIndex.ts.
 */
export interface PlannerItemHit {
  /** `itemKey(name)` — the same key a PlannerDonor carries, so the two indices join */
  key: string
  name: string
  iconId?: number
  /** normalized equip slots; `[]` = the page stated none */
  slots: EquipSlot[]
  /** normalized classes; `[]` = UNKNOWN (never "nobody") */
  classes: ClassAbbr[]
}

/** A planned socket inside a set: the effect the user wants, and the donor they chose to farm. */
export interface PlanSocket {
  effect: string
  /** `PlannerDonor.key` — which donor item supplies it (an effect can have many donors) */
  donorKey: string
}

/** One equipment slot of a plan: an optional host item plus up to one socket of each type. */
export interface PlanSlot {
  /** `itemKey(name)` of the host item; absent = the user hasn't picked one yet */
  hostKey?: string
  hostName?: string
  sockets: Partial<Record<SocketType, PlanSocket>>
}

/** A named exaltation set. Persisted per character under `ProgressState.exaltPlans` (D4). */
export interface ExaltPlan {
  /** `crypto.randomUUID()` — stable across renames, the React key and the CRUD handle */
  id: string
  name: string
  /** the target loadout this set is built for (D5); 1–3 classes, defaulting to the inferred combo */
  classes: ClassAbbr[]
  createdAt: number
  updatedAt: number
  slots: Partial<Record<EquipSlot, PlanSlot>>
}
