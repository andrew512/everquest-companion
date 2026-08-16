// conCardRows — WHICH FIVE DROPS THE CON CARD SHOWS, and what each line says (JOS-383).
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

import type { ConCardPayload } from '@shared/conCard'
// VALUE imports are spelled relatively so the node suite can import this module directly —
// `features/mobs/seenVariants.ts`'s own rule, which is repo law.
import { itemCountKey } from '../lib/itemName'
import { foldSeenVariants, perceivedDropRate } from '../features/mobs/seenVariants'

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
