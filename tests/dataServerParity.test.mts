// THE IN-APP PARITY PROBE'S JUDGEMENT (src/main/dataServer/parityProbe.ts, JOS-479).
//
// The probe is the only thing in this program that compares the two worlds INSIDE the running
// product, and its whole value is that its verdicts can be trusted at a glance in a dev log. So the
// awkward answers — a mark mismatch, a module one side does not hold, a stamp that means nothing —
// are pinned here, with no app, no socket and no Rust binary, because that is where they are
// cheap and deterministic. `tests/e2e/engine-parity.e2e.mts` is the other half: the same code
// against a real engine folding a real fixture.
//
// THE CLAIM THIS FILE CARES ABOUT MOST IS THE ANTI-VACUITY ONE. A probe that quietly compared
// nothing and reported "0 divergences" would be strictly worse than no probe: it would read like
// proof. So DRIFT is a SKIP, skips are counted separately from agreements, and the line says so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARITY_LINE_PREFIX,
  PARITY_PROBE_MODULES,
  judgeParity,
  normalizeState,
  parityLine,
  shortValue,
  tallyParity,
  verdictFor,
  type ParityAsk,
  type ParityVerdict
} from '../src/main/dataServer/parityProbe'

/** One ask, spelled the short way. */
function ask(module: string, engine: ParityAsk['engine'], app: ParityAsk['app'], refusal?: string): ParityAsk {
  return refusal === undefined ? { module, engine, app } : { module, engine, app, refusal }
}

const LOG = 'C:\\Users\\Public\\…\\Logs\\eqlog_Primitive_freeport.txt'

function line(verdicts: ParityVerdict[]): string {
  return parityLine({
    logPath: LOG,
    mark: { log: LOG, offset: 129297 },
    epoch: 2,
    engineStatus: 'live',
    engineEvents: 1599,
    verdicts
  })
}

test('two states at the same mark, deep-equal, AGREE', () => {
  const state = { rows: [{ item: 'Rusty Dagger', at: 12 }], total: 1 }
  const v = verdictFor(ask('loot', { seq: 41, state }, { seq: 41, state: structuredClone(state) }))
  assert.equal(v.kind, 'agree')
  assert.equal(v.kind === 'agree' ? v.seq : -1, 41)
})

test('key ORDER is not a claim — the same object written differently still agrees', () => {
  // The oracle's rule, restated here because it is the property that lets a Rust fold be right in a
  // different order: a snapshot is assembled on demand, so insertion order is not something either
  // world promises about a module's state.
  const v = verdictFor(
    ask('character', { seq: 3, state: { zone: 'Freeport', level: 42 } }, { seq: 3, state: { level: 42, zone: 'Freeport' } })
  )
  assert.equal(v.kind, 'agree')
})

test('two states at the same mark that differ DIVERGE, naming the first path and both values', () => {
  const v = verdictFor(
    ask('buffs', { seq: 1598, state: { active: [1, 2, 3] } }, { seq: 1598, state: { active: [1] } })
  )
  assert.equal(v.kind, 'diverge')
  if (v.kind !== 'diverge') return
  assert.equal(v.path, '.active.length')
  // The ENGINE is `expected` — it is the side being proven, exactly as at the bench.
  assert.equal(v.engine, '3')
  assert.equal(v.app, '1')
})

test('DIFFERENT MARKS ARE NEVER COMPARED — the drift is skipped and both seqs are reported', () => {
  const v = verdictFor(
    ask('kills', { seq: 900, state: { mobs: {} } }, { seq: 1200, state: { mobs: { orc: 4 } } })
  )
  assert.equal(v.kind, 'skipped')
  if (v.kind !== 'skipped' || v.why !== 'drift') return assert.fail('expected a drift skip')
  assert.equal(v.engineSeq, 900)
  assert.equal(v.appSeq, 1200)
})

test('a skip is NOT an agreement — the tally and the line keep them apart', () => {
  const verdicts = judgeParity([
    ask('loot', { seq: 7, state: [] }, { seq: 7, state: [] }),
    ask('kills', { seq: 7, state: {} }, { seq: 9, state: {} })
  ])
  const t = tallyParity(verdicts)
  assert.deepEqual(t, { agree: 1, diverge: 0, skipped: 1 })
  const text = line(verdicts)
  assert.match(text, /1 agree, 0 diverge, 1 skipped of 2/)
  assert.match(text, /kills SKIP\(drift: engine seq 7 vs app seq 9\)/)
})

