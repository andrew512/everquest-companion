// ============================================================================
// outputs/kinds.ts — the KIND REGISTRY for EQ `/outputfile` dumps.
// ============================================================================
//
// EQ's `/outputfile <kind>` writes a tab-separated text file next to the client executable
// (the install root — NOT `Logs\`), named `<Character>_<server>-<Kind>.txt`. This registry
// is the one place that knows which kinds exist, what each one's file is called, and
// whether we can actually read it.
//
// ---------------------------------------------------------------------------
// THE LAW OF THIS FILE: NO FILE FORMAT IS EVER GUESSED.
// ---------------------------------------------------------------------------
// A kind graduates from `awaiting-sample` to `supported` only when a REAL dump from the
// game has been read by a human, its shape written down, and a fixture committed under
// `tests/fixtures/` with parser tests against it. Until then the kind's entry exists — so
// the engine can name the file, tell the user what it would take, and refuse in a typed
// way — and `parseOutput` returns `{ ok: false, reason: 'unsupported' }`. It never returns
// a half-parsed object, and it never falls back to "well, it's tab-separated, so…".
//
// `fileKindVerified` is a SECOND, separate honesty flag on the same idea: the filename
// suffix itself is knowledge. `Inventory` is MEASURED (the real dump on the dev machine is
// `Primitive_freeport-Inventory.txt`). Every other suffix below is the community/client
// spelling as best we know it and has NOT been observed on disk — an unverified suffix
// simply never matches a real file, which is a quiet miss rather than a wrong parse, and
// it gets corrected the moment someone runs the command and looks.

import type { InventoryDump } from '../../shared/outputs/inventory'
import { parseInventoryDump } from './inventoryParse'

/** Every `/outputfile` kind this app knows the name of. */
export type OutputKindId =
  | 'inventory'
  | 'guild'
  | 'raid'
  | 'spellbook'
  | 'factions'
  | 'achievements'
  | 'alternateadv'

export interface OutputKindDef {
  id: OutputKindId
  /** The `-<fileKind>.txt` filename suffix EQ writes (case-insensitively matched). */
  fileKind: string
  /** True only when a file with this suffix has actually been observed on disk. */
  fileKindVerified: boolean
  /** `supported` ⇒ a verified sample + fixture + tests exist and `parseOutput` works. */
  status: 'supported' | 'awaiting-sample'
  /** Human-readable note carried into the unsupported result. */
  note: string
}

export const OUTPUT_KINDS: readonly OutputKindDef[] = [
  {
    id: 'inventory',
    fileKind: 'Inventory',
    fileKindVerified: true,
    status: 'supported',
    note: 'Equipment, bag contents, bank, depot and the keyring, plus each item’s slots.'
  },
  {
    id: 'guild',
    fileKind: 'Guild',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Guild roster dump — no verified sample; run /outputfile guild and commit a fixture.'
  },
  {
    id: 'raid',
    fileKind: 'Raid',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Raid roster dump — no verified sample; run /outputfile raid and commit a fixture.'
  },
  {
    id: 'spellbook',
    fileKind: 'Spellbook',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Spellbook dump — no verified sample; run /outputfile spellbook and commit a fixture.'
  },
  {
    id: 'factions',
    fileKind: 'Factions',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Faction standings dump — no verified sample; run /outputfile factions and commit a fixture.'
  },
  {
    id: 'achievements',
    fileKind: 'Achievements',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Achievements dump — no verified sample; run /outputfile achievements and commit a fixture.'
  },
  {
    id: 'alternateadv',
    fileKind: 'AlternateAdv',
    fileKindVerified: false,
    status: 'awaiting-sample',
    note: 'Alternate-advancement dump — no verified sample; run /outputfile alternateadv and commit a fixture.'
  }
]

export function outputKind(id: OutputKindId): OutputKindDef {
  const def = OUTPUT_KINDS.find((k) => k.id === id)
  // The union above is closed, so this cannot miss; the throw states that rather than
  // handing a caller `undefined` typed as a definition.
  if (!def) throw new Error(`Unknown output kind: ${id}`)
  return def
}

/** The inventory kind's payload — the deep model (shared/outputs/inventory.ts). */
export interface InventoryOutput {
  kind: 'inventory'
  dump: InventoryDump
}

/** The parsed payload of each supported kind: a union with one member per graduated kind. */
export type OutputData = InventoryOutput

/** A parse either produced a typed payload, or explicitly refused and said why. */
export type OutputParseResult =
  | { ok: true; kind: OutputKindId; data: OutputData }
  | { ok: false; kind: OutputKindId; reason: 'unsupported'; message: string }

/**
 * Parse a dump's text as the given kind. Unsupported kinds refuse in a typed way — see the
 * law at the top of this file.
 */
export function parseOutput(id: OutputKindId, text: string): OutputParseResult {
  const def = outputKind(id)
  if (def.id === 'inventory') {
    return { ok: true, kind: id, data: { kind: 'inventory', dump: parseInventoryDump(text) } }
  }
  return {
    ok: false,
    kind: id,
    reason: 'unsupported',
    message: `unsupported: no verified sample for /outputfile ${id}. ${def.note}`
  }
}
