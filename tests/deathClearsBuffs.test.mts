// JOS-88 — DEATH CLEARS ACTIVE BUFFS.
//
// A user reported the buff tracker still showing active buffs after they died. Death
// strips buffs in-game, so the tracker lies after every death.
//
// The event and the handler both already existed: `You have been slain by <killer>!`
// classifies as `kind:'playerDeath'` (parseWorld.ts) and BuffsModule routes it to
// BuffInstances.onPlayerDeath() (buffs.ts). This file pins the END-TO-END behaviour that
// was never covered: replay a REAL log window that leaves a confirmed self buff active,
// deliver the death line, and assert the active set is empty afterwards.
//
// Window: w1-current-session.log — the same hand-verified Permafrost window W1 asserts
// (goldenWindows.test.mts), chosen because it is the one fixture whose end state is a
// single confirmed SELF buff (Swift Like the Wind, cast 19:51:33). That makes "the buff
// was active, then death cleared it" a two-line diff rather than a staged fiction.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { readFixture, replayBuffs, findActive, tsOf } from './harness.mts'

const OBSERVE = tsOf('[Sat Aug 01 19:56:00 2026] x')
const DEATH_LINE = '[Sat Aug 01 19:55:58 2026] You have been slain by an ice giant!'
// The KILLERLESS death (JOS-88): a DoT tick landed the killing blow, so the client names no
// attacker. Verbatim shape from the sweep log (Sun Jul 19 20:31:32).
const DIED_LINE = '[Sat Aug 01 19:55:58 2026] You died.'

// The premise: without a death, the window ends with Swift Like the Wind active on self.
// (W1 asserts this in full; restated here so the death assertion below is a real delta and
// not a test that would pass against an already-empty model.)
test('JOS-88 premise: the window leaves a confirmed self buff active', () => {
  const snap = replayBuffs(readFixture('w1-current-session.log'), OBSERVE)
  const swift = findActive(snap, 'swift like the wind')
  assert.ok(swift, 'Swift Like the Wind is active at 19:56 when nothing killed you')
  assert.equal(swift!.self, true, 'and it is bound to the player')
})

// THE TICKET: buffs active → death line arrives → buffs cleared.
test('JOS-88: a player death clears the active buffs', () => {
  const lines = [...readFixture('w1-current-session.log'), DEATH_LINE]
  const snap = replayBuffs(lines, OBSERVE)

  assert.equal(
    findActive(snap, 'swift like the wind'),
    undefined,
    'the self buff the player was wearing does not survive their death'
  )
  // Nothing self-bound survives — the tracker must not show ANY buff on a corpse.
  for (const a of snap.active) {
    assert.notEqual(a.self, true, `no self buff survives death (${a.spell})`)
  }
})

// THE ACTUAL DEFECT (JOS-88): the slain sentence was always handled, but a death whose
// killing blow was a DoT tick prints `You died.` with no killer. That line classified as
// `unknown`, so no playerDeath event existed, so nothing cleared — the reported "buffs
// survive death". 1 of the 23 player deaths in the sweep log takes this shape.
test('JOS-88: `You died.` is a player death', () => {
  const ev = parseEvent(DIED_LINE, 0)
  assert.equal(ev?.kind, 'playerDeath', '`You died.` is the killerless player-death shape')
  assert.equal(
    (ev as { killer?: string }).killer,
    undefined,
    'a DoT tick names no attacker, so the event carries no killer'
  )
})

test('JOS-88: a killerless death clears the active buffs too', () => {
  const snap = replayBuffs([...readFixture('w1-current-session.log'), DIED_LINE], OBSERVE)
  assert.equal(
    findActive(snap, 'swift like the wind'),
    undefined,
    'dying to a DoT strips buffs exactly as being slain does'
  )
  for (const a of snap.active) {
    assert.notEqual(a.self, true, `no self buff survives a killerless death (${a.spell})`)
  }
})

// The neighbours we deliberately do NOT treat as deaths. `knocked unconscious` precedes
// every death but also fires once in the sweep log where the player survived (they died 26s
// later), and the return-to-bind echo is redundant and its text varies by server.
test('JOS-88: near-miss lines are not player deaths', () => {
  for (const near of [
    '[Sat Aug 01 19:55:58 2026] You have been knocked unconscious!',
    '[Sat Aug 01 19:55:58 2026] Returning to Zone Safe Point. Please wait...',
    '[Sat Aug 01 19:55:58 2026] You died laughing.'
  ]) {
    assert.notEqual(parseEvent(near, 0)?.kind, 'playerDeath', `not a death: ${near.slice(27)}`)
  }
})

// The player's death is not a mob's death: it must not be mistaken for the `death` kind,
// which censors debuffs on the KILLED entity and would leave self buffs untouched.
test('JOS-88: the death line the player prints for themselves clears buffs', () => {
  const base = readFixture('w1-current-session.log')

  // A MOB dying in the same instant leaves the player's self buff alone…
  const mobDeath = [...base, '[Sat Aug 01 19:55:58 2026] An ice giant has been slain by Primitive!']
  assert.ok(
    findActive(replayBuffs(mobDeath, OBSERVE), 'swift like the wind'),
    'a mob dying does not strip the player of their buffs'
  )

  // …while the player dying strips it. The two shapes differ by one word ("has"/"have"),
  // so this pair is what keeps the classifier split honest.
  const playerDeath = [...base, DEATH_LINE]
  assert.equal(
    findActive(replayBuffs(playerDeath, OBSERVE), 'swift like the wind'),
    undefined,
    'the player dying does'
  )
})
