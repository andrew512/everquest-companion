// A RUN OF THREE SAYS SOMETHING A FOUR-WEEK AVERAGE CANNOT (JOS-397, owner ruling 2026-08-16).
//
// Pure. The decay next door (`resistDecay.ts`) makes recent evidence weigh more; this file is the
// other half of the same ruling, and it exists because weighing is not enough for the case that
// prompted it: the owner was resisted three times running on the female vampires in Hate and read
// them as at least marginally magic-resistant, while the pooled estimate - hundreds of observations
// deep, decayed or not - still said magic was ordinary. Three observations cannot move a number
// standing on four hundred, and they should not. What they can do is be REPORTED.
//
// So `lately` is a SECOND, SMALLER STATEMENT printed beside the estimate and never inside it. `R`,
// the interval and the two landing percentages stay the decayed estimate's, every time. What the
// run adds is one sentence - `lately: 3 of the last 3 resisted` - and the band that run implies,
// worn with the word `lately` in front so the two can never be confused for each other.
//
// ── THE FOUR RULES, AND WHY EACH ONE IS THERE ──────────────────────────────────────────────────
//
//   THREE IN A ROW, MINIMUM. Two of anything happens constantly; the owner named three, and three
//   is also where the arithmetic starts being able to surprise anybody (a run of two under a
//   coin-flip estimate is a one-in-four event, which is not news).
//
//   AND THE RUN HAS TO BE UNLIKELY UNDER THE ESTIMATE WE ALREADY PRINT. This is what keeps the line
//   off every card in the app. A creature already tagged `resistant` resists most of what you cast,
//   so three resists running is the ordinary Tuesday it was always going to be, and saying `lately
//   resistant` about it would be the card agreeing with itself in a louder voice. The line fires
//   only where the run and the long-run answer DISAGREE - probability under `LATELY_MAX_PROB` -
//   which is exactly the owner's case and exactly the shape a retune makes.
//
//   YOUR OWN CASTS ONLY. A charmed pet's level comes off a catalog and another player's is never
//   stated at all, so neither can carry the "this is surprising" arithmetic; and the sentence says
//   `you`, in effect, so it had better be you. Songs are out too, and that one is a measurement
//   rather than a principle: the Symphonic Aura re-pulses every six seconds, so three song pulses in
//   a row is four seconds of one fight and would light this line up on every creature a bard passes.
//
//   AND IT ENDS BY ITSELF. There is nothing to clear, because nothing is stored: the run is derived
//   on every read from the last `RESIST_RECENT_CAP` outcomes, so a landing after three resists makes
//   the newest outcome a landing, the leading run becomes one, and the line is simply not there on
//   the next draw.
//
// ── WHY THE RING IS KEYED BY (MOB, SPELL) AND FILTERED BY AXIS ON READ ─────────────────────────
//
// THE FOLD CANNOT KNOW AN AXIS. It never reads the client's `spells_us.txt` (fold.ts's header
// carries the argument at length), so it cannot file an outcome under `magic` and it cannot know
// whether a spell was informative enough to count. Both are joined in here, at read time, off the
// same table the estimator uses.
//
// A ring PER SPELL is what makes that join lossless. The last ten outcomes on an axis are drawn from
// the spells on that axis, and no spell can contribute more than ten to them - so merging the
// per-spell rings and taking the newest ten returns exactly the true last ten, by construction. A
// single per-mob ring would not: one -250 proc firing every eight seconds would push every
// informative cast out of it, which is the JOS-385 defect in a new coat.

import { FULL_AT_LEAST, type DamageRef } from './resistDamage'
import { isInformativeSpell, levelMod, resistBenchmark } from './resistFormula'
import type {
  ResistGuidance,
  ResistLately,
  ResistRecentEntry,
  ResistRecentOutcome,
  ResistRecentSeries,
  ResistTag,
  SpellResistTable,
} from './resistTypes'

/** How many outcomes one (mob, spell) ring remembers. The owner's window, and the ticket's. */
export const RESIST_RECENT_CAP = 10

/** Below this many identical outcomes in a row there is no run. */
export const LATELY_MIN_RUN = 3

