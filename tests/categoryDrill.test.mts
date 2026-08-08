// THE DRILL'S THIRD LEVEL (JOS-105) — one damage TYPE of one source, and what it may say.
//
// The owner's ask, verbatim: "Kill the separate panel; integrate its stats into the single
// drill-down. Drill into melee -> slash vs crush, double attack, triple attack, crit rate. Every
// damage type gets the same treatment - stats live INSIDE the drill, not beside it in a second
// panel." So this file pins the SHAPING that makes that one level possible:
//
//   * the lanes of the category, ranked, with widths re-based on the category's own biggest —
//     "slash vs crush";
//   * the multi-attack rows FILED TO THE RIGHT CATEGORY, which is the only genuinely new
//     judgement here (an attack round is a weapon swing, and the log's lane labels do not name a
//     category);
//   * the flurry line stated ONCE for the source rather than once per damage type;
//   * the rates coming off the engine's own rollup rather than being re-derived — law 8: the
//     surface moved, the numbers did not.
//
// The multi-attack ROWS themselves are unchanged and stay pinned in tests/multiAttackRows.test.mts.
//
// RELATIVE value import, like multiAttackRows.test.mts and procRows.test.mts: node tests resolve
// no `@shared/*` alias for values (categoryDrill.ts imports that alias type-only, which tsx
// strips).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { categoryDrill, laneCategory } from '../src/renderer/src/features/combat/categoryDrill'
import type {
  CategoryView,
  DamageCategory,
  RoundLaneView,
  SkillView,
  SourceRoundsView,
  SourceView
} from '../src/shared/combat'

function skill(name: string, total: number, over: Partial<SkillView> = {}): SkillView {
  return { name, total, pct: 0, hits: Math.max(1, Math.round(total / 100)), crits: 0, max: total, ...over }
}

function category(cat: DamageCategory, skills: SkillView[], over: Partial<CategoryView> = {}): CategoryView {
  const total = skills.reduce((n, s) => n + s.total, 0)
  const hits = skills.reduce((n, s) => n + s.hits, 0)
  const crits = skills.reduce((n, s) => n + s.crits, 0)
  return {
    category: cat,
    total,
    pct: 100,
    hits,
    crits,
    critPct: hits > 0 ? (crits / hits) * 100 : 0,
    max: Math.max(0, ...skills.map((s) => s.max)),
    resists: 0,
    resistPct: 0,
    skills,
    ...over
  }
}

function lane(verb: string, label: string, buckets: number[], over: Partial<RoundLaneView> = {}): RoundLaneView {
  const rounds = buckets.reduce((n, v) => n + v, 0)
  const multi = buckets.slice(1).reduce((n, v) => n + v, 0)
  return {
    verb,
    label,
    rounds,
    buckets,
    multiRounds: multi,
    multiPct: rounds > 0 ? (multi / rounds) * 100 : 0,
    fannedRounds: 0,
    confidence: 'aggregate',
    ...over
  }
}

function rounds(lanes: RoundLaneView[], over: Partial<SourceRoundsView> = {}): SourceRoundsView {
  return {
    lanes,
    primaryRounds: lanes.reduce((n, l) => n + l.rounds, 0),
    excluded: { frenzy: 0, riposte: 0, flurry: 0, rampage: 0 },
    modifiers: [],
    ripostesGiven: 0,
    ripostesTaken: 0,
    rampagesTaken: 0,
    flurries: 0,
    flurryPct: 0,
    ...over
  }
}

function source(over: Partial<SourceView> = {}): SourceView {
  return {
    id: 'you',
    name: 'You',
    kind: 'you',
    total: 0,
    dps: 0,
    pct: 100,
    hits: 0,
    crits: 0,
    critPct: 0,
    ambiguousHits: 0,
    ambiguousTotal: 0,
    misses: 0,
    hitPct: 100,
    missBreakdown: { miss: 0, dodge: 0, parry: 0, riposte: 0, block: 0, absorb: 0 },
    resists: 0,
    resistPct: 0,
    skills: [],
    categories: [],
    ...over
  } as SourceView
}

