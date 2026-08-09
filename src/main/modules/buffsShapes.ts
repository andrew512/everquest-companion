// Shared vocabulary of the buffs model (see buffs.ts for the model itself): the tuning
// constants every part of it is calibrated against, the instance/cast record shapes, and
// the pure helpers (key canonicalization, percentile, landing-message shape test). Nothing
// here holds state, so it is safe to import from any of the buffs modules.

import { spellCanonKey } from '../log/parser'
import { RECONNECT_WINDOW_MS } from '../log/sessionDetector'
import type { EntityDisposition } from '../combat/entityRules'

/** Land a pending cast this many ms after castBegin if nothing cleared it first. */
export const LAND_TIMEOUT_MS = 15_000

/**
 * Sanity ceiling on a mined duration sample. No EQ Legends buff lasts anywhere near this
 * long. A land→fade gap beyond this is DEFINITIONALLY a missed censor and is DROPPED.
 */
export const MAX_SAMPLE_MS = 3 * 60 * 60_000 // 3 hours

/**
 * LOG-HOLE boundary (Task #33, finding #5; re-read by JOS-134). An event-time gap ≥ this means
 * the character stopped producing log lines for half an hour, which is a claim about the LOG and
 * not yet a claim about the world.
 *
 * It used to be read as "logout/AFK past any buff duration" and wiped every live instance on the
 * spot. That is what made the ticket's defect: a hole is followed, 0-22 s later, by the reconnect
 * preamble and then `Welcome to EverQuest Legends!`, so the wipe always ran BEFORE the derived
 * `offlineGap` that explains it — and the buff EQ had frozen with your character was gone by the
 * time anything could pause it. So the hole now only OPENS a question (`BuffsModule` holds the
 * pre-hole buffs, unswept, and stops there); {@link LOGIN_CONFIRM_MS} is how long it waits for the
 * answer.
 */
export const SESSION_GAP_MS = 30 * 60_000 // 30 minutes

/**
 * How long a log hole waits to be explained by a login before it is ruled UNEXPLAINED and the
 * pre-hole buffs are dropped after all (JOS-134).
 *
 * It is deliberately the detector's OWN {@link RECONNECT_WINDOW_MS} rather than a second number:
 * that window is the measured span of the reconnect preamble (longest observed 22 s over all 19
 * logins in the real log — see sessionDetector.ts), and the two constants are answering the same
 * question from opposite ends. The detector looks BACK from the Welcome to find the last instant
 * the character was in the world; this looks FORWARD from the hole for the Welcome. Sharing the
 * constant is what makes it impossible for them to disagree about how long a preamble can be.
 */
export const LOGIN_CONFIRM_MS = RECONNECT_WINDOW_MS

/** Active-buff HYGIENE cap (Task #33, finding #6). An active past this auto-retires. */
const HYGIENE_ABSOLUTE_MS = 90 * 60_000 // 90 minutes when no/low stats
export function hygieneCapMs(p75: number | null, n: number): number {
  const stat = p75 != null && n >= 2 ? 2 * p75 : 0
  return Math.max(stat, HYGIENE_ABSOLUTE_MS)
}

/** Window after a castBegin within which a landing emote is attributed to that cast. */
export const EMOTE_WINDOW_MS = 5_000
/** How many times an emote TEXT must appear adjacent to a cast before it's TRUSTED. */
export const EMOTE_MIN_OBSERVATIONS = 2

/** Recency-weighted MAX window (Task #34): estimate = MAX over the most recent K samples. */
export const RECENT_SAMPLE_WINDOW = 5

/** The activated-AA name whose burst of self-buff landing messages is trusted confident. */
export const QUICK_BUFF = 'quick buff'
/** How long after a Quick Buff activation its burst applies are attributed to it. */
export const QUICK_BUFF_WINDOW_MS = 5_000

/**
 * OWN-CAST landing window (Task #45). A message-driven apply (buffApply) is attributed to the
 * player only when their OWN castBegin of that spell landed within this window before the
 * emote — mirrors the emote-mining window. Cast times run up to ~8s (Swift is 8s) plus the
 * short travel to the landing line, so a slightly generous window avoids dropping real
 * self/pet casts while still rejecting a stranger's buff (no own castBegin at all).
 */
export const OWN_CAST_WINDOW_MS = 10_000

/** The AA that makes self-cast illusion buffs PERMANENT (Task #34). */
export const PERMANENT_ILLUSION = 'permanent illusion'

/** The sentinel entity key for a buff on the PLAYER. */
export const SELF_KEY = 'self'
/** Instance-key separator  a NUL, which can never appear in a spell/entity name. */
const SEP = String.fromCharCode(0)

/** The instance key for a (spell, entity) pair — the buff-instance identity (Task #35). */
export function instanceKey(spellKeyOf: string, entityKey: string): string {
  return spellKeyOf + SEP + entityKey
}

/** Extract the entity key from an instance key. */
export function instanceEntityKey(iKey: string): string {
  const i = iKey.indexOf(SEP)
  return i >= 0 ? iKey.slice(i + 1) : SELF_KEY
}

