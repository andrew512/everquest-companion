/**
 * foldRestartSteps.mts — THE PLUMBING BEHIND tests/e2e/fold-restart.e2e.mts (JOS-208 phase 3).
 *
 * Its own module for the reason `buffRestartSteps.mts` and `perfProfileSteps.mts` are: the spec
 * beside it is a SEVEN-LAUNCH narrative and the repo's 400-code-line factoring ceiling is answered
 * with a split, not a widened threshold. Everything here is a reading of the app's own artifacts —
 * the module snapshots the renderer hydrates from, the container the checkpoint writes, the startup
 * profile the launch leaves behind — plus the one thing a graceful harness does not otherwise have:
 * a way to kill a process without letting it say goodbye.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { check, settle, sleep } from './appHarness.mjs'
import { decodeCacheHeader } from '../../src/main/foldCache/format'
import { parseLine } from '../../src/main/log/parser'
import { FOLD_CACHE_EXT } from '../../src/main/foldCache/name'
import { CHECKPOINTED_MODULE_IDS } from '../../src/main/foldCache/serialize'
import { parseStartupProfile, type CheckpointVerdict } from '../../src/shared/perf'

/** Every published snapshot the differential harness compares, keyed by module id. */
export type Snapshots = Record<string, unknown>

/**
 * THE READING UNDER TEST: exactly what the renderer hydrates from.
 *
 * `getModuleSnapshot` is the real bridge (`module:getSnapshot`), so this observes the same objects
 * `useModule` does — which is what the owner's law compares. Read through ONE `page.evaluate` so
 * every module is sampled in one turn of the renderer, rather than nineteen round trips across
 * which a live tail could move the world underneath us.
 */
export function moduleSnapshots(page: Page): Promise<Snapshots> {
  return page.evaluate(async (ids: string[]) => {
    const bridge = (window as unknown as {
      eq: { getModuleSnapshot: (id: string) => Promise<unknown> }
    }).eq
    const out: Record<string, unknown> = {}
    for (const id of ids) out[id] = await bridge.getModuleSnapshot(id)
    return out
  }, [...CHECKPOINTED_MODULE_IDS])
}

/**
 * Canonical JSON — keys sorted at every level. The SAME rule the in-app shadow verifier applies
 * (`src/main/foldCache/policy.ts`), and for the same reason: key order is an implementation
 * accident, and a spurious failure here would train somebody to ignore a real one.
 */
function canonical(value: unknown): string {
  // `JSON.stringify(undefined)` is `undefined`, not a string — and a MISSING key on one side is
  // exactly the shape a divergence walk meets. Naming it keeps the two sides comparable and keeps
  // the failure message from being the crash instead of the finding.
  const text = JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
  })
  return text ?? '<absent>'
}

/** Which module ids differ between two readings. Empty is the whole point of this spec. */
export function divergent(warm: Snapshots, cold: Snapshots): string[] {
  return CHECKPOINTED_MODULE_IDS.filter((id) => canonical(warm[id]) !== canonical(cold[id]))
}

