// A RUN OF THREE, AND WHAT IT IS ALLOWED TO SAY (JOS-397).
//
// The run detector is the half of the recency ruling that does NOT touch the number: `R`, the
// interval and both landing percentages stay the decayed long-run estimate, and what a run adds is
// one sentence and one word. So what has to be pinned here is exactly the set of rules that keep
// that sentence rare and true - three minimum, unlikely under the estimate the surface is already
// printing, your own informative casts only, and gone by itself the moment the run breaks.
//
// The RING half is driven through the real `ResistFold` in tests/resistFold.test.mts, because what
// gets remembered is a property of the fold and not of this arithmetic.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LATELY_MAX_PROB,
  LATELY_MIN_RUN,
  RESIST_RECENT_CAP,
  detectLately,
  impliedBand,
  leadingRun,
  outcomeOf,
  recentOnAxis,
  type ResistRecentRead,
} from '../src/shared/resistLately'
import { SPELLS } from './resistFixtures.mts'
import type { ResistRecentSeries } from '../src/shared/resistTypes'

const NO_MODES = new Map()
/** The three-in-a-row the owner reported, newest first. */
const THREE_RESISTS: ResistRecentRead[] = [
  { ts: 300, spellKey: 'test hold', outcome: 'resist', resistAdj: 0 },
  { ts: 200, spellKey: 'test hold', outcome: 'resist', resistAdj: 0 },
  { ts: 100, spellKey: 'test hold', outcome: 'resist', resistAdj: 0 },
]

test('the leading run is what the NEWEST outcomes did, and a partial belongs to neither side', () => {
  assert.deepEqual(leadingRun(THREE_RESISTS), { run: 3, side: 'resisted' })
  assert.deepEqual(leadingRun([]), null)
  // A landing at the head ends the resist run at zero and starts its own.
  assert.deepEqual(
    leadingRun([{ ts: 400, spellKey: 's', outcome: 'land', resistAdj: 0 }, ...THREE_RESISTS]),
    { run: 1, side: 'landed' }
  )
  // Full damage IS a landing; a silent partial is the roll going against you on a spell that
  // cannot be refused, so it breaks a run of landings and a run of resists alike.
  assert.deepEqual(
    leadingRun([
      { ts: 3, spellKey: 's', outcome: 'full', resistAdj: 0 },
      { ts: 2, spellKey: 's', outcome: 'land', resistAdj: 0 },
      { ts: 1, spellKey: 's', outcome: 'full', resistAdj: 0 },
    ]),
    { run: 3, side: 'landed' }
  )
  assert.equal(leadingRun([{ ts: 1, spellKey: 's', outcome: 'partial', resistAdj: 0 }]), null)
  assert.deepEqual(
    leadingRun([
      { ts: 3, spellKey: 's', outcome: 'land', resistAdj: 0 },
      { ts: 2, spellKey: 's', outcome: 'partial', resistAdj: 0 },
      { ts: 1, spellKey: 's', outcome: 'land', resistAdj: 0 },
    ]),
    { run: 1, side: 'landed' }
  )
})

