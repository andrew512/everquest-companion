// THE SHIPPED BASELINE: what is in it, what is deliberately not, and what it says (JOS-382).
//
// TWO KINDS OF ASSERTION, and the split matters.
//
//   THE SHAPE assertions run everywhere, including CI. They are about the FILE: its schema, its
//   size, and — the part worth a test rather than a comment — the things a public artifact mined
//   from one player's log must NOT carry. No character names, no zones, no timestamps, and no
//   verdicts. It records observations, and an observation is a count.
//
//   THE ESTIMATE assertions need the client's `spells_us.txt`, which is Daybreak's file and is
//   never committed here. They SKIP where it is absent, with the same reasoning the full-log tests
//   skip on CI: a test that cannot see its input reports that, rather than passing vacuously.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { estimate, resistTag } from '../src/shared/resistModel'
import { rowTotal } from '../src/main/resist/ledger'
import { parseSpellsUs } from '../src/main/resist/spellsUsParse'
import {
  BASELINE_SOURCE_KEY,
  RESIST_AXES,
  type ResistLedger,
  type ResistRow,
  type SpellResistTable
} from '../src/shared/resistTypes'

const PATH = join(import.meta.dirname, '..', 'src', 'main', 'data', 'resistBaseline.json')
const LEDGER = JSON.parse(readFileSync(PATH, 'utf8')) as ResistLedger
const ROWS = LEDGER.sources[0].rows

const SPELLS_US =
  process.env.EQ_SPELLS_US ??
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/spells_us.txt'
const HAVE_CLIENT = existsSync(SPELLS_US)
let table: SpellResistTable | null = null
function spells(): SpellResistTable {
  table ??= parseSpellsUs(readFileSync(SPELLS_US, 'latin1'))
  return table
}

function rowsFor(mob: string): ResistRow[] {
  return ROWS.filter((r) => r.mobKey === mob)
}