/**
 * THE FIRST PLACE two snapshots differ, as a path plus both values.
 *
 * A bare list of module ids is a bug report nobody can start from — this spec exists precisely
 * because the differential harness can only run over the logs this repo carries, so when it does
 * catch something, the reading has to be actionable on a machine that is not this one.
 */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (canonical(a) === canonical(b)) return null
  const both = typeof a === 'object' && a !== null && typeof b === 'object' && b !== null
  if (both && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    for (const k of keys) {
      const deeper = firstDifference(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`
      )
      if (deeper !== null) return deeper
    }
  }
  return `${path || '<root>'}: warm=${canonical(a).slice(0, 160)} cold=${canonical(b).slice(0, 160)}`
}

/**
 * THE COMPARISON, as one check per run of the flow — and one line per module that differs, naming
 * the exact field rather than dumping two snapshots at the reader.
 */
export function checkSame(tag: string, warm: Snapshots, cold: Snapshots): void {
  const diff = divergent(warm, cold)
  const detail =
    diff.length === 0
      ? `${String(CHECKPOINTED_MODULE_IDS.length)} modules identical`
      : diff.map((id) => `${id}${firstDifference(warm[id], cold[id]) ?? ''}`).join(' || ')
  check(`[${tag}] every module's published snapshot matches the cold-start control`, diff.length === 0, detail)
}

// ------------------------------------------------------------------------ the app's artifacts

/** The one container in a launch's userData, or null when no checkpoint was ever written. */
export function cachePath(userData: string): string | null {
  const dir = join(userData, 'foldCache')
  if (!existsSync(dir)) return null
  const file = readdirSync(dir).find((n) => n.endsWith(FOLD_CACHE_EXT))
  return file === undefined ? null : join(dir, file)
}

/** Wait for a checkpoint to appear. THE CONDITION, never the clock (wave E3's law). */
export function settleCacheWritten(userData: string, timeoutMs = 30_000): Promise<string | null> {
  return settle(() => Promise.resolve(cachePath(userData)), (p) => p !== null, { timeoutMs })
}

/**
 * What the container says about itself: which byte it describes, and WHICH WRITE made it.
 *
 * THE HEADER ONLY, and that is not laziness. The blobs are `v8.serialize` output tagged with the V8
 * version that wrote them, so a container written by ELECTRON's V8 does not deserialize in the plain
 * `node` process this spec runs in — measured, on the first cut of this file, as `blob-decode`. The
 * app itself never meets that (one process writes and reads with one V8, and the loader's answer to
 * `blob-decode` is the same cold start it has for every other doubt); a test reading the file from
 * outside does, which is exactly why `decodeCacheHeader` exists.
 */
export function containerHeader(file: string): { b: number; origin: string; seq: number } | string {
  const bytes = readFileSync(file)
  const decoded = decodeCacheHeader(bytes)
  // The failure is RETURNED as text rather than as null: "the header says nothing" and "the file
  // was 0 bytes when we looked" are different bug reports and a null cannot tell them apart.
  if (!decoded.ok) return `undecodable (${decoded.error}, ${String(bytes.length)} bytes)`
  const header = decoded.value
  return { b: header.identity.b, origin: header.origin ?? 'unknown', seq: header.seq }
}

/** Wait for a container to be fully written AND decodable — the rename is atomic, the poll is not. */
export function settleContainer(
  file: string,
  timeoutMs = 15_000
): Promise<{ b: number; origin: string; seq: number } | string> {
  return settle(() => Promise.resolve(containerHeader(file)), (h) => typeof h !== 'string', { timeoutMs })
}

/**
 * The launch's own verdict, read back off `perf-startup.json` (JOS-208 phase 3, deliverable 3).
 *
 * This is the readout the ticket asked for, and asserting it here is what makes the rest of the
 * spec honest: without it, a "warm" launch whose cache was quietly refused would cold-replay, match
 * the cold control perfectly, and pass — proving nothing at all.
 */
export function startupVerdict(userData: string): CheckpointVerdict | null {
  const file = join(userData, 'perf-startup.json')
  if (!existsSync(file)) return null
  try {
    return parseStartupProfile(JSON.parse(readFileSync(file, 'utf8')) as unknown)?.checkpoint ?? null
  } catch {
    return null
  }
}

/**
 * Wait for a launch to have WRITTEN its profile.
 *
 * `perf-startup.json` lands when the last startup phase does, and `rendererHydrated` races
 * `replayDone` (shared/perf.ts's CONCURRENT_PHASES) — so a spec that reads the file the instant the
 * combat engine says it is live can beat the write. A condition, not a sleep.
 */
export function settleVerdict(userData: string, timeoutMs = 30_000): Promise<CheckpointVerdict | null> {
  return settle(() => Promise.resolve(startupVerdict(userData)), (v) => v !== null, { timeoutMs })
}

/** Assert what the loader decided, by the app's own readout. */
export function checkVerdict(
  tag: string,
  userData: string,
  want: { outcome: string; origin?: string }
): CheckpointVerdict | null {
  const v = startupVerdict(userData)
  const outcomeOk = v?.outcome === want.outcome
  const originOk = want.origin === undefined || v?.origin === want.origin
  check(
    `[${tag}] the startup profile states the checkpoint verdict: ${want.outcome}${want.origin === undefined ? '' : ` (written at ${want.origin})`}`,
    outcomeOk && originOk,
    JSON.stringify(v)
  )
  return v
}

/** The local telemetry ring this launch left behind. */
export function telemetryEvents(userData: string): Record<string, unknown>[] {
  const file = join(userData, 'telemetry.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { events?: { ev?: Record<string, unknown> }[] }
    return (parsed.events ?? []).map((r) => r.ev ?? {})
  } catch {
    return []
  }
}

/**
 * DROP THE LEARNED MESSAGE OVERLAY before a launch, so both arms fold with the SAME INPUTS.
 *
 * The differential harness's own rule ("THE SAME STORE-DERIVED INPUTS … handed to BOTH arms
 * identically"), applied to the one store-derived input this spec's two arms would otherwise
 * disagree about. `<userData>/message-overlay.json` is written at quit and SEEDS the next launch's
 * message miner, whose counts the fold then adds to — so a launch that folds the whole log and a
 * launch that folds only a tail leave different numbers behind, and the next pair inherits them.
 *
 * WHAT THAT EXPOSED, and it is worth stating because it is not this ticket's bug: without the
 * checkpoint, EVERY launch re-mines the whole log and adds the result to a seed that already
 * contained it, so the learned overlay's observation counts double on every start (measured here:
 * 22 → 44 → 88 across three launches). The checkpoint incidentally stops that — a restored launch
 * mines only the tail, i.e. counts each observation once. So the arms differ for a reason that has
 * nothing to do with whether the fold was restored correctly, and comparing them would be measuring
 * a pre-existing accumulation instead of this feature. Reset, compare the fold, report the finding.
 */
export function resetLearnedOverlay(userData: string): void {
  try {
    rmSync(join(userData, 'message-overlay.json'), { force: true })
  } catch {
    // Never fatal: an absent file is the state this is trying to produce.
  }
}

/** What the launch actually left in its userData — for the one failure message that needs it. */
export function userDataListing(userData: string): string {
  try {
    const ring = join(userData, 'telemetry.json')
    const raw = existsSync(ring) ? readFileSync(ring, 'utf8').slice(0, 500) : 'telemetry.json absent'
    return `${readdirSync(userData).join(', ')} || ring: ${raw}`
  } catch (err) {
    return String(err)
  }
}

/**
 * THE LOG'S OWN LAST INSTANT, through the production line parser.
 *
 * A staged tail has to continue the log's timeline, not jump to wall-clock now. The fixture's last
 * line is weeks old, and appending "now" on top of it manufactures a multi-week EVENT-TIME HOLE —
 * which the world model treats as a logout (JOS-134: buff clocks freeze across an absence, and the
 * session frame holds the question open for `LOGIN_CONFIRM_MS` waiting for a login line that this
 * tail does not contain). That question's answer is wall-clock sensitive BY DESIGN, so two launches
 * a minute apart can legitimately resolve it differently — which is a property of the buffs model,
 * not of the checkpoint, and it is exactly why the differential harness pins a clock. Measured
 * here first: it showed up as one self-buff present in the later launch and absent from the earlier.
 */
export function lastLogInstant(logPath: string): Date {
  const text = readFileSync(logPath, 'utf8')
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].replace(/\r$/, ''))
    if (parsed) return new Date(parsed.ts)
  }
  return new Date()
}

