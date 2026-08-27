// THE TAB'S OWN SERIES — everything derived from the `leveling` snapshot alone (JOS-511).
//
// Its own file for the reason `LevelingHeroes` and `LedgerColumn` got theirs: `LevelingView`
// reached the measured `max-lines` ceiling and the rule here is to SPLIT rather than ratchet
// (AGENTS.md). This is the natural seam — five folds over ONE module snapshot, read by the charts,
// the heroes, the feed and the timeslice's bounds, and none of them touching a scope, a slice or a
// pointer. Nothing is re-decided; every comment travelled with the derivation it was written for.
//
// AND THE SEAM IS WHERE THE MEMOS BELONG. Each of these is a dependency of something bigger — the
// bounds the slice is resolved against, the segments the curve is folded over, the feed the scope
// filters — so their IDENTITIES are what decide whether the layer above them re-runs. Keeping them
// together is what makes that reviewable in one screen.

import { useMemo } from 'react'
import type { AAEvent, AASpendEvent, LevelingSnap } from '@shared/types'
import { computeAAAccounting } from '@shared/aa'
import {
  buildLevelSegments,
  levelFeedEntries,
  sortLevels,
  type LevelPoint,
  type LevelSegment
} from './levelSeries'
import { fmtDelta, type AaPoint } from './levelChartGeometry'
import type { FeedItem } from './LedgerColumn'

/**
 * THE REFUND-PROOF AA HEADLINE (Task #48), in the shape the four hero cards take.
 *
 * The identity is NOT Σ gains — a respec refunds points with no log line, they re-enter as fresh
 * gain lines, so Σ gains double-counts every refunded point. Instead:
 *   allocated = latest-epoch cost per (ability,rank), cost-0 auto-grants excluded
 *   unspent   = last authoritative "you now have" − spends after it
 *   earned    = allocated + unspent   (the identity the user validated)
 * See src/shared/aa.ts for the full derivation, and `AaOverTimePanel` for why the cumulative curve
 * is allowed to disagree with `earned`.
 *
 * Its keys are the hero card's prop names on purpose: the view spreads it straight onto
 * `LevelingHeroes`, which is one fewer place for four numbers to be mis-paired. `unspent` is null
 * rather than 0 for a character with no AA line at all — an unknown balance and an empty one are
 * different facts.
 */
export interface AaHeadline {
  aaEarned: number
  aaSpent: number
  aaUnspent: number | null
  boughtCount: number
}

/**
 * The interleaved level/AA/swap feed, newest first — a pure derivation.
 *
 * A post-swap ding is the first level of a NEW loadout: the elapsed time back to the previous
 * ding spans the (unlogged) swap, so it is not a "time to level" — showing `+38.9h` there would
 * be fabricated. Label the swap instead.
 *
 * UNCUT, and the view slices it AFTER scoping (JOS-75): a `.slice(0, 60)` here would take the
 * sixty NEWEST entries in the whole log and then filter, so a window that sits behind them
 * would come up empty with events plainly drawn on the chart above it. Each `sinceMs` is still
 * measured against the ding's true predecessor, in or out of scope — the elapsed time to reach
 * a level is a fact about the level, not about what you are looking at.
 */
export function buildFeed(levels: readonly LevelPoint[], aas: readonly AAEvent[]): FeedItem[] {
  const items: FeedItem[] = []
  for (const e of levelFeedEntries(levels)) {
    items.push({
      ts: e.ts,
      kind: e.afterSwap ? 'swap' : 'level',
      label: e.afterSwap ? `Level ${e.level} (class swap)` : `Level ${e.level}`,
      detail: e.afterSwap ? 'new loadout - level re-reported' : e.sinceMs != null ? `+${fmtDelta(e.sinceMs)}` : ''
    })
  }
  for (const a of aas) {
    items.push({ ts: a.ts, kind: 'aa', label: `+${a.amount} AA`, detail: `${a.nowHave} unspent` })
  }
  return items.sort((a, b) => b.ts - a.ts)
}

export interface LevelingSeries {
  /** The dings, ascending. `peakLevel`/`swapCount` are questions about exactly this series. */
  sortedLevels: LevelPoint[]
  /** The AA gain lines, ascending. */
  sortedAAs: AAEvent[]
  /** The runs between swaps, over the sorted dings. */
  levelSegments: LevelSegment[]
  /**
   * Cumulative AA gained. Deliberately NOT the earned headline: this is Σ of the gain lines, so
   * points re-gained after a respec are counted again and the curve runs ahead of `earned`.
   *
   * `nowHave` rides along so the hover readout can state the unspent balance the gain line itself
   * reported, instead of re-deriving a balance the log already gave us. `gain` rides along for the
   * same reason: a windowed curve can open on a gain that has no predecessor in the drawn array,
   * and the tooltip must still name that LINE's own points.
   */
  aaCumulative: AaPoint[]
  /** The interleaved progress feed, UNCUT — see `buildFeed`. */
  feed: FeedItem[]
  /** The record's bounds also depend on THIS tab's own two series, which the progression snapshot
   *  does not carry. Memoized because the timeslice hook takes it as a dependency. */
  extraTs: number[]
  aa: AaHeadline
}

/** Every fold over the `leveling` snapshot, once. See the file header for why they live together. */
export function useLevelingSeries(state: LevelingSnap): LevelingSeries {
  const { levels, aaGains: aas, aaSpends: spends } = state
  const sortedLevels = useMemo(() => sortLevels(levels), [levels])
  // eslint-disable-next-line eqc/no-domain-munging -- JOS-459 cutover ledger item 3: no served view source answers this yet, so the renderer still derives AAEvent. Becomes a view descriptor when the source lands.
  const sortedAAs = useMemo(() => [...aas].sort((a, b) => a.ts - b.ts), [aas])
  const levelSegments = useMemo(() => buildLevelSegments(sortedLevels), [sortedLevels])
  const aaCumulative = useMemo<AaPoint[]>(() => {
    let sum = 0
    return sortedAAs.map((a) => ({ ts: a.ts, y: (sum += a.amount), nowHave: a.nowHave, gain: a.amount }))
  }, [sortedAAs])
  const feed = useMemo(() => buildFeed(sortedLevels, sortedAAs), [sortedLevels, sortedAAs])
  const extraTs = useMemo(
    () => [...sortedLevels.map((p) => p.ts), ...aaCumulative.map((a) => a.ts)],
    [sortedLevels, aaCumulative]
  )
  const aa = useAaHeadline(aas, spends)
  return { sortedLevels, sortedAAs, levelSegments, aaCumulative, feed, extraTs, aa }
}

// Not `readonly`: `computeAAAccounting` declares mutable arrays, and these come straight off the
// module snapshot that already owns them. Widening here would only move the cast.
function useAaHeadline(aas: AAEvent[], spends: AASpendEvent[]): AaHeadline {
  const acct = useMemo(() => computeAAAccounting(aas, spends), [aas, spends])
  // MEMOIZED AS AN OBJECT TOO (JOS-511 item 2): the view SPREADS this onto `LevelingHeroes`, so a
  // fresh literal per render is four changed props on the hero row whatever moved on the tab.
  return useMemo(
    () => ({
      aaEarned: acct.earned,
      aaSpent: acct.allocated,
      aaUnspent: aas.length ? acct.unspent : null,
      boughtCount: acct.boughtCount
    }),
    [acct, aas]
  )
}
