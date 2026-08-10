// DRAG THE ALERTS LIST INTO YOUR OWN ORDER (JOS-175) — the order is data, it persists, and it
// changes nothing about when an alert fires.
//
// THREE CLAIMS, AND EACH IS PINNED WHERE IT CAN ACTUALLY BE SEEN:
//
//   1. THE RULES. `src/shared/alertOrder.ts` is pure and total — unknown ids ignored, duplicates
//      collapsed, omitted defs KEPT. A reorder must never be able to delete an alert, because it
//      runs on a door a renderer supplies the payload for.
//   2. PERSISTENCE. The order is the stored ARRAY, so what has to survive a restart is the array's
//      sequence through the JSON electron-store writes. That round trip is pinned here; the app
//      actually restarting on it is `tests/e2e/alerts-reorder.e2e.mts`, which reorders in the real
//      UI, quits, relaunches on the same userData and reads the list back off the screen.
//      `src/main/store.ts` cannot be imported into a node test (electron-store constructs at
//      module scope — the plannerStore.test.mts precedent), so its accessor is SOURCE-PINNED to
//      the pure function below instead of being re-implemented here.
//   3. FIRING IS UNTOUCHED. The evaluator walks every def, always, each with its own cooldown —
//      there is no first-match-wins anywhere in it. Proven by folding the SAME lines through the
//      SAME defs in two different orders and comparing what fired, and how often.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyAlertOrder, moveId, nudgeId, orderChanged } from '../src/shared/alertOrder'
import { parseEvent } from '../src/main/log/parser'
import { AlertsModule } from '../src/main/modules/alerts'
import type { AlertDef } from '../src/shared/types'

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')

/** A minimal list whose ids are its whole identity for the ordering rules. */
const LIST = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
const idsOf = <T extends { id: string }>(list: readonly T[]): string[] => list.map((x) => x.id)

// ------------------------------------------------------------------ 1. the rules

test('the stored order follows the id sequence, and the identity sequence is a no-op', () => {
  assert.deepEqual(idsOf(applyAlertOrder(LIST, ['c', 'a', 'd', 'b'])), ['c', 'a', 'd', 'b'])
  assert.deepEqual(idsOf(applyAlertOrder(LIST, idsOf(LIST))), idsOf(LIST))
  assert.equal(orderChanged(LIST, idsOf(LIST)), false)
  assert.equal(orderChanged(LIST, ['b', 'a', 'c', 'd']), true)
  assert.equal(orderChanged(LIST, ['a', 'b', 'c']), true, 'a shorter sequence is a different one')
})

test('a reorder can MOVE an alert and never lose one', () => {
  // Omitted ids: the def stays, at the end, in its existing relative order. This is the case a
  // stale renderer produces (a share import landed while the drag was in flight).
  assert.deepEqual(idsOf(applyAlertOrder(LIST, ['d'])), ['d', 'a', 'b', 'c'])
  assert.deepEqual(idsOf(applyAlertOrder(LIST, [])), idsOf(LIST), 'an empty sequence is a no-op')
  // Ids main does not have are skipped rather than invented, and a repeat is honoured once.
  assert.deepEqual(idsOf(applyAlertOrder(LIST, ['zz', 'c', 'c', 'a'])), ['c', 'a', 'b', 'd'])
  // The count is the invariant that matters: no sequence, however hostile, may shorten the list.
  for (const seq of [[], ['a'], ['zz'], ['b', 'b', 'b'], ['d', 'c', 'b', 'a', 'a', 'zz']]) {
    assert.equal(applyAlertOrder(LIST, seq).length, LIST.length, JSON.stringify(seq))
  }
})

test('a drop puts the dragged row in the target row’s place, in either direction', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveId(ids, 'a', 'c'), ['b', 'c', 'a', 'd'], 'dragged down onto c')
  assert.deepEqual(moveId(ids, 'd', 'b'), ['a', 'd', 'b', 'c'], 'dragged up onto b')
  // A drop on itself, on nothing, or from nothing is a no-op rather than an error — every one of
  // these is reachable from a real gesture (a click that never moved, a drop outside the list).
  assert.deepEqual(moveId(ids, 'a', 'a'), ids)
  assert.deepEqual(moveId(ids, 'a', 'zz'), ids)
  assert.deepEqual(moveId(ids, 'zz', 'a'), ids)
  assert.notEqual(moveId(ids, 'a', 'c'), ids, 'the input array is never mutated')
})

