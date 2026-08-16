// RESIST ESTIMATION — the pure math (JOS-382, docs/plans/resist-mining.md section 4.3).
//
// No Electron, no node, no React. Unit-tested against SYNTHETIC ROLLS in
// tests/resistModel.test.mts: the test simulates the Live formula for known R, level gaps,
// resist adjusts and debuffs, feeds the resulting rows back through `estimate()`, and asserts the
// true R lands inside the reported interval. A model that cannot recover a number it generated
// itself has no business estimating one off the log.
//
// THE FORWARD MODEL IS NEXT DOOR, in `resistFormula.ts` — levelMod, the three roll probabilities,
// `predict` and the plain-language tag. That file is what the game does with a roll; this one is
// the inversion of it, and the two were one file until JOS-385 pushed the pair past the repo's
// 400-code-line ceiling (the rule there is split, never ratchet).
//
// ---------------------------------------------------------------------------------------------
// WHY THREE LIKELIHOODS AND NOT ONE. The log prints three genuinely different things and each
// one localises R differently. An all-or-nothing spell is a clean Bernoulli on rc/200 — the most
// informative evidence there is, and the cheapest to get wrong if a level or a debuff is
// unknown. A fixed-damage nuke additionally distinguishes "full" from "silently reduced", which
// pins rc from BOTH sides at once (the full rate and the resist-message rate are different
// functions of rc, so their agreement is a free consistency check — section 3's two-family table
// is that check run by hand). A variable-damage proc can only ever say "message or no message",
// which is rc/600 and nothing else.
//
// MISCLASSIFYING A FIXED SPELL AS VARIABLE IS SAFE; THE REVERSE IS NOT. P(resist message) is
// rc/600 either way, so treating fixed-damage evidence as variable merely throws the partial
// information away. Treating a genuinely variable spell as fixed reads its ordinary low rolls as
// "partials" and invents resistance out of a damage range. Hence `damageKind()` below demands
// BOTH that the client's spell data shows a hitpoint slot AND that the histogram's largest value
// is also its most common one — the shape a full-damage-plus-partials distribution always has
// and a random damage range never does.
//
// ---------------------------------------------------------------------------------------------
// THE PRIOR EXISTS SO FIVE OBSERVATIONS DO NOT SCREAM IMMUNE. Five resists out of five is a
// maximum-likelihood R of 200 ("nothing you cast will ever land"), which is a confident lie. A
// mild beta-binomial-style shrinkage toward Torven's typical NPC baselines (25 magic/fire/cold
// under level 25, 35 at 25+, 15 poison and disease) costs nothing once real evidence arrives —
// `PRIOR_OBSERVATIONS` is four pseudo-observations against cells that routinely carry hundreds —
// and keeps a thin cell honest. The interval is what the UI shows anyway.
//
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// AND ONE SPELL CAN POISON A WHOLE AXIS, SO THE ESTIMATOR CHECKS FOR IT (JOS-382, round 2).
//
// A binomial needs both outcomes. If every observation this app has of a spell is a RESIST — no
// landing, no damage number, nothing — then the maximum-likelihood answer is "rc is as large as
// the grid allows", and one such spell drags the whole axis to "nearly immune" however much honest
// evidence sits beside it. The cause is never a mob that resists everything; it is a spell whose
// LANDINGS we cannot see.
//
// MEASURED, and this is why the guard is general rather than a fix for one spell: the first
// shipped baseline carried Largo's Melodic Binding at 400 resists and 0 landings (a bard song
// under the Symphonic Aura, whose pulses print no cast line for the landing emote to join to) AND
// 'clumsiness strike' at 37 resists and 0 landings (a proc whose landing prints nothing at all).
// Two different causes, one shape. 'landingsNotObservable' is that shape: it is decided across the
// WHOLE ledger for the axis, so a mob that genuinely resisted every cast of a spell that lands
// elsewhere is untouched, and the rows stay in the per-spell drilldown saying exactly why.
//
// ---------------------------------------------------------------------------------------------
// YOUR OWN LOG BEATS THE FROZEN BASELINE (owner, 2026-08-16 — patch resilience). The shipped
// baseline is a snapshot of one player's four weeks; a future patch that retunes a mob makes it
// wrong, and the person who finds out first is the one fighting the mob. So a baseline
// observation is DOWN-WEIGHTED against the user's own: `wB = K/(K + nUser)` with K = 20, so at 20
// of your own observations the shipped data counts half, at 100 about 17%, and at
// `USER_ONLY_AT` = 50 it counts nothing at all and survives only as a faded reference marker.
// And when both sides are well populated (n >= 30 each) with 95% intervals that do not overlap,
// `differsFromShipped` goes true: that is the patch detector, and it is a statement about the
// DATA, never an automatic correction of it.

