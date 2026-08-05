// ATTACK-ROUND STATS — golden windows + the pure round grouper
// (docs/plans/attack-round-stats.md).
//
// Methodology (AGENTS.md "Golden-window testing"): three spans of the REAL log, each cut around
// a second the design's mechanics sweep actually measured, replayed through the REAL parser +
// CombatEngine and asserted against numbers a human can re-derive with one grep of the
// committed fixture. Every expectation below is annotated with that grep.
//
// THE THREE WINDOWS (see tests/extract-combat-fixtures.mjs for the raw line ranges):
//   w49  Tue Aug 04 17:54:49→17:55:30 — the TRIPLE BACKSTAB at 17:55:20 (70/145/392 on one
//        Knight of Innoruuk), plus a 4-swing frenzy burst in the same second that must be
//        excluded wholesale, plus 11 incoming `(Riposte)` counter-swings.
//   w50  Mon Aug 03 01:29:51→01:30:53 — TWO cross-target FAN-OUT seconds (01:30:45 and
//        01:30:49), each printing the same ordered backstab damage against two defenders.
//   w51  Tue Aug 04 00:25:25→00:26:57 — the Burst of Power purchase, the character's first
//        outgoing `(Flurry)` swings nine seconds later, and a flurry on an AVOIDED swing.
//
// LAW 8'S TRIPWIRE is asserted here too (the damage-free half of the feature): every window's
// per-source category totals still sum EXACTLY to the source total, repeated snapshots never
// move a number, and building the view leaves the live aggregate deep-equal. The full-log
// byte-identity proof (34,427,360 outgoing / 6,510,082 incoming over 2,485 segments, unchanged
// to the byte) is a before/after diff run by hand against the real log; this is its in-suite
// standing guard.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFixture } from './harness.mts'
import { parseEvent } from '../src/main/log/parser'
import { CombatEngine } from '../src/main/combat/engine'
import { groupRounds, roundConfidence, roundExclusion, type SwingRecord } from '../src/main/combat/rounds'
import type { RoundLaneView, SegmentView, SourceRoundsView, SourceView } from '../src/shared/combat'

// ── the pure grouper ────────────────────────────────────────────────────────────────────

function swing(o: Partial<SwingRecord> & { ts: number; verb: string; target: string }): SwingRecord {
  return { skill: 'Melee', amount: 10, avoided: false, modifiers: [], ...o }
}

test('R1: an extra swing is never part of a round — frenzy by verb, riposte/flurry/rampage by annotation', () => {
  assert.equal(roundExclusion({ verb: 'frenzy', modifiers: [] }), 'frenzy')
  assert.equal(roundExclusion({ verb: 'flurry', modifiers: [] }), 'flurry')
  assert.equal(roundExclusion({ verb: 'slash', modifiers: ['Riposte'] }), 'riposte')
  assert.equal(roundExclusion({ verb: 'slash', modifiers: ['Flurry'] }), 'flurry')
  assert.equal(roundExclusion({ verb: 'slash', modifiers: ['Rampage'] }), 'rampage')
  // A compound is already decomposed by the time it reaches here, and the EXTRA-swing half of
  // it is what disqualifies the swing — `(Riposte Critical)` is still a riposte.
  assert.equal(roundExclusion({ verb: 'slash', modifiers: ['Riposte', 'Critical'] }), 'riposte')
  // The ordinary procs are NOT extra swings: a Slay Undead crit is one swing that procced.
  assert.equal(roundExclusion({ verb: 'slash', modifiers: ['Critical'] }), null)
  assert.equal(roundExclusion({ verb: 'backstab', modifiers: ['Slay Undead', 'Finishing Blow'] }), null)
  assert.equal(roundExclusion({ verb: 'backstab', modifiers: ['Strikethrough'] }), null)
})

test('R2: the confidence tier is the dual-wield confound — reuse timers are per-event, weapons are not', () => {
  for (const v of ['backstab', 'bash', 'kick', 'strike']) assert.equal(roundConfidence(v), 'perEvent', v)
  for (const v of ['slash', 'pierce', 'crush', 'hit', 'smite', 'cleave', 'claw', 'punch']) {
    assert.equal(roundConfidence(v), 'aggregate', v)
  }
})

