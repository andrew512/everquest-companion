// ============================================================================
// loader.ts — WRITE ONE, READ ONE, AND DOUBT EVERYTHING (JOS-208).
// ============================================================================
//
// The two operations that turn the pieces in this directory into a feature:
//
//   `writeCheckpoint` — serialize every checkpointable module at byte offset B and land it as ONE
//                       binary file, atomically.
//   `readCheckpoint`  — validate a file against this build and this log, and restore the modules
//                       from it, or say why not.
//
// EVERY FAILURE IS THE SAME FAILURE. There is one caller-visible outcome for a missing file, a
// corrupt file, a file from another build, a file about a log that has since been archived, and a
// module that refused its own blob: `restored: false`, with a reason for the log line. The caller's
// response to all of them is the response it already has for "there is no cache" — cold-replay.
// That is what makes the failure mode slow-once rather than wrong.
//
// AND IT IS ALL-OR-NOTHING (design revision). Invalidation is whole-cache: a partial restore would
// need the same cold read the whole thing does, so per-module granularity would buy nothing except
// a second, harder-to-reason-about state. If any module refuses, NOTHING is restored — and because
// a module may already have adopted a blob by the time a later one refuses, the caller resets the
// registry on the failure path. `restoreModules` says so at the line that matters.
//
// ATOMIC WRITE, temp + rename, and NEVER a text write. `writeFile` of a `Buffer` with no encoding
// argument is a byte write; the moment an encoding sneaks in, a V8 blob becomes a lossy string.
// The BOM history in AGENTS.md is about a JSON file, and a JSON file survives a BOM better than
// this format ever could.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { decodeCache, encodeCache, type CacheHeader, type LogIdentity, type ModuleBlobMeta } from './format'
import { computeIdentity, computeIdentitySync, verifyIdentity } from './identity'
import { FOLD_SEMANTICS } from './semantics'
import { isCheckpointable, moduleShapeHash, type FoldUnit } from './serialize'
import type { CheckpointOrigin } from '../../shared/perf'

/** Why a checkpoint was not used. Every one lands on the cold path; the name is for the log line. */
export type RestoreRefusal =
  | `missing`
  | `unreadable`
  | `decode:${string}`
  | `semantics`
  | `modules`
  | `shape`
  | `identity:${string}`
  | `module-refused`

export type RestoreResult =
  | { restored: true; offset: number; seq: number; lastEventTs: number; origin: CheckpointOrigin }
  | {
      restored: false
      why: RestoreRefusal
      /**
       * DID ANY UNIT ADOPT A BLOB BEFORE THE REFUSAL?
       *
       * The caller resets the world on the refusal path, and until this existed it did so
       * UNCONDITIONALLY — which was measurably wrong. A reset BUMPS every module's private
       * revision counter (`respawn.rev`, `combo`'s stale counter, `character`'s), those counters
       * are published as the snapshot's `seq` AND are carried in the checkpoint, so a fold that
       * had merely CONSULTED a missing cache ended up one revision ahead of a fold that had not —
       * and every checkpoint written from it inherited the offset. The e2e restart-compare caught
       * it as a one-count difference on three modules, and the shadow verifier would have reported
       * a divergence on every single check for the same reason.
       *
       * `false` for every doubt judged before a module was handed anything: no file, a corrupt
       * one, another build's shapes, another log. `true` only for `module-refused`, where a later
       * unit said no after an earlier one had already taken its state.
       */
      adopted: boolean
    }

/** The checkpointable members of a candidate list, in the order given. */
export function checkpointableUnits(candidates: readonly { id: string }[]): FoldUnit[] {
  return candidates.filter(isCheckpointable)
}

/** The module directory this build would write — and the one a file has to match to be used. */
function directoryOf(modules: readonly FoldUnit[]): ModuleBlobMeta[] {
  return modules.map((m) => ({ id: m.id, shapeHash: moduleShapeHash(m) }))
}