/**
 * A paladin's shape, and the one that makes every judgement below load-bearing: weapon verbs the
 * parser answers "Melee" for (so their lanes are titled after the VERB), a NAMED special-attack
 * lane that IS a skill row (Bash), a Slay Undead proc row named after that same weapon skill, and
 * a spell category with no swings in it at all.
 */
const MELEE = category('melee', [skill('Melee', 5000, { hits: 40, crits: 6 }), skill('Bash', 1200, { hits: 12 })], {
  critPct: 11.5,
  max: 512
})
const SLAY = category('slay', [skill('Bash', 800, { hits: 4 })])
const SPELL = category('spell', [skill('Smiting Strike', 2000, { hits: 10 })], { resists: 3, resistPct: 23 })
const ROUNDS = rounds(
  [
    lane('slash', 'Slash', [18, 10, 5, 2]),
    lane('crush', 'Crush', [12, 4, 1, 0]),
    lane('bash', 'Bash', [9, 1, 0, 0], { confidence: 'perEvent' })
  ],
  { flurries: 12, flurryPct: 2.1, modifiers: [{ name: 'Flurry', count: 12, avoided: 0 }] }
)
const PALADIN = source({ categories: [MELEE, SLAY, SPELL], roundStats: ROUNDS })

test('SLASH VS CRUSH: the drill is the category’s own lanes, ranked, re-based on its own biggest', () => {
  const d = categoryDrill(PALADIN, 'melee')
  assert.ok(d)
  assert.deepEqual(d.rows.map((r) => r.name), ['Melee', 'Bash'])
  assert.equal(d.rows[0].pct, 100, 'the category’s biggest lane fills the bar')
  assert.equal(Math.round(d.rows[1].pct), 24, '…and the rest are relative to IT, not to the segment')
  // Every row carries the category it was drilled from, so a bar knows its own colour.
  assert.ok(d.rows.every((r) => r.category === 'melee'))
})

test('THE RATES ARE THE ENGINE’S, not re-derived here (law 8: the surface moved, not the numbers)', () => {
  const d = categoryDrill(PALADIN, 'melee')
  assert.ok(d)
  assert.equal(d.critPct, MELEE.critPct)
  assert.equal(d.total, MELEE.total)
  assert.equal(d.hits, MELEE.hits)
  assert.equal(d.max, MELEE.max)
  const spell = categoryDrill(PALADIN, 'spell')
  assert.equal(spell?.resistPct, 23, 'a resistable category states its resist rate')
  assert.equal(d.resists, 0, '…and a melee one has none to state')
})

test('DOUBLE AND TRIPLE ATTACK RIDE THE CATEGORY THAT SWUNG — inside the drill, not beside it', () => {
  const d = categoryDrill(PALADIN, 'melee')
  assert.ok(d)
  assert.deepEqual(d.attack.map((r) => r.label), ['Slash', 'Crush', 'Bash'])
  assert.equal(d.attack[0].text, '29% doubled · 14% tripled · 6% quad+')
  assert.equal(d.attack[0].rounds, 35, 'the denominator stays on the row, in rounds')
  // Bar widths re-base within the CATEGORY: the biggest lane in this drill fills its bar, which
  // it would not do if the pct came from a whole-source maximum.
  assert.equal(d.attack[0].pct, 100)
})

test('A LANE WHOSE LABEL NAMES NO SKILL IS A WEAPON SWING, and weapon swings are melee', () => {
  // The parser answers "Melee" for slash / crush / pierce / hit alike, so `roundLaneLabel` titles
  // those lanes after the VERB and no skill row is called "Slash". That is the normal case, not
  // an edge: an attack round is a weapon swing.
  assert.equal(laneCategory(PALADIN, lane('slash', 'Slash', [1])), 'melee')
  assert.equal(laneCategory(PALADIN, lane('pierce', 'Pierce', [1])), 'melee')
})

