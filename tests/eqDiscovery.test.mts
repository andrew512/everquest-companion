// EQ INSTALL-DIR DISCOVERY TEST (fresh-machine config feature): the pure, ordered
// candidate-resolution logic that lets a friend's fresh install "just work" with no
// config, plus the fs predicates it relies on.
//
// Two layers, both PURE / injectable so no real registry or C:\ layout is needed:
//   1. discoverEqRoot(probes) — the ordered sweep: extraCandidates (env → registry)
//      FIRST, then <drive> × Daybreak-subpath, first candidate whose Logs dir holds
//      an eqlog_*.txt wins; duplicates probed at most once; null when nothing matches.
//   2. rootHasLogs / countCharacterLogs — exercised against REAL temp fixture dirs
//      (an install root with a Logs\eqlog_*.txt, an empty one, a missing one).
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  discoverEqRoot,
  rootHasLogs,
  countCharacterLogs,
  logIsUnderLogsDir,
  tailSurvivesRootChange,
  type DiscoveryProbes
} from '../src/main/log/discovery'

// --- discoverEqRoot ordering (fully injected probes) ------------------------

/** A probe set where `withLogs` is the ONLY root reporting logs. */
function probes(withLogs: Set<string>, drives: string[], extra: string[] = []): DiscoveryProbes {
  return {
    hasLogs: (root) => withLogs.has(root.replace(/[\\/]+$/, '').toLowerCase()),
    extraCandidates: () => extra,
    fixedDrives: () => drives
  }
}

const lc = (s: string): string => s.replace(/[\\/]+$/, '').toLowerCase()

test('discoverEqRoot: default public path on C: is found by the drive sweep', () => {
  const target = 'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends'
  const root = discoverEqRoot(probes(new Set([lc(target)]), ['C:', 'D:']))
  assert.equal(root, target)
})

test('discoverEqRoot: sweeps other fixed drives (install on D:)', () => {
  const target = 'D:\\Daybreak Game Company\\Installed Games\\EverQuest Legends'
  const root = discoverEqRoot(probes(new Set([lc(target)]), ['C:', 'D:']))
  assert.equal(root, target)
})

test('discoverEqRoot: an extra candidate (env/registry) wins over the drive sweep', () => {
  const reg = 'E:\\Games\\EQL'
  const publicPath = 'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends'
  // BOTH have logs; the extra candidate is probed first, so it wins.
  const root = discoverEqRoot(probes(new Set([lc(reg), lc(publicPath)]), ['C:'], [reg]))
  assert.equal(root, reg)
})

test('discoverEqRoot: returns null when nothing has logs (fresh machine)', () => {
  const root = discoverEqRoot(probes(new Set(), ['C:', 'D:'], ['Z:\\nope']))
  assert.equal(root, null)
})

test('discoverEqRoot: probes each candidate at most once (dedupe)', () => {
  const seen: string[] = []
  const target = 'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends'
  const p: DiscoveryProbes = {
    hasLogs: (root) => {
      seen.push(root)
      return lc(root) === lc(target)
    },
    // Duplicate the target as an extra candidate + it's also produced by the sweep.
    extraCandidates: () => [target, target],
    fixedDrives: () => ['C:']
  }
  const root = discoverEqRoot(p)
  assert.equal(root, target)
  // The target should appear exactly once in the probe log (found on first hit).
  const hits = seen.filter((s) => lc(s) === lc(target))
  assert.equal(hits.length, 1)
})

// --- the ROOT-CHANGE decision (bug 01KZ9BF43KYH…) ---------------------------
//
// When the user picks a new EverQuest folder in Settings, may the tail that is already
// running survive it? The old rule was "does its file still exist", which is true of every
// log under the OLD root — so the folder the user just picked did nothing until a restart.
// The rule is "is it under the NEW Logs dir, and still there".

const NEW_LOGS = 'D:\\Games\\EverQuest Legends\\Logs'
const yes = (): boolean => true
const no = (): boolean => false

test('logIsUnderLogsDir: a log directly in the dir matches, case/separator-insensitively', () => {
  assert.equal(logIsUnderLogsDir(`${NEW_LOGS}\\eqlog_Primitive_freeport.txt`, NEW_LOGS), true)
  // NTFS is case-insensitive and these paths arrive from three sources (store, picker, readdir).
  assert.equal(logIsUnderLogsDir('d:/games/everquest legends/logs/eqlog_A_b.txt', NEW_LOGS), true)
  // A trailing separator on the dir is not a difference.
  assert.equal(logIsUnderLogsDir(`${NEW_LOGS}\\eqlog_A_b.txt`, `${NEW_LOGS}\\`), true)
})

test('logIsUnderLogsDir: a log under a DIFFERENT root does not match', () => {
  const oldLog =
    'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\Logs\\eqlog_A_b.txt'
  assert.equal(logIsUnderLogsDir(oldLog, NEW_LOGS), false)
})

test('logIsUnderLogsDir: a nested subdirectory is not "in" the Logs dir', () => {
  assert.equal(logIsUnderLogsDir(`${NEW_LOGS}\\archive\\eqlog_A_b.txt`, NEW_LOGS), false)
  // …and a prefix that is not a path boundary must not match either.
  assert.equal(logIsUnderLogsDir('D:\\Games\\EverQuest Legends\\LogsOld\\eqlog_A_b.txt', NEW_LOGS), false)
})

