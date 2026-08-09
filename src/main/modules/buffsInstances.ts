// The buff-INSTANCE store of the buffs model (see buffs.ts for the model's contract).
//
// A buff INSTANCE is a pair (spell, targetEntity) keyed by (spellKey, entityKey). This
// module owns the three live collections — the single pending cast, the landed-and-open
// casts awaiting their fade, and the currently-active instances — plus every mutation of
// them: landing, message-driven application, fade pairing (the duration sample), and the
// CENSORING paths (death / zone / log hole / hygiene / entity retirement) and the offline
// PAUSE — which is not a censor at all but the one place a live clock is rewound (JOS-134).
//
// It knows nothing about log events: BuffsModule translates events into these calls. It
// reads learned per-spell knowledge from SpellStats and the pet bindings from PetEntities,
// and reports a RESOLVED expiry back through the `onExpired` callback it is constructed
// with (Task #47's derived buffExpired) — the module stamps and emits that.

import type { ActiveBuff } from '../../shared/types'
import { isLeftBehindOnZone, type EntityDisposition } from '../combat/entityRules'
import { idKey } from '../log/parser'
import {
  hygieneCapMs,
  instanceEntityKey,
  instanceKey,
  LAND_TIMEOUT_MS,
  MAX_SAMPLE_MS,
  SELF_KEY,
  spellKey,
  type OpenCast,
  type Pending
} from './buffsShapes'
import type { PetEntities } from './buffsEntities'
import type { SpellStats } from './buffsStats'
import { buildActive, type ActiveSpec } from './buffsView'

/** Does this open cast belong to the entity being retired? (`hostileOnly` = a plain mob death.) */
function openMatches(o: OpenCast, entityKey: string, hostileOnly: boolean): boolean {
  if (!hostileOnly) return o.entityKey === entityKey
  return o.disp === 'hostile' && (o.entityKey === entityKey || o.entityKey === 'unknown-hostile')
}

/** Does this active instance belong to the entity being retired? */
function activeMatches(a: ActiveBuff, aKey: string, entityKey: string, hostileOnly: boolean): boolean {
  if (!hostileOnly) return aKey === entityKey
  return a.cls === 'debuff' && (aKey === entityKey || aKey === 'unknown-hostile' || a.inferredTarget === true)
}

/**
 * ZONE (the user's rule): the player keeps self buffs; a SUMMONED pet follows and keeps
 * its buffs; a CHARMED pet is LEFT BEHIND (retire + censor); hostile mobs are left behind
 * (censor open debuffs). Uses the SHARED isLeftBehindOnZone rule.
 */
function openLeftBehindOnZone(o: OpenCast): boolean {
  if (o.disp === 'self') return false
  if (o.disp === 'summoned') return isLeftBehindOnZone('summoned') // false
  if (o.disp === 'charmed') return isLeftBehindOnZone('charmed') // true
  return true // hostile → left behind
}

export class BuffInstances {
  /** The single cast currently in flight (You begin …), or null. */
  pending: Pending | null = null
  /** Landed casts awaiting their fade, keyed by INSTANCE key (spell, entity) — Task #35. */
  open = new Map<string, OpenCast>()
  /** Currently-active buff instances, keyed by INSTANCE key (spell, entity) — Task #35. */
  active = new Map<string, ActiveBuff>()
  /** Set whenever state changed since the last flush. */
  dirty = false

  constructor(
    private readonly stats: SpellStats,
    private readonly pets: PetEntities,
    /** Report a RESOLVED expiry (spell + target display) so the module can emit it. */
    private readonly onExpired: (spell: string, target: string) => void
  ) {}

  reset(): void {
    this.pending = null
    this.open = new Map()
    this.active = new Map()
    this.dirty = false
  }

  /** True when any active instance is of this spell key (the ambiguous-apply tiebreak). */
  hasActiveSpell(key: string): boolean {
    for (const a of this.active.values()) if (spellKey(a.spell) === key) return true
    return false
  }

