// THE AUDIO CUTOVER'S TWO DECISIONS (JOS-491).
//
// Behind `EQC_ENGINE_ALERTS=1` the app plays alert audio from ENGINE fires and this process's own
// evaluator goes silent. Two things decide whether that is safe and whether it works, and both are
// pure (`src/main/dataServer/alertsAudioRules.ts`) precisely so they can be asked here rather than
// inferred from a running raid:
//
//   1. THE GATE. A def carrying `earlyWarnSec` is COMPILED OUT by the engine's evaluator — its fire
//      is one the app MOVES, and the engine has neither the wall clock nor the timer projection to
//      move it with (JOS-482's named gap). Arming over one would trade a correctly-delayed sound
//      for no sound at all, so the flag must refuse and NAME the def. Tested both ways.
//   2. THE TRANSLATION. A fire frame names its rule by LABEL; the renderer's player needs an ID.
//
// WHAT IS NOT HERE. That the arm path actually consults the verdict, that the module actually goes
// quiet, and that exactly ONE sound comes out of a matching live line are claims about a running
// app with a running engine — `tests/e2e/engine-alert-fires.e2e.mts` drives all three end to end.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  armVerdict,
  earlyWarnBlocker,
  fireToFiring
} from '../src/main/dataServer/alertsAudioRules'
import type { FireMessage } from '../src/shared/dataServer/protocol.generated'
import type { AlertDef } from '../src/shared/types'

/** A minimal stored def. `trigger` is never read by either decision — both are about the def's
 *  IDENTITY and its offset — so it is the simplest shape the type accepts. */
function def(over: Partial<AlertDef> & Pick<AlertDef, 'id' | 'name'>): AlertDef {
  return {
    enabled: true,
    trigger: { type: 'raw', regex: 'x' },
    sound: { packId: 'classic', soundId: 'ding' },
    ...over
  }
}

function fire(over: Partial<FireMessage> = {}): FireMessage {
  return {
    kind: 'fire',
    at: 1_700_000_000_000,
    rule: 'Charm break',
    sound: 'classic/ding',
    message: 'Your charm spell has worn off.',
    ...over
  }
}

// ---- the gate, both ways -----------------------------------------------------------------------

test('THE GATE ARMS over a def set with no early warning in it', () => {
  const defs = [def({ id: 'charm-break', name: 'Charm break' }), def({ id: 'b', name: 'Mote dropped' })]
  assert.equal(earlyWarnBlocker(defs), null)
  const verdict = armVerdict(defs)
  assert.equal(verdict.arm, true)
  // The armed line still SAYS something: a silent evaluator with no line explaining itself is the
  // state a developer cannot tell apart from a broken one.
  assert.match(verdict.line, /the ENGINE now plays alert audio/)
})

test('THE GATE REFUSES, and the one line NAMES the def the engine would swallow', () => {
  const blocker = def({ id: 'group:slow:mob', name: 'Slow wore off a mob', earlyWarnSec: 5 })
  const defs = [def({ id: 'charm-break', name: 'Charm break' }), blocker]
  assert.equal(earlyWarnBlocker(defs), blocker)
  const verdict = armVerdict(defs)
  assert.equal(verdict.arm, false)
  // Both halves of the identity, because a name alone is not enough to find the row and an id
  // alone is not enough to recognize it.
  assert.match(verdict.line, /Slow wore off a mob/)
  assert.match(verdict.line, /group:slow:mob/)
  // …and WHY, so the reader does not have to know the engine's source to act on it.
  assert.match(verdict.line, /earlyWarnSec=5/)
  assert.match(verdict.line, /compiles early-warning defs out/)
})

test('AN OFFSET THIS APP WOULD NOT ACT ON IS NOT A BLOCKER — the gate asks the normalizer, not the key', () => {
  // `normalizeEarlyWarnSec` rejects all three (zero is below the 1 s floor, and neither of the
  // others is a finite number). Nothing arms a warning from them here, so nothing is swallowed
  // there either, and refusing would be a false alarm no edit could clear.
  for (const raw of [0, Number.NaN, '10' as unknown as number]) {
    const defs = [def({ id: 'junk', name: 'Junk', earlyWarnSec: raw })]
    assert.equal(earlyWarnBlocker(defs), null, `earlyWarnSec=${String(raw)} must not block`)
    assert.equal(armVerdict(defs).arm, true)
  }
})

