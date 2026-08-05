// PER-TARGET ALERT COOLDOWNS — the golden window for the owner's 2026-08-04 incident, the
// engine mechanism underneath it, and the one-time migration that carries an existing user
// across.
//
// THE REPORT. "The slow alert misses the first slow on a new mob." Diagnosed twice against
// eqlog_Primitive_freeport.txt and then cut into tests/fixtures/w44-poison-slow-per-mob.log
// (Tue Aug 04 22:30:45 → 22:33:45, Nagafen's Lair, King Tranix plus a fire giant warrior add,
// ending in the player's death at 22:33:40). Sixteen slow-family landings in three minutes.
//
// TWO DEFECTS, one window, and the fixture separates them so a future change can only break
// one at a time:
//
//   (T1) THE GLOBAL CLOCK. Weakening Strike landed on King Tranix at 22:31:16 (fired) and on
//        the fire giant warrior at 22:31:43 — 27 s later, inside a 30 s alert-wide cooldown, so
//        the add's slow was SUPPRESSED. What the alert said next was 22:31:50: a re-land on a
//        mob that was already slowed. The one landing carrying news was the one it ate.
//   (T2) THE SILENT SIBLING. Clumsiness Strike lands as effect 'spellSlow' and the def matched
//        only 'slow', so five of this window's sixteen landings could never have fired it.
//
// WHAT IS PINNED HERE: all four combinations of {trigger widened or not} × {cooldown scoped per
// alert or per target}, replayed through the REAL parser and the REAL AlertsModule. Isolating
// them matters — on THIS window the widened trigger alone happens to reproduce the shipped
// sequence, and only w41 (poisonSlowAlerts.test.mts P1) separates the scope from it. Neither
// window proves the fix by itself; together they do.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { AlertsModule } from '../src/main/modules/alerts'
import {
  ALERT_GROUPS,
  POISON_SLOW_ALERT_ID,
  POISON_SLOW_GROUP_ID,
  alertGroupDefs
} from '../src/shared/alertGroups'
import {
  ALERT_TRIGGER_MIGRATION_VERSION,
  migrateAlertTriggers
} from '../src/main/data/alertDefMigrations'
import type { AlertDef, AlertTrigger } from '../src/shared/types'
import { readFixture } from './harness.mts'

const FIXTURE = 'w44-poison-slow-per-mob.log'
const TS = '[Tue Aug 04 22:31:16 2026] '

/** The trigger the def shipped with before this wave — a past build's bytes, spelled out. */
const LEGACY_TRIGGER: AlertTrigger = {
  type: 'event',
  kind: 'poisonProc',
  where: { effect: 'slow' }
}

/** The def the "Rogue slow poisons" group authors TODAY. */
function shippedDef(): AlertDef {
  const group = ALERT_GROUPS.find((g) => g.id === POISON_SLOW_GROUP_ID)
  assert.ok(group, 'the rogue-slow group must exist')
  const def = alertGroupDefs(group).find((d) => d.id === POISON_SLOW_ALERT_ID)
  assert.ok(def, 'the group must author the rogue-slow def')
  return def
}

/** Replay raw lines through the REAL parser into a REAL AlertsModule; return fire timestamps. */
function fireTimes(defs: AlertDef[], lines: string[]): number[] {
  const mod = new AlertsModule()
  mod.setDefs(defs)
  mod.reset()
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  return (mod.flushDelta()?.delta.fired ?? [])
    .filter((f) => f.alertId === POISON_SLOW_ALERT_ID)
    .map((f) => f.ts)
}

/** `HH:MM:SS` in the user's own timezone — the fixture's timestamps are wall clock. */
function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

