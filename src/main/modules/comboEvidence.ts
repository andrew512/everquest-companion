// EVIDENCE INTAKE for the class-combo model (docs/plans/class-combo-inference.md § 2 / § 4.2).
//
// PURE: one LogEvent in, at most one ClassObservation out, plus the two committed tables it
// looks classes up in. No Electron, no state — the module shell (combo.ts) owns the ring and
// the one bit of context this needs (when an item last fired).
//
// THE TABLES ARE NOT INTERCHANGEABLE, and that is the single most load-bearing rule in this
// file. Wave 2 measured that `Frenzy`, `Smite` and `Feign Death` are BOTH client skill names
// AND Template:Spellpage spell names with DIFFERENT class sets (Frenzy: a BER skill, a SHM/BST
// spell; Feign Death: a MNK skill, a NEC/SHD spell) — so:
//   * a `skillUp` resolves against classes.json `skills`, and ONLY that,
//   * a `castBegin` resolves against spells.json (then classes.json `abilities`), and ONLY that.
// Unioning them would hand MNK's Feign Death skill-ups to NEC and SHD and quietly destroy the
// one signal that dates the Aug 2 swap. classes.json's `disputed[]` records all three rows.
//
// THERE IS NO CLICKY SUPPRESSION HERE ANY MORE, AND ITS REMOVAL IS THE JOS-79 FIX.
//
// Wave 3 read `Your <item> shimmers briefly.` / `… feels alive with power.` as "an item just
// cast the spell on the next line", and dropped any `castBegin` landing within 2.5 s after one.
// MEASURED WHOLE-LOG (1,433,047 lines, 2026-08-06), that reading is WRONG, and it was throwing
// away 7,452 of the player's 16,857 own casts — 44.2% of all cast evidence:
//
//   * FIVE items print the line in this log, and every one of them is a FOCUS item in the
//     committed catalog: Djarn's Amethyst Ring = Spell Haste II, Idol of the Underking =
//     Improved Healing III, Polished Mithril Mask = Improved Damage II, Golden Efreeti Boots =
//     Enhancement Haste II (Brell's Girdle, 6 lines, is not in the catalog). A focus effect is
//     WORN — it announces itself when it modifies a spell YOU are casting. None of the five
//     casts anything.
//   * A CLICKY CASTS ONE SPELL. Djarn's ring precedes 7,033 casts spanning the player's whole
//     spellbook era by era — Superior Healing, Greater Healing, Shiftless Deeds, Discordant
//     Mind, Mesmerization, Garrison's Mighty Mana Shock — which no single item effect can be.
//   * AND MOST OF THEM PRECEDE NO CAST AT ALL. Idol of the Underking fires 2,408 times and has
//     a `You begin casting` within 2.5 s on 48 of them (2.0%); Polished Mithril Mask, 1,281
//     times and 25 (2.0%). Both are heal/damage focuses: they fire when the spell LANDS, after
//     the cast the old rule blamed them for. An item that cast a spell would print one every
//     time.
//
// The cost of the wrong reading was total for one class: WIZ had ZERO observations in the whole
// log, because this player's wizard nukes are cast under Spell Haste II and the ring shimmers
// in the same second as every one of them. 824 wizard-exclusive observations on Aug 06 alone
// were being discarded, which is why the app could not see a PAL/WIZ/DRU loadout at all.
//
// The wave-1 measurement that motivated the rule still stands and is simply not what the rule
// was doing: after the Aug 2 swap ENC keeps seven exclusive labels (illusions, Rampage I) fired
// by items that announce NOTHING. Those survived the suppression too — what rejects them is the
// admission ranking in comboScore.ts, and CW4 pins exactly that with the rule gone.
//
// `itemActivate` stays a parsed event (it keeps 7,921 lines out of `unknown` and out of the
// spell-emote miner); it is simply not evidence about the player's classes, in either
// direction. A real self-announcing clicky would need its own observed sample before any rule
// here may act on one (the awaiting-sample law).

import classesJson from '../data/classes.json'
import { classesForSpell } from '../data/spellClasses'
import { spellCanonKey } from '../log/parseCommon'
import type { LogEvent } from '../../shared/logEvents'
import { isClassAbbr, type ClassAbbr, type ClassObservation } from '../../shared/classCombo'

