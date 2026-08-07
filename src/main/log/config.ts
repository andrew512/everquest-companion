import { existsSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { CharacterRef } from '../../shared/types'
import { getEqInstallDir } from '../store'
import {
  EQ_ROOT,
  countCharacterLogs,
  dirHasCharacterLogs,
  discoverEqRoot,
  fixedDrives,
  logIsUnderLogsDir,
  normalizeEqDirOverride,
  readLogsDir,
  realOverrideProbes,
  registryInstallCandidates,
  rootHasLogs,
  tailSurvivesRootChange,
  type DiscoveryProbes,
  type LogsDirRead,
  type NormalizedEqDir,
  type OverrideProbes
} from './discovery'

/**
 * EQ install-dir resolution. The pure, store-free discovery core lives in
 * `discovery.ts` (unit-tested); this module binds it to the persisted override
 * (electron-store `eqInstallDir`) and exposes the ONE resolver every path
 * consumer uses (`effectiveEqRoot` / `eqLogsDir`). Do NOT hardcode the Daybreak
 * path anywhere else — route through here so the override + discovery apply
 * uniformly to log listing/tailing AND the inventory scan.
 */

// Re-export the canonical default + pure discovery pieces so existing importers of
// `../log/config` keep working (EQ_ROOT was imported by inventory/parseInventory).
export {
  EQ_ROOT,
  discoverEqRoot,
  dirHasCharacterLogs,
  rootHasLogs,
  countCharacterLogs,
  logIsUnderLogsDir,
  normalizeEqDirOverride,
  readLogsDir,
  tailSurvivesRootChange,
  type DiscoveryProbes,
  type LogsDirRead,
  type NormalizedEqDir,
  type OverrideProbes
}

/**
 * The env escape hatch: an explicit install dir (tests/dev), highest priority.
 *
 * Each value is offered VERBATIM first — that is the shape the e2e harness supplies
 * (`tests/e2e/logFixture.mts` stages `<tmp>\Logs\eqlog_*.txt` and hands over `<tmp>`),
 * and it must keep resolving on the same first probe it always did. The NORMALIZED
 * reading follows as an additional candidate, so `EQ_INSTALL_DIR` pointed at a `Logs`
 * folder or a log file gets the same tolerance the persisted override now has
 * (JOS-53). `discoverEqRoot` dedupes, so when the two agree nothing is probed twice.
 */
function envCandidates(): string[] {
  const out: string[] = []
  const probes = realOverrideProbes()
  const dir = process.env.EQ_INSTALL_DIR
  if (dir) out.push(dir, normalizeEqDirOverride(dir, probes).root)
  // EQ_LOG_PATH points at a log FILE; its grandparent is the install root
  // (<root>\Logs\eqlog_*.txt). Kept for back-compat with the old override — the
  // literal grandparent join stays first so a path that does not exist yet still
  // yields the same candidate it used to.
  const logPath = process.env.EQ_LOG_PATH
  if (logPath) out.push(join(logPath, '..', '..'), normalizeEqDirOverride(logPath, probes).root)
  return out
}

/** The real-environment discovery probes (env → registry → drive sweep). */
function realProbes(): DiscoveryProbes {
  return {
    hasLogs: rootHasLogs,
    extraCandidates: () => [...envCandidates(), ...registryInstallCandidates()],
    fixedDrives
  }
}

/**
 * MEMOIZED DISCOVERY — measured, not a micro-optimization (docs/plans/chunked-replay.md's
 * blocked-main directive; the evidence is in `.bench/replay.jsonl` and the diagnosis below).
 *
 * `discoverEqRoot(realProbes())` spawns EIGHT synchronous `reg query … /s` subprocesses over the
 * whole Uninstall hive and then stats six candidate paths on every fixed drive. MEASURED at
 * ~150 ms, synchronously, on the main process — and `resolveEqDir()` is not a startup-only call:
 * the `character:list` IPC runs it while the renderer is hydrating (it was the ONE main-loop stall
 * left in an otherwise chunked replay — 77/90/106/160 ms across four boots, always at ~1.1 s,
 * always inside `character:list`), the Settings pane runs it, and `presence.ts` runs it on every
 * watcher tick.
 *
 * So the ANSWER is cached for the process, with the two escape hatches that keep it honest:
 *   * a cached hit is RE-VALIDATED with `rootHasLogs` — one readdir — so an install that moves or
 *     is uninstalled under us re-probes immediately rather than serving a dead path forever;
 *   * `invalidateEqDiscovery()` drops it outright, and is called when the user changes the manual
 *     override (session.ts's `applyEqDirChange`) — the one moment a person can tell us that where
 *     EQ lives has changed.
 * Nothing else is cached: `countCharacterLogs` still reads the directory on every call, because
 * "how many characters are there" changes while the app runs and is one cheap readdir.
 */
let discoveredRoot: string | null | undefined

function discoverOnce(): string | null {
  if (discoveredRoot !== undefined) {
    if (discoveredRoot === null) return null
    if (rootHasLogs(discoveredRoot)) return discoveredRoot
  }
  discoveredRoot = discoverEqRoot(realProbes())
  return discoveredRoot
}

/** Forget the discovered root, so the next resolution probes the machine again. */
export function invalidateEqDiscovery(): void {
  discoveredRoot = undefined
}

/**
 * CHEAP re-discovery, for the idle rescan only (session.ts `watchForFirstLog`).
 *
 * `discoverOnce` memoizes a NULL result too, which is right for the 150 ms registry sweep but
 * wrong for a machine that simply had no `eqlog_*.txt` yet: the player types `/log on`, the log
 * appears, and discovery's own predicate ("a Logs dir with a character log in it") would now
 * succeed — except nothing re-probes. So the idle path re-runs discovery with the FS half only:
 * env candidates + the drive sweep, no `reg query` subprocesses. That is a dozen `existsSync`
 * calls, affordable every couple of seconds, and it covers the install that discovery could
 * always have found and simply looked for too early. A manual override needs no discovery at
 * all and returns immediately; a memoized root that still has logs is left alone.
 */
export function refreshEqDiscoveryCheaply(): void {
  if (getEqInstallDir()?.trim()) return
  if (discoveredRoot && rootHasLogs(discoveredRoot)) return
  const found = discoverEqRoot({ hasLogs: rootHasLogs, extraCandidates: envCandidates, fixedDrives })
  if (found) discoveredRoot = found
}

// ---------------------------------------------------------------------------
// Effective-root resolver — the ONE entry point every path consumer uses.
// ---------------------------------------------------------------------------

export type EqDirSource = 'manual' | 'auto' | 'default'

export interface ResolvedEqDir {
  /** The effective install root in use. */
  root: string
  /** The directory the `eqlog_*.txt` files live in — `<root>\Logs` as the game spells it. */
  logsDir: string
  /** How `root` was chosen: a saved override, auto-discovery, or the fallback. */
  source: EqDirSource
  /** Number of `eqlog_*.txt` character logs found under `logsDir` (0 = none, or unread). */
  characterCount: number
  /** How reading `logsDir` went — a FAILED read is not "no logs" (JOS-82). */
  readable: 'ok' | 'missing' | 'unreadable'
  /** The OS errno when `readable === 'unreadable'` (e.g. 'EPERM'). Undefined otherwise. */
  readError?: string
}

/** Fold one `readLogsDir` answer into the count + verdict every consumer reads. */
function describeLogsDir(logsDir: string): Pick<
  ResolvedEqDir,
  'characterCount' | 'readable' | 'readError'
> {
  const read = readLogsDir(logsDir)
  if (read.ok) return { characterCount: read.count, readable: 'ok' }
  if (read.reason === 'missing') return { characterCount: 0, readable: 'missing' }
  return { characterCount: 0, readable: 'unreadable', readError: read.code }
}

/**
 * Resolve the effective EQ install root: the persisted manual override if set,
 * else auto-discovery, else the canonical default (so the UI always has a path
 * to show even on a machine with no install yet). This is the single source of
 * truth for `effectiveEqRoot()` / `eqLogsDir()` and the Settings panel.
 *
 * THE OVERRIDE IS NORMALIZED, NOT TRUSTED (JOS-53). `normalizeEqDirOverride` decides
 * what the path the user picked actually IS — install root, `Logs` folder, or a log
 * file — because two prod reports proved that "the folder with my log in it" is a
 * reading a reasonable person picks and the old verbatim-as-root reading answered it
 * with a silent `…\Logs\Logs` and "no logs detected". Normalizing HERE, at resolution
 * time rather than at save time, is also what makes an override that is already
 * persisted in a broken shape start working on upgrade with no re-save.
 *
 * Discovery is untouched by this: it returns a root by construction (its predicate IS
 * `<root>\Logs` holding a log), and so does the default.
 */
export function resolveEqDir(): ResolvedEqDir {
  const override = getEqInstallDir()?.trim()
  if (override) {
    const { root, logsDir } = normalizeEqDirOverride(override, realOverrideProbes())
    return { root, logsDir, source: 'manual', ...describeLogsDir(logsDir) }
  }
  const discovered = discoverOnce()
  const root = discovered ?? EQ_ROOT
  const source: EqDirSource = discovered ? 'auto' : 'default'
  const logsDir = join(root, 'Logs')
  return { root, logsDir, source, ...describeLogsDir(logsDir) }
}

/** The effective install root (override ?? discovery ?? default). */
export function effectiveEqRoot(): string {
  return resolveEqDir().root
}

/** The effective `<root>\Logs` directory every log consumer reads from. */
export function eqLogsDir(): string {
  return resolveEqDir().logsDir
}

// ---------------------------------------------------------------------------
// Character-log listing / active-character resolution (now dir-resolver-driven).
// ---------------------------------------------------------------------------

/** Parse "eqlog_<Character>_<server>.txt" into a CharacterRef. */
export function parseLogName(logPath: string): CharacterRef | null {
  const m = /^eqlog_(.+?)_(.+?)\.txt$/i.exec(basename(logPath))
  if (!m) return null
  const lastPlayed = existsSync(logPath) ? statSync(logPath).mtimeMs : undefined
  return { name: m[1], server: m[2], logPath, lastPlayed }
}

/** Stable id for a character (used to key per-character progress). */
export function characterId(c: CharacterRef): string {
  return `${c.name}_${c.server}`.toLowerCase()
}

/** All detected character logs, most-recently-played first. */
export function listCharacters(): CharacterRef[] {
  const logsDir = eqLogsDir()
  if (!existsSync(logsDir)) return []
  return readdirSync(logsDir)
    .filter((f) => /^eqlog_.+\.txt$/i.test(f))
    .map((f) => parseLogName(join(logsDir, f)))
    .filter((c): c is CharacterRef => c !== null)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

/**
 * Locate the active character log. Preference order:
 * 1. an explicit override (env EQ_LOG_PATH)
 * 2. the most recently modified eqlog_*.txt in the effective Logs dir
 * Returns null when nothing is found (fresh machine — the UI shows an empty
 * state pointing at the Settings gear rather than erroring).
 */
export function resolveActiveCharacter(): CharacterRef | null {
  const override = process.env.EQ_LOG_PATH
  if (override && existsSync(override)) {
    return parseLogName(override) ?? { name: 'Unknown', server: 'unknown', logPath: override }
  }
  const logsDir = eqLogsDir()
  if (!existsSync(logsDir)) return null

  const candidates = readdirSync(logsDir)
    .filter((f) => /^eqlog_.+\.txt$/i.test(f))
    .map((f) => join(logsDir, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  if (candidates.length === 0) return null
  return parseLogName(candidates[0].p)
}
