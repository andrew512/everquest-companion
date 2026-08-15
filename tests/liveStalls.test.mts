/**
 * liveStalls.test.mts — the LIVE session's own numbers (JOS-367), end to end.
 *
 * WHAT THE FEATURE CLAIMS, because every assertion below is a term of it: field reports describe
 * ~1 s EverQuest freezes while this app runs, and we cannot see the game's frame time. So the app
 * runs the SAME lateness probe on two threads — main, and a worker that does nothing else — and
 * counts the windows in which BOTH went late. That count is the difference between "the machine
 * stalled" and "we stalled", and it is the one number a single-threaded instrument cannot produce.
 * Beside it ride what our own tail reads cost and what was switched on at the time.
 *
 * A SEPARATE FILE BY SUBJECT, the `startupDiscriminators.test.mts` precedent: the probe fold, the
 * coincidence matcher, the wire shape, the validators, the rollup and the two readouts are one
 * story, and `tests/perf.test.mts`, `tests/telemetryProducers.test.mts` and
 * `tests/usageAnalytics.test.mts` are all at the repo's 400-code-line ceiling.
 *
 * Pure: no Electron, no worker thread, no clock, so it never skips. The probe's TIMERS are the one
 * thing not asserted here — a timer that fires is the e2e's job (tests/e2e/perf.e2e.mts); what is
 * asserted here is every decision made about the samples once they exist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketOf,
  LOG_SIZE_BYTES_EDGES,
  NEW_BYTES_EDGES,
  TELEMETRY_OVERLAY_KINDS,
  type TelemetryEvent
} from '../src/shared/telemetry'
import {
  FREE_MEM_GB_EDGES,
  LIVE_STALL_MS_EDGES,
  WORKING_SET_MB_EDGES
} from '../src/shared/telemetryLive'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'

// ---- the wire shape ------------------------------------------------------------------------

/** A heartbeat with every rider on it, at values a real session could produce. */
function fullHeartbeat(): Record<string, unknown> {
  return {
    t: 'sessionHeartbeat',
    uptimeMs: 600_000,
    live: { samples: 2400, p95Bucket: 2, maxBucket: 6, over100: 4, over500: 1, coincident: 1 },
    tail: {
      reads: 812,
      reopens: 0,
      p95Bucket: 1,
      maxBucket: 4,
      over100: 2,
      over500: 0,
      deltaBytesBucket: 3,
      logSizeBucket: 3
    },
    state: {
      overlaysOpen: 2,
      overlaysLocked: 1,
      presenceOn: true,
      ringOn: false,
      freeMemBucket: 3,
      workingSetBucket: 2
    }
  }
}

test('the three riders survive validation on a heartbeat, field for field', () => {
  const result = validateTelemetryEvent(fullHeartbeat())
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  assert.equal(ev.t, 'sessionHeartbeat')
  if (ev.t !== 'sessionHeartbeat') return
  assert.deepEqual(ev.live, {
    samples: 2400,
    p95Bucket: 2,
    maxBucket: 6,
    over100: 4,
    over500: 1,
    coincident: 1
  })
  assert.equal(ev.tail?.reads, 812)
  assert.equal(ev.tail?.deltaBytesBucket, 3)
  assert.equal(ev.state?.overlaysLocked, 1)
  assert.equal(ev.state?.presenceOn, true)
})

test('sessionEnd carries the same three riders — the startup rider rides both, and so do these', () => {
  const end = { ...fullHeartbeat(), t: 'sessionEnd', durationMs: 900_000, viewsVisited: 3 }
  delete end.uptimeMs
  const result = validateTelemetryEvent(end)
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  if (ev.t !== 'sessionEnd') throw new Error('not a sessionEnd')
  assert.equal(ev.live?.samples, 2400)
  assert.equal(ev.tail?.reopens, 0)
  assert.equal(ev.state?.ringOn, false)
})

test('ABSENT IS LEGAL AND MEANS NOTHING TO SAY — an unattached session sends no `tail` at all', () => {
  // The three groups are independent. A session with no character attached has no read latency to
  // describe, and a row of zeros from it would drag every fleet figure toward a machine that did
  // no work — so the group is omitted rather than zero-filled.
  const bare = { t: 'sessionHeartbeat', uptimeMs: 1_000, live: fullHeartbeat().live }
  const result = validateTelemetryEvent(bare)
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  if (ev.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(ev.tail, undefined)
  assert.equal(ev.state, undefined)
  assert.equal(ev.live?.samples, 2400)
  // …and a heartbeat with none of the three is exactly the event an older client sends.
  const old = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 1_000 })
  assert.equal(old.ok, true)
})