/** A run this likely under the current estimate is not news. See the header's second rule. */
export const LATELY_MAX_PROB = 0.1

/** The word that fronts the band, on the row and on the chip. Never printed without one. */
export const LATELY_PREFIX = 'lately'

/** One outcome, dated, with the spell that produced it. Newest first everywhere below. */
export interface ResistRecentRead {
  ts: number
  spellKey: string
  outcome: ResistRecentOutcome
  /**
   * THE SPELL'S OWN RESIST ADJUST, joined from the client's table on read.
   *
   * It is here for the same reason it is a term of `rc` in the estimator: three resists of a
   * -95-adjust spell are stronger evidence about a creature than three of a plain one, and a band
   * computed as though every cast were plain would understate exactly the cells a player most needs
   * warning about. The rank and the invocation are NOT joined in (the ring does not carry them), so
   * this reading is conservative where a run happened under overchannel — it will understate the
   * creature rather than invent resistance, which is the safe direction for a claim this small.
   */
  resistAdj: number
}

/**
 * One stored entry read against the client's table and the ledger's damage reference - the same
 * ladder `damageKind` climbs, over an entry rather than over a pooled row.
 */
export function outcomeOf(
  entry: ResistRecentEntry,
  info: { hpSlot?: unknown },
  ref: DamageRef | undefined
): ResistRecentOutcome {
  if (entry.resist === true) return 'resist'
  if (entry.dmg === undefined) return 'land'
  // No partial information: an all-or-nothing spell, a spell with no hitpoint slot, or a histogram
  // that could not name a full-damage reference. Its damage line is a LANDING and nothing more.
  if (!info.hpSlot || ref === undefined || ref.allOrNothing) return 'land'
  return entry.dmg >= ref.value * FULL_AT_LEAST ? 'full' : 'partial'
}

/** What the caller has to know to read a ring: the client's table and the whole-ledger references. */
export interface RecentCtx {
  spells: SpellResistTable
  axis: string
  modes: ReadonlyMap<string, DamageRef>
}

const refKey = (spellKey: string, level: number | undefined): string =>
  `${spellKey}|${level === undefined ? '' : String(level)}`

/**
 * THE LAST `RESIST_RECENT_CAP` INFORMATIVE OUTCOMES ON ONE AXIS, newest first.
 *
 * The two joins the fold could not make happen here: the spell's axis, and whether it could have
 * been resisted at all (`isInformativeSpell` - a -250 proc's landings say nothing about the
 * creature, and a run of them would be a run of nothing).
 */
