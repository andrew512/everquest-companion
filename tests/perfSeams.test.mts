// Stall attribution: the seam and GC vocabulary and its arithmetic (src/shared/perfSeams.ts,
// src/main/perfAttribution.ts — JOS-458).
//
// WHAT THIS SUITE IS FOR. Two field reports describe main-process stalls of 250-1186 ms whose
// two-clock verdict says the fault is OURS, and the whole point of this instrument is that the
// NEXT such report arrives naming a seam. That naming is a fold over readings taken during a
// freeze on a machine we do not own and cannot re-run — so the arithmetic is pinned HERE, on
// injected samples, exactly as `noteLiveProbeSamples` and `foldFeedbackPerf` are pinned.
//
// The five properties it exists to hold:
//
//   1. THE ENUM IS CLOSED, and it is the bright line. Nothing that leaves this instrument can
//      carry a string the machine produced; every seam identifier is a member of `PERF_SEAMS`.
//   2. ABSENCE IS A READING. A seam never entered has no entry, a GC observer that is not running
//      has no tally — and neither is a row of zeros, because "we did no work there" and "we were
//      not watching" are different findings from "it was fast".
//   3. THE WORST CALL IS FOUND, AND TIES ARE STATED. `worstSeam` names one culprit, and two runs
//      of the same session name the same call.
//   4. THE DRAIN IS A DELTA. Whichever reader drains first resets the accumulator, so a
//      fleet-wide sum is a sum of deltas — the discipline `takeLiveProbeReading` keeps.
//   5. THE RING IS BOUNDED BY BOTH ITS CLOCK AND ITS CAP, and stays bounded under a pathological
//      caller, which is the session this instrument exists to describe.
//
// No Electron, no network, no fixtures — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GC_KINDS,
  PERF_SEAMS,
  SEAM_LATE_MS,
  SEAM_STALL_MS,
  SEAM_WINDOW_MS,
  addGcPause,
  addSeamCall,
  emptyGcTally,
  worstSeam,
  type SeamTally
} from '../src/shared/perfSeams'
import { PERF_INTERVAL_MS } from '../src/shared/feedbackPerf'
import { LIVE_PROBE_REPORT_MS, LIVE_STALL_LATE_MS, LIVE_TIMELINE_MS } from '../src/shared/perfLive'
import {
  noteGcSamples,
  noteSeam,
  peekAttributionTimeline,
  resetStallAttribution,
  takeGcTally,
  takeSeamTally,
  timeSeam
} from '../src/main/perfAttribution'

const NOW = 1_800_000_000_000

// ---- 1. the enum, and the constants that must not drift apart ---------------------------------

test('the seam enum is closed, unique and the six the ticket names', () => {
  assert.deepEqual([...PERF_SEAMS], [
    'moduleSnapshot',
    'combatSnapshot',
    'registryFlush',
    'inventoryLoad',
    'achievementsLoad',
    'worldRebuilt'
  ])
  assert.equal(new Set(PERF_SEAMS).size, PERF_SEAMS.length)
  assert.deepEqual([...GC_KINDS], ['minor', 'major', 'other'])
})

test('the seam window is the feedback block grid, and the two thresholds are the live ones', () => {
  // Restated by VALUE in three files that may not import each other (perfSeams.ts declares itself
  // zero-import). If any of these drift, a seam reading can no longer be lined up against the
  // lateness row it is supposed to explain, which is the whole use of it.
  assert.equal(SEAM_WINDOW_MS, PERF_INTERVAL_MS)
  assert.equal(SEAM_LATE_MS, LIVE_PROBE_REPORT_MS)
  assert.equal(SEAM_STALL_MS, LIVE_STALL_LATE_MS)
})

// ---- 2/3. the seam fold ------------------------------------------------------------------------