test('`coincident` ABSENT and `coincident` ZERO are different answers, and both are accepted', () => {
  // Absent: the probe worker was not running, so there is no second clock and no verdict.
  const noWorker = { t: 'sessionHeartbeat', uptimeMs: 1_000, live: { samples: 10, p95Bucket: 0, maxBucket: 0, over100: 0, over500: 0 } }
  const a = validateTelemetryEvent(noWorker)
  assert.equal(a.ok, true)
  const evA = (a as { value: TelemetryEvent }).value
  if (evA.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(evA.live?.coincident, undefined)
  assert.equal('coincident' in (evA.live ?? {}), false)

  // Zero: two clocks WERE compared and never went late together — the reading that says the
  // fault is ours. It must survive as a real zero rather than being folded into "unknown".
  const compared = { ...noWorker, live: { ...noWorker.live, over100: 3, coincident: 0 } }
  const b = validateTelemetryEvent(compared)
  assert.equal(b.ok, true)
  const evB = (b as { value: TelemetryEvent }).value
  if (evB.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(evB.live?.coincident, 0)
})

test('OUT-OF-LADDER VALUES ARE REFUSED, by name — a bucket index is not a millisecond', () => {
  const refuse = (patch: Record<string, unknown>, field: string): void => {
    const ev = { ...fullHeartbeat(), ...patch }
    const result = validateTelemetryEvent(ev)
    assert.equal(result.ok, false, `${field} should have been refused`)
    assert.equal((result as { field: string }).field, field)
  }
  const live = fullHeartbeat().live as Record<string, unknown>
  const tail = fullHeartbeat().tail as Record<string, unknown>
  const state = fullHeartbeat().state as Record<string, unknown>
  // One past the top bucket of each ladder. `bucketOf` can never produce these, so a client that
  // sends one is a client this server should not believe.
  refuse({ live: { ...live, p95Bucket: LIVE_STALL_MS_EDGES.length + 1 } }, 'live.p95Bucket')
  refuse({ live: { ...live, maxBucket: -1 } }, 'live.maxBucket')
  refuse({ live: { ...live, coincident: 2.5 } }, 'live.coincident')
  refuse({ tail: { ...tail, deltaBytesBucket: NEW_BYTES_EDGES.length + 1 } }, 'tail.deltaBytesBucket')
  refuse({ tail: { ...tail, logSizeBucket: LOG_SIZE_BYTES_EDGES.length + 1 } }, 'tail.logSizeBucket')
  refuse({ state: { ...state, freeMemBucket: FREE_MEM_GB_EDGES.length + 1 } }, 'state.freeMemBucket')
  refuse(
    { state: { ...state, workingSetBucket: WORKING_SET_MB_EDGES.length + 1 } },
    'state.workingSetBucket'
  )
  // Overlay counts are counts of WINDOWS, so their ceiling is the number of overlay kinds — not
  // `MAX_COUNT`. Nine open overlays is not a busy install, it is a broken client.
  refuse(
    { state: { ...state, overlaysOpen: TELEMETRY_OVERLAY_KINDS.length + 1 } },
    'state.overlaysOpen'
  )
  refuse({ state: { ...state, presenceOn: 'yes' } }, 'state.presenceOn')
  // A group that is present must be COMPLETE: a percentile with no sample count under it is not a
  // percentile of anything.
  refuse({ live: { p95Bucket: 1 } }, 'live.samples')
  refuse({ tail: { reads: 1 } }, 'tail.reopens')
  refuse({ live: 7 }, 'live')
})

test('THE LADDER TOPS OUT PAST A SECOND, which the startup ladder does not', () => {
  // The freezes this ticket exists for are reported at about a second. A ladder whose top bucket
  // is "≥ 250 ms" (STUTTER_MS_EDGES, the startup probe's) would put a 300 ms hiccup and a 3 s
  // lockup in the same row and answer nothing — which is why this ladder is its own.
  assert.ok(LIVE_STALL_MS_EDGES.includes(1_000))
  assert.ok(LIVE_STALL_MS_EDGES[LIVE_STALL_MS_EDGES.length - 1] >= 2_500)
  // …and it keeps low rungs around Windows' 15.6 ms quantum, so a healthy session still reads as
  // a distribution rather than as one full bottom bucket.
  assert.equal(bucketOf(12, LIVE_STALL_MS_EDGES), 1)
  assert.equal(bucketOf(1_100, LIVE_STALL_MS_EDGES), 7)
})
