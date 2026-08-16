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

function foldFixture(): { fold: ResistFold; rows: ResistRow[] } {
  const db = loadSpellDb()
  installSpellDb(db)
  installCharacterName('Primitive')
  const fold = new ResistFold({ spellDb: db })
  fold.beginSource()
  let seq = 0
  for (const line of readFileSync(FIXTURE, 'utf8').split(/\r?\n/)) {
    if (!line) continue
    const ev = parseEvent(line, seq++)
    if (ev) fold.onEvent(ev)
  }
  fold.finish()
  return { fold, rows: fold.rows() }
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
