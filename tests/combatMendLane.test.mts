// MEND GETS ITS HEALING LANE (JOS-86) — the golden windows and the parser arms.
//
// User report, v0.10.0: a monk's Mend never appears in the healing logs. Same SHAPE as JOS-77
// (Cleave) and JOS-81 (Smite) — an ability whose lines are not routed into a lane of its own —
// but the opposite CAUSE. Cleave and Smite were always COUNTED and merely lacked a row; Mend was
// never parsed at all, because its line is the one heal family that carries no number:
//
//     [Fri Aug 07 07:26:59 2026] You mend your wounds and heal some damage.
//
// THE WHOLE-LOG PARTITION, measured 2026-08-07 over eqlog_Primitive_freeport.txt. 1,178 lines
// contain "mend" case-insensitively and they account for exactly:
//     876  `You mend your wounds and heal some damage.`   ← the ONLY mechanical heal shape
//     200  `You have become better at Mend! (N)`          ← the skill-up stream
//       1  `You have gained the ability to use Mend.`
//       2  a mob literally named `a Nisch Mas Mender`
//      99  third-party chat ABOUT the skill (all quoted, all dropped by the fixture scrub)
// So: FIRST PERSON ONLY — no `<X> mends …` exists anywhere — no failure shape, no "you are not
// wounded" refusal, and no amount in any of the 876. Nothing here invents an arm for a sentence
// the game has never printed (AGENTS.md awaiting-sample law); the refusal tests below pin that.
//
// THE OWNER'S OWN LOG PRINTS IT, so NOTHING IS INJECTED. The reporter's slice
// (.triage/slices/01KZE3WQDHX4S2QPQ16SMFRHF6.log, 7 Mend lines) is a user's private game log and
// never becomes a fixture — but it did not have to. The owner is a paladin/monk loadout and
// mended 876 times, so both windows below are his real committed bytes and the sentence under
// test is byte-identical to the reporter's.
//
// WHY THE LANE READS 0 AND WHY THAT IS THE POINT. Hit points really did go back on the bar; the
// game declines to say how many. Filing this as a `heal` with `amount: 0` would have been a lie
// with a long tail — the ledger would count a tick that "landed on a full health bar"
// (fullOverheal), the row's `min` would collapse to 0, and foldHealAnalytics would enter a
// 0-damage "Mend proc" into the proc model. So it is its own event kind (`healUnstated`) with NO
// amount field, and its own lane classification ('unstated') whose 0 means "no measurement
// exists", never "the measurement was zero". It enters no sum anywhere. The word tests for that
// distinction live in tests/healRows.test.mts (rule 6).
//
// LAW 8 GATE, run before and after over EVERY committed fixture: the healing view diffed
// line-for-line and every single difference was an ADDITION. Not one existing figure moved — no
// total, no count, no min/max, no overheal, no pct, no hps, no enemy row, and no damage total.
// A 0-total lane cannot move `rankLanes`' denominator (`Math.max(1, …totals)`), which is why the
// existing lanes' bar fills are identical too.
//
// ── THE HAND-READ WINDOWS ──────────────────────────────────────────────────────────────
//
// W55  w39-spellblade-switch.log (Fri Jul 31 16:06:54 → 16:12:36) — the Mend lane sitting
//      BESIDE valued lanes on the same row. Every heal line in the span, verbatim:
//        SELF row (healer = You, target Primitive):
//          Lifetap Strike    31·31·82·31·82·31·31·31·31·31·31·31 = 474 over 12 (max 82, min 31)
//          Superior Healing  855 · 842 · 835                     = 2532 over 3 (max 855, min 835)
//          Unspecified       138                                 = 138 over 1  (the log named no
//                                                                   spell on that line)
//          ⇒ restored 3144 over 16 VALUED lines, 0 crits, max 855, min 31, overheal 0
//          Mend (unstated)   16:09:43 · 16:11:21                 = COUNT 2, and nothing else
//        PET row `an abhorrent` (the owner's charmed pet, self-healing):
//          Lifetap Strike 29 × 6 = 174   [16:09:11 :24 :40 :58 :59, 16:10:22]
//        ENEMY counter-healing:
//          an ashenbone drake  314 Drain Spirit  [16:06:54]
//          Cleric of Innoruuk → Avatar of Abhorrence 182 Valor [16:08:46]   ⇒ 496
//        NOT COUNTED, and unchanged by this work: the two `You healed an abhorrent for 138 hit
//          points.` lines at 16:07:41 / 16:07:49. `an abhorrent` is not yet in petNames and is
//          not an ENGAGED instance of the open encounter, so they fall to addHostileHeal and are
//          dropped — the same pre-existing rule the W28 bystander window pins. Stated here because a
//          golden window that quietly omits two heal lines is how a real regression hides.
//        ⇒ view total 3144 + 174 = 3318, all restored, 0 absorbed, 0 overheal, enemy 496
//
// W56  w47-special-dragon-punch.log (the Mend at Wed Jul 29 14:56:45) — a Mend with NO valued
//      heal and NO rune anywhere in the span. The self row does not exist in the friendly ledger
//      at all, so it is SYNTHESIZED for the lane to hang on, exactly as the rune lane has always
//      been synthesized (the W28 case). This is the window the report was actually about: before
//      JOS-86 this fixture's healing meter was completely empty despite a Mend in it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { CombatEngine } from '../src/main/combat/engine'
import { SELF_ROW_ID } from '../src/main/combat/healing'
import type { HealSourceView, HealSpellView, SegmentView } from '../src/shared/combat'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const W55 = 'w39-spellblade-switch.log'
const W56 = 'w47-special-dragon-punch.log'

