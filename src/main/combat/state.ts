// The combat engine's MUTABLE STATE — every field the old monolithic CombatEngine class
// carried, plus the small helpers that only read/refresh it (the classification ring, the
// presence axis, the two ring appenders, the defender-label resolution).
//
// Extracted so the routing / lifecycle / view modules can be plain functions over one
// explicit state object instead of methods on a 1,400-line class. `CombatEngine` (engine.ts)
// owns exactly one of these and is a thin facade over it — nothing outside this directory
// ever sees it.

import { WorldModel } from './world'
import { Agg } from './aggregate'
import {
  FALLBACK_IDLE_MS,
  MARKER_CAP,
  RECENT_CAP,
  TIMELINE_CAP,
  type Encounter,
  type MarkerRaw,
  type TimelineRaw,
  type ZoneSession
} from './encounter'
import { idKey } from '../log/parser'
import { StateTimeline } from './stateTimeline'
import { CharmModel } from './charmModel'
import { PetCandidates } from './petCandidates'
import { SpecialAttacks } from './specialAttacks'
import type { RecentCasts } from './procDetect'
import { EMPTY_ROSTER, EMPTY_ROSTER_VIEW, type RosterSnap, type RosterView } from '../../shared/roster'
import {
  EMPTY_PET_CLAIMS,
  EMPTY_PET_CLAIMS_VIEW,
  type PetClaimsSnap,
  type PetClaimsView
} from '../../shared/petClaims'
import type { ClassifiedLine, CoatSlot } from '../../shared/combat'