/** A cast that has landed (produced a buff instance) and is awaiting its next fade. */
export interface OpenCast {
  spell: string
  /** rank-stripped spell key. */
  spellKey: string
  /** the entity this instance is on ('self' or a canonical name key). */
  entityKey: string
  landedTs: number
  /** The entity disposition this cast is bound to (for censoring on zone/death). */
  disp: EntityDisposition
  /**
   * True once an `offlineGap` has passed over this open cast — set for a BUFF and a DEBUFF
   * alike, which is the whole of JOS-134's learner rule. The instance itself survives; what is
   * refused is the SAMPLE, because neither half of the pair is a clean observation of a
   * duration once an absence sits inside it:
   *
   *   • A BUFF's clock was PAUSED (EQ freezes buffs with your character and resumes them at
   *     login — measured, see BuffInstances.onOfflinePause). Its land→fade span therefore
   *     contains frozen time that is not duration at all.
   *   • A DEBUFF's clock was NOT paused (the world kept running), so arithmetically its span
   *     IS world time. It is still refused, for a different reason stated separately because
   *     it is a different reason: the wear-off LINE only exists while you are logged in, so a
   *     fade that prints after an absence dates the moment you were there to SEE it, not the
   *     moment the spell ended. It is an upper bound on the expiry, not the expiry.
   *
   * Both errors point the same way — too LONG — and world-model law 5's estimator is a
   * recency-weighted MAX, chosen precisely because it is sensitive to over-long samples. And
   * neither is correctable: `offlineGap.fromTs` is documented as a LOWER bound on the absence
   * (up to 30 s of real in-world time is discarded with the reconnect preamble), so subtracting
   * the gap exactly is not something we are in a position to do — the subtraction would leave a
   * residue of up to 30 s in the same upward direction. CENSOR, never correct.
   */
  spannedGap?: boolean
}

/**
 * A cast in flight (You begin casting …) not yet confirmed landed or cleared.
 *
 * It DISPLAYS NOTHING (JOS-118 — see BuffInstances.beginCast). It is the cast-in-flight
 * bookkeeping the landing side consumes, and it is dropped by a fizzle, an interrupt, a fade of
 * the same spell, or the landing window elapsing with no confirmation.
 */
export interface Pending {
  spell: string
  key: string
  beganTs: number
  /** The landing emote's subject key ('self' or a name key), once its text is recognized. */
  emoteSubjectKey?: string
}

/** Per-spell accumulated duration samples + display name. */
export interface SpellSamples {
  spell: string
  samples: number[]
}

/** Canonical spell key (case-stable, RANK-STRIPPED). */
export function spellKey(s: string): string {
  return spellCanonKey(s)
}

/**
 * True when an un-catalogued line is SHAPED like a spell-landing flavor message (Task #36):
 * a short-ish sentence ending in a period, not a numeric/combat/system line. Used to feed
 * candidate landing messages the DB missed (e.g. Symbol of Pinzarn's real landing line,
 * whose wiki msg_cast_on_you is wrong) into the overlay miner. Deliberately permissive — the
 * miner's unambiguous-anchor + repeat-count rules reject coincidental pairings, so a
 * false candidate never earns a VERIFIED verdict.
 */
// Casting-system / UI feedback lines that are SELF-directed ("you"/"your") in shape but are
// never a spell-landing emote (they recur across every spell → pure noise). Rejected so a
// coincidental burst pairing can't verify them.
const CASTING_SYSTEM_RE =
  /can't use that command|regain your concentration|change your invocation|begin reciting|cannot see your target|Auto attack|mend your wounds|shimmers briefly|feels alive with power|begins casting|begin singing|You must|Insufficient|You do not|not ready yet|too far|out of range|You have entered|received any tells|cannot reply|mostly successful|has been overwritten|You forget |memoriz|You can(not| ?'?t)|Your target|Your spell|Your .* spell|You have finished|Beginning to|You are (?:no longer|now)|not enough|you cannot reply/i

/** The chat/combat/system markers that disqualify an otherwise landing-SHAPED line. */
function hasNonLandingMarker(text: string): boolean {
  if (text.includes("' told you") || text.includes(' tells ') || text.includes(' says')) return true
  if (text.includes(' by ') || text.includes(' from ')) return true
  if (text.includes(' spell ') || text.includes('attention')) return true // combat cast spam
  return CASTING_SYSTEM_RE.test(text)
}

/**
 * True when an un-catalogued line is plausibly a SELF spell-landing flavor message the DB
 * missed (Task #36) — the ONLY unknown-line class worth mining. It must be about the CASTER
 * (contain "you"/"your" or start with "You"/"Your"), a short sentence ending in a period,
 * with no numbers (damage/heal), no chat/tell/"by"/"from" markers, and not a casting-system
 * / UI line. This deliberately EXCLUDES third-person mob-subject lines ("a revenant
 * staggers.", "…spell is interrupted.") — those are combat spam that would poison the
 * overlay with coincidental burst pairings. Symbol of Pinzarn's real "The symbol of Pinzarn
 * flashes before your eyes." passes (it names "your eyes"); a mob effect line does not.
 */
export function looksLandingMessage(text: string): boolean {
  if (text.length < 6 || text.length > 90) return false
  if (!text.endsWith('.')) return false
  if (/\d/.test(text)) return false // damage/heal/point lines carry numbers
  // Must reference the caster — a genuine cast-on-YOU line is about the player.
  if (!/\byou\b|\byour\b/i.test(text)) return false
  return !hasNonLandingMarker(text)
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  if (sortedAsc.length === 1) return sortedAsc[0]
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  const frac = idx - lo
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac
}
