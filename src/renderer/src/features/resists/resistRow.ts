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

/**
 * `R 126 (110-144)`. The interval is never hidden - it is the honest half of the number.
 *
 * It takes the THREE FIELDS it reads rather than a whole `ResistEstimate` (JOS-383): the con card
 * over the game is fed by main and carries the numbers without the evidence behind them, and it has
 * to print this exact sentence. One derivation, two surfaces - a second `R %d (%d-%d)` written in
 * the overlay is precisely how the two would come to disagree about a dash.
 */
export function estimateText(est: Pick<ResistEstimate, 'R' | 'lo' | 'hi'>): string {
  return `R ${String(est.R)} (${String(est.lo)}-${String(est.hi)})`
}

/**
 * `n=600`, or `n=8 informative · 83 total` when a cell's casts were mostly of spells that could
 * never have been resisted (JOS-385).
 *
 * ONE SENTENCE, TWO SURFACES. The mob page row and the con card chip both print this, so the two
 * cannot come to disagree about how much this app knows — which is exactly the disagreement the
 * defect created: the owner's thunder spirit princess said `n=83` while eight of those casts were
 * the only ones that tested anything.
 *
 * BOTH NUMBERS, never one. Dropping the total would hide real work the app did (the procs landed,
 * and that they landed is worth seeing); dropping the informative count is the defect. The word
 * "informative" is doing the explaining and the drilldown says which spells they were.
 */
export function countText(nInformative: number, nTotal = nInformative): string {
  if (nInformative === nTotal) return `n=${String(nTotal)}`
  return `n=${String(nInformative)} informative · ${String(nTotal)} total`
}

/**
 * What an EMPTY cell says (owner ruling, 2026-08-16). Two words, and it is the only case left where
 * a number is withheld: nothing has ever been observed on this axis for this creature, so there is
 * nothing to be uncertain ABOUT.
 *
 * It replaces `not enough data (n=2)`, which used to stand in for the answer at anything under five
 * observations. The ruling is that the answer is always shown; a thin cell reports in full and
 * wears `LOW_SAMPLE_NOTE` beside it.
 */
export const NO_DATA_TEXT = 'no data'

/**
 * The quieter caveat a thin cell wears BESIDE its answer — never instead of it.
 *
 * It carries no count of its own on purpose: every surface that prints this already prints `n=3`
 * within a few pixels of it (the mob page in its own column, the con card on the line underneath),
 * and saying the same number twice on one row reads as two different numbers at a glance.
 */
export const LOW_SAMPLE_NOTE = 'low samples'

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
 *
 * ONLY AT A WORD BOUNDARY, and a POSSESSIVE IS NOT ONE. EQ spell names are thick with them
 * ("Denon's Disruptive Discord", "Largo's Absonant Binding", and the backtick spelling the game
 * also uses), and capitalising after the apostrophe turns every one of them into "Denon'S".
 *
 * AND THE SMALL WORDS STAY SMALL unless they lead: EQ writes "Condemnation of Nife" and "Strength
 * of Stone", never "Condemnation Of Nife". Title case is a convention about English, so its
 * exceptions are English's.
 */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'to', 'a', 'an', 'for'])

export function spellDisplayName(key: string): string {
  return key
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.replace(/(^|-)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    )
    .join(' ')
}

/**
 * `Chaos Flux: 155 casts, 17 resisted, 61 partial`. Only the clauses that have a number appear -
 * a spell with no partials does not get "0 partial", because zero partials and no partial
 * information are different things and only one of them is worth a word.
 */
/**
 * A spell every one of whose observations is a resist. Not a mob that resists everything - a spell
 * whose landings this app cannot see, so its rows are shown and deliberately not counted.
 */
export const NOT_OBSERVABLE_NOTE = 'landings not observable'

/**
 * A spell whose resist adjust puts it out of reach of any resist roll (JOS-385). Said on its own
 * line rather than in a legend, and said QUIETLY: the casts are real and they are shown, they just
 * cannot be evidence about this mob. The number is in it because the adjust is the reason, and a
 * reader who knows the game will recognise -250 as a proc immediately.
 */
export function cannotBeResistedNote(resistAdj: number): string {
  return `cannot be resisted at this level: ${String(resistAdj)} adjust`
}

export function evidenceText(ev: ResistSpellEvidence): string {
  const parts = [`${String(ev.casts)} cast${ev.casts === 1 ? '' : 's'}`]
  if (ev.resisted > 0) parts.push(`${String(ev.resisted)} resisted`)
  if (ev.partial > 0) parts.push(`${String(ev.partial)} partial`)
  // Say WHY it is not in the number, on the very line the number is missing from.
  if (ev.landingsNotObservable === true) parts.push(NOT_OBSERVABLE_NOTE)
  if (!ev.informative) parts.push(cannotBeResistedNote(ev.resistAdj))
  return `${spellDisplayName(ev.spellKey)}: ${parts.join(', ')}`
}

/** Songs are their own line, with their own counts, so they can be judged on their own. */
export function songSummary(est: ResistEstimate): string | null {
  const fam = est.byFamily.song
  if (fam.n === 0) return null
  return `Songs: ${String(fam.n)} pulses, ${String(fam.resist)} resisted`
}

/**
 * What charmed pets and other creatures contributed on this axis, and whether it counted (JOS-385).
 *
 * IT SAYS SO EITHER WAY, and that is the point of printing it at all. A family the user has
 * switched off is still something the log saw, and a line that vanished when the switch moved
 * would make the preference look like it deleted evidence rather than declining to weigh it. So
 * the count is the same sentence in both states and the parenthesis carries the difference.
 *
 * Null when nothing was cast by one, which is most mobs: an evidence line with a zero on it is
 * noise, and "no pet ever cast on this" is not a fact anybody came to the page for.
 */
export const NPC_NOT_INCLUDED_NOTE = 'not included'

export function npcCasterSummary(est: ResistEstimate): string | null {
  const by = est.byCaster.npc
  if (!by || by.n === 0) return null
  const tail = est.npcIncluded ? '' : ` (${NPC_NOT_INCLUDED_NOTE})`
  return `Pets and other creatures: ${String(by.n)} casts, ${String(by.resist)} resisted${tail}`
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
