/**
 * ============================================================================
 * attribution.mts — the table that says where every fold microsecond goes (JOS-55).
 * ============================================================================
 *
 * `foldArm.mts` folds the log; this file decides what a run of it consists of and how the result
 * is read out. Five arms over one warm-up, in this order, and the order is the design:
 *
 *   0. A page-cache warm-up read, so the first timed arm is not the one charged for a cold 109 MB.
 *   1. PARSE ONLY, BARE — `scanLog` with no subscribers AND no spell DB. What the deleted
 *                        throwaway behind the "565k events/sec" claim in replay.bench.mts's header
 *                        almost certainly measured, now reproducible from something committed.
 *   2. PARSE ONLY, APP  — the same, with the spell DB the app installs. The honest comparator for
 *                        the fold: a parser configured differently is a different parser. The gap
 *                        between arms 1 and 2 is what the message-driven buff matching costs, and
 *                        it is charged before any consumer sees a single event.
 *   3. FOLD, TIMING OFF — every consumer, no instrument. The honest denominator.
 *   4. FOLD, TIMING ON  — the same, with the registry/bus seam installed. The table's source.
 *   5. FOLD, TIMING OFF again.
 *
 * ARM 5 IS THE POINT OF ARM 3. A profiler that distorts what it measures has to say so, and a
 * single before/after pair cannot tell "the instrument cost 3%" from "the machine was 3% busier".
 * Bracketing the timed arm with two untimed ones gives the overhead figure a noise floor to be
 * bigger than: if the two untimed runs disagree by more than the overhead they were supposed to
 * expose, the printout says the overhead is UNRESOLVED rather than quoting a number the run
 * cannot support.
 *
 * WHY THE CLOCK IS READ THE WAY IT IS. Thirteen modules times 1.4M events is 18 million
 * dispatches; two `performance.now()` calls around each would be 36 million clock reads. The
 * registry's timed loop instead reads the clock ONCE between consecutive modules (N+1 per event)
 * and differences the readings, which halves that. Whether even the halved version distorts the
 * fold is not an argument to have — it is arms 3/4/5, printed.
 */
import { foldFull, foldParseOnly, foldSections, warmPageCache, type ConsumerCost, type SectionCost } from './foldArm.mjs'

/** A consumer's row, with the two derived figures the table renders. */
export interface AttributedConsumer extends ConsumerCost {
  usPerEvent: number
  pctOfFold: number
}