test('the file is one baseline source at schema 1, stamped with when it was frozen', () => {
  assert.equal(LEDGER.schema, 1)
  assert.equal(LEDGER.sources.length, 1)
  assert.equal(LEDGER.sources[0].key, BASELINE_SOURCE_KEY)
  // PINNED, not `new Date()`: a re-run on an unchanged log has to diff to nothing, or the file
  // churns on every regeneration and a real new observation is invisible in the diff.
  assert.match(LEDGER.frozenAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('it is big enough to be worth shipping and small enough to inline', () => {
  const bytes = statSync(PATH).size
  assert.ok(ROWS.length > 1000, `${String(ROWS.length)} rows`)
  // Inlined into the main bundle by electron-vite, beside a 979 kB spells.json and an 8.6 MB
  // items.json. Under a megabyte is the bar the brief set; the row threshold is the dial.
  assert.ok(bytes < 1_000_000, `${String(bytes)} bytes`)
})

test('every row carries at least the threshold the generator states', () => {
  for (const row of ROWS) {
    assert.ok(rowTotal(row) >= 5, `${row.mobKey} / ${row.spellKey} carries ${String(rowTotal(row))}`)
  }
})

test('IT IS OBSERVATIONS ONLY: no itinerary, no clock, no verdicts', () => {
  for (const row of ROWS) {
    // A zone is where this player fought the mob, not a fact about the mob.
    assert.equal(row.zone, undefined)
    // And the hour on the evening he fought it says even less.
    assert.equal(row.firstTs, 0)
    assert.equal(row.lastTs, 0)
    // `source` is applied at READ time by the ledger; a row that carried it would be asserting
    // its own provenance, which is the ledger's job and not the file's.
    assert.equal(row.source, undefined)
  }
  // No R, no interval, no "immune" anywhere in the file - a stored verdict is a second opinion
  // waiting to disagree with the derived one.
  const text = readFileSync(PATH, 'utf8')
  for (const forbidden of ['"immune"', '"tag"', '"estimate"']) {
    assert.ok(!text.includes(forbidden), `the file must not carry ${forbidden}`)
  }
})

test('no character name reaches the file', () => {
  // The only names a row carries are a MOB and a SPELL. The tailed character's name and every
  // other player's are structurally absent: neither has a field to live in.
  for (const row of ROWS.slice(0, 200)) {
    assert.ok(!/primitive/i.test(row.mobKey))
    assert.ok(!/primitive/i.test(row.spellKey))
  }
  assert.ok(!readFileSync(PATH, 'utf8').includes('Primitive'))
})

test('NO SONG IN THE SHIPPED BASELINE IS RESIST-ONLY', () => {
  // The regression guard for the defect that shipped in round one. A bard's songs re-pulse under
  // the Symphonic Aura with no cast line, so nothing joined their landing emote to anything and
  // Largo's Melodic Binding was filed as 400 resists with ZERO landings - a spell that is 100%
  // resisted by construction, dragging magic toward "nearly immune" on every mob a bard sang at.
  const songs = ROWS.filter((r) => r.family === 'song')
  assert.ok(songs.length > 100, `only ${String(songs.length)} song rows`)
  const bySpell = new Map<string, { resist: number; land: number }>()
  for (const row of songs) {
    const acc = bySpell.get(row.spellKey) ?? { resist: 0, land: 0 }
    acc.resist += row.resist
    acc.land += row.land
    bySpell.set(row.spellKey, acc)
  }
  for (const [key, acc] of bySpell) {
    assert.ok(acc.land > 0, `${key}: ${String(acc.resist)} resists and no landings at all`)
  }
})

test("Largo's is a SONG, with the denominator its pulses printed", () => {
  const largo = ROWS.filter((r) => r.spellKey === "largo's melodic binding")
  assert.ok(largo.length > 0)
  for (const row of largo) assert.equal(row.family, 'song')
  const land = largo.reduce((a, r) => a + r.land, 0)
  const resist = largo.reduce((a, r) => a + r.resist, 0)
  assert.ok(land > resist * 4, `${String(land)} landings against ${String(resist)} resists`)
  // And the catalog's other spelling of the same song is folded away, never a second row.
  assert.equal(ROWS.filter((r) => r.spellKey === "largo's assonant binding").length, 0)
})

test('a mob a bard sang at reads NORMAL, not nearly immune', { skip: !HAVE_CLIENT && 'no client spells_us.txt' }, () => {
  // `soldier of v`zher`, the mob the defect was found on. Before: R 188 [188,226] off 70 resists
  // and no landings whatever. After: the song's own pulses supply the denominator.
  const rows = rowsFor("soldier of v'zher")
  const est = estimate(rows, spells(), { axis: 'magic', mobLevel: 26 })
  assert.ok(est.byFamily.song.n > 300, `song observations: ${String(est.byFamily.song.n)}`)
  assert.ok(est.R >= 15 && est.R <= 45, `R=${String(est.R)} outside the 15-45 a 315/70 split implies`)
  assert.equal(resistTag(est.R), 'normal')
})

test('only casters the owner ruled admissible are in it', () => {
  const kinds = new Set(ROWS.map((r) => r.casterKind))
  for (const kind of kinds) assert.ok(kind === 'self' || kind === 'pc', `caster kind ${kind}`)
})

test('Lord Nagafen reads the magic resistance the plan predicted', { skip: !HAVE_CLIENT && 'no client spells_us.txt' }, () => {
  const rows = rowsFor('lord nagafen')
  assert.ok(rows.length > 0)
  const est = estimate(rows, spells(), { axis: 'magic', mobLevel: 55 })
  // docs/plans/resist-mining.md section 3, hand-derived from this same log before any of this
  // code existed: R_magic 140 [92,206] from fixed damage, 126 [110,144] from all-or-nothing.
  assert.ok(est.n > 200, `n=${String(est.n)}`)
  assert.ok(est.R >= 90 && est.R <= 210, `R=${String(est.R)} outside the predicted [90, 210]`)
})

test('a ghoul knight is provably COLD-resistant, from the owner\'s own casts', { skip: !HAVE_CLIENT && 'no client spells_us.txt' }, () => {
  // THE HEADLINE CLAIM, on a mob the evidence can actually support. The brief named the imp
  // protector and the lava guardian; their fire evidence in this log is entirely NPC-vs-NPC (imp
  // protectors casting Dry Bone Fire Burst at each other), which the owner's own ruling excludes
  // outright, so neither can speak. The ghoul knights can: the tailed character nuked them with
  // both axes for weeks.
  const rows = rowsFor('a zol ghoul knight')
  const cold = estimate(rows, spells(), { axis: 'cold', mobLevel: 38 })
  const magic = estimate(rows, spells(), { axis: 'magic', mobLevel: 38 })
  assert.ok(cold.n >= 60, `cold n=${String(cold.n)}`)
  assert.ok(magic.n >= 500, `magic n=${String(magic.n)}`)
  assert.ok(cold.R > magic.R, `cold R=${String(cold.R)} vs magic R=${String(magic.R)}`)
  // And provably so: the intervals do not overlap, which is what turns "looks higher" into a
  // statement a player can act on.
  assert.ok(cold.lo > magic.hi, `cold [${String(cold.lo)},${String(cold.hi)}] vs magic [${String(magic.lo)},${String(magic.hi)}]`)
})

test('every axis answers for a well-observed mob, and thin ones say so', { skip: !HAVE_CLIENT && 'no client spells_us.txt' }, () => {
  const rows = rowsFor('a zol ghoul knight')
  const counts = RESIST_AXES.map((axis) => estimate(rows, spells(), { axis, mobLevel: 38 }).n)
  // Five rows, always. Some of them are zero, and a zero is a real answer the card prints as
  // "not enough data" rather than omitting.
  assert.equal(counts.length, 5)
  assert.ok(counts.filter((n) => n >= 5).length >= 3, `axes with data: ${counts.join(',')}`)
})

test('the shipped rows are all baseline-weighted until a user has any of their own', { skip: !HAVE_CLIENT && 'no client spells_us.txt' }, () => {
  const rows = rowsFor('a zol ghoul knight').map((r) => ({ ...r, source: 'baseline' as const }))
  const est = estimate(rows, spells(), { axis: 'magic', mobLevel: 38 })
  assert.equal(est.fromYou, 0)
  assert.ok(est.fromBaseline > 0)
  // With nothing of your own, K/(K+0) = 1: the shipped data counts in full, which is the whole
  // point of shipping it.
  assert.equal(est.baselineWeight, 1)
  assert.equal(est.userOnly, false)
  assert.equal(est.differsFromShipped, false)
})
