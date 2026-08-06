// JOS-60 — A HISTORICAL REPLAY MAY NOT PUSH A SINGLE DELTA, and what it accumulated is DISCARDED.
//
// THE DEFECT THIS PINS (owner, 2026-08-06: "switching back and forth between characters makes
// alerts fire over and over, along with the announcements overlay top-middle"). The registry had
// always been documented as folding replay events "silently" — but that only ever meant it did
// not SCHEDULE a flush for them. Modules accumulate their pending delta on every `onEvent`
// regardless of `live` (none of them looks at the flag), so a replay leaves a full delta sitting
// in every module, and two callers shipped it:
//
//   * `tick()` — session.ts's 1-second wall-clock heartbeat, whose interval belongs to the
//     character being LEFT and keeps firing straight through the next one's replay. On a real log
//     that is several ticks INSIDE the replay, each pushing a slab of another character's history;
//   * `flushNow()` at the end of `tailCharacter`, one statement before `log:character`.
//
// Either way the renderer received another character's whole history as an INCREMENT against the
// state it was still holding — and an increment is precisely what the always-mounted celebration
// detectors watch for (kills → boss fanfare, turn-ins → quest fanfare, leveling → ding cards).
//
// So the registry now brackets a replay: `beginReplay()` gates every push path, `endReplay()`
// DRAINS each module's pending delta and throws it away. Nothing is lost — a replay's whole
// product is in `snapshot()`, which `log:character` sends every consumer back to.
//
// This is the seam test: no Electron, no log file, one fake module that behaves exactly as the
// real ones do (accumulates on every event, live or not). The end-to-end proof — two characters
// in a staged EQ install, switched through the real IPC, asserting ZERO alert fires — is
// tests/e2e/character-switch.e2e.mts.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LogBus } from '../src/main/log/bus'
import { ModuleRegistry } from '../src/main/modules/registry'
import type { EqModule, ModuleDelta } from '../src/main/modules/types'
import type { LogEvent } from '../src/shared/logEvents'

/** A zone event with a given seq — the cheapest real LogEvent shape to drive a bus with. */
function zoneEvent(seq: number, zone: string): LogEvent {
  return { kind: 'zone', seq, ts: 1_700_000_000_000 + seq, raw: `[x] You have entered ${zone}.`, zone }
}

/**
 * A module with the SAME accumulation behaviour every shipped one has: it folds whatever it is
 * given and appends to `pending` without consulting `live`, because that is the fact the defect
 * rested on. `onTick` marks itself dirty so the heartbeat path can be observed too.
 */
class SpyModule implements EqModule<string[], { appended: string[] }> {
  readonly id = 'spy'
  private all: string[] = []
  private pending: string[] = []
  private seq = 0
  /** How many times `flushDelta()` was asked — a discard is a drain, and this proves it happened. */
  flushes = 0

  reset(): void {
    this.all = []
    this.pending = []
    this.seq = 0
  }

  onEvent(ev: LogEvent): void {
    this.seq = ev.seq
    if (ev.kind !== 'zone') return
    this.all.push(ev.zone)
    this.pending.push(ev.zone)
  }

  onTick(): void {
    this.pending.push('tick')
  }

  snapshot(): { seq: number; state: string[] } {
    return { seq: this.seq, state: [...this.all] }
  }

  flushDelta(): { seq: number; delta: { appended: string[] } } | null {
    this.flushes += 1
    if (this.pending.length === 0) return null
    const appended = this.pending
    this.pending = []
    return { seq: this.seq, delta: { appended } }
  }
}

/** A registry wired to a spy module and a recording host. */
function harness(): { registry: ModuleRegistry; bus: LogBus; mod: SpyModule; sent: ModuleDelta[] } {
  const sent: ModuleDelta[] = []
  const registry = new ModuleRegistry({
    emitDelta: (d) => {
      sent.push(d)
    }
  })
  const mod = new SpyModule()
  registry.register(mod)
  const bus = new LogBus()
  registry.attach(bus)
  return { registry, bus, mod, sent }
}

