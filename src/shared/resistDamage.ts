// WHAT A DAMAGE HISTOGRAM MEANS — full, partial, or unreadable (JOS-385, defect 2).
//
// Pure, and split from resistModel.ts for the reason resistFormula.ts was: this is one subject
// (how to read the numbers the log printed) and the file next door is another (the likelihood over
// them), and the pair was over the repo's 400-code-line ceiling.
//
// ── THE DEFECT THIS FILE EXISTS TO FIX ──────────────────────────────────────────────────────────
//
// A direct-damage row's evidence is "how many casts landed for FULL damage and how many were
// silently reduced", and the first cut answered it with the histogram's LARGEST value: the max was
// full, everything below it was a partial. That is wrong on Live, and the owner found it on a
// thunder spirit princess.
//
// Live SPELL-DAMAGE FOCUS effects roll a RANDOM bonus per cast — the item says "increase spell
// damage by up to 34%" and the roll is uniform inside that band. So the largest value the log ever
// printed is a FOCUSED roll, not the spell's full damage, and every ordinary unfocused full hit
// sits below it and was being read as a partial. MEASURED on the owner's log, Discordant Mind's
// non-crit damage across all mobs: 423 hits at exactly 394 — the base — and then a thin spread of
// about 25 hits each at 449 through 528, which is 394 x 1.14 through 394 x 1.34. Against the
// princess specifically the row read "5 partial" where three of those five were 453, 471, 476 and
// 524: full hits with a focus roll on them.
//
// ── THE FIX, AND WHY THE MODE ───────────────────────────────────────────────────────────────────
//
// The full reference for a (spell, casterLevel) is the MODE of that spell's histogram pooled over
// EVERY MOB in the ledger, and a hit at or above `FULL_AT_LEAST` x mode is full. The mode is the
// right statistic and the max is not, because the base damage is the ONE value a spell can print
// without a roll on top of it: it is what an unfocused cast delivers every single time, so it is
// the tallest bar by construction, while the focus band spreads its own hits across thirty-odd
// values and the partial band spreads across a hundred more.
//
// POOLED OVER EVERY MOB, deliberately, and keyed by CASTER LEVEL. What a spell hits for is a fact
// about the spell and the caster, never about the target — a mob with four observations cannot
// establish its own reference and does not have to, because the same nuke has hundreds of hits
// elsewhere in the ledger. The level is in the key because a spell's damage genuinely moves with
// it: Scorching Arrow reads 214 at level 46, 233 at 47 and 239 from 48 up, which are the game's
// own tiers and not noise.
//
// ── AND WHEN THE HISTOGRAM CANNOT SAY ───────────────────────────────────────────────────────────
//
// Under `MODE_MIN_SHARE` the spell is treated as VARIABLE at that level: resist-or-not, no partial
// information at all. That is the existing law in resistModel.ts's header applied to a new case —
// misclassifying a fixed spell as variable merely throws information away, while the reverse reads
// ordinary low rolls as resistance and invents a resistant mob out of a damage range.
//
// IT FIRES ON REAL DATA AND THE CASE IS WORTH KNOWING (measured, same log): Discordant Mind at
// caster level 50 has the owner's damage focus on it, so the base 394 is only 6% of that level's
// histogram and the mode rule declines to name a reference. At levels 43 through 49 — before the
// focus — 394 is 78% to 93% of the histogram and the reference is unambiguous. So the fallback is
// not a theoretical branch: it is what a focus item looks like from here, and what it costs is the
// partial half of one level's evidence rather than a wrong answer.

import type { ResistRow, SpellResistInfo } from './resistTypes'

/**
 * A hit at or above this fraction of the reference is FULL damage.
 *
 * Three percent of slack rather than an exact compare, because the server rounds and a focus can
 * only ever push a hit UP: the band this admits below the mode is narrower than the smallest
 * partial the formula can produce (a partial is at least 1.5 x (rc - roll) / rc off the top, and
 * the resist message takes over before it gets close to 3%).
 */
export const FULL_AT_LEAST = 0.97

/**
 * The share of a (spell, level) histogram its most common value has to hold before that value is
 * believed as the spell's full damage. Under it, the histogram is not describing one number.
 */
export const MODE_MIN_SHARE = 0.4

/** The pooling key: a spell's damage is a fact about the spell and the caster, never the target. */
export function damageModeKey(spellKey: string, casterLevel: number | null): string {
  return `${spellKey}|${casterLevel ?? ''}`
}

/**
 * The full-damage reference per (spell, casterLevel), over every row handed in.
 *
 * PASS IT THE WHOLE LEDGER — `src/main/ipc/resist.ts` does, once per app run, exactly as it does
 * for the blindness verdict. Scoped to one mob it would answer from a handful of hits and would
 * find a "mode" in what is really a partial band.
 */
export function damageModes(rows: readonly ResistRow[]): Map<string, number> {
  const hist = new Map<string, Map<number, number>>()
  for (const row of rows) {
    const key = damageModeKey(row.spellKey, row.casterLevel)
    let h = hist.get(key)
    if (!h) {
      h = new Map()
      hist.set(key, h)
    }
    for (const [value, count] of Object.entries(row.dmg)) {
      const v = Number(value)
      h.set(v, (h.get(v) ?? 0) + count)
    }
  }
  const out = new Map<string, number>()
  for (const [key, h] of hist) {
    let total = 0
    let modeValue = 0
    let modeCount = 0
    for (const [value, count] of h) {
      total += count
      // Ties go to the LARGER value, which is the tie a base-plus-focus histogram can produce
      // between the base and one lucky focus roll, and the base is the one that repeats.
      if (count > modeCount || (count === modeCount && value > modeValue)) {
        modeCount = count
        modeValue = value
      }
    }
    if (total > 0 && modeCount / total >= MODE_MIN_SHARE) out.set(key, modeValue)
  }
  return out
}

/** One row's damage, split against the reference. `full` counts focused hits too. */
export function splitDamage(row: ResistRow, mode: number | undefined): { total: number; full: number; partial: number } {
  let total = 0
  let full = 0
  if (mode === undefined) {
    for (const count of Object.values(row.dmg)) total += count
    return { total, full: 0, partial: 0 }
  }
  const floor = mode * FULL_AT_LEAST
  for (const [value, count] of Object.entries(row.dmg)) {
    total += count
    if (Number(value) >= floor) full += count
  }
  return { total, full, partial: total - full }
}

/**
 * Fixed-damage spells expose partial information; variable ones do not.
 *
 * THREE WAYS TO BE VARIABLE, and each is a different thing the app does not know: the row gave up
 * on its own histogram (`variable`, past MAX_DISTINCT_DAMAGE_VALUES), the client's spell data shows
 * no hitpoint slot so this is not a damage spell in the modelled sense, or the pooled histogram has
 * no value tall enough to be a reference. The last one is new (JOS-385) and replaces a check on
 * this row alone — "the largest value is also the most common" — which a focus item breaks by
 * construction.
 */
export function damageKind(row: ResistRow, info: SpellResistInfo, mode: number | undefined): 'ddFix' | 'ddVar' {
  if (row.variable) return 'ddVar'
  if (!info.hpSlot) return 'ddVar'
  return mode === undefined ? 'ddVar' : 'ddFix'
}
