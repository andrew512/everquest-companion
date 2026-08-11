// ============================================================================
// foldCheckpointPolicy.test.mts — WHEN THE CHECKPOINT IS WRITTEN, AND WHEN IT IS CHECKED.
// ============================================================================
//
// JOS-208 phase 3's two scheduling rules (`src/main/foldCache/policy.ts`), plus the comparison the
// shadow verifier runs. Pure, Electron-free, never skips — the reason those functions live in a
// file of their own rather than beside the timers that call them.
//
// WHY EACH ONE IS PINNED:
//
//   * THE QUIET-POINT RULE exists because of a MEASURED defect. Phase 1 wrote only on the clean-quit
//     paths, electron-vite's dev watcher kills its child instead of quitting it, and the owner
//     therefore ran the feature for a day with the preference on and never got a single restore or
//     even a file. The write schedule is now the feature's whole reachability, so its rule is not a
//     tuning knob any more.
//   * THE SHADOW SAMPLE is the design's "never runs the identity reads cold twice in a row —
//     sample, do not always-verify". A verification is a full cold read of the log, i.e. exactly the
//     cost the checkpoint exists to remove. A rule that quietly said yes too often would hand the
//     slow launch back to everybody and call it instrumentation.
//   * THE COMPARISON feeds a counter whose expected value is zero forever, so a FALSE divergence is
//     worse than a missed one: it is the kill switch tripping for no reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUIET_MIN_BYTES,
  QUIET_MIN_INTERVAL_MS,
  SHADOW_DEV_MIN_GAP_MS,
  SHADOW_DEV_SAMPLE,
  SHADOW_FLEET_MIN_GAP_MS,
  SHADOW_FLEET_SAMPLE,
  divergentModules,
  quietWriteDue,
  shadowOverride,
  shouldRunShadow
} from '../src/main/foldCache/policy'

// --------------------------------------------------------------------- the quiet-point rewrite

/** A session an hour past its last write, idle, with a megabyte of new log behind it. */
const quiet = (over: Partial<Parameters<typeof quietWriteDue>[0]> = {}): boolean =>
  quietWriteDue({
    offset: 1_000_000,
    previousOffset: 1_000_000,
    writtenOffset: 0,
    nowMs: 3_600_000,
    lastWriteMs: 0,
    ...over
  })

test('a quiet-point rewrite needs something new, an idle log, AND a reason', () => {
  // The base case: an hour has passed, so time alone earns the write even though only a megabyte
  // of log arrived.
  assert.equal(quiet(), true)

  // 1. NOTHING NEW ⇒ never. A rewrite at the byte the last one described is a copy, and the
  //    serialization it costs buys the next launch exactly nothing.
  assert.equal(quiet({ writtenOffset: 1_000_000 }), false)
  assert.equal(quiet({ offset: 500_000, previousOffset: 500_000, writtenOffset: 1_000_000 }), false)

  // 2. THE LOG IS STILL MOVING ⇒ never, however overdue. This is the idleness test, and it is a
  //    comparison of two readings of the tail's offset rather than a clock in the fold: if a
  //    complete line arrived during the last check interval, the offset moved. A write here would
  //    serialize every module in the middle of the fight the user is watching the meter for.
  assert.equal(quiet({ previousOffset: 999_000 }), false)
  assert.equal(quiet({ previousOffset: 999_000, nowMs: 86_400_000 }), false)

  // 3. NEITHER ENOUGH BYTES NOR ENOUGH TIME ⇒ not yet. Idle and new, but only just.
  assert.equal(quiet({ nowMs: 1_000, lastWriteMs: 0, offset: 4_096, previousOffset: 4_096 }), false)
})

test('either threshold is enough on its own — bytes OR minutes, never both', () => {
  // BYTES, on a session that wrote seconds ago: a raid that dumped 8 MB into the log in ten
  // minutes leaves the next launch an 8 MB tail, and waiting out the clock would not make that
  // better. `previousOffset` still has to match, so this is 8 MB followed by a quiet minute.
  const bytes = {
    offset: QUIET_MIN_BYTES,
    previousOffset: QUIET_MIN_BYTES,
    writtenOffset: 0,
    nowMs: 1_000,
    lastWriteMs: 0
  }
  assert.equal(quietWriteDue(bytes), true)
  assert.equal(quietWriteDue({ ...bytes, offset: QUIET_MIN_BYTES - 1, previousOffset: QUIET_MIN_BYTES - 1 }), false)

  // TIME, on a session that has barely logged: an afternoon parked in the guild hall still moves
  // the fold (buff clocks, zone lines), and the exact boundary is asserted rather than approached.
  const time = { offset: 10, previousOffset: 10, writtenOffset: 0, nowMs: QUIET_MIN_INTERVAL_MS, lastWriteMs: 0 }
  assert.equal(quietWriteDue(time), true)
  assert.equal(quietWriteDue({ ...time, nowMs: QUIET_MIN_INTERVAL_MS - 1 }), false)
})

// ------------------------------------------------------------------------- the shadow sample

const sample = (over: Partial<Parameters<typeof shouldRunShadow>[0]> = {}): boolean =>
  shouldRunShadow({ enabled: true, dev: false, lastRunMs: 0, nowMs: 1_000_000_000, draw: 0, ...over })

