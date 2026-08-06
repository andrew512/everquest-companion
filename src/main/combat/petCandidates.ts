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
//
// ─────────────────────────────────────────────────────────────────────────────
// AND THE FOURTH DIMENSION, added by JOS-49: A QUESTION IS ONLY WORTH ASKING ABOUT NOW.
//
// The bars above are about EVIDENCE. They say nothing about TIME, and evidence is permanent
// while a pet is not — so the detector above, fed the ordinary startup replay of a real log,
// accumulated a candidate for every never-ordered pet since the beginning of the file and never
// let one go. MEASURED on the owner's own log (1,399,542 lines, 425 zone lines, 2026-08-06):
// 101 entities cleared the bars and were still standing at the end of the replay, the strongest
// three of them — the ones the offer actually shows — last seen on Jul 31, Jul 28 and Aug 3,
// i.e. six days, nine days and two days before the log's last line. A meter that opens with a
// wall of questions about pets from last week is unusable, and every one of those questions was
// unanswerable: the entity is long gone and no later line can corroborate it.
//
// So a candidate is offerable only while it is CURRENT, on two axes, both of them read at
// SNAPSHOT time rather than baked into the evidence (the `denied` precedent: gating the question
// must never destroy the answer):
//
//   ZONE       You left the zone; the question went with it. World-model law 4 — a zone
//              transition censors charmed pets and hostiles, and this entity is UNBOUND, so the
//              app does not know which kind it is. What it does know is that if it really is
//              your summoned pet it FOLLOWS YOU and will be seen again within seconds; the P1
//              golden is exactly that case, crossing five zone lines with its evidence intact.
//              Anything that does NOT reappear is censored, not denied — nothing is persisted.
//   IDLE       Inside a zone, an entity that has stopped fighting has stopped being a question.
//              `OFFER_IDLE_MS` below has the measurement.
//
// The two together make the wall STRUCTURALLY impossible rather than merely hidden. Re-measured
// through the shipped engine over the same full replay, sampling the real offer every 100 events:
// the end-of-replay offer goes from 101 questions to ZERO, and the most that were ever standing
// at one moment is THREE — on 2026-07-19 at 22:32, where three unbound pet-shaped entities really
// were fighting beside the owner inside the same minute. That is a true answer, not a backlog.
// (The watch map shrinks with it: 423 entries at the end of the replay before, 6 after, peaking
// at 61 instead of growing monotonically for the life of the log.)

import type { PetCandidate, PetCandidateWhy } from '../../shared/petClaims'
import { FALLBACK_IDLE_MS } from './encounter'

/**
 * How long a candidate may go without landing a hit and still be offered — on the log's own
 * clock, never the wall clock (see `observe`).
 *
 * NOT A TUNED NUMBER: it IS `encounter.ts FALLBACK_IDLE_MS`, the engine's existing answer to "no
 * attributed damage for this long and the fight is over", and it is derived from it rather than
 * copied so the two can never drift. The offer is a question about the fight in front of you, so
 * it lives exactly as long as that fight does.
 *
 * MEASURED (full real log, the 95 entities that ever cleared the bars): of the 5,293 inter-hit
 * gaps a candidate produced AFTER it qualified, 98.0% are under 60 s (p97 = 29 s, p98 = 55 s),
 * so the offer comfortably survives a live pet's own lulls. The 2.0% that exceed it hide the
 * question until the next hit re-qualifies it — an offer blinking off between two pulls is the
 * honest reading, and it is NOT a deny: nothing is persisted and the evidence is untouched.
 * Widening to 120 s recovers 0.8 of those points and triples the worst-case standing count
 * (2 → 6), which is the wrong trade for a surface whose whole complaint was too many questions.
 */
export const OFFER_IDLE_MS = FALLBACK_IDLE_MS

/**
 * How long EVIDENCE is kept for an entity that has gone quiet — a different question from
 * OFFER_IDLE_MS and a much longer answer, because forgetting is not the same as not asking.
 *
 * The gate above hides a question; this one throws the accumulated hits away, so it must only
 * fire when the entity's next appearance would genuinely be a NEW engagement. Half an hour of
 * log time is that boundary: measured over the real log, 99.85% of a qualifying candidate's own
 * inter-hit gaps are shorter (8 of 5,293 exceed it), and summoned pets have random proper names
 * that COLLIDE across sessions — the corpus has a `Gartik` first seen Jul 28 and "last seen"
 * Aug 2, which is two different pets wearing one name. Keeping five days of evidence for that is
 * not memory, it is a mix-up.
 *
 * Swept at zone lines only (425 of them in the real log): frequent enough to bound the map,
 * rare enough to cost nothing. A pet that walks a three-zone corridor with you keeps everything.
 */
