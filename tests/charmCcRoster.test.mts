// JOS-84 — CHARM AND CROWD CONTROL ARE ROSTERS, AND THE ROSTER ORACLE IS THE SPELL DB.
//
// THE REPORT: "Hey, for bard the charm break doesnt work? :D".
//
// THE ROOT CAUSE, measured. `Your <spell> spell has worn off of <mob>.` is ONE sentence for three
// different facts, and src/main/log/rulesets.ts decides which by matching the spell NAME:
// `charmSpell` ⇒ `uncharm` (a charmed pet is loose), `ccSpell` ⇒ `cc {refresh:true}` (a mez/root
// broke), neither ⇒ an ordinary `buffFade`. `ccSpell` carried exactly ONE bard song — Largo's
// Melodic Binding, which a bard gets at level 20 — and nothing a bard casts after it. So every
// bard past the mid-twenties held a crowd-control break the parser filed as a plain buff fade:
// no `cc` event, no `uncharm` event, and therefore no alert of any kind, seeded or grouped.
//
// THE ORACLE BELOW is what keeps that from happening again, and it is the same argument
// shared/alertGroups.ts makes for SLOW_SPELLS ("a slow is the spell you REPLACE as you level, so
// a def pinned to one name goes silently dead at the next tier"): the committed spells.json
// groups spells by LANDING MESSAGE, one message per family, so "every castable spell that shares
// a landing message with a member the roster already classifies" is DB knowledge rather than a
// guess — and it is re-derived here on every run. A future scrape that adds a member fails this
// suite instead of going quietly mute in somebody's ears.
//
// AND THE ORACLE HAS ONE EXCEPTION, BECAUSE IT PRODUCED ONE WRONG ANSWER (JOS-200).
//
// JOS-84 concluded from the landing-message family that `Solon's Bewitching Bravura` is a mez, and
// it is not: it is the bard's level-39 CHARM. The oracle is still right about what it can see —
// the four songs really do share `Someone 's eyes glaze over.` — but spells.json HAS NO EFFECT
// COLUMN (`spellType` is only Beneficial/Detrimental), so a shared sentence is evidence of a
// shared sentence and nothing more. A message family is not an effect family. That is the whole
// bug, and `FAMILY_EXCEPTIONS` below is where the oracle now admits it, with the evidence
// attached, rather than being quietly widened until it stops complaining.
//
// THE EVIDENCE, from the very slice JOS-84 cited (feedback report 01KZAG2QAW885YJNRTDDND8BF2,
// read-only, NEVER committed — AGENTS.md's reporter-slice rule) and from the half of it JOS-84
// did not read: fire giants sing the song AT that reporter three times, and every episode runs
// `<mob> begins singing Solon's Bewitching Bravura.` → 3 s later `You lose control of yourself!`
// → 21-32 s later `You are no longer captivated.` together with `You have control of yourself
// again.` in the same second. 3 s is the song's own `castTimeMs`, the captivate line is its own
// `msgWearsOff`, and lose/regain-control is EverQuest's charm-on-a-player pair — the same slice
// separately carries nine `You are stunned!` / `You are no longer stunned.` episodes, so the
// client prints different words for the two effects and this is not the mez one. The reporter's
// own casts hold a mob 51-117 s before the break line against a listed duration of 18 s, and three
// reporters on three versions (0.14.0, 0.16.0, 0.18.0) each called it the bard charm unprompted.
//
// The one sentence the owner's log lacks is INJECTED as a line here, quoted verbatim from the
// slice with the mob's name swapped for one the owner's own log prints, exactly as the
// petClaimWindows / mobLifetapPlayer precedents do.
//
// AND THE ORACLE PRODUCED A SECOND WRONG ANSWER, IN THE OTHER DIRECTION (JOS-225). A bard reported
// the "Mez / root broke" alert firing every time `Largo's Melodic Binding` lapsed. That song was
// not something the family walk added — it was in `ccSpell` from the original hand-audited stem
// list, labelled "bard/enchanter mez", and JOS-84 completed the pair (Assonant Binding 51) on the
// strength of the shared landing sentence without ever re-checking what the songs DO. They hold
// nothing. `NOT_A_HOLD` below carries the evidence and R1c/R1d are its assertions; the point of
// writing it as a table rather than a quiet regex edit is that the oracle would otherwise sweep
// both songs straight back in on the next scrape.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { getParserConfig, installSpellDb } from '../src/main/log/rulesets'
import { loadSpellDb } from '../src/main/data/spellDb'
import { AlertsModule } from '../src/main/modules/alerts'
import { ALERT_GROUPS, alertGroupDefs } from '../src/shared/alertGroups'
import type { AlertDef } from '../src/shared/types'

