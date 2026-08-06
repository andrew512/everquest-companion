// IPC: pet claims — the two WRITE channels of "is this thing yours?" (JOS-47).
//
// Reads do not appear here, on the roster's precedent (ipc/roster.ts): the questions and the
// answers ride `CombatSnapshot.petClaims`, which the Combat tab and every meter overlay already
// poll, so the offer and the rows it sits above are read in ONE call and can never describe two
// different fights.
//
// EVERY FIELD IS VALIDATED AT THE HANDLER (the trust-boundary rule in AGENTS.md). The name must
// survive a trim, fit inside MAX_NAME_LEN and match the shape a real entity name has — the
// canonical key derived from it is compared against attacker names off the damage stream, so a
// shape the parser could never produce is a key that could never match and storing one would be
// a permanent silent no-op.
//
// A CLAIM IS RETROACTIVE, and this is where that is paid for. Persisting alone would bind the
// pet only from the click onward, and a pet row whose total covers the last four seconds of a
// twenty-minute fight is an aggregate that lies (law 5). So a successful claim RE-RUNS the
// character's replay through the same full-rebuild door a character switch uses
// (session.tailCharacter) — the claim is already in the store by then, so `route()` applies it
// to the pet's very first line and the whole history arrives at once. A DENY needs none of
// this: it removes a question, it moves no damage.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { idKey } from '../log/parser'
import { combat } from '../pipeline'
import { activeCharId, getActiveCharacter, tailCharacter } from '../session'
import { clearPetClaim, getPetClaims, setPetClaim } from '../store'
import type { PetClaimsView } from '../../shared/petClaims'

/** Long enough for every EQ name; short enough that nothing can wedge a paragraph into the
 *  store. The roster handler's constant, and for the same reason. */
const MAX_NAME_LEN = 24

/**
 * The shape an ENTITY name has. Wider than the roster's player-name pattern on purpose: a
 * claimable entity is usually a summoned pet with a random proper name (Vararab, Kober) but may
 * be a multi-word proper name, and EQ names carry backticks and apostrophes. Still one line, no
 * quotes, no punctuation the parser cannot produce.
 */
const NAME_RE = /^[A-Za-z][A-Za-z`' -]*$/

/** A validated display name, or null. Rejected whole, never silently repaired. */
function name(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) return null
  return NAME_RE.test(trimmed) ? trimmed : null
}

/**
 * The live view the combat engine consults, built fresh from the store on every read. Cheap by
 * construction (a character has at most a handful of statements) and a PULL rather than a
 * push, so `reset()` on a character switch needs to know nothing: the next read simply asks for
 * the new character's list. The ComboModule / roster precedent.
 */
export function petClaimsView(charId: string): PetClaimsView {
  const edits = getPetClaims(charId)
  const claimed = new Set<string>()
  const denied = new Set<string>()
  const names = new Map<string, string>()
  for (const e of edits) {
    ;(e.action === 'claim' ? claimed : denied).add(e.key)
    names.set(e.key, e.name)
  }
  return { claimed, denied, nameOf: (k) => names.get(k) }
}

export function registerPetClaimIpc(): void {
  combat.setPetClaims(() => petClaimsView(activeCharId()))

  ipcMain.handle(IPC.petClaimSet, async (_e, payload: unknown) => {
    const p = payload as { name?: unknown; action?: unknown } | null
    const display = name(p?.name)
    const action = p?.action
    if (!display || (action !== 'claim' && action !== 'deny')) {
      return { ok: false as const, error: 'That is not a usable entity name.' }
    }
    setPetClaim(activeCharId(), { key: idKey(display), name: display, action, setAt: Date.now() })
    // Only a CLAIM moves damage, so only a claim pays for a replay.
    if (action === 'claim') {
      const active = getActiveCharacter()
      if (active) await tailCharacter(active)
    }
    return { ok: true as const }
  })

  ipcMain.handle(IPC.petClaimClear, async (_e, payload: unknown) => {
    const display = name((payload as { name?: unknown } | null)?.name)
    if (!display) return { ok: false as const, error: 'That is not a usable entity name.' }
    const key = idKey(display)
    const wasClaimed = getPetClaims(activeCharId()).some((e) => e.key === key && e.action === 'claim')
    clearPetClaim(activeCharId(), key)
    // Un-claiming moves damage the other way, so it costs the same rebuild.
    if (wasClaimed) {
      const active = getActiveCharacter()
      if (active) await tailCharacter(active)
    }
    return { ok: true as const }
  })
}
