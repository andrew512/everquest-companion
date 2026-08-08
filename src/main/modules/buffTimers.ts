// buffTimers.ts — the CROWD-CONTROL half of the buffs/timer overlay (JOS-89).
// Design record: docs/plans/buff-timer-overlay.md. The honesty law + the projection live in
// shared/buffTimers.ts; this module owns only the state that law needs and the buffs model
// does not already hold.
//
// WHY A SEPARATE MODULE, AND WHY IT IS THIS SMALL. `modules/buffs.ts` already tracks buff
// INSTANCES per (spell, entity) — including debuffs on named mobs — with own-cast gating,
// candidate resolution, death/zone/charm censoring and the DB duration prior. The overlay reads
// all of that straight off `BuffsSnap.active` rather than folding a second copy of it, because a
// second fold of the same events is exactly the two-models-with-different-reach scar world-model
// law 4 is made of.
//
// What `buffs.ts` demonstrably does NOT hold is the mez itself. `<mob> has been mesmerized.` is
// claimed by `classifyCcApply`, which sits above the DB matcher in the cascade, so it never
// becomes a `buffApply` and never becomes an instance — `BuffsModule.dispatchEntity` uses the
// event to note the current hostile target and nothing more. That is the whole gap, and this
// module is the whole fix: per-target holds, keyed by mob, so ONE AE mez landing on four enemies
// is four named rows with four independent clocks. (Measured in tests/fixtures/w10-cazic-slow.log:
// one `You begin casting Mesmerization III.` prints two `has been mesmerized.` lines in the same
// second, and later three.)

import type { LogEvent } from '../../shared/logEvents'
import type { BuffTimersDelta, BuffTimersSnap, CcEnd, CcHold } from '../../shared/buffTimers'
import { statedDuration } from '../../shared/buffTimers'
import { idKey } from '../log/parseCommon'
import { OWN_CAST_WINDOW_MS, SESSION_GAP_MS, spellKey } from './buffsShapes'
import type { EqModule } from './types'

/**
 * How long an END is remembered. It exists so the PROJECTION can retire a matching `ActiveBuff`
 * the buffs model never clears (shared/buffTimers.ts `endedByCc` states why that correction lives
 * there), and so the overlay can flash a drop — both of which are seconds-scale concerns. It is
 * not a history.
 */
export const CC_END_MEMORY_MS = 60_000

/**
 * Slack past a STATED duration before a hold is dropped for lack of a break line. EQ log stamps
 * are second-resolution and a break line can print late; 30 s is comfortably past both without
 * being long enough to leave a dead mob on screen.
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

/** A hold, plus the bookkeeping the snapshot does not need to carry. */
interface Held extends CcHold {
  /** Event ts at which this hold is dropped for lack of any line ending it. */
  expiresTs: number
}

export class BuffTimersModule implements EqModule<BuffTimersSnap, BuffTimersDelta> {
  readonly id = 'buffTimers'

  private holds = new Map<string, Held>()
  private ends: CcEnd[] = []
  /** Last own castBegin ts per canonical spell key — the own-cast gate's whole input. */
  private castHistory = new Map<string, number>()
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

  reset(): void {
    this.holds = new Map()
    this.ends = []
    this.castHistory = new Map()
    this.lastEventTs = 0
    this.rev = 0
    this.dirty = false
  }

  onEvent(ev: LogEvent): void {
    // A 30-minute event-time gap is a logout past any hold (the same boundary the buffs model
    // uses), and a character epoch is a different character entirely.
    if (ev.kind === 'epoch') {
      this.clearAll()
      return
    }
    if (this.lastEventTs > 0 && ev.ts - this.lastEventTs >= SESSION_GAP_MS) this.clearAll()
    this.lastEventTs = ev.ts
    this.sweep(ev.ts)
    this.dispatch(ev)
  }

