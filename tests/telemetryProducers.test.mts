/**
 * telemetryProducers.test.mts — the half of usage analytics that JOS-39 built: the code that
 * DECIDES what a producer reports, pinned without Electron and without a cluster.
 *
 * The producers themselves (src/main/session.ts, src/main/updater.ts, src/main/ipc/speech.ts) are
 * wiring: they call one of these functions at a moment in their own lifecycle, and the moment is
 * what tests/e2e/telemetry.e2e.mts asserts against the running app. What lives here is everything
 * that can be wrong ARITHMETICALLY or SEMANTICALLY:
 *
 *   * `classifyFailure` — an error message reduced to one of five words, against the REAL strings
 *     the two failure producers emit (copied from speech/provision.ts and electron-updater);
 *   * the once-ever funnel ledger's data model (`allFunnelStepMarks` + the prefs normalizer);
 *   * `linesParsed` — that the optional field survives validation, is dropped when absent, and
 *     folds into the `linesParsed` counter from BOTH events that carry it.
 *
 * Why the failure classifier gets a test of its own: it is the one place in this feature where a
 * STRING is read, and its whole job is to make sure no part of that string can leave. A wrong
 * class is also actively misleading — "12 checksum failures" sends an operator to look at a CDN —
 * so each arm is pinned against a message that really occurs, not against an invented one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure, failureTextOf } from '../src/main/telemetry/failureClass'
import {
  allFunnelStepMarks,
  funnelStepMark,
  normalizeTelemetryPrefs,
  MAX_COUNT,
  TELEMETRY_FUNNEL_STEPS,
  type TelemetryEvent
} from '../src/shared/telemetry'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'
import { rollupBatch, DIM_NONE, USAGE_METRICS } from '../src/shared/telemetryRollup'
import type { TelemetryBatch } from '../src/shared/telemetry'

// ---- the failure classifier ------------------------------------------------------------

test('every failure class is reached by a message a real producer actually emits', () => {
  // LEFT COLUMN: verbatim from src/main/speech/provision.ts and from electron-updater's own
  // failure paths (updater.ts research §6 enumerates them). RIGHT: the word the schema allows.
  const cases: [string, string][] = [
    ['kokoro-v1.0.onnx: sha256 mismatch (got abc123)', 'checksum'],
    ['sha512 checksum mismatch, expected …', 'checksum'],
    ['voices-v1.0.bin: short read, got 91234 of 92000 bytes', 'network'],
    ['HTTP 403 for kokoro-v1.0.onnx', 'network'],
    ['empty body for voices-v1.0.bin', 'network'],
    ['getaddrinfo ENOTFOUND github.com', 'network'],
    ['read ECONNRESET', 'network'],
    ['net::ERR_CERT_AUTHORITY_INVALID certificate', 'network'],
    ['could not create C:\\Users\\x\\speech\\kokoro: Error: EACCES: permission denied', 'disk'],
    ['ENOSPC: no space left on device', 'disk'],
    ['The operation was aborted due to timeout', 'timeout'],
    ['connect ETIMEDOUT 140.82.121.4:443', 'timeout'],
    ['Cannot find channel "main"', 'other'],
    ['', 'other']
  ]
  for (const [message, expected] of cases) {
    assert.equal(classifyFailure(message), expected, message)
  }
})

test('the classifier takes anything and NEVER hands the message back', () => {
  // Its return type is a five-member union, so this is a property of the signature — the test is
  // here to pin that no arm was ever "helpfully" widened to pass the text through.
  const classes = ['network', 'checksum', 'disk', 'timeout', 'other']
  for (const raw of [null, undefined, 42, {}, new Error('Primitive@Vox: ENOSPC'), ['x']]) {
    assert.ok(classes.includes(classifyFailure(raw)), JSON.stringify(raw))
  }
  // The text helper is the only thing that reads a message, and it stays on the main side.
  assert.equal(failureTextOf(new Error('boom')), 'boom')
  assert.equal(failureTextOf({ message: 'wrapped' }), 'wrapped')
  assert.equal(failureTextOf(7), '7')
})

// ---- the once-ever ledger --------------------------------------------------------------

test('the ledger can express every step of the two install funnels, and only real pairs', () => {
  // The first-run and voice-install funnels are once-ever per install; the feedback funnel is
  // per-REPORT and is deliberately NOT marked (src/main/telemetry/funnels.ts says why), but its
  // marks are still legal spellings — nothing in the ledger is funnel-specific.
  const marks = allFunnelStepMarks()
  for (const funnel of ['first-run', 'voice-install'] as const) {
    for (const step of TELEMETRY_FUNNEL_STEPS[funnel]) {
      assert.ok(marks.includes(funnelStepMark(funnel, step)), `${funnel}:${step}`)
    }
  }
  // A step of one funnel is not a step of another — the pair is what is marked, exactly as the
  // validator checks the pair rather than the step alone.
  assert.ok(!marks.includes('first-run:engineSelected'))
  assert.ok(!marks.includes('voice-install:installed'))
})

test('a mark, once written, is idempotent under the normalizer — a step cannot be re-earned', () => {
  const once = normalizeTelemetryPrefs({ funnelsDone: ['first-run:installed'] })
  const twice = normalizeTelemetryPrefs(once)
  assert.deepEqual(twice.funnelsDone, ['first-run:installed'])
  // …and the ledger is the ONLY thing that grows: enabling/disabling does not touch it, which is
  // what stops `installed` firing again after an opt-out and opt-in (collector.ts drops the id
  // and the ring on the way out; the marks are deliberately not in either).
  assert.equal(twice.analyticsId, null)
})

// ---- linesParsed -----------------------------------------------------------------------

const ID = '2b1b5c33-6a1a-4d3e-8f0b-2c9a5d1e7f40'

function batchOf(events: TelemetryEvent[]): TelemetryBatch {
  return {
    v: 1,
    env: { analyticsId: ID, appVersion: '0.6.0', channel: 'prod', platform: 'win32', tzOffsetBucket: -5 },
    events: events.map((ev) => ({ ts: 1_754_000_000_000, ev }))
  }
}

function counterOf(batch: TelemetryBatch, metric: string): number {
  return rollupBatch(batch, { firstOfDay: false, newInstall: false })
    .counters.filter((c) => c.metric === metric)
    .reduce((sum, c) => sum + c.n, 0)
}

test('linesParsed is OPTIONAL on both session reports — absent survives, present is bounded', () => {
  // ABSENT IS THE OLD CLIENT AND THE OLD SERVER AT ONCE. The field is optional precisely so that
  // a build without it validates, and so that a server whose copy of the schema predates it drops
  // the field and accepts the batch (src/shared/telemetry.ts, THE ADDITIVE-FIELD RULE) instead of
  // answering 400 — which main/telemetry/net.ts treats as permanent and would DROP the batch.
  const bare = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 300_000 })
  assert.ok(bare.ok && !('linesParsed' in bare.value))

  const carried = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 300_000, linesParsed: 4_212 })
  assert.ok(carried.ok && carried.value.t === 'sessionHeartbeat' && carried.value.linesParsed === 4_212)

  const ended = validateTelemetryEvent({
    t: 'sessionEnd',
    durationMs: 60_000,
    viewsVisited: 2,
    linesParsed: 9
  })
  assert.ok(ended.ok && ended.value.t === 'sessionEnd' && ended.value.linesParsed === 9)

  // Same ceiling as every other count, and the same refusals: negative, fractional, over-cap.
  for (const bad of [-1, 1.5, MAX_COUNT + 1, '900', Number.NaN]) {
    const out = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 1, linesParsed: bad })
    assert.ok(!out.ok && out.field === 'linesParsed', JSON.stringify(bad))
  }
  // `null` is "nothing to add", not junk — the same reading `failureClass` gives it.
  const nulled = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 1, linesParsed: null })
  assert.ok(nulled.ok && !('linesParsed' in nulled.value))
})

test('the fleet counter is a SUM OF DELTAS from both events, and an absent field adds nothing', () => {
  const rolled = batchOf([
    { t: 'sessionHeartbeat', uptimeMs: 300_000, linesParsed: 1_000 },
    { t: 'sessionHeartbeat', uptimeMs: 600_000, linesParsed: 250 },
    // A heartbeat from a session that parsed nothing (an idle log) — legal, and adds nothing.
    { t: 'sessionHeartbeat', uptimeMs: 900_000 },
    { t: 'sessionEnd', durationMs: 950_000, viewsVisited: 3, linesParsed: 17 }
  ])
  assert.equal(counterOf(rolled, USAGE_METRICS.linesParsed), 1_267)
  // The heartbeat count is untouched by the passenger field: three heartbeats, three heartbeats.
  assert.equal(counterOf(rolled, USAGE_METRICS.heartbeats), 3)
  const counters = rollupBatch(rolled, { firstOfDay: false, newInstall: false }).counters
  const lines = counters.filter((c) => c.metric === USAGE_METRICS.linesParsed)
  assert.equal(lines.length, 1, 'one dimensionless row — a per-line dimension would be a log')
  assert.equal(lines[0].dim, DIM_NONE)
})

test('a batch with no line counts at all produces NO linesParsed row, rather than a zero', () => {
  // `add()` refuses non-positive numbers, so "nobody reported any" is an ABSENT row. That is the
  // difference between a day the fleet parsed nothing and a day nobody sent anything, and the
  // read path (a SUM over rows) reads them the same way — which is correct for a counter.
  const rolled = batchOf([{ t: 'sessionHeartbeat', uptimeMs: 1 }])
  assert.equal(counterOf(rolled, USAGE_METRICS.linesParsed), 0)
  assert.ok(
    !rollupBatch(rolled, { firstOfDay: false, newInstall: false }).counters.some(
      (c) => c.metric === USAGE_METRICS.linesParsed
    )
  )
})