test('A NAMED lane goes to the category the ENGINE booked that skill under — melee wins the tie', () => {
  // "Bash" exists in BOTH categories: a Slay Undead proc rides a weapon swing, so the engine names
  // its slay row after the weapon skill. The ROUND belongs to the swing that opened it, not to the
  // proc that happened to fire on it — so the lane is filed under melee, and the slay drill shows
  // the proc's own damage with no attack rows of its own.
  assert.equal(laneCategory(PALADIN, lane('bash', 'Bash', [1], { confidence: 'perEvent' })), 'melee')
  assert.deepEqual(categoryDrill(PALADIN, 'slay')?.attack, [])
  assert.deepEqual(categoryDrill(PALADIN, 'melee')?.attack.map((r) => r.verb), ['slash', 'crush', 'bash'])
})

test('EVERY DAMAGE TYPE GETS THE SAME TREATMENT — a caster’s drill is the same drill, minus swings', () => {
  const d = categoryDrill(PALADIN, 'spell')
  assert.ok(d, 'a category with no rounds still drills')
  assert.deepEqual(d.rows.map((r) => r.name), ['Smiting Strike'])
  assert.deepEqual(d.attack, [], 'no swings ⇒ no attack rows, rather than a table of zeroes')
  assert.equal(d.flurry, null)
})

test('FLURRY IS STATED ONCE, on the category that owns the rounds', () => {
  // The log never says which verb a flurried swing belonged to, so the count cannot be split —
  // and printing it in all three drills would state the same 12 flurries three times.
  assert.equal(categoryDrill(PALADIN, 'melee')?.flurry, 'flurry ×12 · 2.1% of rounds')
  assert.equal(categoryDrill(PALADIN, 'slay')?.flurry, null)
  assert.equal(categoryDrill(PALADIN, 'spell')?.flurry, null)
  // Nothing flurried ⇒ the line does not exist at all, for anyone.
  const quiet = source({ categories: [MELEE], roundStats: rounds([lane('slash', 'Slash', [4, 1])]) })
  assert.equal(categoryDrill(quiet, 'melee')?.flurry, null)
})

test('A STALE LEVEL-3 DRILL DEGRADES ONE LEVEL, exactly like a stale entity id does', () => {
  // `null` is what `petRows.meterPanel` reads as "render level 2" — the source's whole lane list —
  // so a persisted drill into a damage type this fight has none of never blanks the meter.
  assert.equal(categoryDrill(PALADIN, 'dot'), null)
  assert.equal(categoryDrill(source(), 'melee'), null)
})

test('THE OVERLAY CAN PERSIST THE LEVEL IT OPENS — the store normalizer carries the category', () => {
  // A SOURCE PIN, because `setOverlayConfig` writes through electron-store and cannot be called
  // from a node test. It earns its place: the overlay drill is rebuilt FIELD BY FIELD on the way
  // in (so a renderer patch can never widen what is persisted), and this ticket's level-3 field
  // was not in that list at first. The window then opened the type optimistically, the round trip
  // pulled it back to level 2, and the next click on the crumb fell all the way out to level 1 —
  // caught by tests/e2e/overlay-sync.e2e.mts, which is the only place it was visible.
  const store = readFileSync(new URL('../src/main/store.ts', import.meta.url), 'utf8')
  const block = /next\.drill\s*=[\s\S]{0,400}/.exec(store)?.[0] ?? ''
  assert.match(block, /entityId/, 'the drill normalizer no longer rebuilds an entityId')
  assert.match(block, /category/, 'the drill normalizer drops the damage type again (level 3 cannot persist)')
})

test('A SOURCE WITH NO MELEE CATEGORY files its swings under the only other one a swing can land in', () => {
  // Defensive, and the reason `laneFallback` is not a bare 'melee': a source whose every swing
  // carried the proc has a slay category and no melee one, and its rounds must not vanish into a
  // category that is not on screen.
  const slayOnly = source({ categories: [SLAY], roundStats: rounds([lane('slash', 'Slash', [3, 1])]) })
  assert.equal(laneCategory(slayOnly, lane('slash', 'Slash', [3, 1])), 'slay')
  assert.equal(categoryDrill(slayOnly, 'slay')?.attack.length, 1)
})