/** The lane name the parser mints for MEND_RE. */
const MEND = 'Mend'

/** Same skip convention as the other combat window tests — a machine without the fixture runs
 *  the rest of the suite rather than failing on an ENOENT. */
const have = (f: string): string | false =>
  existsSync(join(FIXTURES, f)) ? false : `fixture ${f} not present — run tests/extract-combat-fixtures.mjs`

function replay(fixture: string): SegmentView {
  const lines = readFileSync(join(FIXTURES, fixture), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  let lastTs = 0
  for (const raw of lines) {
    const ev = parseEvent(raw, seq++)
    if (ev) {
      eng.ingestEvent(ev, false)
      lastTs = ev.ts
    }
  }
  // The ZONE aggregate is the whole-window view (neither fixture carries a zone line, so every
  // encounter in the span folds into the one live session).
  const snap = eng.snapshot(lastTs + 90_000, { selectedId: 'zone' })
  assert.ok(snap.selected, 'zone segment must resolve')
  return snap.selected!
}

const you = (seg: SegmentView): HealSourceView => {
  const h = seg.healing.healers.find((x) => x.id === SELF_ROW_ID)
  assert.ok(h, `expected a self row (got ${seg.healing.healers.map((x) => x.id).join(', ')})`)
  return h!
}
const lane = (h: HealSourceView, name: string): HealSpellView => {
  const s = h.spells.find((x) => x.name === name)
  assert.ok(s, `expected lane "${name}" (got ${h.spells.map((x) => x.name).join(', ')})`)
  return s!
}

// ---------------------------------------------------------------------------
// Parser arms — the exact real sentence, and every neighbour it must not steal.
// ---------------------------------------------------------------------------

test('parser: the Mend sentence is a `healUnstated` event with NO amount field at all', () => {
  const ev = parseEvent('[Fri Aug 07 07:26:59 2026] You mend your wounds and heal some damage.', 1)
  assert.equal(ev?.kind, 'healUnstated')
  assert.equal(ev.skill, MEND)
  assert.equal(ev.target, 'You')
  // The absence is STRUCTURAL, not a zero: nothing downstream can read a number off this event,
  // which is the entire reason it is not a `heal`.
  assert.equal('amount' in ev, false, 'a healUnstated event must carry no amount')
  assert.equal('rawAmount' in ev, false)
})

test('parser: the owner window and the reporter slice carry the SAME bytes', () => {
  // Report 01KZE3WQDHX4S2QPQ16SMFRHF6, 07:26:59 — quoted verbatim, differing from the owner's
  // line above only in the timestamp. Nothing from that slice is committed; this is the proof
  // that the fixture windows below actually cover the reported defect.
  const reporter = parseEvent('[Fri Aug 07 07:38:27 2026] You mend your wounds and heal some damage.', 2)
  assert.equal(reporter?.kind, 'healUnstated')
  assert.equal(reporter.skill, MEND)
})

test('parser: MEND_RE is anchored WHOLE — it never sniffs for the word "mend"', () => {
  // A mob whose NAME contains the stem. This is a real line from the owner's log and it belongs
  // to the heal family; a loose /mend/ probe would have swallowed it.
  const mender = parseEvent(
    '[Sun Jul 19 22:14:07 2026] a Nisch Mas Mender healed itself for 154 hit points by Symbol of Ryltan.',
    1
  )
  assert.equal(mender?.kind, 'heal')
  assert.equal(mender.healer, 'a Nisch Mas Mender')
  assert.equal(mender.amount, 154)

  // Chat ABOUT the skill (99 such lines whole-log; the scrub drops them from fixtures, but the
  // live parser sees them and must not route one into the healing ledger).
  const chat = parseEvent("[Sun Jul 19 10:07:33 2026] Eilish tells General:2, 'mend is OP here'", 2)
  assert.notEqual(chat?.kind, 'healUnstated')

  // Trailing junk must not be tolerated either — the regex asserts the whole line.
  assert.notEqual(
    parseEvent('[Fri Aug 07 07:26:59 2026] You mend your wounds and heal some damage. (Critical)', 3)?.kind,
    'healUnstated'
  )
})

test('parser: the skill-up and the grant stay in their own families, not the healing ledger', () => {
  const up = parseEvent('[Tue Jul 28 16:11:22 2026] You have become better at Mend! (2)', 1)
  assert.equal(up?.kind, 'skillUp')
  assert.equal(up.skill, MEND)
  const grant = parseEvent('[Tue Jul 28 15:54:51 2026] You have gained the ability to use Mend.', 2)
  assert.notEqual(grant?.kind, 'healUnstated')
})

test('parser: NO third-person arm exists, because the log has never printed one', () => {
  // Hand-authored shapes, refused on purpose. If a real log ever prints one of these, THAT is
  // when an arm gets written — from the bytes, not from the grammar.
  for (const invented of [
    'Primitive mends his wounds and heals some damage.',
    'Primitive mends her wounds and heals some damage.',
    'You fail to mend your wounds.'
  ]) {
    const ev = parseEvent(`[Fri Aug 07 07:26:59 2026] ${invented}`, 1)
    assert.notEqual(ev?.kind, 'healUnstated', `invented a Mend arm for: ${invented}`)
  }
})

// ---------------------------------------------------------------------------
// W55 — the lane beside valued lanes.
// ---------------------------------------------------------------------------

test('W55: Mend gets a lane on the self row, beside the heals that DO carry numbers', { skip: have(W55) }, () => {
  const seg = replay(W55)
  const self = you(seg)

  // The valued half, hand-summed above — the regression tripwire for the whole change.
  assert.equal(self.total, 3144, 'restored healing moved')
  assert.equal(self.count, 16, 'an unvalued heal entered the VALUED heal count')
  assert.equal(self.max, 855)
  assert.equal(self.min, 31, 'the row min collapsed toward a Mend that has no amount')
  assert.equal(self.overheal, 0)
  assert.equal(self.crits, 0)
  assert.equal(self.absorbedTotal, 0)
  assert.equal(lane(self, 'Superior Healing').total, 2532)
  assert.equal(lane(self, 'Lifetap Strike').total, 474)
  assert.equal(lane(self, 'Unspecified').total, 138)

  // …and the lane the report was about.
  assert.equal(self.unstatedCount, 2, 'the row must state that two Mends happened')
  const mend = lane(self, MEND)
  assert.equal(mend.classification, 'unstated')
  assert.equal(mend.count, 2)
  assert.equal(mend.total, 0, 'an amount was invented for a line that carries none')
  assert.equal(mend.max, 0)
  assert.equal(mend.min, undefined, 'min must be ABSENT, not 0 — 0 would read as a real floor')
  assert.equal(mend.crits, 0)
  assert.equal(mend.overheal, 0)
  assert.equal(mend.fullOverheal, 0, 'a Mend is not a tick that landed on a full health bar')
  assert.equal(mend.pct, 0, 'a bar fill derived from an amount that does not exist')
})

test('W55: the Mend lane enters NO total — view, row, hps or overheal', { skip: have(W55) }, () => {
  const h = replay(W55).healing
  assert.equal(h.total, 3318, 'self 3144 + pet 174; a Mend must add nothing')
  assert.equal(h.restoredTotal, 3318)
  assert.equal(h.absorbedTotal, 0, 'an unvalued heal is not absorption')
  assert.equal(h.overheal, 0)
  assert.equal(h.enemyTotal, 496, 'counter-healing is untouched by this change')

  // The pet row is the control: it never mends, so it must carry no unstated count at all.
  const pet = h.healers.find((x) => x.id === 'heal:an abhorrent')
  assert.ok(pet, 'expected the charmed pet as its own healer row')
  assert.equal(pet!.total, 174)
  assert.equal(pet!.count, 6)
  assert.equal(pet!.unstatedCount, 0)
  assert.equal(pet!.spells.some((s) => s.classification === 'unstated'), false)

  // Σ of the row totals is the view total — an 'unstated' lane cannot break that identity.
  assert.equal(h.healers.reduce((s, r) => s + r.total, 0), h.total)
})

test('W55: a Mend moves no DAMAGE number (world-model law 8)', { skip: have(W55) }, () => {
  const seg = replay(W55)
  assert.equal(seg.outTotal, 48551)
  assert.equal(seg.inTotal, 7491)
})

// ---------------------------------------------------------------------------
// W56 — the window the report was actually about: a Mend and nothing else.
// ---------------------------------------------------------------------------

test('W56: a Mend with no heal beside it SYNTHESIZES the self row rather than vanishing', { skip: have(W56) }, () => {
  const seg = replay(W56)
  const h = seg.healing

  // Before JOS-86 this list was empty and the meter said the fight had no sustain in it.
  assert.equal(h.healers.length, 1, 'the self row must exist for the lane to hang on')
  const self = you(seg)
  assert.equal(self.name, 'You')
  assert.equal(self.kind, 'you')

  // The row's headline stats stay honestly EMPTY — a synthesized row claims nothing.
  assert.equal(self.count, 0, 'a synthesized row claimed a valued heal')
  assert.equal(self.total, 0)
  assert.equal(self.min, undefined)
  assert.equal(self.crits, 0)
  assert.equal(self.overheal, 0)
  assert.equal(self.absorbedTotal, 0)

  assert.equal(self.unstatedCount, 1)
  assert.equal(self.spells.length, 1)
  const mend = lane(self, MEND)
  assert.equal(mend.classification, 'unstated')
  assert.equal(mend.count, 1)
  assert.equal(mend.total, 0)
  assert.equal(mend.min, undefined)

  // Nothing else in the view acquired a number, and the fight's damage is where it always was.
  assert.equal(h.total, 0)
  assert.equal(h.restoredTotal, 0)
  assert.equal(h.absorbedTotal, 0)
  assert.equal(h.enemyTotal, 0)
  assert.deepEqual(h.mitigation, {
    runeTotal: 0,
    runeCount: 0,
    runeMax: 0,
    absorbedSwings: 0,
    absorbedDamageShields: 0
  })
  assert.equal(seg.outTotal, 8733)
  assert.equal(seg.inTotal, 1943)
})