export function recentOnAxis(series: readonly ResistRecentSeries[], ctx: RecentCtx): ResistRecentRead[] {
  const out: ResistRecentRead[] = []
  for (const s of series) {
    const info = ctx.spells[s.spellKey]
    if (info?.axis !== ctx.axis) continue
    if (!isInformativeSpell(info.resistAdj)) continue
    // NEWEST FIRST WITHIN A RING, before the sort rather than after it. EQ stamps a line to the
    // SECOND, so a burst of casts in one second arrives with identical timestamps and a stable sort
    // would then hand back the order it was given - which for a ring stored oldest-first is exactly
    // backwards. Feeding it reversed makes the tie-break the ring's own order, which is the truth.
    for (let i = s.out.length - 1; i >= 0; i--) {
      const entry = s.out[i]
      out.push({
        ts: entry.ts,
        spellKey: s.spellKey,
        outcome: outcomeOf(entry, info, ctx.modes.get(refKey(s.spellKey, entry.level))),
        resistAdj: info.resistAdj,
      })
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, RESIST_RECENT_CAP)
}

/** Which run an outcome can belong to. `partial` belongs to neither - see `ResistRecentOutcome`. */
function runSide(outcome: ResistRecentOutcome): 'resisted' | 'landed' | null {
  if (outcome === 'resist') return 'resisted'
  return outcome === 'partial' ? null : 'landed'
}

/** How many of the newest outcomes ran the same way, and which way. */
export function leadingRun(reads: readonly ResistRecentRead[]): { run: number; side: 'resisted' | 'landed' } | null {
  const side = reads.length > 0 ? runSide(reads[0].outcome) : null
  if (side === null) return null
  let run = 0
  while (run < reads.length && runSide(reads[run].outcome) === side) run += 1
  return { run, side }
}

/** What the run was cast under, and who is reading it. An object because it is one context. */
export interface ImpliedBandCtx {
  viewerLevel: number | null
  mobLevel: number | null
  /** The mean resist adjust across the run's own casts. Negative helps the caster. */
  resistAdj: number
}

/**
 * THE BAND A RUN IMPLIES, and it is computed rather than picked.
 *
 * A run of `k` identical outcomes with a uniform prior is a Beta posterior, whose MEDIAN is the
 * resist probability the run alone argues for: `0.5^(1/(k+1))` for a run of resists, its mirror for
 * a run of landings. Three resists say 84%, ten say 94% - which is the honest shape, because a
 * short run cannot prove a creature immune however unanimous it is.
 *
 * That probability is `rc/200` (the game's own all-or-nothing formula, resistFormula.ts), so the
 * `rc` those casts rolled against follows - and the creature's R is that `rc` with the two terms
 * the casts carried taken back off: the viewer's level gap, and the spells' own resist adjust.
 * `resistBenchmark` then puts the level term back on, which is the whole point: `lately resistant`
 * and `resistant` mean the identical thing, measured over different windows.
 *
 * THE ADJUST IS WHY THE TOP BAND IS REACHABLE AT ALL, and the arithmetic is worth stating. Against a
 * plain spell the run can only ever say `rc <= 200`, and overchannel's -150 leaves any such cast
 * better than the 60% line - so a run of plain-spell resists implies `resistant` and never worse,
 * however long it runs. A run of resists on a spell that was ALREADY 95 points of adjust to the
 * good is a different claim: it puts the creature's own R that much higher, and a plain cast at
 * that R can be past the point overchannel rescues. That is exactly the cell the card is for.
 */
export function impliedBand(
  run: number,
  side: 'resisted' | 'landed',
  ctx: ImpliedBandCtx
): { tag: ResistTag; guidance: ResistGuidance } {
  const half = Math.pow(0.5, 1 / (run + 1))
  const pResist = side === 'resisted' ? half : 1 - half
  const lm = ctx.viewerLevel === null || ctx.mobLevel === null ? 0 : levelMod(ctx.viewerLevel, ctx.mobLevel)
  const R = Math.round(pResist * 200) - lm - ctx.resistAdj
  const b = resistBenchmark(R, ctx.viewerLevel, ctx.mobLevel)
  return { tag: b.tag, guidance: b.guidance }
}

/** The mean resist adjust across a run's casts. See `ResistRecentRead.resistAdj`. */
function meanAdjust(reads: readonly ResistRecentRead[], run: number): number {
  let sum = 0
  for (let i = 0; i < run; i++) sum += reads[i].resistAdj
  return run === 0 ? 0 : sum / run
}

/** Everything the detector needs about the estimate it is being measured against. */
export interface LatelyCtx {
  /** P(a plain cast lands) under the estimate the surface is printing. */
  pLand: number
  viewerLevel: number | null
  mobLevel: number | null
}

/**
 * THE RUN DETECTOR. Null unless all four rules hold - see the header.
 *
 * `pLand` is the estimate's own answer at the viewer's level (the benchmark's `pPlain`), so the
 * probability of the run is that answer raised to the run's length. It is deliberately the number
 * the card is ALREADY PRINTING: the line's whole claim is "what you are looking at did not predict
 * this", and measuring it against anything else would make the claim unfalsifiable by the reader.
 */
export function detectLately(reads: readonly ResistRecentRead[], ctx: LatelyCtx): ResistLately | null {
  const lead = leadingRun(reads)
  if (!lead || lead.run < LATELY_MIN_RUN) return null
  const p = lead.side === 'resisted' ? 1 - ctx.pLand : ctx.pLand
  const probability = Math.pow(p, lead.run)
  if (!(probability < LATELY_MAX_PROB)) return null
  const band = impliedBand(lead.run, lead.side, {
    viewerLevel: ctx.viewerLevel,
    mobLevel: ctx.mobLevel,
    resistAdj: meanAdjust(reads, lead.run),
  })
  return { run: lead.run, outcome: lead.side, probability, ...band }
}
