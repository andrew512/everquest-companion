// JOS-84 — A SUGGESTED ALERT MUST FIRE ON THE LINE ITS SPELL PRINTS.
//
// THE REPORT. A v0.10.0 enchanter created the slow-landed alert FROM SUGGESTED and it never
// fired. They hand-edited the pattern (their slow is Shiftless Deeds) and it still never fired.
// They created the Incapacitate one and it never fired either.
//
// THE ROOT CAUSE, measured against their own log lines (feedback report
// 01KZEGGWTKYN7C8FMNPQ4Y181P — a reporter's slice, so it is quoted here and never committed):
// EQ prints ONE landing sentence for a whole spell family, and the parser says so. Their real
// lines resolve like this through src/main/log/parseCasts.ts + the committed spells.json:
//
//   `Coercer T`vala slows down.`   → buffApply { spell:'Forlorn Deeds',
//                                     candidates:[Forlorn Deeds, Languid Pace, Rejuvenation,
//                                                 Shiftless Deeds, Tepid Deeds] }
//   `Coercer T`vala looks frail.`  → buffApply { spell:'Disempower',
//                                     candidates:[Disempower, Incapacitate, Listless Power] }
//
// `buffApply.spell` is documented as a BEST-EFFORT first candidate (shared/logEvents.ts), and it
// is alphabetical — it is not, and cannot be, the spell the user cast. The `lands` suggestion
// template authored `where:{spell:'Shiftless Deeds'}`, which the alerts module compared to the
// literal string "Forlorn Deeds". It was never an anchor problem and never a self-cast /
// third-person problem: the trigger was pinned to a coin flip, and lost it every time.
//
// THE FIX under test: a `where.spell` matcher tests the event's WHOLE candidate list
// (main/modules/alerts.ts `spellCandidateNames`), and the fire reports the name that actually
// satisfied the matcher rather than the arbitrary pick (`matchedSpellName`) — so a spoken alert
// says "Shiftless Deeds", not "Forlorn Deeds".
//
// THE DEFS ARE NOT HAND-WRITTEN HERE. Every trigger below comes out of the REAL wizard path —
// buildSpellCatalog(loadSpellDb()) → suggestionsFor(entry, rank) — and goes into the REAL
// AlertsModule through the REAL parser. That path had never been executed by a test, because
// suggestions.ts imported a VALUE through the `@shared/*` alias and could not load under tsx at
// all; that is a large part of why this shipped. The alias import is now relative (repo law).
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { installSpellDb } from '../src/main/log/rulesets'
import { buildSpellCatalog, loadSpellDb } from '../src/main/data/spellDb'
import { AlertsModule } from '../src/main/modules/alerts'
import { illusionSuggestion, suggestionsFor } from '../src/renderer/src/features/alerts/suggestions'
import type { SpellRank } from '../src/shared/spellLines'
import type { AlertDef, FiredAlert, SpellCatalogEntry } from '../src/shared/types'

// The whole defect lives in the DB-driven message families, so the DB is installed exactly as
// main installs it. Node runs each test FILE in its own process, so this cannot reach a sibling.
const db = loadSpellDb()
installSpellDb(db)
const catalog = buildSpellCatalog(db, new Map())

/**
 * THE REPORTER'S OWN LINES, verbatim from slice 01KZEGGWTKYN7C8FMNPQ4Y181P (mob names left as
 * their log spelled them — they are mobs, not people). Quoted in the test rather than extracted
 * into tests/fixtures/, per AGENTS.md: a reporter's slice never becomes a committed fixture, and
 * these are single client notices with no surrounding state to warm.
 */
const SLICE = {
  slowLandedTvala: '[Fri Aug 07 09:07:24 2026] Coercer T`vala slows down.',
  slowLandedChosen: '[Fri Aug 07 09:17:14 2026] Innoruuk`s Chosen slows down.',
  incapCast: '[Fri Aug 07 09:07:49 2026] You begin casting Incapacitate V.',
  incapLanded: '[Fri Aug 07 09:07:51 2026] Coercer T`vala looks frail.',
  incapCastLater: '[Fri Aug 07 09:17:19 2026] You begin casting Incapacitate V.',
  incapLandedLater: '[Fri Aug 07 09:17:21 2026] Innoruuk`s Chosen looks frail.'
}

function entryFor(key: string): SpellCatalogEntry {
  const e = catalog.entries.find((x) => x.key === key)
  assert.ok(e, `spells.json must carry a catalog entry for "${key}"`)
  return e
}

/** The rank the wizard pins the two rank-templates to, shaped as the alerts snapshot supplies it. */
function rank(name: string): SpellRank {
  return { name, rank: 5, lastCastMs: Date.parse('2026-08-07T09:07:49Z') } as SpellRank
}

