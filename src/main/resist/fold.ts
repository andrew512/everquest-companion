// THE FOLD: log events in, pooled observations out (JOS-382).
//
// No Electron. `tests/resistFold.test.mts` drives it over committed fixtures cut from the owner's
// log, and `scripts/gen-resist-baseline.ts` drives the same class to mine the shipped baseline —
// one implementation, so what ships and what a user's own log produces cannot drift.
//
// ── IT NEVER READS THE CLIENT'S SPELL TABLE, AND THAT IS A DESIGN DECISION ───────────────────────
//
// `spells_us.txt` knows a spell's resist axis, its resist adjust and its level caps. This fold
// knows none of them, on purpose: everything it writes is something the LOG printed, so the ledger
// is meaningful without a file we are not allowed to redistribute, a shipped baseline is a
// table-independent artifact, and a game patch that retunes a spell costs a re-ESTIMATE rather
// than a re-fold of every log the user has ever tailed. Two exclusions the brief asks for
// therefore live in the estimator instead, which is where the facts are: rows for spells with no
// resist axis, and resists of a spell whose hard level cap the mob is above. The observable result
// is identical (neither reaches a number); the cost is a slightly larger baseline file, and the
// gain is that the fold has no dependency that can be missing.
//
// The two things it DOES consult are both already in this repo: the committed mob catalog (for a
// mob's level when `/con` has not stated one) and the wiki spell catalog (to recognise a resist
// debuff by its verbatim effect line).
//
// ── HOW EACH OUTCOME IS EARNED ──────────────────────────────────────────────────────────────────
//
//   RESIST   `<mob> resisted your <Spell>!` — the game saying it flatly. Incoming resists
//            (`You resist <mob>'s <Spell>!`) are YOURS and out of scope entirely.
//   DAMAGE   `X hit <mob> for N points of <type> damage by <Spell>.` — the number goes into the
//            row's histogram, from which the estimator later derives full-versus-partial. A
//            CRITICAL is counted as a landing and kept OUT of the histogram: its number is not the
//            spell's full damage, and letting it in would invent a second "full" value.
//   LAND     the first tick of a DoT after its cast, and a cast-on-other emote joined back to your
//            own `You begin casting` — but never both for one spell on one mob, because a spell
//            that both emotes and prints damage produced ONE roll. The emote's landing is
//            therefore DEFERRED and cancelled by any damage line that follows it for the same mob
//            and spell, which is the log-only way of saying what the brief says with the client
//            table ("all-or-nothing spells only").
//   SONG     not counted here at all — see songs.ts. A song's pulses are reconstructed and each
//            reconstructed pulse becomes an attempt against every mob that was in melee contact.
//
// ── ANOTHER PLAYER'S CASTS ARE RECORDED, AND NEVER ESTIMATED FROM ───────────────────────────────
//
// The owner's ruling admits `self` and `pc` casters. A stranger's damage lines and resists both
// print, so both are filed — but nothing in this app's inputs states another player's LEVEL (the
// parser reads a `/who` row only for the tailed character), and without a level there is no
// `levelMod` and therefore no rc. Those rows are evidence a drilldown can show and the estimator
// deliberately drops (`droppedNoLevel`). Filing them costs a little of the baseline's size and
// buys the per-spell evidence for spells the tailed character does not cast.

import { idKey, spellCanonKey } from '../log/parseCommon'
import { mobKey } from '../../shared/mobKey'
import type { LogEvent } from '../../shared/logEvents'
import type { SpellDb } from '../data/spellDb'
import type { ResistCasterKind, ResistFamily, ResistRow } from '../../shared/resistTypes'
import { ResistBucket, type RowSpec } from './ledger'
import { SONG_CONTACT_MS, SongPulses, type SongPulse } from './songs'
import { CasterIndex, DebuffWindows, MeleeContact, MobLevels, isResistDebuff } from './world'

/**
 * How long after your own `You begin casting` a landing sentence may still be claimed by it. The
 * brief says `castMs + 2.5 s`, which needs the client table; this is the repo's own measured
 * substitute — `buffAnchors.ts OWN_CAST_WINDOW_MS`, the constant the buffs model already uses for
 * exactly this join, and comfortably above the longest cast plus its slack.
 */
