// THE FOLD, AGAINST THE OWNER'S REAL BYTES (JOS-382).
//
// `tests/fixtures/r1-kodiak-fight.log` is one pull in West Commonlands, cut by
// `npm run fixtures:resist` through the shared scrub. It was chosen because a single fight
// contains every shape this fold has to get right, and the extractor's header lists them line by
// line. Nothing here is authored: these are bytes the game printed.
//
// THIS FIXTURE HAS ALREADY EARNED ITS KEEP. The first fold of it produced seven landings for
// Chaos-Feedback casts that had ALSO printed seven damage lines — one cast counted twice, because
// the cancel rule assumed the emote came first and the game prints the damage first. That is the
// class of error a golden window exists to catch, and the assertion below is the shape of the fix.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { installCharacterName, installSpellDb } from '../src/main/log/rulesets'
import { loadSpellDb } from '../src/main/data/spellDb'
import { ResistFold } from '../src/main/resist/fold'
import { ResistLedgerStore, rowTotal } from '../src/main/resist/ledger'
import type { ResistRow } from '../src/shared/resistTypes'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'r1-kodiak-fight.log')
/** The JOS-385 window: imp protectors throwing fire at each other AND at the player. */
const NPC_FIXTURE = join(import.meta.dirname, 'fixtures', 'r4-npc-casters.log')

function foldFile(path: string): { fold: ResistFold; rows: ResistRow[] } {
  const db = loadSpellDb()
  installSpellDb(db)
  installCharacterName('Primitive')
  const fold = new ResistFold({ spellDb: db })
  fold.beginSource()
  let seq = 0
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line) continue
    const ev = parseEvent(line, seq++)
    if (ev) fold.onEvent(ev)
  }
  fold.finish()
  return { fold, rows: fold.rows() }
}

function foldFixture(): { fold: ResistFold; rows: ResistRow[] } {
  return foldFile(FIXTURE)
}

const find = (rows: readonly ResistRow[], mob: string, spell: string): ResistRow | undefined =>
  rows.find((r) => r.mobKey === mob && r.spellKey === spell)

test('THE ARTICLE FOLDS: one mob, however the game capitalised it', () => {
  const { rows } = foldFixture()
  // Every damage line in the window spells it `a kodiak`; every resist line spells it `A kodiak`.
  // Two keys here would mean the whole feature counts one creature as two.
  const mobs = new Set(rows.map((r) => r.mobKey))
  assert.deepEqual([...mobs].sort(), ['a kodiak', 'a young kodiak'])
})

test('a fixed-damage nuke files its NUMBER, and its resist, and nothing else', () => {
  const { rows } = foldFixture()
  const row = find(rows, 'a kodiak', 'chaotic feedback')
  assert.ok(row)
  // Eight casts at this mob in the window: seven landed for exactly 30, one was resisted.
  assert.deepEqual(row.dmg, { '30': 7 })
  assert.equal(row.resist, 1)
  // AND ZERO LANDINGS. `A kodiak's brain begins to smolder.` follows every one of those damage
  // lines; counting it would double the nuke. One cast is one roll.
  assert.equal(row.land, 0)
  assert.equal(rowTotal(row), 8)
})

test('an all-or-nothing spell earns its landing from the emote its own cast anchors', () => {
  const { rows } = foldFixture()
  const row = find(rows, 'a kodiak', 'languid pace')
  assert.ok(row)
  // Two `You begin casting Languid Pace.` lines, two `a kodiak slows down.` emotes, no damage
  // line anywhere — which is the only way a landing is ever earned for a spell that deals none.
  assert.equal(row.land, 2)
  assert.equal(row.resist, 0)
  assert.deepEqual(row.dmg, {})
})

test('a CRITICAL melee swing is not a spell observation at all', () => {
  const { rows } = foldFixture()
  // `You crush a kodiak for 35 points of damage. (Critical)` is melee: it puts the mob in contact
  // for a song pulse and files nothing about any resist axis.
  const values = rows.flatMap((r) => Object.keys(r.dmg))
  assert.ok(!values.includes('35'), 'a melee crit must never reach a spell histogram')
  assert.ok(!values.includes('34'))
})

