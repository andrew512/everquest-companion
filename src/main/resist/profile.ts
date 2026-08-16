// The read side: a mob's resist card, and one axis's evidence drilldown (JOS-382).
//
// DERIVED ON DEMAND, ALWAYS. Nothing here is cached and nothing is stored: the ledger holds
// counts, and every number this file produces is a function of those counts plus the client's
// spell table. That is what makes a game patch — or simply the user playing for an evening —
// change the answer with no migration, no invalidation and no stale second opinion.
//
// TWO PRESENTATION DECISIONS LIVE HERE RATHER THAN IN THE MODEL, because they are about what a
// person should be shown and not about what is true:
//
//   R IS CLAMPED AT ZERO FOR DISPLAY. The estimator's grid runs down to -150 because rc does, and
//   a mob nothing has ever been resisted by fits anywhere below zero equally well. "R -150" is
//   noise on a card; "R 0" is the same statement in the reader's units. The INTERVAL is clamped
//   the same way and the underlying estimate is left alone.
//
//   A CELL UNDER `MIN_CELL_OBSERVATIONS` GETS NO NUMBER AND NO TAG, but it is never omitted. The
//   five axes are always five rows in the same order, because "we have not seen fire cast on this"
//   and "fire is fine" are different statements and a missing row says neither.

import { mobKey } from '../../shared/mobKey'
import {
  MIN_CELL_OBSERVATIONS,
  RESIST_AXES,
  type MobResistAxis,
  type MobResistCell,
  type MobResistProfile,
  type ResistAxis,
  type ResistEstimate,
  type ResistRow,
  type SpellResistTable,
} from '../../shared/resistTypes'
import { estimate, hasEnough, resistTag } from '../../shared/resistModel'
import { BASELINE_SOURCE_KEY } from '../../shared/resistTypes'
import type { MobLevelFact } from './world'

export interface ProfileDeps {
  /**
   * Every row anyone has filed about this creature, each tagged with its source. Takes the DISPLAY
   * NAME rather than a key, because one creature can have more than one name: the wiki page says
   * `Cazic Thule` and every line the game prints says `Cazic-Thule`, and the caller is the half
   * that knows the verified alias roster (world-model law 12).
   */
  rowsFor: (display: string) => ResistRow[]
  /** The client's spell table, or null when `spells_us.txt` could not be read. */
  spells: () => SpellResistTable | null
  /** The mob's level: a `/con` this session beats the catalog beats nothing. */
  levelOf: (key: string, display: string) => MobLevelFact | null
  /**
   * Spells whose landings are not observable, decided over the WHOLE ledger rather than over one
   * mob's rows (resistModel.ts `unobservableSpells` states why the scope matters).
   */
  unobservable: () => ReadonlySet<string>
  frozenAt: () => string | null
}

/** Display clamp. See the header: the model may go below zero; a card may not. */
function clampFit(est: ResistEstimate): ResistEstimate {
  return {
    ...est,
    R: Math.max(0, est.R),
    lo: Math.max(0, est.lo),
    hi: Math.max(0, est.hi),
    baselineFit: est.baselineFit
      ? { ...est.baselineFit, R: Math.max(0, est.baselineFit.R), lo: Math.max(0, est.baselineFit.lo), hi: Math.max(0, est.baselineFit.hi) }
      : null,
    userFit: est.userFit
      ? { ...est.userFit, R: Math.max(0, est.userFit.R), lo: Math.max(0, est.userFit.lo), hi: Math.max(0, est.userFit.hi) }
      : null,
  }
}

function axisRow(
  rows: readonly ResistRow[],
  spells: SpellResistTable,
  axis: ResistAxis,
  ctx: { mobLevel: number | null; unobservable: ReadonlySet<string> }
): MobResistAxis {
  const est = clampFit(estimate(rows, spells, { axis, mobLevel: ctx.mobLevel, unobservable: ctx.unobservable }))
  return {
    axis,
    estimate: est,
    tag: hasEnough(est.n) ? resistTag(est.R) : null,
    n: est.n,
  }
}

/** The Resists card for one mob. Always five axis rows, always in `RESIST_AXES` order. */
export function mobResistProfile(displayName: string, deps: ProfileDeps): MobResistProfile {
  const key = mobKey(displayName)
  const spells = deps.spells()
  const rows = deps.rowsFor(displayName)
  const fact = deps.levelOf(key, displayName)
  const level = fact ? { lo: fact.lo, hi: fact.hi, from: fact.from } : null
  const ctx = { mobLevel: fact?.level ?? null, unobservable: deps.unobservable() }
  const axes = spells
    ? RESIST_AXES.map((axis) => axisRow(rows, spells, axis, ctx))
    : RESIST_AXES.map((axis) => ({ axis, estimate: null, tag: null, n: 0 }) satisfies MobResistAxis)
  return {
    mobKey: key,
    displayName,
    level,
    axes,
    spellDataAvailable: spells !== null,
    baselineFrozenAt: deps.frozenAt(),
  }
}

/**
 * One axis's evidence. The rows are returned as they were filed — the renderer shows per-spell
 * lines built by the estimator, and this is what a future export or a bug report would carry.
 */
export function mobResistCell(
  displayName: string,
  axis: ResistAxis,
  deps: ProfileDeps
): MobResistCell | null {
  const spells = deps.spells()
  if (!spells) return null
  const key = mobKey(displayName)
  const rows = deps.rowsFor(displayName)
  const fact = deps.levelOf(key, displayName)
  const est = clampFit(
    estimate(rows, spells, { axis, mobLevel: fact?.level ?? null, unobservable: deps.unobservable() })
  )
  const keep = rows.filter((r) => spells[r.spellKey]?.axis === axis)
  return { mobKey: key, axis, estimate: est, rows: keep }
}

/** What the profile builder needs from the ledger, spelled once. */
export const BASELINE_KEY = BASELINE_SOURCE_KEY

/** Whether a cell has enough behind it to draw a number. Re-exported for the renderer's benefit. */
export const MIN_OBSERVATIONS = MIN_CELL_OBSERVATIONS