export interface WriteCheckpointArgs {
  /** Where the container lands. The temp file is this plus `.tmp`. */
  cachePath: string
  logPath: string
  /** `name@server`, lowercased — the identity block's character key. */
  characterKey: string
  /** The byte offset the fold state describes. Must be the end of a COMPLETE line. */
  offset: number
  /** The event `seq` the fold had reached at `offset`. */
  seq: number
  /** The `ts` of the last event folded. Diagnostic; never a validity test. */
  lastEventTs: number
  /** WHICH WRITE this is. Recorded in the header and reported by the loader (JOS-208 phase 3). */
  origin: CheckpointOrigin
  modules: readonly FoldUnit[]
}

/**
 * EVERY MODULE'S FOLD STATE, CAPTURED IN ONE SYNCHRONOUS TURN.
 *
 * Its own function because the ASYNC write must call it BEFORE its first `await`, and that is a
 * correctness rule rather than a style: the fold keeps running while a promise is pending, so a
 * write that computed the identity block first and serialized afterwards would pair an offset from
 * one instant with module state from a later one — a checkpoint describing a byte position the
 * state has already moved past. Phase 1 never met this because the only production write was the
 * synchronous quit-path one, where nothing can interleave.
 */
function serializeStates(modules: readonly FoldUnit[]): Map<string, unknown> {
  const states = new Map<string, unknown>()
  for (const m of modules) states.set(m.id, m.serializeFold())
  return states
}

/** Everything but the file handling — shared by the async and sync write arms. */
function buildContainer(
  args: WriteCheckpointArgs,
  identity: LogIdentity,
  states: Map<string, unknown>
): Buffer {
  const header: CacheHeader = {
    foldSemantics: FOLD_SEMANTICS,
    seq: args.seq,
    writtenAtMs: Date.now(),
    origin: args.origin,
    identity,
    modules: directoryOf(args.modules)
  }
  return encodeCache(header, states)
}

/**
 * True when the checkpoint landed. False is never an error the caller must handle — just no cache.
 *
 * THE ASYNC ARM, used by the two writes that happen while the app is RUNNING (`replay` and
 * `quiet`). It serializes the fold state first and awaits afterwards — see `serializeStates` — so
 * everything the container claims is true of one instant.
 */
export async function writeCheckpoint(args: WriteCheckpointArgs): Promise<boolean> {
  if (args.offset <= 0 || args.modules.length === 0) return false
  // FIRST, and before any `await`: the state, the offset and the seq are one observation.
  const states = serializeStates(args.modules)
  const identity = await computeIdentity(args.logPath, args.offset, args.characterKey, args.lastEventTs)
  if (!identity) return false
  const bytes = buildContainer(args, identity, states)
  const tmp = `${args.cachePath}.tmp`
  try {
    // No encoding argument, anywhere on this path: a Buffer written as bytes, renamed over the old
    // file in one operation, so a crash leaves either the previous checkpoint or none.
    await mkdir(dirname(args.cachePath), { recursive: true })
    await writeFile(tmp, bytes)
    await rename(tmp, args.cachePath)
    return true
  } catch {
    await unlink(tmp).catch(() => undefined)
    return false
  }
}

/**
 * THE SAME WRITE, SYNCHRONOUSLY — for the quit path, and only for the quit path.
 *
 * `app.on('window-all-closed')` tears down synchronously on purpose (index.ts's `teardownStep`: a
 * step that can hang is a step that can leave a windowless zombie holding the single-instance
 * lock), so a promise started there races the process's own exit — and a checkpoint that lands
 * half the time is worse than one that never lands, because the half that does not is invisible.
 *
 * The blocking cost is stated rather than hoped: ~160 KB of bounded reads for the identity block,
 * one `v8.serialize` per module, and one file write — on a process that has already closed its
 * last window and is about to exit.
 */
