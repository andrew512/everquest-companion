// ============================================================================
// foldAttribution.test.mts — the bench's per-consumer timing seam (JOS-55).
// ============================================================================
//
// `npm run bench:replay` folds the startup log with a timer at the ModuleRegistry's dispatch seam
// and a probe on the LogBus's derived drain, and prints who spent the fold. Two properties make
// that table worth reading, and this file pins both.
//
//   1. THE INSTRUMENT DOES NOT CHANGE THE ANSWER. A timed dispatch must deliver exactly the same
//      events, in the same order, to the same modules as the plain one. The same argument
//      replayChunking.test.mts makes about a pause: a measurement that alters what it measures is
//      not a measurement. (Its COST is a different question, and the bench answers it by running
//      the fold with the instrument on and off — arms, not assertions.)
//   2. PRIMARY AND DERIVED WORK ARE TOLD APART. A derived event (`buffExpired`, `epoch`,
//      `offlineGap`) travels the SAME listener loop as a primary one, so without the bus's
//      bracket every module's total would quietly include work done on somebody else's behalf and
//      the table's rows would not add up to the fold. The bracket is what makes "derived drain" a
//      row instead of an invisible surcharge.
//
// And the third property, which is structural rather than testable: with no timer and no probe
// the app subscribes the closure it always subscribed and reads no clock at all. There is no
// environment variable behind either seam — see replaySlicer.ts for why that is the law here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LogBus, type LogBusProbe } from '../src/main/log/bus'
import { ModuleRegistry, type ModuleDispatchTimer } from '../src/main/modules/registry'
import { parseEvent } from '../src/main/log/parser'
import type { EqModule } from '../src/main/modules/types'
import type { LogEvent } from '../src/shared/logEvents'

const LINE = (n: number): string =>
  `[Mon Aug 04 12:00:${String(n % 60).padStart(2, '0')} 2026] You have become better at Testing! (${String(n)})`

function events(count: number): LogEvent[] {
  const out: LogEvent[] = []
  for (let i = 0; i < count; i++) {
    const ev = parseEvent(LINE(i), i)
    assert.ok(ev, 'the fixture line parses')
    out.push(ev)
  }
  return out
}

/** A module that records what it was handed, and optionally hands a derived event back. */
class SpyModule implements EqModule {
  seen: string[] = []
  constructor(
    readonly id: string,
    private derive?: (ev: LogEvent) => void
  ) {}
  reset(): void {
    this.seen = []
  }
  onEvent(ev: LogEvent, live: boolean): void {
    this.seen.push(`${ev.kind}:${String(ev.seq)}:${String(live)}`)
    this.derive?.(ev)
  }
  snapshot(): { seq: number; state: unknown } {
    return { seq: this.seen.length, state: null }
  }
  flushDelta(): null {
    return null
  }
}

/** The bench's accumulator, in miniature: totals per module, and the primary/derived split. */
class RecordingTimer implements ModuleDispatchTimer, LogBusProbe {
  ids: readonly string[] = []
  notes: { index: number; derived: boolean }[] = []
  drains: number[] = []
  private inDerived = false
  begin(ids: readonly string[]): void {
    this.ids = ids
  }
  note(index: number, ms: number): void {
    assert.ok(ms >= 0, 'a measured interval is never negative')
    this.notes.push({ index, derived: this.inDerived })
  }
  start(): void {
    this.inDerived = true
  }
  end(count: number): void {
    this.inDerived = false
    this.drains.push(count)
  }
}

function wire(bus: LogBus, mods: EqModule[], timer?: ModuleDispatchTimer): void {
  const registry = new ModuleRegistry({ emitDelta: () => undefined })
  for (const m of mods) registry.register(m)
  registry.attach(bus, timer)
}

test('THE TIMED DISPATCH DELIVERS EXACTLY WHAT THE PLAIN ONE DOES — the instrument is not in the fold', () => {
  const evs = events(50)

  const plainBus = new LogBus()
  const plain = [new SpyModule('a'), new SpyModule('b'), new SpyModule('c')]
  wire(plainBus, plain)
  for (const ev of evs) plainBus.emit(ev, false)

  const timer = new RecordingTimer()
  const timedBus = new LogBus(timer)
  const timed = [new SpyModule('a'), new SpyModule('b'), new SpyModule('c')]
  wire(timedBus, timed, timer)
  for (const ev of evs) timedBus.emit(ev, false)

  for (let i = 0; i < plain.length; i++) {
    assert.deepEqual(timed[i]?.seen, plain[i]?.seen, `module ${String(i)} folded the same stream`)
    assert.equal(plain[i]?.seen.length, evs.length)
  }
  assert.deepEqual(timer.ids, ['a', 'b', 'c'], 'the timer is told the dispatch order, once')
  assert.equal(timer.notes.length, evs.length * 3, 'one note per module per event')
  assert.equal(
    timer.notes.every((n) => !n.derived),
    true,
    'and none of it is charged to a derived drain that never happened'
  )
  assert.deepEqual(timer.drains, [], 'a fold with nothing derived brackets nothing')
})

test('the derived drain is BRACKETED, so primary and derived work are told apart', () => {
  const evs = events(4)
  const timer = new RecordingTimer()
  const bus = new LogBus(timer)
  // The buffs module's shape, in miniature: while folding a primary event it synthesizes a
  // RESOLVED one and hands it back. The bus queues it and drains it after the primary event has
  // finished reaching every listener.
  let derivedOnce = false
  const deriver = new SpyModule('deriver', (ev) => {
    if (derivedOnce) return
    derivedOnce = true
    bus.emitDerived({ ...ev, seq: 999 }, false)
  })
  const plainMod = new SpyModule('plain')
  wire(bus, [deriver, plainMod], timer)
  for (const ev of evs) bus.emit(ev, false)

  assert.deepEqual(timer.drains, [1], 'exactly one drain, carrying exactly the one derived event')
  assert.equal(plainMod.seen.length, evs.length + 1, 'every module folds the derived event too')
  const derivedNotes = timer.notes.filter((n) => n.derived)
  assert.equal(derivedNotes.length, 2, 'both modules charged the derived event, and only it')
  assert.equal(
    timer.notes.length - derivedNotes.length,
    evs.length * 2,
    'the primary buckets are untouched by the drain'
  )
  // The load-bearing property: without the bracket those two notes would be indistinguishable
  // from primary work and the "derived drain" row would be a guess.
  assert.equal(plainMod.seen.includes('skillUp:999:false'), true, 'the derived event really arrived')
})

test('a bus with no probe and a registry with no timer behave exactly as they always did', () => {
  const evs = events(3)
  const bus = new LogBus()
  let derivedOnce = false
  const deriver = new SpyModule('deriver', (ev) => {
    if (derivedOnce) return
    derivedOnce = true
    bus.emitDerived({ ...ev, seq: 42 }, false)
  })
  const plainMod = new SpyModule('plain')
  wire(bus, [deriver, plainMod])
  for (const ev of evs) bus.emit(ev, false)
  assert.equal(plainMod.seen.length, evs.length + 1, 'the drain still runs with nobody watching it')
  // …and in the same PLACE: right after the primary event that queued it, never at the end.
  assert.equal(plainMod.seen[1], 'skillUp:42:false')
})
