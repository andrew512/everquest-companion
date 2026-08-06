// aaPaceRows.ts — the PURE shaping behind AaPacePanel: an `AaPace` (the answer
// `shared/aaPace.ts` computed) turned into the exact strings the panel prints. No React, no
// MUI, and only TYPE imports from `@shared`, so tests/aaPace.test.mts drives it under tsx —
// the same constraint rangeStatsRows.ts / zoneBands.ts document.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: which numbers are MEASURED and which are MODELLED is
// visible on the panel, not buried in a doc. Two of the four tiles are counts the game printed;
// two are a model over them. So every shaped value carries an `inferred` flag, and every
// inferred one carries a sentence saying what the model is and what the log actually said.

import type { AaEta, AaEtaBlocked, AaPace, AaPotionState } from '@shared/aaPace'
import type { RangeStats } from '@shared/progressionStats'
import { AA_POTION_CHARGES } from '../../../../shared/aaPace'
import { NONE, aaRateText } from './rangeStatsRows'
import { fmtDuration } from './levelChartGeometry'
import { formatAaRate, formatPointRate } from '../../lib/formatRate'

/** One tile: a big number, the words under it, whether it is a model, and the hover sentence. */
export interface AaPaceTile {
  /** stable id — the render key and the e2e's handle (`leveling-aa-tile-<id>`). */
  id: 'rate' | 'points' | 'eta' | 'potion'
  value: string
  /** small suffix on the value's baseline; '' when the value stands alone. */
  unit: string
  label: string
  /** true ⇒ the panel chips it `inferred`. The two rate tiles are never inferred. */
  inferred: boolean
  /** ALWAYS a sentence: what it measures, or what the model is and why. */
  title: string
}

/** '2.40 AA/hr' → `{ value: '2.40', unit: 'AA/hr' }`; '—' → `{ value: '—', unit: '' }`. */
function split(s: string): { value: string; unit: string } {
  const i = s.indexOf(' ')
  return i < 0 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) }
}

/** A rate, or the em-dash. Null means "no active time in the window", never "zero AA". */
function rate(n: number | null, fmt: (v: number) => string): string {
  return n == null ? NONE : fmt(n)
}

const RATE_TITLE =
  'AA completions per hour of ACTIVE time in this window, counted off the gain lines. ' +
  'The item-shop potion cannot move this number — it doubles the points a completion pays, ' +
  'never the experience a completion costs.'

const POINTS_TITLE =
  'Ability points per hour of ACTIVE time — the sum of the amounts the gain lines stated, so a ' +
  'potion doubling is already inside it (the doubled line reads "You have gained 2 ability ' +
  'point(s)!"). Gain lines only: a respec re-logs its purchases and refunds nothing, so points ' +
  're-earned after one are counted again.'

/** The reason there is no estimate, in the log's own terms — one per `AaEtaBlocked`. */
const ETA_BLOCKED_TITLE: Record<AaEtaBlocked, string> = {
  'no-pace':
    'This window holds fewer than two AA completions, so it states no gap between them to project forward — and the log carries no AA-experience percentage anywhere, so there is nothing else to estimate from. INFERRED numbers need evidence; this window has none.',
  stale:
    'The last AA completion is far older than this window’s rhythm between them, so that rhythm no longer describes what is happening. An INFERRED estimate here would read "due now" indefinitely.'
}

/** The estimate's tooltip: the method, its inputs, and the fact that the log states none of it. */
function etaTitle(meanIntervalMs: number, samples: number, sinceLastMs: number, overdue: boolean): string {
  const base =
    'INFERRED. The game never states how far into an AA you are — there is no AA-experience line ' +
    `at all — so this is the mean gap between the ${samples} completions in this window ` +
    `(${fmtDuration(meanIntervalMs)} of online wall time each) minus the ${fmtDuration(sinceLastMs)} ` +
    'already waited. It assumes the same mobs and the same pace, and it counts the same share of ' +
    'medding and looting the window already contained. Hours the log says you were logged out are ' +
    'excluded from both.'
  return overdue ? `${base} You are already past that mean gap, so the next one is due.` : base
}

function etaTile(eta: AaPace['eta']): AaPaceTile {
  if (eta.blocked !== null) {
    return {
      id: 'eta',
      value: NONE,
      unit: '',
      label: 'to next AA',
      inferred: true,
      title: ETA_BLOCKED_TITLE[eta.blocked]
    }
  }
  return {
    id: 'eta',
    value: eta.overdue ? 'due' : `~${fmtDuration(eta.ms)}`,
    unit: '',
    label: 'to next AA',
    inferred: true,
    title: etaTitle(eta.meanIntervalMs, eta.samples, eta.sinceLastMs, eta.overdue)
  }
}

/**
 * The potion tile's tooltip: the line the log DID print, the rule that is a model, and the
 * evidence the stated points give it on this very bottle.
 */
