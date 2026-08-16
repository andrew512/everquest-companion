// THE GAME'S OWN RESIST FORMULA, forward (JOS-382; split out of resistModel.ts by JOS-385).
//
// Pure, and DEPENDENCY-FREE except for the axis vocabulary. Everything here is a statement about
// what the SERVER does with a roll; nothing here fits anything. The estimator that inverts it lives
// next door in `resistModel.ts`, and the split is along that seam rather than along file size: this
// half can be read, checked against Torven's tables and argued about without knowing what a profile
// likelihood is, and the other half changes when our statistics change rather than when the game
// does.
//
// (The proximate cause was JOS-385 pushing resistModel.ts past the repo's 400-code-line ceiling.
// The rule there is SPLIT, never ratchet — and a file that had grown two subjects was the reason it
// crossed at all.)
//
// ---------------------------------------------------------------------------------------------
// THE MODEL, in one block (Torven's data analysis + Prathun's leaked pseudocode, as reproduced in
// EQEmu's `Mob::ResistSpell`; Legends runs the Live client/server, so this is the model until the
// log contradicts it — and section 3 of docs/plans/resist-mining.md is the measurement that says it
// does not):
//
//     d        = mobLevel - casterLevel, clamped to >= -9;  d >= 21 => the mob is IMMUNE
//     levelMod = sign(d) * d^2 / 2
//     rc       = R[axis] + levelMod + spell.resistAdj - debuff
//     roll     = 1..200, uniform
//
//   ALL-OR-NOTHING (mez, root, snare, slow, charm, DoTs, debuffs, and every bard song pulse):
//     lands iff roll > rc.                       P(resist) = rc/200
//   DIRECT DAMAGE:
//     roll > rc            -> full damage        P(full)   = (200 - rc)/200
//     roll <= rc/3         -> the resist MESSAGE P(resist) = rc/600
//     in between           -> a SILENT partial, `100 - 150*(rc-roll)/rc` percent of full
//
// So rc >= 200 means nothing all-or-nothing can ever land, and rc >= 600 means even a nuke is
// immune — which is why lures carry -300/-1000 resist adjusts.

import type { ResistAxis, ResistTag } from './resistTypes'

/** A mob this many levels above the caster is immune, whatever its resist stat is. */
export const IMMUNE_LEVEL_GAP = 21
/** What `levelMod` reports for that case: large enough that no R can rescue the roll. */
export const IMMUNE_LEVEL_MOD = 1000

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * `levelMod = sign(d) * d^2 / 2`, d clamped at -9 below and answering IMMUNE at +21.
 * Integer arithmetic, because the server's is.
 */
export function levelMod(casterLevel: number, mobLevel: number): number {
  const raw = mobLevel - casterLevel
  if (raw >= IMMUNE_LEVEL_GAP) return IMMUNE_LEVEL_MOD
  const d = raw < -9 ? -9 : raw
  const mag = Math.trunc((d * d) / 2)
  return d < 0 ? -mag : mag
}

/**
 * A SPELL WITH A RESIST ADJUST BELOW THIS CANNOT BE RESISTED, so watching it land says nothing
 * about the mob (JOS-385, defect 2's sibling — the owner found both on one card).
 *
 * `rc = R + levelMod + resistAdj`, and a resist needs `roll <= rc` out of 1..200. At -250 the mob
 * would need R above about 250 before a single roll could catch it, which is past the top of the
 * tag scale — so a proc's 87 unresisted casts are not 87 pieces of evidence that the mob is weak,
 * they are one sentence: "R is not enormous". Its likelihood is flat across almost the whole grid.
 *
 * -100 IS THE LINE, and it is drawn where the log's own spells fall rather than at a round number
 * that happens to be tidy. This app's procs run -150 (Divine Might Strike), -200 (Lifetap Strike)
 * and -250 (Smiting Strike); lures run -300 to -1000; ordinary nukes and every all-or-nothing
 * spell run 0. Nothing in the owner's two-million-line log sits between -100 and -150, so the
 * threshold separates the two populations without cutting through either.
 *
 * WHAT IT CHANGES IS WHAT IS SHOWN, NOT WHAT IS FITTED. Those observations still enter the
 * likelihood — "R is not enormous" is true and worth having — but they no longer inflate the count
 * a player reads, no longer suppress the low-samples caveat, and no longer head the evidence list.
 * A card that said `n=83` off 83 casts that could never have been resisted was overstating what it
 * knew by an order of magnitude.
 */
