/**
 * ============================================================================
 * foldConsumerCensus.test.mts — ALL LOG-DERIVED STATE IS CHECKPOINTED, AS A TEST (JOS-208 phase 4).
 * ============================================================================
 *
 * THE DEFECT THIS GENERALIZES. `foldCheckpointDifferential.test.mts` closes the MODULE set in both
 * directions against `registry.list()`, and it was green for three whole phases while the largest
 * fold in the app — the `CombatEngine` — sat outside the container. It could be, because the engine
 * is not a module: it subscribes to the bus directly from `pipeline.ts` and publishes through its
 * own IPC, so no assertion anywhere in the tree had any reason to mention it. The owner's ruling
 * after the live retest that found the empty meter: that must not be possible again, and a
 * paragraph in AGENTS.md is not a mechanism.
 *
 * SO THE SUBJECT IS THE INLETS, not the consumers. Log-derived state can only come into existence
 * two ways in this process — by subscribing to the event bus, or by reading log bytes — plus the
 * two telemetry taps that sit inside those paths and see everything going through them. This test
 * finds every such call site in `src/main/**` by scanning the source, and holds the result against
 * the committed census (`src/main/foldCache/census.ts`) IN BOTH DIRECTIONS:
 *
 *     a site the census does not declare      → RED, naming the file, the inlet and the count.
 *     a census row nothing in the tree matches → RED, the same way.
 *     a row claiming `unit: X` where X is not
 *       a FoldUnit in a built fold world      → RED, by id.
 *     an exemption whose argument is a stub    → RED.
 *
 * WHY A SOURCE SCAN. A runtime census would have to import the composition root, and the
 * composition root is Electron-bound (`pipeline.ts` reaches the store and the windows) — it cannot
 * be loaded by `npm test`, which is precisely where this has to fail. Scanning reads the wiring as
 * written, which is also what a reviewer reads.
 *
 * IT IS DELIBERATELY CRUDE ABOUT WHAT IT SEES. It counts call sites per (file, inlet) rather than
 * trying to work out who the callback hands events to — a static analysis clever enough to answer
 * that would be a program with bugs of its own, and the question it would answer ("is this consumer
 * checkpointed?") is one a person has to answer anyway, in a sentence, in the census. What the
 * machine guarantees is that the question is ASKED, every time, and that no answer goes stale.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { LOG_CONSUMER_CENSUS, type CensusEntry } from '../src/main/foldCache/census'
import { buildFoldWorld } from './foldCheckpointHarness.mts'

const MAIN = join(import.meta.dirname, '..', 'src', 'main')

/**
 * THE INLETS. Each is a literal call form; the scanner is a substring match on non-comment lines,
 * which is all that is needed for forms this distinctive and is a great deal more predictable than
 * a regex over TypeScript.
 *
 *   bus.subscribe / registry.attach — the parsed event stream.
 *   scanLog / new Tailer / parseEvent / newBytesSince — log BYTES, the two feeders and the one
 *     place that measures the file without folding it.
 *   noteEventKind / noteLinesParsed — the two taps that see every event and every line. They are
 *     inlets by any honest reading, so they are counted and argued rather than assumed harmless.
 */
const LOG_INLETS: readonly { literal: string; inlet: string }[] = [
  { literal: 'bus.subscribe(', inlet: 'bus.subscribe' },
  { literal: '.attach(bus', inlet: 'registry.attach' },
  { literal: 'scanLog(', inlet: 'scanLog' },
  { literal: 'new Tailer(', inlet: 'new Tailer' },
  { literal: 'parseEvent(', inlet: 'parseEvent' },
  { literal: 'newBytesSince(', inlet: 'newBytesSince' },
  { literal: 'noteEventKind(', inlet: 'noteEventKind' },
  { literal: 'noteLinesParsed(', inlet: 'noteLinesParsed' }
]

/** Every `.ts` under `src/main`, repo-relative with forward slashes. */
function mainSources(dir = MAIN, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) mainSources(full, out)
    else if (name.endsWith('.ts')) out.push(relative(join(MAIN, '..', '..'), full).split(sep).join('/'))
  }
  return out
}

/**
 * Is this line PROSE? This repo comments heavily and three files discuss
 * `ModuleRegistry.attach(bus, timer)` in a header, so a comment must never be counted as wiring.
 */
