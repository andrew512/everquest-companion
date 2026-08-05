// ============================================================================
// outputs/ — the ENGINE that reads EQ `/outputfile` dumps. Public surface.
// ============================================================================
//
// Four pieces, deliberately separable:
//   kinds.ts           the REGISTRY: which kinds exist, what their files are called,
//                      and which ones we are allowed to parse (the no-guessing law).
//   discovery.ts       finding a kind's file under `effectiveEqRoot()`.
//   watch.ts           the shared "a dump was rewritten" watcher.
//   inventoryParse.ts  the one graduated kind's pure parser (model: shared/outputs/inventory.ts).
//
// NOTHING IS PERSISTED FROM HERE. Dumps are parsed on demand and held in memory by their
// caller. The only persisted artifact remains the flat `HeldCounts` map the reconcile
// surfaces already store (`store.ts setInventory`, `ProgressState.inventory`) — see the
// note on `loadInventoryDump` below.

import { readFileSync, statSync } from 'fs'
import type { InventoryDump } from '../../shared/outputs/inventory'
import { findOutputFile } from './discovery'
import { parseOutput, type OutputKindId, type OutputParseResult } from './kinds'

export { findOutputFile } from './discovery'
export { watchOutputFile, type OutputWatchHandlers } from './watch'
export { inventoryHeldCounts, parseInventoryDump } from './inventoryParse'
export {
  OUTPUT_KINDS,
  outputKind,
  parseOutput,
  type InventoryOutput,
  type OutputData,
  type OutputKindDef,
  type OutputKindId,
  type OutputParseResult
} from './kinds'

/** A dump that was found on disk, with whatever the registry made of it. */
export interface LoadedOutput {
  kind: OutputKindId
  path: string
  /** The file's mtime — when the PLAYER produced the dump, not when we read it. */
  loadedAt: string
  result: OutputParseResult
}

/** Find + read + parse a kind's dump for a character. Null when there is no such file. */
export function loadOutput(
  id: OutputKindId,
  characterName?: string,
  server?: string
): LoadedOutput | null {
  const path = findOutputFile(id, characterName, server)
  if (!path) return null
  return {
    kind: id,
    path,
    loadedAt: new Date(statSync(path).mtimeMs).toISOString(),
    result: parseOutput(id, readFileSync(path, 'utf8'))
  }
}

/** The deep inventory model for a character's newest dump. */
export interface LoadedInventoryDump {
  path: string
  loadedAt: string
  dump: InventoryDump
}

/**
 * Load + parse the character's inventory dump into the DEEP model.
 *
 * PERSISTENCE (decided this wave, deliberately): the dump is NOT written to the store. It
 * is ~256 rows of nested objects derived from a file that is already on disk and re-read in
 * milliseconds, it has no consumer that outlives the process, and the store-migration law
 * (`storeMigrations.ts`) means every persisted shape is owed a migration step forever. A
 * key nobody reads is pure migration debt. When a surface finally needs it across restarts,
 * it lands as an ADDITIVE key with a defaulting reader plus its migration step, in the same
 * commit — until then, parse on demand.
 */
export function loadInventoryDump(
  characterName?: string,
  server?: string
): LoadedInventoryDump | null {
  const loaded = loadOutput('inventory', characterName, server)
  if (!loaded) return null
  const { result } = loaded
  // The registry types this narrowing honestly: an unsupported kind never yields data.
  if (!result.ok || result.data.kind !== 'inventory') return null
  return { path: loaded.path, loadedAt: loaded.loadedAt, dump: result.data.dump }
}