test('R3: a round is (verb, second, target) — and equal cross-target sequences are ONE swing fanned', () => {
  // The measured shape, verbatim from Mon Aug 03 01:30:45: two targets, the SAME ordered
  // damage sequence. Backstab's ~10s reuse timer forbids four attacks in one second, so this
  // is one double-attack round printed twice.
  const fan = groupRounds([
    swing({ ts: 1000, verb: 'backstab', target: 'a rock golem', amount: 60 }),
    swing({ ts: 1000, verb: 'backstab', target: 'an elemental capturer', amount: 60 }),
    swing({ ts: 1000, verb: 'backstab', target: 'a rock golem', amount: 51 }),
    swing({ ts: 1000, verb: 'backstab', target: 'an elemental capturer', amount: 51 })
  ])
  assert.deepEqual(
    fan.map((g) => [g.swings, g.targets]),
    [[2, 2]],
    'four backstab lines in one second are ONE 2-swing round fanned across two defenders'
  )

  // …but two defenders taking DIFFERENT damage are two real rounds. The collapse is a claim
  // about identical output, never about "two targets in one second".
  const distinct = groupRounds([
    swing({ ts: 1000, verb: 'backstab', target: 'a rock golem', amount: 60 }),
    swing({ ts: 1000, verb: 'backstab', target: 'an elemental capturer', amount: 61 })
  ])
  assert.deepEqual(distinct.map((g) => [g.swings, g.targets]), [[1, 1], [1, 1]])

  // The triple at Tue Aug 04 17:55:20 — one target, three swings, one round.
  const triple = groupRounds([
    swing({ ts: 2000, verb: 'backstab', target: 'a Knight of Innoruuk', amount: 70 }),
    swing({ ts: 2000, verb: 'backstab', target: 'a Knight of Innoruuk', amount: 145 }),
    swing({ ts: 2000, verb: 'backstab', target: 'a Knight of Innoruuk', amount: 392 })
  ])
  assert.deepEqual(triple.map((g) => [g.swings, g.targets]), [[3, 1]])

  // Seconds are whole-second buckets, so 1000ms apart is two rounds however tight.
  assert.equal(groupRounds([swing({ ts: 1999, verb: 'kick', target: 'x' }), swing({ ts: 2000, verb: 'kick', target: 'x' })]).length, 2)
})

test('R4: an AVOIDED swing is still a swing in the round — and its signature is not an amount', () => {
  // A double attack whose second swing missed is still a double attack.
  const g = groupRounds([
    swing({ ts: 1000, verb: 'slash', target: 'a rock golem', amount: 60 }),
    swing({ ts: 1000, verb: 'slash', target: 'a rock golem', amount: 0, avoided: true })
  ])
  assert.deepEqual(g.map((r) => r.swings), [2])
  // Two misses on two targets DO collapse — an avoided swing has no amount to differ by, and
  // one swing fanned across two defenders can whiff at both.
  const both = groupRounds([
    swing({ ts: 1000, verb: 'slash', target: 'a', amount: 0, avoided: true }),
    swing({ ts: 1000, verb: 'slash', target: 'b', amount: 0, avoided: true })
  ])
  assert.deepEqual(both.map((r) => [r.swings, r.targets]), [[1, 2]])
})

test('R5: REGRESSION — two verbs with equal damage in one second are two rounds, never one fan-out', () => {
  // The fan-out signature is keyed by VERB. Without that key the incremental accumulator (which
  // holds every verb's open second at once) merged a 163-damage backstab with a 163-damage
  // slash into a single "fanned" round: measured on w49, where it turned 11 real backstab
  // rounds into 9. Pinned on the grouper AND, below, on the engine's own counters.
  const g = groupRounds([
    swing({ ts: 1000, verb: 'backstab', target: 'a Knight of Innoruuk', amount: 163 }),
    swing({ ts: 1000, verb: 'slash', target: 'a Knight of Innoruuk', amount: 163 })
  ])
  assert.equal(g.length, 2, 'two different verbs are two rounds')
  assert.deepEqual(g.map((r) => [r.verb, r.swings, r.targets]).sort(), [['backstab', 1, 1], ['slash', 1, 1]])
})

// ── the engine, over the three measured windows ─────────────────────────────────────────

interface Replay {
  seg: SegmentView
  eng: CombatEngine
  lastTs: number
}