  /**
   * ILLUSION EXCLUSIVITY (Task #36, the user's rule): only ONE illusion can be active on a
   * given entity at a time (Permanent Illusion AA or not). Removes every illusion-flagged
   * active + open instance bound to `entityKey` EXCEPT the one being applied now (`keepKey`).
   * A new illusion apply on an entity replaces any prior illusion on that entity — applies
   * to self AND pet (a pet illusion like Boon-on-pet replaces a prior pet illusion).
   */
  clearIllusionsOn(entityKey: string, keepKey: string): void {
    for (const [ik, a] of [...this.active]) {
      if (ik === keepKey) continue
      if (instanceEntityKey(ik) !== entityKey) continue
      if (this.stats.isIllusion(spellKey(a.spell))) {
        this.active.delete(ik)
        this.open.delete(ik)
        this.dirty = true
      }
    }
  }

  /** Remove the (single) illusion-flagged SELF active — the `Your illusion fades.` handler. */
  clearSelfIllusion(): void {
    for (const [ik, a] of [...this.active]) {
      if (!a.self) continue
      if (this.stats.isIllusion(spellKey(a.spell))) {
        this.active.delete(ik)
        this.open.delete(ik)
        this.dirty = true
        // DERIVED buffExpired (Task #47): the raw `Your illusion fades.` line names no spell,
        // but we've RESOLVED it to the one active self illusion — emit that resolved spell so
        // an alert `where:{spell:'Illusion: Wood Elf'}` can fire on the player-side click-off.
        this.onExpired(a.spell, 'self')
      }
    }
  }

  /**
   * A cast nothing confirmed within the landing window never landed, so its record is DROPPED
   * (JOS-118). It opens nothing on the way out — see `beginCast` for why a cast is not evidence.
   */
  dropUnconfirmedPending(now: number): void {
    if (this.pending && now - this.pending.beganTs >= LAND_TIMEOUT_MS) {
      this.pending = null
    }
  }

  /**
   * Stage a new cast in flight. A CAST OPENS NOTHING — no instance, no open cast, no row
   * (JOS-118, owner: "we should drop provisional all together. i dont want to complicate the
   * model").
   *
   * This used to show the cast OPTIMISTICALLY the instant it began: a `provisional` ActiveBuff
   * bound to `inferCastDisposition`'s guess at the target — for a debuff, `entityKeyFor('hostile')`,
   * i.e. the pet's last CC'd mob or an `unknown-hostile` bucket. It was retracted only by a fizzle
   * or an interrupt. A RESIST is neither, so a resisted debuff left a bar on screen naming a mob
   * the log never said it landed on — the JOS-118 defect. Fifteen seconds later
   * `maybeLandPendingByTime` PROMOTED that same guess to a solid row and an `open` cast that could
   * pair with an unrelated later fade into a duration sample, so the cast path could also poison
   * the mined statistics the JOS-114/117 clean-sample rule exists to protect.
   *
   * The rule is now uniform across buffs, debuffs and CC alike: an instance opens ONLY from a line
   * that CONFIRMS the landing, keyed to the entity that line NAMES (`applyMessageBuff`, or the CC
   * half's `cc` broadcast in modules/buffTimers.ts). No landing line ⇒ no row and no sample, which
   * makes a resist correct by construction: there was never anything to retract.
   *
   * The pending record itself STAYS. It is the cast-in-flight bookkeeping the landing side hangs
   * off — `applyMessageBuff` consumes it, a fizzle/interrupt clears it — and own-cast attribution
   * (`BuffsModule.ownCastAttributed`) reads its own `castHistory` beside it. What went is the
   * DISPLAY, not the attribution machinery.
   */
  beginCast(spell: string, key: string, ts: number): void {
    this.pending = { spell, key, beganTs: ts }
  }

