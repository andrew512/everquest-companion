// buffsStats.ts — THE ONE OBSERVED-DURATION LEARNER (JOS-140), and the per-line game knowledge
// beside it: the mined duration samples, the recency map, and the authoritative spell DB.
//
// This is GAME knowledge, not character state — a spell's duration and its cast messages are
// identical across a character rebirth — which is why the module's rebirth/session-gap clears
// deliberately leave everything here intact (see BuffsModule.onEvent).
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE LEARNER, TWO HALVES OF THE MODEL (JOS-140 ruling 1). Before this ticket there were two
// systems: buffs and debuffs had `estimateFor` and crowd control had NOTHING — the CC half was
// DB-STATED by design and said so in its own header, so a Mesmerization VII that really runs 44 s
// counted down from the base rank's 24 s and no number of casts could ever teach it (JOS-126's
// measured root cause: not a broken learner, a missing one). The CC holds now mint into THIS store
// through the same `pushSample`, and read back through the same `estimateFor`.
//
// KEYED ON (LINE, CASTER) — ruling 4, and both halves of the key are the owner's:
//   * the LINE is the rank-stripped key, so `Mesmerization III` and `Mesmerization VII` pool. This
//     OVERRULES the investigation's A2 (which wanted per-rank keys) for a measured reason: the
//     committed spells.json has 121 rank-suffixed names and ZERO rows at rank VI or above, so a
//     per-rank key would start every upgrade back at the DB floor and re-learn from nothing on
//     every level. Pooling errs toward the longer observation, which is the direction the MAX
//     estimator is built for.
//   * the CASTER is 'self' or an allowlisted external (shared/buffTrust.ts). A duration is a fact
//     about a caster's AAs, focus items and rank; a grouped enchanter's 31-second mez and your own
//     44-second one are two answers to two questions, and pooling them gives a bar wrong for both.
//
// THE ESTIMATOR ITSELF is unchanged from JOS-117 and confirmed by the owner (ruling 6):
//   estimate = max( DB baseline , max-over-recent-window of CLEAN observed samples )
// The DB base is a FLOOR and the recent observed max is an EXTENSION over it. See `estimateFor`.

import type { SpellDb } from '../data/spellDb'
import { spellNature } from '../data/spellDb'
import type { BuffClass, BuffStat } from '../../shared/types'
import { learnKey, SELF_CASTER } from '../../shared/buffTrust'
import { percentile, RECENT_SAMPLE_WINDOW, type SpellSamples } from './buffsShapes'

export class SpellStats {
  /** The scraped spell database (Task #34), optional — the authoritative prior. */
  readonly db?: SpellDb
  /**
   * Mined samples per (LINE, CASTER) — `buffTrust.learnKey`. Ranks pool within a caster; casters
   * never pool with each other (ruling 4).
   */
  samples = new Map<string, SpellSamples>()
  /** Spell keys ever seen fading / applied — the buff discriminator. */
  everFaded = new Set<string>()
  /**
   * Per-spell LAST-SEEN event ts (Task #45): the newest castBegin / apply / fade involving
   * the spell — the cheapest consistent recency signal. Feeds the suggested-alerts wizard's
   * recency sort (recent spells sort to the top over merely-frequent ones). Keyed by
   * canonical spell key; survives session gaps like the other learned maps.
   */
  lastSeen = new Map<string, number>()

  constructor(db?: SpellDb) {
    this.db = db
  }

  reset(): void {
    this.samples = new Map()
    this.everFaded = new Set()
    this.lastSeen = new Map()
  }

  /** Record the newest ts a spell was seen (cast/apply/fade) — the recency signal (Task #45). */
  touchLastSeen(key: string, ts: number): void {
    const prev = this.lastSeen.get(key)
    if (prev == null || ts > prev) this.lastSeen.set(key, ts)
  }

  /** Authoritative DB duration (ms) for a spell key, or null when unknown. */
  dbDurationFor(key: string): number | null {
    const s = this.db?.byKey.get(key)
    return s?.durationMs ?? null
  }

  /** True when a spell KEY is illusion-flagged in the DB (Task #36). */
  isIllusion(key: string): boolean {
    return this.db?.byKey.get(key)?.illusion ?? false
  }