test('a proc files its own row, keyed by its own spell', () => {
  const { rows } = foldFixture()
  const row = find(rows, 'a kodiak', 'smiting strike')
  assert.ok(row)
  assert.deepEqual(row.dmg, { '28': 1 })
  // Separate from the nuke's row, because a -250 resist adjust is a different offset entirely.
  assert.notEqual(find(rows, 'a kodiak', 'chaotic feedback'), row)
})

test('the mob level comes from the committed catalog, range and all', () => {
  const { rows } = foldFixture()
  const row = find(rows, 'a kodiak', 'chaotic feedback')
  assert.ok(row)
  assert.equal(row.mobLevel, 15)
  assert.equal(row.mobLevelLo, 14)
  assert.equal(row.mobLevelHi, 15)
  // The one `/con` in the window is of `Orvin`, a different creature entirely, and must not reach
  // the kodiak (world-model law 2: names are the identity, and they are dirty).
  const young = find(rows, 'a young kodiak', 'chaotic feedback')
  assert.equal(young?.mobLevel, 10)
})

test('the zone the fight happened in rides along', () => {
  const { rows } = foldFixture()
  for (const row of rows) assert.equal(row.zone, 'West Commonlands')
})

test('every caster in this window is you, and nothing else was admitted', () => {
  const { rows } = foldFixture()
  for (const row of rows) {
    assert.equal(row.casterKind, 'self')
    assert.equal(row.family, 'cast')
  }
})

// ---- the npc family (JOS-385), against r4-npc-casters.log -------------------------------------

test('AN NPC CASTER IS ITS OWN FAMILY, and its casts on another NPC are ordinary evidence', () => {
  const { rows } = foldFile(NPC_FIXTURE)
  const row = find(rows, 'an imp protector', 'dry bone fire burst')
  assert.ok(row, 'the imp protectors have been throwing fire at each other for a minute')
  assert.equal(row.casterKind, 'npc')
  assert.equal(row.family, 'cast')
  // Four `An imp protector resisted an imp protector's Dry Bone Fire Burst!` against two landings
  // that printed their number. BOTH outcomes, which is what makes a cell estimable at all: a
  // resist-only spell is what the estimator's blindness guard exists to refuse.
  assert.equal(row.resist, 4)
  assert.deepEqual(row.dmg, { '12': 1, '20': 1 })
})

test("…and the SAME spell aimed at the player files NOTHING", () => {
  const { rows } = foldFile(NPC_FIXTURE)
  // `an imp protector hit you for 46 points of fire damage by Dry Bone Fire Burst.` appears eight
  // times in this window, from the same caster and the same spell as the rows above. A row keyed
  // `you` would be a statement about a creature's resist stat with a PERSON in the creature's
  // place — and the shipped JOS-382 baseline had 68 of them (world.ts `isMobTarget`).
  assert.equal(rows.filter((r) => r.mobKey === 'you').length, 0)
  for (const row of rows) assert.notEqual(row.mobKey, 'you')
  // The 46s are the tell: they are the player's own damage taken, and no histogram may hold one.
  assert.ok(!rows.flatMap((r) => Object.keys(r.dmg)).includes('46'))
})

test('the player’s own casts on the same mob in the same seconds stay a separate row', () => {
  const { rows } = foldFile(NPC_FIXTURE)
  const mine = find(rows, 'an imp protector', 'smiting strike')
  assert.ok(mine)
  assert.equal(mine.casterKind, 'self')
  assert.deepEqual(mine.dmg, { '147': 4 })
  // Pooling the two would smear a level-45 imp's Dry Bone Fire Burst into a -250 player proc, which
  // is two different offsets in the same binomial. The row key carries `casterKind` for this.
  assert.notEqual(find(rows, 'an imp protector', 'dry bone fire burst'), mine)
})