function replay(fixture: string): Replay {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  let lastTs = 0
  for (const raw of readFixture(fixture)) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  // The ZONE aggregate, so nothing depends on which pull a line landed in.
  const seg = eng.snapshot(lastTs + 120_000, { selectedId: 'zone' }).selected
  assert.ok(seg, `${fixture}: no zone aggregate`)
  return { seg, eng, lastTs }
}

function you(seg: SegmentView): SourceView {
  const e = seg.entities.find((s) => s.kind === 'you')
  assert.ok(e, 'no You row')
  return e
}

function rounds(e: SourceView): SourceRoundsView {
  assert.ok(e.roundStats, `${e.name} has no round stats`)
  return e.roundStats
}

function lane(r: SourceRoundsView, verb: string): RoundLaneView {
  const l = r.lanes.find((x) => x.verb === verb)
  assert.ok(l, `no ${verb} lane`)
  return l
}

test('W49: the triple backstab is ONE 3-swing round, and frenzy is excluded wholesale', () => {
  const { seg } = replay('w49-round-triple-backstab.log')
  const r = rounds(you(seg))
  const bs = lane(r, 'backstab')

  // HAND-DERIVED from the fixture: `grep -E '^\[[^]]+\] You (backstab|try to backstab)'` gives
  // 17 attempts over 11 distinct seconds — 6 seconds with one swing, 4 with two, and
  // 17:55:20 with three. Every one of them is at a single defender, so nothing collapses.
  assert.equal(bs.rounds, 11)
  assert.deepEqual(bs.buckets, [6, 4, 1, 0])
  assert.equal(bs.fannedRounds, 0)
  assert.equal(bs.multiRounds, 5)
  assert.equal(bs.confidence, 'perEvent', 'backstab runs on a reuse timer — the split reads per event')
  assert.equal(bs.label, 'Backstab')
  // THE POINT: the 4+ bucket is empty. Backstab's ~10s timer makes a 4-swing backstab round
  // mechanically impossible, so a grouper that ever fills that bucket is wrong.
  assert.equal(bs.buckets[3], 0)

  // `grep -cE '^\[[^]]+\] You (frenzy on|try to frenzy on)'` = 30. Frenzy is multi-hit BY
  // DESIGN (four lines in the 17:55:20 second alone), so all 30 are excluded and there is no
  // frenzy lane at all.
  assert.equal(r.excluded.frenzy, 30)
  assert.equal(r.lanes.some((l) => l.verb === 'frenzy'), false)

  // RIPOSTE, both directions. `grep -E '\(Riposte\)$' | grep -cE '(YOU for|to .*YOU, but)'` = 11
  // incoming counter-swings; `grep -E '^\[…\] You ' | grep -c 'Riposte)'` = 2 of yours.
  assert.equal(r.ripostesTaken, 11, 'the mobs’ annotated counter-swings — the only evidence there is')
  assert.equal(r.ripostesGiven, 2)
  assert.equal(r.excluded.riposte, 2, 'your counter-swings are extra swings, not part of a round')
  // …and the asymmetry: the window contains ZERO `but <mob> ripostes!` lines, so `taken` can
  // only ever come from the counter itself.
  assert.equal(readFixture('w49-round-triple-backstab.log').some((l) => / ripostes!$/.test(l)), false)

  // Modifier tallies: `grep -E '^\[…\] You ' | grep -c '(Critical)'` = 21.
  assert.equal(r.modifiers.find((m) => m.name === 'Critical')?.count, 21)
})

test('W50: two cross-target fan-out seconds collapse to one round each', () => {
  const { seg } = replay('w50-round-fanout.log')
  const bs = lane(rounds(you(seg)), 'backstab')

  // HAND-DERIVED: 15 backstab seconds in the window. Seven carry one swing, six carry two at a
  // single defender, and TWO (01:30:45 and 01:30:49) print two swings at EACH of a rock golem
  // and an elemental capturer with identical ordered damage (60,51 and 92,32) — one round
  // fanned, twice. So: 15 rounds, 7 single / 8 double, two of them fanned.
  assert.equal(bs.rounds, 15)
  assert.deepEqual(bs.buckets, [7, 8, 0, 0])
  assert.equal(bs.fannedRounds, 2)
  // Ungrouped, those two seconds would have read as 4-swing backstab rounds — the exact lie
  // this collapse exists to prevent.
  assert.equal(bs.buckets[3], 0)
})

