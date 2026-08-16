// THE CLIENT SPELL TABLE'S FIELD MAP, PINNED (JOS-382).
//
// `spells_us.txt` is Daybreak's file and is never committed here, so the rows below are authored —
// but every one of them is a VERBATIM transcription of the fields this parser reads out of the
// owner's real install, taken on 2026-08-16 and named beside each row. That is the only honest way
// to pin a field map against a file the repo may not carry: a test that requires the client
// install would skip on CI and pin nothing.
//
// AND IT PINS ONE CORRECTION TO THE BRIEF. An effect slot is
// `slot | effectId | base | limit | CALC | MAX`, not `… | max | calc`. Tashani's slot 2 reads
// `2|50|-10|0|101|23`; Torven's table documents Tashani at -23 magic resist and calc 101 is
// "base plus level/2, capped at max". Read the other way round, the formula code would be 23
// (which is not a formula) and the cap would be 101 (a number Tashani has never produced).
// Malaisement confirms it at -40 on all four axes, and Mesmerization puts its documented
// "up to level 55" in the same position.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpellsUs } from '../src/main/resist/spellsUsParse'

/**
 * Build one caret row. Only the fields this parser reads are filled; the rest are the padding the
 * real file carries. 173 fields, exactly as the client writes them.
 */
function row(spec: {
  id: number
  name: string
  castMs?: number
  resistType?: number
  targetType?: number
  resistAdj?: number
  classes?: Record<number, number>
  slots?: string
}): string {
  const f = new Array<string>(173).fill('0')
  f[0] = String(spec.id)
  f[1] = spec.name
  f[8] = String(spec.castMs ?? 0)
  f[29] = String(spec.resistType ?? 0)
  f[30] = String(spec.targetType ?? 0)
  for (let i = 0; i < 16; i++) f[36 + i] = '255'
  for (const [idx, lvl] of Object.entries(spec.classes ?? {})) f[36 + Number(idx)] = String(lvl)
  f[78] = String(spec.resistAdj ?? 0)
  f[172] = spec.slots ?? ''
  return f.join('^')
}

/** WAR CLR PAL RNG SHD DRU MNK BRD ROG SHM NEC WIZ MAG ENC BST BER. */
const ENC = 13
const BRD = 7
const PAL = 2

// Verbatim from the owner's install, 2026-08-16.
const TASHANI = row({ id: 677, name: 'Tashani', castMs: 1000, resistType: 0, targetType: 5, classes: { [ENC]: 20 }, slots: '1|36|1|0|100|0$2|50|-10|0|101|23' })
const MALAISEMENT = row({ id: 111, name: 'Malaisement', castMs: 4000, resistType: 1, targetType: 5, resistAdj: -5, classes: { [ENC]: 39 }, slots: '1|10|0|0|100|0$2|47|-20|0|101|40$3|50|-20|0|101|40$4|48|-20|0|101|40$5|46|-20|0|101|40' })
const MESMERIZATION = row({ id: 307, name: 'Mesmerization', castMs: 3000, resistType: 1, targetType: 8, classes: { [ENC]: 16 }, slots: '1|31|2|0|100|55' })
const CHAOS_FLUX = row({ id: 350, name: 'Chaos Flux', castMs: 3000, resistType: 1, targetType: 5, classes: { [ENC]: 21 }, slots: '1|0|-110|0|103|175$2|21|1000|500|100|55' })
const CHAOS_FLUX_NPC = row({ id: 6850, name: 'Chaos Flux', castMs: 0, resistType: 1, targetType: 5, slots: '1|0|-95|0|103|150$2|21|1000|500|100|0' })
const SMITING_STRIKE = row({ id: 74037, name: 'Smiting Strike', castMs: 0, resistType: 1, targetType: 5, resistAdj: -250, slots: '1|535|20|-3500|100|1' })
const SCORCHING_ARROW = row({ id: 74042, name: 'Scorching Arrow', castMs: 500, resistType: 2, targetType: 5, slots: '1|79|-210|0|100|210$2|0|-105|0|100|105' })
const SCORCHING_ARROW_IV = row({ id: 74045, name: 'Scorching Arrow IV', castMs: 500, resistType: 2, targetType: 5, slots: '1|79|-420|0|100|420$2|0|-210|0|100|210' })
const CHORDS = row({ id: 703, name: 'Chords of Dissonance', castMs: 3000, resistType: 1, targetType: 5, resistAdj: -100, classes: { [BRD]: 2 }, slots: '1|334|-2|0|109|0' })
const SMITE = row({ id: 1234, name: 'Divine Might Strike', castMs: 0, resistType: 1, targetType: 5, resistAdj: -150, classes: { [PAL]: 30 }, slots: '1|0|-40|0|100|40' })

