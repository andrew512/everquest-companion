// BUILDING A VIEW MAY NOT TOUCH THE AGGREGATE.
//
// `sourceViews` is handed the engine's LIVE accumulators — `segmentViews.buildView` passes
// `agg.out` straight through, and `Agg.addOut` keeps folding into those very objects. There is no
// freeze and no copy on the way in. So any reshaping a view build does has to COPY first; a write
// into one of those objects corrupts the fight, the zone session that shares them, and every
// snapshot afterwards, permanently.
//
// THIS FILE IS WHAT IS LEFT OF tests/combatCombinePetsPurity.test.mts, and the deletion is the
// point (owner ruling, 2026-08-04: "they should be using the same underlying api and abstraction
// — if not, collapse"). That file existed because the engine offered a COMBINE-PETS fold: it
// merged each pet's lanes into a synthetic "You +pets" row with namespaced skill names, and it
// did so IN PLACE — every snapshot taken with the option on added the pet's damage into your live
// row, permanently, and ten snapshots counted it ten times; the mirror-image bug clobbered the
// accumulated row when the pet swung before you. The fold was fixed to copy, and then the option
// itself was deleted: the floating overlay was its only consumer, it disagreed on screen with the
// Combat tab's own pet layout, and pet presentation now lives in exactly one place
// (renderer `features/combat/petRows.ts`, `meterPanel`). The fold is gone; its PARAMETER is gone
// from `sourceViews`/`buildView`/`buildSelected`/`snapshot()`/`SnapshotOpts`.
//
// What survives is the invariant, because a SECOND thing still reshapes a row on the way out:
// `withLandings`, which grafts the proc ledger's effect landings onto your lanes. It copies. The
// tests below prove it — over the same synthetic, hand-checkable window, and through the real
// engine — so the next reshaping to arrive inherits a tripwire instead of re-learning the lesson.
//
// The window is SYNTHETIC (generated, not extracted): it is in the log's verbatim line grammar,
// but the numbers are round so "5 hits × 100" is checkable by hand.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Agg, type DamageEvent, type SourceRef, type SourceStat } from '../src/main/combat/aggregate'
import { sourceViews, type EffectLandings } from '../src/main/combat/sourceViews'
import { parseEvent } from '../src/main/log/parser'
import { CombatEngine } from '../src/main/combat/engine'
import type { CombatSnapshot, DamageCategory, SourceView } from '../src/shared/combat'

// ── the unit half: sourceViews over a hand-built aggregate ────────────────────────────

const YOU: SourceRef = { id: 'you', name: 'You', kind: 'you' }
const PET: SourceRef = { id: 'pet:7', name: 'Vebarn', kind: 'pet' }

interface Hit {
  attacker: string
  amount: number
  skill: string
  category: DamageCategory
  ts: number
}

function dmg({ attacker, amount, skill, category, ts }: Hit): DamageEvent {
  return {
    ts,
    attacker,
    target: 'a flighty fiend',
    amount,
    dtype: category === 'spell' || category === 'dot' ? category : 'melee',
    skill,
    crit: false,
    category,
    modifiers: []
  }
}

/** An aggregate with your lanes and a pet's, folded in the given source order. */
function aggregate(order: 'you-first' | 'pet-first'): Agg {
  const agg = new Agg()
  const mine = (): void => {
    agg.addOut(YOU, dmg({ attacker: 'You', amount: 100, skill: 'Slash', category: 'melee', ts: 1000 }))
    agg.addOut(YOU, dmg({ attacker: 'You', amount: 100, skill: 'Slash', category: 'melee', ts: 2000 }))
    agg.addOut(YOU, dmg({ attacker: 'You', amount: 300, skill: 'Ancient Wrath', category: 'spell', ts: 3000 }))
    agg.addOutMiss(YOU, { mtype: 'dodge', skill: 'Slash' })
  }
  const pet = (): void => {
    agg.addOut(PET, dmg({ attacker: 'Vebarn', amount: 50, skill: 'Slash', category: 'melee', ts: 1000 }))
    agg.addOut(PET, dmg({ attacker: 'Vebarn', amount: 50, skill: 'Bash', category: 'melee', ts: 2000 }))
    agg.addOutMiss(PET, { mtype: 'miss', skill: 'Slash' })
  }
  if (order === 'you-first') { mine(); pet() } else { pet(); mine() }
  return agg
}

const MY_TOTAL = 500
const PET_TOTAL = 100

/**
 * The graft that still reshapes a row: one landing count for a lane your damage rows already
 * carry (Ancient Wrath) and one for a lane that has NO damage row at all (Weakening Strike, the
 * slow proc — it lands and resists but never prints a damage line), which the graft must CREATE.
 * Both write into `you`'s lane maps, and both must leave the aggregate alone.
 */
const LANDS: EffectLandings = new Map([
  ['ancient wrath', { name: 'Ancient Wrath', count: 4 }],
  ['weakening strike', { name: 'Weakening Strike', count: 562 }]
])

