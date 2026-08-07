// ADD, OR REPLACE — what the effect browser's add control is allowed to claim (JOS-42, ref. 3).
//
// A socket holds exactly one effect (R1), so "Add to set" over an occupied socket silently
// discarded a decision the user had already made. The rule lives in
// `src/renderer/src/features/planner/plannerReplace.ts` and is tested HERE rather than only
// through the app, because the e2e can only exercise whichever socket this machine's own plan and
// gear happen to leave occupied — it legitimately skips otherwise, and a warning that must never
// be wrong cannot be covered by a step that sometimes does not run.
//
// The interesting cases are all about REFUSING to claim a replace: an unresolvable target (a
// two-slot donor before its slot is picked) and a no-op write (re-adding the row already there)
// must both answer null, because a warning that fires when nothing would be lost teaches the user
// to ignore the warning.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  outgoing,
  plannedBySocket,
  replacesFor,
  targetCells,
  type ReplaceSubject
} from '../src/renderer/src/features/planner/plannerReplace'
import type { ExaltPlan, PlanSlotId, SocketType } from '../src/shared/planner/types'

const HEAL: ReplaceSubject = {
  key: 'water sprinkler',
  effect: 'Improved Healing III',
  socket: 'focus',
  slots: ['HEAD']
}
/** The same donor listed for two slots — the case whose target is NOT knowable from the row. */
const SWORD: ReplaceSubject = {
  key: 'coldain hammer',
  effect: 'Improved Healing III',
  socket: 'focus',
  slots: ['PRIMARY', 'SECONDARY']
}
/** ONE equip slot, TWO places to wear it — the JOS-67 case (you have two ring fingers). */
const RING: ReplaceSubject = {
  key: 'ring of pureblood',
  effect: 'Improved Healing III',
  socket: 'focus',
  slots: ['FINGER']
}

function planOf(picks: { slot: PlanSlotId; socket: SocketType; effect: string; donorKey: string }[]): ExaltPlan {
  const slots: ExaltPlan['slots'] = {}
  for (const p of picks) {
    const slot = slots[p.slot] ?? { sockets: {} }
    slot.sockets[p.socket] = { effect: p.effect, donorKey: p.donorKey }
    slots[p.slot] = slot
  }
  return { id: 't', name: 't', classes: [], slots, createdAt: 0, updatedAt: 0 }
}

const EMPTY = plannedBySocket(planOf([]))
const HEAD_FOCUS_TAKEN = plannedBySocket(
  planOf([{ slot: 'HEAD', socket: 'focus', effect: 'Improved Healing I', donorKey: 'cloak of piety' }])
)

test('an empty plan replaces nothing, however the row is aimed', () => {
  assert.equal(replacesFor(EMPTY, null, HEAL), null)
  assert.equal(replacesFor(EMPTY, { slot: 'HEAD', socket: 'focus' }, HEAL), null)
  assert.equal(outgoing(EMPTY, 'HEAD', 'focus', HEAL), null)
})

test('a ONE-SLOT donor implies its target, so an occupied socket is named', () => {
  assert.equal(replacesFor(HEAD_FOCUS_TAKEN, null, HEAL), 'Improved Healing I')
})

test('…but only that socket: another slot, or another socket type, is untouched', () => {
  // FEET rather than WRIST: a wrist donor resolves to TWO cells since JOS-67 and would answer
  // null for the unrelated reason that its target is ambiguous, which is not what this pins.
  const feet: ReplaceSubject = { ...HEAL, slots: ['FEET'] }
  assert.equal(replacesFor(HEAD_FOCUS_TAKEN, null, feet), null)
  const proc: ReplaceSubject = { ...HEAL, socket: 'proc' }
  assert.equal(replacesFor(HEAD_FOCUS_TAKEN, null, proc), null)
})

test('a TWO-SLOT donor claims nothing — the slot menu is the question, and it is unanswered', () => {
  const bothTaken = plannedBySocket(
    planOf([
      { slot: 'PRIMARY', socket: 'focus', effect: 'Improved Healing I', donorKey: 'cloak of piety' },
      { slot: 'SECONDARY', socket: 'focus', effect: 'Extended Range I', donorKey: 'staff of writhing' }
    ])
  )
  // Both of its slots are full and it STILL says nothing: guessing which one the user meant is
  // exactly the mistake. The menu names them one at a time instead (`outgoing`, per slot).
  assert.equal(replacesFor(bothTaken, null, SWORD), null)
  assert.equal(outgoing(bothTaken, 'PRIMARY', 'focus', SWORD), 'Improved Healing I')
  assert.equal(outgoing(bothTaken, 'SECONDARY', 'focus', SWORD), 'Extended Range I')
})

