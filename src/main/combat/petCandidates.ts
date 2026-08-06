// PET CANDIDATES — the detector behind the meter's "<Name> — your pet?" question (JOS-47).
//
// It answers ONE question and refuses the neighbouring one: *is this entity pet-shaped enough
// to be worth asking about* — never *is it mine*. Nothing here binds, nothing here books a
// point of damage, and nothing here touches the world model. It watches the same damage stream
// `classify()` is already dropping on the floor and remembers who kept showing up.
//
// WHY A DETECTOR AND NOT A RULE. The obvious rule — "a pet-voiced say binds the speaker" — is
// unsafe and measurable: `says` is broadcast, and the corpus contains public pet-says from
// entities that were provably another player's (`An isle goblin`, `A large heart spider` —
// article-named charm pets the owner never charmed). The obvious weaker rule — "an entity that
// fights what you fight is your pet" — is unsafe for a different reason: in a group, your
// group-mate's pet does exactly that. Both are excellent EVIDENCE and neither is ownership, so
// both end at a question. Law 1: anything inferred is labelled inferred, and a guess is never
// silent.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DISQUALIFIERS ARE THE REAL WORK. A candidate must survive all of them:
//
//   ARTICLE NAME     `a spite golem` is a mob. Summoned pets — the population this feature
//                    exists for — always carry a random PROPER name, and charmed mobs (which
//                    do carry article names) already have a binding path of their own. So the
//                    proper-name test costs nothing real and excludes the entire mob namespace
//                    in one line.
//   YOU HIT IT       You do not attack your own pet. This is what removes proper-named MOBS
//                    (`Cleric of Innoruuk`, `Lord of Loathing`) without a mob catalog.
//   IT HIT YOU       Likewise, and it removes duels and any hostile with a proper name.
//   KNOWN PLAYER     EngineState.knownPlayers — someone who healed you is not a pet.
//   GROUP MEMBER     A roster name is a person.
//   EVER CHARMED     A name any charm broadcast has ever named is a mob, ours or a stranger's
//                    (charmModel.everCharmed — the same guard notePlayer uses).
//   ALREADY A PET    Bound by a tell, a charm or a previous claim: there is nothing to ask.
//   DENIED           The user already said no. Asked once, never again.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THRESHOLDS, and why they are shaped like this rather than tuned. A candidate needs BOTH
// a volume of landed hits and a plurality of SHARED TARGETS, because the two failure modes are
// different: a single passer-by adding one hit to your mob is excluded by the volume, and a
// mob that happens to be fighting the same thing you are for one long pull is excluded by the
// target count (it never follows you to the next pull). A pet-voiced say substitutes for the
// volume — an entity that literally answered a pet command needs less behavioural proof — but
// NOT for the shared target, because that is the only half of the evidence that ties it to you.

import type { PetCandidate, PetCandidateWhy } from '../../shared/petClaims'

/**
 * Landed hits before a purely BEHAVIOURAL candidate is worth a question. A summoned pet
 * swinging beside you clears this inside one pull (the reporter's weakest of three pets landed
 * 42 hits in the sixteen minutes it lived); a stranger who lands a lucky blow on your mob never
 * does. Deliberately a count of LANDED hits, not of damage: a low-level pet is still a pet.
 */
export const MIN_HITS = 20

/** …and with a pet-voiced say in hand, the volume bar drops to "it is actually fighting". */
export const MIN_HITS_WITH_SAY = 3

/**
 * Distinct mobs it fought that YOU also fought. Two, not one, and that is the whole
 * anti-coincidence rule: sharing one target is what everybody in a contested camp does;
 * following you to a SECOND one is what a pet does. A say does not lower this — the shared
 * target is the only evidence that ties the speaker to you rather than to the player standing
 * next to you.
 */
export const MIN_SHARED_TARGETS = 2

/** How many questions the meter may ever hold at once. A user with a genuine pet has one; the
 *  cap is so a pathological zone can never turn the meter into a survey. Strongest first. */
export const MAX_CANDIDATES = 3

/** Your recent targets, capped — the set a candidate's targets are matched against. Big enough
 *  to span a camp's rotation, small enough that it is a handful of strings. */
const YOUR_TARGET_CAP = 64

interface Watch {
  key: string
  name: string
  hits: number
  damage: number
  says: number
  /** Targets it has damaged that are also in `yourTargets`. */
  shared: Set<string>
  /** Every target it has damaged, so a mob you engage LATER still counts retroactively. */
  targets: Set<string>
  firstSeenTs: number
  lastSeenTs: number
}

/** True when a raw name is PROPER — no leading article. See the disqualifier note above. */
export function isProperName(name: string): boolean {
  return !/^(?:a|an|the)\s/i.test(name.trim())
}

/**
 * PURE + CLOCK-INJECTED, like CharmModel: every method takes the log timestamp it is reasoning
 * at, so a replay and a live tail behave identically. No engine state, no I/O, no Date.now().
 */
