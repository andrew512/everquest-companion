// The ALERT TEXT overlay's QUEUE (docs/plans/alert-text-overlays.md §5).
//
// Every timing rule this surface has is a pure reducer over an explicit `dtMs`
// (src/renderer/src/overlay/alertTextQueue.ts), which is what lets this file assert them in
// milliseconds instead of by watching a window: no DOM, no timers, no Electron, never skips.
//
// The rules under test, stated as the product states them:
//   * a line holds for its own duration, then plays a short exit and is gone;
//   * ARRIVALS ALWAYS STACK — including two firings of the SAME alert, which is the owner's
//     headline requirement and the one place this deliberately differs from the celebration
//     toast (whose repeat ids refresh a card in place);
//   * arrival order is render order (newest underneath), so a line does not move under your eyes;
//   * the cap evicts the OLDEST, never the one that just arrived;
//   * each line runs its OWN clock, so a short one leaving does not disturb a long one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_TEXT_CAP,
  ALERT_TEXT_EXIT_MS,
  ALERT_TEXT_FALLBACK_MS,
  alertTextReduce,
  type AlertTextCardState
} from '../src/renderer/src/overlay/alertTextQueue'
import type { AlertTextCard } from '../src/shared/alertDisplay'

function card(id: string, text = id, durationMs = 5000): AlertTextCard {
  return { id, text, font: 'sans', fontSize: 28, color: '#ffcc33', durationMs }
}

const show = (s: AlertTextCardState[], c: AlertTextCard): AlertTextCardState[] =>
  alertTextReduce(s, { type: 'show', card: c })
const tick = (s: AlertTextCardState[], dtMs: number): AlertTextCardState[] =>
  alertTextReduce(s, { type: 'tick', dtMs })

/** Advance in 100 ms steps, the way the component's one interval does. */
function run(s: AlertTextCardState[], ms: number): AlertTextCardState[] {
  let out = s
  for (let t = 0; t < ms; t += 100) out = tick(out, 100)
  return out
}

const ids = (s: AlertTextCardState[]): string[] => s.map((c) => c.card.id)
const texts = (s: AlertTextCardState[]): string[] => s.map((c) => c.card.text)

test('a line holds for its duration, then exits, then is gone', () => {
  let s = show([], card('a', 'Ancient Breath', 5000))
  assert.equal(s.length, 1)
  assert.equal(s[0].exitingMs, null, 'it is holding, not exiting')

  s = run(s, 4900)
  assert.equal(s[0].exitingMs, null, 'still holding just before its time is up')

  s = run(s, 200)
  assert.notEqual(s[0].exitingMs, null, 'the exit has begun')

  s = run(s, ALERT_TEXT_EXIT_MS + 100)
  assert.deepEqual(s, [], 'and then it is gone')
})

test('TWO FIRINGS OF THE SAME ALERT ARE TWO LINES — arrivals never overwrite', () => {
  // The ids a real firing mints are `<alertId>:<seq>` (features/alerts/displayFire.ts), so two
  // fires of one alert differ only in the counter. Nothing about the queue may collapse them.
  let s = show([], card('slow:1', 'a fire giant is slowed'))
  s = show(s, card('slow:2', 'a froglok is slowed'))
  assert.equal(s.length, 2, 'both are on screen')
  assert.deepEqual(texts(s), ['a fire giant is slowed', 'a froglok is slowed'])
})

test('even a byte-identical repeat stacks, because it is a second thing that happened', () => {
  // The celebration toast dedupes by id here; this surface must not. Same id, same text: still
  // two lines, because the alert genuinely fired twice.
  let s = show([], card('same', 'Charm broken!'))
  s = show(s, card('same', 'Charm broken!'))
  assert.equal(s.length, 2)
})

test('arrival order is render order — newest underneath, and nothing shuffles', () => {
  let s = show([], card('a'))
  s = show(s, card('b'))
  s = show(s, card('c'))
  assert.deepEqual(ids(s), ['a', 'b', 'c'])
  // A tick that changes only the clocks must not reorder anything.
  s = run(s, 500)
  assert.deepEqual(ids(s), ['a', 'b', 'c'])
})

test('past the cap the OLDEST goes, never the line that just arrived', () => {
  let s: AlertTextCardState[] = []
  for (let i = 0; i < ALERT_TEXT_CAP; i++) s = show(s, card(`a${String(i)}`))
  assert.equal(s.length, ALERT_TEXT_CAP)

  s = show(s, card('newest'))
  assert.equal(s.length, ALERT_TEXT_CAP, 'still capped')
  assert.equal(ids(s).includes('a0'), false, 'the one that had been up longest left')
  assert.equal(ids(s).at(-1), 'newest', 'the arrival is on screen')
})

test('every line runs its OWN clock', () => {
  let s = show([], card('short', 'short', 2000))
  s = show(s, card('long', 'long', 20000))

  s = run(s, 2000 + ALERT_TEXT_EXIT_MS + 100)
  assert.deepEqual(ids(s), ['long'], 'the short one left on its own schedule')
  assert.equal(s[0].exitingMs, null, 'and the long one is untouched by it')
})

test('a card that names no duration falls back rather than never leaving', () => {
  // Main normally fills `durationMs` from the def, but a 0 would otherwise mean "hold forever",
  // which is the one outcome an alert overlay must never produce.
  let s = show([], { ...card('x'), durationMs: 0 })
  assert.equal(s[0].remainingMs, ALERT_TEXT_FALLBACK_MS)
  s = run(s, ALERT_TEXT_FALLBACK_MS + ALERT_TEXT_EXIT_MS + 100)
  assert.deepEqual(s, [])
})

test('tick returns the SAME array when nothing moved, so a still window does not re-render', () => {
  // The whole point: this window sits over a running game at 10 ticks a second. An empty queue —
  // its resting state — must cost nothing at all.
  const empty: AlertTextCardState[] = []
  assert.equal(tick(empty, 100), empty)

  // A queue whose lines are all still holding DOES advance (their clocks moved), so identity is
  // only promised for the case where no state changed at all.
  const one = show([], card('a'))
  assert.notEqual(tick(one, 100), one, 'a holding line advances')
})