  /** A fizzle/interrupt of `key` clears the pending cast. It never opened anything to retract. */
  clearPendingCast(key: string): void {
    if (this.pending?.key !== key) return
    this.pending = null
  }

  /**
   * Infer the target disposition of a cast at LAND time from the current entity state, a
   * LEARNED landing emote (Task #33), and the spell's class. A learned self-emote proves a
   * SELF cast even while a pet is live. A debuff → the inferred hostile fight target. Else
   * the live pet, else self.
   */
  inferCastDisposition(key: string, emoteSubjectKey?: string): EntityDisposition {
    const pets = this.pets
    if (emoteSubjectKey === SELF_KEY) return 'self'
    if (emoteSubjectKey && emoteSubjectKey !== SELF_KEY) {
      if (pets.charmedKey && emoteSubjectKey === pets.charmedKey) return 'charmed'
      if (pets.summonedKey && emoteSubjectKey === pets.summonedKey) return 'summoned'
      return pets.summonedKey ? 'summoned' : 'charmed'
    }
    if (this.stats.classOf(key) === 'debuff') return 'hostile'
    if (pets.charmedKey) return 'charmed'
    if (pets.summonedKey) return 'summoned'
    return 'self'
  }

  /**
   * Apply a buff from an EXACT chat MESSAGE match (Task #34/#35). Confident, immediate,
   * non-provisional, messageDriven. `target` is 'self' for a cast-on-you / self-heal line,
   * else the named target (pet/player/mob) — bound to THAT entity's key.
   */
  applyMessageBuff(
    spell: string,
    spec: {
      target: string
      ts: number
      illusion: boolean
      durationMs: number | null
      /** ts from which the Permanent Illusion AA is owned, when it is. */
      permanentIllusionOwnedTs?: number
    }
  ): void {
    const { target, ts, illusion, durationMs } = spec
    if (durationMs == null && !illusion) return
    const key = spellKey(spell)
    // A SELF apply of a DETRIMENTAL spell is an incoming debuff a MOB cast on the player —
    // not the player's own buff. Skip it (the bar shows only the player's beneficial buffs).
    if (target === 'self' && this.stats.classOf(key) === 'debuff') return
    this.stats.everFaded.add(key)
    this.stats.touchLastSeen(key, ts)
    if (this.pending?.key === key) this.pending = null

    const self = target === 'self'
    const disp: EntityDisposition = self ? 'self' : this.pets.dispForNamedTarget(target)
    const eKey = self ? SELF_KEY : idKey(target)
    const iKey = instanceKey(key, eKey)
    // Remember the target's display casing so the row's target chip reads "Cazic-Thule",
    // not the lowercased key (Task #35).
    if (!self) this.pets.namedEntityDisplay.set(eKey, target)
    const permanent = isPermanentIllusion(self, illusion, ts, spec.permanentIllusionOwnedTs)

    if (!permanent) {
      this.open.set(iKey, { spell, spellKey: key, entityKey: eKey, landedTs: ts, disp })
    } else {
      this.open.delete(iKey)
    }

    this.active.set(
      iKey,
      this.build({
        spell, key, entityKey: eKey, startedTs: ts, dispOverride: disp,
        opts: { messageDriven: true, permanent }
      })
    )
    // ILLUSION EXCLUSIVITY (Task #36): a new illusion apply on this entity replaces any
    // prior illusion active on it (self OR pet). Only one illusion per entity at a time.
    if (illusion) this.clearIllusionsOn(eKey, iKey)
    this.dirty = true
  }

  /**
   * AUTHORITATIVE removal (Task #34): a msg_wears_off proves the SELF instance expired NOW.
   * Pairs a duration sample if the self open cast exists, then clears that instance.
   */
  private removeAuthoritative(key: string, entityKey: string, ts: number): void {
    const iKey = instanceKey(key, entityKey)
    const spell = this.active.get(iKey)?.spell ?? this.stats.samples.get(key)?.spell ?? key
    this.stats.everFaded.add(key)
    this.recordFade(key, entityKey, spell, ts)
    // DERIVED buffExpired (Task #47): the wear-off is now RESOLVED to `spell` on `entityKey`.
    // Alerts match this reliable, unambiguous kind instead of the raw ambiguous buffWearOff.
    this.onExpired(spell, this.pets.targetDisplayFor(entityKey))
  }

