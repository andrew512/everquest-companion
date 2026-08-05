// THE ACTIVE SPECIAL ATTACK — stateful lane attribution for the specials that print no verb
// of their own. Fixes user report 01KZ9AAQ4ES1R2NVYK0JJ68EBQ ("Dragon Punch DPS isn't tracked").
//
// THE PROBLEM, measured on the real log (1.35M lines, sweep 2026-08-05). EQ Legends' upgraded
// special attacks never announce themselves in the damage line. The game states the switch once:
//
//   [Tue Jul 28 22:07:16 2026] You will now use Eagle Strike instead of Tiger Claw while attacking.
//   [Wed Jul 29 14:54:14 2026] You will now use Dragon Punch instead of Eagle Strike while attacking.
//
// …and from then on every one of those specials lands as the GENERIC verb `strike`:
//
//   [Wed Jul 29 15:05:14 2026] You strike a frenzied ghoul for 32 points of damage. (Critical)
//   [Wed Jul 29 15:05:14 2026] You have become better at Dragon Punch! (84)
//
// The damage was always COUNTED — `meleeSkill('strike')` answers "Melee", so it folded into the
// anonymous melee lane and no Dragon Punch row could ever exist. This module supplies the
// missing half: the log's own statement of which special is live, joined to the swing by VERB.
//
// ── THE LANES, AND WHY EXACTLY THESE TWO ────────────────────────────────────────────────────
//
// A "lane" is one generic verb plus the chain of specials that print with it. The table below is
// HAND-AUTHORED AND EVIDENCE-VERIFIED (the shared/zones.ts precedent, world-model law 12): a
// name-matcher would happily invent lanes the log never demonstrated. Two lanes earned a row:
//
//   `strike` → Tiger Claw → Eagle Strike → Dragon Punch
//     The verb is EXCLUSIVE to the lane and the proof is a timestamp: the player's first-ever
//     `You strike …` line is [Tue Jul 28 16:09:17], THREE SECONDS after `You will now use Tiger
//     Claw while auto attacking.` at 16:09:14 — across nine prior days and hundreds of thousands
//     of swings he never once "struck". Base unarmed attacks print `hit`/`claw`/`punch` instead
//     (Hand to Hand skill-ups sit on those three, 130 of 141 distance-1 joins), and Eagle Strike
//     / Dragon Punch skill-ups are confined to their own eras (145/145 and 254/255).
//
//   `kick` → Kick → Round Kick → Flying Kick
//     Here the skill-up stream partitions PERFECTLY by era, which is as clean as this log gets:
//     Kick 296/296 ticks inside kick=Kick eras, Round Kick 190/190 inside kick=Round Kick,
//     Flying Kick 254/255 inside kick=Flying Kick. Not one tick of a displaced special. The
//     Aug 02 01:55 loadout swap is the control: its `Kick while auto attacking.` reset the lane
//     and the Flying Kick ticks stopped dead while Kick ticks resumed. Same bug as Dragon Punch,
//     one lane over — a Flying Kick monk's damage reads "Kick" today.
//
// ── THE LANE THAT DID *NOT* EARN A ROW (this is the point of measuring) ──────────────────────
//
// `You will now use Slam instead of Bash while attacking.` is a real state line and Slam NEVER
// prints a `slam` verb — self `slam` lines: ZERO in the whole log, against 39,900 `bash` lines.
// So the shield lane looks structurally identical to the two above, and the obvious move is to
// relabel `bash` swings "Slam" during a Slam era. THE EVIDENCE REFUSES IT: 185 `You have become
// better at Bash!` ticks fire DURING Slam eras (and there is no `better at Slam!` line anywhere
// — 0 occurrences), so those bash swings are demonstrably still driving the Bash skill. Whatever
// Slam is here, it is not a thing that displaces Bash the way Dragon Punch displaces Eagle
// Strike. The `specialAttack` EVENT is still parsed and recorded for it; the lane label is not
// claimed. A documented non-distinguishable (law 6) beats a plausible guess.
//
// ── WHAT THIS MODULE DELIBERATELY DOES NOT USE ──────────────────────────────────────────────
//
// SKILL-UPS ARE NOT AN INPUT. They corroborated the table above during the sweep and that is all
// they are good for: `You have become better at Tiger Claw!` keeps ticking 111 times after Tiger
// Claw was replaced, on a ~6-minute drip whose lines sit beside heals and DoT ticks with no
// swing anywhere near them. Inferring the live special from skill-ups would therefore have
// relabelled Dragon Punch swings "Tiger Claw". State comes from the state line (law 1).
//
// PRE-STATE IS HONEST BY OMISSION. Until a `You will now use` line has been seen for a lane,
// this module returns nothing and the parser's ordinary `meleeSkill()` answer stands — "Melee"
// for a strike, "Kick" for a kick. It never seeds a lane from the table's first entry, so it
// cannot claim a special the log has not stated the character has.
//
// SELF ONLY. The state line has no third-person grammar (a full-log sweep found zero `now use`
// lines that are not `You will now use`), so nothing here can ever be known about a mob, a pet
// or another player. The caller gates on the attacker being You; this module could not label
// anyone else even if it wanted to.

