/**
 * The e2e RUNNER: discovery, filters, a per-spec timeout, timings, and parallelism.
 *
 * It fails if ANY spec failed — unlike `a && b`, one spec's red exit cannot silently skip the
 * specs after it (which is exactly what happened while a known combat-header failure kept spec 1
 * at exit 1: `npm run test:e2e` never reached the overview spec at all).
 *
 * PARALLEL BY DEFAULT, which used to be forbidden: every spec shared one userData dir keyed by
 * the checkout, so concurrent specs deleted each other's stores and the tally from a contended
 * run was noise. The isolation unit is now ONE LAUNCH (appWindow.mts `launchApp`) and artifacts
 * are per run and per spec, so there is nothing left for two specs to fight over. `--serial`
 * stays for debugging, where interleaved output costs more than the wall clock saves.
 *
 *   npm run test:e2e                 every spec, up to min(4, cores/2) at a time
 *   npm run test:e2e -- leveling     only the specs whose file name contains 'leveling'
 *   npm run test:e2e -- --serial     one at a time, output straight through
 *
 * Per-spec wall time is printed as a table and written to artifacts/<runId>/summary.json.
 * EQ_E2E_SPEC_TIMEOUT_MS overrides the 5-minute per-spec cap.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reapOrphanUserData } from './appWindow.mjs'
import { buildIfStale } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const TIMEOUT_MS = Number(process.env.EQ_E2E_SPEC_TIMEOUT_MS ?? 300_000)
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const RUN_DIR = join(ROOT, 'tests', 'e2e', 'artifacts', RUN_ID)

const argv = process.argv.slice(2)
const serial = argv.includes('--serial')
const filters = argv.filter((a) => !a.startsWith('--'))

/**
 * Half the cores, capped at 4. Each spec is a full Electron app replaying a large log, so the
 * limit is memory and disk, not CPU; leaving half the machine alone also keeps the sleeps the
 * specs still contain (docs/plans/e2e-parallel.md, wave E3) from losing their bets.
 */
const CONCURRENCY = serial ? 1 : Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

interface Result {
  spec: string
  ms: number
  status: number | null
  timedOut: boolean
}

/** Kill the spec AND the Electron it launched — a bare kill leaves the app holding its dir. */
function killTree(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'])
  else process.kill(-pid, 'SIGKILL')
}

function runSpec(spec: string): Promise<Result> {
  const name = spec.replace(/\.e2e\.mts$/, '')
  // The default cap, unless this spec is one the default cannot honestly hold — see SPEC_TIMEOUT_MS.
  const capMs = SPEC_TIMEOUT_MS[basename(spec)] ?? TIMEOUT_MS
  const t0 = Date.now()
  return new Promise<Result>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(here, spec)], {
      // Serial mode streams straight through; in parallel, interleaved lines from four apps are
      // unreadable, so each spec's output is held and printed as one block when it finishes.
      stdio: serial ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, EQ_E2E_RUN_ID: RUN_ID, EQ_E2E_SPEC: name }
    })
    const out: string[] = []
    child.stdout?.on('data', (b: Buffer) => out.push(b.toString()))
    child.stderr?.on('data', (b: Buffer) => out.push(b.toString()))

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killTree(child.pid)
    }, capMs)

    child.on('close', (status) => {
      clearTimeout(timer)
      const ms = Date.now() - t0
      if (!serial) {
        const text = out.join('')
        console.log(`\n${'─'.repeat(70)}\n[e2e] ${spec} — ${(ms / 1000).toFixed(1)}s\n${text}`)
        try {
          mkdirSync(join(RUN_DIR, name), { recursive: true })
          writeFileSync(join(RUN_DIR, name, 'output.log'), text, 'utf8')
        } catch {
          // Evidence is a nicety here; the verdict below is what the caller acts on.
        }
      }
      if (timedOut) console.error(`[e2e] ${spec} TIMED OUT after ${String(capMs)}ms`)
      resolve({ spec, ms, status, timedOut })
    })
  })
}