/** Feed raw log lines through the real parser into a module holding `defs`; return the fires. */
function fire(defs: AlertDef[], lines: string[]): FiredAlert[] {
  const mod = new AlertsModule()
  mod.setDefs(defs)
  mod.reset()
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  return mod.flushDelta()?.delta.fired ?? []
}

/** Every def the wizard would author for this spell, rank chips included. */
function suggestedDefs(key: string, rankName: string): AlertDef[] {
  return suggestionsFor(entryFor(key), rank(rankName)).map((s) => s.def)
}

test('JOS-84 A1: the from-suggested SLOW-LANDED alert fires on the reporter\'s own line', () => {
  const defs = suggestedDefs('shiftless deeds', 'Shiftless Deeds V')
  const lands = defs.find((d) => d.id === 'suggest:shiftless deeds:lands')
  assert.ok(lands, 'the wizard must still offer a "lands" suggestion for Shiftless Deeds')
  // The trigger is UNCHANGED by this fix — pinned to the user's own spell, as authored.
  assert.deepEqual(lands.trigger, {
    type: 'event',
    kind: 'buffApply',
    where: { spell: 'Shiftless Deeds' }
  })

  const fired = fire([lands], [SLICE.slowLandedTvala, SLICE.slowLandedChosen])
  assert.equal(fired.length, 2, 'both slow landings must fire')
  assert.deepEqual(
    fired.map((f) => f.matchedText),
    [SLICE.slowLandedTvala, SLICE.slowLandedChosen]
  )
  // …and it must SAY the user's spell, not the alphabetically-first candidate.
  assert.deepEqual(fired.map((f) => f.spell), ['Shiftless Deeds', 'Shiftless Deeds'])
})

test('JOS-84 A2: the from-suggested INCAPACITATE alert fires on the reporter\'s own line', () => {
  const defs = suggestedDefs('incapacitate', 'Incapacitate V')
  const lands = defs.find((d) => d.id === 'suggest:incapacitate:lands')
  assert.ok(lands, 'the wizard must still offer a "lands" suggestion for Incapacitate')

  const fired = fire([lands], [SLICE.incapLanded, SLICE.incapLandedLater])
  assert.equal(fired.length, 2, 'both Incapacitate landings must fire')
  assert.deepEqual(fired.map((f) => f.spell), ['Incapacitate', 'Incapacitate'])
})

test('JOS-84 A3: the pre-fix event is exactly the coin flip the report described', () => {
  // The evidence, pinned so the diagnosis cannot rot: the parser's `spell` field is NOT the
  // user's spell, and the candidate list is where the truth lives.
  const slow = parseEvent(SLICE.slowLandedTvala, 0)
  assert.equal(slow?.kind, 'buffApply')
  if (slow?.kind !== 'buffApply') return
  assert.equal(slow.target, 'Coercer T`vala')
  assert.equal(slow.spell, 'Forlorn Deeds', 'best-effort pick is alphabetical, not what you cast')
  assert.ok(slow.candidates.some((c) => c.name === 'Shiftless Deeds'))

  const incap = parseEvent(SLICE.incapLanded, 1)
  assert.equal(incap?.kind, 'buffApply')
  if (incap?.kind !== 'buffApply') return
  assert.equal(incap.spell, 'Disempower')
  assert.ok(incap.candidates.some((c) => c.name === 'Incapacitate'))
})