const db = loadSpellDb()
installSpellDb(db)
const cfg = getParserConfig()

/** Every def the curated groups author (the surface a user clicks "create" on). */
const GROUP_DEFS: AlertDef[] = ALERT_GROUPS.filter((g) => g.verified).flatMap((g) =>
  alertGroupDefs(g)
)

/** Feed raw log lines through the real parser into a module holding `defs`; return fired ids. */
function fire(defs: AlertDef[], lines: string[]): string[] {
  const mod = new AlertsModule()
  mod.setDefs(defs)
  mod.reset()
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  return (mod.flushDelta()?.delta.fired ?? []).map((f) => f.alertId)
}

/** A `Your <spell> spell has worn off of <mob>.` line, stamped like the real log. */
function wornOff(spell: string, mob = 'a fire giant warrior'): string {
  return `[Wed Aug 05 22:28:56 2026] Your ${spell} spell has worn off of ${mob}.`
}

/**
 * The DB's own family index: landing message → the CASTABLE spells that print it.
 *
 * "Castable" excludes the NPC-only entries (`This spell is cast by NPCs only.`) and the
 * class-less ones: `Your <X> spell has worn off of <mob>.` names a spell YOU cast, so a spell no
 * player can cast can never appear in one — the same exclusion SLOW_SPELLS makes for Rejuvenation
 * and Energy Sap.
 */
function castableSharing(message: string): string[] {
  const out = new Set<string>()
  for (const s of db.spells) {
    if (s.msgCastOnOther !== message) continue
    const classes = s.classes ?? ''
    if (!classes.includes('*')) continue
    out.add(s.name)
  }
  return [...out].sort()
}

// ── R1: the two rosters must classify every member of every family they already claim ────────
//
// THE MEZ / ROOT FAMILIES the parser routes to `cc`. Each key is a landing message spells.json
// records verbatim; the comment names the ladder it is.
const CC_FAMILIES: Record<string, string> = {
  // The bard mez ladder — TWO messages now, six songs, and before JOS-84 `ccSpell` held one of
  // them. It was three messages until JOS-161: `Sionachie's Dreams` used to sit alone under
  // `Target's eyes glaze over.`, which is the SAME sentence with the wrong subject placeholder,
  // and the corrections overlay folds it into the family the other three already shared. That is
  // exactly what the R1 assertion below is for — the family is read off the LOADED db, so a
  // correction that moved a song shows up here as the family it moved into.
  // …and since JOS-200 it is THREE songs, not four: `Solon's Bewitching Bravura` prints the same
  // sentence and is a charm (FAMILY_EXCEPTIONS, below).
  "Someone 's eyes glaze over.":
    "bard mez (Song of the Sirens 27, Pixie Strike 28, Sionachie's Dreams 40)",
  "Someone 's head nods.": "bard mez (Kelin's Lucid Lullaby 15)"
  // The two `… bound in/by strands of solid music.` families used to sit here, claimed as "bard
  // root" (Largo's Melodic Binding 20 and its direct upgrade, Assonant Binding 51). JOS-225
  // WITHDREW that claim — they are movement debuffs and hold nothing. See NOT_A_HOLD below.
}