export class EngineState {
  /** Canonical name keys of your LIVE PETS — charmed AND summoned alike. Kept in
   *  lockstep with the WorldModel's pet instances so the pure classify() (which only
   *  needs name membership) stays cheap. This is an ATTRIBUTION set, NOT a charm
   *  roster: a summoned class pet (Vebarn, Garer…) belongs here exactly as much as a
   *  charmed mob does, because both attribute as "your pet". The charmed/summoned
   *  distinction lives on WorldModel Instance.petKind — see world.charmedInstances(). */
  petNames = new Set<string>()
  world = new WorldModel()
  /**
   * OWNERSHIP for the two caster-less broadcasts (`<mob> has been charmed.` /
   * `<mob> has been mesmerized.`) — see charmModel.ts for the state table and the
   * measurements. Nothing enters `petNames` from a charm line, and no CC hold opens, unless
   * this model says the broadcast resolved one of the OWNER's own casts.
   */
  charm = new CharmModel()
  /**
   * WHO ELSE MIGHT BE YOURS (JOS-47). The detector behind the meter's "<Name> — your pet?"
   * question: it watches the damage `classify()` is currently dropping and remembers the
   * pet-shaped entities worth asking about. It binds nothing and books nothing — see
   * petCandidates.ts for the disqualifiers that make an offer safe to show.
   */
  candidates = new PetCandidates()
  /**
   * Canonical name keys of entities known to be PLAYERS — never hostiles, never a pet's
   * target, never enemy healers. TWO sources, both narrow on purpose:
   *   - the tailed character (injected by setPlayerName, or learned by learnPlayerKey);
   *   - anyone who HEALED the owner (`<H> healed Primitive for N`) — a mob cannot.
   *
   * HONEST LIMIT, stated rather than pretended away: a stranger who never heals you is NOT
   * identifiable as a player from this log's grammar. The lines that would say so —
   * `<Name> tells <chan>, '…'`, `/who` rows, group join/leave — are exactly the ones
   * tests/fixture-scrub.mjs drops, and mobs share every remaining shape: they melee, they
   * cast, and they self-heal with the same `healed itself/himself/herself` wording (211
   * distinct `itself` healers in the real log, players and `a shadowknight pet` alike). The
   * obvious extra inference — "`You healed <X>` ⇒ X is a player" — was tried and MEASURED
   * WRONG; see routeHeal for what it cost. So this set is the belt beside the braces: what
   * actually keeps a stranger out of your fight is the charm gate plus the engage/presence
   * discipline in routing.ts.
   */
  knownPlayers = new Set<string>()
  /**
   * THE GROUP ROSTER, pulled live (docs/plans/group-model.md §3.5). Installed by pipeline.ts as
   * `() => rosterModule.view()`; the default returns an empty view, so every test, every replay
   * without a group and every pre-existing caller behaves exactly as it did before.
   *
   * A pull rather than a stored copy for two reasons: the roster module has already folded the
   * same bus event by the time the engine sees it, and a user edit made between two log lines
   * must reach the very next one. Cheap by construction — the view is at most five names.
   */
  rosterProvider: () => RosterView = () => EMPTY_ROSTER_VIEW
  /** The SERIALIZABLE roster the snapshot carries to both renderer bundles — provenance, names
   *  and staleness, which the hot-path `RosterView` deliberately does not carry. Read once per
   *  UI tick, never per line, and from the same module as `rosterProvider`, so the rows the
   *  meter draws and the chip that filters them always describe one group. */
  rosterSnapProvider: () => RosterSnap = () => EMPTY_ROSTER
  /**
   * THE USER'S OWN PET STATEMENTS, pulled live exactly like the roster (JOS-47). Installed by
   * ipc/petClaims.ts as `() => petClaimsView(activeCharId())`; the default returns an empty
   * view, so every test and every player who has never been asked behaves as before.
   *
   * Top of the provenance ladder, and the roster's rule applies verbatim (shared/roster.ts
   * `outranks`): a user statement is rank 'user' and NOTHING the log later says can overwrite
   * it. So a claimed pet that afterwards sends a real `… Master.'` tell is not a conflict and
   * not a second pet — the tell walks the SAME `world.claim()` door, which is idempotent on a
   * live pet instance, and the claim goes on being the reason the app believes it.
   */
  petClaimsProvider: () => PetClaimsView = () => EMPTY_PET_CLAIMS_VIEW
  /** Every name key that has EVER been one of your pets this session. Small, never pruned,
   *  and the reason `notePlayer` can never mistake a pet for a player (see notePet). */
  everPet = new Set<string>()
  /** The player's own proper name key (e.g. "primitive"). Normally INJECTED by
   *  index.ts via setPlayerName() (it knows the character from the tail ref). As a
   *  cheap fallback (guards a mis-parsed injected name) it can also be LEARNED from
   *  heal lines: EQ writes self-heals as "You healed <PlayerName> for N", so a heal
   *  whose healer is You and whose target is neither one of your pets nor an engaged
   *  hostile reveals the player's name. An injected name always wins over a learned
   *  one. Once known, heals targeting that name count as incoming. */
  playerKey?: string
  /** True once setPlayerName() injected the name, so heal-based learning can't
   *  overwrite it. */
  playerKeyInjected = false
  zone?: string
  seq = 0
  current: Encounter | null = null
  history: Encounter[] = []
  zoneAgg = new Agg()
  zoneFinalizedMs = 0
  /** Sum of finalized encounters' activeMs this zone (for the zone active-DPS). */
  zoneActiveMs = 0
  /** First/last attributed-damage ts in the LIVE zone session (0 = none yet). Task #54: drives
   *  the zone-session disambiguation timing (start clock + relative age + span). */
  zoneStartTs = 0
  zoneLastTs = 0
  /** Capped finalized-zone-session history (Task #54). Each entry keeps its FROZEN Agg + timing +
   *  a memoized SegmentView-less summary; the live zoneAgg is NOT in here. Newest last. */
  zoneHistory: ZoneSession[] = []
  zoneSeq = 0
  recent: ClassifiedLine[] = []
  recording = false
  /**
   * HYDRATION (Task #56). True from construction/reset until the historical scan hands off
   * to the live Tailer (`setLive()`, or the first live event as a belt-and-braces fallback).
   * While true, `current` is a fight from the PAST being replayed, so a snapshot's "live"
   * fields are historical — the snapshot carries this flag so the UI renders a loading state
   * instead of a churning fake-live meter.
   */
  hydrating = true
  /** ts of the last encounter-relevant activity (attributed damage OR a CC event).
   *  Drives the FALLBACK_IDLE_MS closure independent of the damage timeline. */
  lastActivityTs = 0
  /** Current combat-modifier pair (Task #51): the last stance/invocation the player
   *  committed to, with the ts of that change. Session-scoped (survives zones/epoch —
   *  a stance is not tied to a zone); reset() clears it. Exposed in the snapshot and
   *  used to open/close timeline stance spans on the current encounter. */
  stance?: { name: string; ts: number }
  invocation?: { name: string; ts: number }
  /**
   * BLADE COATS (Task #64). FOUR concurrent coats, because that is what the game has:
   * `coatUtility` is the ONE active utility poison (a new utility coat replaces it) and
   * `coatCombat` holds up to `MAX_COMBAT_COATS` (3) combat venoms, one per mutually-exclusive
   * VENOM LINE — venoms on different lines stack, the two members of a line replace each other
   * (shared/poisons.ts carries the wiki wording). Session-scoped exactly like the stance pair:
   * a coat survives zoning, is cleared by your own death (ingest.ts's playerDeath case) and by
   * reset().
   */
  coatUtility?: CoatSlot
  coatCombat: CoatSlot[] = []
  /**
   * ROLLING TIME-TO-SLOW samples (Task #64), newest last, capped at SLOW_SAMPLE_CAP. One
   * entry per FINALIZED pull that opened with a slow-capable coat on: the ms to the first
   * slow landing, or null when the pull ended without one. The null entries are the whole
   * reason this is a list of samples and not a running mean — they are COUNTED (`noLand`) and
   * never averaged in as zero (law 5).
   */
  slowSamples: (number | null)[] = []
  /**
   * THE ACTIVE-STATE TIMELINE (proc-analytics §3) — "what was on at time T" as an interval
   * model with evidence on both edges. SESSION-level and purely ADDITIVE: it is written
   * alongside the fields above by the same writers (applyStance / routeCoat / routeDry / the
   * proc-buff landing path), and `Encounter.stanceSpans` is deliberately left alone — that
   * list feeds the shipped TimelineView and sits inside the byte-identical regression surface.
   */
  stateTimeline = new StateTimeline()
  /**
   * Rank-normalized own-casts (`You begin casting <Spell>.`) → ts, for the cast-less proc
   * detector. Only the PLAYER prints that line, which is exactly the gate the detector needs.
   * Pruned to the 12s attribution window on write.
   */
  recentCasts: RecentCasts = new Map()
  /**
   * ts of the last `You activate Quick Buff.` (0 = never). That AA re-applies the player's
   * memorized buffs and prints only their LANDINGS — no cast line for any of them — so the
   * burst it opens is cast evidence of a different shape, and the heal side of the cast-less
   * proc inference must not read those landings as procs (procDetect's Quick Buff gate).
   */
  quickBuffTs = 0
  /**
   * WHICH SPECIAL ATTACK IS LIVE IN EACH VERB LANE (specialAttacks.ts). The log states the switch
   * once — `You will now use Dragon Punch instead of Eagle Strike while attacking.` — and every
   * swing afterwards prints only the generic verb, so this is the ONLY thing that can name the
   * lane. Session-scoped and zone-surviving (the state line is printed once and holds across
   * hundreds of zone lines), cleared by reset() and by the epoch boundary.
   */
  specials = new SpecialAttacks()