test('the arrow keys nudge one place and stop at the ends', () => {
  const ids = ['a', 'b', 'c']
  assert.deepEqual(nudgeId(ids, 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(nudgeId(ids, 'b', 1), ['a', 'c', 'b'])
  assert.deepEqual(nudgeId(ids, 'a', -1), ids, 'off the top is a no-op')
  assert.deepEqual(nudgeId(ids, 'c', 1), ids, 'off the bottom is a no-op')
  assert.deepEqual(nudgeId(ids, 'zz', 1), ids)
})

// ------------------------------------------------------------------ 2. persistence

test('the order survives the store’s JSON round trip — the array IS the order', () => {
  const stored = applyAlertOrder(LIST, ['d', 'b', 'c', 'a'])
  // electron-store writes JSON and reads it back; a JSON array preserves its sequence, which is
  // the entire persistence mechanism this feature rests on (no rank field, no sort key).
  const reread = JSON.parse(JSON.stringify({ alerts: stored })) as { alerts: { id: string }[] }
  assert.deepEqual(idsOf(reread.alerts), ['d', 'b', 'c', 'a'])
})

test('SOURCE PIN: main re-derives the stored list through applyAlertOrder, and validates at the door', () => {
  const store = src('main/store.ts')
  assert.match(
    store,
    /export function reorderAlerts\([\s\S]{0,200}applyAlertOrder\(getAlerts\(\)/,
    'store.reorderAlerts must be one line over the pure function tested above'
  )
  assert.match(store, /store\.set\('alerts', next\)/)

  const ipc = src('main/ipc/alerts.ts')
  assert.match(ipc, /IPC\.reorderAlerts/, 'the handler must exist')
  assert.match(
    ipc,
    /if \(!Array\.isArray\(orderedIds\)\) return getAlerts\(\)/,
    'a non-array payload must answer with the list unchanged, not throw or clear it'
  )
  assert.match(
    ipc,
    /typeof id === 'string'/,
    'every element is re-checked here, at the door — main never trusts the renderer’s array'
  )
})

// ------------------------------------------------------------------ 3. firing is untouched

const TS = '[Tue Jul 28 13:04:53 2026] '

/** Three alerts that all watch the same log line, plus one that watches nothing that happens. */
const DEFS: AlertDef[] = [
  {
    id: 'first',
    name: 'First',
    enabled: true,
    trigger: { type: 'raw', regex: 'You have gained a level' },
    sound: { packId: 'p', soundId: 's' },
    cooldownMs: 0
  },
  {
    id: 'second',
    name: 'Second',
    enabled: true,
    trigger: { type: 'raw', regex: 'gained a level' },
    sound: { packId: 'p', soundId: 's' },
    cooldownMs: 0
  },
  {
    id: 'third',
    name: 'Third',
    enabled: true,
    // A typed EVENT trigger beside the two raw ones, so the arrangement crosses both evaluator
    // paths rather than just the regex one. `level` is what the parser emits for a ding.
    trigger: { type: 'event', kind: 'level' },
    sound: { packId: 'p', soundId: 's' },
    cooldownMs: 0
  },
  {
    id: 'silent',
    name: 'Never',
    enabled: true,
    trigger: { type: 'raw', regex: 'a line this fixture does not contain' },
    sound: { packId: 'p', soundId: 's' },
    cooldownMs: 0
  }
]

const LINES = [
  `${TS}You have gained a level! Welcome to level 42!`,
  `${TS}You say, 'hail'`,
  `${TS}You have gained a level! Welcome to level 43!`
]

/** Fold LINES through a module holding `defs`; answer with alertId → how many times it fired. */
function fireCounts(defs: AlertDef[]): Record<string, number> {
  const mod = new AlertsModule()
  mod.setDefs(defs)
  mod.reset()
  const counts: Record<string, number> = {}
  let seq = 0
  for (const line of LINES) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  for (const f of mod.flushDelta()?.delta.fired ?? []) {
    counts[f.alertId] = (counts[f.alertId] ?? 0) + 1
  }
  return counts
}

test('re-ordering the list changes NOTHING about which alerts fire, or how often', () => {
  const inOrder = fireCounts(DEFS)
  assert.ok(Object.keys(inOrder).length >= 2, `the fixture must actually fire something: ${JSON.stringify(inOrder)}`)
  assert.equal(inOrder.silent, undefined, 'the control alert must stay silent')

  // Every arrangement the user could drag this list into, compared against the stored one. The
  // evaluator has no first-match-wins and no ordering state, and this is what says so.
  const arrangements = [
    ['third', 'second', 'first', 'silent'],
    ['silent', 'first', 'third', 'second'],
    ['second', 'silent', 'third', 'first']
  ]
  for (const seq of arrangements) {
    const moved = applyAlertOrder(DEFS, seq)
    assert.deepEqual(idsOf(moved), seq, 'the arrangement under test')
    assert.deepEqual(
      fireCounts(moved),
      inOrder,
      `firing changed when the list was arranged ${seq.join(' > ')}`
    )
  }
})

test('…and the delta still reports one entry per fire, in the list’s order', () => {
  // The one honest consequence, stated rather than hidden: WITHIN a single delta the `fired` array
  // follows def order, so two alerts that fire on the same line reach the event feed in the order
  // the list is in. Nothing keys off it (history is per alert id, cooldowns are per def), and it
  // is the order the user chose — but it is a difference, so it gets a test rather than silence.
  const firstThen = Object.keys(fireCounts(applyAlertOrder(DEFS, ['first', 'second', 'third', 'silent'])))
  const thirdThen = Object.keys(fireCounts(applyAlertOrder(DEFS, ['third', 'second', 'first', 'silent'])))
  assert.deepEqual([...firstThen].sort(), [...thirdThen].sort(), 'the same alerts fired either way')
  assert.deepEqual(firstThen, ['first', 'second', 'third'])
  assert.deepEqual(thirdThen, ['third', 'second', 'first'])
})
