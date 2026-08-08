// PET NESTING IS PRESENTATION, AND IT CONSERVES EVERY NUMBER.
//
// The default combat view drills into YOUR damage and shows the pet as ONE line item inside it
// (owner direction, 2026-08-03: the game is mostly played solo, so a two-row source meter is a
// lid on the only list worth reading). That regrouping happens entirely in the renderer, over the
// snapshot the engine sends — you and each pet as their own authoritative `SourceView`, which is
// now the ONLY thing the engine sends (its own pet fold is deleted; see the bottom of this file).
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
// THE PREFERENCE IS THE PET'S LAYOUT, AND ONLY THAT (owner ruling, 2026-08-05 — JOS-35). It used
// to double as the default ZOOM: with nesting on, every meter opened INSIDE your breakdown. That
// stopped being right the moment the meters grew group-mates, and it hid the pet double-count
// below — so every surface opens on LEVEL 1 now, and the preference decides only where the pet's
// damage lives. The last blocks walk the owner's whole navigation loop (in → out → in) in both
// preference states, and pin the fold. Verified against a real charmed-pet fight before it
// was written: Plane of Sky, Tue Aug 04 22:48–22:52, `a thunder spirit` charmed with Allure VI —
// the engine binds it, hands it over as a `kind: 'pet'` SourceView, and one segment of that
// session legitimately carries TWO pet sources (the first charm broke and a second was landed),
// which is the multi-line case pinned at the bottom of this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { flattenSkills, meterDrill, type Drill } from '../src/renderer/src/features/combat/dashboardData'
import {
  laneDps,
  meterPanel,
  meterSources,
  nestedRows,
  ownBreakdown,
  petSources,
  selfSource,
  type MeterPanel
} from '../src/renderer/src/features/combat/petRows'
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

/**
 * A whole SourceView, derived the way the engine derives one (`main/combat/sourceViews.ts`) — the
 * counters summed from the categories and the three percentages taken from those counters. It is
 * fully populated rather than cast-and-hope because the LEVEL-1 FOLD reads every counter on it:
 * a half-built fixture would have let `meterSources` combine fields nothing here ever checked.
 */