  /** Enable classification logging (after the historical scan, for the live tail), and
   *  flip HYDRATION off — from here on every snapshot describes the real present. */
  setLive(): void {
    this.recording = true
    this.hydrating = false
  }

  /**
   * Inject the player's own character name (from index.ts's tail ref). This is the
   * authoritative source: called before the scan replay and again on a character
   * switch after reset(). Keyed canonically so it matches the idKey() the heal path
   * uses. Wins over any heal-line-learned name.
   */
  setPlayerName(name: string): void {
    this.playerKey = idKey(name)
    this.playerKeyInjected = true
    this.knownPlayers.add(this.playerKey)
  }

  reset(): void {
    this.petNames.clear()
    this.everPet.clear()
    this.world.reset()
    this.charm.reset()
    this.candidates.reset()
    this.knownPlayers.clear()
    this.playerKey = undefined
    this.playerKeyInjected = false
    this.zone = undefined
    this.current = null
    this.history = []
    this.zoneAgg = new Agg()
    this.zoneFinalizedMs = 0
    this.zoneActiveMs = 0
    this.zoneStartTs = 0
    this.zoneLastTs = 0
    this.zoneHistory = []
    this.zoneSeq = 0
    this.recent = []
    this.recording = false
    // A reset always precedes a fresh full-log scan (startup / character switch), so we're
    // hydrating again until that scan hands off to the tail.
    this.hydrating = true
    this.lastActivityTs = 0
    this.stance = undefined
    this.invocation = undefined
    this.coatUtility = undefined
    this.coatCombat = []
    this.slowSamples = []
    this.stateTimeline.reset()
    this.recentCasts.clear()
    this.quickBuffTs = 0
    this.specials.reset()
  }