  /**
   * SHARED wears-off resolution (Task #45). A wears-off line whose message maps to MULTIPLE
   * candidate spells (haste/strength/armor families) removes whichever matching ACTIVE self
   * buff(s) exist — resolve against the active set, don't guess a single spell:
   *   • exactly ONE candidate active → remove it (the common case; EQ stacking keeps one
   *     member of a family up at a time);
   *   • MULTIPLE candidates active → remove ALL of them (they honestly share this message);
   *   • NONE active → no-op (nothing to remove — don't fabricate a fade sample).
   * Each removal is AUTHORITATIVE (pairs a duration sample + clears the instance).
   */
  removeSharedWearOff(candidateNames: string[], entityKey: string, ts: number): void {
    const cands = new Set(candidateNames.map(spellKey))
    // Find the candidates that actually have an ACTIVE instance on this entity.
    const matched: string[] = []
    for (const [ik, a] of this.active) {
      if (instanceEntityKey(ik) !== entityKey) continue
      const k = spellKey(a.spell)
      if (cands.has(k) && !matched.includes(k)) matched.push(k)
    }
    for (const k of matched) this.removeAuthoritative(k, entityKey, ts)
    // NONE active → intentional no-op: a wears-off for a buff we never tracked (e.g. cast by
    // someone else, or already swept) must not create a phantom fade sample.
  }

  /**
   * Pair a fade with its own open landed instance (a duration sample) and clear the active.
   *
   * A SAMPLE IS MINTED ONLY FROM AN EXACT (spell, entity) CHAIN (JOS-118, owner): our own cast,
   * landing on THAT entity, wearing off THAT entity. Only OUR modifiers — AAs, focus effects —
   * shape a duration we are entitled to learn from, and another caster's identical spell on a
   * different mob carries completely different ones. A fade that cannot be matched to its own
   * exact instance mints NOTHING: an ambiguous pairing is not a clean sample.
   *
   * THE FALLBACK THIS REPLACES paired a fade with the OLDEST OPEN CAST of the same spell on ANY
   * entity. It existed because a CAST-TIMING open cast bound to an entity the model had merely
   * inferred (castBegin names no target), so the fade's real target routinely disagreed with it.
   * JOS-118 removed cast-timing instances altogether — every open cast is now message-bound to
   * an entity the log NAMED — so the mismatch it papered over can no longer arise, and what is
   * left of it is only the cross-entity mis-pairing itself: slow cast on mob A, then on mob B,
   * with B's fade measured against A's older landing. That span is too LONG, which is exactly
   * the direction of the owner's live observation (a slow reading longer on the bar than on the
   * mob) and exactly the direction the recency-weighted MAX estimator is most sensitive to.
   * JOS-117 flagged this and left it; the owner's ruling is what justifies moving it now.
   *
   * CLOSURE is unchanged in spirit and stays honest: the fade proves THIS entity's copy is gone,
   * so this instance closes. It never speaks for a copy on any other entity, so no other row is
   * touched — a still-live slow on mob A survives mob B's wear-off.
   */
  recordFade(key: string, entityKey: string, spell: string, fadeTs: number): void {
    this.stats.touchLastSeen(key, fadeTs)
    const iKey = instanceKey(key, entityKey)
    const open: OpenCast | undefined = this.open.get(iKey)
    if (open !== undefined) {
      const dur = fadeTs - open.landedTs
      // CENSOR a sample whose land→fade window crossed an offline gap (world-model law 5).
      // The fade itself is still authoritative — the instance clears exactly as it always
      // did — but the SPAN is not a duration: it contains an absence whose length we know
      // only to within the reconnect window. Contributing it would poison the per-spell
      // recency-weighted MAX with a value that is guaranteed too large.
      if (open.spannedGap !== true && dur > 0 && dur <= MAX_SAMPLE_MS) this.addSample(key, spell, dur)
      this.open.delete(iKey)
    }
    this.active.delete(iKey)
    this.dirty = true
  }

