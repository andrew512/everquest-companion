/**
 * ============================================================================
 * rustParity.mts — `npm run oracle:rust-parser` (JOS-469 phase 1) and
 *                  `npm run oracle:rust-fold` (JOS-471 phase 2).
 * ============================================================================
 *
 *   npm run oracle:rust-parser -- [slice...] [--slices=<dir>] [--goldens=<dir>] [--tz=<zone>]
 *                                 [--no-build] [--keep-going]
 *   npm run oracle:rust-fold   -- [slice...] [--snapshots=<module,module>] [the same flags]
 *
 * TWO BARS, ONE HARNESS. Both come from the owner's ruling 12 (docs/plans/data-server.md), and
 * they are deliberately different claims:
 *
 *   PHASE 1 — the Rust PARSER's serialized event stream is BYTE-IDENTICAL to the TS parser's, over
 *      all six slices. `goldenCli.mts` records that truth and re-checks the TS pipeline against it;
 *      this is the same check run against the OTHER implementation.
 *   PHASE 2 (`--snapshots`) — every module the Rust FOLD publishes DEEP-EQUALS its TS twin's entry
 *      in `<slice>.snapshots.json`, over all six slices. Deep, not byte: a snapshot is assembled on
 *      demand out of maps and view builders, so key ORDER is not a claim either implementation
 *      makes (goldenOracle.mts `firstDiff` carries the argument, and this file reuses it rather
 *      than spelling a second comparator).
 *
 * WHERE EACH DIFF HAPPENS, and it is a SIZE decision rather than a taste one. The six event goldens
 * are 380 MB of NDJSON, so phase 1's comparison runs INSIDE the Rust binary — piping them through
 * Node would make the pipe the measurement. The snapshots are megabytes rather than hundreds of
 * them AND the goldens are already parsed here, so phase 2's comparison runs in this file:
 * `parity <log> --snapshots` writes the fold's published state to stdout and the deep-equal happens
 * over two parsed values.
 *
 * MODULES NOT YET PORTED ARE REPORTED BY NAME, NEVER SILENTLY SKIPPED (the no-silent-caps law). The
 * Rust binary ships `fold::WIRING_ORDER` — all twenty modules — and names the ones this build did
 * not register; a comparator that quietly compared nine and printed GREEN would be claiming
 * coverage of twenty. `--snapshots=<list>` narrows further and the narrowing is reported too.
 *
 * FIXTURE ROOTS ARE FLAGS, and the reason is that this ticket is built in a WORKTREE. The slices and
 * the goldens are gitignored by design, so they exist only in the main checkout; `--slices=` and
 * `--goldens=` point at them, read-only, and the repo-relative default is what a run in the main
 * checkout uses with no flags at all.
 *
 * NOTHING FROM A SLICE IS EVER PRINTED BEYOND THE ONE DIVERGING PAIR, on either bar. These are the
 * owner's real game log; a divergence report is a diagnostic, not an export.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { constants, setPriority } from 'node:os'
import { join } from 'node:path'
import { ROOT } from '../e2e/build.mjs'
import {
  GOLDENS_DIR,
  SLICES_DIR,
  eventsPath,
  firstDiff,
  normalizeJson,
  snapshotsPath,
  type Diff
} from './goldenOracle.mjs'
import { SIDECAR, renderSidecar } from '../../scripts/gen-engine-spell-overlay.mjs'

const ENGINE_DIR = join(ROOT, 'engine')
const PARITY_EXE = join(ENGINE_DIR, 'target', 'release', process.platform === 'win32' ? 'parity.exe' : 'parity')

interface Args {
  slices: string[]
  slicesDir: string
  goldensDir: string
  tz: string
  build: boolean
  keepGoing: boolean
  /** PHASE 2: compare the fold's published snapshots instead of the event stream. */
  snapshots: boolean
  /** `--snapshots=a,b` — compare only these module ids. Empty means every one the fold ported. */
  onlyModules: string[]
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    slices: [],
    slicesDir: SLICES_DIR,
    goldensDir: GOLDENS_DIR,
    // The zone the goldens were recorded in is recorded IN them; default to the host's, which is
    // what a re-record on this machine would use.
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    build: true,
    keepGoing: false,
    snapshots: false,
    onlyModules: []
  }
  for (const a of argv) {
    if (a === '--no-build') out.build = false
    else if (a === '--keep-going') out.keepGoing = true
    else if (a === '--snapshots') out.snapshots = true
    else if (a.startsWith('--snapshots=')) {
      out.snapshots = true
      out.onlyModules = a
        .slice('--snapshots='.length)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    } else if (a.startsWith('--slices=')) out.slicesDir = a.slice('--slices='.length)
    else if (a.startsWith('--goldens=')) out.goldensDir = a.slice('--goldens='.length)
    else if (a.startsWith('--tz=')) out.tz = a.slice('--tz='.length)
    else if (a.startsWith('--')) throw new Error(`rustParity: unknown flag ${a}`)
    else out.slices.push(a)
  }
  return out
}

