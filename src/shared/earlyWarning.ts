// earlyWarning.ts — THE EARLY WARNING OFFSET (JOS-216), as pure functions.
//
// THE ASK, in the reporter's own words: "the ability to program a 10 second warning on mez, slow,
// tash". The owner's ruling is that this is an OFFSET ON AN EXISTING ALERT and not a new kind of
// alert: an alert that already fires when a debuff lands can instead fire N seconds before that
// debuff's ESTIMATED END. One option on the alert, one number, and everything else — the sound,
// the speech, the cooldown, the trigger — is the alert the user already wrote.
//
// IT ADDS NO DURATION TRACKING, AND THAT IS THE WHOLE DESIGN. The estimated end already exists and
// is already on screen: `shared/buffTimers.ts buildTimerRows` projects the buffs model and the CC
// half into rows, and a `mode:'countdown'` row states `startedTs + durationMs` — the SAME number
// the debuffs overlay draws a bar from, which since JOS-117/JOS-140 is the shared estimator
// max(DB floor, this caster's recent observed max). So the warning is that projection minus N
// seconds, and there is exactly one duration in the app.
//
// WHICH MEANS THE HONESTY LAW REACHES THIS SURFACE UNCHANGED (shared/buffTimers.ts's header):
// a row the model can put no honest number on counts UP and has no `durationMs`, and there is no
// end to count backwards from. Such a landing arms NOTHING — silence is the honest answer, and
// inventing a duration to warn against would be exactly the invented "remaining" that law forbids.
// The tooltip beside the field in the alert editor says the other half out loud: early on, the
// number is the DB floor and the warning can be early; it sharpens as your own log teaches it.
//
// Pure and Electron-free (it is `shared/`, and node:test loads it directly): no clock of its own,
// no state, and every input is handed in.

import type { BuffTimerRow } from './buffTimers'
import { timerNameKey } from './buffTimers'

/**
 * The bounds on the offset, in SECONDS.
 *
 * The floor is 1 because the model's own clock is a 1-second heartbeat (the registry's `onTick`,
 * which is what fires these) — an offset finer than the tick cannot be delivered, so promising it
 * would be a lie in the UI.
 *
 * The ceiling is 120 because it is past the longest thing anybody warns about early: the CC roster
 * tops out at Ensnare's 660 s and the debuffs people actually watch (mez 24-96 s, a slow a few
 * minutes) are shorter still, so two minutes covers "warn me well before the slow drops" and
 * refuses the typo that would arm a warning before the spell had finished landing.
 */
export const MIN_EARLY_WARN_SEC = 1
export const MAX_EARLY_WARN_SEC = 120

/**
 * A stored/typed/imported offset as a number this app will act on, or undefined for "no warning".
 *
 * UNDEFINED IS THE DEFAULT AND THE FALLBACK, both of which mean the same thing: fire when the
 * trigger matches, which is what every alert written before this existed already did. A zero, a
 * negative, a NaN, a string and an absent key all land here, so nothing has to be migrated and a
 * stranger's shared bundle cannot arm a warning with a value this build would not have offered.
 */
export function normalizeEarlyWarnSec(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const sec = Math.round(raw)
  if (sec < MIN_EARLY_WARN_SEC) return undefined
  return Math.min(MAX_EARLY_WARN_SEC, sec)
}

/**
 * WHAT A LANDING WAS ABOUT — the half of the arming event that decides which timer row it made.
 *
 * `targetKey` is the canonical (idKey'd) entity the spell landed on; absent means the player, and
 * the two are exclusive because the projection's `group` is exactly that distinction.
 *
 * `spellNames` is EVERY name the line could be, not a name (JOS-84's law): the landing sentences
 * this feature is aimed at are shared across whole spell families — `<mob> has been mesmerized.`
 * is four spells — so the event's `spell` field is a documented best-effort pick and `candidates`
 * carries the truth. Both go in here, and the match below accepts any of them.
 */
export interface EarlyWarnSubject {
  /** Canonical entity key (idKey), or undefined when the landing was on the player. */
  targetKey?: string
  /** Every spell name the arming line could have been, display casing, possibly empty. */
  spellNames: readonly string[]
}

/** True when a row states an end at all — the only rows an early warning can be measured against. */
function hasStatedEnd(row: BuffTimerRow): boolean {
  return row.mode === 'countdown' && row.durationMs != null && row.durationMs > 0
}

/** Every spell name a row answers to, rank-stripped and folded (its own, plus its family). */
function rowNameKeys(row: BuffTimerRow): string[] {
  return [row.name, ...(row.candidates ?? [])].map(timerNameKey)
}

/**
 * THE ROW A LANDING IS TRACKED BY, or undefined when the model states no end for it.
 *
 * THE RULE, in the order it is applied, and its honest limit stated with it:
 *
 *  1. Only rows with a STATED end (see the header). A count-up row arms nothing.
 *  2. The row must be on the subject's entity — the mob the line named, or the player.
 *  3. If ANY of those rows answers to one of the subject's spell names, only those rows are
 *     considered. Rank-stripped and case-folded on both sides, because the row's name comes from
 *     the CAST line (`Mesmerization VII` — the only line in the family that carries a rank) while
 *     the arming event's names come from the DB candidates for a landing sentence that carries
 *     none. A subject whose names match nothing on that entity falls back to all of them rather
 *     than to nothing: the parser's candidate list is DB-derived and a row the model resolved from
 *     the player's own cast history is the better answer when the two disagree.
 *  4. Of what is left, the MOST RECENT landing — the largest `startedTs`. The arming event is the
 *     line that produced the row, so on the ordinary path there is exactly one and this picks it.
 *
 * THE LIMIT: two different debuffs landing on one mob in the same second, whose sentences name no
 * spell this build can tell apart, are one entity with two rows and step 4 takes the newer. That
 * is a warning about the wrong one of two things the user is holding on that mob — never a warning
 * about a mob they are not fighting.
 */
export function earlyWarnRowFor(
  rows: readonly BuffTimerRow[],
  subject: EarlyWarnSubject
): BuffTimerRow | undefined {
  const onSubject = rows.filter(
    (r) => hasStatedEnd(r) && (subject.targetKey == null ? r.group === 'self' : r.targetKey === subject.targetKey)
  )
  if (onSubject.length === 0) return undefined
  const wanted = new Set(subject.spellNames.map(timerNameKey))
  const named = wanted.size === 0 ? [] : onSubject.filter((r) => rowNameKeys(r).some((k) => wanted.has(k)))
  const pool = named.length > 0 ? named : onSubject
  return pool.reduce((best, r) => (r.startedTs > best.startedTs ? r : best))
}

/**
 * WHEN THE WARNING FOR THIS ROW IS DUE — the row's estimated end minus the offset.
 *
 * Re-read on every tick rather than computed once at the landing, because both halves move: the
 * learner can raise the estimate mid-hold (`restatLine` re-states every live bar when a sample
 * beats the floor) and a re-land moves `startedTs`. A warning that fixed its own deadline at the
 * landing would go on describing a countdown the app had already corrected.
 *
 * Undefined when the row states no end — the same refusal as `earlyWarnRowFor`, restated here so a
 * caller holding a row that has since lost its number cannot compute a deadline from nothing.
 */
export function earlyWarnFireAt(row: BuffTimerRow, sec: number): number | undefined {
  if (!hasStatedEnd(row) || row.durationMs == null) return undefined
  return row.startedTs + row.durationMs - sec * 1000
}