import {
  LOW_SAMPLE_BELOW,
  RESIST_CASTER_KINDS,
  type ResistAxis,
  type ResistCasterKind,
  type ResistEstimate,
  type ResistFamily,
  type ResistFit,
  type ResistRow,
  type ResistSpellEvidence,
  type SpellResistInfo,
  type SpellResistTable,
} from './resistTypes'
import {
  IMMUNE_LEVEL_MOD,
  isInformativeSpell,
  levelMod,
  pFullDamage,
  pResistAon,
  pResistMessage,
  priorResist,
} from './resistFormula'
import { damageKind, damageModeKey, damageModes, splitDamage } from './resistDamage'

/** Baseline down-weighting: one baseline observation weighs K/(K + nUser). */
export const BASELINE_K = 20
/** At this many of your own observations in a cell, the baseline stops counting entirely. */
export const USER_ONLY_AT = 50
/** Both sides need this much data before disagreeing about a mob means anything. */
export const DIFFERS_MIN_N = 30

/** Pseudo-observations of shrinkage toward the Torven prior. Deliberately mild. */
export const PRIOR_OBSERVATIONS = 4

/** Grid search bounds and step for R. Step 2 is the resolution every printed interval carries. */
export const R_MIN = -150
export const R_MAX = 600
export const R_STEP = 2

/** Profile-likelihood cut for a 95% interval: half a chi-square(1) quantile. */
export const DELTA_LOG_L = 1.92

/**
 * THE SMALLEST PROBABILITY ANY OUTCOME IS ALLOWED TO HAVE. The roll is a discrete 1..200, so an
 * outcome that the model says is impossible really is impossible — but a likelihood that answers
 * -infinity to one stray observation lets a single mis-parsed line decide the whole fit. A
 * half-count floor (0.5 / 200) is the standard regularisation and it costs nothing: it is applied
 * uniformly across every rc in an unidentifiable region, so a flat likelihood stays flat.
 */
const P_FLOOR = 1 / 400

/** log of a probability, floored at both ends. */
function lg(p: number): number {
  return Math.log(p < P_FLOOR ? P_FLOOR : p > 1 - P_FLOOR ? 1 - P_FLOOR : p)
}

type Term =
  | { kind: 'aon'; offset: number; resist: number; land: number; weight: number }
  | { kind: 'ddFix'; offset: number; full: number; partial: number; resist: number; weight: number }
  | { kind: 'ddVar'; offset: number; land: number; resist: number; weight: number }

function termLogL(term: Term, R: number): number {
  const rc = R + term.offset
  if (term.kind === 'aon') {
    const p = pResistAon(rc)
    return term.resist * lg(p) + term.land * lg(1 - p)
  }
  if (term.kind === 'ddVar') {
    const p = pResistMessage(rc)
    return term.resist * lg(p) + term.land * lg(1 - p)
  }
  const full = pFullDamage(rc)
  const msg = pResistMessage(rc)
  return term.full * lg(full) + term.partial * lg(1 - full - msg) + term.resist * lg(msg)
}

function totalLogL(terms: Term[], R: number): number {
  let sum = 0
  for (const t of terms) sum += t.weight * termLogL(t, R)
  return sum
}

