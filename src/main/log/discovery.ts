// EverQuest Legends install-root DISCOVERY (pure, dependency-free core).
//
// A friend installing the game should need zero config: the app sweeps sensible
// candidate install roots and picks the first one that actually holds a `Logs`
// directory with an `eqlog_*.txt` in it. A manual override (persisted in
// electron-store) always wins — that lives in config.ts's `resolveEqDir`, which
// is the ONLY consumer that needs the store. This module stays free of the store
// (and thus of electron) so the discovery logic is unit-testable under plain node.
//
// What a manual override MEANS is decided here too, by `normalizeEqDirOverride`
// (JOS-53): the install root, the `Logs` folder or a log file all resolve to the
// same `{ root, logsDir }` pair. See the block comment above that function.
//
// Discovery order (first hit wins, see `discoverEqRoot`):
//   1. `extraCandidates()` — env escape hatch, then registry InstallLocations.
//   2. `<drive>\<Daybreak subpath>` across every fixed drive.
// On THIS machine (2026-08) there are no Daybreak/EverQuest registry keys — the
// game lives at the public path — so discovery resolves via the drive sweep.

import { execFileSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/** The canonical Daybreak install root on a default EQ Legends install. */
export const EQ_ROOT =
  'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends'

/** Relative sub-paths (below a drive root) where a Daybreak install commonly lands. */
const DAYBREAK_SUBPATHS = [
  'Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  'Daybreak Game Company\\Installed Games\\EverQuest Legends',
  'Program Files\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  'Program Files (x86)\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  // Legacy Sony Online Entertainment layout (pre-Daybreak rename), just in case.
  'Users\\Public\\Sony Online Entertainment\\Installed Games\\EverQuest Legends',
  'Program Files (x86)\\Sony Online Entertainment\\Installed Games\\EverQuest Legends'
]

// ---------------------------------------------------------------------------
// Pure discovery core (injectable probes → unit-testable without a real disk /
// registry). The exported wrappers below bind the real fs + `reg query`.
// ---------------------------------------------------------------------------

export interface DiscoveryProbes {
  /** True if `<root>\Logs` exists AND contains at least one `eqlog_*.txt`. */
  hasLogs: (root: string) => boolean
  /** Ordered candidate roots to try before the drive sweep (env, registry). */
  extraCandidates: () => string[]
  /** Fixed-drive letters to sweep, e.g. ['C:', 'D:']. */
  fixedDrives: () => string[]
}

/** The character-log filename the game writes: `eqlog_<Char>_<server>.txt`. */
const EQLOG_RE = /^eqlog_.+\.txt$/i

/**
 * THE OUTCOME OF READING A LOGS DIR — three answers, never two (JOS-82).
 *
 * `countCharacterLogs` used to answer `0` for all of "the folder is not there", "the folder is
 * there and holds no character log" and "the OS refused to let me list the folder". The Settings
 * card then printed ONE sentence for all three — *"No character logs (eqlog_*.txt) found here.
 * Make sure EverQuest logging is enabled (/log on)"* — which is actively misleading for the third:
 * the user is looking at their files in Explorer while the app tells them to go turn logging on.
 * A prod reporter on 0.6.3 hit exactly that shape ("I pointed it directly to the log folder and it
 * said there were no character logs in that directory"), and a swallowed `readdir` throw is the
 * only way the app can say that about a folder that demonstrably has logs in it.
 *
 * So the read REPORTS ITS FAILURE. Callers that must keep moving (discovery's predicate) still
 * collapse it to "no", but the surface the user reads gets to say something true.
 */
export type LogsDirRead =
  /** The directory was listed successfully; `count` character logs are in it (possibly 0). */
  | { ok: true; count: number }
  /** The directory does not exist. */
  | { ok: false; reason: 'missing' }
  /** The directory exists but could not be listed — permissions, a dead junction, an offline share. */
  | { ok: false; reason: 'unreadable'; code: string }

/**
 * List a Logs dir and count its `eqlog_*.txt` files, distinguishing a FAILED read from an empty
 * one. `existsSync` is not consulted first: a single `readdirSync` answers both questions and
 * cannot race between them (a dir can vanish between the two calls), and ENOENT is exactly the
 * "missing" answer.
 */
export function readLogsDir(logsDir: string): LogsDirRead {
  try {
    return { ok: true, count: readdirSync(logsDir).filter((f) => EQLOG_RE.test(f)).length }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    // ENOENT (nothing there) and ENOTDIR (a FILE where a directory was expected) are both
    // "there is no such directory" — neither is a permission story and neither should be
    // reported to the user as one.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'unreadable', code: code ?? 'UNKNOWN' }
  }
}

/**
 * Does `<root>\Logs` hold at least one character log? The discovery predicate.
 *
 * A dir we cannot read is `false` here on purpose — discovery is a sweep over candidate roots
 * and must keep moving. The honest three-way answer is for the folder the user CHOSE, which is
 * `resolveEqDir`'s business, not the sweep's.
 */
export function rootHasLogs(root: string): boolean {
  const read = readLogsDir(join(root, 'Logs'))
  return read.ok && read.count > 0
}

/** Count the `eqlog_*.txt` files under a Logs dir (0 if the dir is absent or unreadable). */
export function countCharacterLogs(logsDir: string): number {
  const read = readLogsDir(logsDir)
  return read.ok ? read.count : 0
}

/** Does this directory hold an `eqlog_*.txt` DIRECTLY (i.e. is it itself a Logs dir)? */
export function dirHasCharacterLogs(dir: string): boolean {
  return countCharacterLogs(dir) > 0
}

// ---------------------------------------------------------------------------
// MANUAL-OVERRIDE NORMALIZATION — "wherever the user points it" (JOS-53).
//
// The override used to be trusted VERBATIM as the install ROOT, with `Logs` joined onto it.
// Two prod reports on 2026-08-06 (installs 23e958f4… and 88f3835a…) hit the other reading:
// they pointed the picker at their `…\EverQuest Legends\Logs` folder — the folder that
// literally contains the file the app is looking for — and got "no logs detected", because
// we then looked in `…\Logs\Logs`. One of them filed a second report apologizing for
// "total user error". That is the signature of a SILENT WRONG ANSWER: the app resolved a
// path with source 'manual' and characterCount 0 and never said the folder it actually read.
//
// So the seam normalizes instead of trusting. Three shapes a reasonable person picks:
//   * a log FILE (`eqlog_*.txt`)          → its folder is the Logs dir, its parent the root
//   * the `Logs` folder itself            → it is the Logs dir, its parent the root
//   * the install ROOT (a `Logs` subdir)  → unchanged, this is what already worked
// Anything else keeps the old behavior (root as given), and `characterCount` tells the
// Settings pane the truth as it always did.
//
// It is a pure function over injected probes so the whole table is unit-tested against temp
// dirs, and — because it runs at RESOLUTION time, not at save time — an override that was
// already persisted in a broken shape starts working on upgrade with no re-save.
// ---------------------------------------------------------------------------

/** The filesystem questions override normalization asks. Injected → testable. */
export interface OverrideProbes {
  /** Is this an existing directory? */
  isDir: (p: string) => boolean
  /** Is this an existing FILE (as opposed to a directory / nothing)? */
  isFile: (p: string) => boolean
  /** Does this directory hold an `eqlog_*.txt` directly? */
  hasCharacterLogs: (dir: string) => boolean
}

/** The two paths every consumer needs, resolved from one user-supplied path. */
export interface NormalizedEqDir {
  /** The install root (`<root>\Logs` is the log directory). */
  root: string
  /** The directory the `eqlog_*.txt` files actually live in. */
  logsDir: string
}

/**
 * Drop trailing separators — but never turn a drive root (`D:\`) into a bare drive
 * (`D:`), which Windows reads as "the current directory ON D:" and which `join`
 * would happily concatenate into `D:Logs`.
 */
function stripTrailingSep(p: string): string {
  const t = p.replace(/[\\/]+$/, '')
  if (t === '') return p
  return /^[A-Za-z]:$/.test(t) ? `${t}\\` : t
}

/** Index of the last separator of either flavour (paths reach us from store, picker and env). */
function lastSep(p: string): number {
  return Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
}

/** The last path segment, separator- and trailing-slash-tolerant. */
function baseSegment(p: string): string {
  const t = stripTrailingSep(p)
  const cut = lastSep(t)
  return cut < 0 ? t : t.slice(cut + 1)
}

/** The containing directory, separator- and trailing-slash-tolerant. */
function parentDir(p: string): string {
  const t = stripTrailingSep(p)
  const cut = lastSep(t)
  if (cut < 0) return t
  const parent = t.slice(0, cut)
  if (parent === '') return t.slice(0, cut + 1)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

/**
 * Resolve one user-supplied path into `{ root, logsDir }`. See the block comment above for
 * why. The order of the tests is deliberate:
 *   1. a FILE is reasoned about through its containing folder (a picked `eqlog_*.txt`, or
 *      anything else sitting in the install — the folder is the useful part either way);
 *   2. a folder NAMED `Logs` is the log directory (case-insensitive; true even when logging
 *      has never been turned on, which is exactly when it holds no `eqlog_*.txt` to detect);
 *   3. a folder holding a `Logs` SUBDIR is the install root — this is the shape that already
 *      worked and it is tested before the content sniff so the pathological folder that is
 *      both stays interpreted the way it is today;
 *   4. a folder holding `eqlog_*.txt` directly is the log directory whatever it is called;
 *   5. anything else (a typo, an unplugged drive, a folder with neither) keeps the old
 *      behavior — root as given, `<root>\Logs` beneath it.
 */
export function normalizeEqDirOverride(picked: string, probes: OverrideProbes): NormalizedEqDir {
  const path = stripTrailingSep(picked.trim())
  const asRoot = (root: string): NormalizedEqDir => ({ root, logsDir: join(root, 'Logs') })

  const dir = probes.isFile(path) ? parentDir(path) : path
  if (!probes.isDir(dir)) return asRoot(path)
  if (baseSegment(dir).toLowerCase() === 'logs') return { root: parentDir(dir), logsDir: dir }
  if (probes.isDir(join(dir, 'Logs'))) return asRoot(dir)
  if (probes.hasCharacterLogs(dir)) return { root: parentDir(dir), logsDir: dir }
  return asRoot(dir)
}

/** The real-filesystem probe set for `normalizeEqDirOverride`. */
export function realOverrideProbes(): OverrideProbes {
  const stat = (p: string): ReturnType<typeof statSync> | undefined => {
    try {
      return statSync(p, { throwIfNoEntry: false })
    } catch {
      // A path we cannot stat (permissions, a disconnected UNC share) is "not there".
      return undefined
    }
  }
  return {
    isDir: (p) => stat(p)?.isDirectory() ?? false,
    isFile: (p) => stat(p)?.isFile() ?? false,
    hasCharacterLogs: dirHasCharacterLogs
  }
}

/**
 * Normalize a Windows path for comparison: one separator style, no trailing
 * separator, case-folded (NTFS is case-insensitive and the log/override paths
 * reach us from three different sources — the store, a folder picker, readdir).
 */
function normPath(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** Is `logPath` a file sitting DIRECTLY in `logsDir` (not merely existing somewhere)? */
export function logIsUnderLogsDir(logPath: string, logsDir: string): boolean {
  const dir = normPath(logsDir)
  const file = normPath(logPath)
  const cut = file.lastIndexOf('\\')
  return cut > 0 && file.slice(0, cut) === dir
}

/**
 * THE ROOT-CHANGE DECISION, pure and injected so it can be tested without a disk.
 *
 * When the effective EQ root moves (the Settings override is set or cleared), may the tail
 * that is already running survive it? ONLY if its log lives under the NEW `Logs` dir and is
 * still there. "The file still exists" is NOT sufficient and was the bug: a user whose game
 * lives off the default path gets auto-discovery pointed somewhere else (or nowhere), and if
 * anything was being tailed from the OLD root its file is still perfectly readable — so the
 * app kept reading it and the folder the user just picked did nothing until a restart.
 */
export function tailSurvivesRootChange(
  logPath: string | null | undefined,
  logsDir: string,
  exists: (p: string) => boolean
): boolean {
  if (!logPath) return false
  return logIsUnderLogsDir(logPath, logsDir) && exists(logPath)
}

/**
 * Pure ordered discovery: return the first candidate root whose `Logs` dir holds
 * an `eqlog_*.txt`, or null if none match. Candidates, in order:
 *   1. `extraCandidates()` (env override, then registry InstallLocations)
 *   2. `<drive>\<subpath>` for every fixed drive × every Daybreak subpath
 * Duplicates are collapsed so a candidate is probed at most once.
 */
export function discoverEqRoot(probes: DiscoveryProbes): string | null {
  const seen = new Set<string>()
  const candidates: string[] = []
  const push = (c: string | undefined | null): void => {
    if (!c) return
    const key = c.replace(/[\\/]+$/, '').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(c)
  }

  for (const c of probes.extraCandidates()) push(c)
  for (const drive of probes.fixedDrives()) {
    const d = drive.replace(/[\\/]+$/, '')
    for (const sub of DAYBREAK_SUBPATHS) push(`${d}\\${sub}`)
  }

  for (const c of candidates) if (probes.hasLogs(c)) return c
  return null
}

// ---------------------------------------------------------------------------
// Real-environment probes (fs + registry). Defensive: absent keys / drives are
// fine and never throw.
// ---------------------------------------------------------------------------

/** Enumerate fixed-drive roots (e.g. ['C:', 'D:']). Falls back to ['C:']. */
export function fixedDrives(): string[] {
  const found: string[] = []
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const letter = String.fromCharCode(code)
    if (existsSync(`${letter}:\\`)) found.push(`${letter}:`)
  }
  return found.length > 0 ? found : ['C:']
}

/**
 * Pull an install path out of ONE `reg query /s` output line: we grep the
 * "InstallLocation"/"InstallPath"/"InstallDir" REG_SZ lines. Returns null when the
 * line isn't one of those (or carries an empty value).
 */
function installPathFromRegLine(line: string): string | null {
  const m = /\b(?:InstallLocation|InstallPath|InstallDir)\b\s+REG_SZ\s+(.+?)\s*$/i.exec(line)
  if (!m) return null
  const p = m[1].trim()
  return p ? p : null
}

/**
 * Probe the Windows registry (defensively) for an EverQuest / Daybreak install
 * location. Checks the standard Uninstall hives (both HKLM 64/32-bit views and
 * HKCU) plus Daybreak/SOE launcher keys. Returns any `InstallLocation` /
 * `InstallPath` string values found — most machines have none (the game is a
 * public-folder install), which is fine.
 */
export function registryInstallCandidates(): string[] {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Daybreak Game Company',
    'HKLM\\SOFTWARE\\WOW6432Node\\Daybreak Game Company',
    'HKCU\\SOFTWARE\\Daybreak Game Company',
    'HKLM\\SOFTWARE\\WOW6432Node\\Sony Online Entertainment',
    'HKCU\\SOFTWARE\\Sony Online Entertainment'
  ]
  const out: string[] = []
  for (const key of keys) {
    // Search the subtree for value names holding an install path. `reg query /s`
    // walks recursively; we grep the "InstallLocation"/"InstallPath" REG_SZ lines
    // (see installPathFromRegLine).
    let stdout = ''
    try {
      stdout = execFileSync('reg', ['query', key, '/s', '/f', 'EverQuest', '/t', 'REG_SZ'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      // Absent key or no match → reg exits non-zero. Fine; try the next.
      continue
    }
    for (const line of stdout.split(/\r?\n/)) {
      const p = installPathFromRegLine(line)
      if (p) out.push(p)
    }
  }
  return out
}
