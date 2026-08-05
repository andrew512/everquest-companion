// PET NESTING IS PRESENTATION, AND IT CONSERVES EVERY NUMBER.
//
// The default combat view drills into YOUR damage and shows the pet as ONE line item inside it
// (owner direction, 2026-08-03: the game is mostly played solo, so a two-row source meter is a
// lid on the only list worth reading). That regrouping happens entirely in the renderer, over
// the snapshot the engine already sends with `combinePets: false` — you and each pet as their
// own authoritative `SourceView`.
//
// These are pure derivations over already-aggregated data, so the window is synthetic (the same
// footing as tests/combatSlayGrouping.test.mts): there is no log line to hand-read, only the
// invariants that make the layout HONEST —
//
//   1. the pet is its OWN row, never added into a skill lane of yours (law 4: "pet" is not a
//      data-model class; the damage attribution is the engine's and must survive the layout);
//   2. the row is labelled with the pet's REAL display name off its source row (law 2: display
//      raw), never a coined "Pet";
//   3. the combined total is self + pets — which is `SegmentView.outTotal`, the number both the
//      Combat panel header and the Overview card headline, so the two can never disagree;
//   4. turning the preference off yields EXACTLY today's list (your skills, no pet row);
//   5. bar widths are re-based over the merged list, so the biggest row — usually the pet — is
//      the one that renders full width.
//
// THE PREFERENCE IS ALSO THE ZOOM (owner direction, 2026-08-04) — `defaultDrill` decides which
// LEVEL the dashboard opens on, and the last block below walks the owner's whole navigation loop
// (in → out → in) in both preference states. Verified against a real charmed-pet fight before it
// was written: Plane of Sky, Tue Aug 04 22:48–22:52, `a thunder spirit` charmed with Allure VI —
// the engine binds it, hands it over as a `kind: 'pet'` SourceView, and one segment of that
// session legitimately carries TWO pet sources (the first charm broke and a second was landed),
// which is the multi-line case pinned at the bottom of this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenSkills, type Drill } from '../src/renderer/src/features/combat/dashboardData'
import { defaultDrill, nestedRows, ownBreakdown, petSources, selfSource } from '../src/renderer/src/features/combat/petRows'
import type { SkillView, SourceView } from '../src/shared/combat'

function skill(name: string, over: Partial<SkillView> = {}): SkillView {
  return { name, total: 0, pct: 0, hits: 0, crits: 0, max: 0, ...over }
}

function cat(category: SourceView['categories'][number]['category'], skills: SkillView[]): SourceView['categories'][number] {
  return {
    category,
    total: skills.reduce((n, s) => n + s.total, 0),
    pct: 100,
    hits: skills.reduce((n, s) => n + s.hits, 0),
    crits: 0,
    critPct: 0,
    max: Math.max(0, ...skills.map((s) => s.max)),
    resists: 0,
    resistPct: 0,
    skills
  }
}

/** Only the fields the nesting reads are populated — the rest of SourceView is irrelevant here. */
function source(
  id: string,
  name: string,
  kind: SourceView['kind'],
  categories: SourceView['categories']
): SourceView {
  const total = categories.reduce((n, c) => n + c.total, 0)
  return {
    id,
    name,
    kind,
    total,
    dps: total / 60,
    hits: categories.reduce((n, c) => n + c.hits, 0),
    crits: 0,
    misses: categories.reduce((n, c) => n + (c.skills.reduce((m, s) => m + (s.misses ?? 0), 0)), 0),
    resists: 0,
    categories
  } as unknown as SourceView
}

const YOU = source('you', 'You', 'you', [
  cat('melee', [
    skill('Melee', { total: 5000, hits: 100, max: 120, min: 10, misses: 20 }),
    skill('Backstab', { total: 3000, hits: 20, max: 400, min: 50 })
  ]),
  cat('spell', [skill('Ancient Wrath', { total: 1000, hits: 4, max: 300, min: 200 })])
])

/** A summoned pet's random proper name (law: pets are named Vebarn, Garer, …). */
const PET = source('pet:7', 'Vebarn', 'pet', [
  cat('melee', [skill('Melee', { total: 7000, hits: 210, max: 90, min: 5, misses: 30 })])
])

const ENTITIES = [PET, YOU]

