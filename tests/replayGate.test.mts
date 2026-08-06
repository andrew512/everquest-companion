// The replay gate (src/main/replayGate.ts) — "nothing rides the mouse or the screen until
// parsing is done" (JOS-62), in test form.
//
// Everything asserted here is PURE: the three predicates that decide whether a window may be
// shown, whether a locked overlay installs the WH_MOUSE_LL forwarding hook, and what the cursor
// ring (window + 8 ms sampler) should be doing. No Electron, no windows, no log — so this suite
// is as cheap and as unskippable as presence/overlayLayout.
//
// The two properties worth pinning are the ones a reviewer would otherwise have to take on
// trust:
//
//   1. THE GATE ONLY EVER TAKES THINGS AWAY. `mayShowWindows` is a conjunction with the E2E flag
//      in it, so no state of the replay flag can make a window showable in the headless harness —
//      which is what makes this feature INERT under EQ_E2E=1 structurally rather than by reading
//      src/main/e2e.ts and hoping.
//   2. THE SEQUENCING ACROSS START/DONE RESTORES EXACTLY WHAT IT SUSPENDED. A replay that starts
//      and finishes must leave every predicate answering what it answered before, for every kind
//      — no lock state is copied on the way in, so nothing can be restored wrongly on the way out.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  historicalReplayRunning,
  mayShowWindows,
  overlayForwardsMouse,
  ringDisposition,
  setHistoricalReplayRunning
} from '../src/main/replayGate'
import { OVERLAY_KINDS } from '../src/shared/types'

test('mayShowWindows: E2E dominates, and the replay only ever removes a show', () => {
  assert.equal(mayShowWindows(false, false), true)
  // The whole feature: a fold in flight means no overlay and no ring on screen.
  assert.equal(mayShowWindows(false, true), false)
  // …and the harness's contract survives both states of the new flag.
  assert.equal(mayShowWindows(true, false), false)
  assert.equal(mayShowWindows(true, true), false)
})

test('overlayForwardsMouse: the toast never forwards, and nobody forwards mid-replay', () => {
  for (const kind of OVERLAY_KINDS) {
    // Steady state: every meter forwards (its hover sensor is what re-enables capture over the
    // pin); the toast is the standing exception (JOS-40 — its capture comes from its queue).
    assert.equal(overlayForwardsMouse(kind, false), kind !== 'toast', `${kind} outside a replay`)
    // During the fold NOTHING installs the hook — that hook is the reported jerky mouselook.
    assert.equal(overlayForwardsMouse(kind, true), false, `${kind} during a replay`)
  }
})

test('the gate flips and restores, leaving every kind exactly as it found it', () => {
  const before = {
    running: historicalReplayRunning(),
    forward: OVERLAY_KINDS.map((k) => overlayForwardsMouse(k, historicalReplayRunning()))
  }
  assert.equal(before.running, false, 'nothing is replaying before a replay starts')

  setHistoricalReplayRunning(true)
  assert.equal(historicalReplayRunning(), true)
  for (const kind of OVERLAY_KINDS) {
    assert.equal(overlayForwardsMouse(kind, historicalReplayRunning()), false)
  }
  assert.equal(mayShowWindows(false, historicalReplayRunning()), false)

  setHistoricalReplayRunning(false)
  assert.equal(historicalReplayRunning(), false)
  assert.deepEqual(
    OVERLAY_KINDS.map((k) => overlayForwardsMouse(k, historicalReplayRunning())),
    before.forward,
    'every kind is back to the mode it had before the replay'
  )
  assert.equal(mayShowWindows(false, historicalReplayRunning()), true)
})

test('ringDisposition: the 8 ms sampler gate, including the replay window', () => {
  const on = { enabled: true, hasBounds: true, active: true, replayRunning: false }
  // The steady states this predicate already had.
  assert.equal(ringDisposition(on), 'run')
  assert.equal(ringDisposition({ ...on, active: false }), 'idle')
  assert.equal(ringDisposition({ ...on, hasBounds: false }), 'suspended')
  assert.equal(ringDisposition({ ...on, enabled: false }), 'off')

  // JOS-62: a fold suspends the ring however active it would otherwise be — no window is created,
  // nothing is shown, and (the point) no sampler runs.
  assert.equal(ringDisposition({ ...on, replayRunning: true }), 'suspended')
  assert.equal(ringDisposition({ ...on, active: false, replayRunning: true }), 'suspended')
  // …but the user's own switch still outranks it: off is off, and the window is destroyed rather
  // than parked, replay or no replay.
  assert.equal(ringDisposition({ ...on, enabled: false, replayRunning: true }), 'off')
})