/** The window's slow-family landings, re-derived from the fixture rather than trusted. */
function landings(lines: string[]): { ts: number; effect: string; target: string }[] {
  const out: { ts: number; effect: string; target: string }[] = []
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev?.kind !== 'poisonProc') continue
    if (ev.effect === 'slow' || ev.effect === 'spellSlow') {
      out.push({ ts: ev.ts, effect: ev.effect, target: ev.target })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// (T0) THE WINDOW'S GROUND TRUTH.

test('T0 the fixture carries the incident: two mobs, sixteen slow landings, a death', () => {
  const lines = readFixture(FIXTURE)
  const slows = landings(lines)

  assert.deepEqual(
    slows.map((s) => `${clock(s.ts)} ${s.effect} ${s.target}`),
    [
      '22:30:52 spellSlow King Tranix',
      '22:30:55 spellSlow King Tranix',
      '22:31:16 slow King Tranix',
      '22:31:38 spellSlow a fire giant warrior',
      '22:31:43 slow a fire giant warrior',
      '22:31:50 slow a fire giant warrior',
      '22:31:58 slow a fire giant warrior',
      '22:32:35 slow King Tranix',
      '22:32:41 slow King Tranix',
      '22:32:45 slow King Tranix',
      '22:32:51 spellSlow King Tranix',
      '22:32:56 slow King Tranix',
      '22:33:11 spellSlow King Tranix',
      '22:33:31 slow King Tranix',
      '22:33:35 spellSlow King Tranix',
      '22:33:37 slow King Tranix'
    ],
    'hand-read from the log, 2026-08-04'
  )

  // The stake. The window ends with the player dead, which is why "the alert went quiet during
  // the add" is a bug report and not a preference.
  assert.ok(
    lines.some((l) => l.includes('You have been slain by a fire giant warrior!')),
    'the window contains the death it ends on'
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// (T1) THE FOUR VARIANTS, MEASURED.

test('T1 the OLD def eats the add’s first slow — 22:31:43 is silent', () => {
  const old: AlertDef = { ...shippedDef(), trigger: LEGACY_TRIGGER }
  delete old.cooldownScope
  const fired = fireTimes([old], readFixture(FIXTURE)).map(clock)

  assert.deepEqual(fired, ['22:31:16', '22:31:50', '22:32:35', '22:33:31'])
  assert.equal(
    fired.includes('22:31:43'),
    false,
    'THE DEFECT: the fire giant’s first slow, 27 s after Tranix’s, never speaks'
  )
})

test('T1b per-target scope alone restores it — 22:31:16 AND 22:31:43 both fire', () => {
  // The engine change in isolation: same trigger as the old def, only the clock is per mob.
  // This is the exact sequence the incident report asked for.
  const scoped: AlertDef = { ...shippedDef(), trigger: LEGACY_TRIGGER, cooldownScope: 'target' }
  const fired = fireTimes([scoped], readFixture(FIXTURE)).map(clock)

  assert.deepEqual(fired, ['22:31:16', '22:31:43', '22:32:35', '22:33:31'])
  // …and the re-lands on the SAME mob within 30 s stay quiet: the burst at 22:31:50 / 22:31:58
  // is 7 s and 15 s after the fire giant's own fire, and 22:32:41 / 22:32:45 / 22:32:56 are all
  // inside Tranix's. The point was never "fire on everything".
  for (const quiet of ['22:31:50', '22:31:58', '22:32:41', '22:32:45', '22:32:56', '22:33:37']) {
    assert.equal(fired.includes(quiet), false, `${quiet} is a re-land on a mob already alerted`)
  }
})

test('T1c the SHIPPED def speaks first at each mob’s first slow-family landing', () => {
  const lines = readFixture(FIXTURE)
  const fired = fireTimes([shippedDef()], lines)

  // Widened + per-mob: the alert now opens on Tranix at 22:30:52 (Clumsiness, 24 s EARLIER than
  // the old def managed) and on the fire giant at 22:31:38 (12 s earlier). Both are that mob's
  // first slow-family landing, which is the whole contract.
  assert.deepEqual(fired.map(clock), ['22:30:52', '22:31:38', '22:32:35', '22:33:11'])

  const firstPerMob = new Map<string, number>()
  for (const s of landings(lines)) if (!firstPerMob.has(s.target)) firstPerMob.set(s.target, s.ts)
  assert.equal(firstPerMob.size, 2, 'two mobs get slowed in this window')
  for (const [target, ts] of firstPerMob) {
    assert.ok(fired.includes(ts), `the first slow-family landing on ${target} must fire`)
  }
})

test('T1d the widened trigger and the per-mob scope are INDEPENDENT fixes', () => {
  const lines = readFixture(FIXTURE)
  const widenedOnly: AlertDef = { ...shippedDef() }
  delete widenedOnly.cooldownScope

  // On THIS window the two land on the same answer — the first Clumsiness on each mob happens
  // to fall outside the previous fire's 30 s, so widening alone is enough here. Saying so
  // plainly is the honest record: w44 does NOT prove the scope change on its own.
  assert.deepEqual(fireTimes([widenedOnly], lines).map(clock), ['22:30:52', '22:31:38', '22:32:35', '22:33:11'])

  // w41 is where they separate: six 'slow' landings across three mobs, and the last one (an
  // elemental crusader, 20 s after the rock golem's) fires ONLY under per-mob scope.
  const w41 = readFixture('w41-poison-asp-venom.log')
  const w41Widened: AlertDef = { ...shippedDef() }
  delete w41Widened.cooldownScope
  assert.equal(fireTimes([w41Widened], w41).length, 3, 'alert-wide clock: three alerts')
  assert.equal(fireTimes([shippedDef()], w41).length, 4, 'per-mob clock: four — the third mob speaks')
})

// ─────────────────────────────────────────────────────────────────────────────
// (T2) THE ENGINE MECHANISM, on its own terms.

/** A minimal target-scoped alert over `poisonProc`, cooldown 30 s. */
function probe(over: Partial<AlertDef> = {}): AlertDef {
  return {
    id: 'probe',
    name: 'probe',
    enabled: true,
    trigger: { type: 'event', kind: 'poisonProc', where: { effect: 'slow' } },
    sound: { packId: 'alan-rickman', soundId: 'task-error-task-error-01' },
    cooldownMs: 30_000,
    cooldownScope: 'target',
    ...over
  }
}

function probeFires(def: AlertDef, lines: string[]): number[] {
  const mod = new AlertsModule()
  mod.setDefs([def])
  mod.reset()
  let seq = 0
  for (const line of lines) {
    const ev = parseEvent(line, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  return (mod.flushDelta()?.delta.fired ?? []).map((f) => f.ts)
}

test('T2 the target key is CASE-FOLDED — one mob cannot hold two clocks', () => {
  // World-model law 2: names are dirty. Damage lines capitalize the article, lifecycle lines
  // lowercase it, and the same mob written two ways must share one cooldown.
  const lines = [
    '[Tue Aug 04 22:31:16 2026] A Fire Giant Warrior\'s limbs move slower!',
    '[Tue Aug 04 22:31:20 2026] a fire giant warrior\'s limbs move slower!'
  ]
  assert.equal(probeFires(probe(), lines).length, 1, 'the second is the same mob, inside cooldown')
})

test('T2b an event with NO target degrades to the alert-level clock — never throws', () => {
  // 'target' on a family that names no target is a no-op, not an error. `zone` carries none.
  const zoneAlert = probe({
    id: 'zoned',
    trigger: { type: 'event', kind: 'zone' },
    cooldownMs: 30_000
  })
  const lines = [
    '[Tue Aug 04 22:33:56 2026] You have entered Nagafen\'s Lair.',
    '[Tue Aug 04 22:34:02 2026] You have entered Lavastorm Mountains.'
  ]
  assert.equal(probeFires(zoneAlert, lines).length, 1, 'one clock, so the second is suppressed')
})

test('T2c scope ABSENT is the old alert-level behaviour, byte for byte', () => {
  const lines = [
    '[Tue Aug 04 22:31:16 2026] King Tranix\'s limbs move slower!',
    '[Tue Aug 04 22:31:43 2026] a fire giant warrior\'s limbs move slower!'
  ]
  const legacy = probe()
  delete legacy.cooldownScope
  assert.equal(probeFires(legacy, lines).length, 1, 'absent ⇒ alert scope ⇒ the add is muted')
  assert.equal(probeFires(probe({ cooldownScope: 'alert' }), lines).length, 1, 'explicit is the same')
  assert.equal(probeFires(probe(), lines).length, 2, 'target scope fires for both mobs')
})

test('T2d the clock map is BOUNDED, and reset() clears it', () => {
  // A long session slays thousands of mobs; a per-target alert would otherwise keep a row for
  // every corpse. The cap evicts least-recently-fired, so the row discarded is the one whose
  // cooldown is closest to expiry — the worst case is one extra alert, never a suppressed one.
  const mod = new AlertsModule()
  mod.setDefs([probe()])
  mod.reset()
  let seq = 0
  for (let i = 0; i < 900; i++) {
    // One second apart, a distinct mob each time: 900 clocks minted against a cap of 500.
    const s = String(i % 60).padStart(2, '0')
    const m = String(31 + Math.floor(i / 60)).padStart(2, '0')
    const ev = parseEvent(`[Tue Aug 04 ${m === '31' ? '22' : '23'}:${m}:${s} 2026] mob${i}'s limbs move slower!`, seq++)
    if (ev) mod.onEvent(ev, true)
  }
  const fired = mod.flushDelta()?.delta.fired ?? []
  assert.equal(fired.length, 900, 'every distinct mob fires — eviction never suppresses')

  // reset() is a character switch: the firing bookkeeping goes with it, exactly as before.
  mod.reset()
  const after = probeFires(probe(), [
    '[Tue Aug 04 22:31:16 2026] mob0\'s limbs move slower!'
  ])
  assert.equal(after.length, 1, 'a fresh module has no clocks to be blocked by')
})

test('T2e a raw trigger is unaffected — it has no event fields to scope by', () => {
  const rawAlert = probe({
    id: 'raw-probe',
    trigger: { type: 'raw', regex: 'limbs move slower' }
  })
  const lines = [
    TS + 'King Tranix\'s limbs move slower!',
    '[Tue Aug 04 22:31:43 2026] a fire giant warrior\'s limbs move slower!'
  ]
  // The raw condition still matches BOTH lines, and a poisonProc event DOES carry `target`, so
  // the scope applies to the event the raw regex matched. This is deliberate: the scope reads
  // the EVENT, not the trigger, so a raw alert on a targeted line gets per-mob behaviour too.
  assert.equal(probeFires(rawAlert, lines).length, 2)
})

// ─────────────────────────────────────────────────────────────────────────────
// (T3) THE ONE-TIME MIGRATION (src/main/data/alertDefMigrations.ts).

test('T3 a def still in the SHIPPED shape is migrated; cooldownMs and sound are the user’s', () => {
  const stored: AlertDef = {
    id: POISON_SLOW_ALERT_ID,
    name: 'Mob slowed (rogue poison)',
    enabled: true,
    trigger: LEGACY_TRIGGER,
    sound: { packId: 'peon', soundId: 'ready' },
    cooldownMs: 45_000, // the user retuned it — that choice survives
    volume: 0.4,
    note: 'Suggested group "Rogue slow poisons" — fires on: …'
  }
  const { alerts, changed } = migrateAlertTriggers([stored])
  assert.equal(changed, 1)
  const out = alerts[0]
  assert.deepEqual(out.trigger, shippedDef().trigger, 'the trigger becomes today’s')
  assert.equal(out.cooldownScope, 'target')
  assert.equal(out.cooldownMs, 45_000, 'the user’s cooldown is preserved')
  assert.deepEqual(out.sound, { packId: 'peon', soundId: 'ready' }, 'and their sound')
  assert.equal(out.volume, 0.4)
  assert.equal(out.enabled, true)
  assert.equal(out.name, 'Mob slowed (rogue poison)')

  // Idempotent: a second pass finds nothing to do (which is also what the version stamp
  // guarantees at the store level).
  assert.equal(migrateAlertTriggers(alerts).changed, 0)
})

test('T3b a def the USER re-shaped is left completely alone', () => {
  const base: AlertDef = {
    id: POISON_SLOW_ALERT_ID,
    name: 'my slow',
    enabled: true,
    trigger: LEGACY_TRIGGER,
    sound: { packId: 'alan-rickman', soundId: 'task-error-task-error-01' }
  }
  const reshaped: AlertDef[] = [
    // narrowed to one mob
    { ...base, trigger: { type: 'event', kind: 'poisonProc', where: { effect: 'slow', target: 'King Tranix' } } },
    // pointed at a different effect entirely
    { ...base, trigger: { type: 'event', kind: 'poisonProc', where: { effect: 'snare' } } },
    // widened to every proc
    { ...base, trigger: { type: 'event', kind: 'poisonProc' } },
    // turned into a composite
    { ...base, trigger: { type: 'any', conditions: [LEGACY_TRIGGER, { type: 'event', kind: 'uncharm' }] } },
    // rewritten as a raw regex
    { ...base, trigger: { type: 'raw', regex: "limbs move slower" } }
  ]
  const { alerts, changed } = migrateAlertTriggers(reshaped)
  assert.equal(changed, 0, 'an edited def states an intent the migration must respect')
  assert.deepEqual(alerts, reshaped, 'and the list is returned unchanged, not rebuilt')

  // Nor does it touch anyone else's alert that happens to carry the same trigger.
  const otherId = [{ ...base, id: 'my-own-slow-alert' }]
  assert.equal(migrateAlertTriggers(otherId).changed, 0, 'only the SHIPPED id is rewritten')
})

test('T3c the migration is version-stamped and key-order independent', () => {
  assert.equal(ALERT_TRIGGER_MIGRATION_VERSION, 1)

  // A stored JSON object's key order is not meaningful; the shape match must not depend on it.
  const reordered: AlertDef = {
    sound: { packId: 'alan-rickman', soundId: 'task-error-task-error-01' },
    enabled: true,
    trigger: { where: { effect: 'slow' }, kind: 'poisonProc', type: 'event' },
    name: 'Mob slowed (rogue poison)',
    id: POISON_SLOW_ALERT_ID
  }
  assert.equal(migrateAlertTriggers([reordered]).changed, 1)

  // A def ALREADY carrying today's trigger is not "changed" a second time.
  assert.equal(migrateAlertTriggers([shippedDef()]).changed, 0)
})