export const CAST_JOIN_MS = 10_000

/** How long a deferred emote-landing waits to see whether a damage line cancels it. */
export const LAND_DEFER_MS = 3_000

/**
 * The separator inside every composite key this module builds. A PRINTABLE byte, deliberately:
 * AGENTS.md's rule about raw control bytes in source exists because one makes git classify the
 * file as binary and blame, diff and grep go dark. No EQ mob or spell name has ever contained a
 * pipe, so it costs nothing.
 */
const SEP = '|'

const pairKey = (mob: string, spell: string): string => mob + SEP + spell

interface Armed {
  spellKey: string
  display: string
  ts: number
  kind: ResistCasterKind
  level: number | null
}

interface Deferred {
  mobDisplay: string
  spellKey: string
  ts: number
  kind: ResistCasterKind
  level: number | null
}

export interface ResistFoldDeps {
  spellDb?: SpellDb
}

export class ResistFold {
  private bucket = new ResistBucket()
  private readonly levels = new MobLevels()
  private readonly casters = new CasterIndex()
  private readonly debuffs = new DebuffWindows()
  private readonly contact = new MeleeContact()
  private readonly songs: SongPulses
  private zone: string | undefined
  private selfLevel: number | null = null
  private songSpells = new Set<string>()
  private armed: Armed[] = []
  private dotSeen = new Set<string>()
  private deferred: Deferred | null = null
  private display = new Map<string, string>()

  constructor(private readonly deps: ResistFoldDeps = {}) {
    this.songs = new SongPulses((pulse) => {
      this.filePulse(pulse)
    })
  }

  /** Discard a source's bucket before its log is folded again (JOS-231). */
  beginSource(): ResistBucket {
    this.bucket = new ResistBucket()
    this.resetSession()
    return this.bucket
  }

  rows(): ResistRow[] {
    return this.bucket.rows()
  }

  /** Flush everything still buffered. MUST be called before reading the rows. */
  finish(): void {
    this.flushDeferred(Number.POSITIVE_INFINITY)
    this.songs.flush()
  }

  private resetSession(): void {
    this.levels.reset()
    this.casters.reset()
    this.debuffs.reset()
    this.contact.reset()
    this.songs.reset()
    this.zone = undefined
    this.selfLevel = null
    this.songSpells = new Set()
    this.armed = []
    this.dotSeen = new Set()
    this.deferred = null
  }

  onEvent(ev: LogEvent): void {
    this.flushDeferred(ev.ts)
    switch (ev.kind) {
      case 'zone':
        this.onZone(ev.zone)
        return
      case 'level':
        this.selfLevel = ev.level
        return
      case 'selfWho':
        this.selfLevel ??= ev.level
        return
      case 'consider':
        this.remember(ev.mob)
        if (ev.level !== undefined) this.levels.note(mobKey(ev.mob), ev.level)
        return
      case 'death':
        this.onDeath(ev.name)
        return
      case 'petClaim':
      case 'petSay':
        this.casters.notePet(ev.name)
        return
      case 'allyPetLeader':
        this.casters.notePet(ev.pet)
        return
      case 'castBegin':
        this.onCastBegin(ev.spell, ev.ts, ev.sung === true)
        return
      case 'otherCastBegin':
        this.onOtherCast(ev.caster, ev.spell, ev.ts)
        return
      case 'castFizzle':
      case 'castInterrupted':
        this.disarm(spellCanonKey(ev.spell))
        return
      case 'resist':
        this.onResist(ev.incoming, ev.caster, ev.target, ev.spell, ev.ts)
        return
      case 'damage':
        this.onDamage(ev)
        return
      case 'miss':
        this.onMelee(ev.attacker, ev.target, ev.ts)
        return
      case 'buffApply':
        if (ev.target !== 'self') this.onEmote(ev.target, ev.ts, ev.candidates.map((c) => c.name))
        return
      case 'cc':
      case 'charm':
        this.onEmote(ev.mob, ev.ts, ev.candidates?.map((c) => c.name))
        return
      default:
        return
    }
  }