/**
 * A deep-comparable snapshot of the live aggregate.
 *
 * BOTH SIDES go through `structuredClone` on purpose. A `SourceStat` now carries a `RoundAccum`
 * INSTANCE (attack-round stats), and structuredClone drops a class prototype — so cloning only
 * the "before" side made every comparison fail on the prototype rather than on the contents.
 * Cloning both keeps the compare exactly as deep as it was (every own property, the pending
 * open second included) and prototype-neutral.
 */
function frozen(map: Map<string, SourceStat>): Map<string, unknown> {
  return structuredClone(map) as Map<string, unknown>
}

function rowOf(views: SourceView[], id: string): SourceView {
  const v = views.find((s) => s.id === id)
  assert.ok(v, `expected a ${id} row`)
  return v
}

test('A: a view build leaves the aggregate byte-identical (deep-compare), landings and all', () => {
  for (const order of ['you-first', 'pet-first'] as const) {
    const agg = aggregate(order)
    const before = frozen(agg.out)
    sourceViews(agg.out, 60, LANDS)
    assert.deepEqual(frozen(agg.out), before, `${order}: the view build wrote into the live aggregate`)
    // …and the un-grafted call is just as inert.
    sourceViews(agg.out, 60)
    assert.deepEqual(frozen(agg.out), before, `${order}: a plain view build wrote into the live aggregate`)
  }
})

test('B: building the same view twice is identical — and the tenth time too', () => {
  for (const order of ['you-first', 'pet-first'] as const) {
    const agg = aggregate(order)
    const first = JSON.stringify(sourceViews(agg.out, 60, LANDS))
    for (let i = 0; i < 9; i++) {
      assert.equal(
        JSON.stringify(sourceViews(agg.out, 60, LANDS)),
        first,
        `${order}: view build #${i + 2} drifted from the first`
      )
    }
  }
})

test('C: a grafted build cannot contaminate a later un-grafted one', () => {
  for (const order of ['you-first', 'pet-first'] as const) {
    const agg = aggregate(order)
    const plain = JSON.stringify(sourceViews(agg.out, 60))
    sourceViews(agg.out, 60, LANDS)
    sourceViews(agg.out, 60, LANDS)
    assert.equal(JSON.stringify(sourceViews(agg.out, 60)), plain, `${order}: the graft leaked`)
  }
})

test('D: you and your pet are TWO authoritative rows, whichever source landed first', () => {
  for (const order of ['you-first', 'pet-first'] as const) {
    const views = sourceViews(aggregate(order).out, 60)
    assert.equal(views.length, 2, `${order}: no source is folded into another`)
    assert.equal(rowOf(views, 'you').total, MY_TOTAL)
    assert.equal(rowOf(views, 'you').name, 'You', 'your row is YOURS — there is no "You +pets" row any more')
    assert.equal(rowOf(views, 'pet:7').total, PET_TOTAL)
    assert.equal(rowOf(views, 'pet:7').name, 'Vebarn', 'the pet keeps its own display name (law 2)')
    // No lane of yours is named after the pet: the namespaced "Vebarn: Slash" spelling was the
    // deleted fold's, and nothing may produce it again.
    const you = rowOf(views, 'you')
    assert.equal(you.skills.some((k) => k.name.includes('Vebarn')), false, `${order}: a pet lane in your row`)
    // Law 8's tripwire, per source: the categories sum to the source total exactly.
    assert.equal(you.categories.reduce((s, c) => s + c.total, 0), you.total)
  }
})

test('the graft adds landings without adding damage — and creates the damage-less lane', () => {
  const views = sourceViews(aggregate('you-first').out, 60, LANDS)
  const you = rowOf(views, 'you')
  assert.equal(you.total, MY_TOTAL, 'a landing is not damage')
  const lanes = new Map(you.skills.map((k) => [k.name, k]))
  assert.equal(lanes.get('Ancient Wrath')?.lands, 4, 'an existing lane gains its landings')
  const slow = lanes.get('Weakening Strike')
  assert.ok(slow, 'a lane with landings and no damage row is created')
  assert.equal(slow.total, 0)
  assert.equal(slow.lands, 562)
  // The pet's row never sees the ledger — it is YOUR procs.
  assert.equal(rowOf(views, 'pet:7').skills.some((k) => k.lands), false)
})

/**
 * THE ROUND ACCUMULATOR IS THE THIRD THING THAT RESHAPES A ROW ON THE WAY OUT
 * (docs/plans/attack-round-stats.md). It holds ONE second open at a time and folds it into the
 * counters only when a later second arrives — so a snapshot taken mid-second has to add the
 * open second's rounds WITHOUT closing it, or the next swing in that same second would open a
 * second round for it and every mid-fight poll would inflate the count.
 *
 * The window below is built to sit exactly there: every swing is in the SAME second, so the
 * accumulator's pending map is non-empty at snapshot time and nothing has been flushed at all.
 */
