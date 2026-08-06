/**
 * ============================================================================
 * foldArm.mts — WHERE THE STARTUP FOLD GOES, microsecond by microsecond (JOS-55).
 * ============================================================================
 *
 * The measured fact this exists to break down: the parser alone folds the owner's 1.4M-event log
 * at ~565k events/sec (1.8 us/event) while the whole pipeline manages ~32k (31 us/event). About
 * 94% of a startup replay happens DOWNSTREAM of the parser, and until this file nothing said in
 * which consumer. `replay.bench.mts` prints the table this produces; JOS-56 bisects with it.
 *
 * WHY THIS FOLD RUNS IN THE BENCH'S OWN PROCESS, not in the app it launches.
 *   The instrumentation is a parameter — `registry.attach(bus, timer)` and `new LogBus(probe)` —
 *   for exactly the reason `replaySlicer.ts` states about its own seam: an environment variable
 *   that installs a per-event profiler on a real startup is a knob a support answer will
 *   eventually recommend. A parameter is visible to this file and to nobody else. But a parameter
 *   can only be passed by a caller in the same process, and the bench cannot reach inside the
 *   Electron app it launches. So the Electron arm stays exactly what it was (wall clock, duty,
 *   block probe, the budgets), and the ATTRIBUTION arm folds the same log here, through the same
 *   modules, in the same order.
 *
 * WHAT MAKES "THE SAME MODULES" TRUE RATHER THAN CLAIMED: `src/main/modules/wiring.ts` owns the
 *   construction and the registration order, and pipeline.ts — the app's composition root — is its
 *   other caller. A module added to the app is folded here without anyone remembering to update a
 *   list. The bus, the combat engine, the epoch and offline-gap detectors are wired below in the
 *   order pipeline.ts and index.ts wire them, and that order IS the delivery order.
 *
 * WHAT IS HONESTLY DIFFERENT, because a profiler that hides its own distortions is worthless:
 *   * No Electron. Same V8, same code, but no renderer, no IPC, no protocol handlers and no
 *     window competing for the main thread. The Electron arm's `events/sec folding` is printed
 *     beside this arm's rate so the two can be compared rather than confused.
 *   * No duty cycle (`unchunkedSlicer()`): this arm measures the fold's SPEED, not the throttle.
 *   * The two knowledge lookups (item, mob) are absent and the alert defs are empty. All three are
 *     LIVE-only paths — a historical replay never calls them — but say so rather than imply they
 *     were measured.
 *   * The user's learned message overlay lives in userData, which is Electron's to find; this arm
 *     seeds the miner with the committed baseline alone. It changes which cast messages the parser
 *     recognizes at the margin, not the shape of the fold.
 */
import { CombatEngine } from '../../src/main/combat/engine'
import { EpochDetector } from '../../src/main/log/epochDetector'
import { LogBus, type LogBusProbe, type LogEventListener } from '../../src/main/log/bus'
import { ModuleRegistry, type ModuleDispatchTimer } from '../../src/main/modules/registry'
import { SessionDetector } from '../../src/main/log/sessionDetector'
import { createModules } from '../../src/main/modules/wiring'
import { installCharacterName } from '../../src/main/log/rulesets'
import { MobLootIndex } from '../../src/main/mobLookupParse'
import { scanLog } from '../../src/main/log/scanHistory'
import { unchunkedSlicer } from '../../src/main/log/replaySlicer'
import baselineJson from '../../src/main/data/messageOverlay.baseline.json'
import type { MessageOverlay } from '../../src/shared/types'

/** The committed baseline overlay, imported directly — `data/overlayPersistence.ts` reaches for
 *  Electron's `app` to find the user's copy and cannot be imported outside it. */
const BASELINE = baselineJson as unknown as MessageOverlay

// ------------------------------------------------------------------------------ the accumulator

/** One row of the attribution table: a consumer, how many events it saw, what they cost it. */
export interface ConsumerCost {
  consumer: string
  events: number
  totalMs: number
}

