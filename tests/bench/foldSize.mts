/**
 * ============================================================================
 * foldSize.mts — WHAT THE CHECKPOINT ACTUALLY COSTS (JOS-208).
 * ============================================================================
 *
 * `npm run bench:fold-size [-- <logPath>]`
 *
 * Folds a WHOLE log through the real world builder, then measures the three numbers the rollout
 * decisions turn on, per unit and in total:
 *
 *   BLOB      — `v8.serialize(unit.serializeFold()).length`, i.e. the bytes that unit contributes.
 *   WRITE     — how long the real `writeCheckpoint` takes to produce the container on disk.
 *   RESTORE   — how long the real `readCheckpoint` takes to put it back into a fresh world, which
 *               is the number a launch actually pays and the one to hold against the cold read.
 *
 * IT USES THE PRODUCTION LOADER, not a hand-rolled encoder: a size measured over an object copy
 * would leave out the header, the three digests and the framing, and a restore time measured over
 * `deserializeFold` alone would leave out the identity block's bounded reads — which are the part
 * that touches the log file rather than the cache.
 *
 * DEFAULTS TO THE OWNER'S REAL LOG, because that is the only file at the scale the decisions are
 * about. The committed fixtures are 30–230 KB; the question "is the container heavy?" cannot be
 * asked of them at all. Pass a path to measure any other log.
 */
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize } from 'node:v8'
import { readCheckpoint, writeCheckpoint, writeCheckpointSync } from '../../src/main/foldCache/loader'
import { discoverEqRoot, fixedDrives, registryInstallCandidates, rootHasLogs } from '../../src/main/log/discovery'
import { buildFoldWorld, foldRange, HARNESS_CHARACTER } from '../foldCheckpointHarness.mts'

const CHARACTER_KEY = `${HARNESS_CHARACTER.name}@${HARNESS_CHARACTER.server}`.toLowerCase()

/**
 * The biggest log on this machine, through the app's own DISCOVERY — never a hardcoded path
 * (AGENTS.md), and not through `log/config.ts` either: that module reaches the electron-store and
 * cannot load outside Electron, which is the same reason `replay.bench.mts` calls `discoverEqRoot`
 * directly. `EQ_INSTALL_DIR` wins if it is set, exactly as the product honours it.
 */
function defaultLogPath(): string {
  const root =
    process.env.EQ_INSTALL_DIR ??
    discoverEqRoot({ hasLogs: rootHasLogs, extraCandidates: () => registryInstallCandidates(), fixedDrives })
  if (!root) throw new Error('no EQ install found — pass a log path as the first argument')
  const dir = join(root, 'Logs')
  const logs = readdirSync(dir)
    .filter((n) => /^eqlog_.+\.txt$/i.test(n))
    .map((n) => join(dir, n))
    .filter(existsSync)
    .sort((a, b) => statSync(b).size - statSync(a).size)
  if (logs.length === 0) throw new Error(`no eqlog_*.txt under ${dir}`)
  return logs[0]
}

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(2)} MB`

const logPath = process.argv[2] ?? defaultLogPath()
const logBytes = statSync(logPath).size
process.stdout.write(`Folding ${logPath} (${mb(logBytes)})…\n`)

const foldStart = performance.now()
const world = buildFoldWorld(logPath)
const folded = await foldRange(world, logPath, { from: 0, seq: 0 })
const foldMs = performance.now() - foldStart
process.stdout.write(`Cold fold: ${folded.seq.toLocaleString()} events in ${(foldMs / 1000).toFixed(1)} s\n\n`)

// ---------------------------------------------------------------- per-unit blob sizes
const rows = world.units
  .map((u) => ({ id: u.id, bytes: serialize(u.serializeFold()).length }))
  .sort((a, b) => b.bytes - a.bytes)
const blobTotal = rows.reduce((t, r) => t + r.bytes, 0)
process.stdout.write('unit             blob        share\n')
for (const r of rows) {
  const share = `${((r.bytes / blobTotal) * 100).toFixed(1)}%`.padStart(6)
  process.stdout.write(`${r.id.padEnd(16)}${kb(r.bytes).padStart(11)}${share}\n`)
}
process.stdout.write(`${'TOTAL (blobs)'.padEnd(16)}${kb(blobTotal).padStart(11)}\n\n`)

// ---------------------------------------------------------------- the real container
const dir = mkdtempSync(join(tmpdir(), 'eqfold-size-'))
const cachePath = join(dir, 'measure.eqfold')
const writeStart = performance.now()
const ok = await writeCheckpoint({
  cachePath,
  logPath,
  characterKey: CHARACTER_KEY,
  offset: folded.endOffset,
  seq: folded.seq,
  lastEventTs: 0,
  origin: 'replay',
  modules: world.units
})
const writeMs = performance.now() - writeStart
if (!ok) throw new Error('the checkpoint refused to write')
const containerBytes = statSync(cachePath).size

// THE QUIT WRITE, which is the SYNCHRONOUS one — a single `writeFileSync` on a dying process, and
// the one number that gets worse rather than better as the container grows. Measured separately
// because it is a different question from "what does a background write cost".
const syncStart = performance.now()
const syncOk = writeCheckpointSync({
  cachePath: join(dir, 'measure-sync.eqfold'),
  logPath,
  characterKey: CHARACTER_KEY,
  offset: folded.endOffset,
  seq: folded.seq,
  lastEventTs: 0,
  origin: 'quit',
  modules: world.units
})
const syncMs = performance.now() - syncStart
if (!syncOk) throw new Error('the synchronous checkpoint refused to write')

// ---------------------------------------------------------------- the real restore
const fresh = buildFoldWorld(logPath)
const restoreStart = performance.now()
const res = await readCheckpoint({ cachePath, logPath, characterKey: CHARACTER_KEY, modules: fresh.units })
const restoreMs = performance.now() - restoreStart
if (!res.restored) throw new Error(`the checkpoint refused to restore: ${res.why}`)

process.stdout.write(`container   ${mb(containerBytes)}  (${((containerBytes / logBytes) * 100).toFixed(2)}% of the log)\n`)
process.stdout.write(`write       ${writeMs.toFixed(0)} ms async (replay/quiet), ${syncMs.toFixed(0)} ms SYNCHRONOUS (quit)\n`)
process.stdout.write(`restore     ${restoreMs.toFixed(0)} ms  at byte ${res.offset.toLocaleString()}\n`)
process.stdout.write(`cold fold   ${(foldMs / 1000).toFixed(1)} s — what the restore replaces\n`)