test('THREE IN A ROW, MINIMUM, AND UNLIKELY UNDER THE ESTIMATE ALREADY ON SCREEN', () => {
  assert.equal(LATELY_MIN_RUN, 3)
  assert.equal(LATELY_MAX_PROB, 0.1)
  const ctx = { pLand: 0.7, viewerLevel: 50, mobLevel: 50 }

  // Two is not a run, however surprising: two of anything happens constantly.
  assert.equal(detectLately(THREE_RESISTS.slice(0, 2), ctx), null)

  // THE OWNER'S CASE. A cell whose long-run answer says a plain cast lands 70% of the time, and
  // three resists in a row: 0.3^3 = 2.7%, so the card is allowed to say something.
  const hit = detectLately(THREE_RESISTS, ctx)
  assert.ok(hit)
  assert.equal(hit.run, 3)
  assert.equal(hit.outcome, 'resisted')
  assert.ok(Math.abs(hit.probability - 0.027) < 1e-9)

  // AND A MOB THAT ALREADY READS RESISTANT GETS NOTHING. Three resists against a 35% landing chance
  // is a 27% event - the ordinary Tuesday the card already predicted, and saying `lately resistant`
  // about it would be the card agreeing with itself in a louder voice.
  assert.equal(detectLately(THREE_RESISTS, { ...ctx, pLand: 0.35 }), null)
  // Give it two more and the same cell does earn the line: 0.65^5 = 11.6%... still not, and 6 does.
  const six: ResistRecentRead[] = Array.from({ length: 6 }, (_v, i) => ({
    ts: 600 - i,
    spellKey: 'test hold',
    outcome: 'resist', resistAdj: 0,
  }))
  assert.equal(detectLately(six.slice(0, 5), { ...ctx, pLand: 0.35 }), null)
  assert.ok(detectLately(six, { ...ctx, pLand: 0.35 }))
})

test('A RUN OF LANDINGS IS THE SAME RULE, MIRRORED', () => {
  const landed: ResistRecentRead[] = [
    { ts: 3, spellKey: 'test hold', outcome: 'land', resistAdj: 0 },
    { ts: 2, spellKey: 'test hold', outcome: 'full', resistAdj: 0 },
    { ts: 1, spellKey: 'test hold', outcome: 'land', resistAdj: 0 },
  ]
  // A creature the estimate says refuses four casts in five, landing three running: 0.2^3 = 0.8%.
  const hit = detectLately(landed, { pLand: 0.2, viewerLevel: 50, mobLevel: 50 })
  assert.ok(hit)
  assert.equal(hit.outcome, 'landed')
  // And the band it implies is the easy end, which is the point: the card stops saying `very
  // resistant` at somebody whose last three casts all landed.
  assert.ok(hit.tag === 'normal' || hit.tag === 'weak', hit.tag)
})

test('AND IT ENDS BY ITSELF: one landing after three resists, and the line is simply not there', () => {
  const ctx = { pLand: 0.7, viewerLevel: 50, mobLevel: 50 }
  assert.ok(detectLately(THREE_RESISTS, ctx))
  const broken: ResistRecentRead[] = [{ ts: 400, spellKey: 'test hold', outcome: 'land', resistAdj: 0 }, ...THREE_RESISTS]
  // Nothing was cleared and nothing expired. The newest outcome is a landing, so the leading run is
  // one, and one is not a run - the derivation IS the clearing.
  assert.equal(detectLately(broken, ctx), null)
})

test('the band a run implies is computed through the SAME benchmark the estimate uses', () => {
  const even = { viewerLevel: 50, mobLevel: 50, resistAdj: 0 }
  // Three resists with a uniform prior put the resist probability at 0.5^(1/4) = 84%, so rc is
  // about 168 and a plain cast lands 16% of the time: `needs overchannel`, i.e. `resistant`.
  assert.equal(impliedBand(3, 'resisted', even).tag, 'resistant')
  assert.equal(impliedBand(3, 'resisted', even).guidance, 'needs overchannel')

  // THE LEVEL GAP CANCELS, and it has to: the run HAPPENED at that gap, so the resistance it
  // demonstrates already includes it. A band that re-added the level term would count it twice.
  assert.equal(impliedBand(3, 'resisted', { ...even, mobLevel: 70 }).tag, 'resistant')

  // A run of PLAIN casts can never reach the top band, however long it runs, and the arithmetic
  // says why: rc tops out at 200 and overchannel is worth -150, so a plain cast is always better
  // than the 60% line. Ten in a row is 94%, not 100%.
  assert.equal(impliedBand(10, 'resisted', even).tag, 'resistant')

  // WHAT DOES REACH IT is a run on casts that were already helped. Three resists of a -95-adjust
  // spell put the creature's own R a hundred points higher, and a plain cast at that R is past the
  // point overchannel rescues: `lately very resistant`.
  assert.equal(impliedBand(3, 'resisted', { ...even, resistAdj: -95 }).tag, 'very resistant')
  assert.equal(
    impliedBand(3, 'resisted', { ...even, resistAdj: -95 }).guidance,
    'may not land even with overchannel'
  )

  // The mirror: three landings say the resist probability is about 16%.
  assert.equal(impliedBand(3, 'landed', even).guidance, 'should land')
})

