// "WHAT'S NEW AT THIS LEVEL" — the join behind the panel and the toast subtitle
// (docs/plans/levelup-whats-new.md §2, wave O2).
//
// TWO HALVES, BOTH PINNED HERE:
//   1. the PURE arithmetic (shared/levelUnlocks.ts) against hand-built fixtures — the combo
//      join's three states (resolved / narrowed / unknown), the level fold, the subtitle;
//   2. the REAL committed dataset (src/main/data/levelUnlocks.ts over spells.json +
//      classes.json), asserted with FLOORS and identities, never today's counts.
//
// No Electron, no network, no live log — this suite NEVER skips. It is the test that catches a
// toast claiming "5 new spells" for a loadout it does not have, and a panel that would silently
// drop the thirteen disputed discipline rows instead of labeling them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_ABBRS, type ClassAbbr, type ComboInterval, type ComboSlot } from '../src/shared/classCombo'
import {
  comboClassSet,
  comboClassesAt,
  comboClassesOf,
  levelUpSubtitle,
  unlockCounts,
  unlockLevels,
  unlocksAtLevel,
  type LevelUnlockData
} from '../src/shared/levelUnlocks'
import { buildLevelUnlocks } from '../src/main/data/levelUnlocks'

// ---- fixtures ---------------------------------------------------------------------------

const slot = (candidates: ClassAbbr[]): ComboSlot => ({
  candidates,
  confidence: candidates.length === 1 ? 1 : 0.4,
  provenance: 'inferred',
  because: []
})

function interval(startTs: number, endTs: number | null, slots: ComboSlot[]): ComboInterval {
  return {
    id: `ci${String(startTs)}`,
    startTs,
    endTs,
    startLo: startTs,
    startHi: startTs,
    endLo: endTs,
    endHi: endTs,
    startReason: 'logStart',
    expectedSlots: slots.length === 3 ? 3 : 2,
    slots,
    levelLo: null,
    levelHi: null,
    evidenceCount: slots.length,
    userLocked: false
  }
}

/** A tiny hand-built dataset: two spells, two classes' skills, one disputed discipline. */
const DATA: LevelUnlockData = {
  spells: [
    { name: 'Cure Blindness', at: [{ cls: 'CLR', level: 12 }, { cls: 'PAL', level: 22 }], mana: 20 },
    { name: 'Word of Health', at: [{ cls: 'CLR', level: 12 }], castTimeMs: 2500, durationMs: 0 },
    { name: 'Shield of Words', at: [{ cls: 'CLR', level: 30 }] }
  ],
  skills: {
    CLR: [
      { name: 'Bind Wound', level: 12, kind: 'skill' },
      { name: 'Meditate', level: 12, kind: 'skill' }
    ],
    PAL: [
      { name: 'Bind Wound', level: 12, kind: 'skill' },
      { name: 'Lay on Hands', level: 1, kind: 'innate' }
    ],
    MNK: [{ name: 'Whirlwind', level: 12, kind: 'disc', dispute: "the Disciplines page strikes MNK through" }]
  }
}

// ---- the combo join (law 10) -------------------------------------------------------------

test('a fully resolved loadout is exact and NOT ambiguous', () => {
  const c = comboClassesOf(interval(0, null, [slot(['CLR']), slot(['PAL'])]))
  assert.deepEqual(c.resolved, ['CLR', 'PAL'])
  assert.deepEqual(c.candidates, [])
  assert.equal(c.ambiguous, false)
  assert.deepEqual(comboClassSet(c), ['CLR', 'PAL'])
})

test('a NARROWED slot contributes its candidates and flags the whole answer ambiguous', () => {
  const c = comboClassesOf(interval(0, null, [slot(['ROG']), slot(['CLR', 'PAL'])]))
  assert.deepEqual(c.resolved, ['ROG'])
  assert.deepEqual(c.candidates, ['CLR', 'PAL'])
  assert.equal(c.ambiguous, true)
  assert.deepEqual(comboClassSet(c), ['CLR', 'PAL', 'ROG'])
})

test('an UNKNOWN slot (every class) contributes nothing — sixteen classes is not a loadout', () => {
  const c = comboClassesOf(interval(0, null, [slot(['ROG']), slot([...CLASS_ABBRS])]))
  assert.deepEqual(c.resolved, ['ROG'])
  assert.deepEqual(c.candidates, [])
  assert.equal(c.ambiguous, true)
})

test('no interval at all is "we do not know yet", never an empty loadout', () => {
  const c = comboClassesOf(null)
  assert.deepEqual(comboClassSet(c), [])
  assert.equal(c.ambiguous, true)
})

test('the join is BY TIMESTAMP — a ding lands in the interval that covered it', () => {
  const intervals = [
    interval(1000, 2000, [slot(['CLR']), slot(['PAL'])]),
    interval(2000, null, [slot(['ROG']), slot(['BER'])])
  ]
  assert.deepEqual(comboClassSet(comboClassesAt(intervals, 1500)), ['CLR', 'PAL'])
  assert.deepEqual(comboClassSet(comboClassesAt(intervals, 9999)), ['BER', 'ROG'])
  // Before the first interval: unknown, not the first one's classes.
  assert.deepEqual(comboClassSet(comboClassesAt(intervals, 10)), [])
})