test('combined: the pet is ONE row, named for the pet, beside your untouched skill lanes', () => {
  const b = ownBreakdown(ENTITIES, true)
  assert.equal(b.self?.id, 'you')
  assert.deepEqual(b.pets.map((p) => p.id), ['pet:7'])

  const pets = b.rows.filter((r) => r.kind === 'pet')
  assert.equal(pets.length, 1, 'one line item per pet')
  assert.equal(pets[0].kind === 'pet' && pets[0].pet.name, 'Vebarn', 'labelled with the real display name')
  assert.equal(pets[0].total, 7000)

  // THE HONESTY INVARIANT: your rows are byte-identical to the un-nested flatten. Not one point
  // of pet damage may appear inside a lane of yours.
  const mine = b.rows.filter((r) => r.kind === 'skill').map((r) => (r.kind === 'skill' ? r.skill : null))
  const plain = flattenSkills(YOU)
  assert.deepEqual(
    mine.map((s) => [s?.name, s?.total, s?.hits]),
    plain.map((s) => [s.name, s.total, s.hits]),
    'your lanes carry exactly your numbers'
  )
  assert.equal(
    mine.reduce((n, s) => n + (s?.total ?? 0), 0),
    9000,
    'your rows still sum to YOUR total, never you+pet'
  )
})

test('combined: the total is self + pets — the same aggregate as SegmentView.outTotal', () => {
  const b = ownBreakdown(ENTITIES, true)
  assert.equal(b.total, 16000)
  assert.equal(b.total, YOU.total + PET.total)
  // …and it is NOT the sum of the rendered rows' totals plus the pet twice, i.e. the pet row is
  // counted exactly once.
  assert.equal(b.rows.reduce((n, r) => n + r.total, 0), 16000)
})

test('uncombined: exactly today’s list — your skills, no pet row, no pets nested', () => {
  const b = ownBreakdown(ENTITIES, false)
  assert.equal(b.pets.length, 0)
  assert.equal(b.rows.some((r) => r.kind === 'pet'), false)
  assert.deepEqual(
    b.rows.map((r) => (r.kind === 'skill' ? r.skill.name : '?')),
    flattenSkills(YOU).map((s) => s.name)
  )
  assert.equal(b.total, YOU.total, 'the total is yours alone when nothing is nested')
})

test('rows rank together and bar widths re-base over the MERGED list', () => {
  const rows = ownBreakdown(ENTITIES, true).rows
  assert.equal(rows[0].kind, 'pet', 'the 7k pet outranks your 5k melee')
  assert.equal(Math.round(rows[0].pct), 100, 'the largest row fills the bar')
  const melee = rows.find((r) => r.kind === 'skill' && r.skill.name === 'Melee')
  assert.ok(melee)
  assert.equal(Math.round(melee.pct), 71, '5000/7000 — measured against the pet, not against itself')
  assert.equal(
    melee.kind === 'skill' && Math.round(melee.skill.pct),
    71,
    'the SkillRow handed to the bar carries the same re-based pct'
  )
  // Ranking is by damage, so a row order is never "you first then pets" — that would be a
  // presentation lie about who did the work.
  assert.deepEqual(
    rows.map((r) => Math.round(r.total)),
    [7000, 5000, 3000, 1000]
  )
})

test('drilling the pet is the plain flatten of the pet — no pet nested inside a pet', () => {
  const rows = nestedRows(PET, [])
  assert.equal(rows.some((r) => r.kind === 'pet'), false)
  assert.deepEqual(
    rows.map((r) => (r.kind === 'skill' ? [r.skill.name, r.skill.total] : null)),
    [['Melee', 7000]]
  )
})

test('the source split is by KIND, never by the aggregate’s key spelling', () => {
  assert.equal(selfSource(ENTITIES)?.name, 'You')
  assert.deepEqual(petSources(ENTITIES).map((p) => p.name), ['Vebarn'])
  assert.equal(selfSource([PET]), null, 'a segment with no outgoing damage of yours has no self row')
  // Two pets in one segment (a pet died and was re-summoned mid-zone-session) nest as two rows.
  const second = source('pet:9', 'Garer', 'pet', [cat('melee', [skill('Melee', { total: 500, hits: 9, max: 80, min: 4 })])])
  const b = ownBreakdown([YOU, PET, second], true)
  assert.deepEqual(
    b.rows.filter((r) => r.kind === 'pet').map((r) => (r.kind === 'pet' ? r.pet.name : '')),
    ['Vebarn', 'Garer']
  )
  assert.equal(b.total, 16500)
})

// ── THE DEFAULT ZOOM, AND THE WHOLE NAVIGATION LOOP ────────────────────────────────────────
//
// One preference, both halves of one choice: it decides how the pet is LAID OUT *and* which
// level the dashboard OPENS on. The panel below is a faithful model of `SegmentPanel`'s
// three-way body (level 1 = the source rows; a drilled source = `nestedRows` of it, with pets
// nested only into YOURS and only while the preference is on), so a whole in → out → in loop
// can be asserted as a sequence of renders rather than described in a comment.

