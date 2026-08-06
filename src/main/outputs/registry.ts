// ============================================================================
// outputs/registry.ts — the RUNTIME registry: one treatment for every `/outputfile` kind.
// ============================================================================
//
// JOS-44. The app leans on EQ's export commands (`/outputfile inventory` today, more next), and
// every surface fed by one owes the player the same three things: the command to run, one clause
// of why, and how old the data is — plus live pickup the moment the game rewrites the file.
// Before this the pieces existed but were scattered: main knew how to find and watch a file,
// each surface hand-typed its own command string, and only the two inventory call sites knew how
// to answer "when".
//
// SO THE FACTS AND THE DISK ARE ONE REGISTRY, IN TWO HALVES:
//   shared/outputs/kinds.ts   the FACTS — command, why-clause, filename pattern, supported.
//   this file                 the DISK — does it exist, when did the player last write it,
//                             and the watcher that notices the next rewrite.
//
// `OutputFileStatus` is what those two halves join into, and it is the ONLY thing that crosses
// IPC (`ipc/outputs.ts`). A renderer therefore never learns a path rule, never re-types a
// command, and never has to decide what "fresh" means.
//
// NOTHING IS CACHED HERE, deliberately. A status is one `readdir` + one `stat` over a directory
// the player rewrites mid-session on purpose; a cache would answer with the state from before
// they typed the command, which is the exact failure this whole ticket is about.

import { statSync } from 'fs'
import {
  outputFileStatus,
  outputKind,
  OUTPUT_KINDS,
  type OutputFileStatus,
  type OutputKindDef,
  type OutputKindId
} from '../../shared/outputs/kinds'
import { effectiveEqRoot } from '../log/config'
import { findOutputFile } from './discovery'
import { watchForOutputFile, watchOutputFile } from './watch'
import type { FSWatcher } from 'chokidar'

/** Whose dumps we are asking about. Both parts optional — an unknown character still resolves
 *  to "the newest file of this kind", which is what a one-character machine always has. */
export interface OutputCharacter {
  name?: string
  server?: string
}

/** The file's mtime as an ISO string, or null when it is gone between the listing and the stat. */
function mtimeIso(path: string): string | null {
  try {
    return new Date(statSync(path).mtimeMs).toISOString()
  } catch {
    // The dump was deleted (or the drive vanished) in the microseconds since discovery listed
    // it. That is "no dump", not an error to render.
    return null
  }
}

/** Join one kind's facts to the file on disk. `path: null` ⇒ the command has never been run. */
export function outputStatus(id: OutputKindId, character?: OutputCharacter): OutputFileStatus {
  const def = outputKind(id)
  const path = findOutputFile(id, character?.name, character?.server)
  const updatedAt = path === null ? null : mtimeIso(path)
  // A path whose stat failed is a file that is no longer there — `outputFileStatus` then reports
  // neither half of it, which is the never-run state and not a half-known file.
  return outputFileStatus(def, path !== null && updatedAt !== null ? { path, updatedAt } : null)
}

/** Every kind's status, in registry order. The one payload `IPC.outputsStatus` answers with. */
export function outputStatuses(character?: OutputCharacter): OutputFileStatus[] {
  return OUTPUT_KINDS.map((def) => outputStatus(def.id, character))
}

export interface OutputWatchOptions {
  /** The dump was (re)written and has settled. */
  onChange: () => void
  /** The watcher itself failed (permissions, the file vanished, …). */
  onError: (err: unknown) => void
  /**
   * Is this watch's subject still current? Checked before EVERY re-arm and every `onChange`, so a
   * watcher that outlives a character switch goes quiet instead of reporting the old character's
   * dump. Defaults to "always" for a caller with nothing to go stale.
   */
  active?: () => boolean
}

/** A live watch on one kind. The caller owns the lifecycle — only it knows when its subject changed. */
export interface OutputKindWatch {
  close: () => void
}

/**
 * Watch one kind's dump for this character, covering BOTH the rewrite and the very first write.
 *
 * TWO WATCHERS, ONE SLOT (owner, 2026-08-05: "type the command, watch it fill"). A character with
 * a dump gets the FILE watched. A character with NO dump has nothing to point a file watcher at,
 * so the install ROOT is watched for one to APPEAR — and that is exactly the player a surface's
 * instructions card is talking to. The appearance re-arms this watch, which then finds the file
 * and switches to watching it.
 *
 * Lifted verbatim (behavior-for-behavior) out of session.ts's inventory watcher in JOS-44, so
 * every future kind inherits the covered first-write instead of re-deriving it.
 */
export function watchOutputKind(
  id: OutputKindId,
  character: OutputCharacter,
  opts: OutputWatchOptions
): OutputKindWatch {
  const def: OutputKindDef = outputKind(id)
  const active = opts.active ?? ((): boolean => true)
  let watcher: FSWatcher | null = null

  const arm = (): void => {
    void watcher?.close()
    watcher = null
    const path = findOutputFile(id, character.name, character.server)
    if (path === null) {
      watcher = watchForOutputFile(effectiveEqRoot(), def, {
        onChange: () => {
          if (!active()) return
          // Re-arm FIRST: the file now exists, so the next rewrite belongs to the file watcher.
          arm()
          opts.onChange()
        },
        onError: opts.onError
      })
      return
    }
    watcher = watchOutputFile(path, {
      onChange: () => {
        if (active()) opts.onChange()
      },
      onError: opts.onError
    })
  }

  arm()
  return {
    close: () => {
      void watcher?.close()
      watcher = null
    }
  }
}
