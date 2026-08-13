// planner/gearSetTotals.ts — WHAT A SET ADDS UP TO, and how it compares to what you are wearing
// (JOS-286, phase 5 of the gear planner).
//
// ============================================================================
// THE SUM IS `sumGear`'s, AND THE UPLIFT IS PHASE 0's. NEITHER IS RESTATED HERE.
// ============================================================================
// `shared/characterSheet.ts sumGear` is this repo's ONE answer to "what do these worn items add
// up to" (JOS-45). It already owns the ordering, the END/ENDURANCE folding, the saves split, the
// unknown-item count and — the load-bearing one — THE REFUSAL TO SUM PERCENTAGES. So this file
// does not add anything up. It builds one `ItemStatBlock` per assignment and hands the array over.
//
// WHAT IS NEW IS THE ONE THING `sumGear` DELIBERATELY WOULD NOT DO. Its header states the refusal
// verbatim: it does not apply the ` +N` item-level uplift, and since JOS-281 the reason is not
// that the arithmetic is unknown (`scaleStatBlock` is the exact port of the wiki's own
// calculator) but that an inventory dump is EVIDENCE-POOR — it names an item, and only a ` +N`
// suffix says what state it is in. The sentence it closes with is "wiring it in is the Gear
// planner's job, not this sum's", and this file is that job: a set assignment STATES its own
// plus-state (`GearAssignment.state`, the per-item slider), so the evidence exists here and
// nowhere else. The character sheet's own totals are untouched.
//
// THE PERCENT REFUSAL SURVIVES BY CONSTRUCTION, not by being re-decided. `HASTE` is the one
// percent-valued key in the vector census (gear.ts), and it is spelled back out as `+41%` — so
// `sumGear`'s `statInteger` refuses it exactly as it refuses the two haste items in the owner's
// real dump, and it lands in `GearTotals.unsummed` as the individual values. Whether worn haste
// stacks is a game rule no source in this repo states (law 6); a set that quietly totalled it
// would be inventing one. The surface KEEPS that list visible.
//
// ============================================================================
// THE SPELLING TABLE, AND WHY IT IS SAFE
// ============================================================================
// The gear index carries a NUMERIC VECTOR keyed by `normalizeStatKey`'s spelling (MANA → MP,
// REGEN → HP_REGEN — gear.ts states why), and `sumGear` reads `{key, value}` TEXT rows keyed the
// way the wiki writes them, because `statLabel` is what turns a key into a word. So the vector has
// to be spelled back out, and a spelling table is exactly the kind of second alias list this repo
// refuses to keep. It is kept HONEST rather than avoided: every entry is asserted to fold back to
// its own key through PHASE 0's `normalizeStatKey` (`tests/gearSet.test.mts`), so the table can
// never drift from the alias table it is the inverse of — a key added to `GEAR_STAT_KEYS` with no
// spelling here turns that test red rather than silently dropping a stat out of every total.

import { sumGear, type GearStat, type GearTotals } from '../characterSheet'
import { statLabel, type ItemStat, type ItemStatBlock } from '../itemStats'
import { ITEM_UPGRADE_BASE, normalizeUpgradeState, type ItemUpgradeState } from '../itemUpgrade'
import { GEAR_PERCENT_STAT_KEYS, type GearRow, type GearStatKey, type GearStats } from './gear'
import { scaleGearStats } from './gearScale'
import { filledCells, type GearAssignment, type GearSet } from './gearSet'
import type { PlanSlotId } from './types'

// ---- the vector, spelled the way an item page spells it --------------------------------------

/**
 * The six keys that are STRUCTURAL fields of an `ItemStatBlock` rather than `KEY: value` rows —
 * so they are never `stats` entries, and `sumGear` (which sums `ac`, `stats` and `saves` only)
 * never sees them. That is the right answer and not an omission: a set's total DMG is not a
 * number anybody wears, and the per-cell numbers state each weapon's own.
 */
