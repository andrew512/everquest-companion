// The Resists card's arithmetic and its sentences, separated from its JSX (JOS-382).
//
// Pure, and imported by relative path in the tests, because this repo has no jsdom and no React
// test renderer: the DERIVATION is unit-tested here (`tests/resistRow.test.mts`) and the JSX is
// asserted by the e2e harness against the real app. Same split as `features/mobs/dropEra.ts`.
//
// EVERY SENTENCE IN THIS FILE IS COPY, so it obeys the copy rules: no em dashes, no acronyms, and
// no caption explaining our own bookkeeping. A row says what the log saw, and where a row has too
// little it says how little rather than drawing a zero.

import type { ResistEstimate, ResistSpellEvidence } from '@shared/resistTypes'

/**
 * The bar runs 0 to 200 because that is the whole range of the roll: at rc 200 an all-or-nothing
 * spell never lands, which is the top of what the bar can usefully say. Past it a mob is in the
 * partial-only band and the bar pins full - the NUMBER beside it carries the rest.
 */
export const BAR_MAX = 200

/** Fraction of the bar a value fills, clamped into [0, 1]. */
export function barFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value >= BAR_MAX ? 1 : value / BAR_MAX
}

/** The interval band's left edge and width as bar fractions. */
export function bandFraction(lo: number, hi: number): { left: number; width: number } {
  const left = barFraction(lo)
  const right = barFraction(hi)
  return { left, width: Math.max(right - left, 0) }
}

/** `R 126 (110-144)`. The interval is never hidden - it is the honest half of the number. */
export function estimateText(est: ResistEstimate): string {
  return `R ${String(est.R)} (${String(est.lo)}-${String(est.hi)})`
}

/** `n=600`. Always printed beside the number, at every sample size. */
export function countText(n: number): string {
  return `n=${String(n)}`
}

/** The grey row a thin cell draws instead of a number. Never omitted, never a zero. */
export function notEnoughText(n: number): string {
  return `not enough data (n=${String(n)})`
}

/**
 * `baseline 480 + you 120` - where the evidence came from, said on the row rather than in a
 * legend, because the answer changes per axis and a legend would be wrong for four of five rows.
 * Null when one side has nothing: "baseline 480 + you 0" is noise.
 */
export function splitText(est: ResistEstimate): string | null {
  if (est.fromBaseline > 0 && est.fromYou > 0) {
    return `baseline ${String(est.fromBaseline)} + you ${String(est.fromYou)}`
  }
  if (est.fromYou > 0) return `you ${String(est.fromYou)}`
  if (est.fromBaseline > 0) return `baseline ${String(est.fromBaseline)}`
  return null
}

/**
 * The note that IS the patch detector: both sides well populated, intervals that do not overlap.
 * It states the disagreement and does nothing about it - the user's own log already outweighs the
 * shipped data by then, and a self-correcting file would hide the very thing worth seeing.
 */
export const DIFFERS_NOTE = 'differs from shipped data'

/** Once your own log stands alone, the shipped number is a reference marker and says so. */
export const USER_ONLY_NOTE = 'your log only'

/**
 * The ledger keys spells canonically (lowercased, rank stripped), which is right for joining and
 * wrong for reading. Title-cased back for display; the rank is genuinely gone, and that is the
 * point - `Scorching Arrow IV` and `Scorching Arrow` are one spell to this model.
 */
export function spellDisplayName(key: string): string {
  return key.replace(/(^|[\s'`-])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
}

/**
 * `Chaos Flux: 155 casts, 17 resisted, 61 partial`. Only the clauses that have a number appear -
 * a spell with no partials does not get "0 partial", because zero partials and no partial
 * information are different things and only one of them is worth a word.
 */
export function evidenceText(ev: ResistSpellEvidence): string {
  const parts = [`${String(ev.casts)} cast${ev.casts === 1 ? '' : 's'}`]
  if (ev.resisted > 0) parts.push(`${String(ev.resisted)} resisted`)
  if (ev.partial > 0) parts.push(`${String(ev.partial)} partial`)
  return `${spellDisplayName(ev.spellKey)}: ${parts.join(', ')}`
}

/** Songs are their own line, with their own counts, so they can be judged on their own. */
export function songSummary(est: ResistEstimate): string | null {
  const fam = est.byFamily.song
  if (fam.n === 0) return null
  return `Songs: ${String(fam.n)} pulses, ${String(fam.resist)} resisted`
}

/** Evidence lines split by family, most-cast first (the estimator already sorted them). */
export function evidenceByFamily(est: ResistEstimate): {
  casts: ResistSpellEvidence[]
  songs: ResistSpellEvidence[]
} {
  return {
    casts: est.perSpell.filter((e) => e.family === 'cast'),
    songs: est.perSpell.filter((e) => e.family === 'song'),
  }
}