test('A2: a view build leaves the ROUND accumulator untouched, mid-second and all', () => {
  const agg = new Agg()
  for (const amount of [70, 145, 392]) {
    agg.addOut(YOU, {
      ...dmg({ attacker: 'You', amount, skill: 'Backstab', category: 'melee', ts: 5000 }),
      verb: 'backstab'
    })
  }
  const before = frozen(agg.out)
  const first = JSON.stringify(sourceViews(agg.out, 60))
  for (let i = 0; i < 5; i++) {
    assert.equal(JSON.stringify(sourceViews(agg.out, 60)), first, `round view build #${i + 2} drifted`)
  }
  assert.deepEqual(frozen(agg.out), before, 'the round view build wrote into the live accumulator')
  // …and the still-open second IS reported: three backstabs in one second is one 3-swing round.
  const bs = rowOf(sourceViews(agg.out, 60), 'you').roundStats?.lanes.find((l) => l.verb === 'backstab')
  assert.deepEqual(bs?.buckets, [0, 0, 1, 0], 'the open second must be counted without being closed')

  // Folding a FOURTH swing into that same second must still yield ONE round — proof the
  // snapshots above did not secretly close it.
  agg.addOut(YOU, {
    ...dmg({ attacker: 'You', amount: 11, skill: 'Backstab', category: 'melee', ts: 5000 }),
    verb: 'backstab'
  })
  const after = rowOf(sourceViews(agg.out, 60), 'you').roundStats?.lanes.find((l) => l.verb === 'backstab')
  assert.deepEqual(after?.buckets, [0, 0, 0, 1], 'the open second was closed by a snapshot')
})

test('the returned view never aliases the aggregate’s own maps', () => {
  const agg = aggregate('you-first')
  const live = agg.out.get('you') as SourceStat
  const lanesBefore = live.bySkill.size
  sourceViews(agg.out, 60, LANDS)
  assert.equal(live.bySkill.size, lanesBefore, 'the graft created a lane in the LIVE row')
  assert.equal(live.bySkill.get('Ancient Wrath')?.lands, 0, 'the graft wrote landings into the LIVE row')
})

// ── the engine half: repeated snapshots through the real pipeline ──────────────────────

/** SYNTHETIC window in the log's verbatim grammar: you and your summoned pet on one mob. */
const WINDOW: string[] = [
  "[Sat Aug 01 16:52:11 2026] Vebarn told you, 'Attacking a flighty fiend Master.'",
  '[Sat Aug 01 16:52:12 2026] Vebarn slashes a flighty fiend for 50 points of damage.',
  '[Sat Aug 01 16:52:13 2026] You slash a flighty fiend for 100 points of damage.',
  '[Sat Aug 01 16:52:14 2026] Vebarn bashes a flighty fiend for 50 points of damage.',
  '[Sat Aug 01 16:52:15 2026] You slash a flighty fiend for 100 points of damage.',
  '[Sat Aug 01 16:52:16 2026] You try to slash a flighty fiend, but miss!'
]

function replay(lines: string[]): { eng: CombatEngine; lastTs: number } {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  let lastTs = 0
  for (const raw of lines) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  return { eng, lastTs }
}

function outTotal(snap: CombatSnapshot): number {
  return snap.selected?.outTotal ?? -1
}

test('ENGINE: taking the same snapshot ten times never moves a number', () => {
  const { eng, lastTs } = replay(WINDOW)
  const truth = 300 // you 200 + Vebarn 100

  const first = JSON.stringify(eng.snapshot(lastTs).selected)
  for (let i = 0; i < 10; i++) {
    const snap = eng.snapshot(lastTs)
    assert.equal(outTotal(snap), truth, `snapshot #${i + 2} inflated the fight total`)
    assert.equal(JSON.stringify(snap.selected), first, `snapshot #${i + 2} drifted`)
  }
  // The pet is its own row at the source level; `outTotal` is the sum, which is exactly what the
  // renderer's combined headline reads (petRows: self + nested pets == outTotal).
  const entities = eng.snapshot(lastTs).selected?.entities ?? []
  assert.deepEqual(
    entities.map((e) => [e.kind, e.total]).sort(),
    [['pet', 100], ['you', 200]].sort()
  )
  assert.equal(entities.reduce((s, e) => s + e.total, 0), truth)
})

test('ENGINE: the zone session inherits the aggregate, and your row is YOUR damage', () => {
  const { eng, lastTs } = replay(WINDOW)
  for (let i = 0; i < 5; i++) eng.snapshot(lastTs)
  const zone = eng.snapshot(lastTs, { selectedId: 'zone' })
  assert.equal(outTotal(zone), 300, 'the zone rollup carries the fight once')
  const you = zone.selected?.entities.find((e) => e.kind === 'you')
  assert.ok(you)
  assert.equal(you.total, 200, 'your zone row is YOUR damage — no pet folded into it')
  assert.equal(you.skills.some((k) => k.name.startsWith('Vebarn:')), false, 'no pet lane in your row')
})