test('W51: flurry counts avoided swings too, and is never part of a round', () => {
  const { seg } = replay('w51-round-flurry-era.log')
  const r = rounds(you(seg))

  // `grep -E 'Flurry\)$'` = 3 lines: two landed slashes at 00:25:35 (nine seconds after the
  // Burst of Power purchase) and one `but miss! (Flurry)` at 00:26:53. The avoided one is the
  // point — 123 of the log's 253 flurry annotations are on miss lines.
  assert.equal(r.flurries, 3)
  assert.equal(r.modifiers.find((m) => m.name === 'Flurry')?.avoided, 1)
  assert.equal(r.excluded.flurry, 3, 'a flurry swing is an extra swing, never part of a round')

  // The rate carries its denominator, and the denominator is ROUNDS.
  assert.ok(r.primaryRounds > 0)
  assert.equal(r.flurryPct, (r.flurries / r.primaryRounds) * 100)

  // The other two exclusion reasons are populated in the same window (grep: 41 frenzy
  // attempts, 5 incoming riposte counters).
  assert.equal(r.excluded.frenzy, 41)
  assert.equal(r.ripostesTaken, 5)
  // `grep -E '^\[…\] You ' | grep -c 'Slay Undead)'` = 3 — a stated modifier tally beside them.
  assert.equal(r.modifiers.find((m) => m.name === 'Slay Undead')?.count, 3)
})

test('rounds are counted for pets and mobs too, with the same rules and no "taken" claim', () => {
  const { seg } = replay('w49-round-triple-backstab.log')
  const knight = seg.incoming.find((s) => s.name.toLowerCase().includes('knight'))
  assert.ok(knight)
  const r = rounds(knight)
  assert.ok(r.primaryRounds > 0, 'a mob has attack rounds like anyone else')
  // `ripostesTaken` is grafted onto YOUR row only: an incoming line's defender is You by
  // construction, so a mob's row could only ever restate your number under its own name.
  assert.equal(r.ripostesTaken, 0)
  assert.equal(r.rampagesTaken, 0)
})

// ── law 8: the whole feature moves no damage ────────────────────────────────────────────

const WINDOWS = ['w49-round-triple-backstab.log', 'w50-round-fanout.log', 'w51-round-flurry-era.log'] as const

/** Frozen outgoing/incoming totals for each window. The fixtures are COMMITTED, so these can
 *  only change if the model changed — which is precisely what they are here to catch. */
const TOTALS: Record<string, { out: number; in: number }> = {
  'w49-round-triple-backstab.log': { out: 9554, in: 3434 },
  'w50-round-fanout.log': { out: 12249, in: 3899 },
  'w51-round-flurry-era.log': { out: 15093, in: 4171 }
}

test('LAW 8: round stats carry no amount — every damage total is exactly what it was', () => {
  for (const w of WINDOWS) {
    const { seg } = replay(w)
    assert.equal(seg.outTotal, TOTALS[w].out, `${w}: outgoing total moved`)
    assert.equal(seg.inTotal, TOTALS[w].in, `${w}: incoming total moved`)
    for (const e of [...seg.entities, ...seg.incoming]) {
      // The per-source tripwire: categories sum to the source total, exactly.
      assert.equal(e.categories.reduce((s, c) => s + c.total, 0), e.total, `${w}/${e.name}: category sum drifted`)
    }
    assert.equal(seg.entities.reduce((s, e) => s + e.total, 0), seg.outTotal)
    assert.equal(seg.incoming.reduce((s, e) => s + e.total, 0), seg.inTotal)
  }
})

test('LAW 8: taking the same snapshot ten times never moves a round counter or a total', () => {
  for (const w of WINDOWS) {
    const { eng, lastTs } = replay(w)
    const first = JSON.stringify(eng.snapshot(lastTs + 120_000, { selectedId: 'zone' }).selected)
    for (let i = 0; i < 10; i++) {
      assert.equal(
        JSON.stringify(eng.snapshot(lastTs + 120_000, { selectedId: 'zone' }).selected),
        first,
        `${w}: snapshot #${i + 2} drifted`
      )
    }
  }
})