function source(
  id: string,
  name: string,
  kind: SourceView['kind'],
  categories: SourceView['categories']
): SourceView {
  const total = categories.reduce((n, c) => n + c.total, 0)
  const hits = categories.reduce((n, c) => n + c.hits, 0)
  const crits = categories.reduce((n, c) => n + c.crits, 0)
  const misses = categories.reduce((n, c) => n + c.skills.reduce((m, s) => m + (s.misses ?? 0), 0), 0)
  const swings = hits + misses
  return {
    id,
    name,
    kind,
    total,
    dps: total / 60,
    pct: 100,
    hits,
    crits,
    critPct: hits ? (crits / hits) * 100 : 0,
    ambiguousHits: 0,
    ambiguousTotal: 0,
    misses,
    hitPct: swings ? (hits / swings) * 100 : 100,
    missBreakdown: { miss: misses, dodge: 0, parry: 0, riposte: 0, block: 0, absorb: 0 },
    resists: 0,
    resistPct: 0,
    skills: categories.flatMap((c) => c.skills),
    categories
  }
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

// ── LEVEL 1 IS THE DEFAULT, AND THE WHOLE NAVIGATION LOOP ──────────────────────────────────
//
// `meterPanel` is the whole three-way body (level 1 = the source rows AS THE PREFERENCE LAYS
// THEM OUT; a drilled source = its lanes with pets nested only into YOURS and only while the
// preference is on), so a whole in → out → in loop is asserted as a sequence of real panels
// rather than described in a comment — and asserted against the REAL builder both surfaces call,
// not a model of it (see "ONE BUILDER, TWO SURFACES" at the bottom).

/** What a rendered meter LOOKS like, reduced to text: its level, its subject, its row labels. */
interface Panel {
  level: 1 | 2
  subject: string
  rows: string[]
}

function shown(p: MeterPanel): Panel {
  if (p.level === 1) return { level: 1, subject: 'sources', rows: p.sources.map((s) => s.name) }
  return { level: 2, subject: p.subject.name, rows: p.rows.map((r) => (r.kind === 'pet' ? r.pet.name : r.skill.name)) }
}

/**
 * THE COMBAT TAB'S CALL, spelled exactly as `SegmentPanel.tsx` spells it: its drill is a union
 * that can also name a mob, so `dashboardData.meterDrill` is what reaches the builder, and `null`
 * means the user explicitly backed all the way out.
 *
 * THE OVERVIEW CARD MAKES THE IDENTICAL CALL (JOS-105 — `DpsCard.tsx`, same two functions in the
 * same order), which is why there is no third helper here: a card that needed its own spelling
 * would be the fork this ticket removed.
 */
function combatTab(entities: SourceView[], combine: boolean, drill: Drill | null): MeterPanel {
  return meterPanel(entities, combine, meterDrill(drill))
}

/**
 * THE OVERLAY'S CALL, spelled exactly as `meterBars.tsx` spells it: its drill is the persisted
 * `{ entityId, category? }` of `overlays.<kind>.drill` handed straight over — that record IS the
 * builder's argument shape — and having none is LEVEL 1, the same thing `null` means on the
 * Combat tab.
 */
function overlayMeter(entities: SourceView[], combine: boolean, drill: { entityId: string } | null): MeterPanel {
  return meterPanel(entities, combine, drill)
}

const panel = (entities: SourceView[], combine: boolean, drill: Drill | null): Panel =>
  shown(combatTab(entities, combine, drill))

test('LEVEL 1 IS THE DEFAULT: no drill opens on the source list, whatever the preference says', () => {
  // ON: one bar, because the pet's damage is inside yours (see the fold block below).
  assert.deepEqual(panel(ENTITIES, true, null), { level: 1, subject: 'sources', rows: ['You'] })
  // OFF: two bars, the engine's own rows in the engine's own ranking.
  assert.deepEqual(panel(ENTITIES, false, null), { level: 1, subject: 'sources', rows: ['Vebarn', 'You'] })
})

test('preference OFF: your bar drills to your skills with NO pet line; the pet bar to the pet', () => {
  const mine = panel(ENTITIES, false, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(mine.rows, ['Melee', 'Backstab', 'Ancient Wrath'], 'nothing is nested while it is off')
  const pet = panel(ENTITIES, false, { kind: 'entity', entityId: 'pet:7' })
  assert.deepEqual(pet, { level: 2, subject: 'Vebarn', rows: ['Melee'] })
})

test('preference ON: out → in → in → out — the whole loop, and every level has a way back', () => {
  // OUT is where it opens now.
  assert.equal(panel(ENTITIES, true, null).level, 1)

  // IN: your bar opens YOUR breakdown, with the pet as one ranked line item.
  const mine = panel(ENTITIES, true, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(mine, { level: 2, subject: 'You', rows: ['Vebarn', 'Melee', 'Backstab', 'Ancient Wrath'] })

  // IN AGAIN: clicking that line drills to JUST the pet — no pet nested inside a pet — and the
  // panel knows whose line item it was, which is what the back chevron returns to.
  const petView = combatTab(ENTITIES, true, { kind: 'entity', entityId: 'pet:7' })
  assert.deepEqual(shown(petView), { level: 2, subject: 'Vebarn', rows: ['Melee'] })
  assert.equal(petView.level === 2 && petView.parent?.id, 'you')

  // OUT: the pet's Back goes to its PARENT and lands on the view it was clicked from; one more
  // Back is level 1. There is a level to go back to from every level-2 view, which is the whole
  // point — the meter used to withhold Back on exactly the view it opened on (JOS-35).
  assert.deepEqual(panel(ENTITIES, true, { kind: 'entity', entityId: 'you' }), mine)
  assert.equal(panel(ENTITIES, true, null).level, 1)
})

test('a segment with no damage of yours is still level 1 — the pet is simply its own bar', () => {
  // Nothing to fold INTO, so the fold stands down rather than inventing a row for you.
  assert.deepEqual(panel([PET], true, null), { level: 1, subject: 'sources', rows: ['Vebarn'] })
})

test('two pets in one segment are two line items, each drilling to its own breakdown', () => {
  const second = source('pet:9', 'Garer', 'pet', [cat('melee', [skill('Melee', { total: 500, hits: 9, max: 80, min: 4 })])])
  const segment = [YOU, PET, second]
  const mine = panel(segment, true, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(mine.rows, ['Vebarn', 'Melee', 'Backstab', 'Ancient Wrath', 'Garer'])
  assert.equal(panel(segment, true, { kind: 'entity', entityId: 'pet:9' }).subject, 'Garer')
  assert.equal(panel(segment, true, { kind: 'entity', entityId: 'pet:7' }).subject, 'Vebarn')
  // Both pets fold into the one bar at level 1; uncombined, the same segment is three bars.
  assert.deepEqual(panel(segment, true, null).rows, ['You'])
  assert.deepEqual(panel(segment, false, null).rows, ['You', 'Vebarn', 'Garer'])
})

// ── THE LEVEL-1 FOLD: with the preference on, the pet appears in exactly ONE place ─────────
//
// OWNER, 2026-08-05 (JOS-35): "when ON, pet damage lives inside your bar and the pet appears
// NOWHERE else — today it leaks into both places, the bug." It did: `meterPanel` handed level 1
// the engine's raw rows, so the pet was a bar of its own AND a line item inside your breakdown,
// and the two bars added up to more than the fight.

test('FOLD: with the preference on there is no pet BAR — its damage is inside yours', () => {
  const rows = meterSources(ENTITIES, true)
  assert.deepEqual(rows.map((r) => r.name), ['You'])
  assert.equal(rows[0].total, 16000, 'self + pets — exactly SegmentView.outTotal for this fight')
  assert.equal(rows[0].dps, YOU.dps + PET.dps)
  assert.equal(Math.round(rows[0].pct), 100, 'the bar is re-based over the surviving rows')
  // …and the drill into that bar sums to the same number, so no level contradicts another.
  const mine = combatTab(ENTITIES, true, { kind: 'entity', entityId: 'you' })
  assert.equal(mine.level === 2 && mine.rows.reduce((n, r) => n + r.total, 0), 16000)
})

test('FOLD: every counter is SUMMED FROM IDENTITIES, and the rates re-derived from those sums', () => {
  const [me] = meterSources(ENTITIES, true)
  assert.equal(me.hits, YOU.hits + PET.hits, '124 + 210')
  assert.equal(me.misses, YOU.misses + PET.misses, '20 + 30')
  assert.equal(me.missBreakdown.miss, YOU.missBreakdown.miss + PET.missBreakdown.miss)
  // The percentage is taken from the SUMS, never blended from the two sources' percentages.
  assert.equal(me.hitPct, ((YOU.hits + PET.hits) / (YOU.hits + PET.hits + YOU.misses + PET.misses)) * 100)
  // What is NOT folded: your lanes stay yours. The pet's damage is a line item one level down,
  // never a lane of yours (law 4), so `skills`/`categories` are byte-identical to your own row.
  assert.deepEqual(me.skills, YOU.skills)
  assert.deepEqual(me.categories, YOU.categories)
})

test('FOLD: a pet’s name-ambiguity travels with its damage into your bar', () => {
  // The `~` badge says "some of these hits may belong to a same-named hostile twin". Folding the
  // row must not fold away the warning — it is a fact about the number, and the number moved.
  const twin: SourceView = {
    ...source('pet:8', 'a thunder spirit', 'pet', [cat('melee', [skill('Melee', { total: 900, hits: 12, max: 90, min: 5 })])]),
    ambiguousHits: 4,
    ambiguousTotal: 300
  }
  const [me] = meterSources([YOU, twin], true)
  assert.equal(me.ambiguousHits, 4)
  assert.equal(me.ambiguousTotal, 300)
})

test('FOLD: nothing to fold ⇒ the SAME ARRAY back, by reference', () => {
  // The invariant that keeps solo-with-no-pet and every incoming list exactly as they were: no
  // new objects, no re-ranking, no memo churn (the same rule meterScope.scopeSources keeps).
  assert.equal(meterSources(ENTITIES, false), ENTITIES, 'the preference is off')
  const petless = [YOU]
  assert.equal(meterSources(petless, true), petless, 'no pets in this segment')
  const ownerless = [PET]
  assert.equal(meterSources(ownerless, true), ownerless, 'no row of yours to fold into')
})

test('a lane’s own rate divides by the segment’s ACTIVE seconds — the activeDps divisor', () => {
  // Same arithmetic as the engine's shipped `activeDps` (main/combat/segmentViews.ts), so a
  // drill's lane rates and the fight's headline active rate can never disagree about a divisor.
  assert.equal(laneDps(5000, 100), 50)
  // A segment with no active time yet does not divide by zero, and does not print Infinity.
  assert.equal(laneDps(5000, 0), 5000)
})

// ── ONE BUILDER, TWO SURFACES ──────────────────────────────────────────────────────────────
//
// OWNER RULING, 2026-08-04: "the overlay is using a different source of data — combat has a
// breakdown with pet appropriately merged and overlay does not — this should not be possible,
// they should be using the same underlying api and abstraction — if not, collapse."
//
// It WAS possible, because there were two folds. The Combat tab built its rows here; the floating
// overlay asked the ENGINE for `combinePets`, which returns a synthetic "You +pets" source with
// namespaced lanes ("Vebarn: Slash") and no pet line at all. Same fight, two answers, side by side
// on one screen.
//
// The tests below are what make it structurally impossible rather than currently-fixed. The first
// pair asserts the two surfaces' calls agree on every state they can be in — not "look similar",
// deep-equal, because they are literally one function call reached two ways. The last is a source
// tripwire: a SECOND row builder appearing in either meter has no seam to live in, since the meter
// files may not call anything else, and the engine's fold may not come back.

/** Every drill state a meter can be in, as the two surfaces spell it. */
const DRILLS: { name: string; tab: Drill | null; ov: { entityId: string } | null }[] = [
  { name: 'your row', tab: { kind: 'entity', entityId: 'you' }, ov: { entityId: 'you' } },
  { name: 'the pet', tab: { kind: 'entity', entityId: 'pet:7' }, ov: { entityId: 'pet:7' } },
  // A `pet:<instanceId>` from a past session / a fight that moved on. The standing law: render
  // level 1 for this render, never clear the stored value.
  { name: 'a stale id', tab: { kind: 'entity', entityId: 'pet:404' }, ov: { entityId: 'pet:404' } }
]

test('ONE CALL: the overlay and the Combat tab build the SAME panel from the same drill', () => {
  for (const combine of [true, false]) {
    for (const d of DRILLS) {
      assert.deepEqual(
        overlayMeter(ENTITIES, combine, d.ov),
        combatTab(ENTITIES, combine, d.tab),
        `combine=${String(combine)}, drilled into ${d.name}: the two surfaces diverged`
      )
    }
  }
})

test('ONE CALL: an overlay with no drill of its own rests exactly where the Combat tab opens', () => {
  for (const combine of [true, false]) {
    assert.deepEqual(
      overlayMeter(ENTITIES, combine, null),
      combatTab(ENTITIES, combine, null),
      `combine=${String(combine)}: the resting overlay is not where the tab opens`
    )
  }
  // Spelled out: LEVEL 1 in both preference states, differing only in whether the pet has a bar
  // of its own — never "you are already drilled into yourself and cannot get out" (JOS-35).
  assert.deepEqual(shown(overlayMeter(ENTITIES, true, null)), {
    level: 1,
    subject: 'sources',
    rows: ['You']
  })
  assert.deepEqual(shown(overlayMeter(ENTITIES, false, null)), {
    level: 1,
    subject: 'sources',
    rows: ['Vebarn', 'You']
  })
})

test('ONE CALL: the Overview card is the same panel as the Combat tab, at every level', () => {
  // JOS-105. The card used to reach past the builder to `ownBreakdown`, hold its own three-value
  // drill vocabulary, and draw bars with no click on them — so the SAME fight drilled on one
  // surface and sat inert on the other. It now makes the identical call, so the panels are equal
  // objects at every level there is, not merely "the same rows" at one of them.
  const levels: (Drill | null)[] = [
    null,
    { kind: 'entity', entityId: 'you' },
    { kind: 'entity', entityId: 'pet:7' }
  ]
  for (const combine of [true, false]) {
    for (const drill of levels) {
      const card = meterPanel(ENTITIES, combine, meterDrill(drill))
      assert.deepEqual(shown(card), shown(combatTab(ENTITIES, combine, drill)), `combine=${String(combine)}`)
    }
  }
  // …and the fold is still the fold: your breakdown's rows are the meters' level-2 rows.
  const meter = combatTab(ENTITIES, true, { kind: 'entity', entityId: 'you' })
  assert.deepEqual(ownBreakdown(ENTITIES, true).rows, meter.level === 2 ? meter.rows : null)
})

test('the overlay drill maps onto the collapsed model: pet drill, its way back, and stale ids', () => {
  // Clicking the nested pet line shows JUST the pet — and knows whose line item it was, which is
  // what the overlay's back chevron returns to (the parent, not level 1).
  const pet = overlayMeter(ENTITIES, true, { entityId: 'pet:7' })
  assert.equal(pet.level === 2 && pet.subject.name, 'Vebarn')
  assert.equal(pet.level === 2 && pet.parent?.id, 'you', 'the pet knows it is nested inside your row')
  assert.deepEqual(shown(pet).rows, ['Melee'], 'no pet nested inside a pet')
  // Preference OFF, the same pet is a TOP-LEVEL source: nothing nested it, so back goes all the
  // way out rather than to a breakdown it was never inside.
  const loose = overlayMeter(ENTITIES, false, { entityId: 'pet:7' })
  assert.equal(loose.level === 2 && loose.parent, null)
  // A stale id renders level 1 — the caller's stored value is never consulted for the fallback,
  // so nothing here can clear it. Level 1 is the preference's own layout, as always.
  assert.deepEqual(shown(overlayMeter(ENTITIES, true, { entityId: 'pet:404' })), {
    level: 1,
    subject: 'sources',
    rows: ['You']
  })
  assert.deepEqual(shown(overlayMeter(ENTITIES, false, { entityId: 'pet:404' })), {
    level: 1,
    subject: 'sources',
    rows: ['Vebarn', 'You']
  })
})

// ── the source tripwire: a second row builder has nowhere to live ──────────────────────────

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('NO SECOND BUILDER: all THREE meters call meterPanel, and none shapes rows any other way', () => {
  const metres = {
    'the Combat tab': src('../src/renderer/src/features/combat/SegmentPanel.tsx'),
    'the floating overlay': src('../src/renderer/src/overlay/meterBars.tsx'),
    // JOS-105 added the third: the Overview glance card, which used to call `ownBreakdown` and
    // `nestedRows` itself. Its density is a PROP on the shared components now, not a fork.
    'the Overview card': src('../src/renderer/src/features/overview/DpsCard.tsx')
  }
  for (const [who, text] of Object.entries(metres)) {
    assert.match(text, /\bmeterPanel\s*\(/, `${who} does not call the shared row builder`)
    // `flattenSkills` is the level-2 list the overlay used to build for itself, straight off a
    // SourceView — the exact seam that let the two surfaces drift. It belongs to petRows now.
    assert.doesNotMatch(text, /\bflattenSkills\s*\(/, `${who} builds its own flat list again`)
    assert.doesNotMatch(text, /\bnestedRows\s*\(/, `${who} reaches past meterPanel to the row fold`)
    assert.doesNotMatch(text, /\bownBreakdown\s*\(/, `${who} reaches past meterPanel to the pet fold`)
  }
})

test('NO SECOND PANEL, NO CATEGORY LEVEL: the multi-attack readout is a per-ability inline expansion', () => {
  // JOS-105 killed the standalone `MultiAttackPanel.tsx` and moved its rows one level down, under a
  // CATEGORY drill. JOS-113 removed that level too (owner: no category grouping); the double/triple
  // is attached PER ABILITY now (abilityStats.abilityMultiAttack) and expands inline with the
  // ability's crit/miss (combatShared.SkillReadout). So both the panel AND its replacement level
  // are gone, and no surface may reintroduce either.
  for (const gone of ['MultiAttackPanel.tsx', 'CategoryDrillBody.tsx', 'categoryDrill.ts']) {
    assert.throws(() => src(`../src/renderer/src/features/combat/${gone}`), /ENOENT/, `${gone} is back`)
  }
  // The per-ability reading is where the numbers live now, off the engine's own round lanes.
  const readout = src('../src/renderer/src/features/combat/combatShared.tsx')
  assert.match(readout, /AbilityMulti|abilityExpandable/, 'the per-ability readout no longer sources the multi-attack stats')
  // No surface mounts the old panel, and none carries a category-chip drill any more.
  for (const [who, rel] of [
    ['the Combat tab', '../src/renderer/src/features/combat/SegmentPanel.tsx'],
    ['the drill body', '../src/renderer/src/features/combat/MeterRows.tsx'],
    ['the overlay', '../src/renderer/src/overlay/meterBars.tsx']
  ] as const) {
    const text = src(rel)
    assert.doesNotMatch(text, /<MultiAttackPanel\b/, `${who} still mounts a separate panel`)
    assert.doesNotMatch(text, /kind:\s*'category'|category-chip|overlay-category/, `${who} still carries a category-chip drill`)
  }
})

test('NO SECOND BUILDER: the engine offers no combine-pets fold to fall back to', () => {
  const views = src('../src/main/combat/sourceViews.ts')
  assert.doesNotMatch(views, /\bmergePetInto\b/, 'the engine-side pet fold is back')
  assert.doesNotMatch(views, /\bcombinePets\b/, 'sourceViews grew a combine flag again')
  // …and no caller can ask for one: the option is gone from the snapshot contract itself.
  assert.doesNotMatch(src('../src/shared/combat.ts'), /^\s*combinePets\?:/m, 'SnapshotOpts offers the fold again')
})
