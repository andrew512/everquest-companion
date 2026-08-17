// conCardRows — WHAT THE CON CARD ACTUALLY PUTS ON SCREEN: which resist chips survive (JOS-383,
// narrowed by JOS-386, narrowed again by JOS-390).
//
// PURE, and imported by relative path in the tests, because this repo has no jsdom: the rules are
// unit-tested here (`tests/conCard.test.mts`) and the JSX is asserted by the e2e against the real
// app. Same split as `features/resists/resistRow.ts` and `features/mobs/dropEra.ts`.
//
// IT USED TO RANK THE DROPS TOO, and that half is GONE rather than moved (JOS-390, owner ruling
// 2026-08-16): the card is the mob's header, its resist chips, and the click that opens the mob
// page — where the drop table, the fold over `+N` variants and the perceived rate already live and
// always did (`features/mobs/MobDropsSection.tsx` over `seenVariants.ts`). Deleting the card's copy
// is the point: two rankings of one drop table is exactly the drift this file's old header warned
// about, and the surviving one is the surface with room to explain itself.

import type { ConCardChip } from '@shared/conCard'
import type { ResistTag } from '@shared/resistTypes'

// ---- the resist chips the card keeps (JOS-386) -------------------------------------------

/**
 * THE CARD SAYS WHAT THE THING RESISTS, AND NOTHING ELSE (owner ruling, 2026-08-16).
 *
 * JOS-383 shipped five chips, always, in one fixed order, and the argument for that was a good one:
 * an axis that is simply MISSING says neither "we have not seen fire cast on this" nor "fire is
 * fine", and a reader cannot tell which. That argument still stands where it was made — THE MOB
 * PAGE STILL SHOWS ALL FIVE ROWS, every time, and it is one click away.
 *
 * What it does not survive is this surface. This is a card you read in the two seconds before you
 * pull, over the game, and four of its five chips routinely say "this is ordinary" — which is the
 * answer you would have assumed without reading anything. Every one of them costs a line of window
 * that has to be composited over a running game, and (the reason this ticket exists at all) height
 * that the window now literally wears. So the card keeps the axes where the answer would CHANGE
 * WHAT YOU CAST, and the card's own empty state carries the rest of the meaning.
 *
 * THE CUT IS THE BENCHMARK'S OWN BOUNDARY (JOS-387, which re-derived the same four words from a
 * viewer-relative benchmark instead of from a band of R). The two words that change what you cast
 * stay; `weak` and `normal` — the band whose guidance sentence is `should land` — leave. Reusing
 * the tag is what keeps the card and the page from disagreeing about what `resistant` means, the
 * same reason the chip's colour and word are imported rather than spelled twice.
 */
export const CON_CARD_NOTABLE_TAGS: readonly ResistTag[] = ['resistant', 'very resistant']

/**
 * A chip that survived the cut, and WHY it survived.
 *
 *   `benchmark`   the model answered and its band is one of the two above.
 *   `resistRate`  the fit did not fit (`pinned`) and the raw observations carried the chip instead:
 *                 at least half of the informative casts were resisted. A creature that resists
 *                 half of everything must not vanish from the card because the estimator could not
 *                 name a number for it — that is the Eye of Veeshan defect, and it is exactly the
 *                 case where a player most wants the warning.
 */
export interface ConCardNotableChip extends ConCardChip {
  from: 'benchmark' | 'resistRate'
}

/** At or above this observed resist rate, a pinned cell earns a chip off the data alone. */
export const RESIST_RATE_NOTABLE_AT = 0.5

/**
 * The chips the card draws, in the order they arrived (RESIST_AXES order — magic, fire, cold,
 * poison, disease — so the survivors still read left to right the way the page lists them).
 *
 * AN EMPTY CELL IS DROPPED TOO, and that is the same ruling rather than a second one: `n = 0` is a
 * chip that says "no data", and a card that answers a question you asked about a mob with five
 * shrugs is the emptiest version of the thing this cut is about. The page still says it.
 *
 * A LOW-SAMPLE RESISTANT AXIS SURVIVES, with its existing caveat. The ruling is about axes that do
 * not matter, never about withholding an answer that does — that is JOS-382's law and it is not
 * touched here: a resistant cell standing on three observations is exactly the case where the wide
 * interval and the `low samples` note are the honest display.
 */
export function notableChips(chips: readonly ConCardChip[]): ConCardNotableChip[] {
  const out: ConCardNotableChip[] = []
  for (const c of chips) {
    // `nTotal`, not `n` (JOS-385): the question here is "has anything ever been observed on this
    // axis", and `n` is now the narrower count of casts that could have been RESISTED. An axis
    // whose every cast was a -250 proc has been observed plenty; what it lacks is evidence, which
    // is what the `low samples` caveat on the surviving chip says.
    if (c.nTotal <= 0) continue
    if (c.pinned) {
      const { total, resisted } = c.empirical
      if (total > 0 && resisted / total >= RESIST_RATE_NOTABLE_AT) out.push({ ...c, from: 'resistRate' })
      continue
    }
    if (c.tag !== null && c.fit !== null && CON_CARD_NOTABLE_TAGS.includes(c.tag)) {
      out.push({ ...c, from: 'benchmark' })
    }
  }
  return out
}

/**
 * How many observations the whole profile is standing on — what the card's empty state says after
 * "no notable resists", so "we looked and there is nothing to flag" can be told from "we have never
 * seen a spell land on this". Zero is a real and different answer, and it prints as one.
 */
export function conCardTotalN(chips: readonly ConCardChip[]): number {
  // `nTotal` for the same reason `notableChips` reads it: this sentence is about what the app has
  // SEEN, and a cast that could not have been resisted was still seen (JOS-385).
  return chips.reduce((sum, c) => sum + (Number.isFinite(c.nTotal) ? c.nTotal : 0), 0)
}

/**
 * WHAT THE CARD SAYS ABOUT ITSELF, in the header, when a click will open the mob page.
 *
 * ONE string, here rather than inline in the JSX, because it is said in two places at once: it is
 * the name's own hint AND the body's native `title`, and a card that promised two different things
 * in one hover would be the acronym problem wearing different clothes. It is deliberately a
 * DESTINATION rather than an instruction ("Open in the app", never "click to open"): the repo's UI
 * law is state, never process.
 */
export const CON_CARD_OPEN_HINT = 'Open in the app'
