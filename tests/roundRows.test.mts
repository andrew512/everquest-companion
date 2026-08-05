// THE ROUNDS PANEL'S WORDS (docs/plans/attack-round-stats.md §3, honesty tiers in §2).
//
// The engine's counters are pinned in tests/combatRoundStats.test.mts. This pins what the panel
// SAYS about them, because that is where the design's honesty actually lands: a per-event
// reading offered for a lane that has the dual-wield confound, or a riposte figure presented
// without its asymmetry, would be a lie the counters themselves are innocent of.
//
// RELATIVE value import, like procRows.test.mts: node tests resolve no `@shared/*` alias for
// values (roundRows.ts imports that alias type-only, which tsx strips).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  exclusionHint,
  exclusionNote,
  flurryHint,
  laneHint,
  riposteHint,
  roundLaneRows
} from '../src/renderer/src/features/combat/roundRows'
import type { RoundLaneView, SourceRoundsView } from '../src/shared/combat'

function laneOf(o: Partial<RoundLaneView> & { verb: string; buckets: number[] }): RoundLaneView {
  const rounds = o.rounds ?? o.buckets.reduce((n, v) => n + v, 0)
  const multi = o.multiRounds ?? o.buckets.slice(1).reduce((n, v) => n + v, 0)
  return {
    label: o.verb.charAt(0).toUpperCase() + o.verb.slice(1),
    rounds,
    multiRounds: multi,
    multiPct: rounds > 0 ? (multi / rounds) * 100 : 0,
    fannedRounds: 0,
    confidence: 'aggregate',
    ...o
  }
}

function viewOf(o: Partial<SourceRoundsView> & { lanes: RoundLaneView[] }): SourceRoundsView {
  return {
    primaryRounds: o.lanes.reduce((n, l) => n + l.rounds, 0),
    excluded: { frenzy: 0, riposte: 0, flurry: 0, rampage: 0 },
    modifiers: [],
    ripostesGiven: 0,
    ripostesTaken: 0,
    rampagesTaken: 0,
    flurries: 0,
    flurryPct: 0,
    ...o
  }
}

// The w49 backstab lane, verbatim from the engine: 6 single / 4 double / 1 triple.
const BACKSTAB = laneOf({ verb: 'backstab', label: 'Backstab', buckets: [6, 4, 1, 0], confidence: 'perEvent' })
const SLASH = laneOf({ verb: 'slash', label: 'Melee', buckets: [18, 10, 5, 2] })

test('a reuse-timer lane shows its 2x/3x split; a weapon verb shows the rate and wears `inferred`', () => {
  const [bs, sl] = roundLaneRows(viewOf({ lanes: [BACKSTAB, SLASH] }))
  assert.equal(bs.aggregateOnly, false)
  assert.equal(bs.splitDetail, '4 double · 1 triple', 'the per-event reading names the buckets')
  assert.equal(sl.aggregateOnly, true, 'a weapon verb may only be read in aggregate')
  assert.equal(sl.splitDetail, null, 'NEVER a per-event double-attack label on a dual-wieldable verb')
})

test('the split is always printed in full — the denominator can be checked by hand', () => {
  const [bs, sl] = roundLaneRows(viewOf({ lanes: [BACKSTAB, SLASH] }))
  assert.equal(bs.splitText, '6 · 4 · 1', 'trailing empty buckets are dropped, present ones never are')
  assert.equal(sl.splitText, '18 · 10 · 5 · 2')
  assert.equal(bs.rounds, 11)
  assert.equal(Math.round(bs.multiPct), 45)
  // Bars are relative to the biggest lane, so the ranking reads honestly.
  assert.equal(sl.pct, 100)
  assert.ok(bs.pct < 100)
})

test('a single-swing lane says so without inventing a multi bucket', () => {
  const [row] = roundLaneRows(viewOf({ lanes: [laneOf({ verb: 'punch', buckets: [3, 0, 0, 0] })] }))
  assert.equal(row.splitText, '3')
  assert.equal(row.splitDetail, null)
  assert.equal(row.multiPct, 0)
})

test('the lane tooltip names the tier AND the reason — dual wield, or the reuse timer', () => {
  const weapon = laneHint(SLASH)
  assert.match(weapon, /dual wield/i)
  assert.match(weapon, /never a single round|Read the RATE/i)
  const timer = laneHint(BACKSTAB)
  assert.match(timer, /reuse timer/i)
  assert.match(timer, /cannot be an off-hand/i)
  // Both must say the whole thing is inferred: EQ never logs double or triple attack.
  for (const h of [weapon, timer]) assert.match(h, /never logs double or triple attack/i)
})

test('a collapsed fan-out is reported, never silently applied', () => {
  const fanned = laneOf({ verb: 'backstab', buckets: [7, 8, 0, 0], confidence: 'perEvent', fannedRounds: 2 })
  assert.match(laneHint(fanned), /more than one defender/i)
  assert.match(laneHint(fanned), /counted once/i)
  assert.equal(roundLaneRows(viewOf({ lanes: [fanned] }))[0].fannedRounds, 2)
  // …and a lane with no fan-out says nothing about one.
  assert.equal(/defender/i.test(laneHint(BACKSTAB)), false)
})

test('the riposte tooltip states the ASYMMETRY — the design’s load-bearing sentence', () => {
  const h = riposteHint(viewOf({ lanes: [], ripostesGiven: 2, ripostesTaken: 11 }))
  assert.match(h, /2 riposte counter-swings of yours/)
  assert.match(h, /11 taken/)
  // A mob riposting you prints no avoidance line — the counter is the only evidence.
  assert.match(h, /no avoidance line/i)
  assert.match(h, /the mob’s counters, not your riposted swings/i)
  // …and Double Riposte breaks the 1:1 reading.
  assert.match(h, /Double Riposte/)
})

test('the flurry tooltip carries its denominator, in rounds, and says misses are counted', () => {
  const h = flurryHint(viewOf({ lanes: [BACKSTAB], flurries: 3, primaryRounds: 170 }))
  assert.match(h, /3 flurry swings over 170 primary rounds/)
  assert.match(h, /hits AND misses/)
  assert.match(h, /two extra primary swings after a triple attack/i)
  assert.match(h, /never counted into a round/i)
})

test('exclusions are reported, never silent — and only the reasons that fired', () => {
  assert.equal(exclusionNote(viewOf({ lanes: [] })), null, 'nothing excluded ⇒ no note at all')
  assert.equal(
    exclusionNote(viewOf({ lanes: [], excluded: { frenzy: 30, riposte: 2, flurry: 0, rampage: 0 } })),
    '30 frenzy · 2 riposte'
  )
  const h = exclusionHint()
  assert.match(h, /EXTRA swings/)
  assert.match(h, /multi-hit by design/i)
})