  private addSample(key: string, spell: string, durMs: number): void {
    this.stats.pushSample(key, spell, durMs)
    // Restat every live instance of this spell (they share the per-spell stats).
    for (const [ik, a] of [...this.active]) {
      if (spellKey(a.spell) === key) {
        this.active.set(
          ik,
          this.build({
            spell: a.spell,
            key,
            entityKey: instanceEntityKey(ik),
            startedTs: a.startedTs,
            dispOverride: a.disposition,
            opts: { messageDriven: a.messageDriven, permanent: a.permanent }
          })
        )
      }
    }
    this.dirty = true
  }

  /**
   * OFFLINE GAP — the buff-timer PAUSE, and the asymmetry that is the whole of JOS-134.
   *
   * YOUR BUFFS PAUSE. Buff timers do NOT run while the character is out of the world; the game
   * saves each buff's REMAINING duration and resumes it at login. So a beneficial instance that
   * survives a gap has its clock shifted forward by the absence, or every countdown reads as
   * long-expired and the hygiene sweep retires a buff that is still up.
   *
   * MEASURED, not assumed (world-model law 1 — the game's semantics were verified before
   * being encoded). Real log, Swift Like the Wind (DB duration 16 min):
   *   land        Fri Jul 31 00:51:59   (`You feel much faster.`)
   *   camp        Fri Jul 31 01:05:43   (+ the five countdown ticks to 01:06:07)
   *   login       Fri Jul 31 14:49:15   (`Welcome to EverQuest Legends!`)
   *   wears off   Fri Jul 31 14:50:28   (`Your speed returns to normal.`)
   * Wall-clock elapsed is 13h58m29s; the measured absence is 13h43m08s; the difference is
   * 15m21s — which matches this character's observed online duration for that spell (two
   * clean same-evening pairs: 15m13s and 15m09s) to within the camp's own ~30s fuzz. And the
   * post-login remainder is 1m13s, exactly the 16-minute timer's leftover after 14m14s of
   * online time. If timers RAN while offline the buff would have expired unobserved around
   * 01:08 and that wears-off line could never have printed at all.
   *
   * DEBUFFS DO NOT PAUSE, AND THAT IS DELIBERATE (owner's design, 2026-08-09). What EQ pauses
   * is your CHARACTER; the world it stands in keeps running. A slow you landed on a mob is a
   * timer in the world, not a timer on you, so it keeps burning down while you are gone and its
   * `startedTs` is left exactly where it was. A debuff that outlives the absence therefore reads
   * correctly the moment you are back, and one that did not is swept by the ordinary hygiene
   * pass on its own unshifted clock — no special case, no second opinion. (Nothing else is
   * needed at the boundary either: the `You have entered <zone>.` line lands 0-1 lines after
   * every Welcome in the real log and runs the existing law-4 censor, which is what leaves
   * hostiles and charmed pets behind on a login exactly as on any other zone.)
   *
   * `fromTs` is the last instant the character is KNOWN to have been in the world. Only
   * instances that predate it are shifted: anything raised after it was raised on THIS side of
   * the absence and has nothing to be compensated for.
   *
   * This is DISPLAY ONLY. `startedTs` feeds the countdown and the sort order and nothing else
   * (it is never rendered as a wall clock), and the wears-off line stays the authority on when a
   * buff actually ended. EVERY open cast the gap passes over — buff and debuff alike — is
   * flagged `spannedGap` so its span never becomes a mined duration sample; see the field's own
   * doc in buffsShapes.ts for the two separate reasons the two halves are both refused.
   */
  onOfflinePause(fromTs: number, offlineMs: number): void {
    if (offlineMs <= 0) return
    let changed = false
    for (const o of this.open.values()) {
      if (o.landedTs > fromTs) continue
      if (o.spannedGap !== true) {
        o.spannedGap = true
        changed = true
      }
      // The learner is censored either way; only the CLOCK is asymmetric.
      if (this.stats.classOf(o.spellKey) !== 'debuff') {
        o.landedTs += offlineMs
        changed = true
      }
    }
    for (const [ik, a] of this.active) {
      if (a.cls === 'debuff' || a.startedTs > fromTs) continue
      this.active.set(ik, { ...a, startedTs: a.startedTs + offlineMs })
      changed = true
    }
    // A cast in flight when the character left the world never completed — the camp (or the
    // crash) took it. Shifting it would resurrect a cast that produced no landing message.
    if (this.pending) {
      this.pending = null
      changed = true
    }
    if (changed) this.dirty = true
  }