  log(ts: number, cat: string, role: ClassifiedLine['role'], text: string): void {
    if (!this.recording) return
    this.recent.push({ ts, cat, role, text })
    if (this.recent.length > RECENT_CAP) this.recent.shift()
  }

  /** The in-progress encounter, but only while it is FRESH — the same rule routeMiss uses so a
   *  non-damage event can attach to the fight it belongs to without reviving a stale one (and
   *  without ever OPENING one: only damage/CC do that). */
  freshEncounter(ts: number): Encounter | null {
    return this.current && ts - this.current.lastTs <= FALLBACK_IDLE_MS ? this.current : null
  }

  /** Append a point annotation to an encounter's marker ring (Task #64), drop-oldest at
   *  MARKER_CAP. Draw-only: no count, DPS or attribution ever reads this. */
  pushMarker(enc: Encounter, m: MarkerRaw): void {
    enc.markers.push(m)
    if (enc.markers.length > MARKER_CAP) enc.markers.shift()
  }

  /** Append one instant to the current encounter's timeline ring (Task #51), capped
   *  drop-oldest at TIMELINE_CAP. Called from route()/routeMiss for attributed events.
   *  `eventsTotal` counts EVERY push, so a fight that outgrows the cap still knows its true
   *  instant count and buildTimeline can declare the loss instead of reporting the ring
   *  length as if it were the fight (law 1). The counter is display metadata only — no
   *  aggregate, DPS or attribution reads it. */
  pushTimeline(enc: Encounter, rec: TimelineRaw): void {
    enc.events.push(rec)
    enc.eventsTotal++
    if (enc.events.length > TIMELINE_CAP) enc.events.shift()
  }

