// buffTimers.ts — THE HONESTY LAW OF THE BUFFS/TIMER OVERLAY (JOS-89), as a pure function.
//
// docs/plans/buff-timer-overlay.md is the design record. The one rule that decides every pixel
// on that surface:
//
//   A duration spells.json STATES becomes a receding countdown.
//   A duration nobody states becomes ELAPSED time counting UP.
//   There is no third case, and an invented "remaining" is never displayed.
//
// It lives here — no Electron, no React, and no clock of its own (`nowMs` is an argument) —
// so a test can drive real fixture bytes through the real parser and the real modules and
// assert the rows a user would actually see.
//
// THE ESTIMATOR (JOS-117) — one definition, this surface AND the Buffs tab. This surface counts
// down from `overlayDurationMs`, which the buffs model fills (buffsView.ts `overlayDurationOf`)
// from the SAME estimator the tab's estimate column uses (buffsStats.ts `estimateFor`):
//   overlayDurationMs = max( DB baseline , max-over-recent-window of clean observed samples )
//   (permanent → null, and no-floor-no-sample → null → count UP.)
// The DB base is a FLOOR: a beneficial buff's true duration is never below it (AA/focus only
// EXTEND), so a below-base observation is an early termination (click-off / dispel / overwrite) and
// the max discards it — the floor holds (Invisibility: DB 20m, observed max 4m ⇒ 20m). A sample
// ABOVE the base is a real extension and WINS (Swift Like the Wind: DB 16m, observed 36m ⇒ 36m).
// This REPLACES JOS-114's most-recent-sample overlay rule, which trusted whatever cast faded last:
// a buff clicked off early minted a short "worn off" sample INDISTINGUISHABLE from a natural expiry
// and became the overlay's number (the owner saw Swift at ~28m for a 33:36 buff). The max over the
// window ignores the click-off; the window (not all-time) lets a removed focus age out so a genuine
// decrease recovers. Trusting a sample is SAFE because of the CLEAN-SAMPLE rule: one is minted ONLY
// from a genuine wear-off (buffsInstances.recordFade → addSample); a zone, death, offline gap,
// entity retirement or hygiene sweep clears the instance WITHOUT minting, an offline-spanned span is
// dropped, and a re-land RESETS the open cast's landedTs so a refresh mints one clean full cycle,
// never an inflated land→fade span. `estimatedMs`/`durationSource` are the tab's own copies of the
// same numbers; this surface reads `overlayDurationMs`/`overlaySource`.
//
// JOS-118 EXTENDS THAT RULE IN TWO PLACES, both for the same reason — only OUR OWN cast under OUR
// OWN modifiers is a duration we are entitled to learn from. (1) An instance now opens only from a
// LANDING line, so a cast that was resisted (or simply never confirmed) mints nothing, where the
// old optimistic cast-timing path could open one on a target it had merely inferred. (2) A sample
// requires an EXACT (spell, entity) chain: `recordFade` no longer falls back to the oldest open
// cast of the same spell on a DIFFERENT entity, which used to measure a slow on mob B against the
// older landing on mob A and hand the MAX estimator a span that is too long.
//
// NOT everything the overlay draws takes this path: the per-target MEZ/ROOT holds (main/modules/
// buffTimers.ts, projected by `ccRow` below) stay DB-STATED. Their end line — `Your <mez> spell
// has worn off of <mob>.` — is printed identically whether the mez ran its full course or a nuke
// broke it early (see tests/fixtures/w10-cazic-slow.log: 2 s and 18 s break lines under one 24 s
// cast), so no clean sample exists to mint; counting down from one would be the censored value the
// clean-sample rule exists to keep out. A SLOW/debuff, by contrast, flows through the ActiveBuff
// path (`buffApply` land → `buffFade` "worn off of <mob>") and DOES get the observed-first rule.

import type { ActiveBuff, BuffsSnap } from './buffTypes'
// Type-only: `shared/types.ts` is a value module (OVERLAY_KINDS) and this one is imported by the
// node tests as a pure module, so the reference is erased at compile time and nothing follows it.
import type { OverlayKind } from './types'

// ----- the two TIMER SURFACES (JOS-119) -----

/**
 * The two overlay kinds this projection feeds. Their vocabulary lives HERE rather than in
 * `shared/types.ts` (which is at its factoring ceiling) so that the rule deciding which window a
 * row belongs to sits beside the function that builds the rows — one file, one answer.
 */
export type TimerOverlayKind = Extract<OverlayKind, 'buffs' | 'debuffs'>