  private dispatch(ev: LogEvent): void {
    switch (ev.kind) {
      case 'castBegin':
        this.castHistory.set(spellKey(ev.spell), ev.ts)
        break
      case 'castFizzle':
      case 'castInterrupted':
        // The cast did not land, so nothing it might have resolved is ours. Same ruling
        // combat/charmModel.ts `noteCastFailed` makes, for the same reason.
        this.castHistory.delete(spellKey(ev.spell))
        break
      case 'cc':
        if (ev.refresh === true) this.end(idKey(ev.mob), ev.ts, ev.spell)
        else this.apply(ev.mob, ev.ts, ev.candidates)
        break
      case 'uncharm':
        // Charm and CC break through the SAME sentence family; a charm break on a mob we were
        // also holding is that hold ending too.
        this.end(idKey(ev.mob), ev.ts)
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
   * THE OWNERSHIP GATE. The sentence is a BROADCAST and names no caster, so a hold is opened only
   * when it resolves one of the player's OWN crowd-control casts. This is the identical ruling
   * `combat/ingest.ts ingestCc` already makes for the encounter model ("a stranger's crowd control
   * is an observation about the room, not an event in our fight") and the same own-cast rule
   * `buffs.ts onBuffApply` applies to every buff. Without it a crowded zone fills this overlay
   * with other enchanters' work.
   *
   * THE NARROWING is JOS-84's law: the parser hands over every spell the sentence could be, and
   * the MODEL resolves against the player's own cast history. Exactly one own cast among the
   * candidates ⇒ that spell, by name, with its stated duration. More than one, or none ⇒ the row
   * stays a FAMILY and states a duration only if every candidate agrees on one.
   */
  private apply(mob: string, ts: number, candidates?: { name: string; durationMs: number | null }[]): void {
    const cands = candidates ?? []
    const own = cands.filter((c) => this.castWithinWindow(c.name, ts))
    // No DB (so no candidates at all) means we cannot tell our own mez from a stranger's, and the
    // honest answer to "whose is it?" is not to guess. No own cast means the same thing.
    if (own.length === 0) return
    const resolved = own.length === 1 ? own[0] : null
    const shown = [...cands].map((c) => c.name).sort((a, b) => a.localeCompare(b))
    const durationMs = resolved ? resolved.durationMs : statedDuration(own)
    const key = idKey(mob)
    this.holds.set(key, {
      key,
      target: mob,
      startedTs: ts,
      ...(resolved ? { spell: resolved.name } : {}),
      candidates: resolved ? shown : own.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      durationMs,
      expiresTs: ts + (durationMs != null ? durationMs + CC_END_GRACE_MS : CC_UNKNOWN_CAP_MS)
    })
    this.dirty = true
    this.rev += 1
  }

  /** A line said this hold is over — a break/wear-off, a charm break, or the mob dying. */
  private end(key: string, ts: number, spell?: string): void {
    const had = this.holds.delete(key)
    // A death line for a mob we were never holding ends nothing and is not recorded: the buffs
    // model already censors that mob's debuff instances itself (`retireEntity(key,
    // {hostileOnly:true})`), so an end here would be a second opinion about a fact already
    // settled — and one that would churn the snapshot on every kill in the zone.
    if (!had && spell == null) return
    // Recorded even when we held nothing, IF the line named a spell: that is a real CC break,
    // and the projection uses it to retire an ActiveBuff the buffs model does not clear (see
    // shared/buffTimers.ts `endedByCc`), which can exist without a hold beside it.
    this.ends.push({ key, ts, ...(spell != null ? { spell } : {}) })
    this.dirty = true
    this.rev += 1
  }

  /** True when the player cast this spell within the landing window before `ts`. */
  private castWithinWindow(name: string, ts: number): boolean {
    const last = this.castHistory.get(spellKey(name))
    return last != null && ts >= last && ts - last <= OWN_CAST_WINDOW_MS
  }

  /** Drop holds nothing ended and ends nobody needs any more. */
  private sweep(nowMs: number): void {
    for (const [key, h] of this.holds) {
      if (nowMs >= h.expiresTs) {
        this.holds.delete(key)
        this.dirty = true
        this.rev += 1
      }
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
    this.castHistory = new Map()
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
    return {
      holds: [...this.holds.values()]
        .map((h) => ({
          key: h.key,
          target: h.target,
          startedTs: h.startedTs,
          ...(h.spell != null ? { spell: h.spell } : {}),
          candidates: h.candidates,
          durationMs: h.durationMs
        }))
        .sort((a, b) => a.startedTs - b.startedTs),
      ends: [...this.ends]
    }
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