/**
 * NOT A HOLD (JOS-225) — the songs that must stay OUT of both rosters, and why.
 *
 * THE REPORT: a bard hears the "Mez / root broke" alert every time `Largo's Melodic Binding`
 * lapses. Replaying the reporter's slice (01KZSH65ZX4Z74AK1CSZWQ42VK, read-only, never committed)
 * through the real parser and the real alerts module fires `group:cc:broke` four times, and all
 * four are Largo's — there is not one genuine mez in it.
 *
 * THIS IS THE OTHER DIRECTION OF THE JOS-200 MISTAKE. There, the message oracle swept a charm into
 * the mez roster. Here, the ORIGINAL hand-audited stem list called Largo's "bard/enchanter mez" in
 * 2026-07, JOS-84's family walk completed the pair without re-checking the effect, and this table
 * is where the effect finally got checked. A message family is not an effect family in either
 * direction.
 *
 * THE EVIDENCE IS MECHANICAL (the full argument, with counts, is in src/main/log/rulesets.ts):
 * the song's target trades melee blows in the same second its wear-off prints; `<mob> has been
 * awakened by <name>.` lands with 0 of 81 Largo's wear-offs over the owner's whole log against
 * 67.7% of Mesmerization's 1,848, 78.9% of Enthrall's 95, 85.9% of Dazzle's 85 and 84.1% of
 * Entrance's 69; and the committed DB gives it a `buffApply` landing sentence, so no CC
 * APPLICATION event for it exists in the corpus at all. Both songs go together for the reason
 * JOS-84 added the second: a fix that stops at level 20 hands the bug back at level 51.
 *
 * FALLING OUT OF BOTH ROSTERS IS THE POINT HERE, and it is the one outcome R1b forbids — for a
 * HOLD. R1c below is the counterpart assertion: a movement debuff filed as `buffFade` is a debuff
 * filed correctly, and it must be SILENT. Adding a row here is not a way to quiet a noisy alert;
 * it is a claim that the game shows the spell doing something other than holding, and it needs
 * evidence of that shape.
 */
const NOT_A_HOLD: Record<string, string> = {
  "Largo's Melodic Binding": "bard 20, PB AE, 3 ticks — the reporter's own false positive",
  "Largo's Assonant Binding": 'bard 51 — the direct upgrade, one word apart'
}

/** The charm families the parser routes to `uncharm`. */
const CHARM_FAMILIES: Record<string, string> = {
  'Someone has been charmed.': 'the Enchanter charm ladder (Charm 11 → Dictate 60)',
  // Five Necromancer charm-undead spells share this one; the stems covered the first three by
  // accident (dominate / beguile / cajol) and a necro who reached 54 lost their charm break.
  'Someone moans.': 'the Necromancer charm-undead ladder (Dominate Undead 18 → Enslave Death 60)'
}

/**
 * THE ONE SPELL THE MESSAGE ORACLE GETS WRONG (JOS-200), and the shape of the admission.
 *
 * Keyed by spell name → the roster it ACTUALLY belongs to, so the exception is a claim about one
 * named song rather than a hole punched in a family. R1 skips these when walking a CC family and
 * R1b then asserts each one is classified the way this table says — so an exception cannot rot
 * into "unclassified": it still has to be in a roster, just the other one.
 *
 * Adding a row here is not a way to make a red test green. It is a statement that the DB's message
 * grouping and the GAME disagree about a specific spell, and it needs the same kind of evidence the
 * header carries for this one: log lines showing the effect, not an intuition about the name.
 */
const FAMILY_EXCEPTIONS: Record<string, 'charm'> = {
  // Bard 39. Charms — `You lose control of yourself!` 3 s after the sung line, three for three in
  // slice 01KZAG2QAW885YJNRTDDND8BF2; see the header. Shares the mez ladder's landing sentence and
  // nothing else.
  "Solon's Bewitching Bravura": 'charm'
}

test('JOS-84 R1: ccSpell classifies every castable member of every mez/root family it claims', () => {
  for (const [message, ladder] of Object.entries(CC_FAMILIES)) {
    const members = castableSharing(message)
    assert.ok(members.length > 0, `spells.json must still carry ${ladder}`)
    for (const name of members) {
      if (name in FAMILY_EXCEPTIONS) continue
      assert.ok(
        cfg.ccSpell.test(name),
        `ccSpell misses "${name}" — ${ladder}. A ${name} break would parse as a plain buffFade ` +
          'and fire no alert at all.'
      )
      // …and it must not ALSO look like a charm: charm is tested first, so a false hit there
      // would retire a pet the player never had.
      assert.ok(!cfg.charmSpell.test(name), `"${name}" is a hold, not a charm`)
    }
  }
})

test('JOS-200 R1b: every family exception is still classified — into the OTHER roster', () => {
  // The exception buys a skip from R1, never a pass out of the rosters altogether. A spell that
  // fell out of both would parse its break to `buffFade` and fire nothing at all, which is the
  // original JOS-84 defect wearing a different hat.
  for (const [name, roster] of Object.entries(FAMILY_EXCEPTIONS)) {
    assert.ok(
      db.byKey.has(name.toLowerCase()),
      `spells.json (as corrected) must still carry "${name}" — an exception naming a spell that ` +
        'no longer exists is a stale claim, not a passing test'
    )
    assert.equal(roster, 'charm', 'only the charm direction is described here')
    assert.ok(cfg.charmSpell.test(name), `charmSpell must claim "${name}"`)
    assert.ok(!cfg.ccSpell.test(name), `ccSpell must NOT also claim "${name}" — one roster each`)
  }
})