test('a verification never runs when the checkpoint is off — the feature costs nothing when off', () => {
  // The same rule attach.ts states for the event probe. An install that has never turned the
  // checkpoint on must not pay a background cold fold to verify a file it does not have.
  assert.equal(sample({ enabled: false, draw: 0 }), false)
  assert.equal(sample({ enabled: false, dev: true, draw: 0 }), false)
})

test('the duty cycle is the "never twice in a row" rule, expressed in TIME', () => {
  const now = 1_000_000_000
  // An installed build that verified an hour ago does not verify again today, however lucky the
  // draw: the point of the gap is that a machine never pays two background cold reads close
  // together, and a fleet sample is spread across installs rather than repeated on one.
  assert.equal(sample({ nowMs: now, lastRunMs: now - 60 * 60_000, draw: 0 }), false)
  assert.equal(sample({ nowMs: now, lastRunMs: now - SHADOW_FLEET_MIN_GAP_MS, draw: 0 }), true)
  // A DEV build's gap is far shorter — that is where a divergence actually gets fixed, so the
  // verification has to be provokable within a working session.
  assert.equal(sample({ dev: true, nowMs: now, lastRunMs: now - 60 * 60_000, draw: 0 }), true)
  assert.equal(sample({ dev: true, nowMs: now, lastRunMs: now - SHADOW_DEV_MIN_GAP_MS + 1, draw: 0 }), false)
  // A mark in the FUTURE reads as "just ran", not as "long overdue". A settings file copied
  // between machines (or a clock that stepped back) must not license a cold read on every launch.
  assert.equal(sample({ nowMs: now, lastRunMs: now + 60 * 60_000, draw: 0 }), false)
  // Never having run at all is not a gap — a fresh install may verify on its first eligible launch.
  assert.equal(sample({ nowMs: now, lastRunMs: 0, draw: 0 }), true)
})

test('the sample rate is the thing that keeps this off almost every launch', () => {
  // The draw is injected, so these are statements about the RATE rather than about luck. An
  // installed build declines 98 launches in 100; a dev build takes half of them.
  assert.equal(sample({ draw: SHADOW_FLEET_SAMPLE - 0.001 }), true)
  assert.equal(sample({ draw: SHADOW_FLEET_SAMPLE }), false)
  assert.equal(sample({ dev: true, draw: SHADOW_DEV_SAMPLE - 0.001 }), true)
  assert.equal(sample({ dev: true, draw: SHADOW_DEV_SAMPLE }), false)
  // And the fleet rate really is the rarer of the two — the property that matters is the ORDER,
  // not the two numbers, since either may be retuned as the rollout proceeds.
  assert.ok(SHADOW_FLEET_SAMPLE < SHADOW_DEV_SAMPLE)
  assert.ok(SHADOW_DEV_MIN_GAP_MS < SHADOW_FLEET_MIN_GAP_MS)
})

test('the environment override forces or forbids, and says nothing otherwise', () => {
  // The same shape `EQ_FOLD_CACHE` reads, deliberately: the owner provokes a check by hand and the
  // e2e spec observes the whole path without waiting for a 2% draw.
  for (const on of ['1', 'true', 'ON', ' on ']) assert.equal(shadowOverride(on), true, on)
  for (const off of ['0', 'false', 'OFF', ' off ']) assert.equal(shadowOverride(off), false, off)
  for (const quietVal of [undefined, '', 'yes', 'maybe', '2']) {
    assert.equal(shadowOverride(quietVal), null, String(quietVal))
  }
})

// --------------------------------------------------------------------------- the comparison

test('the comparison ignores KEY ORDER and nothing else', () => {
  // Both arms are built by the same code, so key order should already agree — relying on that
  // would be relying on an accident, and a spurious divergence trips a kill switch.
  const warm = { loot: { seq: 4, state: { a: 1, b: [1, 2] } }, kills: { seq: 9, state: {} } }
  const cold = { kills: { seq: 9, state: {} }, loot: { seq: 4, state: { b: [1, 2], a: 1 } } }
  assert.deepEqual(divergentModules(warm, cold), [])

  // A real difference, at any depth, is named — and named by MODULE, which is what goes to the
  // local errors.log. (Nothing here reaches the wire; the wire gets a count. See shared/telemetry.)
  assert.deepEqual(divergentModules(warm, { ...cold, loot: { seq: 4, state: { a: 2, b: [1, 2] } } }), ['loot'])
  // ARRAY ORDER IS NOT A KEY ORDER. Two folds that produced the same rows in a different sequence
  // have genuinely diverged: half this app's snapshots are ordered lists and the order is the
  // answer.
  assert.deepEqual(divergentModules(warm, { ...cold, loot: { seq: 4, state: { a: 1, b: [2, 1] } } }), ['loot'])
  // `seq` counts: for `respawn` and `combo` it is the module's OWN revision counter, so a round
  // trip that lost it would leave the renderer deduping away the first real delta.
  assert.deepEqual(divergentModules(warm, { ...cold, kills: { seq: 10, state: {} } }), ['kills'])
  // A module MISSING from one side is a divergence, not a skip — that is how a unit that quietly
  // stopped publishing would show up.
  assert.deepEqual(divergentModules(warm, { loot: cold.loot }), ['kills'])
  // Several diverge ⇒ all of them, sorted, so two runs of the same defect read identically.
  assert.deepEqual(divergentModules(warm, {}), ['kills', 'loot'])
})