export function writeCheckpointSync(args: WriteCheckpointArgs): boolean {
  if (args.offset <= 0 || args.modules.length === 0) return false
  const identity = computeIdentitySync(args.logPath, args.offset, args.characterKey, args.lastEventTs)
  if (!identity) return false
  const tmp = `${args.cachePath}.tmp`
  try {
    mkdirSync(dirname(args.cachePath), { recursive: true })
    writeFileSync(tmp, buildContainer(args, identity, serializeStates(args.modules)))
    renameSync(tmp, args.cachePath)
    return true
  } catch {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp file is best-effort cleanup; the next write overwrites it regardless.
    }
    return false
  }
}

export interface ReadCheckpointArgs {
  cachePath: string
  logPath: string
  characterKey: string
  modules: readonly FoldUnit[]
}

/**
 * Validate and restore. The order is CHEAPEST-DOUBT-FIRST and it is deliberate: everything that
 * can be judged from the file alone is judged before anything touches the log, and the log's
 * anchors are read before any module is handed a blob.
 */
export async function readCheckpoint(args: ReadCheckpointArgs): Promise<RestoreResult> {
  // EVERY REFUSAL BELOW THIS LINE AND ABOVE `restoreModules` HAS TOUCHED NOTHING, and says so —
  // see `RestoreResult.adopted` for the defect that taught us to say it.
  const refuse = (why: RestoreRefusal): RestoreResult => ({ restored: false, why, adopted: false })
  let bytes: Buffer
  try {
    bytes = await readFile(args.cachePath)
  } catch (err) {
    return refuse((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable')
  }
  const decoded = decodeCache(bytes)
  if (!decoded.ok) return refuse(`decode:${decoded.error}`)
  const { header, blobs } = decoded.value

  // ---- axis 2: SEMANTICS. What the fold MEANT when this was written (semantics.ts).
  if (header.foldSemantics !== FOLD_SEMANTICS) return refuse('semantics')

  // ---- axis 1: ENCODING. The module set AND every shape hash, derived fresh (schema.ts).
  const want = directoryOf(args.modules)
  if (want.length !== header.modules.length) return refuse('modules')
  for (let i = 0; i < want.length; i++) {
    const a = want[i]
    const b = header.modules[i]
    if (a.id !== b.id) return refuse('modules')
    if (a.shapeHash !== b.shapeHash) return refuse('shape')
  }

  // ---- the log itself: is this the same file, up to the same byte (identity.ts)?
  const idc = await verifyIdentity(args.logPath, header.identity, args.characterKey)
  if (!idc.ok) return refuse(`identity:${idc.reason}`)

  const adoption = restoreModules(args.modules, blobs)
  if (!adoption.ok) return { restored: false, why: 'module-refused', adopted: adoption.adopted }
  return {
    restored: true,
    offset: header.identity.b,
    seq: header.seq,
    lastEventTs: header.identity.lastEventTs,
    // A container from a build that predates the field says nothing rather than being refused.
    origin: header.origin ?? 'unknown'
  }
}

/**
 * Hand each module its blob. Reports whether every unit took it, AND whether any unit took one at
 * all before a refusal.
 *
 * A module that has already adopted its state when a LATER one refuses is left holding it, and
 * that is fine — but only because the caller's failure path resets the whole registry before the
 * cold replay. This function does not un-restore, because "half the modules are at byte B and half
 * at zero" is a state nothing should ever be able to observe, and a reset is a cheaper guarantee
 * than an undo.
 *
 * `adopted` is what lets the caller keep that reset to the ONE case that needs it. A reset is not
 * free: it bumps every module's published revision counter, and a fold that reset twice publishes a
 * `seq` a cold fold never would — see `RestoreResult.adopted`.
 */
function restoreModules(
  modules: readonly FoldUnit[],
  blobs: Map<string, unknown>
): { ok: boolean; adopted: boolean } {
  let adopted = false
  for (const m of modules) {
    if (!blobs.has(m.id)) return { ok: false, adopted }
    if (!m.deserializeFold(blobs.get(m.id))) return { ok: false, adopted }
    adopted = true
  }
  return { ok: true, adopted }
}