/**
 * Grid maximum likelihood, plus a profile-likelihood 95% interval at delta-logL 1.92.
 *
 * THE NUMBER AND THE INTERVAL COME FROM DIFFERENT PLACES, AND THAT IS THE POINT. The interval is
 * computed from the EVIDENCE ALONE: it is the app's statement about what the log can and cannot
 * rule out, and a prior has no business narrowing or moving it. The printed number is the
 * shrunk estimate — evidence plus the Torven prior — because "five resists out of five" has a
 * maximum-likelihood answer of 200 that no honest UI should print.
 *
 * The split is also what keeps the estimator truthful at the model's two BOUNDARIES, which is
 * where a naive prior does real damage. Every rc at or below 0 predicts exactly the same thing
 * (nothing is ever resisted) and every rc at or above 200 predicts exactly the same thing for an
 * all-or-nothing spell (everything is), so in those regions the likelihood is FLAT and the honest
 * interval runs off the end of the grid. A prior evaluated inside the fit instead picks a point
 * out of that flat region and reports a tight interval around it — measured: it turned a mob with
 * 300 unresisted casts into "R = 2, interval [2, 2]", and a genuinely near-immune mob into
 * "R = 172" because the prior's pseudo-LANDINGS are impossible at rc >= 200 and it paid any price
 * to avoid them. Splitting the two answers fixes both, and the shrunk point is clamped into the
 * evidence's own interval so the two can never contradict each other on screen.
 */
function fitGrid(terms: Term[], prior: Term | null): { R: number; lo: number; hi: number } {
  const values: { R: number; ll: number; post: number }[] = []
  let best = -Infinity
  let bestPost = -Infinity
  let shrunkR = 0
  for (let R = R_MIN; R <= R_MAX; R += R_STEP) {
    const ll = totalLogL(terms, R)
    const post = prior ? ll + termLogL(prior, R) : ll
    values.push({ R, ll, post })
    if (ll > best) best = ll
    if (post > bestPost) {
      bestPost = post
      shrunkR = R
    }
  }
  const cut = best - DELTA_LOG_L
  let lo = R_MAX
  let hi = R_MIN
  for (const v of values) {
    if (v.ll < cut) continue
    if (v.R < lo) lo = v.R
    if (v.R > hi) hi = v.R
  }
  if (lo > hi) {
    lo = shrunkR
    hi = shrunkR
  }
  return { R: shrunkR < lo ? lo : shrunkR > hi ? hi : shrunkR, lo, hi }
}

/** The debuff amount one slot delivers on this axis at this caster level. */
function slotAmount(
  slot: { base: number; calc: number; max: number },
  level: number | null
): number {
  const base = Math.abs(slot.base)
  const max = Math.abs(slot.max)
  const lvl = level ?? 60
  let v = base
  if (slot.calc === 101) v = base + lvl / 2
  else if (slot.calc === 102) v = base + lvl
  if (max > 0 && v > max) v = max
  return v
}

/**
 * Total resist reduction on this axis from the debuffs the row recorded. The row stores WHICH
 * debuffs were up, never how much they were worth — the amount is a function of the client's
 * spell data and the caster's level, so a patch that retunes Malaise re-estimates instead of
 * re-folding. The debuff's own caster is not recorded, so the row's caster level stands in for
 * it; where that is unknown the slot's cap is used, which is what a max-level caster produces.
 */
export function debuffAmount(
  debuffs: string,
  axis: ResistAxis,
  level: number | null,
  spells: SpellResistTable
): number {
  if (debuffs === '') return 0
  let total = 0
  for (const key of debuffs.split('|')) {
    const slots = spells[key]?.debuffSlots
    if (!slots) continue
    for (const slot of slots) {
      if (slot.axis !== axis && slot.axis !== 'all') continue
      total += slotAmount(slot, level)
    }
  }
  return total
}

/** How many damage lines a row holds, whatever they were worth. */
function dmgTotalOf(row: ResistRow): number {
  let total = 0
  for (const count of Object.values(row.dmg)) total += count
  return total
}

