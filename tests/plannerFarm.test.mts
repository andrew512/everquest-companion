// PLANNER FARM-ROLLUP TESTS — which zone a donor is filed under, and why (JOS-42, refinement 4).
//
// THE TRUST BUG THIS FILE EXISTS FOR. A farm plan filed Batfang Headband under DRAGON NECROPOLIS
// — a Velious zone this server has not opened — while Western Plains of Karana, where five
// classic-era ogres drop the same headband, sat in the row's muted "also:" tail. The rollup was
// not wrong about the facts; it was wrong about which of them to lead with. Its tiebreak was
// alphabetical (header: "a stable, statable rule beats whichever the scrape listed first"), and
// `Dragon Necropolis` < `Timorous Deep` < `Western Plains of Karana`. So the one heading the whole
// feature exists to produce — "go here next" — named a place the player cannot go.
//
// SO THE ANCHOR IS THE REAL CATALOG, not a hand-built fixture. `src/renderer/src/data/eqlegends/
// mobs.json` is committed data, and every zone below was read out of it: a carrion bat and a
// Chetari guard in Dragon Necropolis (velious), four ogres in Western Plains of Karana (classic),
// The Great Oowomp in Timorous Deep (kunark). If a rescrape ever moves those, this test is
// supposed to notice — that is what makes it an anchor rather than a mock.
//
// The rest is the arithmetic the header states, pinned as identities: every need appears exactly
// once, the weights still choose the zone that feeds the most of the set, and the alphabetical
// tiebreak survives inside whichever candidate set the era rule leaves standing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectNeeds,
  farmZone,
  groupNeeds,
  type FarmNeed
} from '../src/renderer/src/features/planner/plannerFarm'
import type { DonorRow } from '../src/renderer/src/features/planner/plannerData'
import type { DonorProgress } from '../src/renderer/src/features/planner/plannerProgress'
import type { EquipSlot, ExaltPlan, SocketType } from '../src/shared/planner/types'

const HEADBAND = 'batfang headband'

/** The three zones the committed catalog names for the headband, in catalog order. */
const DN = 'Dragon Necropolis'
const WPK = 'Western Plains of Karana'
const TD = 'Timorous Deep'

/** Progress is DECORATION here (design D6) — the rollup groups the same way whatever it says. */
const PLANNED: DonorProgress = {
  state: 'planned',
  label: 'planned',
  tierRequired: 4,
  held: 0,
  looted: 0
}

interface Placed {
  slot: EquipSlot
  socket: SocketType
  effect: string
  donorKey: string
}

/** A plan of planned sockets, pointed at donor keys by name — all `collectNeeds` needs. */
function planOf(picks: readonly Placed[]): ExaltPlan {
  const slots: ExaltPlan['slots'] = {}
  for (const p of picks) {
    const slot = slots[p.slot] ?? { sockets: {} }
    slot.sockets[p.socket] = { effect: p.effect, donorKey: p.donorKey }
    slots[p.slot] = slot
  }
  return { id: 'test', name: 'test', classes: [], slots, createdAt: 0, updatedAt: 0 }
}

/** The corpus is deliberately EMPTY: a plan may name a (key, effect) the DB no longer carries,
 *  and the zone rollup must answer from the mob catalog alone — which is the case under test. */
const EMPTY_INDEX = new Map<string, DonorRow[]>()

function needsOf(picks: readonly Placed[]): FarmNeed[] {
  return collectNeeds(planOf(picks), EMPTY_INDEX, () => PLANNED)
}

test('ANCHOR — the committed catalog puts Batfang Headband in three zones, two of them out of era', () => {
  const [need] = needsOf([{ slot: 'HEAD', socket: 'proc', effect: 'Bat Fang', donorKey: HEADBAND }])
  assert.ok(need, 'the plan produced no need')
  assert.deepEqual([...need.zones].sort(), [DN, TD, WPK].sort())
  assert.equal(farmZone(DN).era, 'velious')
  assert.equal(farmZone(DN).outOfEra, true)
  assert.equal(farmZone(TD).era, 'kunark')
  assert.equal(farmZone(TD).outOfEra, true)
  assert.equal(farmZone(WPK).era, 'classic')
  assert.equal(farmZone(WPK).outOfEra, false)
})

