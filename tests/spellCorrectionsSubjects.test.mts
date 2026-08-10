// JOS-174 — THE SUBJECT PLACEHOLDER THE SCRAPE LOST, SWEPT.
//
// THE REPORT: a 0.14.0 shaman said Odium never shows on the debuff timer, "leveled to VI if that's
// the issue". The rank was NOT the issue — `canonKey` folds ` VI` off a cast line and the anchor
// joins the DB's `Odium` row perfectly. The LANDING was: the wiki writes the third-person sentence
// as `Target staggers under a dark curse.`, and `castOnOtherSuffix()` keys the cast-on-other table
// on what follows a `Someone ` subject and nothing else — so the spell was in no table, the live
// line classified as `{kind:'unknown'}`, and no `buffApply` ever existed for a bar to draw.
//
// `src/main/data/spellCorrectionsSubjects.ts` is the sweep and its header carries the argument:
// why this is a measured LIST rather than a wider subject stripper, and which two sentences it
// refuses. This suite is the guard on the properties that argument rests on.
//
// FOUR THINGS ARE PINNED HERE:
//
//   1. THE SHAPE. Every entry restores a SUBJECT and changes nothing else. Strip the leading
//      subject token from `from` and from `to` and the remainder is byte-identical — which is what
//      makes "the sentence is the wiki's own" a checkable claim rather than a promise.
//   2. STRICTLY ADDITIVE. Every restored tail is NEW to the suffix table, and no new tail is a
//      suffix of an existing one or vice versa. A new tail that could also match a line an
//      existing suffix owns would silently re-point that line by table order.
//   3. THE REFUSALS ARE REAL. ` looks powerful.` and ` feels lethargic.` have owner-log evidence
//      and are deliberately NOT corrected: `classifySpellEmote` already claims them and
//      `classifyDbBuff` runs above it, so a correction would TAKE a match rather than add one.
//   4. THE ACCEPTANCE: the reported defect, end to end, through the real parser and the real
//      unified model. An Odium VI cast plus the landing sentence the LIVE GAME prints opens a
//      DEBUFF row with a duration. It could not before, by one subject token.
//
// WHERE THE BYTES COME FROM. The landing sentence is the OWNER's own — `a rock golem staggers
// under a dark curse.` is in `eqlog_Primitive_freeport.txt` (Thu Jul 30 20:48:07; 19 lines of the
// shape whole-log, all previously unowned). The ONE sentence his log lacks is the cast, because he
// is not a shaman: `You begin casting Odium VI.` is quoted verbatim from report
// 01KZMS8NG4FBYCP1P51VK8WP1B and INJECTED here, which is the AGENTS.md rule for a defect that
// exists only in somebody else's log — no reporter-slice bytes enter the tree.
//
// MEASURED WHOLE-LOG BEFORE AND AFTER (the law-8 tripwire, 1,536,938 lines of the owner's log,
// every line parsed twice in one process): `unknown` 140,167 -> 139,645 and `buffApply` 104,876 ->
// 105,398. One transition, `unknown -> buffApply`, 522 lines. Every other kind byte-identical.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser.ts'
import { installSpellDb } from '../src/main/log/rulesets.ts'
import { buildSpellDb, castOnOtherSuffix, loadSpellDb, matchCastOnOtherSuffix } from '../src/main/data/spellDb.ts'
import { applySpellCorrections, SPELL_CORRECTIONS } from '../src/main/data/spellCorrections.ts'
import {
  SUBJECT_DRIFT_REFUSED,
  SUBJECT_PLACEHOLDER_CORRECTIONS
} from '../src/main/data/spellCorrectionsSubjects.ts'
import { BuffsModule } from '../src/main/modules/buffs.ts'
import { BuffTimersModule } from '../src/main/modules/buffTimers.ts'
import { buildTimerRows, rowsForSurface } from '../src/shared/buffTimers.ts'
import type { SpellDbFile } from '../src/shared/types.ts'
import spellsJson from '../src/main/data/spells.json' with { type: 'json' }

const RAW = (spellsJson as SpellDbFile).spells