/** True for the two timer-bar kinds: they read the same modules and render the same component. */
export function isTimerOverlayKind(kind: OverlayKind): kind is TimerOverlayKind {
  return kind === 'buffs' || kind === 'debuffs'
}

// ----- the CC half's state (owned by main/modules/buffTimers.ts, rendered by the overlay) -----

/**
 * A crowd-control HOLD on one mob: the per-target mez/root entry the chain-mez reports asked
 * for. Keyed by mob, so casting one AE mez that lands on four enemies produces four of these.
 */
export interface CcHold {
  /** Canonical mob key (idKey) — the identity. */
  key: string
  /** The mob's display name, raw from the log (world-model law 2: canonicalize at boundaries). */
  target: string
  /** Event ts (ms) the hold landed. NOT a wall clock — see the note on BuffTimerRow.startedTs. */
  startedTs: number
  /**
   * The spell, when the player's own cast history narrowed the landing sentence's candidates to
   * exactly ONE. Absent when it did not — in which case `candidates` is the honest answer and
   * this row is a family, not a name (JOS-84).
   */
  spell?: string
  /**
   * Every spell the landing sentence could be, display casing, sorted for stability. Empty only
   * when no spell DB was installed. Carried even when `spell` resolved, so a consumer can say
   * what was ruled out.
   */
  candidates: string[]
  /**
   * The DB-STATED duration in ms, or null when none can be stated. Non-null in exactly two
   * cases: the candidates narrowed to one spell that states a duration, or every candidate
   * states the SAME duration (so the ambiguity does not reach the number). Never a mined value.
   */
  durationMs: number | null
}

/**
 * A hold that ENDED, and how. Kept briefly so the projection can also retire a matching
 * `ActiveBuff` the buffs model does not clear (see §1.5/§3.3 of the plan) and so the overlay can
 * flash a drop.
 */
export interface CcEnd {
  key: string
  /** The spell named by the break line, when it named one. */
  spell?: string
  ts: number
}

/** The `buffTimers` module's whole state — small, so it ships entire on every flush. */
export interface BuffTimersSnap {
  holds: CcHold[]
  ends: CcEnd[]
}
export type BuffTimersDelta = BuffTimersSnap

// ----- the rows -----

/**
 * How a row's time is read.
 *   'countdown'  — spells.json STATES a duration: a receding bar, `durationMs` present.
 *   'elapsed'    — nobody states one: time counts UP from the landing, `durationMs` absent.
 *   'permanent'  — a self-cast illusion under the Permanent Illusion AA: no timer at all.
 */
export type TimerMode = 'countdown' | 'elapsed' | 'permanent'

export interface BuffTimerRow {
  /** Stable across ticks so React keys and e2e selectors do not churn. */
  id: string
  kind: 'buff' | 'debuff' | 'cc'
  /** The resolved spell name, or the candidate names joined when the sentence is shared. */
  name: string
  /** Present only when the row is a FAMILY: every spell the line could be (JOS-84). */
  candidates?: string[]
  /** True when `name` is a family rather than a spell — drives the `~` chip. */
  ambiguous?: true
  /** Self buffs render first, then one group per target (world-model law 4: presentation only). */
  group: 'self' | 'target'
  target?: string
  targetKey?: string
  /** True when `target` is the model's INFERENCE, never a name a sentence stated. */
  inferredTarget?: true
  /**
   * The event ts the instance landed. NOT A WALL CLOCK: `BuffInstances.onOfflineGap` shifts it
   * forward by an absence (EQ pauses buff timers while you are camped — measured), so elapsed
   * and remaining are the only honest readings and this must never be printed as a time of day.
   */
  startedTs: number
  mode: TimerMode
  /** ONLY on 'countdown', and ONLY a DB-stated number. */
  durationMs?: number
}

/**
 * WHICH WINDOW A ROW BELONGS TO (JOS-119) — the whole split, as one pure function.
 *
 * The owner asked for two windows he can enable and place separately, NOT for two models: one
 * source (`buildTimerRows` above) is folded once and each surface keeps the rows that are its
 * subject. The discriminator is the row's own `kind`, which the model already carries:
 *
 *   'buff'            → the BUFFS window. A beneficial spell you have running. `group` is NOT the
 *                       discriminator here: a Symbol on your pet and a Valor on the cleric you
 *                       buffed are `group: 'target'` and are still BUFFS — routing them by target
 *                       would file your own group buffs under "debuffs", which is a lie about what
 *                       they are.
 *   'debuff' | 'cc'   → the DEBUFFS window. What you have put ON something else: a slow, a snare,
 *                       a mez hold. The owner rules mez and slow ARE debuffs, so the CC holds live
 *                       here beside them rather than in a third place.
 *
 * Exhaustive over `BuffTimerRow['kind']` by construction — a new row kind has to choose a window.
 */