export const INFORMATIVE_RESIST_ADJ = -100

/** Could this spell have been resisted at all? See `INFORMATIVE_RESIST_ADJ`. */
export function isInformativeSpell(resistAdj: number): boolean {
  return resistAdj > INFORMATIVE_RESIST_ADJ
}

/** Torven's typical NPC resist for an axis at a level. The prior, and nothing else. */
export function priorResist(axis: ResistAxis, mobLevel: number | null): number {
  if (axis === 'poison' || axis === 'disease') return 15
  return (mobLevel ?? 40) >= 25 ? 35 : 25
}

/** P(the all-or-nothing spell is resisted) at this rc. Songs use this too. */
export function pResistAon(rc: number): number {
  return clamp(rc, 0, 200) / 200
}

/** P(the game prints the resist message) for a damage spell at this rc. */
export function pResistMessage(rc: number): number {
  return clamp(rc, 0, 600) / 600
}

/** P(full, unreduced damage) at this rc. */
export function pFullDamage(rc: number): number {
  return (200 - clamp(rc, 0, 200)) / 200
}

/**
 * The whole model, forward. `kind: 'aon'` covers every all-or-nothing spell and every song pulse;
 * `kind: 'dd'` covers direct damage. Shipped tested but not yet surfaced — the con-tooltip
 * follow-up is what consumes it.
 */
export function predict(input: {
  R: number
  casterLevel: number
  mobLevel: number
  resistAdj: number
  debuff?: number
  kind: 'aon' | 'dd'
}): { pLand: number; pFull?: number; pResistMsg: number; expectedDmgFrac?: number } {
  const lm = levelMod(input.casterLevel, input.mobLevel)
  if (lm === IMMUNE_LEVEL_MOD) {
    return input.kind === 'aon'
      ? { pLand: 0, pResistMsg: 1 }
      : { pLand: 0, pFull: 0, pResistMsg: 1, expectedDmgFrac: 0 }
  }
  const rc = input.R + lm + input.resistAdj - (input.debuff ?? 0)
  if (input.kind === 'aon') {
    const pr = pResistAon(rc)
    return { pLand: 1 - pr, pResistMsg: pr }
  }
  const full = pFullDamage(rc)
  const msg = pResistMessage(rc)
  return {
    pLand: 1 - msg,
    pFull: full,
    pResistMsg: msg,
    expectedDmgFrac: expectedDamageFraction(rc),
  }
}

/**
 * Mean fraction of full damage a cast delivers at this rc, averaged over the 200 rolls. The
 * resist message is a 0; a partial delivers `1 - 1.5*(rc-roll)/rc`.
 */
export function expectedDamageFraction(rc: number): number {
  if (rc <= 0) return 1
  let sum = 0
  for (let roll = 1; roll <= 200; roll++) {
    if (roll > rc) {
      sum += 1
      continue
    }
    const frac = 1 - (1.5 * (rc - roll)) / rc
    if (frac > 0) sum += frac
  }
  return sum / 200
}

/**
 * The plain-language tag, anchored on the rc arithmetic above (evaluated at an even-level cast of
 * an unadjusted spell, which is the only reading of R that does not need a caster to talk about):
 *
 *   weak            R < 10    under 5% of all-or-nothing casts resisted
 *   normal          R < 45    spans every Torven baseline (15 / 25 / 35); up to ~22% resisted
 *   resistant       R < 100   22% to 50% resisted
 *   very resistant  R < 200   50% to 100% resisted; nukes still land reduced
 *   nearly immune   R >= 200  rc >= 200: nothing all-or-nothing lands at all, and only the
 *                             partial-damage band is left until rc >= 600 closes that too
 */
export function resistTag(R: number): ResistTag {
  if (R < 10) return 'weak'
  if (R < 45) return 'normal'
  if (R < 100) return 'resistant'
  if (R < 200) return 'very resistant'
  return 'nearly immune'
}
