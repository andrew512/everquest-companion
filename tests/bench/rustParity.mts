/**
 * ============================================================================
 * rustParity.mts — `npm run oracle:rust-parser` (JOS-469, phase 1's acceptance gate).
 * ============================================================================
 *
 *   npm run oracle:rust-parser -- [slice...] [--slices=<dir>] [--goldens=<dir>] [--tz=<zone>]
 *                                 [--no-build] [--keep-going]
 *
 * THE BAR IS THE OWNER'S RULING 12 (docs/plans/data-server.md): the Rust parser's serialized event
 * stream is BYTE-IDENTICAL to the TS parser's, over all six slices. `goldenCli.mts` records that
 * truth and re-checks the TS pipeline against it; this is the same check run against the OTHER
 * implementation, and it is deliberately built on the same pieces — the slice manifest, the golden
 * paths, the report shape and the BelowNormal courtesy all come from there rather than being said
 * twice.
 *
 * THE DIFF HAPPENS INSIDE THE RUST BINARY, not here, and that is a size decision rather than a
 * taste one: the six goldens are 380 MB of NDJSON, so piping them through a Node comparator would
 * make the pipe the measurement. `parity <log> --golden <path>` reads the recorded stream through a
 * fixed buffer, compares line by line, and prints the first place the two stopped agreeing. This
 * file chooses the slices, builds the crate, runs it once per slice and reports.
 *
 * FIXTURE ROOTS ARE FLAGS, and the reason is that this ticket is built in a WORKTREE. The slices and
 * the goldens are gitignored by design, so they exist only in the main checkout; `--slices=` and
 * `--goldens=` point at them, read-only, and the repo-relative default is what a run in the main
 * checkout uses with no flags at all.
 *
 * NOTHING FROM A SLICE IS EVER PRINTED BEYOND THE ONE DIVERGING PAIR. These are the owner's real
 * game log; a divergence report is a diagnostic, not an export.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { constants, setPriority } from 'node:os'
import { join } from 'node:path'
import { ROOT } from '../e2e/build.mjs'
import { GOLDENS_DIR, SLICES_DIR, eventsPath } from './goldenOracle.mjs'
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
    keepGoing: false
  }
  for (const a of argv) {
    if (a === '--no-build') out.build = false
    else if (a === '--keep-going') out.keepGoing = true
    else if (a.startsWith('--slices=')) out.slicesDir = a.slice('--slices='.length)
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
}

/** `OK 67339 events in 183 ms (…)` — the count and the wall clock the binary measured itself. */
function readOk(line: string): { events: number; ms: number } | null {
  const m = /^OK (\d+) events in (\d+) ms/.exec(line)
  return m ? { events: Number(m[1]), ms: Number(m[2]) } : null
}

function runSlice(args: Args, slice: SliceRow): Result {
  const log = join(args.slicesDir, slice.file)
  const golden = eventsPath(slice.name, args.goldensDir)
  for (const [what, path] of [
    ['slice', log],
    ['golden', golden]
  ] as const) {
    if (!existsSync(path)) {
      return { name: slice.name, ok: false, events: 0, ms: 0, lines: [`no ${what} at ${path}`] }
    }
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

  const all = readSlicesFrom(args.slicesDir)
  const chosen =
    args.slices.length === 0
      ? all
      : args.slices.map((n) => {
          const hit = all.find((s) => s.name === n)
          if (!hit) throw new Error(`rustParity: no slice named "${n}" (have ${all.map((s) => s.name).join(', ')})`)
          return hit
        })

  console.log(`oracle:rust-parser — ${String(chosen.length)} slice(s), tz=${args.tz}`)
  const results: Result[] = []
  for (const slice of chosen) {
    const r = runSlice(args, slice)
    results.push(r)
    if (r.ok) {
      console.log(`ok   ${r.name.padEnd(16)} ${String(r.events).padStart(9)} events · ${secs(r.ms)}`)
    } else {
      console.error(`FAIL ${r.name}`)
      // The binary's own first-divergence report: the slice, the event ordinal, and the two lines.
      for (const l of r.lines) console.error(`  ${l}`)
      if (!args.keepGoing) break
    }
  }

  const bad = results.filter((r) => !r.ok).length
  const events = results.reduce((n, r) => n + r.events, 0)
  const ms = results.reduce((n, r) => n + r.ms, 0)
  console.log(
    bad === 0
      ? `oracle:rust-parser GREEN — ${String(events)} events over ${String(results.length)} slice(s) in ${secs(ms)}`
      : `oracle:rust-parser RED — ${String(bad)} of ${String(results.length)} slice(s) diverged`
  )
  if (bad > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('oracle:rust-parser:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