/**
 * What one row is read against: the client's facts about its spell, the axis being asked about,
 * the table the debuff amounts come out of, and the full-damage reference for this spell at this
 * caster level. An OBJECT rather than four more positional parameters — the repo's `max-params`
 * ceiling is 4 and this is the fifth, but the real reason is that they are one context and read
 * better named.
 */
interface RowCtx {
  info: SpellResistInfo
  axis: ResistAxis
  spells: SpellResistTable
  /**
   * The full-damage reference for this (spell, caster level) over the whole ledger
   * (shared/resistDamage.ts). Undefined means the histogram could not name one, and the row is
   * then read as variable damage: resist-or-not, no partial information.
   */
  mode: number | undefined
}

/** One row -> one likelihood term, or null when the row cannot say anything about R. */
function rowTerm(row: ResistRow, ctx: RowCtx): Term | null {
  const { info, axis, spells, mode } = ctx
  if (row.casterLevel === null || row.mobLevel === null) return null
  const lm = levelMod(row.casterLevel, row.mobLevel)
  if (lm === IMMUNE_LEVEL_MOD) return null
  const offset = lm + info.resistAdj - debuffAmount(row.debuffs, axis, row.casterLevel, spells)
  const fixed = damageKind(row, info, mode) === 'ddFix'
  const { total, full, partial } = splitDamage(row, fixed ? mode : undefined)
  if (total === 0) {
    if (row.resist + row.land === 0) return null
    return { kind: 'aon', offset, resist: row.resist, land: row.land, weight: 1 }
  }
  if (fixed) return { kind: 'ddFix', offset, full, partial, resist: row.resist, weight: 1 }
  return { kind: 'ddVar', offset, land: total + row.land, resist: row.resist, weight: 1 }
}

/**
 * A row is evidence about `axis` only when the client's spell data says so, and only when the
 * game was not refusing it for a reason that has nothing to do with the mob's resist stat: a mez
 * that says "up to level 55" ALWAYS fails above 55, and filing that resist would invent a
 * magic-resistant mob out of a level cap (world-model law 1).
 */
function rowIsEvidence(row: ResistRow, info: SpellResistInfo | undefined, axis: ResistAxis): info is SpellResistInfo {
  if (info?.axis !== axis) return false
  if (info.levelCap !== undefined && row.mobLevel !== null && row.mobLevel > info.levelCap) return false
  return true
}

/**
 * THE PATCH DETECTOR. Both sides well populated, and 95% intervals that do not overlap: the log in
 * front of this user says something the shipped data does not, which is what a retuned mob looks
 * like. It is a statement about the DATA and never a correction of it - by the time it can fire,
 * the user's own observations already outweigh the baseline entirely.
 */
function differs(userFit: ResistFit | null, baselineFit: ResistFit | null): boolean {
  if (!userFit || !baselineFit) return false
  if (userFit.n < DIFFERS_MIN_N || baselineFit.n < DIFFERS_MIN_N) return false
  return disjoint(userFit, baselineFit)
}

function fitFrom(terms: Term[], axis: ResistAxis, mobLevel: number | null): ResistFit {
  const n = terms.reduce((acc, t) => acc + termN(t), 0)
  const { R, lo, hi } = fitGrid(terms, priorTerm(axis, mobLevel))
  return { R, lo, hi, n }
}

function priorTerm(axis: ResistAxis, mobLevel: number | null): Term {
  const p = pResistAon(priorResist(axis, mobLevel))
  return {
    kind: 'aon',
    offset: 0,
    resist: PRIOR_OBSERVATIONS * p,
    land: PRIOR_OBSERVATIONS * (1 - p),
    weight: 1,
  }
}

function termN(t: Term): number {
  if (t.kind === 'aon') return t.resist + t.land
  if (t.kind === 'ddVar') return t.resist + t.land
  return t.full + t.partial + t.resist
}

function disjoint(a: ResistFit, b: ResistFit): boolean {
  return a.hi < b.lo || b.hi < a.lo
}