const STRUCTURAL_KEYS: readonly GearStatKey[] = ['DMG', 'DELAY', 'DMG_BONUS', 'BACKSTAB', 'RANGE', 'WEIGHT']

const STRUCTURAL_SET: ReadonlySet<string> = new Set<string>(STRUCTURAL_KEYS)
const PERCENT_SET: ReadonlySet<string> = new Set<string>(GEAR_PERCENT_STAT_KEYS)

/**
 * Vector key → the key an item page writes, for the twenty-five keys that become `{key, value}`
 * rows. `AC` is absent because it is `ItemStatBlock.ac`, a number of its own, and the six
 * structural keys are absent for the reason above.
 *
 * Every entry folds back to its own key through `normalizeStatKey` — the test asserts it.
 */
export const GEAR_STAT_SPELLING: Partial<Record<GearStatKey, string>> = {
  STR: 'STR',
  STA: 'STA',
  AGI: 'AGI',
  DEX: 'DEX',
  WIS: 'WIS',
  INT: 'INT',
  CHA: 'CHA',
  HP: 'HP',
  MP: 'MANA',
  END: 'END',
  HP_REGEN: 'Regen',
  MANA_REGEN: 'Mana Regen',
  END_REGEN: 'End Regen',
  ATTACK: 'Attack',
  HASTE: 'Haste',
  SV_FIRE: 'SV FIRE',
  SV_COLD: 'SV COLD',
  SV_MAGIC: 'SV MAGIC',
  SV_DISEASE: 'SV DISEASE',
  SV_POISON: 'SV POISON',
  SV_VOID: 'SV VOID',
  SV_CORRUPTION: 'SV CORRUPTION',
  SV_CHROMATIC: 'SV CHROMATIC',
  SV_PRISMATIC: 'SV PRISMATIC',
  SV_ALL: 'SV ALL'
}

/** `15` → `+15`, `-3` → `-3`, and a percent key carries its unit — which is what gets it refused. */
function statValueText(key: GearStatKey, value: number): string {
  const body = value > 0 ? `+${String(value)}` : String(value)
  return PERCENT_SET.has(key) ? `${body}%` : body
}

/**
 * A SCALED vector as an `ItemStatBlock`, which is the only shape `sumGear` reads.
 *
 * The block is deliberately thin: flags, classes, effects and sockets are not part of a total and
 * carrying them would invite somebody to sum those too. `ac` and the two row lists are the whole
 * contribution, and the structural numbers ride along as the fields they belong in so the block
 * is a truthful description of the item rather than a fold input in disguise.
 */
/** The `{key, value}` rows, split into the two lists the item window splits them into. */
function statRows(stats: GearStats): { stats: ItemStat[]; saves: ItemStat[] } {
  const rows: ItemStat[] = []
  const saves: ItemStat[] = []
  for (const [raw, value] of Object.entries(stats)) {
    const key = raw as GearStatKey
    if (value === undefined || key === 'AC' || STRUCTURAL_SET.has(key)) continue
    const spelling = GEAR_STAT_SPELLING[key]
    if (spelling === undefined) continue
    ;(key.startsWith('SV_') ? saves : rows).push({ key: spelling, value: statValueText(key, value) })
  }
  return { stats: rows, saves }
}

export function statBlockFromVector(stats: GearStats): ItemStatBlock {
  const { stats: rows, saves } = statRows(stats)
  const block: ItemStatBlock = { flags: [], stats: rows, saves, effects: [], exaltationSlots: [], extras: [] }
  if (stats.AC !== undefined) block.ac = stats.AC
  if (stats.DMG !== undefined) block.dmg = stats.DMG
  if (stats.DELAY !== undefined) block.atkDelay = stats.DELAY
  if (stats.DMG_BONUS !== undefined) block.dmgBonus = stats.DMG_BONUS
  if (stats.BACKSTAB !== undefined) block.backstab = stats.BACKSTAB
  if (stats.WEIGHT !== undefined) block.weight = stats.WEIGHT.toFixed(1)
  return block
}