test('a replay pushes nothing — not on a heartbeat tick inside it, not on the flush that ends it', () => {
  const { registry, bus, sent } = harness()

  // The switch: reset every module, declare the replay, fold the whole target log as history.
  registry.reset()
  registry.beginReplay()
  bus.emit(zoneEvent(1, 'Nagafen’s Lair'), false)
  bus.emit(zoneEvent(2, 'Permafrost Keep'), false)

  // THE HEARTBEAT, mid-replay. This is the one that reached real users: the interval belongs to
  // the previous character and cannot be assumed to have stopped.
  registry.tick(Date.now())
  assert.equal(sent.length, 0, 'a heartbeat tick inside a replay must push nothing')

  bus.emit(zoneEvent(3, 'The Hole'), false)
  // …and an explicit flush inside the replay is the same mistake by a different caller.
  registry.flushNow()
  assert.equal(sent.length, 0, 'flushNow() inside a replay must push nothing')

  // The replay ends. Everything it folded is history; the renderer gets it from snapshot().
  registry.endReplay()
  assert.equal(sent.length, 0, 'ending a replay must push nothing')
  assert.deepEqual(
    registry.snapshot('spy'),
    { seq: 3, state: ['Nagafen’s Lair', 'Permafrost Keep', 'The Hole'] },
    'the snapshot still carries the whole replay — the discard is of the DELTA, never of the state'
  )
})

test('the discard is a DRAIN: the first live delta after a replay carries the live event alone', () => {
  const { registry, bus, mod, sent } = harness()

  registry.reset()
  registry.beginReplay()
  for (let i = 1; i <= 5; i++) bus.emit(zoneEvent(i, `Zone ${String(i)}`), false)
  registry.tick(Date.now())
  registry.endReplay()
  assert.ok(mod.flushes > 0, 'endReplay() must ask each module for its delta (and throw it away)')

  // The live tail takes over. What the renderer sees must be THIS event and nothing before it —
  // if the replay's pending list had merely been left in place, this delta would carry all six.
  bus.emit(zoneEvent(6, 'East Freeport'), true)
  registry.flushNow()
  assert.equal(sent.length, 1, 'exactly one delta for the one live event')
  assert.deepEqual(sent[0], {
    moduleId: 'spy',
    seq: 6,
    delta: { appended: ['East Freeport'] }
  })
})

test('a heartbeat tick outside a replay still ticks and still pushes (the deadline path is intact)', () => {
  const { registry, bus, mod, sent } = harness()

  registry.reset()
  registry.beginReplay()
  bus.emit(zoneEvent(1, 'Plane of Fear'), false)
  registry.endReplay()
  sent.length = 0

  // buffs' 15 s cast-landing timeout rides exactly this: an idle log, a wall clock that moves on.
  registry.tick(Date.now())
  assert.deepEqual(
    sent,
    [{ moduleId: 'spy', seq: 1, delta: { appended: ['tick'] } }],
    'once the replay is over, the heartbeat advances modules and pushes what changed'
  )
  assert.ok(mod.flushes > 0)
})

test('beginReplay is idempotent and cancels a flush the previous live tail had scheduled', async () => {
  const { registry, bus, sent } = harness()

  // A live event schedules a trailing flush ~100 ms out. A character switch that lands inside that
  // window must not let it fire against the world it is halfway through replacing.
  bus.emit(zoneEvent(1, 'East Commonlands'), true)
  registry.beginReplay()
  registry.beginReplay()
  registry.reset()
  bus.emit(zoneEvent(1, 'Plane of Hate'), false)
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(sent.length, 0, 'the previous tail’s scheduled flush must not fire during a replay')

  registry.endReplay()
  assert.equal(sent.length, 0)
})