/**
 * SPECS THAT MUST NOT SHARE THE MACHINE (JOS-499), and the contention is named rather than implied.
 *
 * Every launch now spawns a Rust engine beside the app, and under `npm run test:e2e` that means up
 * to four DEBUG engines folding concurrently — a build whose spell-db parse alone is MEASURED at
 * 4.3 s (release is roughly a tenth of it, per the engine's own README). These two specs assert on
 * timing the fold has to beat: `buffs-overlay` waits for a buff row to appear and then for it to
 * DROP, and `engine-alert-fires` drives one live line to exactly one sound. Both are green run on
 * their own and both fail under a full parallel sweep — measured both ways, repeatedly.
 *
 * THIS IS NOT A FLAKE ROW, and the distinction matters for AGENTS.md's ledger: a flake is a spec
 * that fails nondeterministically under identical conditions. These fail DETERMINISTICALLY under
 * load and pass deterministically without it, so the honest fix is to stop giving them load rather
 * than to widen a timeout until the failure hides.
 *
 * THEY RUN LAST, ALONE, and after everything else has exited — so they get a quiet machine rather
 * than a smaller share of a busy one. The cost is their own wall clock added to the run, which is
 * about two minutes, and that is the price of the suite meaning what it says.
 *
 * THE REAL FIX IS A RELEASE ENGINE FOR THE SUITE (`buildEngineIfStale` builds debug). That is a
 * harness change with its own trade — a slower first build for a faster, quieter suite — and it is
 * the integrator's call, not this list's. Delete this list the day it is made.
 */
const SOLO_SPECS = [
  // `bosses-week` launches TWICE on the REAL INSTALL — deliberately, because its portrait
  // assertions read the game's own UI files — so before the first boss card can be drawn the engine
  // must fold the owner's whole log, twice, in a DEBUG build. It gets the machine to itself so that
  // fold is not also competing, and an extended cap sized to it (`SPEC_TIMEOUT_MS`).
  'bosses-week.e2e.mts'
]

// ── A CORRECTION, KEPT BECAUSE THE WRONG DIAGNOSIS IS INSTRUCTIVE (JOS-499) ────────────────────
//
// THIS LIST FIRST HELD `buffs-overlay` AND `engine-alert-fires`, on the reasoning that they passed
// standalone and failed under a full sweep, so they must be losing a race for the machine. Both
// were wrong, and running them ALONE is what proved it — they failed there too, with the real
// causes visible:
//
//   * `engine-alert-fires` was a HARNESS DEFECT I introduced: `launchOnFixture` began waiting for
//     the engine's go-live sentence by tapping the output, and `tapOutput` handed every caller a
//     FRESH buffer — so the spec's own tap started empty and could never see a line already past.
//     Fixed at the tap (`engineSteps.mts TAPS`), which also makes `said()` mean what it says.
//   * `buffs-overlay` was that same wait doing its job too well. Its subject is the MID-FOLD
//     hydrate, and a wait that guarantees the fold has landed removes the only window the defect
//     can appear in. It opts out by name now.
//
// THE LESSON, and the reason this note outlives the mistake: "green alone, red in the sweep" is
// evidence of a TIMING dependence, not of contention specifically — and after this cutover the
// commonest timing dependence is on the engine's fold, which a harness change can move in either
// direction. Diagnose the spec before quarantining it; a quarantine that hides a real defect is
// worse than the red it silenced.

/**
 * PER-SPEC CAPS, for the specs the 5-minute default cannot honestly hold.
 *
 * ── THE MEASUREMENT, AND WHY IT IS NOT "THE FOLD PLUS MARGIN" ─────────────────────────────────
 *
 * `bosses-week` is the only entry, and the number below is NOT a measured fold plus margin,
 * because the measurement refused to produce one. A throwaway probe launched the app on the REAL
 * INSTALL with a DEBUG engine and waited for the go-live sentence: at **900 s it had not arrived**.
 * That is a timeout, not a duration — the debug engine did not finish folding the owner's full log
 * in fifteen minutes, and this spec would need it done TWICE (two launches against one userData,
 * the second proving the preference survived a restart). There is no honest "measured fold" to
 * size a cap against, so none is invented here.
 *
 * ── WHAT THE NUMBER IS INSTEAD ────────────────────────────────────────────────────────────────
 *
 * It is sized to the configuration in which this spec CAN pass: a RELEASE engine, which the
 * engine's own README measures at roughly a tenth of the debug cost. Two folds at that rate plus
 * the spec's own driving fits comfortably inside this cap. Under the debug engine the suite builds
 * today, `bosses-week` still fails — and it now fails AT this cap with the reason written down,
 * rather than at 300 s looking like an empty roster.
 *
 * ── IT IS A DEV-HARNESS ARTIFACT, NOT A PRODUCT GAP ───────────────────────────────────────────
 *
 * `buildEngineIfStale` builds DEBUG. A user's app ships the release binary and waits nothing like
 * this; the deletion release did not make the product slower, it moved the fold to a process this
 * suite happens to build unoptimised. The fix is one line in the harness's build step and it is the
 * integrator's call, not this file's — the day it lands, this entry goes.
 */