export interface EstimateOpts {
  axis: ResistAxis
  /** The mob's level, only used to pick which Torven prior to shrink toward. */
  mobLevel?: number | null
  /** Songs are their own family precisely so they can be excluded from R in ONE place. */
  includeSongs?: boolean
  /**
   * Do charmed pets and NPC casters weigh in this number? (JOS-385, `shared/resistPrefs.ts`.)
   *
   * THE SWITCH LIVES HERE AND NOWHERE ELSE, which is the same argument `includeSongs` makes: the
   * ledger folds npc rows unconditionally, so the ONLY place the answer can change is the one line
   * below that decides whether such a row becomes a likelihood term. Their counts are tallied into
   * `byCaster` and their per-spell evidence into `perSpell` either way — a switched-off family is
   * still something the log saw.
   *
   * Defaults to TRUE when omitted, matching the shipped preference, so a unit test or a script
   * that says nothing gets the app's own behaviour.
   */
  includeNpcCasters?: boolean
  /**
   * Spells whose landings this app cannot see, decided over the WHOLE ledger by the caller. See
   * `unobservableSpells`; omitted, the estimator falls back to what `rows` alone can say, which is
   * right for a unit test and too narrow for a mob page.
   */
  unobservable?: ReadonlySet<string>
  /**
   * The full-damage reference per (spell, caster level), decided over the WHOLE ledger by the
   * caller (`shared/resistDamage.ts damageModes`). Omitted, the estimator falls back to what
   * `rows` alone can say — right for a unit test, and too narrow for a mob page, where a cell with
   * four hits would be asked to establish a reference the rest of the ledger already knows.
   */
  modes?: ReadonlyMap<string, number>
}

interface Prepared {
  terms: { term: Term; source: 'user' | 'baseline' }[]
  evidence: Map<string, ResistSpellEvidence>
  byFamily: Record<ResistFamily, { n: number; resist: number; land: number }>
  byCaster: Record<ResistCasterKind, { n: number; resist: number; land: number }>
  /** Of the observations that entered the fit, the ones that could have gone either way. */
  nInformative: number
  droppedNoLevel: number
  /** Observations held out of the fit because their spell's landings are not observable. */
  droppedUnobservable: number
}

function blankEvidence(row: ResistRow, info: SpellResistInfo): ResistSpellEvidence {
  return {
    spellKey: row.spellKey,
    family: row.family,
    casts: 0,
    resisted: 0,
    partial: 0,
    full: 0,
    land: 0,
    fromBaseline: 0,
    fromYou: 0,
    resistAdj: info.resistAdj,
    informative: isInformativeSpell(info.resistAdj),
  }
}

/**
 * Which spells have no observable landings ANYWHERE in the rows handed to it.
 *
 * PASS IT THE WHOLE LEDGER, not one mob's rows, and the caller that matters does exactly that
 * (`src/main/ipc/resist.ts`, once per read). The distinction is the difference between two very
 * different statements: "this app has never seen this spell land on anything", which is a fact
 * about our own blindness, and "this mob resisted every cast of it", which is a fact about the
 * mob and is exactly the evidence the estimator exists to use. Scoped to one mob it would throw
 * the second away with the first.
 *
 * Axis-agnostic on purpose: whether we can SEE a spell land has nothing to do with which
 * resistance it rolls against.
 */
export function unobservableSpells(rows: readonly ResistRow[]): Set<string> {
  const seen = new Map<string, { resist: number; land: number }>()
  for (const row of rows) {
    const acc = seen.get(row.spellKey) ?? { resist: 0, land: 0 }
    acc.resist += row.resist
    acc.land += row.land + dmgTotalOf(row)
    seen.set(row.spellKey, acc)
  }
  const out = new Set<string>()
  for (const [key, acc] of seen) {
    if (acc.resist > 0 && acc.land === 0) out.add(key)
  }
  return out
}

