// ============================================================================
// outputs/ — the ENGINE that reads EQ `/outputfile` dumps. Public surface.
// ============================================================================
//
// Five pieces, deliberately separable:
//   shared/outputs/kinds.ts  the FACTS: which kinds exist, the command, the why-clause, the
//                            filename pattern, and which ones we may parse (the no-guessing law).
//   kinds.ts                 the PARSE half of that registry (parsers are main's).
//   discovery.ts             finding a kind's file under `effectiveEqRoot()`.
//   watch.ts                 the shared "a dump was rewritten"/"a dump appeared" watchers.
//   registry.ts              the RUNTIME registry: status (path + the player's own mtime) and
//                            the one watch entry point every consumer uses.
//   inventoryParse.ts        the one graduated kind's pure parser (model: shared/outputs/inventory.ts).
//
// NOTHING IS PERSISTED FROM HERE. Dumps are parsed on demand and held in memory by their caller.
// The only persisted artifact remains the flat `HeldCounts` map the reconcile surfaces already
// store (`store.ts setInventory`, `ProgressState.inventory`) — see the note on
// `loadInventoryDump` below.

import { readFileSync } from 'fs'
import type { InventoryDump } from '../../shared/outputs/inventory'
import type { OutputKindId } from '../../shared/outputs/kinds'
import { parseOutput, type OutputParseResult } from './kinds'
import { outputStatus, type OutputCharacter } from './registry'

export { findOutputFile } from './discovery'
export { watchForOutputFile, watchOutputFile, type OutputWatchHandlers } from './watch'
export { inventoryHeldCounts, parseInventoryDump } from './inventoryParse'
export {
  outputStatus,
  outputStatuses,
  watchOutputKind,
  type OutputCharacter,
  type OutputKindWatch,
  type OutputWatchOptions
} from './registry'
export {
  isOutputFileName,
  outputFileNames,
  OUTPUT_KINDS,
  outputKind,
  parseOutput,
  preferredOutputFile,
  type InventoryOutput,
  type OutputData,
  type OutputFileStatus,
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

/**
 * Find + read + parse a kind's dump for a character. Null when there is no such file.
 *
 * The find + the mtime both come from `outputStatus`, so "where is it" and "how old is it" have
 * exactly ONE answer in this process — the same one the UI's freshness line is rendering.
 */
export function loadOutput(
  id: OutputKindId,
  characterName?: string,
  server?: string
): LoadedOutput | null {
  const character: OutputCharacter = { name: characterName, server }
  const status = outputStatus(id, character)
  if (status.path === null || status.updatedAt === null) return null
  return {
    kind: id,
    path: status.path,
    loadedAt: status.updatedAt,
    result: parseOutput(id, readFileSync(status.path, 'utf8'))
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
