// Pure, renderer-side derivations for the ROUNDS panel (docs/plans/attack-round-stats.md §3).
// No JSX, no MUI — a RELATIVE value import surface like procRows.ts and dashboardData.ts, so
// node tests can exercise the wording without the renderer's `@shared` alias.
//
// The engine states the counters; this decides what each row SAYS about them, and in
// particular which of the two honesty tiers a lane is in. Nothing here computes a stat the
// engine did not already fold — every function below is text and ratios over counts.

import type { RoundLaneView, SourceRoundsView } from '@shared/combat'

/** One rendered lane row. */
export interface RoundLaneRow {
  verb: string
  label: string
  rounds: number
  multiRounds: number
  multiPct: number
  /** bar fill: this lane's rounds as a pct of the biggest lane's. */
  pct: number
  /** `74 · 99 · 11 · 2` — the swings-per-round split, always shown (denominators visible). */
  splitText: string
  /**
   * The per-event reading, for a REUSE-TIMER lane only: `99 double · 11 triple · 2 quad+`.
   * Null on a weapon verb, where the dual-wield confound forbids a per-event claim — that lane
   * gets the aggregate rate and an `inferred` chip instead.
   */
  splitDetail: string | null
  /** true when this lane may only be read in aggregate (the `inferred` chip). */
  aggregateOnly: boolean
  fannedRounds: number
  hint: string
}

const BUCKET_WORDS = ['single', 'double', 'triple', 'quad+']

/** `74 · 99 · 11 · 2`, trailing empty buckets dropped so a two-swing lane isn't padded. */
function splitText(buckets: readonly number[]): string {
  const last = buckets.reduce((n, v, i) => (v > 0 ? i : n), 0)
  return buckets.slice(0, last + 1).join(' · ')
}

/** `99 double · 11 triple` — the multi-swing buckets only; '' when the lane never multi-swung. */
function splitDetail(buckets: readonly number[]): string {
  return buckets
    .map((n, i) => (i >= 1 && n > 0 ? `${n} ${BUCKET_WORDS[i] ?? `${i + 1}x`}` : ''))
    .filter((s) => s !== '')
    .join(' · ')
}

/** The dual-wield / reuse-timer explanation for one lane. The whole honesty tier, in words. */
export function laneHint(l: RoundLaneView): string {
  const base =
    `${l.rounds} ${l.label} round${l.rounds === 1 ? '' : 's'} — ${l.multiRounds} of them landed 2+ swings in the same second. ` +
    'EQ never logs double or triple attack, so this is inferred from round structure, never read off a line. '
  const tier =
    l.confidence === 'perEvent'
      ? `${l.label} runs on a reuse timer, so a second swing in the same second cannot be an off-hand — the 2x/3x split reads per event.`
      : `${l.label} is a weapon verb, and dual wield puts two weapons on one verb: a same-second 2x may be two hands rather than a double attack. Read the RATE, never a single round.`
  const fan =
    l.fannedRounds > 0
      ? ` ${l.fannedRounds} round${l.fannedRounds === 1 ? ' was' : 's were'} printed against more than one defender — one swing fanned across targets, counted once.`
      : ''
  return base + tier + fan
}

export function roundLaneRows(r: SourceRoundsView): RoundLaneRow[] {
  const max = Math.max(1, ...r.lanes.map((l) => l.rounds))
  return r.lanes.map((l) => {
    const detail = splitDetail(l.buckets)
    return {
      verb: l.verb,
      label: l.label,
      rounds: l.rounds,
      multiRounds: l.multiRounds,
      multiPct: l.multiPct,
      pct: (l.rounds / max) * 100,
      splitText: splitText(l.buckets),
      splitDetail: l.confidence === 'perEvent' && detail !== '' ? detail : null,
      aggregateOnly: l.confidence === 'aggregate',
      fannedRounds: l.fannedRounds,
      hint: laneHint(l)
    }
  })
}

/**
 * THE RIPOSTE ASYMMETRY, spelled out for the tooltip. This is the sentence the design demands
 * the UI carry: your riposted swings print NO avoidance line (`You try to hit <mob>, but <mob>
 * ripostes!` occurs zero times in 1.35M lines), so "taken" is the count of the MOB's annotated
 * counter-swings and not of your swings that were riposted — and Double Riposte means those
 * counters need not be 1:1 with riposte events either way.
 */
export function riposteHint(r: SourceRoundsView): string {
  return (
    `${r.ripostesGiven} riposte counter-swing${r.ripostesGiven === 1 ? '' : 's'} of yours, ` +
    `${r.ripostesTaken} taken. Both are counted from the ANNOTATED counter-swing itself. ` +
    'A mob riposting your swing prints no avoidance line at all, so its counter is the only ' +
    'evidence that it happened — “taken” is the mob’s counters, not your riposted swings. ' +
    'Double Riposte also means counters need not be 1:1 with riposte events.'
  )
}

/** The flurry tooltip: what it is, and what its denominator is. */
export function flurryHint(r: SourceRoundsView): string {
  return (
    `${r.flurries} flurry swing${r.flurries === 1 ? '' : 's'} over ${r.primaryRounds} primary round${
      r.primaryRounds === 1 ? '' : 's'
    }. Flurry grants up to two extra primary swings after a triple attack (the Burst of Power AA, ` +
    'level 46+). The game annotates it on hits AND misses, so both are counted; flurry swings are ' +
    'extra by definition and are never counted into a round.'
  )
}

/** The excluded-swing note, or null when nothing was excluded. Denominators are never silent. */
export function exclusionNote(r: SourceRoundsView): string | null {
  const parts = Object.entries(r.excluded)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
  return parts.length === 0 ? null : parts.join(' · ')
}

export function exclusionHint(): string {
  return (
    'Swings held out of round counting because they are EXTRA swings, not part of an attack ' +
    'round: riposte (a counter granted by the defender’s attack), flurry and rampage (annotated ' +
    'extra swings), and frenzy (multi-hit by design). They are counted in their own rows above.'
  )
}