  /** Append a mined duration sample for one caster (the caller re-stats the live instances). */
  pushSample(key: string, caster: string, spell: string, durMs: number): void {
    const lk = learnKey(key, caster)
    let s = this.samples.get(lk)
    if (!s) {
      s = { spell, samples: [] }
      this.samples.set(lk, s)
    }
    s.samples.push(durMs)
  }

  /** The display name last minted for a (line, caster), for a row that has lost its own. */
  sampleSpellName(key: string, caster: string = SELF_CASTER): string | undefined {
    return this.samples.get(learnKey(key, caster))?.spell
  }

  statFor(key: string, caster: string = SELF_CASTER): BuffStat | null {
    const s = this.samples.get(learnKey(key, caster))
    if (!s || s.samples.length === 0) return null
    const sorted = [...s.samples].sort((a, b) => a - b)
    const est = this.estimateFor(key, caster)
    return {
      spell: s.spell,
      cls: this.classOf(key),
      n: sorted.length,
      medianMs: percentile(sorted, 0.5),
      p25: percentile(sorted, 0.25),
      p75: percentile(sorted, 0.75),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      dbDurationMs: this.dbDurationFor(key),
      estimateMs: est.ms,
      estimatorSource: est.source,
      lastSeenMs: this.lastSeen.get(key) ?? null
    }
  }

  /**
   * The observed candidate that competes with the DB floor: the MAX over the most recent window of
   * clean samples for this (line, caster), or null when there are none. Two deliberate choices
   * (JOS-117, re-confirmed as ruling 6):
   *   • MAX, not median/p75. Samples are dominated by early terminations that read SHORT — a buff
   *     clicked off, a mez a nuke broke — and those never lift the max, so the max recovers a
   *     focus/AA-extended true duration that a central statistic stays dragged below (Swift Like
   *     the Wind: p75 17m50 << the 36m20 that is the real timer). It is the ONLY estimator that
   *     survives the censoring, and the censoring is severe: EQ prints the same wear-off sentence
   *     whether a mez ran its course or a nuke broke it at 2 s.
   *   • a WINDOW (the last RECENT_SAMPLE_WINDOW), not all-time. A focus effect that is later
   *     REMOVED genuinely shortens the duration; bounding the max to recent samples lets an old
   *     long observation age out so a real decrease recovers.
   *
   * Safe to trust because of the CLEAN-CYCLE rule (ruling 5, buffRounds.ts): a sample is minted
   * only from a landing that was alone in its round, on a name nothing else was holding, that
   * nothing touched before its wear-off. Every censoring boundary — zone, death, offline gap,
   * entity retirement, hygiene, a wear-off with no hold behind it — contaminates instead of
   * minting, and a re-land RESETS the clock so a refresh mints one clean cycle rather than an
   * inflated land-to-fade span.
   */
  observedWindowMaxFor(key: string, caster: string = SELF_CASTER): number | null {
    const s = this.samples.get(learnKey(key, caster))
    if (!s || s.samples.length === 0) return null
    return Math.max(...s.samples.slice(-RECENT_SAMPLE_WINDOW))
  }