  /** Session-gap clear (Task #33, finding #5): wipe live actives/opens/pending. */
  clearForGap(): void {
    const changed = this.active.size > 0 || this.open.size > 0 || this.pending != null
    this.active.clear()
    this.open.clear()
    this.pending = null
    if (changed) this.dirty = true
  }

  /**
   * Drop every instance whose clock predates `ts` — the UNEXPLAINED-hole resolution (JOS-134).
   *
   * A log hole that no login ever explains means we lost the thread rather than that the
   * character left, and the old blanket wipe is still the honest answer for what was standing
   * when it opened. It is SCOPED rather than blanket only because the ruling arrives up to
   * {@link LOGIN_CONFIRM_MS} after the hole did, and anything cast inside that window is
   * evidence from this side of it — the hole says nothing about a buff raised after it.
   */
  dropPredating(ts: number): void {
    let changed = false
    for (const [ik, a] of [...this.active]) {
      if (a.startedTs > ts) continue
      this.active.delete(ik)
      changed = true
    }
    for (const [ik, o] of [...this.open]) {
      if (o.landedTs > ts) continue
      this.open.delete(ik)
      changed = true
    }
    if (this.pending != null && this.pending.beganTs <= ts) {
      this.pending = null
      changed = true
    }
    if (changed) this.dirty = true
  }

  /**
   * Hygiene sweep (Task #33, finding #6): retire any active past its per-spell cap.
   *
   * `heldBeforeTs` is the last-known-online instant of a log hole whose explanation has not
   * arrived yet (0 when there is none). A BUFF older than it is exempt for the length of that
   * wait, and the exemption is the point of it: if the hole turns out to be a logout, that
   * buff's clock is about to be rewound by the absence, and judging it against a `now` from the
   * far side would retire — a beat before the pause lands — exactly the buff the pause exists to
   * keep. DEBUFFS get no exemption; their clocks never stop, so the cap means what it always did.
   */
  sweepHygiene(now: number, heldBeforeTs = 0): void {
    // CALLED ONCE PER EVENT (buffs.ts onEvent), so its cost is paid 1.4M times on a full replay.
    // It used to SPREAD the active map into a fresh array first — 1.4M throwaway arrays, and the
    // copy bought nothing: deleting the entry a Map iteration is currently standing on is
    // well-defined in JS, and this loop deletes nothing else. Everything the loop reads is
    // unchanged (JOS-59).
    let changed = false
    for (const [ik, a] of this.active) {
      if (a.permanent) continue
      if (heldBeforeTs > 0 && a.cls !== 'debuff' && a.startedTs <= heldBeforeTs) continue
      const sKey = spellKey(a.spell)
      const dbMs = this.stats.dbDurationFor(sKey)
      const cap = Math.max(hygieneCapMs(a.p75, a.n), dbMs != null ? 2 * dbMs : 0)
      if (now - a.startedTs > cap) {
        this.active.delete(ik)
        this.open.delete(ik)
        changed = true
      }
    }
    if (changed) this.dirty = true
  }