test('a seam tally counts calls, keeps the max, and stamps the worst call', () => {
  let t: SeamTally = {}
  t = addSeamCall(t, 'worldRebuilt', 12, NOW)
  t = addSeamCall(t, 'worldRebuilt', 480, NOW + 100)
  t = addSeamCall(t, 'worldRebuilt', 9, NOW + 200)
  const entry = t.worldRebuilt
  assert.ok(entry)
  assert.equal(entry.calls, 3)
  assert.equal(entry.maxMs, 480)
  assert.equal(entry.totalMs, 501)
  assert.equal(entry.worstAt, NOW + 100)
})

test('a seam never entered has no entry — absence is the reading that clears it', () => {
  const t = addSeamCall({}, 'registryFlush', 30, NOW)
  assert.equal(t.inventoryLoad, undefined)
  assert.equal(Object.keys(t).length, 1)
})

test('addSeamCall never mutates its input', () => {
  const before: SeamTally = {}
  const after = addSeamCall(before, 'combatSnapshot', 5, NOW)
  assert.deepEqual(before, {})
  assert.ok(after.combatSnapshot)
})

test('a tie keeps the FIRST call that reached the maximum, so two reads agree', () => {
  let t: SeamTally = {}
  t = addSeamCall(t, 'moduleSnapshot', 300, NOW)
  t = addSeamCall(t, 'moduleSnapshot', 300, NOW + 5_000)
  assert.equal(t.moduleSnapshot?.worstAt, NOW)
})

test('a NaN or negative duration folds to zero rather than poisoning the max', () => {
  let t: SeamTally = {}
  t = addSeamCall(t, 'inventoryLoad', Number.NaN, NOW)
  t = addSeamCall(t, 'inventoryLoad', -40, NOW)
  assert.equal(t.inventoryLoad?.maxMs, 0)
  assert.equal(t.inventoryLoad?.totalMs, 0)
  assert.equal(t.inventoryLoad?.calls, 2)
})

test('worstSeam names one culprit, and answers null when none was entered', () => {
  assert.equal(worstSeam({}), null)
  let t: SeamTally = {}
  t = addSeamCall(t, 'combatSnapshot', 90, NOW)
  t = addSeamCall(t, 'worldRebuilt', 1_186, NOW + 1)
  t = addSeamCall(t, 'registryFlush', 120, NOW + 2)
  const worst = worstSeam(t)
  assert.equal(worst?.seam, 'worldRebuilt')
  assert.equal(worst?.entry.maxMs, 1_186)
})

test('worstSeam breaks a tie in PERF_SEAMS order, so the answer is stable', () => {
  let t: SeamTally = {}
  t = addSeamCall(t, 'worldRebuilt', 200, NOW)
  t = addSeamCall(t, 'combatSnapshot', 200, NOW)
  assert.equal(worstSeam(t)?.seam, 'combatSnapshot')
})

// ---- the GC fold -------------------------------------------------------------------------------

test('a GC tally splits majors out and counts the ones past the stall threshold', () => {
  let g = emptyGcTally()
  g = addGcPause(g, { at: NOW, ms: 3, kind: 'minor' })
  g = addGcPause(g, { at: NOW + 100, ms: 640, kind: 'major' })
  g = addGcPause(g, { at: NOW + 200, ms: 110, kind: 'major' })
  g = addGcPause(g, { at: NOW + 300, ms: 2, kind: 'other' })
  assert.equal(g.pauses, 4)
  assert.equal(g.majorPauses, 2)
  assert.equal(g.maxMs, 640)
  assert.equal(g.totalMs, 755)
  assert.equal(g.over100, 2)
  assert.equal(g.worstAt, NOW + 100)
})

test('an empty GC tally is zeros — a running observer that saw nothing HAS measured something', () => {
  assert.deepEqual(emptyGcTally(), {
    pauses: 0,
    majorPauses: 0,
    maxMs: 0,
    totalMs: 0,
    over100: 0,
    worstAt: 0
  })
})

// ---- 4. the drain, and the instrument's own state ----------------------------------------------