function isProse(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/**
 * How many real call sites of `literal` this line holds.
 *
 * PER OCCURRENCE, NOT PER LINE, and that correction is measured rather than tidy: the first cut of
 * this scanner skipped any line matching a function declaration, on the reasoning that `scanLog`,
 * `parseEvent`, `newBytesSince`, `noteEventKind` and `noteLinesParsed` are all DEFINED inside
 * `src/main` and would otherwise report themselves as their own consumers. A one-line
 * `export function wire(bus) { bus.subscribe(…) }` then went completely unseen — a new log consumer
 * that the census, which exists for exactly that, waved straight through. So the exclusion is
 * narrowed to the occurrence that IS the declaration: a match preceded by `function ` is the
 * definition, and every other match on the line is a call.
 */
function callSites(line: string, literal: string): number {
  if (isProse(line)) return 0
  let count = 0
  for (let at = line.indexOf(literal); at >= 0; at = line.indexOf(literal, at + 1)) {
    if (!/\b(?:async\s+)?function\s+$/.test(line.slice(0, at))) count += 1
  }
  return count
}

interface Site {
  file: string
  inlet: string
  count: number
}

/** Tally one file's inlet call sites into the running map. */
function scanFile(file: string, found: Map<string, Site>): void {
  for (const line of readFileSync(join(MAIN, '..', '..', file), 'utf8').split('\n')) {
    for (const { literal, inlet } of LOG_INLETS) {
      const n = callSites(line, literal)
      if (n === 0) continue
      const key = `${file}#${inlet}`
      const prev = found.get(key)
      if (prev) prev.count += n
      else found.set(key, { file, inlet, count: n })
    }
  }
}

/** Every inlet call site in `src/main`, counted per (file, inlet). */
function scanSites(): Site[] {
  const found = new Map<string, Site>()
  for (const file of mainSources()) scanFile(file, found)
  return [...found.values()].sort((a, b) => `${a.file}#${a.inlet}`.localeCompare(`${b.file}#${b.inlet}`))
}

const rowKey = (s: { file: string; inlet: string }): string => `${s.file}#${s.inlet}`
const censusRows = (): CensusEntry[] =>
  [...LOG_CONSUMER_CENSUS].sort((a, b) => rowKey(a).localeCompare(rowKey(b)))

test('fold census: every log consumer in src/main is declared', () => {
  const sites = scanSites()
  const declared = new Map(censusRows().map((e) => [rowKey(e), e]))

  const undeclared = sites
    .filter((s) => !declared.has(rowKey(s)))
    .map((s) => `${rowKey(s)} (${s.count} call site${s.count === 1 ? '' : 's'})`)
  assert.deepStrictEqual(
    undeclared,
    [],
    `these consume the log and are not in the census: ${undeclared.join(', ')}.\n` +
      `Add a row to src/main/foldCache/census.ts saying what the consumer does with what it takes — ` +
      `either it is a checkpointed FoldUnit (name its id), or it delegates to the module registry, ` +
      `or it is exempt and the row carries the argument. This is the assertion the CombatEngine ` +
      `would have failed for three phases.`
  )

  const found = new Set(sites.map(rowKey))
  const stale = [...declared.keys()].filter((k) => !found.has(k))
  assert.deepStrictEqual(stale, [], `these census rows match nothing in the tree: ${stale.join(', ')}`)
})

test('fold census: the declared call-site counts are current', () => {
  const byKey = new Map(scanSites().map((s) => [rowKey(s), s.count]))
  const wrong = censusRows()
    .filter((e) => byKey.get(rowKey(e)) !== e.count)
    .map((e) => `${rowKey(e)}: census says ${e.count}, tree has ${byKey.get(rowKey(e)) ?? 0}`)
  // The COUNT is what makes a row an argument about a specific piece of wiring rather than a
  // blanket pass for a file. A second `bus.subscribe` added to pipeline.ts is a second consumer,
  // and it has to be argued even though the file is already declared.
  assert.deepStrictEqual(wrong, [], `census counts are stale: ${wrong.join('; ')}`)
})

test('fold census: every unit a row names really implements the seam', () => {
  const world = buildFoldWorld('')
  const units = new Set(world.units.map((u) => u.id))
  const missing: string[] = []
  for (const e of LOG_CONSUMER_CENSUS) {
    if (e.verdict.kind !== 'unit') continue
    for (const id of e.verdict.units) if (!units.has(id)) missing.push(`${rowKey(e)} → '${id}'`)
  }
  assert.deepStrictEqual(
    missing,
    [],
    `these census rows claim a checkpointed unit that does not exist or does not implement ` +
      `FoldCheckpointable: ${missing.join(', ')}`
  )
})

test('fold census: every row carries a real argument', () => {
  const thin = LOG_CONSUMER_CENSUS.filter((e) => e.why.trim().length < 80).map(rowKey)
  // The same rule the golden fingerprints apply to an overzealous bump: a reason that is not a
  // reason is worse than none, because it looks like the question was answered.
  assert.deepStrictEqual(thin, [], `these census rows do not say enough to be an argument: ${thin.join(', ')}`)
  const dupes = LOG_CONSUMER_CENSUS.map(rowKey).filter((k, i, all) => all.indexOf(k) !== i)
  assert.deepStrictEqual(dupes, [], `duplicate census rows: ${dupes.join(', ')}`)
})

/**
 * THE CENSUS'S OWN TRIPWIRE. An audit that cannot fail is decoration — the same argument the two
 * fold audits make with their tripwire tests. This proves the scanner really would see a new
 * consumer: a synthetic source line carrying a bus subscription is put through the same predicate
 * the scan uses, and a comment about one is not.
 */
test('fold census: the scanner sees a new consumer, and does not see prose about one', () => {
  assert.equal(callSites('bus.subscribe((ev, live) => somethingNew.fold(ev, live))', 'bus.subscribe('), 1)
  assert.equal(callSites('  const off = bus.subscribe(this.dispatch())', 'bus.subscribe('), 1)
  assert.equal(callSites('// `bus.subscribe(fn)` is how a consumer joins the stream.', 'bus.subscribe('), 0)
  assert.equal(callSites(' * `ModuleRegistry.attach(bus, timer)` is:', '.attach(bus'), 0)
  // The DECLARATION of an inlet is not a use of it; a call on the same line still is. This is the
  // case that got through the first cut of the scanner (see `callSites`).
  assert.equal(callSites('export async function scanLog(', 'scanLog('), 0)
  assert.equal(callSites('export function noteEventKind(kind: string, ts: number): void {', 'noteEventKind('), 0)
  assert.equal(
    callSites('export function wire(bus: Bus): void { bus.subscribe(() => undefined) }', 'bus.subscribe('),
    1
  )
  // …and the inlet list is not empty, which is the one way this whole file could pass by asking
  // nothing at all.
  assert.ok(LOG_INLETS.length >= 8)
  assert.ok(scanSites().length >= 10, 'the scan must find the wiring it is auditing')
})
