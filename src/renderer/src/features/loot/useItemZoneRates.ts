// useItemZoneRates — the item drill-down's per-zone drop rates (JOS-78).
//
// It joins TWO modules that already exist and adds no third store: the `loot` history supplies the
// drops (each row already carrying the zone it happened in — see lootRates.ts rule 1), and the
// `progression` snapshot supplies the DENOMINATOR, through the very same `rangeStats` query the
// Leveling tab's range panel reads. Nothing here divides anything by anything; `lootRates.ts` does
// the arithmetic and this hook only decides WHICH RANGE.
//
// THE RANGE IS THE WHOLE RECORD. The drill-down's question is "where does this drop for me",
// full stop — it has no timescale control of its own and inventing one would be a second opinion
// about a scope the tab that owns scopes already answers. So the range is `dataBounds` end to end,
// with the same `+1 ms` tail `windowScope.statsRangeFor` uses so the newest event is inside it.
//
// WHAT IT DOES NOT DO: it never consults the wiki's `dropsFrom`. Those rows are elsewhere on this
// page, chipped `db`, answering the same question from the committed catalog — and blending them
// into a rate would put a number this character never observed under an `observed` heading.

import { useMemo } from 'react'
import type { LootEvent, ProgressionDelta, ProgressionSnap } from '@shared/types'
import { rangeStats } from '@shared/progressionStats'
import { itemZoneRows, type ItemZoneRow } from '@shared/lootRates'
import { useModule } from '../../lib/useModule'
import { EMPTY_PROGRESSION, applyProgressionDelta } from '../leveling/progressionDelta'
import { dataBounds } from '../leveling/zoneBands'

/** The same one-millisecond tail `windowScope.ts` documents: `rangeStats` ranges are half-open,
 *  and the newest loot line in the log is stamped at `bounds.hi` exactly. */
const TAIL_MS = 1

export interface ItemZoneRates {
  rows: ItemZoneRow[]
  /**
   * True when the range reached below the analytics module's capped window — the same `clipped`
   * flag the range panel surfaces. Drops older than that window keep their own timestamps but
   * have no span to divide by, so their rows are honest counts with an em-dash rate.
   */
  clipped: boolean
}

const NO_ROWS: ItemZoneRates = { rows: [], clipped: false }

/**
 * This item's zones, drops and per-hour-of-active-time rates over the character's whole record.
 *
 * `events` must already be filtered to the item (the pane holds that filter for its other
 * columns too). An empty list short-circuits to no rows — a never-looted item asks the
 * progression snapshot nothing.
 */
export function useItemZoneRates(events: readonly LootEvent[]): ItemZoneRates {
  const prog = useModule<ProgressionSnap, ProgressionDelta>('progression', applyProgressionDelta) ?? EMPTY_PROGRESSION
  return useMemo(() => {
    if (events.length === 0) return NO_ROWS
    const bounds = dataBounds(prog, [])
    // No record at all ⇒ no zone rows, so every rate is null and every count is still true.
    const stats = bounds
      ? rangeStats({ snap: prog, range: { t0: bounds.lo, t1: bounds.hi + TAIL_MS } })
      : null
    return { rows: itemZoneRows({ events, zones: stats?.zones ?? [] }), clipped: stats?.clipped ?? false }
  }, [events, prog])
}