  // ---- world housekeeping ---------------------------------------------------------------

  private onZone(zone: string): void {
    this.flushDeferred(Number.POSITIVE_INFINITY)
    this.songs.flush()
    this.zone = zone
    this.debuffs.reset()
    this.contact.reset()
    this.armed = []
  }

  private onDeath(name: string): void {
    const key = mobKey(name)
    this.debuffs.clearMob(key)
    // A dead mob stops being a song target immediately (rule 3: alive AND in contact). The song
    // itself keeps running, so nothing here touches the pulse reconstruction.
    this.contact.drop(key)
  }

  private remember(display: string): void {
    this.display.set(mobKey(display), display)
  }

  private onMelee(attacker: string, target: string, ts: number): void {
    if (idKey(attacker) === 'you') {
      this.contact.note(mobKey(target), ts)
      this.remember(target)
      return
    }
    if (idKey(target) === 'you') {
      this.contact.note(mobKey(attacker), ts)
      this.remember(attacker)
    }
  }

  // ---- casts ---------------------------------------------------------------------------

  private onCastBegin(spell: string, ts: number, sung: boolean): void {
    const key = spellCanonKey(spell)
    if (sung) {
      this.songSpells.add(key)
      this.songs.noteSing(key, ts)
    }
    // A fresh cast re-arms the "first tick counts as a landing" memory for this spell.
    for (const seen of [...this.dotSeen]) {
      if (seen.endsWith(SEP + key)) this.dotSeen.delete(seen)
    }
    this.arm({ spellKey: key, display: spell, ts, kind: 'self', level: this.selfLevel })
  }

  private onOtherCast(caster: string, spell: string, ts: number): void {
    if (this.casters.kindOf(caster) !== 'pc') return
    this.arm({ spellKey: spellCanonKey(spell), display: spell, ts, kind: 'pc', level: null })
  }

  private arm(cast: Armed): void {
    this.armed.push(cast)
    // Bounded: only the last handful can still be in window, and the log has plenty of casts.
    if (this.armed.length > 16) this.armed.splice(0, this.armed.length - 16)
  }

  private disarm(spellKey: string): void {
    this.armed = this.armed.filter((a) => a.spellKey !== spellKey)
  }

  /** The most recent armed cast this landing sentence can belong to, consumed. */
  private takeArmed(ts: number, candidates: string[] | undefined): Armed | null {
    const keys = candidates ? new Set(candidates.map(spellCanonKey)) : null
    for (let i = this.armed.length - 1; i >= 0; i--) {
      const cast = this.armed[i]
      if (ts < cast.ts || ts - cast.ts > CAST_JOIN_MS) continue
      if (keys && !keys.has(cast.spellKey)) continue
      this.armed.splice(i, 1)
      return cast
    }
    return null
  }

  private onEmote(mobDisplay: string, ts: number, candidates: string[] | undefined): void {
    const cast = this.takeArmed(ts, candidates)
    if (!cast) return
    this.remember(mobDisplay)
    const key = mobKey(mobDisplay)
    if (isResistDebuff(this.deps.spellDb, cast.display)) this.debuffs.open(key, cast.spellKey, ts)
    if (this.songSpells.has(cast.spellKey)) {
      this.songs.witness(cast.spellKey, ts, null)
      return
    }
    // DEFERRED: a damage line for the same mob and spell cancels it (see the header).
    this.flushDeferred(Number.POSITIVE_INFINITY)
    this.deferred = { mobDisplay, spellKey: cast.spellKey, ts, kind: cast.kind, level: cast.level }
  }

  private flushDeferred(now: number): void {
    const d = this.deferred
    if (!d || now - d.ts <= LAND_DEFER_MS) return
    this.deferred = null
    if (d.kind === 'pc') return
    this.rowFor(d.mobDisplay, d.spellKey, 'cast', d.kind, d.level, d.ts).land += 1
  }

  private cancelDeferred(mobDisplay: string, spellKey: string): void {
    const d = this.deferred
    if (!d) return
    if (d.spellKey === spellKey && mobKey(d.mobDisplay) === mobKey(mobDisplay)) this.deferred = null
  }

  // ---- outcomes ------------------------------------------------------------------------