// ---- the level fold ----------------------------------------------------------------------

const CLR_PAL = comboClassesOf(interval(0, null, [slot(['CLR']), slot(['PAL'])]))

test('a level lists only what THESE classes gain at THAT level', () => {
  const u = unlocksAtLevel(DATA, CLR_PAL, 12)
  assert.deepEqual(u.spells.map((r) => r.name), ['Cure Blindness', 'Word of Health'])
  assert.deepEqual(u.skills.map((r) => r.name), ['Bind Wound', 'Meditate'])
  assert.deepEqual(unlockCounts(u), { spells: 2, skills: 2 })
  // Cure Blindness is CLR 12 / PAL 22: at 12 it is a CLERIC row, and says so with one chip.
  assert.deepEqual(u.spells[0].classes, ['CLR'])
})

test('one thing two classes both gain is ONE row wearing two chips, never two rows', () => {
  const u = unlocksAtLevel(DATA, CLR_PAL, 12)
  const bindWound = u.skills.find((r) => r.name === 'Bind Wound')
  assert.deepEqual(bindWound?.classes, ['CLR', 'PAL'])
  assert.equal(u.skills.filter((r) => r.name === 'Bind Wound').length, 1)
})

test('a spell the wiki carries TWICE is one row — a bookkeeping duplicate never inflates a count', () => {
  const dupes: LevelUnlockData = {
    spells: [
      { name: 'Imbue Emerald', at: [{ cls: 'CLR', level: 29 }] },
      { name: 'Imbue Emerald', at: [{ cls: 'CLR', level: 29 }], mana: 100 }
    ],
    skills: {}
  }
  const clr = comboClassesOf(interval(0, null, [slot(['CLR']), slot(['CLR'])]))
  assert.deepEqual(unlockCounts(unlocksAtLevel(dupes, clr, 29)), { spells: 1, skills: 0 })
})

test('a class OUTSIDE the loadout contributes nothing, however loudly the DB states it', () => {
  const u = unlocksAtLevel(DATA, CLR_PAL, 12)
  assert.equal(u.skills.some((r) => r.name === 'Whirlwind'), false)
})

test('a disputed row is CARRIED with the wiki’s own sentence, never dropped', () => {
  const mnk = comboClassesOf(interval(0, null, [slot(['MNK']), slot(['MNK'])]))
  const u = unlocksAtLevel(DATA, mnk, 12)
  assert.equal(u.skills.length, 1)
  assert.equal(u.skills[0].kind, 'disc')
  assert.match(u.skills[0].dispute ?? '', /strikes MNK through/)
})

test('an unknown loadout answers empty rather than scanning the whole game', () => {
  const u = unlocksAtLevel(DATA, comboClassesOf(null), 12)
  assert.deepEqual(unlockCounts(u), { spells: 0, skills: 0 })
  assert.equal(u.ambiguous, true)
})

test('the levels a loadout has anything to say about come back ascending', () => {
  assert.deepEqual(unlockLevels(DATA, ['CLR']), [12, 30])
  assert.deepEqual(unlockLevels(DATA, ['PAL']), [1, 12, 22])
})

// ---- the toast subtitle ------------------------------------------------------------------

test('the subtitle counts both lists, singular and plural', () => {
  assert.equal(levelUpSubtitle(unlocksAtLevel(DATA, CLR_PAL, 12)), '2 new spells · 2 new skills')
  assert.equal(levelUpSubtitle(unlocksAtLevel(DATA, CLR_PAL, 30)), '1 new spell')
  assert.equal(levelUpSubtitle(unlocksAtLevel(DATA, CLR_PAL, 1)), '1 new skill')
})

test('a level that unlocks NOTHING gets no subtitle — the toast still celebrates it', () => {
  assert.equal(levelUpSubtitle(unlocksAtLevel(DATA, CLR_PAL, 13)), undefined)
})

test('an ambiguous loadout says so — the counts are an upper bound and the card admits it', () => {
  const narrowed = comboClassesOf(interval(0, null, [slot(['CLR', 'PAL']), slot([...CLASS_ABBRS])]))
  const sub = levelUpSubtitle(unlocksAtLevel(DATA, narrowed, 12))
  assert.match(sub ?? '', /~ambiguous loadout$/)
})

// ---- the REAL committed dataset ----------------------------------------------------------

const REAL = buildLevelUnlocks()

test('the committed dataset carries both halves at real scale', () => {
  // Floors under what the tree measures today (1,455 spells with pairs / 16 classes).
  assert.ok(REAL.spells.length >= 1400, `spells with stated levels: ${String(REAL.spells.length)}`)
  assert.equal(Object.keys(REAL.skills).length, CLASS_ABBRS.length)
  assert.ok((REAL.scrapedAt ?? '').length > 0)
})

