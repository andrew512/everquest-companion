// ============================================================================
// outputs/watch.ts — the shared watcher layer for `/outputfile` dumps.
// ============================================================================
//
// EQ REWRITES a dump file wholesale every time the player runs `/outputfile <kind>`, so the
// interesting event is "the file settled after a rewrite", not "a byte changed". That is
// what `awaitWriteFinish` buys: chokidar holds the change until the size has been stable
// for `stabilityThreshold` ms, so a consumer never reads a half-written table.
//
// The numbers below were the inventory watcher's from the day it shipped (session.ts) and
// are preserved exactly — this module is a generalization of that watcher, not a retune.
// One place to change them means every future kind inherits the same settle behavior.

import { watch, type FSWatcher } from 'chokidar'
import { basename } from 'path'

/** Hold a change until the file has been the same size for this long (ms). */
const STABILITY_THRESHOLD_MS = 400
/** How often to re-check the size while waiting (ms). */
const POLL_INTERVAL_MS = 100

export interface OutputWatchHandlers {
  /** The file finished being rewritten. */
  onChange: () => void
  /** The watcher itself failed (permissions, the file vanished, …). */
  onError: (err: unknown) => void
}

/**
 * Watch ONE dump file for rewrites. Returns the watcher so the owner can close it —
 * ownership of the lifecycle stays with the caller (session.ts closes on character switch
 * and on quit), because only the caller knows when its subject changed.
 */
export function watchOutputFile(path: string, handlers: OutputWatchHandlers): FSWatcher {
  const watcher = watch(path, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      pollInterval: POLL_INTERVAL_MS
    }
  })
  watcher.on('change', handlers.onChange)
  watcher.on('error', handlers.onError)
  return watcher
}

/**
 * Watch a DIRECTORY for a kind's dump to APPEAR — the other half of "type the command and watch
 * it fill" (owner, 2026-08-05).
 *
 * `watchOutputFile` needs a path, so a character who has never run `/outputfile <kind>` had
 * nothing to watch and their first dump was invisible until the next launch. That is precisely
 * the player the Planner's instructions card is talking to. This covers them: depth 0 (the dump
 * lives in the install root beside a great many files we do not care about), the same settle
 * behavior, and `add` filtered by the kind's own filename suffix.
 *
 * The caller re-arms the file watcher from `onChange` — one appearance is all this is for.
 */
export function watchForOutputFile(
  dir: string,
  fileKind: string,
  handlers: OutputWatchHandlers
): FSWatcher {
  const suffix = `-${fileKind}.txt`.toLowerCase()
  const watcher = watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      pollInterval: POLL_INTERVAL_MS
    }
  })
  watcher.on('add', (path: string) => {
    if (basename(path).toLowerCase().endsWith(suffix)) handlers.onChange()
  })
  watcher.on('error', handlers.onError)
  return watcher
}
