// THE FULL-DAMAGE REFERENCE, against the owner's own committed rows (JOS-385, defect 2).
//
// The claim under test is one sentence: the number a spell hits for is its MODE across the whole
// ledger, not its maximum, because Live spell-damage focus effects roll a random bonus per cast and
// the maximum is therefore a lucky roll. Getting this wrong reads ordinary full hits as partials
// and invents resistance out of an item the player is wearing — which is what the owner saw on a
// thunder spirit princess, where three of the "5 partial" were 453, 471 and 476 against a base of
// 394.
//
// HALF OF IT IS PINNED ON THE SHIPPED BASELINE, because that is real data with a known answer:
// Discordant Mind and Scorching Arrow are the two spells whose tiers and focus band the owner
// measured by hand, and the numbers below are his. The other half is synthetic, because a
// statistic's edges are easier to state than to find in a log.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FULL_AT_LEAST,
  MODE_MIN_SHARE,
  damageKind,
  damageModeKey,
  damageModes,
  splitDamage
} from '../src/shared/resistDamage'
import type { ResistLedger, ResistRow, SpellResistInfo } from '../src/shared/resistTypes'

const PATH = join(import.meta.dirname, '..', 'src', 'main', 'data', 'resistBaseline.json')
const ROWS = (JSON.parse(readFileSync(PATH, 'utf8')) as ResistLedger).sources[0].rows
const MODES = damageModes(ROWS)

const NUKE: SpellResistInfo = { axis: 'magic', resistAdj: 0, castMs: 3000, targetType: 5, hpSlot: { base: -110, max: 394, calc: 103 } }
const PROC: SpellResistInfo = { axis: 'magic', resistAdj: -250, castMs: 0, targetType: 5 }

function row(spec: Partial<ResistRow> & Pick<ResistRow, 'spellKey'>): ResistRow {
  return {
    mobKey: 'a test mob',
    family: 'cast',
    casterKind: 'self',
    casterLevel: 50,
    mobLevel: 50,
    debuffs: '',
    resist: 0,
    land: 0,
    dmg: {},
    firstTs: 0,
    lastTs: 0,
    ...spec
  }
}

test("Discordant Mind's full damage is 394, at every level that learned it before the focus", () => {
  // The owner's hand count across all mobs: 423 hits at exactly 394. Per caster level the base
  // holds 78% to 93% of the histogram from 43 up, which is what an unfocused nuke looks like.
  for (const level of [43, 44, 45, 46, 47, 48, 49]) {
    assert.equal(MODES.get(damageModeKey('discordant mind', level)), 394, `level ${String(level)}`)
  }
})

test('…and at level 50 the focus item makes the histogram unreadable, so it says so', () => {
  // THE FALLBACK ON REAL DATA. At 50 the owner is wearing the damage focus, so the base 394 holds
  // 6% of that level's hits and the rest are spread across thirty-odd focused values from 449 to
  // 528. No value is tall enough to be believed as "full", so the spell is read as VARIABLE at
  // that level: resist-or-not, no partial information, which is the safe direction this repo
  // already takes everywhere else (resistModel.ts's header).
  assert.equal(MODES.get(damageModeKey('discordant mind', 50)), undefined)
  assert.equal(damageKind(row({ spellKey: 'discordant mind', dmg: { '394': 3 } }), NUKE, undefined), 'ddVar')
})

test("Scorching Arrow's tiers are the game's own, and the caster level is what separates them", () => {
  // Three tiers in one log, and keying the reference by caster level is what keeps them apart. A
  // reference pooled over levels would call the level-46 tier a partial of the level-50 one.
  assert.equal(MODES.get(damageModeKey('scorching arrow', 46)), 214)
  assert.equal(MODES.get(damageModeKey('scorching arrow', 47)), 233)
  for (const level of [48, 49, 50]) {
    assert.equal(MODES.get(damageModeKey('scorching arrow', level)), 239, `level ${String(level)}`)
  }
})