test('JOS-225 R1c: a NOT_A_HOLD song is in NEITHER roster, parses to buffFade, and is SILENT', () => {
  for (const [name, why] of Object.entries(NOT_A_HOLD)) {
    assert.ok(
      db.byKey.has(name.toLowerCase()),
      `spells.json must still carry "${name}" (${why}) — a table naming a spell that no longer ` +
        'exists is a stale claim, not a passing test'
    )
    assert.ok(!cfg.ccSpell.test(name), `ccSpell must NOT claim "${name}" — ${why}`)
    assert.ok(!cfg.charmSpell.test(name), `charmSpell must NOT claim "${name}" — ${why}`)

    // …and end to end. The synthesized sentence has the same grammatical shape as the reporter's
    // (`Your <song> spell has worn off of <mob>.`) with a mob the owner's own log prints.
    const line = wornOff(name, 'a froglok ton knight')
    const ev = parseEvent(line, 0)
    assert.equal(
      ev?.kind,
      'buffFade',
      `"${name}" must file as an ordinary named-target debuff fade, not a hold ending`
    )
    assert.deepEqual(
      fire(GROUP_DEFS, [line]),
      [],
      `"${name}" wearing off must fire NOTHING — this is the JOS-225 report, and the alert it ` +
        'used to fire was "Mez / root broke"'
    )
  }
})

test('JOS-225 R1d: silencing Largo did not silence the mez beside it', () => {
  // The acceptance the ticket names: the false positive goes, the true positives stay, in ONE
  // stream. Timestamps are spaced so the group's 3 s cooldown collapses nothing — a `[]` here
  // would be the cooldown lying, not the roster.
  const lines = [
    `[Wed Aug 05 22:30:00 2026] Your Largo's Melodic Binding spell has worn off of a wanderer.`,
    '[Wed Aug 05 22:31:00 2026] Your Mesmerization spell has worn off of a wanderer.',
    `[Wed Aug 05 22:32:00 2026] Your Largo's Assonant Binding spell has worn off of a wanderer.`,
    `[Wed Aug 05 22:33:00 2026] Your Solon's Song of the Sirens spell has worn off of a wanderer.`,
    '[Wed Aug 05 22:34:00 2026] Your Allure spell has worn off of a wanderer.'
  ]
  assert.deepEqual(fire(GROUP_DEFS, lines), ['group:cc:broke', 'group:cc:broke', 'charm-break'])
})

test('JOS-84 R2: charmSpell classifies every castable member of every charm family it claims', () => {
  for (const [message, ladder] of Object.entries(CHARM_FAMILIES)) {
    const members = castableSharing(message)
    assert.ok(members.length > 0, `spells.json must still carry ${ladder}`)
    for (const name of members) {
      assert.ok(cfg.charmSpell.test(name), `charmSpell misses "${name}" — ${ladder}`)
    }
  }
})

// ── R3: the reporter's own sentence, end to end ──────────────────────────────────────────────

test("JOS-200 R3: the bard's Bravura break parses as an uncharm and fires the charm-break alert", () => {
  // The injected sentence — verbatim from slice 01KZAG2QAW885YJNRTDDND8BF2 with the mob swapped
  // for one the owner's log prints (the slice's was `a fire giant warrior`).
  //
  // THIS ASSERTION USED TO SAY THE OPPOSITE, and the reversal is the ticket. JOS-84 pinned
  // `group:cc:broke` here and explicitly pinned the ABSENCE of `charm-break`, on the strength of
  // the landing-message family; three reporters (01KZM7F36JD12WYF15DHCCWNEE 0.14.0,
  // 01KZMPYP1QA3N02FE42T473TZM 0.16.0, 01KZPJZSTYPSKGR3GRP3FVW8RQ 0.18.0) each said charm and each
  // was right. The header carries the log evidence. What they asked for is the line below.
  const line = wornOff("Solon's Bewitching Bravura", 'a froglok ton knight')
  const ev = parseEvent(line, 0)
  assert.equal(ev?.kind, 'uncharm', 'a bard charm break is an uncharm, not a cc refresh')
  if (ev?.kind !== 'uncharm') return
  assert.equal(ev.mob, 'a froglok ton knight')
  assert.equal(ev.spell, "Solon's Bewitching Bravura")

  assert.deepEqual(fire(GROUP_DEFS, [line]), ['charm-break'])
})

