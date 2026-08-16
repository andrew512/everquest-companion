// conCardRows — WHAT THE CON CARD ACTUALLY PUTS ON SCREEN: which resist chips survive, and which
// five drops it shows (JOS-383, narrowed by JOS-386).
//
// PURE, and imported by relative path in the tests, because this repo has no jsdom: the ranking is
// unit-tested here (`tests/conCard.test.mts`) and the JSX is asserted by the e2e against the real
// app. Same split as `features/resists/resistRow.ts` and `features/mobs/dropEra.ts`.
//
// IT REUSES THE MOB PAGE'S FOLD RATHER THAN COUNTING AGAIN. `foldSeenVariants` (JOS-196) is the one
// statement in this tree about what a `+N` variant is, and a card that added its own would report a
// different number from the page one click away: three `1x` loots of `Sphinx Claw`, `Sphinx Claw
// +1` and `Sphinx Claw +2` are ONE line saying `3x`, here exactly as there.
//
// THE ORDER IS AN AUTHORITY CLAIM, and it is the mob page's, narrowed to five lines:
//   1. The wiki drop table leads — it is what the creature CAN drop, and it is the definitive
//      source (main/mobLookup.ts states this as a law, not a layout preference).
//   2. Inside it, the rows YOUR OWN LOG has corroborated come first, most-looted first. On a page
//      with thirty entries and room for five, "the ones you have actually had off this thing" is
//      the only ranking with evidence behind it; page order is the fallback, never a guess at
//      rarity (the rarity field is free text the wiki writes three different ways).
//   3. Items only your history knows come LAST and are marked, which is exactly what the page does
//      with its "also looted by you" block.
// Anything past the cap is COUNTED rather than dropped silently: `+7 more` is a true statement
// about a list, and a truncated list that says nothing is not.

import type { ConCardChip, ConCardPayload } from '@shared/conCard'
import type { ResistTag } from '@shared/resistTypes'
// VALUE imports are spelled relatively so the node suite can import this module directly —
// `features/mobs/seenVariants.ts`'s own rule, which is repo law.
import { itemCountKey } from '../lib/itemName'
import { foldSeenVariants, perceivedDropRate } from '../features/mobs/seenVariants'

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
 * `resistant` is the cut, and it is the estimator's own boundary rather than a number invented
 * here: `resistTag()` (shared/resistModel.ts) calls R >= 45 resistant, and everything below that is
 * `normal` or `weak`. Reusing the tag is what keeps the card and the page from disagreeing about
 * what "resistant" means — the same reason the chip's colour and word are imported rather than
 * spelled twice.
 */
export const CON_CARD_NOTABLE_TAGS: readonly ResistTag[] = ['resistant', 'very resistant', 'nearly immune']

/**
 * A chip that survived the cut. The nulls are gone by construction — `notableChips` is the only
 * way to make one — so the component that draws it has no absent-answer branch left to get wrong.
 */
export interface ConCardNotableChip extends ConCardChip {
  tag: ResistTag
  fit: { R: number; lo: number; hi: number }
}

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
  return chips.filter(
    (c): c is ConCardNotableChip =>
      c.n > 0 && c.tag !== null && c.fit !== null && CON_CARD_NOTABLE_TAGS.includes(c.tag)
  )
}

/**
 * How many observations the whole profile is standing on — what the card's empty state says after
 * "no notable resists", so "we looked and there is nothing to flag" can be told from "we have never
 * seen a spell land on this". Zero is a real and different answer, and it prints as one.
 */
export function conCardTotalN(chips: readonly ConCardChip[]): number {
  return chips.reduce((sum, c) => sum + (Number.isFinite(c.n) ? c.n : 0), 0)
}

/** One drop line on the card. */
export interface ConCardDropLine {
  /** What the line calls the item — the wiki's spelling when it has one, else the folded name. */
  item: string
  /** The page's verbatim rarity, when it stated one. Never normalized into a scale we invented. */
  rarity?: string
  /** How many YOU have looted (every `+N` variant folded), when your log has any. */
  seen?: number
  /** Your perceived rate, when there is a kill count to divide by. NULL, never zero (JOS-78). */
  perKill: number | null
  /** True for a line only your own history knows — the page's "also looted by you" state. */
  yoursOnly: boolean
}

export interface ConCardDrops {
  lines: ConCardDropLine[]
  /** How many known drops did not fit. Zero when the whole list is on screen. */
  more: number
}

/**
 * The card's drop lines: the wiki table ranked by your own corroboration, then your own extras,
 * capped.
 *
 * `kills` is the rate's DENOMINATOR and the payload carries it separately for the reason the mob
 * page states it in a tooltip: a rate without its denominator is a claim rather than a measurement.
 */
export function conCardDropLines(payload: ConCardPayload, cap: number): ConCardDrops {
  const groups = foldSeenVariants(payload.dropsSeen ?? [])
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const wiki = payload.dropsWiki ?? []
  const claimed = new Set<string>()

  const listed: { line: ConCardDropLine; count: number; at: number }[] = wiki.map((d, at) => {
    const key = itemCountKey(d.item)
    const seen = byKey.get(key)
    if (seen) claimed.add(key)
    const line: ConCardDropLine = { item: d.item, perKill: null, yoursOnly: false }
    if (d.rarity !== undefined) line.rarity = d.rarity
    if (seen) {
      line.seen = seen.count
      line.perKill = perceivedDropRate(seen.count, payload.kills)
    }
    return { line, count: seen?.count ?? 0, at }
  })
  // Corroborated first (most-looted, then page order); everything else keeps the page's own order.
  listed.sort((a, b) => b.count - a.count || a.at - b.at)

  const yours: ConCardDropLine[] = groups
    .filter((g) => !claimed.has(g.key))
    .map((g) => ({
      item: g.item,
      seen: g.count,
      perKill: perceivedDropRate(g.count, payload.kills),
      yoursOnly: true
    }))

  const all = [...listed.map((l) => l.line), ...yours]
  return { lines: all.slice(0, cap), more: Math.max(0, all.length - cap) }
}