/**
 * The whole instrument: a `ModuleDispatchTimer` for the registry and a `LogBusProbe` for the bus,
 * in one object because they share one fact — whether the events currently being delivered are
 * PRIMARY or a DERIVED drain.
 *
 * That flag is why the drain gets its own row instead of being an invisible surcharge on every
 * module's number. A derived event (`buffExpired`, `epoch`, `offlineGap`) travels the same
 * listener loop as a primary one, so without the bracket every consumer's total would silently
 * include work done on somebody else's behalf and the rows would not add up to the fold.
 *
 * Accumulators are plain arrays indexed by dispatch position: `note()` runs once per module per
 * event — 18 million times on this log — and an array add is a cost the measurement can afford
 * where a map lookup is a cost it would end up measuring.
 */
class FoldTimer implements ModuleDispatchTimer, LogBusProbe {
  private ids: readonly string[] = []
  private moduleMs: number[] = []
  /** Time modules spent on DERIVED events, kept apart so the rows stay disjoint. */
  private derivedModuleMs: number[] = []
  private inDerived = false
  /** Primary events dispatched to the modules (counted at position 0). */
  private primaryEvents = 0
  private derivedEvents = 0
  private derivedMs = 0
  /** The tail consumers (combat, epoch, offline-gap) — subscribed after the registry. */
  private tail = new Map<string, { primaryMs: number; derivedMs: number; events: number }>()

  begin(ids: readonly string[]): void {
    this.ids = ids
    this.moduleMs = ids.map(() => 0)
    this.derivedModuleMs = ids.map(() => 0)
  }

  note(index: number, ms: number): void {
    if (this.inDerived) {
      this.derivedModuleMs[index] = (this.derivedModuleMs[index] ?? 0) + ms
      return
    }
    if (index === 0) this.primaryEvents += 1
    this.moduleMs[index] = (this.moduleMs[index] ?? 0) + ms
  }

  start(): void {
    this.inDerived = true
  }

  end(count: number, ms: number): void {
    this.inDerived = false
    this.derivedEvents += count
    this.derivedMs += ms
  }

  /**
   * Wrap a bus listener so its time lands in a named row. Used for the three consumers that
   * subscribe AFTER the registry — the combat engine, the epoch detector and the offline-gap
   * detector — none of which the registry seam can see.
   *
   * The engine is ONE OPAQUE ROW on purpose (JOS-55): its internals are another ticket's subject
   * (JOS-52), and a bench that reached inside them would be measuring a moving target.
   */
  wrap(name: string, fn: LogEventListener): LogEventListener {
    this.tail.set(name, { primaryMs: 0, derivedMs: 0, events: 0 })
    const row = this.tail.get(name)
    return (ev, live) => {
      const t0 = performance.now()
      fn(ev, live)
      const dt = performance.now() - t0
      if (!row) return
      if (this.inDerived) row.derivedMs += dt
      else {
        row.primaryMs += dt
        row.events += 1
      }
    }
  }

  /**
   * The table's rows, PRIMARY work per consumer plus ONE row for the whole derived drain (every
   * consumer's work on derived events, summed — the drain is a shared cost and splitting it per
   * consumer would invite reading a 0.2% row as a finding).
   */
  rows(): ConsumerCost[] {
    const out: ConsumerCost[] = this.ids.map((id, i) => ({
      consumer: `module:${id}`,
      events: this.primaryEvents,
      totalMs: this.moduleMs[i] ?? 0
    }))
    for (const [name, row] of this.tail) {
      out.push({ consumer: name, events: row.events, totalMs: row.primaryMs })
    }
    out.push({
      consumer: 'derived-event drain',
      events: this.derivedEvents,
      totalMs: this.derivedMs
    })
    return out
  }
}

// ------------------------------------------------------------------------------------ the world

/**
 * Build the fold's consumers exactly as the app builds them: the module registry over
 * `createModules`' ordered list, then the combat engine (with the roster seam installed before it
 * ever folds a line), then the epoch and offline-gap detectors LAST — the order pipeline.ts and
 * index.ts subscribe them in, which is the order the bus delivers in.
 */