/**
 * Source weights (§ 4.2). `who` is absent on purpose: a `/who` row is not scored, it OVERRIDES
 * (§ 4.4). The ordering encodes how much each family can lie — a poison coat is ROG by game
 * design, a stance/skill is class-gated by the client, an invocation is class-gated but three
 * of the nine span twelve classes and the wiki contradicts itself on two rows, and a cast is
 * the weakest of all (items cast, charmed pets cast, volume overwhelms truth).
 */
export const SOURCE_WEIGHT = {
  who: 0,
  poisonCoat: 3,
  stance: 2.5,
  skillUp: 2.5,
  invocation: 1.5,
  cast: 1
} as const

/** classes.json list → the closed ClassAbbr set. An unknown code is dropped, never coerced. */
function abbrs(list: readonly string[] | undefined): ClassAbbr[] {
  return list === undefined ? [] : list.filter(isClassAbbr)
}

const STANCES: Record<string, string[]> = classesJson.stances
const INVOCATIONS: Record<string, string[]> = classesJson.invocations
const SKILLS: Record<string, string[]> = classesJson.skills

/**
 * Abilities that are NOT Template:Spellpage pages — `Lay on Hands`, `Holy Steed`, `Harm Touch`,
 * 76 of them. They print an ordinary `You begin casting …` line, so without this table the 441
 * Lay on Hands casts in the real log (the strongest PAL signal there is) resolve to nothing.
 * Keyed by spellCanonKey because casts carry a Roman rank the table does not.
 */
const ABILITIES: ReadonlyMap<string, ClassAbbr[]> = new Map(
  Object.entries(classesJson.abilities as Record<string, string[]>).map(([name, list]) => [
    spellCanonKey(name),
    abbrs(list)
  ])
)

/** A trailing Roman rank, stripped for DISPLAY (spellCanonKey does the same, lowercased). */
const RANK_TAIL_RE = / (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/

/**
 * The classes that can cast `spell`. spells.json FIRST (it is the authority on anything that
 * has a spell page, and its class list is per-rank-family), then the ability table. Never a
 * union: where both know a name they agree, and where they disagree the spell page wins.
 */
function castCandidates(spell: string): ClassAbbr[] {
  const fromDb = classesForSpell(spell)
  if (fromDb.length > 0) return fromDb
  return ABILITIES.get(spellCanonKey(spell)) ?? []
}

/** One observation, or null when the event says nothing about class. */
function make(
  ev: LogEvent,
  source: ClassObservation['source'],
  label: string,
  candidates: ClassAbbr[]
): ClassObservation | null {
  if (candidates.length === 0) return null
  return {
    ts: ev.ts,
    seq: ev.seq,
    source,
    label,
    candidates: [...new Set(candidates)].sort(),
    weight: SOURCE_WEIGHT[source]
  }
}

/**
 * Turn one event into class evidence. Context-free — every input it needs is on the event, and
 * that is what keeps it pure (and what the header's measurement bought back: the one piece of
 * context it used to take was the last item activation, which turned out to say nothing).
 */
export function classObservation(ev: LogEvent): ClassObservation | null {
  switch (ev.kind) {
    case 'selfWho':
      return make(ev, 'who', 'who', ev.classes.filter(isClassAbbr))
    case 'stanceChange':
      return make(ev, 'stance', ev.stance, abbrs(STANCES[ev.stance]))
    case 'invocationChange':
      return make(ev, 'invocation', ev.invocation, abbrs(INVOCATIONS[ev.invocation]))
    case 'skillUp':
      // `skills` ONLY — see the header. An unlisted skill (every `Specialize <school>`, which
      // the wiki carries as one "Specialization" row) yields nothing rather than a guess.
      return make(ev, 'skillUp', ev.skill, abbrs(SKILLS[ev.skill]))
    case 'poisonCoat':
      // eqlwiki Disciplines: "only Rogue poison disciplines are on Legends". Somebody ELSE's
      // blades (the third-person shapes) say nothing about this character.
      return ev.who === 'you' ? make(ev, 'poisonCoat', ev.poison, ['ROG']) : null
    case 'castBegin':
      return make(ev, 'cast', ev.spell.replace(RANK_TAIL_RE, '').trim(), castCandidates(ev.spell))
    default:
      return null
  }
}