test('tailSurvivesRootChange: the reported bug — an existing OLD-root log does not survive', () => {
  const oldLog =
    'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\Logs\\eqlog_A_b.txt'
  // The file is perfectly readable (exists → true) and that is exactly what used to keep it.
  assert.equal(tailSurvivesRootChange(oldLog, NEW_LOGS, yes), false)
})

test('tailSurvivesRootChange: a healthy tail under the same dir is not disturbed', () => {
  assert.equal(tailSurvivesRootChange(`${NEW_LOGS}\\eqlog_A_b.txt`, NEW_LOGS, yes), true)
})

test('tailSurvivesRootChange: a vanished log under the new dir does not survive', () => {
  assert.equal(tailSurvivesRootChange(`${NEW_LOGS}\\eqlog_A_b.txt`, NEW_LOGS, no), false)
})

test('tailSurvivesRootChange: nothing attached ⇒ nothing to keep', () => {
  assert.equal(tailSurvivesRootChange(null, NEW_LOGS, yes), false)
  assert.equal(tailSurvivesRootChange(undefined, NEW_LOGS, yes), false)
  assert.equal(tailSurvivesRootChange('', NEW_LOGS, yes), false)
})

// --- rootHasLogs / countCharacterLogs against real temp fixtures ------------

test('rootHasLogs / countCharacterLogs: real fixture dirs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eq-disc-'))
  try {
    // 1. A proper install root: <root>\Logs\eqlog_*.txt (+ a non-log file).
    const good = join(tmp, 'good')
    mkdirSync(join(good, 'Logs'), { recursive: true })
    writeFileSync(join(good, 'Logs', 'eqlog_Primitive_freeport.txt'), '[Sat] hi\n')
    writeFileSync(join(good, 'Logs', 'eqlog_Alt_halas.txt'), '[Sat] hi\n')
    writeFileSync(join(good, 'Logs', 'MemoryStrategy.txt'), 'not a log\n')

    // 2. A Logs dir with NO character logs.
    const emptyLogs = join(tmp, 'emptyLogs')
    mkdirSync(join(emptyLogs, 'Logs'), { recursive: true })
    writeFileSync(join(emptyLogs, 'Logs', 'dbg.txt'), 'nope\n')

    // 3. A root with no Logs dir at all.
    const noLogsDir = join(tmp, 'noLogs')
    mkdirSync(noLogsDir, { recursive: true })

    assert.equal(rootHasLogs(good), true)
    assert.equal(rootHasLogs(emptyLogs), false)
    assert.equal(rootHasLogs(noLogsDir), false)
    assert.equal(rootHasLogs(join(tmp, 'does-not-exist')), false)

    assert.equal(countCharacterLogs(join(good, 'Logs')), 2)
    assert.equal(countCharacterLogs(join(emptyLogs, 'Logs')), 0)
    assert.equal(countCharacterLogs(join(tmp, 'does-not-exist')), 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('discovery is re-runnable: the same root fails before /log on and succeeds after', () => {
  // The reported bug's shape (01KZ9BF43KYH…): a player who has never enabled EQ logging has no
  // eqlog_*.txt at all, so the folder they pick legitimately resolves to nothing. The moment
  // `/log on` creates the file, the SAME probe set must answer differently — which is what makes
  // an idle rescan (session.ts `watchForFirstLog`) a correct fix rather than a hopeful one.
  const tmp = mkdtempSync(join(tmpdir(), 'eq-disc3-'))
  try {
    const install = join(tmp, 'Games', 'EverQuest Legends')
    mkdirSync(join(install, 'Logs'), { recursive: true })
    const p: DiscoveryProbes = {
      hasLogs: rootHasLogs,
      extraCandidates: () => [install],
      fixedDrives: () => []
    }
    assert.equal(discoverEqRoot(p), null, 'a Logs dir with no character log is not a match')
    assert.equal(countCharacterLogs(join(install, 'Logs')), 0)

    writeFileSync(join(install, 'Logs', 'eqlog_Primitive_freeport.txt'), '[Wed] *ON*\n')

    assert.equal(discoverEqRoot(p), install)
    assert.equal(countCharacterLogs(join(install, 'Logs')), 1)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('discoverEqRoot: end-to-end with the real rootHasLogs predicate over a temp drive layout', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eq-disc2-'))
  try {
    // Simulate a "drive" dir that contains the Daybreak public sub-path with logs.
    const install = join(
      tmp,
      'Users',
      'Public',
      'Daybreak Game Company',
      'Installed Games',
      'EverQuest Legends'
    )
    mkdirSync(join(install, 'Logs'), { recursive: true })
    writeFileSync(join(install, 'Logs', 'eqlog_Primitive_freeport.txt'), '[Sat] hi\n')

    // Point the extra-candidate probe at the temp install root directly (the drive
    // sweep uses Windows-only `<drive>\...` paths, so we feed the real predicate a
    // POSIX temp path via extraCandidates to keep the test OS-agnostic).
    const root = discoverEqRoot({
      hasLogs: rootHasLogs,
      extraCandidates: () => [install, join(tmp, 'nope')],
      fixedDrives: () => []
    })
    assert.equal(root, install)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
