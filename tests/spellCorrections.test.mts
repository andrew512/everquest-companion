// JOS-150 — OUR CORRECTIONS OVERLAY THE WIKI, AND THE WIKI STAYS PRISTINE.
//
// `src/main/data/spells.json` is a SCRAPE and `scripts/scrape-spells.ts` rewrites it wholesale, so
// a hand-edit into it is lost on the next re-scrape. `src/main/data/spellCorrections.ts` is the
// other half: what we know that the wiki does not, applied to the ENTRIES at load, before any
// lookup table is derived. Read that file's header for the evidence bar; this suite is the guard
// that keeps the overlay from rotting into a fiction.
//
// FOUR THINGS ARE PINNED HERE, and the first is the one that matters most:
//
//   1. THE ANTI-ROT GUARD. Every correction must still DESCRIBE something. A correction whose
//      `from` is no longer in the DB and whose `to` is not there either is STALE: the wiki moved
//      under it, and it now looks like coverage while providing none. `applySpellCorrections`
//      reports those and this suite fails on a non-empty list, with the spell and the text it
//      really found — which is exactly the report needed to re-derive the correction.
//   2. IDEMPOTENCE. Applying the overlay to an already-corrected list changes nothing and reports
//      every entry `satisfied`. That is what makes a re-scrape safe in BOTH directions: if the
//      wiki fixes a message upstream, the correction quietly becomes a no-op instead of fighting.
//   3. NON-MUTATION. The spell list comes from an ES-imported JSON module, one shared object for
//      the whole process. The overlay must copy rather than write through it.
//   4. THE ACCEPTANCE: the reported defect, end to end. A Drifting Death cast plus the landing
//      sentence the LIVE GAME prints yields a HOLD under the unified model. It could not before,
//      by one preposition.
//   5. THE ABSENT FIELD (JOS-159). A correction may state `from: null` for a field the DB leaves
//      EMPTY, which is how `Allure` joined the `Someone has been charmed.` family and how the
//      owner's charm countdown started firing at all. It gets the same anti-rot treatment as
//      every other entry, which is what tests 1 and 2 above are re-run for here: it applies only
//      while the field is genuinely absent, a re-scrape that supplies the same text makes it
//      satisfied, and one that supplies a DIFFERENT text makes it stale.
//
// THE SHAPES BELOW ARE REAL. `<target> is engulfed by a swarm.` is in the owner's own log (12
// occurrences whole-log, against 0 of the wiki's `in a swarm` form), so no reporter-slice bytes
// enter the tree — the AGENTS.md rule. `You begin casting <Spell>.` is the shape every combat
// fixture carries; `You begin casting Allure VI.` and `<mob> has been charmed.` are the owner's
// own (227 ranked Allure casts, 423 charm broadcasts), and the charm sentence is committed in
// `tests/fixtures/w13-charm-break-recharm.log` besides.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser.ts'
import { installSpellDb } from '../src/main/log/rulesets.ts'
import { loadSpellDb, spellCorrectionsReport, matchCastOnOtherSuffix } from '../src/main/data/spellDb.ts'
import { applySpellCorrections, SPELL_CORRECTIONS } from '../src/main/data/spellCorrections.ts'
import { BuffsModule } from '../src/main/modules/buffs.ts'
import { BuffTimersModule } from '../src/main/modules/buffTimers.ts'
import { buildTimerRows, rowsForSurface } from '../src/shared/buffTimers.ts'
import type { SpellDbFile } from '../src/shared/types.ts'
import spellsJson from '../src/main/data/spells.json' with { type: 'json' }

const RAW = (spellsJson as SpellDbFile).spells

// ---------------------------------------------------------------------------------------------
// 1 — THE ANTI-ROT GUARD
// ---------------------------------------------------------------------------------------------

test('every correction still describes a spell and a message the DB really has', () => {
  const { report } = applySpellCorrections(RAW)
  assert.deepEqual(report.unknownSpells, [], 'a correction naming a spell the DB does not have is a typo or a rename')
  assert.deepEqual(
    report.stale,
    [],
    'STALE: the scrape moved a message out from under a correction. Re-derive it from the log, or delete it.'
  )
  assert.ok(report.applied > 0, 'the overlay is supposed to change something')
})

