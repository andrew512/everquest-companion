// ============================================================================
// THE CLIENT HALF of the error report (JOS-100) — the ring, the dedupe, the capture.
// ============================================================================
//
// `tests/errorReportContract.test.mts` pins the SHAPE (what the wire will accept).
// This pins the PRODUCER: that the breadcrumb ring says what happened, that one error twice in
// one session is one exemplar and two counts, and that a report built from a real thrown Error
// carries nothing from the game.
//
// It drives the real leaf modules directly. They import no Electron and no store — that is the
// whole point of their being leaves (see their headers) — so this suite NEVER SKIPS.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentMode,
  noteEventKind,
  noteReplaying,
  readBreadcrumbs,
  resetBreadcrumbs
} from '../src/main/telemetry/breadcrumbs'
import {
  noteCurrentView,
  noteError,
  peekErrorReports,
  resetErrorReports,
  takeErrorReports
} from '../src/main/telemetry/errorReports'
import { MAX_SESSION_FINGERPRINTS, SESSION_AGE_MS_EDGES } from '../src/shared/telemetry'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'

/** Every test starts from a clean session; the modules are process-global by design. */
function fresh(now = 1_000_000): void {
  resetErrorReports(now)
}

// =========================================================================================
// 1. THE BREADCRUMB RING
// =========================================================================================

test('the ring reports the last ten kinds NEWEST FIRST, with offsets back from the newest', () => {
  resetBreadcrumbs()
  assert.deepEqual(readBreadcrumbs(), [], 'nothing parsed yet is an empty list, not a fake one')

  noteEventKind('zone', 10_000)
  noteEventKind('damage', 11_200)
  noteEventKind('loot', 11_500)
  assert.deepEqual(readBreadcrumbs(), [
    { kind: 'loot', offsetMs: 0 },
    { kind: 'damage', offsetMs: 300 },
    { kind: 'zone', offsetMs: 1_500 }
  ])
})

test('the ring is a RING: eleven events keep the last ten', () => {
  resetBreadcrumbs()
  for (let i = 0; i < 11; i++) noteEventKind(i === 0 ? 'zone' : 'damage', 1_000 + i * 100)
  const crumbs = readBreadcrumbs()
  assert.equal(crumbs.length, 10)
  // The `zone` at index 0 has been pushed out; every survivor is a damage line.
  assert.equal(crumbs.some((c) => c.kind === 'zone'), false)
  assert.equal(crumbs[0].offsetMs, 0)
  assert.equal(crumbs[9].offsetMs, 900)
})

test('offsets are COARSE, capped, and never negative', () => {
  resetBreadcrumbs()
  noteEventKind('damage', 0)
  noteEventKind('heal', 60 * 60_000) // an hour later — past the 10-minute cap
  noteEventKind('loot', 60 * 60_000 + 40) // 40 ms later — rounds to 0
  const crumbs = readBreadcrumbs()
  assert.equal(crumbs[0].offsetMs, 0)
  assert.equal(crumbs[1].offsetMs, 0, '40 ms rounds down to nothing — the question is coarse')
  assert.equal(crumbs[2].offsetMs, 10 * 60_000, 'capped, never a raw hour')

  // A NON-MONOTONIC STAMP READS AS ZERO, never as a negative. Log timestamps have one-second
  // resolution and a derived event inherits its parent's `ts`, so out-of-order pairs are
  // ordinary — and a negative offset would be REFUSED by the wire validator, costing a real
  // crash report over a rounding artefact.
  resetBreadcrumbs()
  noteEventKind('damage', 5_000)
  noteEventKind('buffExpired', 1_000)
  assert.deepEqual(readBreadcrumbs(), [
    { kind: 'buffExpired', offsetMs: 0 },
    { kind: 'damage', offsetMs: 0 }
  ])
})

test('mode comes from the REPLAY BRACKET, not from a per-event flag', () => {
  resetBreadcrumbs()
  assert.equal(currentMode(), 'live', 'a process that never replayed is live')
  noteReplaying(true)
  assert.equal(currentMode(), 'replay')
  noteReplaying(false)
  assert.equal(currentMode(), 'live')
})