test('THE RING IS JOINED TO AN AXIS ON READ, and only informative spells enter it', () => {
  const series: ResistRecentSeries[] = [
    // A magic hold: three resists, the newest last (append order).
    { mobKey: 'm', spellKey: 'test hold', out: [{ ts: 1, resist: true }, { ts: 2, resist: true }, { ts: 3, resist: true }] },
    // A -250 proc on the same axis, cast constantly and landing every time. It could not have been
    // resisted at any R, so its outcomes are not evidence and must not break the run above.
    { mobKey: 'm', spellKey: 'test proc', out: [{ ts: 4 }, { ts: 5 }, { ts: 6 }] },
    // A fire lure, wrong axis entirely.
    { mobKey: 'm', spellKey: 'test lure', out: [{ ts: 7 }] },
  ]
  const reads = recentOnAxis(series, { spells: SPELLS, axis: 'magic', modes: NO_MODES })
  assert.equal(reads.length, 3)
  assert.ok(reads.every((r) => r.spellKey === 'test hold'))
  assert.deepEqual(leadingRun(reads), { run: 3, side: 'resisted' })
  // Newest first, which is the order every rule above is stated in.
  assert.deepEqual(reads.map((r) => r.ts), [3, 2, 1])
})

test('the ring never reports more than the last ten, however many spells fed it', () => {
  assert.equal(RESIST_RECENT_CAP, 10)
  const series: ResistRecentSeries[] = ['test hold', 'test hold b'].map((spellKey, s) => ({
    mobKey: 'm',
    spellKey,
    out: Array.from({ length: RESIST_RECENT_CAP }, (_v, i) => ({ ts: i * 2 + s })),
  }))
  const reads = recentOnAxis(series, { spells: SPELLS, axis: 'magic', modes: NO_MODES })
  assert.equal(reads.length, RESIST_RECENT_CAP)
  // The newest ten of the twenty, which is what "the last ten outcomes on this axis" means.
  assert.deepEqual(reads.map((r) => r.ts), [19, 18, 17, 16, 15, 14, 13, 12, 11, 10])
})

test('an outcome reads full-versus-partial off the same reference the estimator does', () => {
  const info = SPELLS['test nuke']
  const ref = { value: 150, allOrNothing: false }
  assert.equal(outcomeOf({ ts: 1, resist: true }, info, ref), 'resist')
  assert.equal(outcomeOf({ ts: 1, dmg: 150 }, info, ref), 'full')
  // 3% of slack below the reference is still full - the server rounds, and a focus only pushes up.
  assert.equal(outcomeOf({ ts: 1, dmg: 146 }, info, ref), 'full')
  assert.equal(outcomeOf({ ts: 1, dmg: 90 }, info, ref), 'partial')
  // A focused hit is above the reference and is full, not a second base value.
  assert.equal(outcomeOf({ ts: 1, dmg: 190 }, info, ref), 'full')
  // NO PARTIAL INFORMATION, three ways: no reference, an all-or-nothing spell, no hitpoint slot.
  assert.equal(outcomeOf({ ts: 1, dmg: 90 }, info, undefined), 'land')
  assert.equal(outcomeOf({ ts: 1, dmg: 90 }, info, { value: 150, allOrNothing: true }), 'land')
  assert.equal(outcomeOf({ ts: 1, dmg: 90 }, SPELLS['test hold'], ref), 'land')
  // And a line with no number at all is a landing with nothing more to say.
  assert.equal(outcomeOf({ ts: 1 }, info, ref), 'land')
})