test('no two corrections claim the same spell and field', () => {
  // Two entries may share a `from` (the mystic-symbol sentence is corrected differently for
  // Transal and for Pinzarn). Two entries claiming the same SPELL and FIELD would be a
  // contradiction whose winner is decided by array order, which is not a decision anyone made.
  const seen = new Set<string>()
  for (const c of SPELL_CORRECTIONS) {
    for (const s of c.spells) {
      const key = `${s}\u0000${c.field}`
      assert.ok(!seen.has(key), `two corrections claim ${s}.${c.field}`)
      seen.add(key)
    }
  }
})

test('an ABSENT field is filled, and only while it is absent', () => {
  // JOS-159. `Allure` is the only enchanter detrimental in the scrape with no cast-on-other
  // message, so the charm broadcast named seven spells and not the one the owner casts.
  const before = RAW.find((s) => s.name === 'Allure')
  assert.ok(before, 'the DB must still carry the enchanter charm at 46')
  assert.equal(before.msgCastOnOther, undefined, 'and the committed scrape still states nothing')

  const { spells, report } = applySpellCorrections(RAW)
  assert.equal(
    spells.find((s) => s.name === 'Allure')?.msgCastOnOther,
    'Someone has been charmed.',
    'the overlay supplies what the wiki left empty'
  )
  assert.deepEqual(report.stale, [], 'an absent field is a MATCH for `from: null`, never a stale correction')

  // Both re-scrape directions, on the absent-field entry specifically.
  const filledSame = RAW.map((s) => (s.name === 'Allure' ? { ...s, msgCastOnOther: 'Someone has been charmed.' } : s))
  const same = applySpellCorrections(filledSame).report
  assert.deepEqual(same.stale, [], 'a wiki that fills the field with our text is not a conflict')

  const filledOther = RAW.map((s) => (s.name === 'Allure' ? { ...s, msgCastOnOther: 'Someone looks smitten.' } : s))
  const other = applySpellCorrections(filledOther).report
  const hit = other.stale.find((x) => x.spell === 'Allure')
  assert.ok(hit, 'a wiki that fills it with something ELSE must fail this suite, not be overwritten')
  assert.equal(hit.found, 'Someone looks smitten.')
})

test('every correction states evidence and an attribution route', () => {
  for (const c of SPELL_CORRECTIONS) {
    assert.ok(c.spells.length > 0, 'a correction with no spells corrects nothing')
    assert.notEqual(c.from, c.to, `${c.spells[0]}.${c.field}: a correction that changes nothing is noise`)
    assert.ok(c.evidence.length > 20, `${c.spells[0]}.${c.field}: state what was measured`)
    assert.ok(['cast', 'db', 'sole'].includes(c.attribution))
  }
})

// ---------------------------------------------------------------------------------------------
// 2 / 3 — IDEMPOTENCE AND NON-MUTATION
// ---------------------------------------------------------------------------------------------

test('applying the overlay twice is applying it once', () => {
  const first = applySpellCorrections(RAW)
  const second = applySpellCorrections(first.spells)
  assert.deepEqual(second.spells, first.spells, 'the second pass must be a no-op on the entries')
  assert.equal(second.report.applied, 0, 'nothing left to apply')
  assert.equal(second.report.stale.length, 0, 'and an already-corrected entry is not stale, it is satisfied')
  assert.equal(second.report.satisfied, first.report.applied + first.report.satisfied)
})

test('a message the wiki fixes upstream reports satisfied, not stale', () => {
  // The re-scrape case, simulated: pretend the wiki now prints what the game prints.
  const fixed = RAW.map((s) =>
    s.name === 'Drifting Death' ? { ...s, msgCastOnOther: 'Someone is engulfed by a swarm.' } : s
  )
  const { report } = applySpellCorrections(fixed)
  assert.deepEqual(report.stale, [])
  assert.ok(report.satisfied >= 1, 'the entry becomes a no-op rather than a conflict')
})

test('a message the wiki moves somewhere ELSE reports stale, naming what it found', () => {
  const moved = RAW.map((s) => (s.name === 'Drifting Death' ? { ...s, msgCastOnOther: 'Someone buzzes.' } : s))
  const { report } = applySpellCorrections(moved)
  const hit = report.stale.find((x) => x.spell === 'Drifting Death')
  assert.ok(hit, 'silence here is the failure mode this whole field exists to prevent')
  assert.equal(hit.found, 'Someone buzzes.')
})