test('JOS-84 R4: the whole bard crowd-control ladder fires the mez/root group', () => {
  // Every song at its own timestamp so the group's 3 s cooldown does not collapse them.
  // Bravura is NOT in this list since JOS-200 — it is a charm, and R3 above is its assertion.
  // Neither Largo's is in it since JOS-225 — they are movement debuffs, and R1c/R1d are theirs.
  const songs = [
    "Kelin's Lucid Lullaby",
    "Solon's Song of the Sirens",
    "Crission's Pixie Strike",
    "Sionachie's Dreams"
  ]
  const lines = songs.map(
    (s, i) => `[Wed Aug 05 22:${String(30 + i).padStart(2, '0')}:00 2026] Your ${s} spell has worn off of a froglok ton knight.`
  )
  assert.deepEqual(
    fire(GROUP_DEFS, lines),
    songs.map(() => 'group:cc:broke'),
    'every bard hold must announce its own break'
  )
})

test("JOS-84 R5: the Necromancer charm-undead ladder's top two now fire charm break", () => {
  const lines = [
    '[Wed Aug 05 22:30:00 2026] Your Thrall of Bones spell has worn off of a decaying skeleton.',
    '[Wed Aug 05 22:31:00 2026] Your Enslave Death spell has worn off of a decaying skeleton.'
  ]
  assert.deepEqual(fire(GROUP_DEFS, lines), ['charm-break', 'charm-break'])
})

test('JOS-84 R6: the regression gate — the enchanter shapes are untouched', () => {
  // The three lines tests/alertGroups.test.mts already pins, re-asserted here because this change
  // edits the regexes those assertions run through. A charm is still a charm, a mez is still a
  // mez, and a slow is still neither.
  assert.equal(parseEvent(wornOff('Allure', 'an ice giant'), 0)?.kind, 'uncharm')
  assert.equal(parseEvent(wornOff('Mesmerization', 'a froglok ton knight'), 1)?.kind, 'cc')
  const slow = parseEvent(wornOff('Shiftless Deeds', 'King Tranix'), 2)
  assert.equal(slow?.kind, 'buffFade', 'a slow is an ordinary named-target fade — the slow group ' +
    'matches it by SPELL, so misfiling it as cc would silence that alert too')
  assert.deepEqual(fire(GROUP_DEFS, [wornOff('Shiftless Deeds', 'King Tranix')]), ['group:slow:mob'])
})

test('JOS-200 R7: the exception is one song, not its landing family', () => {
  // The guard the FAMILY_EXCEPTIONS table needs to be worth writing down: `Solon's Song of the
  // Sirens` prints the SAME landing sentence as Bravura and is still a mez, so a stem that reached
  // too far — matching `solon.s` rather than `solon.s (bewitching )?bravura`, say — would silently
  // convert the level-27 song's mez break into a charm break and announce a pet that never existed.
  assert.equal(parseEvent(wornOff("Solon's Song of the Sirens", 'a froglok ton knight'), 0)?.kind, 'cc')
  assert.equal(parseEvent(wornOff("Crission's Pixie Strike", 'a froglok ton knight'), 1)?.kind, 'cc')
  assert.equal(parseEvent(wornOff("Sionachie's Dreams", 'a froglok ton knight'), 2)?.kind, 'cc')
  assert.equal(parseEvent(wornOff("Solon's Bewitching Bravura", 'a froglok ton knight'), 3)?.kind, 'uncharm')

  // …and end to end through the real groups, at spaced timestamps so no cooldown collapses them:
  // one charm break, three mez breaks, from four sentences a message oracle cannot tell apart.
  const lines = [
    `[Wed Aug 05 22:30:00 2026] Your Solon's Bewitching Bravura spell has worn off of a froglok ton knight.`,
    `[Wed Aug 05 22:31:00 2026] Your Solon's Song of the Sirens spell has worn off of a froglok ton knight.`,
    `[Wed Aug 05 22:32:00 2026] Your Crission's Pixie Strike spell has worn off of a froglok ton knight.`,
    `[Wed Aug 05 22:33:00 2026] Your Sionachie's Dreams spell has worn off of a froglok ton knight.`
  ]
  assert.deepEqual(fire(GROUP_DEFS, lines), [
    'charm-break',
    'group:cc:broke',
    'group:cc:broke',
    'group:cc:broke'
  ])
})
