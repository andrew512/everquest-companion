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