test('the overlay never writes through the imported JSON module', () => {
  const before = RAW.find((s) => s.name === 'Drifting Death')?.msgCastOnOther
  applySpellCorrections(RAW)
  assert.equal(
    RAW.find((s) => s.name === 'Drifting Death')?.msgCastOnOther,
    before,
    'spells.json is one shared object for the process; mutating it would leak into every importer'
  )
  assert.equal(before, 'Someone is engulfed in a swarm.', 'and the committed scrape still says what the wiki says')
})

// ---------------------------------------------------------------------------------------------
// THE LOAD SEAM — corrections reach every DERIVED structure, not just one table
// ---------------------------------------------------------------------------------------------

test('loadSpellDb builds its tables from the CORRECTED entries', () => {
  const db = loadSpellDb()
  const report = spellCorrectionsReport()
  assert.ok(report && report.applied > 0, 'the load path reports what it applied')

  // The suffix table AND its hot-path index, which is what the parser actually reads.
  const hit = matchCastOnOtherSuffix('a rock golem is engulfed by a swarm.', db)
  assert.ok(hit, 'the live sentence must resolve at all')
  assert.equal(hit.target, 'a rock golem')
  assert.ok(
    hit.entry.cands.some((c) => c.name === 'Drifting Death'),
    `Drifting Death must be a candidate: ${hit.entry.cands.map((c) => c.name).join(', ')}`
  )
  assert.equal(db.castOnOtherSuffix.get('is engulfed in a swarm.'), undefined, 'and the wiki form is gone')

  // A cast-on-you correction and a wears-off correction, one of each, through the same load.
  assert.ok(
    db.castOnYou.get('The symbol of Transal flashes before your eyes.')?.some((s) => s.name === 'Symbol of Transal'),
    'the symbol names itself, and the generic wiki sentence no longer stands in for it'
  )
  assert.equal(db.castOnYou.get('A mystic symbol flashes before your eyes.')?.length, 3, 'the three unevidenced symbols keep it')
  assert.ok(db.wearsOff.get('Your skin stops tingling.'), 'the clean sentence is a fade message')
  assert.equal(db.wearsOff.get('Your skin stops tingling. <!--'), undefined, 'the scrape artifact is not a message')
})

// ---------------------------------------------------------------------------------------------
// 4 — THE ACCEPTANCE: the reported defect, through the real parser and the real unified model
// ---------------------------------------------------------------------------------------------

/** An EQ-stamped line at `sec` seconds past 22:58:00 — the real `[Day Mon DD HH:MM:SS YYYY] ` shape. */
function at(sec: number, text: string): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  const h = 22 + Math.floor((58 * 60 + sec) / 3600)
  const m = Math.floor(((58 * 60 + sec) % 3600) / 60)
  return `[Sat Aug 09 ${two(h)}:${two(m)}:${two(sec % 60)} 2026] ${text}`
}

/** The `tests/buffUnifiedModel.test.mts` harness: both modules, wired the way wiring.ts wires them. */
function replay(lines: [number, string][], observeSec: number) {
  const db = loadSpellDb()
  installSpellDb(db)
  const buffs = new BuffsModule(db)
  buffs.reset()
  const timers = new BuffTimersModule(buffs.castAnchors(), buffs.spellStats())
  timers.reset()
  let seq = 0
  for (const [sec, text] of lines) {
    const ev = parseEvent(at(sec, text), seq++)
    if (!ev) continue
    buffs.onEvent(ev)
    timers.onEvent(ev)
  }
  const tick = parseEvent(at(observeSec, 'x'), seq)?.ts ?? 0
  buffs.onTick(tick)
  timers.onTick(tick)
  const b = buffs.snapshot().state
  const t = timers.snapshot().state
  // `active` is the BUFFS half (self and named-target landings); `holds` is the CC half (mez,
  // root, charm — the detrimental holds on somebody else). A row can come from either, so both
  // are returned and each acceptance below asserts against the one its defect lives in.
  return { rows: buildTimerRows(b, t), active: b.active, holds: t.holds }
}