  /**
   * PRESENCE refresh (Task #55) — record that `name` is still in the current fight as of
   * `ts`. This is the liveness axis ONLY: it moves nothing on the damage timeline
   * (enc.lastTs / prevDamageTs / activeMs / lastActivityTs are untouched), so DPS
   * denominators and the fled-mob FALLBACK_IDLE_MS clock are unaffected (AGENTS.md law 8).
   *
   * Deliberately conservative in both directions:
   *   - it never ENGAGES anything: only instances ALREADY in enc.engaged are refreshed,
   *     so a miss/resist still cannot open or join an encounter;
   *   - it never resolves/creates a world instance (it matches the engaged instanceIds
   *     "<nameKey>#gen" by name prefix), so a whiff at a mob we've never damaged has no
   *     side effect on the world model at all.
   * Name-level matching refreshes every engaged twin sharing the name — the log cannot
   * tell twins apart on a miss line, and a retired twin is "gone" via isRetired anyway.
   */
  notePresence(name: string, ts: number): void {
    const enc = this.current
    if (!enc) return
    const key = idKey(name)
    if (this.isKnownPlayer(key)) return
    // …and a GROUP MEMBER is never a hostile either (docs/plans/group-model.md §3.5). Members
    // never reach `engaged` (engageHostile refuses them), so the loop below would find nothing
    // to refresh anyway; the early return states the rule where a reader looks for it and keeps
    // it from depending on that other guard staying correct.
    if (this.isMember(key)) return
    // Keep the WORLD's per-instance clock in lockstep with the encounter's presence axis, so
    // the staleness retirement in WorldModel.resolve() ages an instance out on exactly the
    // same evidence evalClosure() uses to call it gone (see world.ts INSTANCE_STALE_MS).
    this.world.noteSeen(key, ts)
    for (const id of enc.engaged) {
      const hash = id.lastIndexOf('#')
      if (hash > 0 && id.slice(0, hash) === key) this.notePresenceId(enc, id, ts)
    }
  }

  /**
   * Presence refresh for an already-resolved engaged instanceId (see notePresence).
   *
   * PRESENCE DISCIPLINE (Task #65): a refresh may only ever describe a HOSTILE we are
   * fighting. Two entities can never be refreshed here, because keeping the fight alive on
   * their account is what let a stranger's 214-second brawl swallow three of the owner's
   * pulls: a KNOWN PLAYER (never a hostile) and a LIVE PET of ours (never something we are
   * killing — hostilePresence() already skips it, and refreshing it is meaningless).
   */
  notePresenceId(enc: Encounter, instanceId: string, ts: number): void {
    if (!enc.engaged.has(instanceId)) return
    if (this.world.isLivePet(instanceId)) return
    const hash = instanceId.lastIndexOf('#')
    const nameKey = hash > 0 ? instanceId.slice(0, hash) : ''
    if (nameKey !== '' && (this.isKnownPlayer(nameKey) || this.isMember(nameKey))) return
    const prev = enc.engagedSeen.get(instanceId)
    if (prev === undefined || ts > prev) enc.engagedSeen.set(instanceId, ts)
  }

  /** True when `nameKey` is a player (the owner, or someone the heal stream tied to them). */
  isKnownPlayer(nameKey: string): boolean {
    return nameKey === 'you' || this.knownPlayers.has(nameKey)
  }

  /** The live roster view (see rosterProvider). One call per decision, never cached across
   *  lines — the roster can change between any two of them. */
  roster(): RosterView {
    return this.rosterProvider()
  }

  /** The roster as the snapshot serializes it (see rosterSnapProvider). */
  rosterSnap(): RosterSnap {
    return this.rosterSnapProvider()
  }

  /**
   * The pet-claim state the snapshot serializes: the questions worth asking, plus what this
   * character has already answered yes to.
   *
   * DENIED NAMES ARE FILTERED HERE, not at note-time, so clearing a "no" gives the accumulated
   * evidence straight back instead of restarting the count. And a name that has BECOME a pet is
   * gone by construction — `notePet` released it the moment anything bound it (the offer is an
   * unbound-state offer), which is why nothing here has to re-check `petNames`.
   */
  petClaimsSnap(): PetClaimsSnap {
    const view = this.petClaims()
    const claimed = [...view.claimed].map((k) => view.nameOf(k) ?? k)
    if (this.candidates.idle) return claimed.length === 0 ? EMPTY_PET_CLAIMS : { candidates: [], claimed }
    return { candidates: this.candidates.candidates(view.denied), claimed }
  }