/**
 * EVERY LINE THE MAIN PROCESS PRINTS, collected as it runs.
 *
 * The shadow verifier's whole answer — "the checkpoint matches a cold fold", or which modules
 * differed — is a `logInfo`, which goes to stdout and NOT to `errors.log` (errorLog.ts: `logInfo`
 * is `console.log` verbatim; only `logError` records). That is the right split for the product and
 * it leaves a test one place to look, so this is that place. It is also the reading an owner gets:
 * the dev app's terminal.
 */
export function mainOutput(app: ElectronApplication): { lines: string[] } {
  const lines: string[] = []
  const take = (chunk: unknown): void => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line.trim())
  }
  app.process().stdout?.on('data', take)
  app.process().stderr?.on('data', take)
  return { lines }
}

// ------------------------------------------------------------------------------ the hard kill

/**
 * KILL THE APP WITHOUT LETTING IT SAY GOODBYE — the whole point of the first launch.
 *
 * THIS IS THE OWNER'S REPRO, MECHANIZED. Phase 1 wrote a checkpoint only from `window-all-closed`
 * and `before-quit`; electron-vite's dev watcher KILLS its child and relaunches it, so the owner
 * ran with the preference on across a day of restarts, got no speedup, and found no file. The same
 * hole swallows a crash, an OS kill and a power cut. A graceful `app.close()` can never observe it.
 *
 * THE WHOLE TREE, not just the main process: on Windows a killed parent leaves its renderer
 * children running, and an orphaned Electron holding a temp dir is how a suite starts failing for
 * reasons that have nothing to do with the app.
 */
export async function hardKill(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    process.kill(pid, 'SIGKILL')
  }
  // Windows releases the process's handles a beat after the kill returns, and the next launch in
  // this spec opens the very same userData dir. Waiting on the process object is the condition;
  // the short sleep after it is for the file handles, which nothing exposes as one.
  await app.close().catch(() => undefined)
  await sleep(500)
}

// ------------------------------------------------------------------------------ the tail

/** A byte of the container, flipped. Enough to fail the whole-file digest — the loader's cheapest
 *  doubt — without changing the file's shape, so the refusal comes from the check rather than from
 *  a length nothing could parse. */
export function corruptCache(file: string): number {
  const bytes = readFileSync(file)
  // Past the magic and the schema word, so the failure is a DIGEST failure rather than a rejection
  // at the first eight bytes: it is the crash-mid-write case this is standing in for.
  const at = Math.floor(bytes.length / 2)
  bytes[at] = bytes[at] ^ 0xff
  writeFileSync(file, bytes)
  return at
}