// =========================================================================================
// 2. THE DEDUPE — the acceptance criterion, stated as a test
// =========================================================================================

/** A thrown Error with a real V8-shaped stack under the bundle root. */
function thrown(message: string, fn = 'foldEvent', line = 120): Error {
  const err = new TypeError(message)
  err.stack = [
    `TypeError: ${message}`,
    `    at ${fn} (C:\\Users\\jmoye\\eqc\\out\\main\\pipeline.js:${String(line)}:15)`,
    '    at LogBus.emit (C:\\Users\\jmoye\\eqc\\out\\main\\log\\bus.js:78:20)'
  ].join('\n')
  return err
}

test('THE SAME ERROR TWICE IN ONE SESSION IS ONE EXEMPLAR AND TWO COUNTS', () => {
  fresh()
  noteError('main:uncaughtException', thrown('x is not a function'))
  noteError('main:uncaughtException', thrown('x is not a function'))

  const held = peekErrorReports()
  assert.equal(held.length, 1, 'one fingerprint')
  assert.equal(held[0].n, 2, 'two occurrences')

  const drained = takeErrorReports()
  assert.equal(drained.length, 1, 'ONE exemplar leaves the client, not two')
  assert.equal(drained[0].count, 2)
  assert.equal(validateTelemetryEvent(drained[0]).ok, true, 'and it is a legal event')
})

test('the drain is a DELTA: a second drain with nothing new reports nothing', () => {
  fresh()
  noteError('main:uncaughtException', thrown('boom'))
  assert.equal(takeErrorReports().length, 1)
  assert.equal(takeErrorReports().length, 0, 'a heartbeat with nothing to say says nothing')

  // …and a recurrence AFTER a drain re-sends the same exemplar with the NEW count only. The
  // server's UPSERT is first-wins on the exemplar, so re-sending it is free and idempotent.
  noteError('main:uncaughtException', thrown('boom'))
  noteError('main:uncaughtException', thrown('boom'))
  const again = takeErrorReports()
  assert.equal(again.length, 1)
  assert.equal(again[0].count, 2, 'the count is since the last drain, never a running total')
})

test('different errors are different issues', () => {
  fresh()
  noteError('main:uncaughtException', thrown('a', 'foldEvent', 120))
  noteError('main:uncaughtException', thrown('b', 'otherFn', 400))
  const drained = takeErrorReports()
  assert.equal(drained.length, 2)
  assert.notEqual(drained[0].fingerprint, drained[1].fingerprint)

  // …but the MESSAGE alone does not split an issue. A message carries the varying part, so
  // folding it into the fingerprint would shatter one bug into a hundred singletons — which is
  // the failure mode that makes an error dashboard useless.
  fresh()
  noteError('main:uncaughtException', thrown("open 'C:\\a\\1.json'"))
  noteError('main:uncaughtException', thrown("open 'C:\\b\\2.json'"))
  assert.equal(takeErrorReports().length, 1, 'same name, same frames, one issue')
})

test('THE STORM BOUND: a session cannot mint unbounded distinct exemplars', () => {
  fresh()
  for (let i = 0; i < MAX_SESSION_FINGERPRINTS + 5; i++) {
    noteError('main:uncaughtException', thrown('x', `fn${String(i)}`, i + 1))
  }
  assert.equal(peekErrorReports().length, MAX_SESSION_FINGERPRINTS)
  // …and repeats of an issue ALREADY held still count. The cap limits distinct exemplars, never
  // the totals of what is being tracked.
  noteError('main:uncaughtException', thrown('x', 'fn0', 1))
  const held = peekErrorReports().find((h) => h.n === 2)
  assert.ok(held, 'a repeat of a tracked fingerprint still increments')
})

// =========================================================================================
// 3. WHAT A REPORT ACTUALLY CARRIES
// =========================================================================================