function buildWorld(character: { name: string; server: string; logPath: string }, timer?: FoldTimer): LogBus {
  const bus = new LogBus(timer)
  const modules = createModules({
    overlays: [BASELINE],
    // The shared own-loot index the consider module folds every loot event into. Electron-free,
    // and omitting it would skip a real per-event cost.
    ownLoot: new MobLootIndex(),
    emitDerived: (ev, live) => {
      bus.emitDerived(ev, live)
    }
  })
  const registry = new ModuleRegistry({ emitDelta: () => undefined })
  for (const mod of modules.ordered) registry.register(mod)
  registry.reset()
  modules.character.setCharacter(character)
  // Whose log this is — the self-`/who` rule can only fire once the parser knows the name, and
  // session.ts installs it before the replay for exactly that reason.
  installCharacterName(character.name)
  registry.attach(bus, timer)

  const combat = new CombatEngine()
  combat.setRoster(modules.roster)
  combat.reset()
  combat.setPlayerName(character.name)
  const epoch = new EpochDetector()
  const sessions = new SessionDetector()

  const ingest: LogEventListener = (ev, live) => {
    combat.ingestEvent(ev, live)
  }
  // The epoch and offline-gap subscriptions as index.ts writes them, minus the two things a
  // historical fold never does anyway: the boundary log line and the LIVE re-hydrate push.
  const observeEpoch: LogEventListener = (ev, live) => {
    if (ev.kind === 'epoch') return
    const epochEv = epoch.observe(ev)
    if (epochEv) bus.emitDerived(epochEv, live)
  }
  const observeSession: LogEventListener = (ev, live) => {
    if (ev.kind === 'offlineGap') return
    const gap = sessions.observe(ev)
    if (gap) bus.emitDerived(gap, live)
  }
  bus.subscribe(timer ? timer.wrap('combat engine', ingest) : ingest)
  bus.subscribe(timer ? timer.wrap('epoch detector', observeEpoch) : observeEpoch)
  bus.subscribe(timer ? timer.wrap('offline-gap detector', observeSession) : observeSession)
  return bus
}

// ------------------------------------------------------------------------------------- the arms

export interface FoldResult {
  events: number
  ms: number
  eventsPerSec: number
  /** Present only on the attributed arm. */
  rows?: ConsumerCost[]
}

const rate = (events: number, ms: number): number => (ms > 0 ? Math.round((events / ms) * 1000) : 0)

/**
 * THE COMPARATOR ARM: `scanLog` with NO subscribers — read, split, parse, emit to an empty
 * listener list. It replaces a throwaway script whose 565k events/sec number is quoted in
 * replay.bench.mts's own header and could not be reproduced from anything committed.
 *
 * It still builds the module world and throws it away, and that is not waste: `createModules`
 * installs the EFFECTIVE spell DB into the parser (spells.json + the message overlay), and a
 * parser configured differently is a different parser. The comparator has to be the same parse
 * the attributed arm performs, or the subtraction between them means nothing.
 */
export async function foldParseOnly(character: {
  name: string
  server: string
  logPath: string
}): Promise<FoldResult> {
  createModules({ overlays: [BASELINE] })
  installCharacterName(character.name)
  const bus = new LogBus()
  const t0 = performance.now()
  const res = await scanLog(character.logPath, bus, 0, { slicer: unchunkedSlicer() })
  const ms = performance.now() - t0
  return { events: res.seq, ms, eventsPerSec: rate(res.seq, ms) }
}

/**
 * THE FULL FOLD: every consumer the app subscribes, over the same bytes.
 *
 * `timed` installs the attribution seam. Both modes exist so the profiler's own cost can be
 * stated rather than assumed — the bench runs the untimed arm on both sides of the timed one and
 * prints the difference beside the table.
 *
 * `unchunkedSlicer()` throughout: the duty cycle is a decision about wall clock, and this arm is
 * about the code's speed. The Electron arm reports the throttled reality.
 */
export async function foldFull(
  character: { name: string; server: string; logPath: string },
  timed: boolean
): Promise<FoldResult> {
  const timer = timed ? new FoldTimer() : undefined
  const bus = buildWorld(character, timer)
  const t0 = performance.now()
  const res = await scanLog(character.logPath, bus, 0, { slicer: unchunkedSlicer() })
  const ms = performance.now() - t0
  return {
    events: res.seq,
    ms,
    eventsPerSec: rate(res.seq, ms),
    ...(timer ? { rows: timer.rows() } : {})
  }
}
