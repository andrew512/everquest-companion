// itemsResearch.ts — the ADDITIVE item-knowledge layer: hand-curated facts about items that the
// wiki scrape can never produce, merged OVER the scraped record and never back into it
// (docs/plans/planner-v2.md §4).
//
// WHY IT EXISTS. The corpus keeps proving the same shape of gap — facts that exist in the world
// but in no parseable wiki field: whether an item is mage-conjured, whether it only ever came out
// of a GM event, which instrument family a bard item counts as, focus percentages. `items.json` is
// a machine scrape and must stay one: a rescrape overwrites it wholesale, so anything hand-known
// written into it is lost on the next run. This file is the other layer. `itemsDb.ts` restores the
// scrape's own defaults (`knowledgeFromDb`); THIS module lays the curated fields on top of that
// result, in that order, so the two layers can never fight and a rescrape stays idempotent.
//
// THE FILE FORMAT (`src/main/data/itemsResearch.json`): a flat object keyed by `itemKey()` — the
// same key items.json, the userData cache and the planner already use — whose values are
// `ItemResearch`. Every entry carries its OWN provenance (`source`, `checkedAt`) because an entry
// with no stated source is indistinguishable from a guess, and a guess in this file would be
// invisible: it reads exactly like scraped fact to every consumer above it.
//
// HOW IT IS WRITTEN: BY HAND, or generated and then reviewed by a human before it lands — never
// machine-written unattended. That is the same shape as the zone table (world-model law 12): the
// V9 scrape-time pass may FLAG candidates (GM-event prose lives in the item's notes, e.g. the 12
// pages the committed corpus phrases as "GM Event Item." / "Obtained during a GM event"), but a
// candidate becomes an entry only when someone admits it. Hedged prose ("Possibly a GM Event
// item?") is exactly what the review is for, and stays out.
//
// WHAT CONSUMES IT TODAY: `planner/effectIndex.ts` only, and only to EXCLUDE donors (V9) — an
// excluded item stays in item lookup and stays a searchable host, because "you cannot pull an
// effect off this" is not "this item does not exist".

import itemsResearchJson from './data/itemsResearch.json'
import { itemKey, knowledgeFromDb, type ItemDbEntry } from './itemsDb'
import type { ItemKnowledge } from '../shared/types'

/**
 * One curated entry. Every field is OPTIONAL knowledge except the provenance pair, which is not:
 * absent means unresearched, never false (law 1).
 */
export interface ItemResearch {
  /** mage-conjured — R7, cannot donate an exaltation (docs/plans/exaltation-planner.md §1) */
  summoned?: boolean
  /** only ever handed out in a GM event: real, unfarmable, and not a plan a player can execute */
  gmEvent?: boolean
  /** bard instrument family, for the grouping axis V11 defers until this layer carries it */
  instrument?: string
  /** why this entry says what it says, in one sentence — for the next reader, not for code */
  note?: string
  /** where the claim came from: a URL, a page name, or the observation that produced it */
  source: string
  /** ISO date the claim was last checked against that source */
  checkedAt: string
}

/** The committed file: `itemKey()` → entry. */
export type ItemResearchFile = Record<string, ItemResearch>

/** The committed layer. Tiny (hand-authored), so unlike items.json it is imported freely. */
export const ITEMS_RESEARCH = itemsResearchJson as ItemResearchFile

/**
 * The scraped record with its curated layer attached — the view every consumer should read.
 *
 * The layer is a SIBLING field, not a spread over the knowledge record: a curated `summoned` is a
 * different kind of claim from a scraped `quest`, and a reader that cannot tell them apart cannot
 * report provenance. Absent `research` means nobody has looked, which is not the same as "nothing
 * to say" (law 1).
 */
export interface ResearchedKnowledge extends Omit<ItemKnowledge, 'cached'> {
  research?: ItemResearch
}

/**
 * One stored record → the merged view. `knowledgeFromDb` FIRST (it restores the scrape's omitted
 * defaults), the curated entry after, keyed by the same `itemKey` the rest of the app uses — so
 * the lookup follows the item's `|itemname` when the page states one, exactly like the planner's
 * own keys do.
 *
 * `research` is injectable so a test can prove the merge with a fixture instead of depending on
 * whichever entries the committed layer happens to carry today.
 */
export function knowledgeWithResearch(
  entry: ItemDbEntry,
  research: ItemResearchFile = ITEMS_RESEARCH
): ResearchedKnowledge {
  const k = knowledgeFromDb(entry)
  const found = research[itemKey(k.name)]
  return found ? { ...k, research: found } : k
}