  private onResist(incoming: boolean, caster: string, target: string, spell: string, ts: number): void {
    if (incoming) return
    const kind = this.casters.kindOf(caster)
    if (!kind) return
    const spellKey = spellCanonKey(spell)
    this.remember(target)
    if (kind === 'self' && this.songSpells.has(spellKey)) {
      this.songs.witness(spellKey, ts, mobKey(target))
      return
    }
    const level = kind === 'self' ? this.selfLevel : null
    this.rowFor(target, spellKey, 'cast', kind, level, ts).resist += 1
  }

  private onDamage(ev: Extract<LogEvent, { kind: 'damage' }>): void {
    const attacker = ev.attacker
    if (!attacker) return
    if (ev.dtype === 'melee' || ev.dtype === 'ds') {
      this.onMelee(attacker, ev.target, ev.ts)
      if (idKey(attacker) === 'you') this.casters.noteStruck(ev.target)
      return
    }
    if (ev.dtype !== 'spell' && ev.dtype !== 'dot') return
    const kind = this.casters.kindOf(attacker)
    if (!kind) return
    if (kind === 'self') this.casters.noteStruck(ev.target)
    const spellKey = spellCanonKey(ev.skill)
    this.remember(ev.target)
    if (kind === 'self' && this.songSpells.has(spellKey)) {
      this.songs.witness(spellKey, ev.ts, null)
      return
    }
    this.cancelDeferred(ev.target, spellKey)
    const level = kind === 'self' ? this.selfLevel : null
    const row = this.rowFor(ev.target, spellKey, 'cast', kind, level, ev.ts)
    if (ev.dtype === 'dot') {
      this.onDotTick(row, ev.target, spellKey)
      return
    }
    // A crit is a landing whose NUMBER lies about the spell's full damage; count it, never file it.
    if (ev.crit || (ev.modifiers?.length ?? 0) > 0) row.land += 1
    else this.bucket.addDamage(row, ev.amount)
  }

  private onDotTick(row: ResistRow, target: string, spellKey: string): void {
    const key = pairKey(mobKey(target), spellKey)
    if (this.dotSeen.has(key)) return
    this.dotSeen.add(key)
    row.land += 1
  }

  // ---- songs ---------------------------------------------------------------------------

  /**
   * Rule 3: one reconstructed pulse becomes one attempt against every mob that was alive and in
   * melee contact inside the last pulse interval — plus every mob the log NAMED as resisting it,
   * which is proof of range that no proximity heuristic can improve on.
   */
  private filePulse(pulse: SongPulse): void {
    const targets = new Set(this.contact.within(pulse.ts, SONG_CONTACT_MS))
    for (const key of pulse.resisted) targets.add(key)
    for (const key of targets) {
      const display = this.display.get(key) ?? key
      const row = this.rowFor(display, pulse.spellKey, 'song', 'self', this.selfLevel, pulse.ts)
      if (pulse.resisted.has(key)) row.resist += 1
      else row.land += 1
    }
  }

  // ---- rows ----------------------------------------------------------------------------

  private spec(
    mobDisplay: string,
    spellKey: string,
    family: ResistFamily,
    casterKind: ResistCasterKind,
    casterLevel: number | null,
    ts: number
  ): RowSpec {
    const key = mobKey(mobDisplay)
    const level = this.levels.levelOf(key, mobDisplay)
    const spec: RowSpec = {
      mobKey: key,
      spellKey,
      family,
      casterKind,
      casterLevel,
      mobLevel: level?.level ?? null,
      debuffs: this.debuffs.active(key, ts),
    }
    if (this.zone !== undefined) spec.zone = this.zone
    if (level && level.lo !== level.hi) {
      spec.mobLevelLo = level.lo
      spec.mobLevelHi = level.hi
    }
    return spec
  }

  private rowFor(
    mobDisplay: string,
    spellKey: string,
    family: ResistFamily,
    casterKind: ResistCasterKind,
    casterLevel: number | null,
    ts: number
  ): ResistRow {
    return this.bucket.row(this.spec(mobDisplay, spellKey, family, casterKind, casterLevel, ts), ts)
  }
}