  /**
   * True when `nameKey` is someone the engine may book OUTGOING damage for as a group member.
   * This is the ADMISSION test — deliberately the wider `admitted` set, not the live roster, so
   * that a member who left mid-pull keeps being recorded (their damage is real and the Everyone
   * scope shows it) and so that a user REMOVING someone in the popover only ever hides a row.
   */
  isAdmittedMember(nameKey: string): boolean {
    if (nameKey === 'you') return false
    // A pet is never a member. The guard is the same absolute one notePlayer uses and it
    // matters for the same reason: a "member" is excluded from `engaged` and from presence, so
    // one bad entry would silently delete a real pet's damage with no error anywhere.
    if (this.petNames.has(nameKey) || this.everPet.has(nameKey)) return false
    return this.roster().admitted.has(nameKey)
  }

  /**
   * True when `nameKey` is on the roster RIGHT NOW. This is the "never a hostile" test —
   * engageHostile and the presence axis both consult it, because a group member's TARGET is what
   * we are fighting and the member never is (docs/plans/group-model.md §3.5: the 214-second
   * merged pull is what happens when a friendly enters `engaged`).
   *
   * The live roster rather than `admitted`: someone who genuinely left your group and is now
   * duelling you is not protected by having once been a member. The admission set is about
   * damage already earned; this one is about who is on your side now.
   */
  isMember(nameKey: string): boolean {
    return this.roster().members.has(nameKey)
  }

  /**
   * Record player-shaped evidence for a name (see knownPlayers for what counts and why).
   *
   * A PET IS NEVER A PLAYER, and the guard is absolute in both directions: a name that is or
   * has ever been one of your pets — or that any charm broadcast has ever named — can never be
   * filed here, and `notePet` below evicts a name the moment it becomes a pet. Getting this
   * wrong is expensive and silent: a "player" is excluded from `engaged`, from enemy healing,
   * and from a pet's target set, so one bad entry deletes real damage with no error anywhere.
   */
  notePlayer(nameKey: string | null | undefined): void {
    if (!nameKey || nameKey === 'you') return
    if (this.everPet.has(nameKey) || this.charm.everCharmed(nameKey)) return
    this.knownPlayers.add(nameKey)
  }

  /** Bind `nameKey` into the attribution set. THE one door, so "was this ever a pet?" has a
   *  single answer and a player can never shadow one. */
  notePet(nameKey: string): void {
    this.petNames.add(nameKey)
    this.everPet.add(nameKey)
    this.knownPlayers.delete(nameKey)
    // THE OFFER IS AN UNBOUND-STATE OFFER (owner, JOS-47). The instant ANY binding signal lands
    // — the private tell, an owner charm, or the user's own claim, all of which come through
    // this one door — the question stops being a question and the meter stops asking it. No
    // lingering chip, no second question, and no path where a bound pet is also a candidate.
    this.candidates.release(nameKey)
  }

  /** The live pet-claim view (see petClaimsProvider). One call per decision, never cached
   *  across lines — a claim made between two log lines must reach the very next one. */
  petClaims(): PetClaimsView {
    return this.petClaimsProvider()
  }

  /**
   * THE USER'S CLAIM, applied at the first sighting of the name.
   *
   * It walks the SAME door a `… Master.'` tell walks (`world.claim()` + `notePet`), which is
   * what makes the two paths converge rather than compete: `world.claim()` is idempotent on a
   * live pet instance, so whichever arrives second is a no-op and there is exactly one pet, one
   * instance and one row. A claimed pet is a SUMMONED pet — it survives zoning, which is right
   * for the class pets this feature exists for and harmless for anything else (a claimed
   * charmed mob would be re-bound by its own charm line anyway).
   *
   * Returns true when this call did the binding, so the caller can log it once.
   */
  applyPetClaim(name: string, nameKey: string, ts: number): boolean {
    if (this.petNames.has(nameKey)) return false
    if (!this.petClaims().claimed.has(nameKey)) return false
    this.world.claim(name, ts)
    this.notePet(nameKey)
    return true
  }