test('an NPC caster’s LEVEL comes from the same ladder the mob level climbs', () => {
  // The window itself has no `/con` in it, so both levels are null there and the estimator would
  // drop the rows. This is that ladder's other rung: one real con line from the same character,
  // the same mob and the same afternoon (raw line 461046), and now the caster has a level.
  const db = loadSpellDb()
  installSpellDb(db)
  installCharacterName('Primitive')
  const fold = new ResistFold({ spellDb: db })
  fold.beginSource()
  const con = parseEvent(
    '[Thu Jul 30 13:59:44 2026] An imp protector scowls at you, ready to attack -- looks like it would wipe the floor with you! (Lvl: 44)',
    0
  )
  assert.ok(con)
  fold.onEvent(con)
  let seq = 1
  for (const line of readFileSync(NPC_FIXTURE, 'utf8').split(/\r?\n/)) {
    if (!line) continue
    const ev = parseEvent(line, seq++)
    if (ev) fold.onEvent(ev)
  }
  fold.finish()
  const row = find(fold.rows(), 'an imp protector', 'dry bone fire burst')
  assert.ok(row)
  // Caster and target are the same creature here, which is exactly the shape an NPC-on-NPC fight
  // has: the game states one level and both ends of `levelMod` read it.
  assert.equal(row.casterLevel, 44)
  assert.equal(row.mobLevel, 44)
  // A `pc` row can never do this - nothing in this app's inputs states another player's level.
  assert.equal(find(fold.rows(), 'an imp protector', 'smiting strike')?.casterKind, 'self')
})

test('an NPC caster never enters the song family', () => {
  const { rows } = foldFile(NPC_FIXTURE)
  assert.equal(rows.filter((r) => r.family === 'song').length, 0)
  // And the rule is structural rather than a property of this window: `SongFold` decides a song by
  // spell identity and hands back every kind but `self` before anything is filed, so an NPC
  // casting a bard song files nothing at all - not a song row and not a cast row either.
  const songs = readFileSync(
    join(import.meta.dirname, '..', 'src', 'main', 'resist', 'songFold.ts'),
    'utf8'
  )
  assert.equal((songs.match(/if \(kind !== 'self'\) return true/g) ?? []).length, 2)
})

test('a fizzle files nothing - a cast that never happened is not a resist', () => {
  const { rows } = foldFixture()
  // `Your Chaotic Feedback spell fizzles!` sits inside the window. If a fizzle armed a landing,
  // the nuke's count would exceed the eight casts the log actually shows.
  assert.equal(rowTotal(find(rows, 'a kodiak', 'chaotic feedback') as ResistRow), 8)
})

test('A RE-FOLD REPLACES A SOURCE BUCKET, IT NEVER ADDS TO IT (JOS-231)', () => {
  const db = loadSpellDb()
  installSpellDb(db)
  installCharacterName('Primitive')
  const store = new ResistLedgerStore()
  const lines = readFileSync(FIXTURE, 'utf8').split(/\r?\n/)

  const foldOnce = (): void => {
    const fold = new ResistFold({ spellDb: db })
    fold.beginSource(store.beginSource('Primitive_freeport'))
    let seq = 0
    for (const line of lines) {
      if (!line) continue
      const ev = parseEvent(line, seq++)
      if (ev) fold.onEvent(ev)
    }
    fold.finish()
  }

  foldOnce()
  const first = store.rowsFor('a kodiak', 'baseline').map(rowTotal)
  foldOnce()
  const second = store.rowsFor('a kodiak', 'baseline').map(rowTotal)
  // The app re-reads the whole log on every launch. If this were an ADD, every count in the field
  // would double once a day forever - which is exactly what happened to the message overlay
  // before its own buckets existed.
  assert.deepEqual(second, first)
})

test('a bucket for a character you are NOT folding survives untouched', () => {
  const db = loadSpellDb()
  installSpellDb(db)
  const store = new ResistLedgerStore()
  const other = store.beginSource('Someone_else')
  other.row(
    {
      mobKey: 'a kodiak',
      spellKey: 'chaotic feedback',
      family: 'cast',
      casterKind: 'self',
      casterLevel: 20,
      mobLevel: 15,
      debuffs: ''
    },
    1
  ).resist += 4

  const fold = new ResistFold({ spellDb: db })
  fold.beginSource(store.beginSource('Primitive_freeport'))
  for (const line of readFileSync(FIXTURE, 'utf8').split(/\r?\n/)) {
    if (!line) continue
    const ev = parseEvent(line, 0)
    if (ev) fold.onEvent(ev)
  }
  fold.finish()

  const kept = store.rowsFor('a kodiak', 'baseline').filter((r) => r.casterLevel === 20)
  assert.equal(kept.length, 1, 'knowledge nothing can re-derive is never discarded')
  assert.equal(kept[0].resist, 4)
})