test('A FOCUSED HIT IS A FULL HIT, which is the whole defect', () => {
  // The princess's own numbers, as the owner read them off the log: three real partials and four
  // fulls, of which three were focused. The old rule took the largest value (524) as the reference
  // and called the other six partials.
  const princess = row({
    spellKey: 'discordant mind',
    dmg: { '80': 1, '165': 1, '168': 1, '453': 1, '471': 1, '476': 1, '524': 1 }
  })
  const split = splitDamage(princess, 394)
  assert.equal(split.total, 7)
  assert.equal(split.full, 4, '394 and everything above it, focus roll and all')
  assert.equal(split.partial, 3, '80, 165 and 168 - the only three that were actually reduced')

  // Against the OLD reference (the max) the same seven hits read as one full and six partials,
  // which is a mob resisting 86% of what it was hit by. That is the number the owner was shown.
  const naive = splitDamage(princess, 524)
  assert.equal(naive.full, 1)
  assert.equal(naive.partial, 6)
})

test('the full band starts just below the reference, and nothing else is in it', () => {
  assert.equal(FULL_AT_LEAST, 0.97)
  const r = row({ spellKey: 'test nuke', dmg: { '400': 1, '394': 1, '383': 1, '382': 1, '300': 1 } })
  const split = splitDamage(r, 394)
  // 400 (focused), 394 (base) and 383 (the rounding slack) are full; 382 is below the band.
  assert.equal(split.full, 3)
  assert.equal(split.partial, 2)
})

test('a histogram with no tall enough value names no reference at all', () => {
  assert.equal(MODE_MIN_SHARE, 0.4)
  // A proc's damage range: six values, none of them holding 40% of the hits.
  const spread = row({ spellKey: 'test proc', dmg: { '100': 12, '110': 11, '120': 12, '130': 11, '140': 12, '150': 11 } })
  assert.equal(damageModes([spread]).get(damageModeKey('test proc', 50)), undefined)
  // …and a spell with no hitpoint slot in the client data is variable whatever its histogram says.
  assert.equal(damageKind(row({ spellKey: 'test proc', dmg: { '100': 99 } }), PROC, 100), 'ddVar')
})

test('the reference is POOLED OVER MOBS, so a four-hit cell inherits what the ledger knows', () => {
  // The argument for the scope, made in the units it matters in: one mob, four hits, no chance of
  // establishing anything on its own - and it does not have to, because the same nuke has hundreds
  // of hits elsewhere. Scoped per mob, the four hits below would name 300 as "full" and read the
  // other three as a mob eating three quarters of every cast.
  const many = row({ spellKey: 'test nuke', mobKey: 'a well known mob', dmg: { '394': 200, '300': 5 } })
  const few = row({ spellKey: 'test nuke', mobKey: 'a rare mob', dmg: { '300': 1, '250': 1, '200': 1, '150': 1 } })
  const pooled = damageModes([many, few])
  assert.equal(pooled.get(damageModeKey('test nuke', 50)), 394)
  const split = splitDamage(few, pooled.get(damageModeKey('test nuke', 50)))
  assert.equal(split.full, 0)
  assert.equal(split.partial, 4, 'every one of them really was reduced')
  // Alone, the same four hits would have called the largest of themselves full.
  assert.equal(damageModes([few]).get(damageModeKey('test nuke', 50)), undefined)
})

test('the three ways a row is VARIABLE, which is the safe direction every time', () => {
  // Moved here from the estimator's own suite when the reference became a ledger-wide statistic:
  // this is a claim about reading a histogram, and that is this file's subject.
  const fixed = row({ spellKey: 'test nuke', dmg: { '150': 60, '120': 9, '90': 4 } })
  const fixedModes = damageModes([fixed])
  assert.equal(damageKind(fixed, NUKE, fixedModes.get(damageModeKey('test nuke', 50))), 'ddFix')
  // 1. No hitpoint slot in the client data: not a damage spell in the modelled sense.
  assert.equal(damageKind(row({ spellKey: 'test proc', dmg: { '392': 20, '388': 20 } }), PROC, 392), 'ddVar')
  // 2. No reference (the case above this one).
  assert.equal(damageKind(fixed, NUKE, undefined), 'ddVar')
  // 3. The row gave up on its own histogram past MAX_DISTINCT_DAMAGE_VALUES, so there is nothing
  //    left to read partials out of.
  assert.equal(damageKind(row({ spellKey: 'test nuke', variable: true, land: 500 }), NUKE, 150), 'ddVar')
})

test('a row with no damage at all splits into nothing, and never divides by a reference', () => {
  const aon = row({ spellKey: 'test hold', resist: 5, land: 5 })
  assert.deepEqual(splitDamage(aon, undefined), { total: 0, full: 0, partial: 0 })
  assert.deepEqual(splitDamage(aon, 394), { total: 0, full: 0, partial: 0 })
})
