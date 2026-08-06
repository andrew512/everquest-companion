/**
 * build.mts — where the e2e suite gets its BINARIES: the checkout root, Node's own resolver
 * rooted at it, the out-e2e/ build gate and its cross-process lock, and the Electron executable.
 *
 * Split out of appHarness.mts, which the lock pushed past the 400-code-line factoring ceiling.
 * The split is also honest about the dependency shape: nothing here knows what a `Page` is, so
 * the runner (run-all.mts) can ask for a build without dragging playwright in behind it.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Node's own resolver, rooted at THIS checkout — never `join(ROOT, 'node_modules', …)`.
 *
 * A `git worktree` has no `node_modules` of its own but does have the repo root as a filesystem
 * ancestor, so the resolver's upward walk finds the real install while a hardcoded join finds
 * nothing. That difference is the whole reason the harness could not run in a worktree.
 */
const requireFromRoot = createRequire(join(ROOT, 'package.json'))

/**
 * Its OWN build output, never `out/`: the user keeps `npm run dev --watch` running, which
 * owns out/main + out/preload and rewrites them on every source edit. Building into out-e2e/
 * means the harness can never race that watcher (or leave a production bundle where the dev
 * app expects its own). The main bundle resolves preload/renderer relative to __dirname, so
 * an alternate root just works.
 */
const OUT_DIR = join(ROOT, 'out-e2e')
export const MAIN_ENTRY = join(OUT_DIR, 'main', 'index.js')

// ── build (reuse out-e2e/ when it's newer than every source file) ──────────────────────

function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

function isFresh(): boolean {
  let outMs = 0
  try {
    outMs = statSync(MAIN_ENTRY).mtimeMs
  } catch {
    outMs = 0
  }
  const srcMs = Math.max(
    newestMtime(join(ROOT, 'src')),
    statSync(join(ROOT, 'electron.vite.config.ts')).mtimeMs
  )
  return outMs > srcMs
}

/** electron-vite's CLI entry, via its package manifest — `bin` is the field that names it, and
 *  the subpath itself is not in the package's `exports` map, so it cannot be resolved directly. */
function electronViteCli(): string {
  const manifestPath = requireFromRoot.resolve('electron-vite/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: Record<string, string> | string
  }
  const rel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['electron-vite']
  if (!rel) throw new Error('e2e: electron-vite declares no bin entry')
  return join(dirname(manifestPath), rel)
}

const BUILD_LOCK = join(OUT_DIR, '.build-lock')
/** A build that has been holding the lock this long is a crashed one, not a slow one. */
const BUILD_LOCK_STALE_MS = 600_000

/** Reclaim a lock whose holder died. Separate from the wait loop below because the two throwing
 *  calls need their own try — and inlining it nests four blocks deep. */
function reclaimIfStale(): void {
  try {
    if (Date.now() - statSync(BUILD_LOCK).mtimeMs > BUILD_LOCK_STALE_MS) rmdirSync(BUILD_LOCK)
  } catch {
    // The holder finished between the two calls — the caller re-checks freshness anyway.
  }
}

/**
 * Take the build lock, or wait for whoever holds it. `mkdir` is the atomic primitive here (it
 * either creates or throws EEXIST — no read-then-write window), and the lock exists because
 * out-e2e/ is per CHECKOUT while runs are not: two invocations from one worktree would otherwise
 * both find the output stale and both rewrite main/index.js under each other's launching app.
 *
 * Returns false when the wait ended because someone ELSE produced a fresh build — there is then
 * nothing left to do and no lock to release.
 */
function acquireBuildLock(): boolean {
  for (let i = 0; i < 600; i++) {
    try {
      mkdirSync(BUILD_LOCK, { recursive: false })
      return true
    } catch {
      reclaimIfStale()
      if (isFresh()) return false
      // Synchronous by necessity — buildIfStale() is called before any await in every spec.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
  throw new Error(`e2e: the build lock at ${BUILD_LOCK} never cleared`)
}

export function buildIfStale(): void {
  if (isFresh()) {
    console.log(`build: ${OUT_DIR}/ is fresh — reusing it`)
    return
  }
  mkdirSync(OUT_DIR, { recursive: true })
  if (!acquireBuildLock()) {
    console.log(`build: ${OUT_DIR}/ was built by a concurrent run — reusing it`)
    return
  }
  try {
    if (isFresh()) {
      console.log(`build: ${OUT_DIR}/ is fresh — reusing it`)
      return
    }
    console.log(`build: electron-vite build --outDir=${OUT_DIR} (it is stale)…`)
    // ABSOLUTE outDir on purpose: electron-vite resolves a relative --outDir against each
    // section's own `root`, and the renderer's root is src/renderer — a relative 'out-e2e'
    // silently emits the HTML into src/renderer/out-e2e/ and the app then loads a 404.
    const res = spawnSync(
      process.execPath,
      [electronViteCli(), 'build', `--outDir=${OUT_DIR.replace(/\\/g, '/')}`],
      { cwd: ROOT, stdio: 'inherit' }
    )
    if (res.status !== 0) throw new Error(`electron-vite build failed (exit ${String(res.status)})`)
  } finally {
    try {
      rmdirSync(BUILD_LOCK)
    } catch {
      // Someone stole a lock we still held (only possible after BUILD_LOCK_STALE_MS).
    }
  }
}

/**
 * The Electron executable. `require('electron')` IS the answer — the package's index.js reads
 * its own `path.txt` and honours ELECTRON_OVERRIDE_DIST_PATH — so this asks it rather than
 * rebuilding its logic around a hardcoded dist/ path that no worktree has.
 */
export function electronBinary(): string {
  const exe: unknown = requireFromRoot('electron')
  if (typeof exe !== 'string') throw new Error('e2e: the electron package did not resolve to a path')
  return exe
}