export function potionTitle(potion: AaPotionState): string {
  const evidence =
    potion.burnedPoints.length > 0
      ? ` So far this bottle's completions paid ${potion.burnedPoints.join(', ')} — the doubling, as the game printed it.`
      : ' This bottle has paid for nothing yet.'
  return (
    'INFERRED count. The log states the quaff ("You are filled with the spirit of alternate ' +
    `adventure.") and nothing else — never the charges, never a countdown, and nothing when the ` +
    `last one burns. ${String(AA_POTION_CHARGES)} completions per bottle is measured, not assumed: over the whole log ` +
    'every quaff is followed by exactly five doubled gain lines, with no exception. Each ' +
    `completion since the quaff burns one.${evidence}`
  )
}

/** The potion tile, or none at all — a character who has never quaffed one is told nothing. */
function potionTile(potion: AaPotionState): AaPaceTile[] {
  if (potion.activations === 0) return []
  return [
    {
      id: 'potion',
      value: String(potion.charges),
      unit: `of ${String(AA_POTION_CHARGES)}`,
      label: 'potion charges',
      inferred: true,
      title: potionTitle(potion)
    }
  ]
}

/**
 * The tile row: AA/hr · points/hr · next AA · potion charges. Three tiles is the floor (the
 * rates and the estimate always have an answer, even if it is an em-dash with a reason) and
 * four the cap, which is exactly what one row holds at every width this panel is given.
 */
export function aaPaceTiles(pace: AaPace): AaPaceTile[] {
  const r = split(rate(pace.perHourActive, formatAaRate))
  const p = split(rate(pace.pointsPerHourActive, formatPointRate))
  return [
    { id: 'rate', value: r.value, unit: r.unit || 'AA/hr', label: 'this window', inferred: false, title: RATE_TITLE },
    {
      id: 'points',
      value: p.value,
      unit: p.unit || 'pts/hr',
      label: 'points earned',
      inferred: false,
      title: POINTS_TITLE
    },
    etaTile(pace.eta),
    ...potionTile(pace.potion)
  ]
}

/**
 * The panel's one-line summary of the window: what was counted, so a rate reading 0.00 cannot
 * be mistaken for a bug. Counts, never rates — the tiles above own those.
 */
export function aaPaceCaption(pace: AaPace): string {
  const n = pace.events
  if (n === 0) return 'no AA completions in this window'
  return `${n} completion${n === 1 ? '' : 's'} · ${pace.points} point${pace.points === 1 ? '' : 's'}`
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE COMPACT READ — the same numbers on a surface that has one line, not a tile row
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The one word an INFERRED number wears on a caption line.
 *
 * The tiles above can afford a chip AND a sentence; a line under a glance card can afford
 * neither without becoming a footnote, and the UI conventions are explicit that when
 * stated-vs-inferred genuinely matters, one word beats a caveat. This is that word. The full
 * account — what the model is, what the log actually stated — stays on the tile that owns the
 * number, one click away on the Leveling tab.
 */
export const AA_EST = 'est.'

/**
 * 'next in ~12m est.' / 'next due est.', or NULL when the window states no rhythm to project
 * from.
 *
 * Absent, never an em-dash with a reason attached: on a compact line a refusal would spend more
 * words explaining itself than the answer would have taken, and `etaTile` above already carries
 * the refusal and its reason for the surface that has room for it.
 */
export function aaNextText(eta: AaEta): string | null {
  if (eta.blocked !== null) return null
  return eta.overdue ? `next due ${AA_EST}` : `next in ~${fmtDuration(eta.ms)} ${AA_EST}`
}

/**
 * The whole AA pace read in one line: '2.40 AA/hr · 4.80 pts/hr · next in ~12m est.'.
 *
 * The rates are `aaRateText`'s — the Leveling tab's own spelling of them, reused rather than
 * re-worded, so the glance and the tab can never describe the same hour differently. Null when
 * the window holds no completion at all: a character earning no AA is told nothing about AA
 * (law 1), never a row of em-dashes.
 *
 * THE RATES LEAD AND THE ESTIMATE TRAILS, so the two rates stay ADJACENT. They are printed
 * together on purpose — they are equal until an item-shop bottle is running and diverge while
 * one is, and that divergence is the entire reading; an estimate wedged between them would
 * break the comparison the pair exists to offer.
 */
export function aaPaceLine(stats: RangeStats, eta: AaEta): string | null {
  const rates = aaRateText(stats)
  if (rates === null) return null
  const next = aaNextText(eta)
  return next === null ? rates : `${rates} · ${next}`
}

/**
 * The potion chip's own line: how many bottles the log has seen, and where this one stands.
 * Null when the character has never quaffed one — no potion word appears anywhere then.
 */
export function potionText(potion: AaPotionState): string | null {
  if (potion.activations === 0) return null
  if (potion.charges === 0) return `no potion charges left · ${potion.activations} quaffed`
  return `${potion.charges} of ${AA_POTION_CHARGES} charges · ${potion.activations} quaffed`
}
