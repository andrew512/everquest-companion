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
// AND THE BARD'S SONG IS A MEZ, NOT A CHARM — stated because the report says charm and the
// distinction decides which alert fires. Evidence from the reporter's own slice (feedback report
// 01KZAG2QAW885YJNRTDDND8BF2, read-only, NEVER committed — AGENTS.md's reporter-slice rule):
// each of their five `You begin singing Solon's Bewitching Bravura IX.` lines is followed ~2 s
// later by `a fire giant warrior's eyes glaze over.`, which spells.json records as Bravura's own
// landing message; meanwhile EVERY `<mob> has been charmed.` line in that slice trails another
// player's `Aevus begins casting Allure X.` by one second. So the bard mezzes, an enchanter
// beside them charms, and `Your Solon's Bewitching Bravura spell has worn off of <mob>.` is a MEZ
// break. It now fires the "Mez / root broke" group — the honest alert — instead of nothing.
//
// The one sentence the owner's log lacks is INJECTED as a line here, quoted verbatim from the
// slice with the mob's name swapped for one the owner's own log prints, exactly as the
// petClaimWindows / mobLifetapPlayer precedents do.
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
  // The bard mez ladder — three messages, six songs, and before JOS-84 `ccSpell` held one of them.
  "Someone 's eyes glaze over.": 'bard mez (Song of the Sirens 27, Pixie Strike 28, Bravura 39)',
  "Target's eyes glaze over.": "bard mez (Sionachie's Dreams 40)",
  "Someone 's head nods.": "bard mez (Kelin's Lucid Lullaby 15)",
  // The bard root pair — Melodic Binding 20 and its DIRECT UPGRADE, Assonant Binding 51, one
  // word apart. The upgrade was the one missing, which is the level-up failure exactly.
  'Someone is bound in strands of solid music.': "bard root (Largo's Melodic Binding 20)",
  'Someone is bound by strands of solid music.': "bard root (Largo's Assonant Binding 51)"
}

/** The charm families the parser routes to `uncharm`. */
const CHARM_FAMILIES: Record<string, string> = {
  'Someone has been charmed.': 'the Enchanter charm ladder (Charm 11 → Dictate 60)',
  // Five Necromancer charm-undead spells share this one; the stems covered the first three by
  // accident (dominate / beguile / cajol) and a necro who reached 54 lost their charm break.
  'Someone moans.': 'the Necromancer charm-undead ladder (Dominate Undead 18 → Enslave Death 60)'
}

test('JOS-84 R1: ccSpell classifies every castable member of every mez/root family it claims', () => {
  for (const [message, ladder] of Object.entries(CC_FAMILIES)) {
    const members = castableSharing(message)
    assert.ok(members.length > 0, `spells.json must still carry ${ladder}`)
    for (const name of members) {
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

test("JOS-84 R3: the bard's Bravura break parses as a cc refresh and fires the group alert", () => {
  // The injected sentence — verbatim from slice 01KZAG2QAW885YJNRTDDND8BF2 with the mob swapped
  // for one the owner's log prints (the slice's was `a fire giant warrior`).
  const line = wornOff("Solon's Bewitching Bravura", 'a froglok ton knight')
  const ev = parseEvent(line, 0)
  assert.equal(ev?.kind, 'cc', 'a bard mez break is a cc refresh, not a buffFade')
  if (ev?.kind !== 'cc') return
  assert.equal(ev.refresh, true)
  assert.equal(ev.mob, 'a froglok ton knight')
  assert.equal(ev.spell, "Solon's Bewitching Bravura")

  assert.deepEqual(fire(GROUP_DEFS, [line]), ['group:cc:broke'])
})

test('JOS-84 R4: the whole bard crowd-control ladder fires the mez/root group', () => {
  // Every song at its own timestamp so the group's 3 s cooldown does not collapse them.
  const songs = [
    "Kelin's Lucid Lullaby",
    "Largo's Melodic Binding",
    "Solon's Song of the Sirens",
    "Crission's Pixie Strike",
    "Solon's Bewitching Bravura",
    "Sionachie's Dreams",
    "Largo's Assonant Binding"
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