test('JOS-84 A4: THE SIBLING AUDIT — every template the wizard can author fires', () => {
  // The brief's instruction: if one suggested pattern is wrong, the others from the same
  // generator likely are too. All five rank-less/rank-pinned templates plus the shared illusion
  // one, each against the line that must set it off. `wearsOff`/`fade` are BENEFICIAL-only, so
  // they are exercised on a beneficial spell the same DB carries.
  const detrimental = suggestedDefs('shiftless deeds', 'Shiftless Deeds V')
  // The two rank templates carry the rank fragment in their id (`…:castRank:shiftless-deeds-v`).
  const byPrefix = (p: string): AlertDef => {
    const d = detrimental.find((x) => x.id.startsWith(p))
    assert.ok(d, `the wizard must offer ${p}`)
    return d
  }

  const cast = fire(
    [byPrefix('suggest:shiftless deeds:castRank')],
    ['[Fri Aug 07 09:07:20 2026] You begin casting Shiftless Deeds V.']
  )
  assert.equal(cast.length, 1, 'castRank must fire on the rank-suffixed cast line')
  assert.equal(cast[0].spell, 'Shiftless Deeds V')

  const resisted = fire(
    [byPrefix('suggest:shiftless deeds:resistRank')],
    ['[Fri Aug 07 09:07:30 2026] Coercer T`vala resisted your Shiftless Deeds V!']
  )
  assert.equal(resisted.length, 1, 'resistRank must fire on your own resisted cast')

  // The beneficial pair. Clarity's fade/wears-off lines name the spell outright, so these two
  // templates were never in the coin-flip family — this pins that they still are not.
  const clarity = suggestionsFor(entryFor('clarity')).map((s) => s.def)
  const wearsOff = clarity.find((d) => d.id === 'suggest:clarity:wearsOff')
  const fade = clarity.find((d) => d.id === 'suggest:clarity:fade')
  assert.ok(wearsOff && fade, 'Clarity must offer both beneficial templates')
  assert.equal(
    fire([fade], ['[Fri Aug 07 09:20:00 2026] Your Clarity spell has worn off of Bonbonz.']).length,
    1,
    'fade must fire on a named-target wear-off'
  )
  // `wearsOff` matches the DERIVED buffExpired the buffs module synthesizes (it carries an
  // already-RESOLVED spell, which is why this template was never in the coin-flip family), so it
  // is handed to the module directly — no log line parses into one.
  const mod = new AlertsModule()
  mod.setDefs([wearsOff])
  mod.reset()
  mod.onEvent(
    {
      kind: 'buffExpired',
      seq: 1,
      ts: Date.parse('2026-08-07T09:20:30Z'),
      raw: '[Fri Aug 07 09:20:30 2026] Your Clarity spell has worn off.',
      spell: 'Clarity',
      target: 'self'
    },
    true
  )
  assert.equal(
    (mod.flushDelta()?.delta.fired ?? []).length,
    1,
    'wearsOff must fire on the resolved buffExpired'
  )

  // The shared illusion suggestion.
  assert.equal(
    fire([illusionSuggestion().def], ['[Fri Aug 07 09:21:00 2026] Your illusion fades.']).length,
    1,
    'the illusion suggestion must fire on the generic fade line'
  )
})

test('JOS-84 A5: the widening is scoped — it cannot make an unrelated family fire', () => {
  // THE TRIPWIRE. `Your speed returns to normal.` is NINE HASTES and shares nothing with the
  // slow roster; the shared-message widening must not reach it. (shared/alertGroups.ts calls
  // this exact sentence out as the slow group's tripwire — it is one word from `Your speed
  // returns.`, which IS a slow.)
  const slowLands = suggestedDefs('shiftless deeds', 'Shiftless Deeds V').find(
    (d) => d.id === 'suggest:shiftless deeds:lands'
  )!
  assert.equal(
    fire([slowLands], ['[Fri Aug 07 09:22:00 2026] Your speed returns to normal.']).length,
    0,
    'a haste wearing off must never fire a slow alert'
  )
  // A `where` key that is not `spell` keeps its exact-compare semantics untouched.
  const targetPinned: AlertDef = {
    id: 'test:target-pinned',
    name: 'target pinned',
    enabled: true,
    trigger: { type: 'event', kind: 'buffApply', where: { spell: 'Shiftless Deeds', target: 'nobody' } },
    cooldownMs: 0
  }
  assert.equal(fire([targetPinned], [SLICE.slowLandedTvala]).length, 0)
})

test('JOS-84 A6: an alert pinned to a sibling of the same sentence fires too, and says so', () => {
  // Stated rather than hidden: when one sentence is five spells the log does not say which, so
  // the alert reports the FAMILY. A Languid Pace user (the level-9 rank of the same enchanter
  // ladder) gets the same fire off the same line — which is exactly what keeps the alert alive
  // across the level-up that replaces the spell.
  const languid = suggestionsFor(entryFor('languid pace')).map((s) => s.def)
  const lands = languid.find((d) => d.id === 'suggest:languid pace:lands')
  assert.ok(lands)
  const fired = fire([lands], [SLICE.slowLandedTvala])
  assert.equal(fired.length, 1)
  assert.equal(fired[0].spell, 'Languid Pace', 'it names the spell the ALERT is for')
})

test('JOS-84 A7: the reporter\'s cast+land pair fires the cast and the landing alerts', () => {
  // End to end on the slice's own two-line sequence, with the full suggested set installed —
  // the shape a user actually ends up with after clicking through the wizard.
  const defs = suggestedDefs('incapacitate', 'Incapacitate V')
  const fired = fire(defs, [SLICE.incapCast, SLICE.incapLanded])
  assert.deepEqual(new Set(fired.map((f) => f.alertId)), new Set([
    'suggest:incapacitate:castRank:incapacitate-v',
    'suggest:incapacitate:lands'
  ]))
})