test('a module the ENGINE refuses and a module THIS APP lacks are different sentences', () => {
  const refused = verdictFor(ask('loot.ledger', null, { seq: 1, state: {} }, 'notFound: this engine folds no module named "loot.ledger"'))
  assert.equal(refused.kind, 'skipped')
  assert.match(refused.kind === 'skipped' && refused.why === 'unanswered' ? refused.detail : '', /notFound/)
  const absentHere = verdictFor(ask('leveling', { seq: 5, state: {} }, null))
  assert.equal(absentHere.kind, 'skipped')
  assert.equal(absentHere.kind === 'skipped' && absentHere.why === 'unanswered' ? absentHere.detail : '', 'this app holds no such module')
})

test('`updatedAt` is stripped from BOTH worlds — a read stamp is not a fold divergence', () => {
  // `overlay.updatedAt` is stamped with the wall clock when a snapshot is TAKEN, so two folds of
  // the same bytes disagree about it. The golden oracle drops exactly this field; so does the probe.
  const v = verdictFor(
    ask(
      'buffs',
      { seq: 4, state: { overlay: { updatedAt: 111, counts: { a: 1 } } } },
      { seq: 4, state: { overlay: { updatedAt: 999, counts: { a: 1 } } } }
    )
  )
  assert.equal(v.kind, 'agree')
  assert.deepEqual(normalizeState({ overlay: { updatedAt: 5, n: 1 } }), { overlay: { n: 1 } })
})

test('the app side is round-tripped through JSON, so a serializer opinion is not a divergence', () => {
  // An `undefined` value exists in a live object graph and vanishes on the wire; comparing the two
  // directly would report the SERIALIZER's behaviour as a fold difference.
  const v = verdictFor(ask('character', { seq: 2, state: { zone: 'Freeport' } }, { seq: 2, state: { zone: 'Freeport', level: undefined } }))
  assert.equal(v.kind, 'agree')
})

test('a divergent value is bounded — a module state is as long as the module says it is', () => {
  const huge = shortValue({ rows: Array.from({ length: 500 }, (_, i) => `row ${String(i)}`) })
  assert.ok(huge.length <= 82, huge)
  assert.ok(huge.endsWith('…'))
  assert.equal(shortValue(undefined), '(absent)')
})

test('the line names every module, states its coordinate, and carries the prefix the harness finds it by', () => {
  const verdicts = judgeParity(
    PARITY_PROBE_MODULES.map((m) => ask(m, { seq: 1598, state: { m } }, { seq: 1598, state: { m } }))
  )
  const text = line(verdicts)
  assert.ok(text.startsWith(PARITY_LINE_PREFIX), text)
  assert.match(text, /5 agree, 0 diverge, 0 skipped of 5/)
  assert.match(text, /\[epoch 2, engine live, 1599 events, mark 129297 of C:\\Users\\Public/)
  for (const m of PARITY_PROBE_MODULES) assert.match(text, new RegExp(`${m} AGREE\\(seq 1598\\)`))
  assert.equal(text.includes('\n'), false, 'ONE line per probe run')
})

test('a probe taken before either world has folded says so rather than inventing numbers', () => {
  const text = parityLine({
    logPath: LOG,
    mark: null,
    epoch: null,
    engineStatus: 'attaching',
    engineEvents: null,
    verdicts: []
  })
  assert.match(text, /\[no epoch, engine attaching, nothing folded, no engine mark yet, app C:\\/)
  assert.match(text, /0 agree, 0 diverge, 0 skipped of 0/)
})

test('TWO FOLDS OF DIFFERENT FILES IS A SHOUT, not a field to compare by eye', () => {
  // It is the one failure that would make every other number in the line meaningless: agreement
  // would be luck, and divergence would be a defect report about nothing.
  const text = parityLine({
    logPath: 'C:\\a\\eqlog_Primitive_freeport.txt',
    mark: { log: 'C:\\b\\eqlog_Someone_else.txt', offset: 12 },
    epoch: 2,
    engineStatus: 'live',
    engineEvents: 3,
    verdicts: []
  })
  assert.match(text, /LOG MISMATCH: app C:\\a\\eqlog_Primitive_freeport\.txt but engine C:\\b\\eqlog_Someone_else\.txt @12/)
})

test('the probe set is the five the ticket named, and the ids are the registry\'s own spelling', () => {
  assert.deepEqual([...PARITY_PROBE_MODULES], ['loot', 'kills', 'leveling', 'character', 'buffs'])
})