test('A PRESET makes the target exact, even for a two-slot donor', () => {
  const secondaryTaken = plannedBySocket(
    planOf([{ slot: 'SECONDARY', socket: 'focus', effect: 'Extended Range I', donorKey: 'staff of writhing' }])
  )
  assert.equal(replacesFor(secondaryTaken, { slot: 'SECONDARY', socket: 'focus' }, SWORD), 'Extended Range I')
  // The preset overrides the donor's own socket AND slot, so the empty PRIMARY answers null.
  assert.equal(replacesFor(secondaryTaken, { slot: 'PRIMARY', socket: 'focus' }, SWORD), null)
})

test('re-adding the row ALREADY in the socket replaces nothing — it is chipped "in set" instead', () => {
  const same = plannedBySocket(
    planOf([{ slot: 'HEAD', socket: 'focus', effect: HEAL.effect, donorKey: HEAL.key }])
  )
  assert.equal(replacesFor(same, null, HEAL), null)
  assert.equal(replacesFor(same, { slot: 'HEAD', socket: 'focus' }, HEAL), null)
  // A DIFFERENT donor of the very same effect is still a replace: the plan names which item you
  // are going to farm, so swapping the donor is a real change of plan.
  const otherDonor: ReplaceSubject = { ...HEAL, key: 'coldain hammer' }
  assert.equal(replacesFor(same, null, otherDonor), HEAL.effect)
})

test('A RING DONOR HAS TWO TARGETS, so it asks instead of writing (JOS-67)', () => {
  // The report, as a unit: "only allows one finger slot focus effect". A FINGER donor names ONE
  // equip slot and TWO cells, so it now behaves like the two-slot sword — the menu is the question
  // — where it used to imply FINGER and overwrite whatever was there.
  assert.deepEqual(targetCells(RING), ['FINGER', 'FINGER2'])
  assert.deepEqual(targetCells(HEAL), ['HEAD'])
  assert.deepEqual(targetCells(SWORD), ['PRIMARY', 'SECONDARY'])

  const firstRingTaken = plannedBySocket(
    planOf([{ slot: 'FINGER', socket: 'focus', effect: 'Improved Healing I', donorKey: 'cloak of piety' }])
  )
  assert.equal(replacesFor(firstRingTaken, null, RING), null, 'the row must not claim which ring')
  assert.equal(outgoing(firstRingTaken, 'FINGER', 'focus', RING), 'Improved Healing I')
  // …and THE SECOND RING IS FREE, which is the whole fix: the same focus can be planned there
  // without displacing anything.
  assert.equal(outgoing(firstRingTaken, 'FINGER2', 'focus', RING), null)
})

test('the two cells of a pair are independent sockets, not one', () => {
  const both = plannedBySocket(
    planOf([
      { slot: 'FINGER', socket: 'focus', effect: 'Improved Healing I', donorKey: 'ring a' },
      { slot: 'FINGER2', socket: 'focus', effect: 'Improved Healing II', donorKey: 'ring b' }
    ])
  )
  assert.deepEqual([...both.keys()].sort(), ['FINGER2:focus', 'FINGER:focus'])
  assert.equal(outgoing(both, 'FINGER', 'focus', RING), 'Improved Healing I')
  assert.equal(outgoing(both, 'FINGER2', 'focus', RING), 'Improved Healing II')
})

test('plannedBySocket folds every planned socket of every slot, and nothing else', () => {
  const occupied = plannedBySocket(
    planOf([
      { slot: 'HEAD', socket: 'focus', effect: 'A', donorKey: 'a' },
      { slot: 'HEAD', socket: 'proc', effect: 'B', donorKey: 'b' },
      { slot: 'FEET', socket: 'worn', effect: 'C', donorKey: 'c' }
    ])
  )
  assert.equal(occupied.size, 3)
  assert.deepEqual([...occupied.keys()].sort(), ['FEET:worn', 'HEAD:focus', 'HEAD:proc'])
})