test('the seam drain is a DELTA: the second read of an unchanged interval is null', () => {
  resetStallAttribution()
  noteSeam('registryFlush', 40, NOW)
  const first = takeSeamTally()
  assert.equal(first?.registryFlush?.calls, 1)
  assert.equal(takeSeamTally(), null)
  resetStallAttribution()
})

test('the GC drain is null while the observer is not running, and zeros once it is', () => {
  resetStallAttribution()
  // `startStallAttribution` is deliberately NOT called: this asserts the absent arm, which is the
  // distinction between "no reading available" and "a reading of zero pauses".
  assert.equal(takeGcTally(), null)
  noteGcSamples([{ at: NOW, ms: 200, kind: 'major' }])
  const drained = takeGcTally()
  assert.equal(drained?.pauses, 1)
  assert.equal(drained.majorPauses, 1)
  // The injection created the tally, so the NEXT drain is zeros rather than null — a tally that
  // exists stays existing until the observer is stopped and the instrument is reset.
  assert.equal(takeGcTally()?.pauses, 0)
  resetStallAttribution()
})

test('timeSeam returns the body value and records the call', () => {
  resetStallAttribution()
  const out = timeSeam('moduleSnapshot', () => 41 + 1)
  assert.equal(out, 42)
  assert.equal(takeSeamTally()?.moduleSnapshot?.calls, 1)
  resetStallAttribution()
})

test('timeSeam lets a throw travel, and still records the call that threw', () => {
  resetStallAttribution()
  assert.throws(() =>
    timeSeam('achievementsLoad', () => {
      throw new Error('dump is a directory')
    })
  )
  assert.equal(takeSeamTally()?.achievementsLoad?.calls, 1)
  resetStallAttribution()
})

// ---- 5. the ring ------------------------------------------------------------------------------

test('only LATE calls reach the ring; every call reaches the tally', () => {
  resetStallAttribution()
  noteSeam('combatSnapshot', SEAM_LATE_MS - 1, NOW)
  noteSeam('combatSnapshot', SEAM_LATE_MS, NOW + 1)
  assert.equal(takeSeamTally()?.combatSnapshot?.calls, 2)
  assert.equal(peekAttributionTimeline(NOW + 2).seams.length, 1)
  resetStallAttribution()
})

test('the ring drops samples older than the ten-minute window', () => {
  resetStallAttribution()
  noteSeam('worldRebuilt', 300, NOW - LIVE_TIMELINE_MS - 1)
  noteSeam('worldRebuilt', 300, NOW - 1_000)
  const seen = peekAttributionTimeline(NOW).seams
  assert.equal(seen.length, 1)
  assert.equal(seen[0].at, NOW - 1_000)
  resetStallAttribution()
})

test('the ring stays bounded under a caller that never stops — cap, not just clock', () => {
  resetStallAttribution()
  // Every sample is inside the window, so the TIME bound cannot help: this is the cap's own test,
  // and the pathological session is exactly the one this instrument is for.
  for (let i = 0; i < 20_000; i++) noteSeam('moduleSnapshot', 50, NOW + i)
  const seen = peekAttributionTimeline(NOW + 20_000).seams
  assert.ok(seen.length <= 2_000, `ring grew to ${String(seen.length)}`)
  // …and it kept the NEWEST, which is the half a report about a freeze just now needs.
  assert.equal(seen[seen.length - 1].at, NOW + 19_999)
  resetStallAttribution()
})

test('the GC ring keeps the pause kind, unbucketed, for the report that reads it', () => {
  resetStallAttribution()
  noteGcSamples([
    { at: NOW, ms: 4, kind: 'minor' },
    { at: NOW + 1, ms: 612, kind: 'major' }
  ])
  const gc = peekAttributionTimeline(NOW + 2).gc
  assert.equal(gc.length, 1)
  assert.equal(gc[0].kind, 'major')
  assert.equal(gc[0].ms, 612)
  resetStallAttribution()
})
