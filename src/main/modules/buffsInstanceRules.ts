// buffsInstanceRules.ts — the PURE rules the buff-instance store applies, lifted out of
// buffsInstances.ts (which is at the 400-code-line factoring ceiling).
//
// Nothing here holds state or reads a clock. Each function answers ONE question the store asks
// while censoring, retiring or projecting an instance, and each one is a rule a reader is likely
// to want on its own: whether a retirement covers this instance, whether a zone leaves it behind,
// how long it may live unclosed, and what a fresh landing projects to.

import type { ActiveBuff } from '../../shared/types'
import { isLeftBehindOnZone, type EntityDisposition } from '../combat/entityRules'
import { expiryGraceMs, hygieneCapMs, nonSelfExpiryTimeoutMs, type OpenCast } from './buffsShapes'
import type { ActiveSpec } from './buffsView'

/** Does this open cast belong to the entity being retired? (`hostileOnly` = a plain mob death.) */
export function openMatches(o: OpenCast, entityKey: string, hostileOnly: boolean): boolean {
  if (!hostileOnly) return o.entityKey === entityKey
  return o.disp === 'hostile' && (o.entityKey === entityKey || o.entityKey === 'unknown-hostile')
}

/** Does this active instance belong to the entity being retired? */
export function activeMatches(a: ActiveBuff, aKey: string, entityKey: string, hostileOnly: boolean): boolean {
  if (!hostileOnly) return aKey === entityKey
  return a.cls === 'debuff' && (aKey === entityKey || aKey === 'unknown-hostile' || a.inferredTarget === true)
}

/**
 * ZONE (the user's rule): the player keeps self buffs; a SUMMONED pet follows and keeps
 * its buffs; a CHARMED pet is LEFT BEHIND (retire + censor); hostile mobs are left behind
 * (censor open debuffs). Uses the SHARED isLeftBehindOnZone rule.
 */
export function openLeftBehindOnZone(o: OpenCast): boolean {
  if (o.disp === 'self') return false
  if (o.disp === 'summoned') return isLeftBehindOnZone('summoned') // false
  if (o.disp === 'charmed') return isLeftBehindOnZone('charmed') // true
  return true // hostile → left behind
}

/** The long-stop retirement every instance has had since Task #33: 90 minutes, or twice what we
 *  know about the spell, whichever is longer. It answers "we lost the thread", not "it expired". */
export function hygieneCap(a: ActiveBuff, dbMs: number | null): number {
  return Math.max(hygieneCapMs(a.p75, a.n), dbMs != null ? 2 * dbMs : 0)
}

/**
 * THE UNWITNESSED-EXPIRY CULL (JOS-140, owner amendment 2026-08-09; widened by JOS-149).
 *
 * The owner's first case: slow a boss, then die. The wear-off line prints to a character who is
 * not there to receive it, so it never arrives and the bar squats at 0s — for ninety minutes,
 * under the hygiene cap alone. A row whose countdown ran out and whose close was never witnessed
 * is culled after its own timeout instead. It mints NOTHING: an absence of evidence is not a
 * measurement, and `sweepHygiene` has never called `addSample`.
 *
 * ONE LINE DECIDES WHO IS EXEMPT, AND IT IS `self`, NOT `cls`. JOS-140 exempted the whole buffs
 * window, on the argument that a wears-off line for a buff of yours is printed to YOU and that a
 * beneficial clock is PAUSED by an absence, so an overdue buff is more often a paused timer than
 * a lost line. Both halves of that are true of a SELF buff and neither is true of a buff on
 * somebody else. The pet fade line resolves against the CURRENT pet, so a row bound to a pet that
 * despawned can never be named by any later line; a buff on an ally prints nothing to you at all.
 * The owner's screenshot (JOS-149) is a pair of Focus Death rows at 0s on two long-dead pets,
 * which no amount of waiting could ever close, and which the startup replay raised again on every
 * launch.
 *
 * So: SELF buffs are exempt — Infinity means "no cull", leaving the hygiene cap as their only
 * long-stop, exactly as before. Every other row is culled at its countdown plus a wait whose
 * length is the estimate's quality:
 *
 *   a DEBUFF          ⇒ `expiryGraceMs`, unchanged (its DB branch protects the learner's one
 *                       chance at a correction — the reasoning is in buffsShapes.ts).
 *   a NON-SELF BUFF   ⇒ `nonSelfExpiryTimeoutMs`, a flat 60 s (15 s once the duration is learned).
 *                       Waiting the duration AGAIN is the owner's complaint restated: an hour of
 *                       0s on a pet buff nobody can close.
 *
 * A row with no number at all is counting UP, has nothing to be overdue against, and keeps the
 * hygiene cap. Nothing here reads a clock, so the cull is judged on the SAME `startedTs` the
 * countdown draws — which is what makes it respect the JOS-134 offline pause automatically: the
 * pause shifts that field, and the sweep's own hold (`heldBeforeTs`) covers every buff row,
 * self or not, for as long as a log hole is unexplained.
 */
export function unwitnessedCullCap(a: ActiveBuff): number {
  if (a.cls !== 'debuff' && a.self) return Number.POSITIVE_INFINITY
  const dur = a.overlayDurationMs
  // No number at all ⇒ the row is counting UP and has nothing to be overdue against.
  if (dur == null || dur <= 0) return Number.POSITIVE_INFINITY
  const wait = a.cls === 'debuff' ? expiryGraceMs(a.overlaySource, dur) : nonSelfExpiryTimeoutMs(a.overlaySource)
  return dur + wait
}

/** Where a fresh landing sits: its identity, whose it is, and the record it just joined. */
export interface LandingPlacement {
  key: string
  eKey: string
  disp: EntityDisposition
  caster: string
  permanent: boolean
  record: OpenCast
  ts: number
}

/**
 * The projection spec for a fresh landing. A permanent illusion has no group behind it, so it
 * reports the landing instant and a count of one; everything else reports the group's OLDEST
 * landing (the clock the next wear-off will close) and its size (the count chip).
 */
export function landingSpec(candidates: string[] | undefined, at: LandingPlacement): ActiveSpec {
  return {
    spell: at.record.spell,
    key: at.key,
    entityKey: at.eKey,
    startedTs: at.permanent ? at.ts : at.record.group.oldestTs,
    dispOverride: at.disp,
    caster: at.caster,
    count: at.permanent ? 1 : at.record.group.count,
    ...(candidates ? { candidates } : {}),
    opts: { messageDriven: true, permanent: at.permanent }
  }
}

/**
 * Permanent Illusion AA (Task #34): a SELF illusion cast at or after the AA was owned never
 * expires, so it is shown with no countdown and pairs no duration sample.
 */
export function isPermanentIllusion(
  self: boolean,
  illusion: boolean,
  ts: number,
  ownedTs: number | undefined
): boolean {
  return self && illusion && ownedTs != null && ts >= ownedTs
}
