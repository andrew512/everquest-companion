// IPC: per-mob resist profiles (JOS-382).
//
// Read-only pulls off the resist ledger. Both handlers derive their whole answer on every call —
// see the channel comments in `shared/ipc.ts` for why nothing here is cached and nothing is stored.
//
// THE CLIENT SPELL TABLE IS LOADED LAZILY, HERE, AND ONLY ONCE. `spellTable()` reads the player's
// own 38 MB `spells_us.txt` on a worker thread the first time somebody asks for a profile, then
// serves a userData cache keyed by that file's size and mtime. Kicking it off at registration
// (rather than at boot) keeps it off the startup path entirely, and the first mob page pays for it
// once; every launch after a patch-free week pays nothing.
//
// AND IT IS ALLOWED TO BE MISSING. An `EQ_INSTALL_DIR` override pointed at a folder of logs with
// no EverQuest behind it is a supported state, so `spellTable()` resolving to null is not an
// error: the profile comes back with `spellDataAvailable: false` and the card says so.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { RESIST_AXES, type ResistAxis } from '../../shared/resistTypes'
import { BASELINE_SOURCE_KEY } from '../../shared/resistTypes'
import { resistModule } from '../pipeline'
import { mobResistCell, mobResistProfile, type ProfileDeps } from '../resist/profile'
import { spellTable, spellTableNow } from '../resist/spellTable'
import { baselineFrozenAt, resistLedger } from '../resist/store'

/** A mob name is a display string off the renderer's own catalog; bound it anyway. */
const MAX_MOB_NAME = 96

function deps(): ProfileDeps {
  return {
    rowsFor: (key) => resistLedger().rowsFor(key, BASELINE_SOURCE_KEY),
    spells: () => spellTableNow(),
    levelOf: (key, display) => resistModule.levelOf(key, display),
    frozenAt: () => baselineFrozenAt(),
  }
}

function validMob(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_MOB_NAME
}

function validAxis(value: unknown): value is ResistAxis {
  return typeof value === 'string' && (RESIST_AXES as readonly string[]).includes(value)
}

export function registerResistIpc(): void {
  ipcMain.handle(IPC.resistProfile, async (_e, mob: unknown) => {
    if (!validMob(mob)) return null
    await spellTable()
    return mobResistProfile(mob, deps())
  })
  ipcMain.handle(IPC.resistCell, async (_e, mob: unknown, axis: unknown) => {
    if (!validMob(mob) || !validAxis(axis)) return null
    await spellTable()
    return mobResistCell(mob, axis, deps())
  })
}