export function timerRowSurface(row: BuffTimerRow): TimerOverlayKind {
  return row.kind === 'buff' ? 'buffs' : 'debuffs'
}

/** The rows one timer surface shows. Order is `buildTimerRows`' order, filtered — never re-sorted. */
export function rowsForSurface(rows: readonly BuffTimerRow[], kind: TimerOverlayKind): BuffTimerRow[] {
  return rows.filter((r) => timerRowSurface(r) === kind)
}

/** What a row reads RIGHT NOW. `fraction` is 1 at the landing and 0 at/after the stated end. */
export interface TimerReading {
  elapsedMs: number
  /** Present only for a countdown; clamped at 0 — a countdown never renders a negative. */
  remainingMs?: number
  /** Bar fill in [0,1]: remaining share for a countdown, 0 for elapsed/permanent (no bar). */
  fraction: number
  /** True when a countdown has run past its stated end and the log has not yet cleared it. */
  overdue: boolean
}

export function timerReading(row: BuffTimerRow, nowMs: number): TimerReading {
  const elapsedMs = Math.max(0, nowMs - row.startedTs)
  if (row.mode !== 'countdown' || row.durationMs == null || row.durationMs <= 0) {
    return { elapsedMs, fraction: 0, overdue: false }
  }
  const left = row.durationMs - elapsedMs
  const remainingMs = left > 0 ? left : 0
  return {
    elapsedMs,
    remainingMs,
    fraction: Math.min(1, Math.max(0, left / row.durationMs)),
    overdue: left <= 0
  }
}

// ----- building the rows -----

/** Rank tail (mirrors parser.spellCanonKey — kept local so `shared/` never reaches into main;
 *  the same trick `data/spellDb.ts canonKey` already uses for the same reason). */