/** One attribution run — every number that lands in the ledger line and the printed table. */
export interface AttributionRun {
  /** Events folded. The same bytes as the Electron arm, parsed by the same parser. */
  events: number
  /** Parse with the spell DB the app installs — the honest comparator for the fold below. */
  parseOnlyMs: number
  parseOnlyEventsPerSec: number
  /** Parse with NO spell DB and no character name — the bare parser, and almost certainly what
   *  the deleted throwaway's 565k events/sec measured. */
  bareParseMs: number
  bareParseEventsPerSec: number
  /** The two untimed folds, in run order (ms). */
  untimedMs: [number, number]
  /** Their mean — the fold's speed with no instrument attached. */
  foldMs: number
  foldEventsPerSec: number
  /** How far apart the two untimed folds were, as a fraction of their mean: the noise floor. */
  untimedSpread: number
  timedFoldMs: number
  timedEventsPerSec: number
  /** What the instrument cost, as a fraction of the untimed fold. Negative means the timed arm
   *  came in FASTER than the untimed mean, which happens and is reported as measured. */
  timingOverhead: number
  /** True when |timingOverhead| is inside the untimed spread — the run cannot separate them. */
  overheadUnresolved: boolean
  consumers: AttributedConsumer[]
  /**
   * WHERE THE COMBAT ENGINE'S OWN MICROSECONDS GO (JOS-59) — its own arm (see foldSections), so
   * the table above keeps meaning what it meant. `engineMs` is the sum of the sections, i.e. the
   * whole of `ingestEvent` as measured WITHOUT the registry timer attached; comparing it with the
   * `combat engine` consumer row is the cross-check that the two instruments agree.
   */
  engineSections: SectionCost[]
  engineMs: number
  /** That arm's own untimed-equivalent fold time, so the sections have a denominator of their
   *  own rather than borrowing the timed arm's. */
  sectionArmMs: number
  /** Fold time no consumer claimed: reading, line splitting, parsing, bus dispatch — and the
   *  instrument itself, which is measured but not attributable to anyone it measures. */
  unattributedMs: number
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`
const num = (n: number): string => n.toLocaleString('en-US')

/**
 * Run every arm. Sequential and single-threaded on purpose: two folds racing on one machine
 * measure the scheduler.
 */
export async function runAttribution(character: {
  name: string
  server: string
  logPath: string
}): Promise<AttributionRun> {
  await warmPageCache(character.logPath)
  const bare = await foldParseOnly(character, { spellDb: false })
  const parse = await foldParseOnly(character, { spellDb: true })
  const untimedA = await foldFull(character, false)
  const timed = await foldFull(character, true)
  const untimedB = await foldFull(character, false)
  const sectioned = await foldSections(character)

  const events = timed.events
  const foldMs = (untimedA.ms + untimedB.ms) / 2
  const untimedSpread = foldMs > 0 ? Math.abs(untimedA.ms - untimedB.ms) / foldMs : 0
  const timingOverhead = foldMs > 0 ? (timed.ms - foldMs) / foldMs : 0
  const rows = timed.rows ?? []
  const attributed = rows.reduce((sum, r) => sum + r.totalMs, 0)
  return {
    events,
    parseOnlyMs: parse.ms,
    parseOnlyEventsPerSec: parse.eventsPerSec,
    bareParseMs: bare.ms,
    bareParseEventsPerSec: bare.eventsPerSec,
    untimedMs: [untimedA.ms, untimedB.ms],
    foldMs,
    foldEventsPerSec: foldMs > 0 ? Math.round((events / foldMs) * 1000) : 0,
    untimedSpread,
    timedFoldMs: timed.ms,
    timedEventsPerSec: timed.eventsPerSec,
    timingOverhead,
    overheadUnresolved: Math.abs(timingOverhead) <= untimedSpread,
    consumers: rows
      .map((r) => ({
        ...r,
        usPerEvent: r.events > 0 ? (r.totalMs * 1000) / r.events : 0,
        pctOfFold: timed.ms > 0 ? r.totalMs / timed.ms : 0
      }))
      .sort((a, b) => b.totalMs - a.totalMs),
    unattributedMs: Math.max(0, timed.ms - attributed),
    engineSections: [...(sectioned.sections ?? [])].sort((a, b) => b.totalMs - a.totalMs),
    engineMs: (sectioned.sections ?? []).reduce((sum, s) => sum + s.totalMs, 0),
    sectionArmMs: sectioned.ms
  }
}

/** One table row, already formatted. */
function row(cells: { name: string; events: number; ms: number; share: number }): string {
  const us = ((cells.ms * 1000) / Math.max(1, cells.events)).toFixed(2)
  return (
    `  ${cells.name.padEnd(24)}${num(cells.events).padStart(11)}` +
    `${num(Math.round(cells.ms)).padStart(11)}${us.padStart(11)}${pct(cells.share).padStart(11)}`
  )
}

/**
 * Print the table, sorted by cost. The parse-only arm is printed BESIDE it rather than as a row:
 * it is a different fold of the same bytes, and quoting it in the same column as a consumer's
 * share would invite adding it to the total it is a comparator for.
 */
export function printAttribution(run: AttributionRun): void {
  console.log('')
  console.log(`  ATTRIBUTION — in-process fold, ${num(run.events)} events (no Electron; see foldArm.mts)`)
  console.log('')
  console.log(
    `  ${'consumer'.padEnd(24)}${'events'.padStart(11)}${'total ms'.padStart(11)}${'us/event'.padStart(11)}${'% of fold'.padStart(11)}`
  )
  for (const c of run.consumers) {
    console.log(row({ name: c.consumer, events: c.events, ms: c.totalMs, share: c.pctOfFold }))
  }
  console.log(
    row({
      name: 'unattributed',
      events: run.events,
      ms: run.unattributedMs,
      share: run.timedFoldMs > 0 ? run.unattributedMs / run.timedFoldMs : 0
    })
  )
  console.log('  ' + '-'.repeat(68))
  console.log(
    row({ name: 'fold total (timed)', events: run.events, ms: run.timedFoldMs, share: 1 })
  )
  console.log('')
  console.log(
    `  unattributed = read + line split + parseEvent + bus dispatch + the instrument itself.`
  )
  const us = (ms: number): string => ((ms * 1000) / Math.max(1, run.events)).toFixed(2)
  console.log(
    `  parse only, APP parser:      ${num(Math.round(run.parseOnlyMs))} ms — ${num(run.parseOnlyEventsPerSec)} events/sec, ${us(run.parseOnlyMs)} us/event  (the spell DB installed, as the app installs it)`
  )
  console.log(
    `  parse only, BARE parser:     ${num(Math.round(run.bareParseMs))} ms — ${num(run.bareParseEventsPerSec)} events/sec, ${us(run.bareParseMs)} us/event  (no spell DB, no character name)`
  )
  console.log(
    `  …so the spell DB costs       ${num(Math.round(run.parseOnlyMs - run.bareParseMs))} ms — ${us(run.parseOnlyMs - run.bareParseMs)} us/event — inside the parser, before any consumer sees the event.`
  )
  console.log(
    `  fold, timing OFF:            ${num(Math.round(run.foldMs))} ms — ${num(run.foldEventsPerSec)} events/sec` +
      ` (two runs: ${num(Math.round(run.untimedMs[0]))} / ${num(Math.round(run.untimedMs[1]))} ms, spread ${pct(run.untimedSpread)})`
  )
  console.log(
    `  fold, timing ON:             ${num(Math.round(run.timedFoldMs))} ms — ${num(run.timedEventsPerSec)} events/sec`
  )
  console.log(
    run.overheadUnresolved
      ? `  timing overhead:             ${pct(run.timingOverhead)} — UNRESOLVED: inside the ${pct(run.untimedSpread)} run-to-run spread, so this run cannot separate the instrument from the machine.`
      : `  timing overhead:             ${pct(run.timingOverhead)} of the untimed fold (run-to-run spread ${pct(run.untimedSpread)}).`
  )
  console.log('')
  printEngineSections(run)
}

/**
 * THE ENGINE'S OWN SUB-TABLE (JOS-59). Its own arm, so its denominator is that arm's fold and
 * not the timed one's — the two are different measurements of the same code and printing a share
 * of the wrong total is exactly the confusion `compareArms` exists to prevent elsewhere.
 */
function printEngineSections(run: AttributionRun): void {
  if (run.engineSections.length === 0) return
  const us = (ms: number): string => ((ms * 1000) / Math.max(1, run.events)).toFixed(2)
  console.log(`  ENGINE SUB-ATTRIBUTION — combat/** only, its own arm (no registry timer attached)`)
  console.log('')
  console.log(`  ${'section'.padEnd(24)}${'total ms'.padStart(11)}${'us/event'.padStart(11)}${'% of engine'.padStart(13)}`)
  for (const s of run.engineSections) {
    const share = run.engineMs > 0 ? s.totalMs / run.engineMs : 0
    console.log(
      `  ${s.section.padEnd(24)}${num(Math.round(s.totalMs)).padStart(11)}${us(s.totalMs).padStart(11)}${pct(share).padStart(13)}`
    )
  }
  console.log('  ' + '-'.repeat(59))
  console.log(
    `  ${'engine total'.padEnd(24)}${num(Math.round(run.engineMs)).padStart(11)}${us(run.engineMs).padStart(11)}${'100.0%'.padStart(13)}`
  )
  console.log('')
  console.log(
    `  that arm's whole fold: ${num(Math.round(run.sectionArmMs))} ms — so the engine is ` +
      `${pct(run.sectionArmMs > 0 ? run.engineMs / run.sectionArmMs : 0)} of it.`
  )
  console.log('')
}
