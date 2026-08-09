// buffTimers.ts — the CROWD-CONTROL half of the buffs/debuffs timer overlay (JOS-89), and since
// JOS-140 a half of ONE model rather than a second one.
//
// Design record: docs/plans/buff-timer-overlay.md. The honesty law + the projection live in
// shared/buffTimers.ts; this module owns only the state that law needs and the buffs model
// does not already hold.
//
// WHY A SEPARATE MODULE, AND WHY IT IS THIS SMALL. `modules/buffs.ts` already tracks buff
// INSTANCES per (spell line, entity) — including debuffs on named mobs — with cast-anchored
// attribution, candidate resolution, death/zone/charm censoring and the DB duration prior. The
// overlay reads all of that straight off `BuffsSnap.active` rather than folding a second copy of
// it, because a second fold of the same events is exactly the two-models-with-different-reach scar
// world-model law 4 is made of.
//
// What `buffs.ts` demonstrably does NOT hold is the mez itself. `<mob> has been mesmerized.` is
// claimed by `classifyCcApply`, which sits above the DB matcher in the cascade, so it never
// becomes a `buffApply` and never becomes an instance — `BuffsModule.dispatchEntity` uses the
// event to note the current hostile target and nothing more. That is the whole gap, and this
// module is the whole fix: per-target holds, keyed by mob, so ONE AE mez landing on four enemies
// is four named rows with four independent clocks. (Measured in tests/fixtures/w10-cazic-slow.log:
// one `You begin casting Mesmerization III.` prints two `has been mesmerized.` lines in the same
// second, and later three.)
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT JOS-140 CHANGED, AND WHY THE TICKET EXISTED (measured in JOS-126's investigation).
//
// This module used to be DB-STATED BY DESIGN and said so: a mez counted down from whatever
// spells.json states and nothing could ever teach it otherwise. That is what the field report is
// about. The committed DB has ONE row for the Mesmerization line (24 s, the base rank's) and ZERO
// rows at rank VI or above — the scrape is classic-EQ data that does not know the Legends
// re-tiering — while a 0.14.0 enchanter's Mesmerization VII really runs 42-47 s. So the bar hit
// zero at 24 s and sat there overdue for another twenty seconds, on every cast, forever. The root
// cause was not a broken learner: there was no learner on this path at all.
//
// There is one now, and it is not a second one. Three objects are HANDED to this module by
// `modules/buffs.ts` through the wiring, and every one of them was previously duplicated here:
//   • `CastAnchors` — the attribution gate. Two copies of a cast history is how the two halves
//     drifted; there is one.
//   • `SpellStats` — the learner. Holds mint into it and read `estimateFor(line, caster)` back out,
//     which is the SAME max(DB floor, recent observed max) the buff rows have used since JOS-117.
//   • `HoldGroup` (modules/buffRounds.ts) — the count-and-close rule. The old code kept ONE hold
//     per mob NAME and overwrote its clock, so a round of nine landings became four rows and five
//     wear-offs matched nothing. Now a name holds a multiset and the row carries a count chip.
//
// MEASURED YIELD on the reporter's own bytes (report 01KZJHXJVAA7FNRDW83CTAYSF8, 761 lines): fifty
// landings, twenty-one wear-offs, and exactly TWO clean cycles — 43 s and 44 s, the two rounds
// whose mob name happened to be unique. Fed to the estimator that reads 44 s where it read 24 s,
// and it climbs toward the reporter's own 46 s as unique-name cycles accumulate. Fifty-six cycles
// are refused, which is the point.

import type { LogEvent } from '../../shared/logEvents'
import type { BuffTimersDelta, BuffTimersSnap, CcEnd, CcHold } from '../../shared/buffTimers'
import { statedDuration } from '../../shared/buffTimers'
import { SELF_CASTER } from '../../shared/buffTrust'
import { idKey } from '../log/parseCommon'
import { CastAnchors } from './buffAnchors'
import { HoldGroup } from './buffRounds'
import { expiryGraceMs, MAX_SAMPLE_MS, SESSION_GAP_MS, spellKey } from './buffsShapes'
import { SpellStats } from './buffsStats'
import type { EqModule } from './types'

/**
 * How long an END is remembered. It exists so the PROJECTION can retire a matching `ActiveBuff`
 * the buffs model never clears (shared/buffTimers.ts `endedByCc` states why that correction lives
 * there), and so the overlay can flash a drop — both of which are seconds-scale concerns. It is
 * not a history.
 */
export const CC_END_MEMORY_MS = 60_000

/**
 * Slack past an ESTIMATED duration before a hold is dropped for lack of a break line.
 *
 * IT IS MEASURED FROM THE NUMBER THE BAR IS DRAWING, not from the DB row (JOS-126 A6). With the DB
 * row's 24 s this expired a Mesmerization VII hold at 54 s while its real wear-off landed at 42-47
 * — inside the grace by seven seconds, and outside it on a slower round. The grace has to follow
 * the estimate or it retires the very holds the learner needs to close.
 *
 * The number itself now follows the estimate's QUALITY too (`expiryGraceMs`, JOS-140): a learned
 * duration gets 15 s, a DB floor gets its own duration again (min 60 s) because the floor is the
 * base rank's and the truth routinely runs past it. The flat 30 s this used to be sat between the
 * two and was wrong at both ends. Exported still, as the number the fixture tests reason about.
 */
export const CC_END_GRACE_MS = 30_000

/**
 * The bound on a hold whose duration NOBODY states. It is the LONGEST stated CC duration in the
 * committed spells.json — 660 s, Ensnare — rather than a number somebody liked: past the longest
 * hold the game's own data describes, the absence of a break line is evidence we lost the thread,
 * not evidence the mob is still held. `tests/buffTimers.test.mts` re-derives it from spells.json
 * against the parser's own `ccSpell` roster on every run, so a future scrape that adds a longer
 * member fails the suite instead of silently truncating somebody's timer.
 */
export const CC_UNKNOWN_CAP_MS = 660_000

/** A candidate spell as the `cc` (or `charm`) broadcast carries it. */
interface CcCandidate {
  name: string
  durationMs: number | null
}

/** What the anchors made of one landing: the spell, whose it is, and what it can be learned from. */
interface CcIdentity {
  resolved: CcCandidate | null
  /** The rank-stripped LINE, or '' for a family the anchors could not narrow. */
  lineKey: string
  /** The RANKED display name from the cast line. Empty alongside an empty `lineKey`. */
  display: string
  caster: string
  /** Two ranks of this line were in flight at once, so no sample may be minted (ruling 5). */
  rankChanged: boolean
}

/**
 * The landings of one (spell line, mob name), plus the bookkeeping the snapshot does not carry.
 *
 * ONE OF THESE IS ONE ROW. Its `group` holds a landing per mob of that name we believe is held —
 * `group.count` is the count chip, `group.oldestTs` is the clock the row draws (the landing the
 * next anonymous wear-off will close).
 */
interface Held {
  /** Canonical key: the mob's `idKey` plus the spell line, so two spells on one mob are two rows. */
  key: string
  /** Canonical mob key (idKey) — the entity half of the identity. */
  entityKey: string
  /** The mob's display name, raw from the log (world-model law 2). */
  target: string
  /** The rank-stripped spell LINE, when the anchor resolved one. Empty for a family row. */
  lineKey: string
  /** The RANKED display name from the cast line, when one resolved. */
  spell?: string
  candidates: string[]
  /** Whose cast: 'self' or an allowlisted external. */
  caster: string
  durationMs: number | null
  source?: 'db' | 'observed'
  group: HoldGroup
}

/** Write the estimator's answer onto a hold. The absent `source` is deleted, never set to
 *  undefined, so the snapshot's optional field stays absent rather than explicitly nothing. */
function setDuration(held: Held, est: { ms: number | null; source?: 'db' | 'observed' }): void {
  held.durationMs = est.ms
  if (est.source) held.source = est.source
  else delete held.source
}

export class BuffTimersModule implements EqModule<BuffTimersSnap, BuffTimersDelta> {
  readonly id = 'buffTimers'

  private holds = new Map<string, Held>()
  private ends: CcEnd[] = []
  private lastEventTs = 0
  private dirty = false

  /**
   * OUR OWN REVISION, NOT THE LAST EVENT'S seq (JOS-87). `useModule` dedupes with
   * `if (d.seq <= knownSeq) return`, so a revision counter only works when the state moves ONLY
   * when an event moves it — and this module's does not: `onTick` expires holds on a log that is
   * idle, which is precisely when someone is watching a mez run out. A delta that advanced no
   * log seq would be dropped as a duplicate and the row would sit on screen forever.
   */
  private rev = 0

  /**
   * The SHARED halves (JOS-140 ruling 1). Both default to private instances so a test or a script
   * can construct this module alone, but production hands over the buffs module's own — see the
   * header. Sharing them is what makes "one model" true: the same anchor admits a mez and a slow,
   * and the same learner holds both their durations.
   */
  constructor(
    private readonly anchors: CastAnchors = new CastAnchors(),
    private readonly stats: SpellStats = new SpellStats()
  ) {}

  reset(): void {
    this.holds = new Map()
    this.ends = []
    this.lastEventTs = 0
    this.rev = 0
    this.dirty = false
  }

  onEvent(ev: LogEvent): void {
    // A 30-minute event-time hole is past any hold this module can carry (the same boundary the
    // buffs model uses), and a character epoch is a different character entirely.
    if (ev.kind === 'epoch') {
      this.clearAll()
      return
    }
    // AN OFFLINE GAP CHANGES NOTHING HERE, AND THAT IS THE DESIGN (JOS-134, owner 2026-08-09;
    // re-affirmed by JOS-140 as the ONE sanctioned divergence between the two halves of one model).
    //
    // `modules/buffs.ts` folds this event to PAUSE your beneficial buffs: EQ freezes them with
    // your character, so their timers stop while you are out of the world. Everything this module
    // holds is the other kind — a mez, a root, an ensnare, on somebody else — and the world those
    // mobs stand in does not stop when you camp. A hold keeps burning down in world time, so its
    // landings are left exactly where they are and the ordinary `sweep` retires them on schedule,
    // offline or not.
    //
    // This is an EXPLICIT no-op rather than an absent case for exactly one reason: the asymmetry
    // looks like an oversight from inside this file, and the next reader to notice that the buffs
    // model pauses and this one does not should find the answer here instead of "fixing" it. The
    // early return also keeps the derived event out of `lastEventTs`, which the primary
    // `sessionStart` it restates has already recorded.
    if (ev.kind === 'offlineGap') return
    if (this.lastEventTs > 0 && ev.ts - this.lastEventTs >= SESSION_GAP_MS) this.clearAll()
    this.lastEventTs = ev.ts
    this.sweep(ev.ts)
    this.dispatch(ev)
  }

  private dispatch(ev: LogEvent): void {
    switch (ev.kind) {
      case 'cc':
        if (ev.refresh === true) this.end(idKey(ev.mob), ev.ts, ev.spell)
        else this.apply(ev.mob, ev.ts, ev.candidates)
        break
      case 'charm':
        // CHARM IS A DETRIMENTAL HOLD, IN THE SAME SHAPE AS A MEZ (JOS-140, owner amendment
        // 2026-08-09). `<mob> has been charmed.` is claimed by `classifyCharm` above the CC
        // classifier, so before this it opened nothing anywhere and there was no charm countdown
        // at all — for an enchanter, charm-break timing is the whole game. It is the same call,
        // the same anchor gate, the same learner: charm durations vary wildly, which is exactly
        // what the max-over-window estimator and the clean-cycle refusal are for.
        //
        // WHAT IT IS NOT is a claim about the entity's DISPOSITION. The charmed mob is your pet
        // and simultaneously carries this detrimental hold, so it legitimately appears in BOTH
        // windows — a Tashani and a charm bar under DEBUFFS, a pet haste under BUFFS, one name.
        // Nothing routes by target (shared/buffTimers.ts `timerRowSurface` reads the row's kind,
        // and the kind reads the spell's nature).
        this.apply(ev.mob, ev.ts, ev.candidates)
        break
      case 'uncharm':
        // Charm and CC break through the SAME sentence family; a charm break on a mob we were
        // also holding is that hold ending too. The line NAMES the charm spell, so it closes that
        // line's hold and leaves a mez on the same mob alone.
        this.end(idKey(ev.mob), ev.ts, ev.spell)
        break
      case 'death':
        this.end(idKey(ev.name), ev.ts)
        break
      case 'zone':
        // You left them behind (world-model law 4's censor).
        this.clearHolds()
        break
      default:
        break
    }
  }

  /**
   * A fresh `<mob> has been mesmerized|enthralled|entranced|ensnared.`
   *
   * THE ANCHOR GATE (JOS-140 ruling 2, JOS-89's original rule generalized). The sentence is a
   * BROADCAST and names no caster, so a hold is opened only when a cast line anchors it — the
   * player's own, or an allowlisted external's. This is the identical ruling `combat/ingest.ts
   * ingestCc` already makes for the encounter model ("a stranger's crowd control is an observation
   * about the room, not an event in our fight"). Without it a crowded zone fills this overlay with
   * other enchanters' work.
   *
   * THE NARROWING is JOS-84's law: the parser hands over every spell the sentence could be, and
   * the MODEL resolves against the anchors. Exactly one anchored candidate ⇒ that spell, by its
   * RANKED name (the cast line is the only line in the family that carries a rank, which is why
   * the row can print `Mesmerization VII` where the log's own landing and wear-off lines cannot).
   * More than one, or none ⇒ the row stays a FAMILY and states a duration only if every candidate
   * agrees on one.
   */
  private apply(mob: string, ts: number, candidates?: CcCandidate[]): void {
    const cands = candidates ?? []
    // No DB (so no candidates at all) means we cannot tell our own mez from a stranger's, and the
    // honest answer to "whose is it?" is not to guess. No anchored cast means the same thing.
    // (A Quick Buff burst is deliberately NOT an anchor here: it names no spell, and every member
    // of the crowd-control roster is a targeted cast with a cast line of its own.)
    const own = cands.filter((c) => this.anchors.namedAnchorFor(c.name, ts) != null)
    if (own.length === 0) return
    const id = this.resolveCc(own, ts)
    const held = this.ensureHold(mob, id, cands, own)

    // The Buffs TAB lists every line the model has knowledge about, and a mez is now one of them —
    // JOS-126's reporter could not see the learned number anywhere, because the CC path never
    // touched the learner at all.
    if (id.lineKey !== '') {
      this.stats.everFaded.add(id.lineKey)
      this.stats.touchLastSeen(id.lineKey, ts)
      held.spell = id.display
    }

    // THE DURATION the bar draws. Resolved ⇒ the shared estimator, keyed on (line, caster): the DB
    // row is the FLOOR and this caster's own clean observations extend it. Unresolved ⇒ the DB
    // agreement rule alone, because there is no line to look a learned value up under.
    setDuration(held, id.lineKey !== '' ? this.stats.estimateFor(id.lineKey, id.caster) : { ms: statedDuration(own) })

    // A FAMILY, or a cast window holding two ranks of one line, can never say what it measured.
    held.group.land(ts, id.lineKey === '' || id.rankChanged)
    this.dirty = true
    this.rev += 1
  }

  /**
   * Which spell (and whose) this landing is, from the anchored candidates. Exactly ONE anchored
   * candidate resolves it; anything else leaves an empty `lineKey`, which is this file's spelling
   * of "a family, not a name" — the honest do-not-know JOS-84 requires.
   */
  private resolveCc(own: readonly CcCandidate[], ts: number): CcIdentity {
    const resolved = own.length === 1 ? own[0] : null
    if (!resolved) return { resolved: null, lineKey: '', display: '', caster: SELF_CASTER, rankChanged: false }
    const anchor = this.anchors.namedAnchorFor(resolved.name, ts)
    return {
      resolved,
      lineKey: spellKey(resolved.name),
      display: anchor?.display ?? resolved.name,
      caster: anchor?.caster ?? SELF_CASTER,
      rankChanged: anchor?.rankChanged === true
    }
  }

  /** The (mob, line) hold this landing belongs to, created on first sight. */
  private ensureHold(
    mob: string,
    id: CcIdentity,
    cands: readonly CcCandidate[],
    own: readonly CcCandidate[]
  ): Held {
    const shown = cands.map((c) => c.name).sort((a, b) => a.localeCompare(b))
    const key = `${idKey(mob)}|${id.lineKey || shown.join('+').toLowerCase()}`
    const existing = this.holds.get(key)
    if (existing) {
      existing.target = mob
      existing.caster = id.caster
      return existing
    }
    const held: Held = {
      key,
      entityKey: idKey(mob),
      target: mob,
      lineKey: id.lineKey,
      candidates: id.resolved ? shown : own.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      caster: id.caster,
      durationMs: null,
      // NEVER a singleton: a mob is a NAME the world hands out more than once, and separating
      // two of them is one of world-model law 6's documented non-distinguishables.
      group: new HoldGroup(false)
    }
    this.holds.set(key, held)
    return held
  }

  /**
   * A line said one of these ended — a break/wear-off, a charm break, or the mob dying.
   *
   * It closes the OLDEST landing of that (mob, spell) — see buffRounds.ts for why oldest-first is
   * the only honest choice — and MINTS a duration sample when that landing was a clean cycle. The
   * row survives with one fewer on its count chip; only an empty group removes it.
   */
  private end(entityKey: string, ts: number, spell?: string): void {
    const line = spell != null ? spellKey(spell) : null
    let closedAny = false
    for (const [key, held] of [...this.holds]) {
      if (held.entityKey !== entityKey) continue
      // A named break line closes only the matching LINE; an anonymous one (a death, a charm
      // break) closes every hold on that mob, because the mob itself is gone.
      if (line != null && held.lineKey !== '' && held.lineKey !== line) continue
      this.closeOne(held, ts)
      closedAny = true
      if (held.group.empty) this.holds.delete(key)
      this.dirty = true
      this.rev += 1
    }
    // A death line for a mob we were never holding ends nothing and is not recorded: the buffs
    // model already censors that mob's debuff instances itself (`retireEntity(key,
    // {hostileOnly:true})`), so an end here would be a second opinion about a fact already
    // settled — and one that would churn the snapshot on every kill in the zone.
    if (!closedAny && spell == null) return
    // Recorded even when we held nothing, IF the line named a spell: that is a real CC break,
    // and the projection uses it to retire an ActiveBuff the buffs model does not clear (see
    // shared/buffTimers.ts `endedByCc`), which can exist without a hold beside it.
    this.ends.push({ key: entityKey, ts, ...(spell != null ? { spell } : {}) })
    this.dirty = true
    this.rev += 1
  }

  /** Close this hold's OLDEST landing, minting a sample when that landing was a clean cycle. */
  private closeOne(held: Held, ts: number): void {
    const closed = held.group.closeOldest(ts)
    const sample = closed?.sampleMs
    if (sample == null || sample <= 0 || sample > MAX_SAMPLE_MS) return
    this.stats.pushSample(held.lineKey, held.caster, held.spell ?? held.candidates[0] ?? held.lineKey, sample)
    // Re-read the estimate for every live hold of this line: a sample that just beat the DB floor
    // must move the bars that are still counting, not only the next cast's.
    this.restatLine(held.lineKey, held.caster)
  }

  /** Re-read the estimator for every live hold of one (line, caster) after a sample landed. */
  private restatLine(lineKey: string, caster: string): void {
    if (lineKey === '') return
    const est = this.stats.estimateFor(lineKey, caster)
    for (const held of this.holds.values()) {
      if (held.lineKey === lineKey && held.caster === caster) setDuration(held, est)
    }
  }

  /** Drop landings nothing ended and ends nobody needs any more. */
  private sweep(nowMs: number): void {
    for (const [key, held] of this.holds) {
      // THE UNWITNESSED-EXPIRY CULL. A hold whose countdown ran out and whose break line never
      // arrived — you died, you zoned, the mob wandered off — is dropped rather than left
      // squatting at 0s. It mints nothing and records no end, because nothing was observed.
      const life =
        held.durationMs != null
          ? held.durationMs + expiryGraceMs(held.source, held.durationMs)
          : CC_UNKNOWN_CAP_MS
      if (held.group.dropExpired(nowMs - life) > 0) {
        this.dirty = true
        this.rev += 1
      }
      if (held.group.empty) this.holds.delete(key)
    }
    if (this.ends.length > 0) {
      const keep = this.ends.filter((e) => nowMs - e.ts <= CC_END_MEMORY_MS)
      if (keep.length !== this.ends.length) {
        this.ends = keep
        this.dirty = true
        this.rev += 1
      }
    }
  }

  private clearHolds(): void {
    if (this.holds.size === 0) return
    this.holds = new Map()
    this.dirty = true
    this.rev += 1
  }

  private clearAll(): void {
    const had = this.holds.size > 0 || this.ends.length > 0
    this.holds = new Map()
    this.ends = []
    if (had) {
      this.dirty = true
      this.rev += 1
    }
  }

  /** The wall-clock heartbeat: a hold expires while the log is idle, which is exactly when a
   *  player is staring at the bar waiting for it. */
  onTick(nowMs: number): void {
    this.sweep(nowMs)
  }

  private buildSnap(): BuffTimersSnap {
    const holds: CcHold[] = []
    for (const h of this.holds.values()) {
      if (h.group.empty) continue
      holds.push({
        key: h.entityKey,
        target: h.target,
        startedTs: h.group.oldestTs,
        ...(h.spell != null ? { spell: h.spell } : {}),
        candidates: h.candidates,
        durationMs: h.durationMs,
        ...(h.source ? { source: h.source } : {}),
        ...(h.group.count > 1 ? { count: h.group.count } : {}),
        ...(h.caster !== SELF_CASTER ? { caster: h.caster } : {})
      })
    }
    holds.sort((a, b) => a.startedTs - b.startedTs)
    return { holds, ends: [...this.ends] }
  }

  snapshot(): { seq: number; state: BuffTimersSnap } {
    return { seq: this.rev, state: this.buildSnap() }
  }

  flushDelta(): { seq: number; delta: BuffTimersDelta } | null {
    if (!this.dirty) return null
    this.dirty = false
    return { seq: this.rev, delta: this.buildSnap() }
  }
}