/** The corrections the sweep did NOT bring — everything the registry held before JOS-174. */
const HAND_DERIVED = SPELL_CORRECTIONS.filter((c) => !SUBJECT_PLACEHOLDER_CORRECTIONS.includes(c))

/**
 * The wiki's subject vocabulary, stripped. The optional token AND the optional possessive are both
 * optional on purpose: the drift comes in two shapes — a WRONG placeholder (`Target's wounds
 * heal.`) and NO placeholder at all (`'s wounds heal.`, `becomes one with their weapons.`) — and
 * the sweep restores both to the same `Someone` form.
 */
function withoutSubject(msg: string): string {
  return msg.replace(/^(?:Someone|Player|Target|Soandso|Other_Player)?(?:\s*'s)?\s*/, '')
}

/** What a log line must END WITH for a suffix to match (spellDb.ts `matchTail`, restated). */
function tailOf(suffix: string): string {
  return suffix.startsWith("'s") ? suffix : ` ${suffix}`
}

// ---------------------------------------------------------------------------------------------
// 1 — THE SHAPE: a subject is restored, and nothing else is touched
// ---------------------------------------------------------------------------------------------

test('every sweep entry restores a SUBJECT and changes no other word', () => {
  assert.ok(SUBJECT_PLACEHOLDER_CORRECTIONS.length > 0, 'the sweep is supposed to contain something')
  for (const c of SUBJECT_PLACEHOLDER_CORRECTIONS) {
    const where = `${c.spells[0]}: ${c.from ?? '(absent)'} -> ${c.to}`
    assert.equal(c.field, 'msgCastOnOther', `${where}: the drift only exists on the third-person message`)
    assert.ok(c.from !== null, `${where}: this class replaces a sentence, it never fills an absent field`)
    assert.ok(c.to.startsWith('Someone'), `${where}: the restored subject is the one the table keys on`)
    assert.equal(
      withoutSubject(c.from),
      withoutSubject(c.to),
      `${where}: a subject restoration that also edits the sentence is a DIFFERENT correction and needs its own evidence`
    )
    // The point of the whole exercise, stated as an assertion: the wiki's text yields no suffix at
    // all (so the spell is in no table), and ours does.
    assert.equal(castOnOtherSuffix(c.from), null, `${where}: the wiki form must be the unkeyable one`)
    assert.ok(castOnOtherSuffix(c.to), `${where}: and the restored form must key`)
  }
})

test('every sweep entry states a measured evidence line and an attribution route', () => {
  // The registry-wide audit in `spellCorrections.test.mts` already checks this over
  // SPELL_CORRECTIONS as a whole. Repeated here against the DERIVED list because these entries are
  // built by a `map` rather than written out, and a generator that quietly produced an empty
  // `evidence` would satisfy nothing the reviewer can read.
  for (const c of SUBJECT_PLACEHOLDER_CORRECTIONS) {
    assert.ok(c.evidence.length > 40, `${c.spells[0]}: state what was measured`)
    assert.ok(['cast', 'db', 'sole'].includes(c.attribution), `${c.spells[0]}: ${c.attribution}`)
    assert.ok(c.spells.length > 0)
  }
})

// ---------------------------------------------------------------------------------------------
// 2 — STRICTLY ADDITIVE: no new tail competes with an old one
// ---------------------------------------------------------------------------------------------

/**
 * The suffixes this sweep JOINS rather than mints (JOS-189) — a row whose family already owns the
 * sentence, so restoring the subject adds candidates and creates no new tail. Named here rather
 * than inferred, so joining stays a decision somebody made per entry.
 */
const JOINS_EXISTING = new Set(['begins to chant.'])

test('every restored suffix is NEW to the table, or JOINS one exactly — never partially', () => {
  // The pre-sweep table: the scrape plus the hand-derived corrections, exactly what shipped before
  // JOS-174. Two shapes are admitted and the difference between them is the whole invariant.
  //
  // MINTING one is the ordinary case: the tail is absent, so nothing it matches was matching
  // anything before. JOINING one is the Tuyen chant case: all four chants write one sentence, the
  // scrape gave two of them a usable subject, and the other two are simply added as candidates to
  // a sentence the cast anchor already narrows.
  //
  // What neither may be is a PARTIAL overlap — a tail that is a suffix of an existing one, or has
  // one as a suffix. There a line matches both and which spell it means is decided by insertion
  // order rather than by anybody, which is the one thing this test exists to refuse.
  const before = buildSpellDb(applySpellCorrections(RAW, HAND_DERIVED).spells)
  const existing = [...before.castOnOtherSuffix.keys()].map(tailOf)
  for (const c of SUBJECT_PLACEHOLDER_CORRECTIONS) {
    const suffix = castOnOtherSuffix(c.to)
    assert.ok(suffix, `${c.spells[0]}: the restored message must yield a suffix`)
    const held = before.castOnOtherSuffix.get(suffix)
    if (JOINS_EXISTING.has(suffix)) {
      assert.ok(held, `${c.spells[0]}: \`${suffix}\` is declared a JOIN but the table does not hold it`)
      continue
    }
    assert.equal(held, undefined, `${c.spells[0]}: the table already held \`${suffix}\` — declare the join`)
    const tail = tailOf(suffix)
    for (const other of existing) {
      assert.ok(!other.endsWith(tail), `${c.spells[0]}: \`${tail}\` would also match every line of \`${other}\``)
      assert.ok(!tail.endsWith(other), `${c.spells[0]}: every line of \`${tail}\` already matches \`${other}\``)
    }
  }
})

test('JOS-189: the chant family is FOUR candidates for the one sentence it prints', () => {
  // The defect, at the layer it lives in. All four Tuyen chants print `<mob> begins to chant.`, and
  // the scrape wrote `Someone` for two of them and `Target` for the other two — so the sentence had
  // two owners, and a bard chaining all four had two of their debuffs filed under the wrong spell
  // and the other two nowhere at all.
  const db = loadSpellDb()
  const hit = matchCastOnOtherSuffix('an ice giant begins to chant.', db)
  assert.ok(hit, 'the live sentence must resolve at all')
  assert.equal(hit.target, 'an ice giant')
  assert.deepEqual(
    hit.entry.cands.map((c) => c.name).sort(),
    [
      "Tuyen's Chant of Disease",
      "Tuyen's Chant of Flame",
      "Tuyen's Chant of Frost",
      "Tuyen's Chant of Poison"
    ],
    'the whole family, under the names the log prints'
  )

  const bare = buildSpellDb(applySpellCorrections(RAW, HAND_DERIVED).spells)
  assert.deepEqual(
    matchCastOnOtherSuffix('an ice giant begins to chant.', bare)?.entry.cands.map((c) => c.name).sort(),
    ["Tuyen's Chant of Flame", "Tuyen's Chant of Frost"],
    'before the sweep the sentence had exactly the two owners whose subject the scrape got right'
  )
})

// ---------------------------------------------------------------------------------------------
// 3 — THE REFUSALS: two sentences with real evidence that are deliberately left alone
// ---------------------------------------------------------------------------------------------

test('the two cascade-claimed sentences are refused, and the cascade still claims them', () => {
  // `classifyDbBuff` sits ABOVE `classifySpellEmote`, so correcting these would not add a match, it
  // would take one — silently reclassifying lines that parse today. That is a different change
  // with a different burden of proof. The list is data so this can assert on it rather than on a
  // comment; the subject below is a synthetic one-word name so no bystander's enters the tree, and
  // one word is what the emote matcher wants — the same sentence with an ARTICLED mob name in
  // front of it is `unknown` either way, which is why the reclassification would be silent.
  installSpellDb(loadSpellDb())
  assert.equal(SUBJECT_DRIFT_REFUSED.length, 2)
  for (const r of SUBJECT_DRIFT_REFUSED) {
    assert.ok(
      !SPELL_CORRECTIONS.some((c) => c.field === 'msgCastOnOther' && c.spells.includes(r.spell)),
      `${r.spell} is refused, so nothing may correct its cast-on-other message`
    )
    const ev = parseEvent(`[Sat Aug 09 12:00:00 2026] Someguy ${r.suffix}`, 0)
    assert.equal(ev?.kind, r.claimedBy, `\`${r.suffix}\` must still parse the way it parsed before`)
  }
})

// ---------------------------------------------------------------------------------------------
// 4 — THE ACCEPTANCE: the reported defect, through the real parser and the real unified model
// ---------------------------------------------------------------------------------------------

/** An EQ-stamped line at `sec` seconds past 20:48:00 — the real `[Day Mon DD HH:MM:SS YYYY] ` shape. */
function at(sec: number, text: string): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `[Thu Jul 30 20:${two(48 + Math.floor(sec / 60))}:${two(sec % 60)} 2026] ${text}`
}

/**
 * The `tests/spellCorrections.test.mts` harness: both modules, wired the way wiring.ts wires them.
 * `withDb` replays against a DB other than the committed one — which is how the "…and without the
 * correction" halves below state the defect through the same machinery rather than by inspection.
 */
function replay(lines: [number, string][], observeSec: number, withDb?: ReturnType<typeof loadSpellDb>) {
  const db = withDb ?? loadSpellDb()
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
  return { rows: buildTimerRows(b, timers.snapshot().state), active: b.active }
}

test('THE REPORTED DEFECT: an Odium VI cast plus the live landing opens a DEBUFF bar', () => {
  const r = replay(
    [
      // Quoted verbatim from report 01KZMS8NG4FBYCP1P51VK8WP1B — the one line the owner's log has
      // no shaman to print. The reporter's own mob names stay in his log; the target below is the
      // owner's.
      [0, 'You begin casting Odium VI.'],
      [1, 'a rock golem staggers under a dark curse.']
    ],
    10
  )
  const row = r.rows.find((x) => x.target === 'a rock golem')
  assert.ok(row, `no Odium row: ${r.rows.map((x) => `${x.name}@${x.target ?? 'self'}`).join(', ') || '(none)'}`)
  assert.equal(row.name, 'Odium VI', 'the ranked cast line names the row — the rank was never the defect')
  assert.equal(row.kind, 'debuff')
  assert.equal(row.mode, 'countdown', 'a bar with a duration, which is the whole report')
  assert.equal(row.durationMs, 30_000, 'the committed DB states 30 seconds for the line')
  assert.ok(rowsForSurface(r.rows, 'debuffs').includes(row), 'and it belongs to the DEBUFFS window')
  // The instance under the row: before the correction the landing parsed to nothing at all, so
  // there was no held instance and no projection could have invented one.
  assert.ok(
    r.active.some((a) => a.spell === 'Odium VI' && a.target === 'a rock golem'),
    `no held instance: ${r.active.map((a) => `${a.spell}@${a.target ?? 'self'}`).join(', ') || '(none)'}`
  )
})

test('…and WITHOUT the sweep the same live sentence matches nothing at all, which is the defect', () => {
  // The defect stated the way the Allure and Bravura pairs state it in `spellCorrections.test.mts`:
  // the correction is the only thing standing between this test and the one above. The wiki's own
  // `Target staggers under a dark curse.` yields no suffix, so the shaman's landing was not in the
  // table under ANY key and no anchor, projection or overlay could have recovered it.
  const bare = buildSpellDb(applySpellCorrections(RAW, HAND_DERIVED).spells)
  assert.equal(
    matchCastOnOtherSuffix('a rock golem staggers under a dark curse.', bare),
    null,
    'the live sentence must resolve to nothing before the correction'
  )
  assert.equal(
    castOnOtherSuffix(bare.byKey.get('odium')?.msgCastOnOther ?? ''),
    null,
    'because the scrape wrote a subject placeholder the suffix table cannot key'
  )
})

test('the landing resolves to Odium alone, through the load seam the parser really reads', () => {
  const db = loadSpellDb()
  const hit = matchCastOnOtherSuffix('a rock golem staggers under a dark curse.', db)
  assert.ok(hit, 'the live sentence must resolve at all')
  assert.equal(hit.target, 'a rock golem')
  assert.deepEqual(hit.entry.cands.map((c) => c.name), ['Odium'], 'no other spell writes this sentence')
  assert.equal(db.castOnOtherSuffix.get('staggers under a dark curse.')?.length, 1)
})

/**
 * THE BARD'S CHAIN, in the rhythm the game prints it: a song every two or three seconds, each one
 * answered two seconds later by the landing sentence all four chants share — except the frost,
 * which is RESISTED and therefore answered by nothing. Four casts, three landings, and that
 * asymmetry is the whole report.
 *
 * Every shape here is the owner's own: `You begin singing <Song> <rank>.`, `<mob> begins to chant.`
 * (6 lines whole-log) and `<Mob> resisted your <Song>!` (the ordinary resist line), with the
 * reporter's mob replaced by one of the owner's.
 */
const CHAIN: [number, string][] = [
  [0, "You begin singing Tuyen's Chant of Frost V."],
  [2, "A fire giant warrior resisted your Tuyen's Chant of Frost V!"],
  [2, "You begin singing Tuyen's Chant of Disease VI."],
  [4, 'a fire giant warrior begins to chant.'],
  [4, "You begin singing Tuyen's Chant of Flame V."],
  [6, 'a fire giant warrior begins to chant.'],
  [7, "You begin singing Tuyen's Chant of Poison V."],
  [9, 'a fire giant warrior begins to chant.']
]

test('JOS-189: each chant of the chain gets its OWN row, and the resisted one gets none', () => {
  // THE REPORT (01KZN3FSW4BQ519N3TV8CQ1TC1, v0.17.0): frost shown active when it was not on the
  // mob, poison and disease missing, flame alone correct. With only two candidates for the shared
  // sentence, the DISEASE landing resolved to the most recently cast of THEM — the frost that had
  // just been resisted — and the poison and disease had no row of their own to draw.
  const r = replay(CHAIN, 10)
  const names = r.rows.map((x) => x.name).sort()
  assert.deepEqual(
    names,
    ["Tuyen's Chant of Disease VI", "Tuyen's Chant of Flame V", "Tuyen's Chant of Poison V"],
    'the three that landed, each under its own name — and no frost row at all'
  )
  for (const row of r.rows) {
    assert.equal(row.kind, 'debuff')
    assert.equal(row.target, 'a fire giant warrior')
    assert.equal(row.mode, 'countdown')
  }
  assert.equal(r.rows.find((x) => x.name.includes('Disease'))?.durationMs, 12_000, 'the DB states 2 ticks')
  assert.equal(r.rows.find((x) => x.name.includes('Flame'))?.durationMs, 18_000, '…and 3 for the flame')
})

test('…and with the wiki`s own two rows the same chain shows frost and loses two chants', () => {
  // The defect stated, the way the Odium pair above states it. The correction is the only thing
  // standing between this test and the one above: with Disease and Poison absent from the table,
  // every landing in the chain resolves to the most recently cast of Flame and Frost.
  const bare = buildSpellDb(applySpellCorrections(RAW, HAND_DERIVED).spells)
  try {
    const r = replay(CHAIN, 10, bare)
    assert.deepEqual(
      r.rows.map((x) => x.name).sort(),
      ["Tuyen's Chant of Flame V", "Tuyen's Chant of Frost V"],
      'a frost bar for a frost that was resisted, and nothing for the poison or the disease'
    )
  } finally {
    installSpellDb(loadSpellDb())
  }
})

test('JOS-103`s type-less line has a typed event now: Spirit of the Puma', () => {
  // AGENTS.md records `<X> growls with the spirit of the puma.` as the family with "NO typed event
  // at all", which is why the shipped suggestion for it is a `raw` capture trigger. The subject was
  // the whole reason. The raw alert is unaffected — a `raw` condition tests `ev.raw` whatever the
  // kind turns out to be — so this is additive for the wizard and for the timers both.
  installSpellDb(loadSpellDb())
  const ev = parseEvent('[Sat Aug 01 18:38:10 2026] a young puma growls with the spirit of the puma.', 0)
  assert.equal(ev?.kind, 'buffApply')
  assert.equal(ev.kind === 'buffApply' ? ev.spell : '', 'Spirit of the Puma')
})