test('AN OFFSET PAST THE CEILING STILL BLOCKS — the conservative side of the one disagreement', () => {
  // The app CLAMPS 5000 to its 120 s ceiling and moves the fire; the engine's own reader treats
  // anything outside 1..600 as absent and would fire it immediately. Two wrong answers, and this
  // gate refuses rather than picking one.
  const defs = [def({ id: 'huge', name: 'Huge', earlyWarnSec: 5000 })]
  assert.equal(earlyWarnBlocker(defs)?.id, 'huge')
  assert.equal(armVerdict(defs).arm, false)
})

test('AN EMPTY STORE ARMS. No defs is no early warnings, not an unknown', () => {
  assert.equal(earlyWarnBlocker([]), null)
  assert.equal(armVerdict([]).arm, true)
})

// ---- the translation ---------------------------------------------------------------------------

test('A FIRE BECOMES A FIRING the renderer can play: the label resolves back to the def ID', () => {
  const defs = [def({ id: 'charm-break', name: 'Charm break' })]
  const firing = fireToFiring(fire(), defs)
  assert.deepEqual(firing, {
    alertId: 'charm-break',
    // THE LOG'S CLOCK, carried through verbatim — `FireMessage.at` is the ts of the event that
    // matched, which is exactly what a main-side `FiredAlert.ts` has always been.
    ts: 1_700_000_000_000,
    matchedText: 'Your charm spell has worn off.'
  })
})

test('…and it carries NOTHING ELSE. No captures, no spell, no dueAt — a frame has four fields', () => {
  const firing = fireToFiring(fire(), [def({ id: 'charm-break', name: 'Charm break' })])
  assert.deepEqual(Object.keys(firing ?? {}).sort(), ['alertId', 'matchedText', 'ts'])
})

test('A LABEL NOTHING ANSWERS TO IS DROPPED, never played as somebody else', () => {
  const defs = [def({ id: 'charm-break', name: 'Charm break' })]
  assert.equal(fireToFiring(fire({ rule: 'A def the user deleted' }), defs), null)
  assert.equal(fireToFiring(fire(), []), null)
})

test('TWO DEFS WITH ONE NAME are separated by the SOUND the engine stated', () => {
  const defs = [
    def({ id: 'quiet', name: 'Slow landed', sound: { packId: 'classic', soundId: 'blip' } }),
    def({ id: 'loud', name: 'Slow landed', sound: { packId: 'alan-rickman', soundId: 'oh-dear' } })
  ]
  assert.equal(fireToFiring(fire({ rule: 'Slow landed', sound: 'alan-rickman/oh-dear' }), defs)?.alertId, 'loud')
  assert.equal(fireToFiring(fire({ rule: 'Slow landed', sound: 'classic/blip' }), defs)?.alertId, 'quiet')
})

test('…and when even the sound cannot separate them, the FIRST is played rather than none', () => {
  // Same name, same pack sound: whichever is picked makes the identical noise, so the worst case
  // left is a volume. A dropped alert would be a strictly worse answer.
  const defs = [
    def({ id: 'first', name: 'Twin', volume: 0.2 }),
    def({ id: 'second', name: 'Twin', volume: 1 })
  ]
  assert.equal(fireToFiring(fire({ rule: 'Twin' }), defs)?.alertId, 'first')
  // A sound key matching NEITHER of them still resolves — the label is the identity, and the
  // narrowing is a tiebreak rather than a second test the fire has to pass.
  assert.equal(fireToFiring(fire({ rule: 'Twin', sound: 'gone/missing' }), defs)?.alertId, 'first')
})

test('MATCHING IS EXACT: a label that differs by case is a different alert', () => {
  const defs = [def({ id: 'charm-break', name: 'Charm break' })]
  assert.equal(fireToFiring(fire({ rule: 'charm break' }), defs), null)
})
