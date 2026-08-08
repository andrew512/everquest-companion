// COMBAT VIEW PREFERENCES — the vocabulary behind an owner ruling.
//
// JOS-115 moved the You / Group / Everyone meter scope off every combat surface and into one
// persisted preference. It lives in `features/combat/combatPrefs.ts`, which is DOM-free on
// purpose — the hooks around it (useCombatPrefs.ts) only move strings in and out of localStorage,
// and everything that can silently go wrong is here: a default, a guard, a degrade.
//
// WHAT IS WORTH PINNING, and why each one is not obvious:
//   * the DEFAULT is Group, and an ABSENT key is that default rather than 'you'. A user who has
//     never opened Preferences has not chosen You (owner ruling: "fresh install and absent key
//     both resolve to Group").
//   * anything that is not one of the three degrades to the default. A meter is never blank
//     because a value was hand-edited or written by a future build.
//   * it is ONE key, with no per-surface suffix — that is the whole shape of the ruling.
//
// No window, no React, no Electron — this suite can never skip.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_METER_SCOPE,
  METER_SCOPE_KEY,
  readMeterScope
} from '../src/renderer/src/features/combat/combatPrefs'
import { METER_SCOPES } from '../src/shared/roster'

// ── JOS-115: whose damage ────────────────────────────────────────────────────────────────

test('the meter scope defaults to Group — for a fresh install and an absent key alike', () => {
  assert.equal(DEFAULT_METER_SCOPE, 'group')
  assert.equal(readMeterScope(null), 'group')
  assert.equal(readMeterScope(''), 'group')
})

test('each of the three scopes round-trips, and nothing else does', () => {
  for (const s of METER_SCOPES) assert.equal(readMeterScope(s), s)
  // Hand-edited, capitalised, a future build's fourth state, or a whole JSON blob in the slot:
  // every one of them is the DEFAULT rather than an empty meter.
  for (const junk of ['You', 'GROUP', 'party', 'raid', '{"scope":"you"}', ' you', 'you ', '0', 'null']) {
    assert.equal(readMeterScope(junk), 'group', `${junk} must degrade to the default`)
  }
})

test('the scope is ONE key for every surface — no per-surface suffix survives', () => {
  // The suffixed keys JOS-115 retired (`eq.combat.meterScope.combat`, `.overlay.fight`, …) are
  // left inert; what matters here is that the live key is the bare one, so the Combat tab, the
  // Overview card and every floating overlay are reading and writing the same string.
  assert.equal(METER_SCOPE_KEY, 'eq.combat.meterScope')
  assert.ok(!METER_SCOPE_KEY.endsWith('.'), 'the key is complete, not a prefix a surface appends to')
})