  /**
   * THE ONE ESTIMATOR (JOS-117, ruling 6) — used by the Buffs TAB estimate column, the buff/debuff
   * overlay countdown (buffsView.ts `overlayDurationOf`) AND, since JOS-140, the crowd-control
   * holds. The DB baseline is a FLOOR, the recent observed max is an EXTENSION over it:
   *
   *   estimate = max( DB baseline , max-over-recent-window of clean observed samples )
   *
   * The distribution the owner measured is why:
   *   • A beneficial buff's true duration is NEVER below its DB base — AA/focus only EXTEND — so a
   *     BELOW-base observation is an early termination (click-off / break / overwrite) and the max
   *     discards it; the floor holds. Invisibility: DB 20m, observed max only 4m24 (always broken
   *     early) ⇒ 20m, source 'db' — the estimate must NOT collapse to 4m.
   *   • An ABOVE-base observation is a real extension and WINS. Swift Like the Wind: DB 16m,
   *     observed 36m20 in the window ⇒ 36m, source 'observed'. Mesmerization: DB 24m (the base
   *     rank's, the only row that exists), observed 44 s at rank VII ⇒ 44 s.
   * With no DB base the observed max stands alone; with neither, null.
   *
   * THE FLOOR'S ASSUMPTION, stated: the base rank's stated duration is a floor for the upgraded
   * ranks. That is true of a rank line and is the only assumption being made. A CC spell ever
   * observed running SHORTER than its DB row is what would need revisiting, and the source label
   * says 'db' in that case rather than silently averaging.
   *
   * `source` names which WON — 'observed' when a sample beat the floor (the tab/overlay label it
   * "log"), 'db' when the floor held (Invisibility legitimately stays 'db').
   */
  estimateFor(key: string, caster: string = SELF_CASTER): { ms: number | null; source: 'db' | 'observed' | undefined } {
    const dbMs = this.dbDurationFor(key)
    const observedMax = this.observedWindowMaxFor(key, caster)
    if (dbMs != null) {
      if (observedMax != null && observedMax > dbMs) return { ms: observedMax, source: 'observed' }
      return { ms: dbMs, source: 'db' }
    }
    if (observedMax != null) return { ms: observedMax, source: 'observed' }
    return { ms: null, source: undefined }
  }

  /**
   * THE BUFF/DEBUFF CLASS OF A SPELL — from the spell's NATURE, and from nothing else (JOS-140
   * ruling 8). `spellNature` folds the DB's whole 33-value `spellType` vocabulary into beneficial
   * / detrimental / unknown; that table is exhaustive over the committed DB and audited by a test.
   *
   * WHAT WAS REMOVED, AND WHY IT WAS A DEFECT. This used to fall back, for any spellType the two
   * string literals 'Beneficial' and 'Detrimental' did not name, to a TALLY OF THE ENTITY
   * DISPOSITIONS the spell's fades had landed on — hostile majority ⇒ debuff. That is
   * classification by the shape of the TARGET, and JOS-136 is what it costs: `Resist Magic` is
   * spellType `Resist Buff`, matched neither literal, and a friendly resist buff landing on
   * somebody the model was not currently holding as a pet tallied 'hostile' and walked onto the
   * DEBUFFS overlay. An ally is a named target and so is a mob; the game does not distinguish them
   * in a landing sentence, and the SPELL always did.
   *
   * A spell whose nature nobody states is NOT a debuff by assumption: it reads 'buff', which is
   * where the count of such spells actually is (the seven rows with no spellType at all are bard
   * resonances and Fury of the Chosen, none of which state a duration, so none of them can open an
   * instance in the first place). It is never resolved by looking at who it landed on.
   */
  classOf(key: string): BuffClass {
    return spellNature(this.db?.byKey.get(key)?.spellType) === 'detrimental' ? 'debuff' : 'buff'
  }

  /**
   * The snapshot's per-line stats record: every spell ever faded, with or without samples.
   *
   * It reports the SELF caster's numbers. The Buffs tab is a page about your own spells, and an
   * allowlisted external's samples live under their own learner key precisely so they cannot be
   * mistaken for yours — the overlay row for their buff counts down from their estimate, which is
   * read per-row (buffsView.ts) rather than from this table.
   */
  buildStats(): Record<string, BuffStat> {
    const stats: Record<string, BuffStat> = {}
    for (const key of this.everFaded) {
      const st = this.statFor(key)
      if (st) {
        stats[key] = st
      } else {
        const disp = this.sampleSpellName(key)
        const dbMs = this.dbDurationFor(key)
        const dbSpell = this.db?.byKey.get(key)?.name
        stats[key] = {
          spell: disp ?? dbSpell ?? key,
          cls: this.classOf(key),
          n: 0,
          medianMs: null,
          p25: null,
          p75: null,
          minMs: null,
          maxMs: null,
          dbDurationMs: dbMs,
          estimateMs: dbMs,
          estimatorSource: dbMs != null ? 'db' : undefined,
          lastSeenMs: this.lastSeen.get(key) ?? null
        }
      }
    }
    return stats
  }
}