const SPEC_TIMEOUT_MS: Record<string, number> = {
  'bosses-week.e2e.mts': 900_000
}

/** Run at most CONCURRENCY specs at once, in discovery order — then the solo ones, alone. */
async function runAll(specs: string[]): Promise<Result[]> {
  const solo = specs.filter((s) => SOLO_SPECS.includes(basename(s)))
  const packed = specs.filter((s) => !SOLO_SPECS.includes(basename(s)))
  const results: Result[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < packed.length) results.push(await runSpec(packed[next++]))
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, packed.length) }, worker))
  // …and the ones that need the machine to themselves, strictly one at a time.
  for (const s of solo) results.push(await runSpec(s))
  return results
}

function report(results: Result[], wallMs: number): number {
  const failed = results.filter((r) => r.status !== 0)
  const rows = [...results].sort((a, b) => b.ms - a.ms)
  const width = Math.max(...rows.map((r) => r.spec.length))
  console.log(`\n${'═'.repeat(70)}\n[e2e] run ${RUN_ID}`)
  for (const r of rows) {
    const verdict = r.timedOut ? 'TIMEOUT' : r.status === 0 ? 'ok' : `exit ${String(r.status)}`
    console.log(`  ${r.spec.padEnd(width)}  ${(r.ms / 1000).toFixed(1).padStart(7)}s  ${verdict}`)
  }
  try {
    mkdirSync(RUN_DIR, { recursive: true })
    writeFileSync(
      join(RUN_DIR, 'summary.json'),
      JSON.stringify({ runId: RUN_ID, concurrency: CONCURRENCY, wallMs, specs: rows }, null, 2),
      'utf8'
    )
  } catch (err) {
    console.log(`[e2e] could not write summary.json — ${String(err)}`)
  }
  const green = results.length - failed.length
  console.log(
    `\n[e2e] ${String(green)}/${String(results.length)} specs green · ${(wallMs / 1000).toFixed(1)}s wall · artifacts/${RUN_ID}/`
  )
  return failed.length
}

const specs = readdirSync(here)
  .filter((f) => f.endsWith('.e2e.mts'))
  .filter((f) => filters.length === 0 || filters.some((needle) => f.includes(needle)))
  .sort()

if (specs.length === 0) {
  console.error(`[e2e] no spec matches ${filters.join(', ')}`)
  process.exit(1)
}

// Build ONCE here rather than letting four specs discover staleness at the same instant (each
// still calls buildIfStale and finds the output fresh), and sweep userData dirs from runs that
// were killed before they could clean up after themselves.
//
// BOTH BINARIES SINCE JOS-490: `buildIfStale()` now asks cargo's gate as well as electron-vite's,
// because the harness launches every app with `EQC_ENGINE=1` and a spec handed a stale or missing
// `engined.exe` would take the engine's ABSENCE path and go quietly green.
buildIfStale()
const reaped = reapOrphanUserData()
if (reaped > 0) console.log(`[e2e] reaped ${String(reaped)} orphaned userData dir(s) older than 24h`)
console.log(
  `[e2e] ${String(specs.length)} spec(s), ${serial ? 'serial' : `${String(CONCURRENCY)} at a time`}, ${String(TIMEOUT_MS / 1000)}s cap each`
)

const started = Date.now()
const failed = report(await runAll(specs), Date.now() - started)
process.exit(failed === 0 ? 0 : 1)
