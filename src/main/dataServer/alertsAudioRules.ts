// ============================================================================
// alertsAudioRules.ts — THE AUDIO CUTOVER'S DECISIONS, WITH NO WORLD ATTACHED (JOS-491).
// ============================================================================
//
// `alertsAudio.ts` is the world: the two environment flags, the store read, the alerts module, the
// dev log. This is everything it has to DECIDE, split out for `readShim.ts`'s reason exactly — the
// decisions are the part that can be wrong in a way nobody notices, and a pure file is the only
// kind a `node:test` process can load at all (the wired half imports `pipeline.ts`, which imports
// Electron). Three functions, no state, no clock, no I/O.

import { normalizeEarlyWarnSec } from '../../shared/earlyWarning'
import type { FireMessage } from '../../shared/dataServer/protocol.generated'
import type { AlertDef, FiredAlert } from '../../shared/types'

/**
 * THE GATE — the first def whose fire the ENGINE would swallow, or null when there is none.
 *
 * A def carrying `earlyWarnSec` does not sound when its trigger matches: the match ARMS a warning
 * that speaks N seconds before a timer row's estimated end (JOS-216), which needs the wall-clock
 * heartbeat and the buffs/buffTimers projection. The engine has neither, so it COMPILES SUCH A DEF
 * OUT (`fold/src/modules/alerts_rules.rs Rule::compile`) rather than firing it at the wrong
 * instant. Arming the cutover over one would therefore trade a correctly-delayed sound for NO
 * SOUND AT ALL, silently — so the flag refuses instead.
 *
 * IT ASKS `normalizeEarlyWarnSec`, THE APP'S OWN NORMALIZER, rather than testing for the key. A
 * value this app would not act on (a zero, a NaN, a string — `ipc/alerts.ts sanitizeEarlyWarn`
 * deletes those on save, but a def imported from a stranger's share bundle has not been through
 * that door) arms nothing here either, so refusing on it would be a false alarm no edit could
 * clear. Anything the app WOULD act on refuses, and that deliberately includes the out-of-range
 * number the app clamps into range while the engine's own reader treats it as absent — the
 * conservative direction on the one input where the two normalizers disagree.
 *
 * FIRST MATCH, NOT ALL OF THEM: one name is what makes the line actionable, and a list would
 * invite reading it as a report rather than as a stop.
 */
export function earlyWarnBlocker(defs: readonly AlertDef[]): AlertDef | null {
  return defs.find((d) => normalizeEarlyWarnSec(d.earlyWarnSec) !== undefined) ?? null
}

/** Whether the cutover arms, and the ONE line the dev log gets either way. */
export interface ArmVerdict {
  readonly arm: boolean
  /** Present tense, no prefix — `alertsAudio.ts` adds the app's own tag. Never empty: a refusal
   *  that said nothing would be indistinguishable from a flag nobody set. */
  readonly line: string
}

/**
 * ARM, OR REFUSE AND NAME THE DEF.
 *
 * The whole decision is here — including the SENTENCE — because "it refuses with one honest line
 * naming the def" is the acceptance bar, and a bar written in a `logInfo` call inside a wired file
 * is a bar no test can hold. The caller's job reduces to printing this and throwing the switch.
 */
export function armVerdict(defs: readonly AlertDef[]): ArmVerdict {
  const blocker = earlyWarnBlocker(defs)
  if (blocker !== null) {
    return {
      arm: false,
      line:
        'data-server alerts: EQC_ENGINE_ALERTS refuses to arm — ' +
        `"${blocker.name}" (${blocker.id}) carries earlyWarnSec=${String(blocker.earlyWarnSec)}, ` +
        'and the engine compiles early-warning defs out; the app keeps making its own sounds'
    }
  }
  return {
    arm: true,
    line: 'data-server alerts: the ENGINE now plays alert audio; this process’s evaluator is silent'
  }
}

/**
 * THE FRAME, AS A FIRING — so which def a fire belongs to is a question with a test rather than a
 * behaviour discovered in a raid.
 *
 * A FIRE NAMES ITS RULE BY LABEL, NOT BY ID (`FireMessage.rule` is `AlertDefinition.name`), and the
 * app needs the id: the renderer's player looks the def up by `alertId` to find its volume, its
 * audio channel and its phrase. So the label is resolved back, and the two honest hazards are
 * handled rather than assumed away:
 *
 *   * NOTHING ANSWERS TO IT — a def deleted between the push and the fire. Null, and the caller
 *     says so. Playing "some alert" would be worse than the silence.
 *   * TWO THINGS ANSWER TO IT — nothing stops a user naming two alerts the same. The `sound` key
 *     (`<packId>/<soundId>`, the second fully-resolved field of the frame) narrows first, because
 *     it is a fact the ENGINE stated about the def it fired rather than a guess made here. If that
 *     still does not separate them the FIRST is taken: two defs answering to one name with one
 *     sound would make the same noise, so what is left to get wrong is a volume — and a sound at
 *     the wrong volume beats no sound at all.
 *
 * MATCHING IS EXACT AND CASE-SENSITIVE. The label round-tripped through the engine verbatim (the
 * define pushes the store's own object and the fold republishes it), so any folding here would be
 * this file inventing a tolerance the wire does not need.
 *
 * WHAT IT CANNOT CARRY, and does not invent: the JOS-103 named captures, the JOS-353 `{target}`
 * token and the JOS-84 resolved spell name are not fields of a fire frame, so a `custom` phrase's
 * tokens resolve to nothing under this flag and the `spellName` speech modes fall back to the
 * alert's own name — exactly as they already do for a Test or an app signal (shared/speechText.ts).
 * Re-deriving any of them here would be a second evaluator wearing the engine's clothes.
 */
export function fireToFiring(fire: FireMessage, defs: readonly AlertDef[]): FiredAlert | null {
  const named = defs.filter((d) => d.name === fire.rule)
  if (named.length === 0) return null
  const narrowed =
    named.length === 1
      ? named
      : named.filter((d) => `${d.sound.packId}/${d.sound.soundId}` === fire.sound)
  const def = narrowed[0] ?? named[0]
  // `at` is the LOG's own clock (schema: "never the host's wall clock"), which is exactly what
  // `FiredAlert.ts` has always carried for a main-side fire — so nothing downstream has to know
  // which world timed it.
  return { alertId: def.id, ts: fire.at, matchedText: fire.message }
}