import type { SpecialAttackEvent } from '../../shared/logEvents'

/**
 * verb → the ordered chain of specials that print with it. See the header for the measurements
 * behind each row and for the shield lane that is deliberately absent. Order is the observed
 * progression; nothing reads it as an ordering today, and NOTHING may use it to guess the next
 * special — membership is the whole contract.
 */
const LANES: Readonly<Record<string, readonly string[]>> = {
  strike: ['Tiger Claw', 'Eagle Strike', 'Dragon Punch'],
  kick: ['Kick', 'Round Kick', 'Flying Kick']
}

/** canonical skill name → its verb lane, derived once from LANES. */
const LANE_OF_SKILL = new Map<string, string>(
  Object.entries(LANES).flatMap(([verb, skills]) => skills.map((s) => [s.toLowerCase(), verb] as const))
)

/** The verb lane a special attack belongs to, or undefined for one we have no evidence about. */
export function laneOfSpecial(skill: string): string | undefined {
  return LANE_OF_SKILL.get(skill.trim().toLowerCase())
}

/** Every lane's verb, for tests and for the tripwire that pins the table against MELEE_VERBS. */
export function specialLaneVerbs(): string[] {
  return Object.keys(LANES)
}

/**
 * WHICH SPECIAL IS LIVE IN EACH LANE, per character.
 *
 * Character-scoped state, exactly like the pet sets beside it: `reset()` runs on a character
 * switch and on an epoch boundary (a rebirth's specials are the beta character's, not this
 * one's). It deliberately SURVIVES zoning — the log proves the switch does too, since the state
 * line is printed once and the lane stays put across hundreds of zone lines afterwards.
 *
 * Because the whole state is rebuilt from the log itself, the startup replay populates it before
 * the live tail takes over, so a hydrated meter labels its lanes exactly as a live one does.
 */
export class SpecialAttacks {
  /** verb lane → the special the log last SAID was active there. */
  private readonly active = new Map<string, string>()

  /**
   * Fold one `You will now use …` line in. Returns the lane it moved, or undefined when the
   * named special belongs to no lane we have evidence for (Smite, Backstab, Frenzy — which print
   * their own verb and need no attribution — and Bash/Slam, see the header).
   *
   * `replaces` is NOT consulted. It is captured on the event for provenance, but using it to
   * infer a lane would be exactly the guess this module refuses: the bare grant form carries no
   * `replaces` at all, so a `replaces`-driven model would be blind to the one shape that RESETS
   * a lane (the Aug 02 `Kick while auto attacking.`).
   */
  note(ev: SpecialAttackEvent): string | undefined {
    const lane = laneOfSpecial(ev.skill)
    if (lane === undefined) return undefined
    this.active.set(lane, ev.skill.trim())
    return lane
  }

  /**
   * The lane label for a swing that printed `verb`, or undefined to leave the parser's ordinary
   * skill name alone. Undefined is the answer for every verb with no lane AND for a lane the log
   * has not yet spoken about.
   */
  laneSkill(verb: string | undefined): string | undefined {
    return verb === undefined ? undefined : this.active.get(verb)
  }

  /** Snapshot of the live lanes (verb → special), for tests and diagnostics. */
  entries(): [string, string][] {
    return [...this.active.entries()]
  }

  reset(): void {
    this.active.clear()
  }
}
