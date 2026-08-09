// ============================================================================
// questCompletion.ts — what "completed" means on the Sky tab, now that it is two things.
// ============================================================================
//
// A pure module with no React and no data bundle, so the decision below is pinned by a plain
// node test (tests/questTurnIns.test.mts) rather than only by a browser.
//
// WHAT "HIDE COMPLETED" HIDES, DECIDED (JOS-131): a quest you are HOLDING EVERY ITEM FOR right
// now — NOT a quest you have ever turned in.
//
// The question only exists because a turn-in stopped being terminal. Before JOS-131 the two
// readings were the same state: turning a quest in pinned it at 5/5 forever, so "done" and "has
// every item" could not disagree. Now a turn-in SUBTRACTS what it consumed, the quest drops back
// to 0/5, and the two readings disagree about exactly the quest this ticket exists for.
//
// WHY THIS READING WINS.
//   * The box means "show me what is left to farm", and a quest you just handed in IS work left:
//     every item it needed is gone from your bags. Hiding it by has-ever-turned-in would make the
//     refarm invisible — the very bug JOS-131 removes, re-introduced one filter later — and would
//     also hide a quest you are 4/5 of the way through re-running.
//   * A quest with every item in hand genuinely has nothing left to grind for. Whether you have
//     walked it to the giver yet is a two-minute errand, not a place in the grind.
//   * "I never want to see this quest again" already has a dedicated, permanent, per-quest and
//     reversible affordance: the Ignored tab. A filter trying to be that as well would only be a
//     worse version of it.
//
// A quest that requires NOTHING is never "has every item": zero required items is missing data
// about a quest, not a finished one (law 1), and `hideNoItems` is the toggle that speaks to those.
//
// THE PERSISTENCE IS UNTOUCHED (JOS-90's conventions): same `eq.posky.hideCompleted` key, same
// '1'/'0' one-bit idiom, an absent key still means the DEFAULT rather than `false`, the box and
// the pref are still one thing (so `revealQuest`'s un-tick still persists), and it is still not
// whitelisted for share bundles. A user who had it ticked keeps it ticked and gets the new
// reading, which is the same promise they ticked it for.

/** The part of a quest's progress this rule reads. Structural, so a test needs no whole quest. */
export interface CompletableQuest {
  /** total items required, summed over the required counts */
  needCount: number
  /** the required items not fully held right now */
  missing: readonly string[]
}

/** Are you holding everything this quest asks for, right now? */
export function hasEveryItem(q: CompletableQuest): boolean {
  return q.needCount > 0 && q.missing.length === 0
}
