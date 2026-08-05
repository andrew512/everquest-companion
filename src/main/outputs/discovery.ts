// ============================================================================
// outputs/discovery.ts — finding a `/outputfile` dump on disk.
// ============================================================================
//
// EQ writes dumps into the INSTALL ROOT (beside the client executable), not into `Logs\`,
// and names them `<Character>_<server>-<Kind>.txt` — measured: the dev machine's only dump
// is `Primitive_freeport-Inventory.txt`. The root is never hardcoded; it always resolves
// through `effectiveEqRoot()` so the Settings override and auto-discovery apply here
// exactly as they do to log tailing.

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { effectiveEqRoot } from '../log/config'
import { outputKind, type OutputKindId } from './kinds'

/** A candidate dump file with the mtime used to break ties. */
interface Candidate {
  file: string
  full: string
  mtime: number
}

function candidates(fileKind: string): Candidate[] {
  const eqRoot = effectiveEqRoot()
  if (!existsSync(eqRoot)) return []
  const suffix = new RegExp(`-${fileKind}\\.txt$`, 'i')
  return readdirSync(eqRoot)
    .filter((f) => suffix.test(f))
    .map((f) => ({ file: f, full: join(eqRoot, f), mtime: statSync(join(eqRoot, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}

/**
 * The newest dump of `id`, preferring the named character's own file.
 *
 * Preference order — `<name>_<server>-<Kind>.txt` FIRST, because that is what the client
 * actually writes, then the bare `<name>-<Kind>.txt` the previous inventory resolver looked
 * for, then simply the newest matching file. On a one-character machine all three resolve
 * to the same file (verified on the dev machine, where only the `_server` form exists and
 * the old code therefore always fell through to "newest"); on a machine with several
 * characters the first rule is what stops one character's dump from being read as
 * another's.
 */
export function findOutputFile(
  id: OutputKindId,
  characterName?: string,
  server?: string
): string | null {
  const { fileKind } = outputKind(id)
  const found = candidates(fileKind)
  if (found.length === 0) return null
  const preferred: string[] = []
  if (characterName && server) preferred.push(`${characterName}_${server}-${fileKind}.txt`)
  if (characterName) preferred.push(`${characterName}-${fileKind}.txt`)
  for (const want of preferred) {
    const match = found.find((x) => x.file.toLowerCase() === want.toLowerCase())
    if (match) return match.full
  }
  return found[0].full
}
