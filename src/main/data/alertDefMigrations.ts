// alertDefMigrations.ts — one-time rewrites of SHIPPED alert defs already sitting in a user's
// store, for the case where the app changed its mind about what a curated def should match.
//
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A SCHEMA MIGRATION. `storeMigrations.ts` owns
// changes to the SHAPE of the persisted file — every reader must see a shape it understands, so
// that chain is version-stamped, append-only and runs before anything reads the store. Nothing
// here changes a shape: `cooldownScope` is optional and absent means what it always meant. What
// changes is a VALUE the app once authored and now authors differently, and the only honest rule
// for that is "rewrite the copy the app wrote; never touch the copy the user wrote". That is
// exactly the rule `migrateAlertSounds` (data/defaultPacks.ts) already follows for retired sound
// packs, so this module follows its precedent to the letter: a pure function over the alert
// list, a separate integer stamp in the store, run once from `getAlerts()` and never again.
//
// THE INCIDENT (owner, 2026-08-04, verified twice against eqlog_Primitive_freeport.txt). The
// rogue-slow def matched `where:{effect:'slow'}` under ONE alert-wide 30 s cooldown. Two things
// were wrong with that, and both are silent failures — the alert says nothing and you cannot
// tell whether that is because nothing landed:
//
//   1. THE SIBLING SLOW WAS INVISIBLE. One utility coat can grant both slow Strikes (Paralytic
//      Poison → Weakening Strike + Clumsiness Strike), and Clumsiness lands as effect
//      'spellSlow' (`<mob>'s fingers slow down.`), which the def never matched. On Magus Rokyl
//      (22:03–22:04) four of five slow-family landings printed nothing.
//   2. THE GLOBAL CLOCK ATE THE FIRST SLOW ON A FRESH MOB. Weakening Strike landed on King
//      Tranix at 22:31:16 (fired) and on a fire giant warrior at 22:31:43 — 27 s later, so it
//      was SUPPRESSED, and the fire giant's slow was never announced. The player died at
//      22:33:40. A re-land on the mob you are already fighting must not silence the first slow
//      on the mob you just pulled.
//
// Today's def fixes both (shared/alertGroups.ts): the trigger covers both slow effects and the
// cooldown is scoped per target. A user who took the def from the group card or the offer before
// this has the OLD def in their store and would keep the old behaviour forever — hence the
// rewrite below.
//
// WHAT IT WILL NOT DO. It matches the old trigger EXACTLY, deep-equal. A user who edited the
// def — narrowed it, widened it, turned it into a composite, pointed it at another effect — has
// stated an intent, and this migration leaves that def completely alone. Everything the user
// chose about the def they did keep (sound, volume, cooldownMs, name, note, speech, enabled) is
// preserved verbatim; only the trigger and the cooldown SCOPE move.

import { POISON_SLOW_ALERT_ID, poisonSlowAlertDefs } from '../../shared/alertGroups'
import type { AlertDef, AlertTrigger } from '../../shared/types'

/**
 * Bumped when the rewrite below changes in a way that should run again for every user. It is
 * its own stamp, independent of ALERT_SOUND_MIGRATION_VERSION: the two migrations answer
 * different questions and a user can legitimately have had one and not the other.
 */
export const ALERT_TRIGGER_MIGRATION_VERSION = 1

/**
 * The trigger the rogue-slow def shipped with before 2026-08-04, spelled out as a literal.
 *
 * It is a literal on purpose and must never be re-derived from anything: it describes BYTES A
 * PAST BUILD WROTE, which are now fixed history. Sourcing it from the current def would make
 * the migration a tautology the day the def changes again.
 */
const LEGACY_POISON_SLOW_TRIGGER: AlertTrigger = {
  type: 'event',
  kind: 'poisonProc',
  where: { effect: 'slow' }
}

/** Structural equality for a trigger — key order in a stored JSON object is not meaningful. */
function sameTrigger(a: AlertTrigger, b: AlertTrigger): boolean {
  if ('conditions' in a || 'conditions' in b) return false
  if (a.type !== b.type) return false
  if (a.type !== 'event' || b.type !== 'event') return false
  if (a.kind !== b.kind) return false
  const aw = a.where ?? {}
  const bw = b.where ?? {}
  const keys = Object.keys(aw)
  if (keys.length !== Object.keys(bw).length) return false
  return keys.every((k) => aw[k] === bw[k])
}

/**
 * Rewrite the stored rogue-slow def onto today's shipped trigger + cooldown scope, when it is
 * still byte-for-byte the def the app authored. Returns the (possibly new) list plus how many
 * defs changed, so the caller can skip the store write when nothing moved — the same contract
 * `migrateAlertSounds` returns.
 */
export function migrateAlertTriggers(alerts: AlertDef[]): { alerts: AlertDef[]; changed: number } {
  const shipped = poisonSlowAlertDefs().find((d) => d.id === POISON_SLOW_ALERT_ID)
  if (!shipped) return { alerts, changed: 0 }
  let changed = 0
  const next = alerts.map((a) => {
    if (a.id !== POISON_SLOW_ALERT_ID) return a
    if (!sameTrigger(a.trigger, LEGACY_POISON_SLOW_TRIGGER)) return a
    changed++
    // cooldownMs is the user's (they may have retuned it); the trigger and the scope are ours.
    const migrated: AlertDef = { ...a, trigger: shipped.trigger }
    if (shipped.cooldownScope === undefined) delete migrated.cooldownScope
    else migrated.cooldownScope = shipped.cooldownScope
    return migrated
  })
  return { alerts: changed > 0 ? next : alerts, changed }
}