test('a captured error is a legal event carrying frames, crumbs, view, age and mode', () => {
  fresh(1_000_000)
  resetBreadcrumbs()
  noteEventKind('zone', 500)
  noteEventKind('damage', 1_000)
  noteCurrentView('combat')
  noteReplaying(true)

  const err = thrown('cannot read length of undefined')
  ;(err as unknown as { code?: string }).code = 'ERR_INVALID_ARG'
  // 40 minutes into the session — bucket 3 of SESSION_AGE_MS_EDGES (1m/5m/30m/2h).
  noteError('renderer:ErrorBoundary', err, 1_000_000 + 40 * 60_000)

  const [ev] = takeErrorReports()
  const res = validateTelemetryEvent(ev)
  assert.equal(res.ok, true, res.ok ? '' : res.message)
  assert.equal(ev.errorName, 'TypeError')
  assert.equal(ev.code, 'ERR_INVALID_ARG')
  assert.equal(ev.view, 'combat')
  assert.equal(ev.mode, 'replay')
  assert.equal(ev.sessionAgeBucket, 3)
  assert.equal(ev.sessionAgeBucket <= SESSION_AGE_MS_EDGES.length, true)
  assert.deepEqual(ev.breadcrumbs, [
    { kind: 'damage', offsetMs: 0 },
    { kind: 'zone', offsetMs: 500 }
  ])
  // THE FRAMES ARE BUNDLE-RELATIVE. The account name in the stack does not survive.
  assert.deepEqual(
    ev.frames.map((f) => f.file),
    ['out/main/pipeline.js', 'out/main/log/bus.js']
  )
  assert.equal(JSON.stringify(ev).includes('jmoye'), false, 'no account name anywhere in it')
  noteReplaying(false)
})

test('THE BRIGHT LINE: a thrown LOG LINE reaches the wire with no gameplay in it', () => {
  fresh()
  // The plausible accident: a parser that throws with the line it choked on. This is the exact
  // shape `tests/e2e/telemetry.e2e.mts` asserts against a log-line-bearing fixture.
  const line = "[Sat Aug 01 13:00:28 2026] Kahaptra Z`Taj hits Primitive for 412 points of damage."
  noteError('main:uncaughtException', thrown(`parseDamage failed on ${line}`))
  const [ev] = takeErrorReports()
  assert.equal(validateTelemetryEvent(ev).ok, true)
  const wire = JSON.stringify(ev)
  for (const leak of ['Kahaptra', 'Primitive', '412', 'points of damage', 'Aug 01']) {
    assert.equal(wire.includes(leak), false, `${leak} survived into: ${ev.redactedMessage}`)
  }
  assert.match(ev.redactedMessage, /^parseDamage failed on <logline>$/)
})

test('a view the enum does not carry is `unknown`, never a guess', () => {
  fresh()
  noteCurrentView('character') // UNRELEASED — deliberately not in the dwell enum
  noteError('renderer:onerror', thrown('boom'))
  assert.equal(takeErrorReports()[0].view, 'unknown')

  fresh()
  noteCurrentView({ evil: true })
  noteCurrentView('Plane of Sky')
  noteError('renderer:onerror', thrown('boom'))
  assert.equal(takeErrorReports()[0].view, 'unknown', 'untrusted input never sticks')
})

test('the producer is TOTAL: anything at all can be thrown at it', () => {
  fresh()
  for (const junk of [undefined, null, 42, 'a bare string', {}, [], new Error()]) {
    noteError('main:unhandledRejection', junk)
  }
  for (const ev of takeErrorReports()) {
    assert.equal(validateTelemetryEvent(ev).ok, true, `${JSON.stringify(ev)} must be legal`)
  }
})

test('a failure INSIDE the error logger does not mint a report about the error logger', () => {
  // `logError` tags its own last-resort line `[errorLog]`. Reporting on that source would be a
  // report about the path that is already failing to write, produced by the writer that failed.
  fresh()
  noteError('errorLog', thrown('failed to write errors.log'))
  assert.deepEqual(peekErrorReports(), [])
})

test('resetting a session drops the pending reports AND the crumbs behind them', () => {
  fresh()
  noteEventKind('damage', 1)
  noteError('main:uncaughtException', thrown('boom'))
  assert.equal(peekErrorReports().length, 1)
  // This is what `endSession` does when the user turns the switch off: counted-but-unreported
  // errors must not be waiting to ride the next report if it is turned back on.
  resetErrorReports(0)
  assert.deepEqual(peekErrorReports(), [])
  assert.deepEqual(readBreadcrumbs(), [])
})