const WATCH_RETAIN_MS = 30 * 60_000

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
 *  cap is so a pathological zone can never turn the meter into a survey. Strongest first.
 *
 *  It is a BACKSTOP, not the fix, and JOS-49 is what made that true: with the currency gate in
 *  force the largest number of candidates standing at any one moment across the whole real log
 *  is 3 — three pets genuinely fighting beside you in one minute — instead of a wall of 101
 *  historical ones with this cap papering over it. Left at 3: it now bites once in 1.4M lines,
 *  and on a moment where the answer it truncates is honest. */
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
  /** WHICH ZONE SESSION it was last seen in (`PetCandidates.zoneSeq` at the time). The zone half
   *  of the currency gate: an entity that has not been seen since you zoned is not a question
   *  about the fight in front of you. Stamped on every touch, never on a read. */
  zoneSeq: number
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
  /**
   * THE DETECTOR'S OWN CLOCK — the newest LOG timestamp it has been shown, and the only "now"
   * the currency gate ever reads.
   *
   * The log clock rather than the wall clock, and that is load-bearing rather than stylistic:
   * `snapshot(now)` is called with `Date.now()` even during the startup replay of a log whose
   * last line is hours old, so a wall-clock "now" would age every candidate out in the middle of
   * the replay and then never let one back in. Reading the stream's own time is what makes a
   * replay and a live tail behave identically, which is the contract this class already had.
   *
   * HONEST LIMIT, stated rather than papered over: if the game log falls completely silent, this
   * clock stops with it, so a standing question outlives its 60 s on a genuinely idle character.
   * That is the same "state is only as fresh as the log" the whole engine runs on, and the wall
   * of historical pets — the thing that made the meter unusable — cannot come back either way.
   */
  private nowTs = 0
  /** How many zone lines have been observed. Compared against `Watch.zoneSeq`; never displayed. */
  private zoneSeq = 0

  reset(): void {
    this.watch.clear()
    this.out.clear()
    this.yourTargets.clear()
    this.nowTs = 0
    this.zoneSeq = 0
  }

  /**
   * ADVANCE THE CLOCK to `ts`. Called from ingest.ts for EVERY event, so the gate measures a
   * candidate's silence against the log's real progress rather than against the last thing that
   * happened to be a hit — an entity that stopped fighting while the log went on is precisely
   * what "no longer current" means.
   *
   * Monotonic: out-of-order or malformed stamps can only ever be ignored, never rewind the gate.
   */
  observe(ts: number): void {
    if (ts > this.nowTs) this.nowTs = ts
  }

  /**
   * YOU LEFT THE ZONE (`You have entered X.`). World-model law 4's censor, applied to the
   * QUESTION rather than to a bound entity: candidates are unbound by definition, so the app
   * cannot know whether one is a summoned pet that follows you or a charmed mob that does not —
   * and the honest test is simply whether it shows up again. From here on nothing already
   * watched is offerable until it lands another hit.
   *
   * The zone line is also where the map is SWEPT, and the sweep is deliberately NOT the gate: it
   * drops only what `WATCH_RETAIN_MS` says is a different engagement entirely. Pruning everything
   * that missed one zone was tried and is WRONG — the P1 golden zones through a two-and-a-half
   * minute Lavastorm corridor its pet does not fight in, and a zone-count prune reduced Kober's
   * four says to one. A pet that walks a corridor with you is the same pet.
   */
  zone(ts: number): void {
    this.observe(ts)
    for (const [key, w] of this.watch) if (this.nowTs - w.lastSeenTs > WATCH_RETAIN_MS) this.watch.delete(key)
    this.zoneSeq++
  }

  /** True when nothing is being watched — lets the caller skip building a snapshot. */
  get idle(): boolean {
    return this.watch.size === 0
  }

  /** The live watch for `key`, or null when it is disqualified. */
  private entry(key: string, name: string, ts: number): Watch | null {
    this.observe(ts)
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
        lastSeenTs: ts,
        zoneSeq: this.zoneSeq
      }
      this.watch.set(key, w)
    }
    // Seen HERE, now — the two halves of "current", stamped at the one place every touch goes
    // through, so no note path can accidentally leave a candidate looking stale or looking fresh.
    // MONOTONIC since JOS-49: `lastSeenTs` gates the offer, so a line that arrives with an older
    // stamp than one already folded (a same-second reorder, a retroactive credit) must not be
    // able to make a live candidate look stale.
    if (ts > w.lastSeenTs) w.lastSeenTs = ts
    w.zoneSeq = this.zoneSeq
    return w
  }

  /**
   * YOU damaged `targetKey`. Two things at once, and they pull in opposite directions on
   * purpose: the name joins your target set (so anything fighting it is fighting WITH you) and
   * is disqualified as a candidate forever (you do not attack your own pet).
   */
  noteYourTarget(targetKey: string, ts: number): void {
    this.observe(ts)
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
   * The questions worth asking, strongest evidence first, capped. `denied` and the CURRENCY gate
   * are both consulted HERE rather than at note-time, for the same reason: a user who changes
   * their mind (clears the deny) gets the accumulated evidence back rather than starting from
   * zero, and an entity that goes quiet and then fights beside you again re-qualifies with its
   * whole history rather than from scratch. Gating the question never destroys the answer.
   */
  candidates(denied: ReadonlySet<string> = new Set()): PetCandidate[] {
    const out: PetCandidate[] = []
    for (const w of this.watch.values()) {
      if (denied.has(w.key)) continue
      if (!this.current(w)) continue
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

  /**
   * IS THIS STILL A QUESTION ABOUT NOW? (JOS-49 — the currency gate; the module header has the
   * measurements.) Both halves are cheap comparisons against state the class already keeps, and
   * neither of them writes anything: aging out of the offer is not a deny, and an entity that
   * reappears is offered again with every point of its evidence intact.
   */
  private current(w: Watch): boolean {
    if (w.zoneSeq !== this.zoneSeq) return false
    return this.nowTs - w.lastSeenTs <= OFFER_IDLE_MS
  }

  /** Does this watch clear a bar, and which one? Null when it clears neither. */
  private verdict(w: Watch): PetCandidateWhy | null {
    if (w.shared.size < MIN_SHARED_TARGETS) return null
    if (w.says > 0 && w.hits >= MIN_HITS_WITH_SAY) return 'say'
    if (w.hits >= MIN_HITS) return 'target'
    return null
  }
}