test('BER, MNK and WAR are SKILLS-ONLY — zero Spellpage spells at any level, and that is not an error', () => {
  for (const cls of ['BER', 'MNK', 'WAR'] as ClassAbbr[]) {
    const combo = comboClassesOf(interval(0, null, [slot([cls]), slot([cls])]))
    let spells = 0
    let skills = 0
    for (let level = 1; level <= 65; level++) {
      const u = unlocksAtLevel(REAL, combo, level)
      spells += u.spells.length
      skills += u.skills.length
    }
    assert.equal(spells, 0, `${cls} must have no Spellpage spells`)
    assert.ok(skills >= 10, `${cls} must still gain skills (${String(skills)})`)
  }
})

test('a caster loadout gains real spells at real levels, with the card fields the hover prints', () => {
  const combo = comboClassesOf(interval(0, null, [slot(['ENC']), slot(['CLR'])]))
  let levelsWithSpells = 0
  let withDetail = 0
  for (let level = 1; level <= 60; level++) {
    const u = unlocksAtLevel(REAL, combo, level)
    if (u.spells.length > 0) levelsWithSpells++
    for (const row of u.spells) {
      if (row.spell?.castTimeMs !== undefined || row.spell?.mana !== undefined) withDetail++
    }
  }
  assert.ok(levelsWithSpells >= 20, `levels with new spells: ${String(levelsWithSpells)}`)
  assert.ok(withDetail >= 50, `spell rows carrying card fields: ${String(withDetail)}`)
})

test('the innates the structure derived are placed: PAL Lay on Hands @1, SHD Harm Touch @1', () => {
  const pal = comboClassesOf(interval(0, null, [slot(['PAL']), slot(['SHD'])]))
  const u = unlocksAtLevel(REAL, pal, 1)
  const innates = u.skills.filter((r) => r.kind === 'innate').map((r) => r.name)
  assert.ok(innates.includes('Lay on Hands'), innates.join(', '))
  assert.ok(innates.includes('Harm Touch'), innates.join(', '))
})

/** Rows a player has confirmed in EQ Legends — `CONFIRMED_UNLOCKS` in src/main/data/levelUnlocks.ts. */
const CONFIRMED = new Set(['RNG:Disrupting Shot'])

test('every UNCONFIRMED non-Rogue discipline row is LABELED disputed; every Rogue one is not', () => {
  let disputed = 0
  for (const [cls, rows] of Object.entries(REAL.skills)) {
    for (const row of rows ?? []) {
      if (row.kind !== 'disc') continue
      if (cls === 'ROG') assert.equal(row.dispute, undefined, `ROG ${row.name} must carry no dispute`)
      else if (CONFIRMED.has(`${cls}:${row.name}`)) {
        assert.equal(row.dispute, undefined, `${cls} ${row.name} was confirmed in game — no chip`)
      } else {
        assert.match(row.dispute ?? '', /only Rogue poison disciplines/, `${cls} ${row.name}`)
        disputed++
      }
    }
  }
  // BER 2 + MNK 10 = 12 today (RNG's one row is confirmed); a floor, a re-scrape may find more.
  assert.ok(disputed >= 12, `disputed discipline rows: ${String(disputed)}`)
})

test('Disrupting Shot reads level 20 for a Ranger, with NO disputed chip (JOS-351)', () => {
  // The reporter and the owner both have it at 20 on Legends, so the wiki's whole-table strike
  // through of RNG disciplines is overridden for this row — and RNG's table is only this row.
  const rng = comboClassesOf(interval(0, null, [slot(['RNG']), slot(['RNG'])]))
  const u = unlocksAtLevel(REAL, rng, 20)
  const row = u.skills.find((r) => r.name === 'Disrupting Shot')
  assert.ok(row, `no Disrupting Shot at RNG 20: ${u.skills.map((r) => r.name).join(', ')}`)
  assert.equal(row.kind, 'disc')
  assert.equal(row.level, 20)
  assert.equal(row.dispute, undefined, 'Disrupting Shot must not wear the disputed chip')
  // And it appears at NO other level — a confirmation that also moved the row would be a new claim.
  for (let level = 1; level <= 65; level++) {
    if (level === 20) continue
    const other = unlocksAtLevel(REAL, rng, level).skills.find((r) => r.name === 'Disrupting Shot')
    assert.equal(other, undefined, `Disrupting Shot also placed at ${String(level)}`)
  }
})

test('a real ding produces a real subtitle — the exact string the toast would print', () => {
  const combo = comboClassesOf(interval(0, null, [slot(['CLR']), slot(['PAL']), slot(['ENC'])]))
  const u = unlocksAtLevel(REAL, combo, 24)
  const sub = levelUpSubtitle(u)
  assert.ok(sub && /new spell/.test(sub), `level 24 CLR/PAL/ENC subtitle: ${String(sub)}`)
  assert.equal(u.ambiguous, false)
  // Every row names at least one class IN the loadout — the join never leaks a stranger's unlock.
  for (const row of [...u.spells, ...u.skills]) {
    assert.ok(row.classes.every((c) => ['CLR', 'PAL', 'ENC'].includes(c)), `${row.name}: ${row.classes.join('/')}`)
  }
})
