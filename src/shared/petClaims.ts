// PET CLAIMS — "is this thing yours?", asked out loud instead of guessed (JOS-47).
//
// THE PROBLEM THIS EXISTS FOR. A summoned pet has a random proper name (Vararab, Kober, Garer)
// and appears in no charm line, so the app's ONLY binding signal for one is the private tell
// `<Name> told you, '… Master.'`. That tell fires when the pet is ORDERED — and a player who
// lets the pet engage on its own aggro never orders it. A user's 30-minute slice
// (01KZBV8WFC8PD7DNASTJ5S5CWZ) carried 476 pet swings from three successive pets and ZERO
// tells: unbound, so `classify()` filed every one as a stranger's and the damage was invisible
// at every scope, on every surface, in every version. Not a regression — a blind spot.
//
// THE THREE RUNGS, strongest first. This module is the middle one's vocabulary and the top
// one's storage shape:
//
//   1. PRIVATE TELL → BINDS. `<Name> told you, '… Master.'` — a channel only the owner reads.
//      Unchanged, and still the only thing the log alone may bind on.
//   2. PUBLIC SAY + SHARED TARGET → NOMINATES, NEVER BINDS. A pet-voiced `says` line
//      (shared/logScrub.ts PET_SAY_LINES) proves the speaker is SOMEBODY's pet — `says` is
//      broadcast, so another player's pet in earshot says exactly the same words. Pairing it
//      with "…and it is fighting the target you are fighting" is strong evidence and still not
//      proof, so it produces a QUESTION in the meter, never a row.
//   3. USER CLAIM → BINDS, and outranks everything. The roster-popover precedent
//      (docs/plans/group-model.md §3): a user edit is the top rung of the provenance ladder,
//      it is persisted per character, and no later log line can undo it.
//
// WHY THE SAY IS NOT ALLOWED TO BIND, measured rather than assumed (whole-log sweep, 1.4M
// lines): there are 113 public pet-says in the corpus. 85 came from a name an EARLIER private
// tell had already bound, so binding on them would have added NOTHING; 22 from a name a later
// tell bound anyway; 6 from names no tell ever bound. Six lines of upside against the standing
// risk of adopting a stranger's pet is not a trade worth making silently — but it is exactly
// the right size for a question.
//
// This module is PURE: zero imports, no `node:`, no Electron, no DOM. It compiles under both
// tsconfigs (the shared/roster.ts rule).

/**
 * WHY the app is asking about this entity — the strongest evidence it holds, and the word the
 * meter's tooltip says out loud.
 *
 *   'say'    it SPOKE a pet's line ("Following you, Master.") and fought alongside you.
 *   'target' behavioural only: a proper-named entity that keeps killing what you are killing,
 *            that you never once hit, that never once hit you, and that no evidence calls a
 *            player. This is the rung that catches the reporter's case, where the log carried
 *            no pet-voiced line of any kind.
 */
export type PetCandidateWhy = 'say' | 'target'

/** One entity the app would like to ask about. Never a row in a meter — a question above one. */
export interface PetCandidate {
  /** Canonical identity key — `idKey(name)`. */
  key: string
  /** Display name, spelled the way the log spelled it (world-model law 2). */
  name: string
  why: PetCandidateWhy
  /** Landed hits attributed to nobody because of this. */
  hits: number
  /** Damage attributed to nobody because of this — what the user gets back by saying yes. */
  damage: number
  /** How many distinct mobs it fought that you also fought. The behavioural core. */
  sharedTargets: number
  /** Pet-voiced public says heard from it. */
  says: number
  firstSeenTs: number
  lastSeenTs: number
}

/**
 * The pet-claim state the combat snapshot carries to both renderer bundles. Tiny by
 * construction — `candidates` is capped and `claimed` is a handful of names.
 */
export interface PetClaimsSnap {
  /** Entities worth asking about, strongest evidence first. */
  candidates: PetCandidate[]
  /** Display names the user has CLAIMED for this character (they are bound pets already). */
  claimed: string[]
}

export const EMPTY_PET_CLAIMS: PetClaimsSnap = { candidates: [], claimed: [] }

/**
 * THE LIVE view the combat engine consults — main-process only, never serialized. The
 * `RosterView` precedent (shared/roster.ts): the engine reads this per line, so it must be a
 * set lookup and not a copy.
 */
export interface PetClaimsView {
  /** Canonical keys the user has claimed as their pets. Binds, at admission. */
  readonly claimed: ReadonlySet<string>
  /** Canonical keys the user has said are NOT theirs. Never bound, never offered again. */
  readonly denied: ReadonlySet<string>
  /** The log's own spelling for a claimed key, for the pet row's label. */
  nameOf(key: string): string | undefined
}

/** The view a session with no claims has — every default, so nothing changes for a player who
 *  has never been asked and every pre-existing caller behaves exactly as before. */
export const EMPTY_PET_CLAIMS_VIEW: PetClaimsView = {
  claimed: new Set<string>(),
  denied: new Set<string>(),
  nameOf: () => undefined
}

/**
 * THE OFFER'S SENTENCE, in one place because three surfaces say it (the Combat tab meter, the
 * damage overlay, and the tooltip that explains it). UI convention (AGENTS.md): state, never
 * process — the question is the state, and the evidence is the tooltip.
 */
export function claimPrompt(c: PetCandidate): string {
  return `${c.name} — your pet?`
}

/** The tooltip under the question: what the app actually saw, and what saying yes costs. */
export function claimEvidence(c: PetCandidate): string {
  const seen =
    c.why === 'say'
      ? `It answered a pet command out loud (${c.says === 1 ? 'once' : `${c.says}×`}) and fought`
      : 'It fought'
  const mobs = c.sharedTargets === 1 ? '1 mob' : `${c.sharedTargets} mobs`
  return (
    `${seen} ${mobs} alongside you for ${c.hits} landed hits (${c.damage} damage) — but nothing in the log ` +
    `says whose pet it is. Say yes and its damage is yours, on every surface, for good. Say no and you are not asked again.`
  )
}