  /** playerDeath strips SELF buffs: censor open SELF casts + clear their actives. */
  onPlayerDeath(): void {
    let changed = false
    for (const [ik, o] of [...this.open]) {
      if (o.entityKey === SELF_KEY) {
        this.open.delete(ik)
        changed = true
      }
    }
    for (const [ik, a] of [...this.active]) {
      if (a.self) {
        this.active.delete(ik)
        changed = true
      }
    }
    if (this.pending) {
      // A pending self cast is abandoned (death interrupts it). A debuff/pet cast survives.
      const disp = this.inferCastDisposition(this.pending.key, this.pending.emoteSubjectKey)
      if (disp === 'self') {
        this.pending = null
        changed = true
      }
    }
    if (changed) this.dirty = true
  }

  /**
   * Retire an ENTITY (Task #35, generalized — NO pet-specific branches). Censors every open
   * cast + active instance bound to `entityKey`. Used on uncharm / summoned-pet death /
   * hostile death / zone-left-behind / single-pet succession — the pet is just the entity
   * currently claimed. Buffs on other players / arbitrary entities are censored the same way.
   *
   * `hostileOnly` guards a plain-mob death: only DEBUFF instances on that mob are censored
   * (a friendly buff can't be on a hostile), and an unknown-hostile debuff bucket is swept
   * too (its inferred target just died).
   */
  retireEntity(entityKey: string, opts?: { hostileOnly?: boolean }): void {
    const hostileOnly = opts?.hostileOnly === true
    let changed = false
    for (const [ik, o] of [...this.open]) {
      if (openMatches(o, entityKey, hostileOnly)) {
        this.open.delete(ik)
        changed = true
      }
    }
    for (const [ik, a] of [...this.active]) {
      if (activeMatches(a, instanceEntityKey(ik), entityKey, hostileOnly)) {
        this.active.delete(ik)
        changed = true
      }
    }
    // Clear the entity from pet state if it was a pet (charmed / broken-charm / summoned).
    this.pets.retireSlots(entityKey)
    if (changed) this.dirty = true
  }

  /**
   * ZONE (the user's rule): the player keeps self buffs; a SUMMONED pet follows and keeps
   * its buffs; a CHARMED pet is LEFT BEHIND (retire + censor); hostile mobs are left behind
   * (censor open debuffs). Uses the SHARED isLeftBehindOnZone rule.
   */
  onZone(): void {
    let changed = false
    for (const [ik, o] of [...this.open]) {
      if (openLeftBehindOnZone(o)) {
        this.open.delete(ik)
        changed = true
      }
    }
    for (const [ik, a] of [...this.active]) {
      const leftBehind =
        a.cls === 'debuff' || a.disposition === 'charmed' || a.disposition === 'hostile'
      if (leftBehind) {
        this.active.delete(ik)
        changed = true
      }
    }
    if (this.pets.clearOnZone()) changed = true
    if (this.pending) {
      const disp = this.inferCastDisposition(this.pending.key, this.pending.emoteSubjectKey)
      if (disp === 'charmed' || disp === 'hostile') {
        this.pending = null
        changed = true
      }
    }
    if (changed) this.dirty = true
  }

  /** Project one instance into its UI row against the current stats + pet identities. */
  private build(spec: ActiveSpec): ActiveBuff {
    return buildActive(spec, this.stats, this.pets)
  }
}

/**
 * Permanent Illusion AA (Task #34): a SELF illusion cast at or after the AA was owned never
 * expires, so it is shown with no countdown and pairs no duration sample.
 */
function isPermanentIllusion(
  self: boolean,
  illusion: boolean,
  ts: number,
  ownedTs: number | undefined
): boolean {
  return self && illusion && ownedTs != null && ts >= ownedTs
}