const TABLE = parseSpellsUs(
  [TASHANI, MALAISEMENT, MESMERIZATION, CHAOS_FLUX, CHAOS_FLUX_NPC, SMITING_STRIKE, SCORCHING_ARROW, SCORCHING_ARROW_IV, CHORDS, SMITE].join('\n') + '\n'
)

test('the axis comes from field 29, and the four unmodellable kinds come back null', () => {
  assert.equal(TABLE['chaos flux'].axis, 'magic')
  assert.equal(TABLE['scorching arrow'].axis, 'fire')
  // Tashani is resist type 0: the game never resists it, so it is evidence about no axis at all.
  assert.equal(TABLE.tashani.axis, null)
})

test('the resist adjust is field 78, and it is what makes a proc land', () => {
  assert.equal(TABLE['smiting strike'].resistAdj, -250)
  assert.equal(TABLE['divine might strike'].resistAdj, -150)
  assert.equal(TABLE['chaos flux'].resistAdj, 0)
})

test('cast time and target type ride along', () => {
  assert.equal(TABLE.mesmerization.castMs, 3000)
  assert.equal(TABLE.mesmerization.targetType, 8)
  assert.equal(TABLE['smiting strike'].castMs, 0)
})

test('AN EFFECT SLOT IS slot|effect|base|limit|CALC|MAX, and Tashani proves it', () => {
  const slots = TABLE.tashani.debuffSlots
  assert.ok(slots)
  assert.equal(slots.length, 1)
  assert.deepEqual(slots[0], { axis: 'magic', base: -10, calc: 101, max: 23 })
  // Torven documents Tashani at -23 magic resist. 23 is the CAP and 101 is the formula; the other
  // reading gives a formula code of 23 and a cap of 101, neither of which exists.
})

test('a malo moves every axis at once, through effect 111 or through four slots', () => {
  const slots = TABLE.malaisement.debuffSlots
  assert.ok(slots)
  assert.deepEqual(
    slots.map((s) => s.axis).sort(),
    ['cold', 'fire', 'magic', 'poison']
  )
  for (const s of slots) assert.equal(s.max, 40)
})

test('a one-point resist rider is not a resist debuff', () => {
  // A charm that shaves a point off magic resistance is a charm. Opening an eleven-minute debuff
  // window for it would file every later observation under a condition that never mattered.
  const rider = parseSpellsUs(row({ id: 750, name: "Solon's Bewitching Bravura", resistType: 1, slots: '1|22|1|0|100|51$2|50|-1|0|119|0' }))
  assert.equal(rider["solon's bewitching bravura"].debuffSlots, undefined)
})

test('a HARD LEVEL CAP comes only from the primary slot', () => {
  // Mesmerization: `1|31|2|0|100|55` — effect 31 is mez, and 55 is the level it stops working at.
  assert.equal(TABLE.mesmerization.levelCap, 55)
  // Chaos Flux carries a STUN rider capped at 55 on slot 2. Being above it costs the stun, not
  // the nuke, so the whole spell must not become "always resisted" (world-model law 6).
  assert.equal(TABLE['chaos flux'].levelCap, undefined)
})

test('the hitpoint slot is what tells a nuke from a proc', () => {
  assert.deepEqual(TABLE['chaos flux'].hpSlot, { base: -110, max: 175, calc: 103 })
  // Smiting Strike has no effect-0 slot at all: its damage is a skill effect and varies, so there
  // is no "full damage" for the estimator to read partials against.
  assert.equal(TABLE['smiting strike'].hpSlot, undefined)
  // Scorching Arrow's effect-0 slot is not slot 1; every slot is scanned.
  assert.deepEqual(TABLE['scorching arrow'].hpSlot, { base: -105, max: 105, calc: 100 })
})

test('THE BARD IS THE ONLY STATEMENT THAT A SPELL IS A SONG', () => {
  assert.equal(TABLE['chords of dissonance'].song, true)
  assert.equal(TABLE['chaos flux'].song, undefined)
  assert.equal(TABLE['divine might strike'].song, undefined)
})

test('ranks fold onto the base row, and a mob copy loses to a spell a player can learn', () => {
  // `Scorching Arrow IV` and `Scorching Arrow` are one spell to this model — the rank is stripped
  // by spellCanonKey and the first row in the file wins.
  assert.equal(TABLE['scorching arrow iv'], undefined)
  assert.deepEqual(TABLE['scorching arrow'].hpSlot, { base: -105, max: 105, calc: 100 })
  // Chaos Flux 6850 is an NPC's copy with no class able to cast it; the enchanter's row wins even
  // though it comes first, because "no class can learn this" is what a mob copy looks like.
  assert.deepEqual(TABLE['chaos flux'].hpSlot, { base: -110, max: 175, calc: 103 })
})

test('a malformed row is skipped rather than half-read', () => {
  const table = parseSpellsUs(['not^a^row', '', TASHANI].join('\n'))
  assert.deepEqual(Object.keys(table), ['tashani'])
})