export class PetCandidates {
  private watch = new Map<string, Watch>()
  /**
   * Names that can never be candidates this session (see the disqualifier table). A SET rather
   * than a flag on the watch entry, so `idle` stays an honest "there is nothing to ask about"
   * — the disqualified population is every mob you have ever swung at, and a tombstone in the
   * watch map would make the snapshot's fast path unreachable for the whole session.
   */
  private out = new Set<string>()
  /** Canonical keys YOU have damaged this session — the disqualifier, and also the target set
   *  a candidate's own targets are matched against. Insertion-ordered, capped. */
  private yourTargets = new Set<string>()

  reset(): void {
    this.watch.clear()
    this.out.clear()
    this.yourTargets.clear()
  }

  /** True when nothing is being watched — lets the caller skip building a snapshot. */
  get idle(): boolean {
    return this.watch.size === 0
  }

  /** The live watch for `key`, or null when it is disqualified. */
  private entry(key: string, name: string, ts: number): Watch | null {
    if (this.out.has(key)) return null
    let w = this.watch.get(key)
    if (!w) {
      w = {
        key,
        name,
        hits: 0,
        damage: 0,
        says: 0,
        shared: new Set(),
        targets: new Set(),
        firstSeenTs: ts,
        lastSeenTs: ts
      }
      this.watch.set(key, w)
    }
    w.lastSeenTs = ts
    return w
  }

  /**
   * YOU damaged `targetKey`. Two things at once, and they pull in opposite directions on
   * purpose: the name joins your target set (so anything fighting it is fighting WITH you) and
   * is disqualified as a candidate forever (you do not attack your own pet).
   */
  noteYourTarget(targetKey: string, ts: number): void {
    this.disqualify(targetKey)
    if (this.yourTargets.has(targetKey)) {
      // Refresh recency: re-insert at the end so the cap evicts the genuinely stale.
      this.yourTargets.delete(targetKey)
    }
    this.yourTargets.add(targetKey)
    if (this.yourTargets.size > YOUR_TARGET_CAP) {
      const oldest = this.yourTargets.values().next().value
      if (oldest !== undefined) this.yourTargets.delete(oldest)
    }
    // A target you have now engaged may already have been fought by a watched entity — credit
    // it retroactively, so a pet that opened on the mob before your first swing still counts.
    for (const w of this.watch.values()) if (w.targets.has(targetKey)) w.shared.add(targetKey)
    void ts
  }

  /**
   * An UNATTRIBUTED attacker landed a hit. Called from the one place `classify()` returns
   * `ignore` for an outgoing-shaped line, so this sees exactly the damage the meter is
   * currently throwing away — which is the honest definition of "what the user is missing".
   */
  noteHit(hit: { key: string; name: string; targetKey: string; amount: number; ts: number }): void {
    if (!isProperName(hit.name)) return
    const w = this.entry(hit.key, hit.name, hit.ts)
    if (!w) return
    w.hits++
    w.damage += hit.amount
    w.targets.add(hit.targetKey)
    if (this.yourTargets.has(hit.targetKey)) w.shared.add(hit.targetKey)
  }

  /** A pet-voiced PUBLIC say from `key` (shared/logScrub.ts PET_SAY_LINES). Evidence only. */
  noteSay(key: string, name: string, ts: number): void {
    if (!isProperName(name)) return
    const w = this.entry(key, name, ts)
    if (w) w.says++
  }

  /**
   * `key` is not a candidate and never will be this session — a player, a group member, a name
   * a charm broadcast has named, an entity that hit you, or one you hit. PERMANENT: the
   * evidence is dropped and no later hit or say can rebuild it.
   */
  disqualify(key: string): void {
    this.out.add(key)
    this.watch.delete(key)
  }

  /** Forget a name entirely — the user answered the question, or something BOUND the entity, so
   *  it is no longer a question. Unlike `disqualify` this leaves no tombstone: a name that has
   *  become a pet is handled by `petNames` from here on, and one the user denied is filtered at
   *  read time so that clearing the deny gives the accumulated evidence back. */
  release(key: string): void {
    this.watch.delete(key)
  }

  /**
   * The questions worth asking, strongest evidence first, capped. `denied` is consulted HERE
   * rather than at note-time so that a user who changes their mind (clears the deny) gets the
   * accumulated evidence back rather than starting from zero.
   */
  candidates(denied: ReadonlySet<string> = new Set()): PetCandidate[] {
    const out: PetCandidate[] = []
    for (const w of this.watch.values()) {
      if (denied.has(w.key)) continue
      const why = this.verdict(w)
      if (!why) continue
      out.push({
        key: w.key,
        name: w.name,
        why,
        hits: w.hits,
        damage: w.damage,
        sharedTargets: w.shared.size,
        says: w.says,
        firstSeenTs: w.firstSeenTs,
        lastSeenTs: w.lastSeenTs
      })
    }
    // A spoken candidate outranks a merely behavioural one; within a tier, the one whose
    // damage the user is missing most.
    out.sort((a, b) => (a.why === b.why ? b.damage - a.damage : a.why === 'say' ? -1 : 1))
    return out.slice(0, MAX_CANDIDATES)
  }

  /** Does this watch clear a bar, and which one? Null when it clears neither. */
  private verdict(w: Watch): PetCandidateWhy | null {
    if (w.shared.size < MIN_SHARED_TARGETS) return null
    if (w.says > 0 && w.hits >= MIN_HITS_WITH_SAY) return 'say'
    if (w.hits >= MIN_HITS) return 'target'
    return null
  }
}