  /**
   * DEMOTE the charm binds whose corroboration window has closed (charmModel's PROVISIONAL_MS).
   * Driven by the log clock — called once per ingested event and once per snapshot(now) — so a
   * replay and a live tail demote at exactly the same instants. Cheap: the guard is a
   * `Map.size === 0` read, and the map holds at most a handful of names.
   */
  sweepCharm(now: number): void {
    if (this.charm.idle) return
    for (const d of this.charm.sweep(now)) {
      this.world.uncharm(d.display, now)
      this.petNames.delete(d.nameKey)
      this.log(now, 'charm', 'dropped', `✕ ${d.display}: charm bind never corroborated — unbound`)
    }
  }

  /**
   * Learn the player's proper name as a FALLBACK only (injected name wins):
   * "You healed <Player>" where the target is not a pet and not an engaged
   * hostile → that name IS the player. (EQ never writes literal "You" as a heal
   * target; it uses the character name.)
   */
  learnPlayerKey(healerKey: string | null, tKey: string, isYouTgt: boolean, isPetTgt: boolean): void {
    if (
      !this.playerKeyInjected &&
      healerKey === 'you' &&
      !isYouTgt &&
      !isPetTgt &&
      !this.isEngagedHostile(tKey) &&
      this.playerKey === undefined
    ) {
      this.playerKey = tKey
    }
    if (this.playerKey !== undefined) this.knownPlayers.add(this.playerKey)
  }

  /** True if `nameKey` currently resolves to an engaged hostile instance. */
  isEngagedHostile(nameKey: string): boolean {
    if (!this.current) return false
    for (const list of [this.current]) {
      for (const id of list.engaged) {
        // engaged ids are instanceIds "<nameKey>#gen"; compare the nameKey prefix.
        const hash = id.lastIndexOf('#')
        if (hash > 0 && id.slice(0, hash) === nameKey) return true
      }
    }
    return false
  }

  /**
   * INSTANCE-RESOLVED defender label for a damage-free instant (miss/resist), Task #58.
   *
   * The damage path labels its defender `world.label(world.resolve(target, ts))`, so twins
   * read as "a deadly black widow (7)" / "(8)". Miss and resist ticks carried the RAW log
   * name instead, so the dashboard's per-mob panel — which groups timeline instants by
   * `target` — grew a bare-named 0-damage ghost row alongside the two real instances.
   *
   * Resolution is GATED on the name already being engaged in this encounter (the same
   * nameKey-prefix scan notePresence uses). That keeps AGENTS.md law 8 intact in both
   * directions: `engaged` membership only ever comes from LANDED damage/heals, so a whiff
   * at a mob we have never damaged still has ZERO world-model side effects (no instance is
   * spawned, no gen counter moves) and simply keeps its raw name — the honest label when no
   * instance exists. When the name IS engaged, resolve() returns the same instance the next
   * landed hit would, so the miss lands on the right twin's row.
   */
  defenderLabel(enc: Encounter, name: string, ts: number): string {
    const key = idKey(name)
    if (key === 'you') return 'You'
    for (const id of enc.engaged) {
      const hash = id.lastIndexOf('#')
      if (hash > 0 && id.slice(0, hash) === key) return this.world.label(this.world.resolve(name, ts))
    }
    return name
  }

  /**
   * Display names of your GENUINELY-CHARMED live pets (mobs bound by a
   * `<mob> has been charmed.` line). SUMMONED class pets are deliberately excluded —
   * they are pets, not charms. Deliberately NOT in the snapshot: no UI needs a charm
   * roster today, and the old snapshot field lied (it was the attribution set). This is
   * the ONLY correct door for one; never reconstruct it from petNames.
   */
  charmedPetNames(): string[] {
    return this.world.charmedInstances().map((i) => i.display)
  }

  /** Display names of ALL your live pets — charmed AND summoned. This is what the DPS
   *  meter attributes to (both kinds produce `kind: 'pet'` source rows). */
  petDisplayNames(): string[] {
    return this.world.petInstances().map((i) => i.display)
  }
}