const SELF_ID = selfSource(ENTITIES)?.id ?? null

interface Panel {
  level: 1 | 2
  subject: string
  rows: string[]
}

function panel(entities: SourceView[], combine: boolean, drill: Drill | null): Panel {
  const pets = combine ? petSources(entities) : []
  const e = drill?.kind === 'entity' ? entities.find((s) => s.id === drill.entityId) : undefined
  if (!e) return { level: 1, subject: 'sources', rows: entities.map((s) => s.name) }
  const rows = nestedRows(e, e.kind === 'you' ? pets : [])
  return { level: 2, subject: e.name, rows: rows.map((r) => (r.kind === 'pet' ? r.pet.name : r.skill.name)) }
}

test('preference ON: the default view is YOUR breakdown with the pet as one ranked line item', () => {
  const opening = defaultDrill(SELF_ID, true)
  assert.deepEqual(opening, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(panel(ENTITIES, true, opening), {
    level: 2,
    subject: 'You',
    rows: ['Vebarn', 'Melee', 'Backstab', 'Ancient Wrath']
  })
})

test('preference OFF: the default view is FULLY ZOOMED OUT — one bar per source', () => {
  const opening = defaultDrill(SELF_ID, false)
  assert.equal(opening, null, 'no drill at all: level 1')
  // The level-1 list is the engine's own source rows, in its own ranking — you and your pet.
  assert.deepEqual(panel(ENTITIES, false, opening), {
    level: 1,
    subject: 'sources',
    rows: ['Vebarn', 'You']
  })
})

test('preference OFF: your bar drills to your skills with NO pet line; the pet bar to the pet', () => {
  const mine = panel(ENTITIES, false, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(mine.rows, ['Melee', 'Backstab', 'Ancient Wrath'], 'nothing is nested while it is off')
  const pet = panel(ENTITIES, false, { kind: 'entity', entityId: 'pet:7' })
  assert.deepEqual(pet, { level: 2, subject: 'Vebarn', rows: ['Melee'] })
  // …and backing out of either lands on the same two-bar list it opened on.
  assert.deepEqual(panel(ENTITIES, false, null), panel(ENTITIES, false, defaultDrill(SELF_ID, false)))
})

test('preference ON: in → out → in — pet drill, Back, and the combined view is exactly as it opened', () => {
  const opening = panel(ENTITIES, true, defaultDrill(SELF_ID, true))
  assert.ok(opening.rows.includes('Vebarn'), 'the pet is a line item of the opening view')

  // IN: clicking that line drills to JUST the pet — no pet nested inside a pet.
  const petView = panel(ENTITIES, true, { kind: 'entity', entityId: 'pet:7' })
  assert.deepEqual(petView, { level: 2, subject: 'Vebarn', rows: ['Melee'] })

  // OUT: the pet's Back goes to its PARENT (your breakdown), not to level 1 — and lands on a
  // view byte-identical to the one it was clicked from.
  assert.deepEqual(panel(ENTITIES, true, { kind: 'entity', entityId: 'you' }), opening)

  // …and all the way out is still reachable, one more Back / the "All" crumb.
  assert.equal(panel(ENTITIES, true, null).level, 1)
})

test('the preference is the ONLY thing that moves the default level', () => {
  assert.notDeepEqual(defaultDrill(SELF_ID, true), defaultDrill(SELF_ID, false))
  // A segment with no outgoing damage of yours has no "your breakdown" to open: level 1 either
  // way, so the pet's own row is what you see rather than an empty pane.
  assert.equal(defaultDrill(null, true), null)
  assert.deepEqual(panel([PET], true, defaultDrill(null, true)).rows, ['Vebarn'])
})

test('two pets in one segment are two line items, each drilling to its own breakdown', () => {
  const second = source('pet:9', 'Garer', 'pet', [cat('melee', [skill('Melee', { total: 500, hits: 9, max: 80, min: 4 })])])
  const segment = [YOU, PET, second]
  const opening = panel(segment, true, defaultDrill(SELF_ID, true))
  assert.deepEqual(opening.rows, ['Vebarn', 'Melee', 'Backstab', 'Ancient Wrath', 'Garer'])
  assert.equal(panel(segment, true, { kind: 'entity', entityId: 'pet:9' }).subject, 'Garer')
  assert.equal(panel(segment, true, { kind: 'entity', entityId: 'pet:7' }).subject, 'Vebarn')
  // Zoomed out, the same segment is three bars.
  assert.deepEqual(panel(segment, false, defaultDrill(SELF_ID, false)).rows, ['You', 'Vebarn', 'Garer'])
})