function noteEvidence(prep: Prepared, row: ResistRow, info: SpellResistInfo, mode: number | undefined): void {
  const key = row.spellKey + '|' + row.family
  const ev = prep.evidence.get(key) ?? blankEvidence(row, info)
  const fixed = damageKind(row, info, mode) === 'ddFix'
  const { total: dmgTotal, full, partial } = splitDamage(row, fixed ? mode : undefined)
  ev.resisted += row.resist
  ev.full += full
  ev.partial += partial
  ev.land += row.land + (fixed ? 0 : dmgTotal)
  const total = row.resist + row.land + dmgTotal
  ev.casts += total
  if (row.source === 'baseline') ev.fromBaseline += total
  else ev.fromYou += total
  prep.evidence.set(key, ev)
  const fam = prep.byFamily[row.family]
  fam.n += total
  fam.resist += row.resist
  fam.land += row.land + dmgTotal
  const by = prep.byCaster[row.casterKind]
  // Defensive: a hand-edited ledger or a row from a future build can carry a kind this build has
  // never heard of, and a tally is not worth a crash.
  if (by) {
    by.n += total
    by.resist += row.resist
    by.land += row.land + dmgTotal
  }
}

/** A zero tally per caster kind — the shape `byCaster` always has, empty cells included. */
function blankByCaster(): Record<ResistCasterKind, { n: number; resist: number; land: number }> {
  const out = {} as Record<ResistCasterKind, { n: number; resist: number; land: number }>
  for (const kind of RESIST_CASTER_KINDS) out[kind] = { n: 0, resist: 0, land: 0 }
  return out
}

/**
 * THE THREE WAYS A COUNTED OBSERVATION IS KEPT OUT OF THE FIT, in one place so the loop below
 * stays readable and so a fourth cannot be added without meeting the other three.
 *
 * Every one of them is COUNTED first (`noteEvidence` has already run) and weighed never — the
 * ledger's own rule applied to the estimate: what the log saw is not the same question as what the
 * number rests on.
 */
function isHeldOut(
  row: ResistRow,
  opts: EstimateOpts,
  blind: ReadonlySet<string>,
  prep: Prepared
): boolean {
  if (blind.has(row.spellKey)) {
    // A spell this app has never seen land ANYWHERE. Shown in the drilldown, labelled there.
    prep.droppedUnobservable += row.resist + row.land + dmgTotalOf(row)
    const ev = prep.evidence.get(row.spellKey + '|' + row.family)
    if (ev) ev.landingsNotObservable = true
    return true
  }
  if (row.family === 'song' && opts.includeSongs === false) return true
  // THE ONE LINE THE npc SWITCH IS (JOS-385).
  return row.casterKind === 'npc' && opts.includeNpcCasters === false
}

function prepare(rows: readonly ResistRow[], spells: SpellResistTable, opts: EstimateOpts): Prepared {
  const prep: Prepared = {
    terms: [],
    evidence: new Map(),
    byFamily: { cast: { n: 0, resist: 0, land: 0 }, song: { n: 0, resist: 0, land: 0 } },
    byCaster: blankByCaster(),
    nInformative: 0,
    droppedNoLevel: 0,
    droppedUnobservable: 0,
  }
  // The caller's whole-ledger verdicts when it has them; else what these rows alone can say. Both
  // are deliberately about the LEDGER rather than about this cell — see their own headers.
  const blind = opts.unobservable ?? unobservableSpells(rows)
  const modes = opts.modes ?? damageModes(rows)
  for (const row of rows) {
    const info = spells[row.spellKey]
    if (!rowIsEvidence(row, info, opts.axis)) continue
    const mode = modes.get(damageModeKey(row.spellKey, row.casterLevel))
    noteEvidence(prep, row, info, mode)
    if (isHeldOut(row, opts, blind, prep)) continue
    const term = rowTerm(row, { info, axis: opts.axis, spells, mode })
    if (!term) {
      prep.droppedNoLevel += row.resist + row.land + dmgTotalOf(row)
      continue
    }
    // COUNTED SEPARATELY, NOT WEIGHED SEPARATELY (JOS-385): a -250 proc's casts still enter the
    // likelihood, where they say the one true thing they can ("R is not enormous"), and are kept
    // out of the number a player reads as this cell's evidence.
    if (isInformativeSpell(info.resistAdj)) prep.nInformative += termN(term)
    prep.terms.push({ term, source: row.source === 'baseline' ? 'baseline' : 'user' })
  }
  return prep
}