const RANK_TAIL_RE = / (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i
function nameKey(name: string): string {
  return name.trim().replace(RANK_TAIL_RE, '').trim().toLowerCase()
}

/** Canonical entity key (mirrors parseCommon.idKey for the same reason as above). */
function entityKeyOf(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * The single stated duration a candidate set can honestly claim, or null.
 *
 * One candidate ⇒ its own duration. Several ⇒ a duration ONLY if every one of them states the
 * SAME number, because then the ambiguity never reaches the clock. Measured, this is not a
 * theoretical branch: `has been enthralled.` is one spell (48 s, statable) while
 * `has been mesmerized.` is four spells at 96 s / 24 s / 24 s / no-duration-at-all (not
 * statable), so a blanket "a mez counts up" would have thrown away two of the four families
 * and a blanket "take the first" would have been the coin flip JOS-84 exists to forbid.
 */
export function statedDuration(candidates: readonly { durationMs: number | null }[]): number | null {
  if (candidates.length === 0) return null
  const first = candidates[0].durationMs
  if (first == null) return null
  return candidates.every((c) => c.durationMs === first) ? first : null
}

/** The row a CC hold projects to. */
function ccRow(h: CcHold): BuffTimerRow {
  const spell = h.spell
  const family = h.candidates.length > 0 ? h.candidates.join(' / ') : 'Crowd control'
  return {
    id: `cc|${h.key}|${spell != null ? nameKey(spell) : h.candidates.map(nameKey).join('+')}`,
    kind: 'cc',
    name: spell ?? family,
    group: 'target',
    target: h.target,
    targetKey: h.key,
    startedTs: h.startedTs,
    ...(spell != null ? {} : { candidates: [...h.candidates], ambiguous: true as const }),
    ...(h.durationMs != null
      ? { mode: 'countdown' as const, durationMs: h.durationMs }
      : { mode: 'elapsed' as const })
  }
}

/**
 * THE LAW, as one decision: the estimator's duration — max(DB floor, recent observed max) — earns a
 * receding countdown; nothing else does (JOS-117).
 *
 * `overlayDurationMs` is the whole discriminator, filled by buffsView.ts from the shared estimator
 * (see this file's header). A permanent buff never counts down. A buff the model can put no honest
 * number on (no sample, no DB floor) counts UP instead — and carries no duration at all, so nothing
 * downstream can draw a bar from it. `estimatedMs`/`durationSource` are the tab's copies of the same
 * estimator and are read there, not here.
 */
function timerModeOf(b: ActiveBuff): { mode: TimerMode; durationMs?: number } {
  if (b.permanent === true) return { mode: 'permanent' }
  if (b.overlayDurationMs != null && b.overlayDurationMs > 0) {
    return { mode: 'countdown', durationMs: b.overlayDurationMs }
  }
  return { mode: 'elapsed' }
}

/** The row an ActiveBuff projects to. */
function buffRow(b: ActiveBuff): BuffTimerRow {
  const targetKey = b.self ? undefined : b.target != null ? entityKeyOf(b.target) : 'unknown'
  const timing = timerModeOf(b)
  return {
    id: `${b.self ? 'self' : 'target'}|${targetKey ?? 'self'}|${nameKey(b.spell)}`,
    kind: b.cls,
    name: b.spell,
    group: b.self ? 'self' : 'target',
    ...(b.self ? {} : { target: b.target ?? 'unknown target', targetKey }),
    ...(b.inferredTarget === true ? { inferredTarget: true as const } : {}),
    startedTs: b.startedTs,
    ...timing
  }
}

/**
 * True when the CC ledger has recorded an END for this active instance at or after it landed —
 * the §3.3 correction. `Your <mez> spell has worn off of <mob>.` routes to `cc {refresh:true}`
 * rather than `buffFade`, so `BuffsModule.onBuffFade` never runs for a CC-roster spell and the
 * instance is never cleared from the buffs model (it lingers to the 90-minute hygiene cap).
 * Correcting it in `buffsInstances.recordFade` would also mint a land→fade DURATION SAMPLE and
 * move mined statistics across the whole golden suite — the buff-system rework the owner paused
 * — so the correction lives in the projection and is exactly one rule wide.
 */
function endedByCc(b: ActiveBuff, ends: readonly CcEnd[]): boolean {
  if (b.self || b.target == null) return false
  const key = entityKeyOf(b.target)
  const spell = nameKey(b.spell)
  return ends.some((e) => e.key === key && e.ts >= b.startedTs && (e.spell == null || nameKey(e.spell) === spell))
}

/** Soonest-to-expire first within a group; countdowns ahead of count-ups; then oldest first. */
function compareRows(a: BuffTimerRow, b: BuffTimerRow): number {
  const rank = (r: BuffTimerRow): number => (r.mode === 'countdown' ? 0 : r.mode === 'elapsed' ? 1 : 2)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (a.mode === 'countdown' && b.mode === 'countdown') {
    const ea = a.startedTs + (a.durationMs ?? 0)
    const eb = b.startedTs + (b.durationMs ?? 0)
    if (ea !== eb) return ea - eb
  } else if (a.startedTs !== b.startedTs) {
    return a.startedTs - b.startedTs
  }
  return a.name.localeCompare(b.name)
}

/**
 * THE PROJECTION. Self rows first (law 4's presentation order), then one block per target with
 * that target's rows together, targets ordered by their soonest row.
 *
 * There is no clock argument on purpose: every row carries its own `startedTs` and its own mode,
 * so the renderer ticks without another round trip and this function stays a pure fold over two
 * snapshots. Reading a row against a clock is `timerReading`.
 */
export function buildTimerRows(buffs: BuffsSnap, timers: BuffTimersSnap): BuffTimerRow[] {
  // A CC hold and an ActiveBuff can describe the SAME mez: a spell whose landing sentence the DB
  // matcher DID see (Screaming Terror's "begins to scream.") becomes an ActiveBuff, and its
  // `<mob> has been …` siblings become holds. Where both exist for one (mob, spell), the HOLD
  // wins — it is the half that knows about break lines.
  const heldBySpell = new Set(
    timers.holds.filter((h) => h.spell != null).map((h) => `${h.key}|${nameKey(h.spell ?? '')}`)
  )
  const rows: BuffTimerRow[] = []
  for (const b of buffs.active) {
    if (endedByCc(b, timers.ends)) continue
    const row = buffRow(b)
    if (row.group === 'target' && heldBySpell.has(`${row.targetKey ?? ''}|${nameKey(row.name)}`)) continue
    rows.push(row)
  }
  for (const h of timers.holds) rows.push(ccRow(h))

  const self = rows.filter((r) => r.group === 'self').sort(compareRows)
  const targeted = rows.filter((r) => r.group === 'target')
  const byTarget = new Map<string, BuffTimerRow[]>()
  for (const r of targeted) {
    const k = r.targetKey ?? 'unknown'
    const list = byTarget.get(k)
    if (list) list.push(r)
    else byTarget.set(k, [r])
  }
  const groups = [...byTarget.values()].map((g) => g.sort(compareRows))
  groups.sort((a, b) => compareRows(a[0], b[0]))
  return [...self, ...groups.flat()]
}
