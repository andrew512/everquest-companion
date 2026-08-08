// Per-SPELL learned knowledge for the buffs model (see buffs.ts): the mined duration
// samples, the fade-disposition tally that classifies a spell absent from the DB, the
// recency map, and the authoritative spell DB itself.
//
// This is GAME knowledge, not character state — a spell's duration and its cast messages
// are identical across a character rebirth — which is why the module's rebirth/session-gap
// clears deliberately leave everything here intact (see BuffsModule.onEvent).

import type { SpellDb } from '../data/spellDb'
import type { BuffClass, BuffStat } from '../../shared/types'
import type { EntityDisposition } from '../combat/entityRules'
import { percentile, RECENT_SAMPLE_WINDOW, type SpellSamples } from './buffsShapes'

/** Per-spell tally of the entity dispositions its fades landed on. */
interface DispTally {
  self: number
  summoned: number
  charmed: number
  hostile: number
}

export class SpellStats {
  /** The scraped spell database (Task #34), optional — the authoritative prior. */
  readonly db?: SpellDb
  /** Mined samples per SPELL key (per-spell, not per-instance — a v1 simplification). */
  samples = new Map<string, SpellSamples>()
  /** Spell keys ever seen fading / applied — the buff discriminator. */
  everFaded = new Set<string>()
  /**
   * Per-spell fade-disposition tally — the FALLBACK classifier for spells ABSENT from the
   * DB (Task #35): a spell that mostly fades on hostile entities is a debuff. DB spellType
   * wins when present.
   */
  dispTally = new Map<string, DispTally>()
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
    this.dispTally = new Map()
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

  /** Tally one observed fade disposition for a spell (the no-DB class fallback's input). */
  tallyFade(key: string, disp: EntityDisposition): void {
    let tally = this.dispTally.get(key)
    if (!tally) {
      tally = { self: 0, summoned: 0, charmed: 0, hostile: 0 }
      this.dispTally.set(key, tally)
    }
    tally[disp]++
  }

  /** Append a mined duration sample (the caller re-stats the live instances). */
  pushSample(key: string, spell: string, durMs: number): void {
    let s = this.samples.get(key)
    if (!s) {
      s = { spell, samples: [] }
      this.samples.set(key, s)
    }
    s.samples.push(durMs)
  }

  statFor(key: string): BuffStat | null {
    const s = this.samples.get(key)
    if (!s || s.samples.length === 0) return null
    const sorted = [...s.samples].sort((a, b) => a - b)
    const est = this.estimateFor(key)
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
   * clean samples, or null when there are none. Two deliberate choices (JOS-117):
   *   • MAX, not median/p75. A beneficial buff's samples are dominated by click-offs, dispels and
   *     early refreshes that read SHORT; those never lift the max, so the max recovers a focus/AA-
   *     extended true duration that a central statistic stays dragged below (Swift Like the Wind:
   *     p75 17m50 << the 36m20 that is the real timer).
   *   • a WINDOW (the last RECENT_SAMPLE_WINDOW), not all-time. A focus effect that is later
   *     REMOVED genuinely shortens the duration; bounding the max to recent samples lets an old
   *     long observation age out so a real decrease recovers.
   *
   * Safe to trust because a sample is minted ONLY from a genuine wear-off
   * (buffsInstances.recordFade → addSample): every censoring boundary — zone, death, offline gap,
   * entity retirement, hygiene — clears the instance WITHOUT minting, an offline-spanned span is
   * dropped, and a re-land RESETS the open cast's landedTs (buffsInstances line "Refresh
   * censoring"), so a refresh mints one clean full cycle rather than an inflated land→fade span.
   */
  observedWindowMaxFor(key: string): number | null {
    const s = this.samples.get(key)
    if (!s || s.samples.length === 0) return null
    return Math.max(...s.samples.slice(-RECENT_SAMPLE_WINDOW))
  }

  /**
   * THE ONE ESTIMATOR (JOS-117), used by the Buffs TAB estimate column AND the overlay countdown
   * (buffsView.ts `overlayDurationOf`). The DB baseline is a FLOOR, the recent observed max is an
   * EXTENSION over it:
   *
   *   estimate = max( DB baseline , max-over-recent-window of clean observed samples )
   *
   * The distribution the owner measured is why:
   *   • A beneficial buff's true duration is NEVER below its DB base — AA/focus only EXTEND — so a
   *     BELOW-base observation is an early termination (click-off / break / overwrite) and the max
   *     discards it; the floor holds. Invisibility: DB 20m, observed max only 4m24 (always broken
   *     early) ⇒ 20m, source 'db' — the estimate must NOT collapse to 4m.
   *   • An ABOVE-base observation is a real extension and WINS. Swift Like the Wind: DB 16m,
   *     observed 36m20 in the window ⇒ 36m, source 'observed'.
   * With no DB base the observed max stands alone; with neither, null.
   *
   * `source` names which WON — 'observed' when a sample beat the floor (the tab/overlay label it
   * "log"), 'db' when the floor held (Invisibility legitimately stays 'db').
   */
  estimateFor(key: string): { ms: number | null; source: 'db' | 'observed' | undefined } {
    const dbMs = this.dbDurationFor(key)
    const observedMax = this.observedWindowMaxFor(key)
    if (dbMs != null) {
      if (observedMax != null && observedMax > dbMs) return { ms: observedMax, source: 'observed' }
      return { ms: dbMs, source: 'db' }
    }
    if (observedMax != null) return { ms: observedMax, source: 'observed' }
    return { ms: null, source: undefined }
  }

  /**
   * The buff/debuff class of a spell (Task #35). SPELL PROPERTY:
   *   (1) DB spellType — Detrimental → 'debuff', Beneficial → 'buff' — authoritative.
   *   (2) FALLBACK for a spell absent from the DB: plurality of fade dispositions — hostile
   *       majority → 'debuff', else 'buff'.
   * There is NO 'pet' class; who the buff is on is an entity binding, not a class.
   */
  classOf(key: string): BuffClass {
    const st = this.db?.byKey.get(key)?.spellType
    if (st === 'Detrimental') return 'debuff'
    if (st === 'Beneficial') return 'buff'
    const t = this.dispTally.get(key)
    if (!t) return 'buff'
    const friendly = t.self + t.summoned + t.charmed
    return t.hostile > friendly ? 'debuff' : 'buff'
  }

  /** The snapshot's per-spell stats record: every spell ever faded, with or without samples. */
  buildStats(): Record<string, BuffStat> {
    const stats: Record<string, BuffStat> = {}
    for (const key of this.everFaded) {
      const st = this.statFor(key)
      if (st) {
        stats[key] = st
      } else {
        const disp = this.samples.get(key)?.spell
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