/**
 * THE ESTIMATOR. `rows` may mix the shipped baseline and the user's own log freely — every row
 * carries its own `source` and the down-weighting happens here, once, so no caller can forget it.
 */
export function estimate(
  rows: readonly ResistRow[],
  spells: SpellResistTable,
  opts: EstimateOpts
): ResistEstimate {
  const prep = prepare(rows, spells, opts)
  const mobLevel = opts.mobLevel ?? null
  const userTerms = prep.terms.filter((t) => t.source === 'user').map((t) => t.term)
  const baseTerms = prep.terms.filter((t) => t.source === 'baseline').map((t) => t.term)
  const fromYou = userTerms.reduce((a, t) => a + termN(t), 0)
  const fromBaseline = baseTerms.reduce((a, t) => a + termN(t), 0)

  const baselineWeight = fromYou >= USER_ONLY_AT ? 0 : BASELINE_K / (BASELINE_K + fromYou)
  const weighted: Term[] = [
    ...userTerms,
    ...baseTerms.map((t) => ({ ...t, weight: baselineWeight })),
  ]
  const merged = fitFrom(weighted, opts.axis, mobLevel)
  const userFit = fromYou > 0 ? fitFrom(userTerms, opts.axis, mobLevel) : null
  const baselineFit = fromBaseline > 0 ? fitFrom(baseTerms, opts.axis, mobLevel) : null

  return {
    R: merged.R,
    lo: merged.lo,
    hi: merged.hi,
    n: fromYou + fromBaseline,
    nInformative: prep.nInformative,
    fromBaseline,
    fromYou,
    droppedNoLevel: prep.droppedNoLevel,
    droppedUnobservable: prep.droppedUnobservable,
    byFamily: prep.byFamily,
    byCaster: prep.byCaster,
    npcIncluded: opts.includeNpcCasters !== false,
    // INFORMATIVE SPELLS FIRST, then by volume (JOS-385). The list is read as "what does this app
    // know about this axis", and a -250 proc with 87 unresisted casts headed it while the eight
    // casts that actually tested the mob's resistance sat underneath. Sorting is the whole fix
    // for that: nothing is hidden, and the line that answers the question is the line at the top.
    perSpell: [...prep.evidence.values()].sort(
      (a, b) => Number(b.informative) - Number(a.informative) || b.casts - a.casts
    ),
    baselineWeight,
    userOnly: fromYou >= USER_ONLY_AT,
    baselineFit,
    userFit,
    differsFromShipped: differs(userFit, baselineFit),
    nearlyImmune: merged.R >= 200,
  }
}

/** Re-exported so a caller needs one import for "read this histogram" and "fit it". */
export { damageKind, damageModeKey, damageModes, splitDamage } from './resistDamage'

/**
 * Is there ANY answer to give? (owner ruling, 2026-08-16 — see `LOW_SAMPLE_BELOW`.)
 *
 * One observation is an answer: the estimator is a likelihood over a prior, so a single resist
 * moves R and widens the interval rather than producing nonsense. The only cell with nothing to
 * say is the empty one.
 */
export function hasAnswer(n: number): boolean {
  return n > 0
}

/**
 * Does this cell's answer need the quieter caveat beside it? A cell in this band is REPORTED in
 * full — tag, number, interval, count — and merely says, in words, that it is standing on very
 * little. It is a caveat and never a substitute: the ruling that created this function is exactly
 * that the app stopped withholding the answer.
 *
 * IT TAKES THE INFORMATIVE COUNT (JOS-385), and that is the whole of the defect the owner found on
 * a thunder spirit princess: the cell read `resistant` with no caveat off `n=83`, and 75 of the 83
 * were casts of procs that could not have been resisted at any R. Counting them here made a cell
 * standing on eight observations look like one standing on eighty. Callers pass
 * `estimate().nInformative`; a cell with none at all is as thin as a cell can be and says so.
 */
export function lowSamples(nInformative: number): boolean {
  return nInformative < LOW_SAMPLE_BELOW
}
