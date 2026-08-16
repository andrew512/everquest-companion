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
import { RESIST_AXES, type ResistAxis, type ResistRow } from '../../shared/resistTypes'
import { BASELINE_SOURCE_KEY } from '../../shared/resistTypes'
import { mobKey } from '../../shared/mobKey'
import { resolveMobIdentity } from '../mobAliases'
import { resistModule } from '../pipeline'
import { mobResistCell, mobResistProfile, type ProfileDeps } from '../resist/profile'
import { unobservableSpells } from '../../shared/resistModel'
import { spellTable, spellTableNow } from '../resist/spellTable'
import { baselineFrozenAt, resistLedger } from '../resist/store'

/** A mob name is a display string off the renderer's own catalog; bound it anyway. */
const MAX_MOB_NAME = 96

/**
 * EVERY SPELLING OF THE CREATURE, not just the one the page happens to be titled with (JOS-382,
 * round 2). The mob catalog and the log disagree by NAME rather than by spelling — `Cazic Thule`
 * on the wiki page, `Cazic-Thule` in every line the game prints — and `mobAliases` is the
 * verified roster that already knows those pairs (world-model law 12: a cross-source rename is
 * knowledge, never a fuzzy match). Without this, the card on a renamed boss's page reads "not
 * enough data" while the ledger holds hundreds of observations under the other spelling.
 */
function rowsForIdentity(display: string): ResistRow[] {
  const ledger = resistLedger()
  const id = resolveMobIdentity(display)
  if (!id.aliased) return ledger.rowsFor(mobKey(display), BASELINE_SOURCE_KEY)
  const out: ResistRow[] = []
  for (const key of id.keys) out.push(...ledger.rowsFor(key, BASELINE_SOURCE_KEY))
  return out
}

/**
 * The whole-ledger blindness verdict, computed once per app run. It only changes when the fold
 * files a landing for a spell that had none, which is a once-per-install event in practice; the
 * profile reads it on every draw, so a scan of every row on every draw would be the wasteful half.
 */
let blindCache: ReadonlySet<string> | null = null
function unobservable(): ReadonlySet<string> {
  blindCache ??= unobservableSpells(allLedgerRows())
  return blindCache
}

function allLedgerRows(): ResistRow[] {
  const out: ResistRow[] = []
  for (const src of resistLedger().toLedger().sources) out.push(...src.rows)
  return out
}

function deps(): ProfileDeps {
  return {
    rowsFor: rowsForIdentity,
    unobservable,
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