/**
 * ONE ASSIGNMENT'S CONTRIBUTION: its corpus row, scaled to ITS OWN plus-state, as a stat block.
 *
 * `scaleGearStats` is phase 0's arithmetic reached through phase 2's vector — including the
 * synthetic `SV VOID` line an upgrade grants (`GearRow.voidSynth`), which is why the totals of a
 * merged set can carry a save no base item states.
 */
export function assignmentBlock(row: GearRow, state: ItemUpgradeState): ItemStatBlock {
  return statBlockFromVector(scaleGearStats(row.stats, state, row.voidSynth === true))
}

/**
 * WHAT ONE CELL CONTRIBUTES, in the same words the totals row uses (`statLabel`, so "Strength"
 * here and "Strength" there — a cell that spelled it `STR` would read as a different quantity).
 *
 * AC leads because it is the one attribute the block stores as a number of its own, and it is the
 * number a wearer reads first. Percent-valued rows are IN this list and carry their `%`: a cell
 * states what the item says even though the totals refuse to add it up, which is precisely the
 * distinction `GearTotals.unsummed` exists to draw.
 */
export function assignmentStats(block: ItemStatBlock): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  if (block.ac !== undefined) out.push({ label: 'AC', value: statValueText('AC', block.ac) })
  for (const row of [...block.stats, ...block.saves]) out.push({ label: statLabel(row.key), value: row.value })
  return out
}

// ---- the totals -------------------------------------------------------------------------------

/** How a caller resolves an assignment's `key` to its corpus row. `undefined` = the corpus has none. */
export type GearRowLookup = (key: string) => GearRow | undefined

/**
 * THE SET'S TOTALS. One block per filled cell, in board order, handed to `sumGear`.
 *
 * An assignment whose key the corpus cannot resolve contributes `undefined` — which `sumGear`
 * already counts as `unknown` and adds to nothing, and which the pane states out loud. That is
 * the same honesty the character sheet applies to `Djarn's Amethyst Ring`, reached by the same
 * route rather than by a second convention.
 */
export function gearSetTotals(set: GearSet, lookup: GearRowLookup): GearTotals {
  return sumGear(filledCells(set).map(({ assignment }) => {
    const row = lookup(assignment.key)
    return row === undefined ? undefined : assignmentBlock(row, assignment.state)
  }))
}

// ---- what you are actually wearing --------------------------------------------------------------

/** One equipped row as the diff needs it — `PlannerInventoryHost`, structurally. */
export interface EquippedHost {
  slot: PlanSlotId
  name: string
  key: string
  /** the ` +N` the dump's item name stated; ABSENT means it stated none, never tier 0 */
  tier?: number
}

/** The equipped loadout read as a set, plus the one thing the dump could not say. */
export interface EquippedRead {
  set: GearSet
  /**
   * How many worn items carried NO ` +N` suffix and are therefore read AT BASE.
   *
   * The dump states a tier only when the name carries one (`inventorySlots.ts`: absent means the
   * name said nothing, NOT tier 0), so reading those at base is a choice this app makes and the
   * pane says so. It is the right direction: an unmerged item prints no suffix, so base is what
   * the common case actually is, and a comparison that refused to read them at all would answer
   * nothing for a character who has merged one item.
   */
  unstated: number
}

/**
 * WHAT IS ON THE CHARACTER RIGHT NOW, as a set the same totals fold can read.
 *
 * The hosts come from `shared/planner/inventorySlots.ts equippedHosts` — the one reader of the
 * game's own `/outputfile inventory` dump, cells and all (both ears, both rings, both any-slots),
 * joined to `itemKey` in main. Nothing here re-decides which row is worn.
 */