test('THE REPORTED DEFECT: a Drifting Death cast plus the live landing yields a HOLD', () => {
  const r = replay(
    [
      [0, 'You begin casting Drifting Death.'],
      [3, 'a rock golem is engulfed by a swarm.']
    ],
    30
  )
  const row = r.rows.find((x) => x.name === 'Drifting Death')
  assert.ok(row, `no Drifting Death row: ${r.rows.map((x) => x.name).join(', ') || '(none)'}`)
  assert.equal(row.target, 'a rock golem')
  assert.equal(row.kind, 'debuff')
  assert.equal(row.mode, 'countdown')
  assert.equal(row.durationMs, 60_000, 'the committed DB states 1 minute for the line')
  assert.ok(rowsForSurface(r.rows, 'debuffs').includes(row), 'and it belongs to the DEBUFFS window')
  // The HOLD itself, one level under the row: a (spell, entity) instance the unified model is
  // carrying. Before the correction the landing line parsed to nothing at all, so there was no
  // instance to render and the row above could not exist however the projection was written.
  assert.ok(
    r.active.some((a) => a.spell === 'Drifting Death' && a.target === 'a rock golem'),
    `no held instance: ${r.active.map((a) => `${a.spell}@${a.target ?? 'self'}`).join(', ') || '(none)'}`
  )
})

test('…and the sentence the WIKI writes still yields nothing, which is the defect stated', () => {
  const r = replay(
    [
      [0, 'You begin casting Drifting Death.'],
      [3, 'a rock golem is engulfed in a swarm.']
    ],
    30
  )
  assert.equal(
    r.rows.find((x) => x.name === 'Drifting Death'),
    undefined,
    'the game does not print this sentence, so nothing in the tree should recognize it'
  )
})

test('the root line lands too: `<mob> adheres to the ground.` is 493 lines the DB owned nowhere', () => {
  // Immobilize 14/14 casts, Root 1/1, whole-log. The cast-on-YOU half was always right; only the
  // third-person sentence was the wiki's invention.
  const r = replay(
    [
      [0, 'You begin casting Immobilize.'],
      [2, 'a fire giant warrior adheres to the ground.']
    ],
    30
  )
  const row = r.rows.find((x) => x.name === 'Immobilize')
  assert.ok(row, `no Immobilize row: ${r.rows.map((x) => x.name).join(', ') || '(none)'}`)
  assert.equal(row.target, 'a fire giant warrior')
  assert.equal(row.kind, 'debuff')
})

test('JOS-159: an Allure cast plus the charm broadcast opens a charm hold with a countdown', () => {
  // The owner is an enchanter who charms all day, and the countdown JOS-140 built never fired for
  // him: the DB's candidate list for this sentence held seven spells and none of them was his.
  // The cast line is RANKED and the DB entry is not, which `spellCanonKey` folds — the anchor and
  // the candidate meet at `allure`, and the row prints the rank the cast line carried.
  const r = replay(
    [
      [0, 'You begin casting Allure VI.'],
      [4, 'Bzzazzt has been charmed.']
    ],
    30
  )
  const row = r.rows.find((x) => x.target === 'Bzzazzt')
  assert.ok(row, `no charm row: ${r.rows.map((x) => `${x.name}@${x.target ?? 'self'}`).join(', ') || '(none)'}`)
  assert.equal(row.name, 'Allure VI', 'the ranked cast line names the row')
  assert.equal(row.kind, 'cc', 'a charm is a HOLD, in the same shape as a mez')
  assert.ok(rowsForSurface(r.rows, 'debuffs').includes(row), 'and it belongs to the DEBUFFS window')
  assert.equal(row.mode, 'countdown', 'charm-break timing is the whole point')
  assert.equal(row.durationMs, 960_000, 'the DB states 16 minutes for the Allure line')
  // The HOLD itself, one level under the row: before the correction the broadcast resolved to a
  // candidate list with no anchored member in it, so there was no instance to render at all.
  assert.equal(r.holds.length, 1, 'one cast, one charmed mob, one hold')
  assert.equal(r.holds[0].target, 'Bzzazzt')
})

test('…and with the wiki`s empty field the same sequence still opens nothing', () => {
  // The defect stated. `applySpellCorrections` is the only thing standing between these two tests.
  const bare = applySpellCorrections(RAW, SPELL_CORRECTIONS.filter((c) => !c.spells.includes('Allure')))
  assert.equal(bare.spells.find((s) => s.name === 'Allure')?.msgCastOnOther, undefined)
  const cands = bare.spells.filter((s) => s.msgCastOnOther === 'Someone has been charmed.').map((s) => s.name)
  assert.equal(cands.length, 7, `the seven the ticket counted: ${cands.join(', ')}`)
  assert.ok(!cands.includes('Allure'), 'and the owner`s own charm was not one of them')
})