test('THE TRUST BUG — with the era filter on, the headband is filed under the zone you can reach', () => {
  const needs = needsOf([{ slot: 'HEAD', socket: 'proc', effect: 'Bat Fang', donorKey: HEADBAND }])
  const groups = groupNeeds(needs, { eraOnly: true })

  assert.equal(groups.length, 1)
  assert.equal(groups[0].title, WPK, `filed under ${groups[0].title}, which is not in era`)
  assert.equal(groups[0].kind, 'zone')

  // …and the out-of-era zones survive, in the tail, each naming its own expansion.
  const also = groups[0].rows[0].also
  assert.deepEqual(
    also.map((z) => z.name).sort(),
    [DN, TD].sort()
  )
  assert.ok(
    also.every((z) => z.outOfEra),
    'an out-of-era "also" zone must say which expansion it is'
  )
  // The chip's word comes from ERA_LABEL, never spelled here twice.
  assert.deepEqual(also.map((z) => z.eraLabel).sort(), ['Kunark', 'Velious'])
})

test('with the era filter OFF the rollup keeps its old answer — the filter is what makes the rule apply', () => {
  const needs = needsOf([{ slot: 'HEAD', socket: 'proc', effect: 'Bat Fang', donorKey: HEADBAND }])
  const groups = groupNeeds(needs, { eraOnly: false })
  // Ties are alphabetical and every zone is a candidate again, so the old (honest, era-blind)
  // answer comes back: this is a browse of everything, not a route.
  assert.equal(groups[0].title, DN)
})

test('the era rule never beats the weights INSIDE the reachable set — most-needed still wins', () => {
  // Two needs. The headband can be farmed in WPK (classic) or DN/TD (later expansions); the
  // second donor is a Western Plains of Karana drop only. WPK therefore feeds both and must win
  // on weight, exactly as it does on era.
  const needs = needsOf([
    { slot: 'HEAD', socket: 'proc', effect: 'Bat Fang', donorKey: HEADBAND },
    { slot: 'NECK', socket: 'proc', effect: 'Bone', donorKey: 'glowing bone collar' }
  ])
  const groups = groupNeeds(needs, { eraOnly: true })
  const wpk = groups.find((g) => g.title === WPK)
  assert.ok(wpk, `no ${WPK} group in ${groups.map((g) => g.title).join(', ')}`)
  assert.ok(wpk.rows.length >= 1)
  assert.equal(groups[0].title, WPK, 'the biggest group leads the rollup')
})

test('every need appears EXACTLY once, whatever the era rule chose', () => {
  const needs = needsOf([
    { slot: 'HEAD', socket: 'proc', effect: 'Bat Fang', donorKey: HEADBAND },
    { slot: 'NECK', socket: 'proc', effect: 'Bone', donorKey: 'glowing bone collar' },
    { slot: 'BACK', socket: 'proc', effect: 'Nothing', donorKey: 'an item nobody drops' }
  ])
  for (const eraOnly of [true, false]) {
    const groups = groupNeeds(needs, { eraOnly })
    const rows = groups.flatMap((g) => g.rows)
    assert.equal(rows.length, needs.length, `${String(rows.length)} rows for ${String(needs.length)} needs`)
    const ids = new Set(rows.map((r) => `${r.slot}:${r.socket}:${r.donorKey}`))
    assert.equal(ids.size, needs.length)
  }
})

test('a donor nothing places keeps the honest non-zone heading', () => {
  const groups = groupNeeds(needsOf([{ slot: 'BACK', socket: 'proc', effect: 'X', donorKey: 'an item nobody drops' }]), {
    eraOnly: true
  })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].kind, 'unknown')
})