interface SliceRow {
  name: string
  file: string
}

/** Every slice the manifest declares, in manifest order — the same read `goldenOracle` makes, with
 *  the directory as a parameter so a worktree can point at the main checkout's copy. */
function readSlicesFrom(dir: string): SliceRow[] {
  const manifest = join(dir, 'manifest.json')
  if (!existsSync(manifest)) {
    throw new Error(
      `no slice manifest at ${manifest} — the corpus is gitignored and machine-local; ` +
        `pass --slices=<dir> --goldens=<dir> pointing at the checkout that holds it`
    )
  }
  const raw = JSON.parse(readFileSync(manifest, 'utf8')) as { slices: SliceRow[] }
  return raw.slices.map((s) => ({ name: s.name, file: s.file }))
}

/**
 * The sidecar the Rust crate reads for the two TypeScript overlay LISTS
 * (`scripts/gen-engine-spell-overlay.mts` carries the whole argument). Regenerated here and
 * REFUSED when it changed, rather than silently rewritten: a comparison run against a stale
 * projection of the corrections list would be comparing two different spell databases and calling
 * the result a parser divergence.
 */
function requireFreshSidecar(): void {
  const want = renderSidecar()
  const have = existsSync(SIDECAR) ? readFileSync(SIDECAR, 'utf8').replace(/\r\n/g, '\n') : ''
  if (have === want) return
  throw new Error(
    `${SIDECAR} is stale — the TypeScript overlay lists moved under it. ` +
      `Run \`npx tsx scripts/gen-engine-spell-overlay.mts\`, rebuild, and commit the result.`
  )
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

/**
 * Where `cargo` is. Rustup installs it under `~/.cargo/bin`, which is on PATH in a login shell and
 * is NOT on PATH in every shell that runs npm on this machine — so the fallback is named rather
 * than left as an ENOENT for the next reader to diagnose. CI's toolchain action puts it on PATH and
 * takes the first branch.
 */
function cargoBin(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const local = join(home, '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
  return existsSync(local) ? local : 'cargo'
}

function buildCrate(): void {
  const t0 = performance.now()
  execFileSync(cargoBin(), ['build', '--release', '-p', 'parity'], {
    cwd: ENGINE_DIR,
    stdio: 'inherit'
  })
  console.log(`built parity in ${secs(performance.now() - t0)}`)
}

/**
 * BELOW NORMAL, SET BY THE TOOL (house rule, 2026-08-23) — `goldenCli.mts`'s reasoning verbatim: a
 * fold of all six slices pins a core for a while and the owner may well be playing EverQuest on the
 * other side of it. Set on THIS process; the Rust child inherits it, which is what makes one call
 * enough. Best-effort, exactly as over there.
 */
function runBelowNormal(): void {
  try {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    console.warn('rustParity: could not lower process priority; continuing at normal')
  }
}

interface Result {
  name: string
  ok: boolean
  events: number
  ms: number
  lines: string[]
  /** PHASE 2 only: one row per module the fold published. */
  modules?: ModuleResult[]
  /** PHASE 2 only: modules NOT compared, and why. Always printed — the no-silent-caps law. */
  skipped?: { id: string; why: string }[]
}

/** One module's verdict on one slice. */
interface ModuleResult {
  id: string
  ok: boolean
  /** The FIRST place the two structures stopped agreeing, or undefined when they never did. */
  diff?: Diff
}

/** The envelope `parity --snapshots` writes. */
interface RustSnapshots {
  modules: { id: string; snapshot: unknown }[]
  /** `fold::WIRING_ORDER` minus what this build registered — the modules 2b/2c/2d still owe. */
  skipped: string[]
  meta: { events: number; ms: number; character: string; tz: string; launchMs: number }
}

/** The half of `<slice>.snapshots.json` this bar is about. */
interface GoldenSnapshots {
  modules: { id: string; snapshot: unknown }[]
}

/**
 * `updatedAt` OFF BOTH SIDES, on `goldenOracle.mts normalizeJson`'s precedent: the message-overlay
 * miner stamps it when the SNAPSHOT is taken, so it is a statement about the reader rather than
 * about what was folded. The goldens on disk were already recorded through that stripper, so this
 * only ever has work to do on the Rust side — but it is applied to both, because a comparator that
 * strips one side is a comparator whose two halves are not the same value.
 *
 * The `includes` guard is what keeps that free: no module in cluster 2a carries the field at all,
 * so the round trip is skipped entirely until 2c brings one that does.
 */
function stripUpdatedAt(value: unknown): unknown {
  const text = JSON.stringify(value)
  if (text === undefined || !text.includes('"updatedAt"')) return value
  return JSON.parse(normalizeJson(value)) as unknown
}

/** At most 160 characters of ONE diverging value — the file's standing rule about slice content. */
const short = (v: unknown): string => {
  const s = v === undefined ? '(absent)' : JSON.stringify(v)
  return s === undefined ? '(absent)' : s.length > 160 ? `${s.slice(0, 160)}…` : s
}

/** `OK 67339 events in 183 ms (…)` — the count and the wall clock the binary measured itself. */
function readOk(line: string): { events: number; ms: number } | null {
  const m = /^OK (\d+) events in (\d+) ms/.exec(line)
  return m ? { events: Number(m[1]), ms: Number(m[2]) } : null
}

/**
 * PHASE 2: fold the slice in Rust, then deep-equal every published module against the golden.
 *
 * `maxBuffer` is generous because the answer really does come back over the pipe here (see the
 * header): the largest slice's nine modules are a few megabytes of JSON, and a truncated envelope
 * would surface as a parse error rather than as the size problem it is.
 */
function runSnapshots(args: Args, slice: SliceRow, log: string): Result {
  const goldenPath = snapshotsPath(slice.name, args.goldensDir)
  if (!existsSync(goldenPath)) {
    return { name: slice.name, ok: false, events: 0, ms: 0, lines: [`no golden at ${goldenPath}`] }
  }
  const t0 = performance.now()
  const res = spawnSync(PARITY_EXE, [log, '--snapshots', '--tz', args.tz], {
    encoding: 'utf8',
    maxBuffer: 1 << 28
  })
  const wall = Math.round(performance.now() - t0)
  if (res.status !== 0 || !res.stdout) {
    const why = `${res.stderr ?? ''}`.trim()
    return {
      name: slice.name,
      ok: false,
      events: 0,
      ms: wall,
      lines: [`parity --snapshots exited ${String(res.status)}`, ...(why ? [why] : [])]
    }
  }
  const rust = JSON.parse(res.stdout) as RustSnapshots
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenSnapshots
  const byId = new Map(golden.modules.map((m) => [m.id, m.snapshot]))

  const modules: ModuleResult[] = []
  const skipped: { id: string; why: string }[] = rust.skipped.map((id) => ({
    id,
    why: 'not ported'
  }))
  for (const m of rust.modules) {
    if (args.onlyModules.length > 0 && !args.onlyModules.includes(m.id)) {
      skipped.push({ id: m.id, why: '--snapshots filter' })
      continue
    }
    const want = byId.get(m.id)
    if (want === undefined) {
      modules.push({
        id: m.id,
        ok: false,
        diff: { path: '', expected: '(no such module in the golden)', actual: m.id }
      })
      continue
    }
    const diff = firstDiff(stripUpdatedAt(want), stripUpdatedAt(m.snapshot), '')
    modules.push(diff ? { id: m.id, ok: false, diff } : { id: m.id, ok: true })
  }
  return {
    name: slice.name,
    ok: modules.length > 0 && modules.every((m) => m.ok),
    events: rust.meta.events,
    ms: rust.meta.ms,
    lines: [],
    modules,
    skipped
  }
}

function runSlice(args: Args, slice: SliceRow): Result {
  const log = join(args.slicesDir, slice.file)
  if (!existsSync(log)) {
    return { name: slice.name, ok: false, events: 0, ms: 0, lines: [`no slice at ${log}`] }
  }
  if (args.snapshots) return runSnapshots(args, slice, log)
  const golden = eventsPath(slice.name, args.goldensDir)
  if (!existsSync(golden)) {
    return { name: slice.name, ok: false, events: 0, ms: 0, lines: [`no golden at ${golden}`] }
  }
  const t0 = performance.now()
  const res = spawnSync(PARITY_EXE, [log, '--golden', golden, '--tz', args.tz], {
    encoding: 'utf8',
    maxBuffer: 1 << 22
  })
  const wall = performance.now() - t0
  const lines = `${res.stdout ?? ''}${res.stderr ?? ''}`.split('\n').filter((l) => l.trim() !== '')
  const ok = res.status === 0
  const parsed = lines.map(readOk).find((r) => r !== null)
  return {
    name: slice.name,
    ok,
    events: parsed?.events ?? 0,
    ms: parsed?.ms ?? Math.round(wall),
    lines
  }
}

async function main(): Promise<void> {
  runBelowNormal()
  const args = parseArgs(process.argv.slice(2))
  requireFreshSidecar()
  if (!existsSync(PARITY_EXE) && !args.build) throw new Error(`no parity binary at ${PARITY_EXE}`)
  if (args.build) buildCrate()

  const chosen = chooseSlices(args)
  const bar = args.snapshots ? 'oracle:rust-fold' : 'oracle:rust-parser'
  console.log(`${bar} — ${String(chosen.length)} slice(s), tz=${args.tz}`)
  const results: Result[] = []
  for (const slice of chosen) {
    const r = runSlice(args, slice)
    results.push(r)
    reportSlice(r)
    if (!r.ok && !args.keepGoing) break
  }
  summarize(bar, results)
}

/** The manifest's slices, or the named subset — which must exist, by name. */
function chooseSlices(args: Args): SliceRow[] {
  const all = readSlicesFrom(args.slicesDir)
  if (args.slices.length === 0) return all
  return args.slices.map((n) => {
    const hit = all.find((s) => s.name === n)
    if (!hit) throw new Error(`rustParity: no slice named "${n}" (have ${all.map((s) => s.name).join(', ')})`)
    return hit
  })
}

function reportSlice(r: Result): void {
  if (r.ok) {
    console.log(`ok   ${r.name.padEnd(16)} ${String(r.events).padStart(9)} events · ${secs(r.ms)}`)
  } else {
    console.error(`FAIL ${r.name}`)
    // The binary's own first-divergence report: the slice, the event ordinal, and the two lines.
    for (const l of r.lines) console.error(`  ${l}`)
  }
  reportModules(r)
}

/** The one line a CI log gets read for, and the exit code that goes with it. */
function summarize(bar: string, results: Result[]): void {
  const bad = results.filter((r) => !r.ok).length
  const events = results.reduce((n, r) => n + r.events, 0)
  const ms = results.reduce((n, r) => n + r.ms, 0)
  // How many modules the phase-2 bar actually covered, said out loud beside GREEN — the same
  // reason the SKIP lines exist.
  const compared = results[0]?.modules?.length
  const scope = compared === undefined ? '' : ` · ${String(compared)} module(s) per slice`
  console.log(
    bad === 0
      ? `${bar} GREEN — ${String(events)} events over ${String(results.length)} slice(s) in ${secs(ms)}${scope}`
      : `${bar} RED — ${String(bad)} of ${String(results.length)} slice(s) diverged`
  )
  if (bad > 0) process.exitCode = 1
}

/**
 * The per-module half of a phase-2 report: every module compared, PASS or FAIL with its first
 * divergence, and every module NOT compared, by name and with the reason.
 *
 * The SKIPPED line is printed on a green run too, and that is the whole point (the no-silent-caps
 * law): "nine of twenty agreed" and "the fold agrees" are different sentences, and only the report
 * can tell them apart.
 */
function reportModules(r: Result): void {
  if (!r.modules) return
  const pass = r.modules.filter((m) => m.ok).map((m) => m.id)
  if (pass.length > 0) console.log(`       PASS ${pass.join(' · ')}`)
  for (const m of r.modules) {
    if (m.ok || !m.diff) continue
    console.error(`       FAIL ${m.id} at ${m.diff.path === '' ? '(the whole snapshot)' : m.diff.path}`)
    console.error(`         golden : ${short(m.diff.expected)}`)
    console.error(`         rust   : ${short(m.diff.actual)}`)
  }
  for (const why of new Set((r.skipped ?? []).map((s) => s.why))) {
    const ids = (r.skipped ?? []).filter((s) => s.why === why).map((s) => s.id)
    console.log(`       SKIP ${ids.join(' · ')} (${why})`)
  }
}

main().catch((err: unknown) => {
  console.error('oracle:rust-parser:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