export function equippedRead(hosts: readonly EquippedHost[], now = 0): EquippedRead {
  const slots: Partial<Record<PlanSlotId, GearAssignment>> = {}
  let unstated = 0
  for (const host of hosts) {
    if (host.tier === undefined) unstated += 1
    slots[host.slot] = {
      key: host.key,
      name: host.name,
      state:
        host.tier === undefined
          ? ITEM_UPGRADE_BASE
          : normalizeUpgradeState({ full: host.tier, fraction: 0 })
    }
  }
  return { set: { id: 'equipped', name: 'Equipped', createdAt: now, updatedAt: now, slots }, unstated }
}

// ---- the diff -----------------------------------------------------------------------------------

/** One stat, both ways round. `delta` is the set MINUS what is worn — the number a planner reads. */
export interface GearDiffRow {
  label: string
  set: number
  equipped: number
  delta: number
}

/** The whole comparison. `unsummed` is NOT diffed — see `gearSetDiff`. */
export interface GearSetDiff {
  ac: GearDiffRow
  stats: GearDiffRow[]
  saves: GearDiffRow[]
  /** rows whose delta is not zero — the count the summary line states */
  changed: number
  /** cells the set fills that the character is not wearing the same item in */
  cellsChanged: number
}

function rowsOf(stats: readonly GearStat[]): Map<string, number> {
  return new Map(stats.map((s) => [s.label, s.total]))
}

/**
 * The labels of both sides, in the SET's order first and the worn-only ones appended. `sumGear`
 * already ordered each side (`STAT_ORDER`, then alphabetical), so this preserves the reading order
 * a player already knows from the character sheet instead of imposing a third one.
 */
function mergedLabels(set: readonly GearStat[], equipped: readonly GearStat[]): string[] {
  const out = set.map((s) => s.label)
  for (const s of equipped) if (!out.includes(s.label)) out.push(s.label)
  return out
}

function diffRows(set: readonly GearStat[], equipped: readonly GearStat[]): GearDiffRow[] {
  const a = rowsOf(set)
  const b = rowsOf(equipped)
  return mergedLabels(set, equipped).map((label) => {
    const mine = a.get(label) ?? 0
    const worn = b.get(label) ?? 0
    return { label, set: mine, equipped: worn, delta: mine - worn }
  })
}

/**
 * How many CELLS the plan would actually change. A cell the set leaves empty is not a change —
 * a set is a plan for the cells it names, and reading an empty cell as "take that off" would turn
 * every half-finished set into a proposal to strip the character.
 *
 * The plus-state counts: planning the sword you are already wearing at +7 when it is at +5 IS a
 * change, and it is the change a merge plan is made of.
 */
function sameAssignment(a: GearAssignment, b: GearAssignment): boolean {
  return a.key === b.key && a.state.full === b.state.full && a.state.fraction === b.state.fraction
}

function changedCells(set: GearSet, equipped: GearSet): number {
  return filledCells(set).filter(({ cell, assignment }) => {
    const worn = equipped.slots[cell]
    return worn === undefined || !sameAssignment(worn, assignment)
  }).length
}

/**
 * THE SET AGAINST THE BODY. Every summable row on either side, with the delta.
 *
 * THE UNSUMMED LIST IS NOT DIFFED, and that is the percent refusal again rather than an omission:
 * subtracting `+36%` from `+21%` would be arithmetic on values this repo has already said it
 * cannot add. Both sides' unsummed lists stay visible, side by side, and the reader decides.
 */
export function gearSetDiff(
  totals: { set: GearTotals; equipped: GearTotals },
  sets: { set: GearSet; equipped: GearSet }
): GearSetDiff {
  const ac: GearDiffRow = {
    label: 'AC',
    set: totals.set.ac,
    equipped: totals.equipped.ac,
    delta: totals.set.ac - totals.equipped.ac
  }
  const stats = diffRows(totals.set.stats, totals.equipped.stats)
  const saves = diffRows(totals.set.saves, totals.equipped.saves)
  const changed = [ac, ...stats, ...saves].filter((r) => r.delta !== 0).length
  return { ac, stats, saves, changed, cellsChanged: changedCells(sets.set, sets.equipped) }
}
