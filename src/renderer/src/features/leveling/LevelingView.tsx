import { type JSX, useMemo } from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import type {
  AASpendEvent,
  LevelingDelta,
  LevelingSnap,
  ProgressionDelta,
  ProgressionSnap
} from '@shared/types'
import { computeAAAccounting } from '@shared/aa'
import { rangeStats, type RangeStats } from '@shared/progressionStats'
import { useModule } from '../../lib/useModule'
import { formatDate } from '../../lib/formatDate'
import {
  buildLevelSegments,
  latestLevel,
  levelFeedEntries,
  peakLevel,
  sortLevels,
  swapCount,
  type LevelPoint,
  type LevelSegment
} from './levelSeries'
import { AreaChart, LevelStepChart, SWAP_COLOR, ZoneLegendStrip, type ChartChrome } from './levelCharts'
import { fmtDelta, type AaPoint } from './levelChartGeometry'
import { chartDomain, mergeZoneBands, zoneLegend, type ZoneLegend } from './zoneBands'
import { useChartSelection } from './useChartSelection'
import { EMPTY_PROGRESSION, applyProgressionDelta } from './progressionDelta'
import { RangeStatsPanel } from './RangeStatsPanel'
import { comboSource } from './comboAdapter'
import { useComboIntervals } from '../profiles/ClassComboData'
// The module fold moved beside the view (levelingModule.ts) the day a SECOND reader appeared:
// the always-mounted ding detector behind the level-up toast watches the same append-only series.
import { EMPTY_LEVELING, applyLevelingDelta } from './levelingModule'
// The four hero cards — split into their own file the day this one reached the measured ceiling.
import { LevelingHeroes } from './LevelingHeroes'
import { NewAtLevelPanel } from './NewAtLevelPanel'

interface FeedItem {
  ts: number
  kind: 'level' | 'aa' | 'swap'
  label: string
  detail: string
}

const FEED_COLOR: Record<FeedItem['kind'], string> = {
  level: '#d9b25f',
  aa: '#6fb3d2',
  swap: SWAP_COLOR
}

/**
 * Cumulative AA gained. Deliberately NOT the earned headline: this is Σ of the gain
 * lines, so points re-gained after a respec are counted again and the curve runs
 * ahead of `earned` — the caption says so rather than quietly reconciling them.
 * Nothing is drawn until there are two points to draw a line between.
 */
function AaOverTimePanel({
  points,
  aaEarned,
  chrome
}: {
  points: AaPoint[]
  aaEarned: number
  chrome: ChartChrome
}): JSX.Element | null {
  if (points.length < 2) return null
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2">AA gained over time</Typography>
      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
        cumulative gain lines — includes points re-gained after a respec, so the final
        value runs ahead of the {aaEarned.toLocaleString()} earned headline
      </Typography>
      <AreaChart points={points} color="#6fb3d2" chrome={chrome} />
    </Paper>
  )
}

/** Level over time, with the caption that explains the dashed class-swap breaks. */
function LevelOverTimePanel({
  segments,
  levelCount,
  swaps,
  aaPoints,
  chrome,
  legend
}: {
  segments: LevelSegment[]
  levelCount: number
  swaps: number
  /** Context for the hover readout only ("AA gained by then") — nothing is drawn from it. */
  aaPoints: AaPoint[]
  chrome: ChartChrome
  /** The zone legend for the shared domain. Rendered ONCE, under the lower chart: the band
   *  strip is identical on both plots, so a second copy would be pure noise. */
  legend: ZoneLegend
}): JSX.Element | null {
  if (levelCount < 2) return null
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2">Level over time</Typography>
      <Typography variant="caption" color="text.secondary" gutterBottom display="block">
        {swaps > 0 ? (
          <>
            steps hold until the next ding; a{' '}
            <Box component="span" sx={{ color: SWAP_COLOR }}>
              dashed break
            </Box>{' '}
            is a class swap — the level is re-reported for the new loadout, not lost
          </>
        ) : (
          'steps hold until the next ding'
        )}
      </Typography>
      <LevelStepChart segments={segments} color="#d9b25f" aaPoints={aaPoints} chrome={chrome} />
      <ZoneLegendStrip legend={legend} fmtDuration={fmtDelta} />
    </Paper>
  )
}

/**
 * Purchases list: newest first, respec re-buys deduped by the caller and tagged with a
 * ×N count. Auto-grants (cost 0) are shown but badged rather than priced — they were
 * never bought, so counting them as purchases would inflate the spend.
 */
function AaPurchasesPanel({
  purchases,
  boughtCount
}: {
  purchases: { ev: AASpendEvent; count: number }[]
  boughtCount: number
}): JSX.Element | null {
  if (purchases.length === 0) return null
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', maxHeight: '45%' }}>
      <Typography variant="subtitle2" gutterBottom>
        AAs purchased{' '}
        <Typography component="span" variant="caption" color="text.secondary">
          ({boughtCount})
        </Typography>
      </Typography>
      <Box sx={{ overflow: 'auto', pr: 0.75 }}>
        {purchases.map(({ ev: p, count }, i) => {
          const auto = p.cost === 0
          return (
            <Stack key={`${p.ts}-${i}`} direction="row" spacing={1} alignItems="center" sx={{ py: 0.3 }}>
              <AutoAwesomeIcon sx={{ fontSize: 12, color: auto ? '#7a7a7a' : '#b07fd0' }} />
              <Typography
                variant="caption"
                sx={{ flexGrow: 1, color: auto ? 'text.secondary' : 'text.primary' }}
                noWrap
                title={p.ability}
              >
                {p.ability}
                {count > 1 && (
                  <Typography component="span" variant="caption" color="text.disabled">
                    {' '}
                    ×{count}
                  </Typography>
                )}
              </Typography>
              {auto ? (
                <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                  auto-granted
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {p.cost} pt{p.cost === 1 ? '' : 's'}
                </Typography>
              )}
            </Stack>
          )
        })}
      </Box>
    </Paper>
  )
}

/** Interleaved level/AA/swap feed, newest first. */
function ProgressFeedPanel({ feed }: { feed: FeedItem[] }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2, flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Typography variant="subtitle2" gutterBottom>
        Recent progress
      </Typography>
      <Box sx={{ overflow: 'auto', pr: 0.75 }}>
        {feed.map((f, i) => (
          <Stack
            key={`${f.ts}-${f.kind}-${i}`}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ py: 0.4 }}
          >
            <Chip
              size="small"
              label={f.label}
              sx={{
                height: 20,
                bgcolor: `${FEED_COLOR[f.kind]}22`,
                color: FEED_COLOR[f.kind],
                fontWeight: 700,
                minWidth: 68
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }} noWrap>
              {f.detail}
            </Typography>
            <Typography variant="caption" color="text.disabled" noWrap>
              {formatDate(f.ts)}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Paper>
  )
}

interface LevelingCharts {
  /** null only when NOTHING in any series carries a timestamp — the view shows its empty state. */
  chrome: ChartChrome | null
  legend: ZoneLegend
  stats: RangeStats | null
  clear: () => void
}

/**
 * Everything the two charts must AGREE on, derived once.
 *
 * The domain is the seam (plan §6.1): both charts used to compute their own `t0/t1`, so a
 * zone band or a range selection at the same pixel meant two different instants. One
 * `ChartScale` over the level dings + AA gains + every progression column feeds the strip,
 * the drag selection and both plots.
 *
 * The selection lives here (one hook call, not one per chart) — that is what makes a drag on
 * the AA chart and a drag on the level chart the SAME selection, with the newer one winning.
 */
function useLevelingCharts(prog: ProgressionSnap, levels: readonly LevelPoint[], aas: readonly AaPoint[]): LevelingCharts {
  const scale = useMemo(
    () => chartDomain(prog, [...levels.map((p) => p.ts), ...aas.map((a) => a.ts)]),
    [prog, levels, aas]
  )
  const bands = useMemo(() => (scale ? mergeZoneBands(prog, scale.t0, scale.t1) : []), [prog, scale])
  const legend = useMemo(() => zoneLegend(bands), [bands])
  const { sel, draft, dragging, clear, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } =
    useChartSelection(scale)
  // The combo seam (progressionStats §ComboSource). `rangeStats` declared the SHAPE it needs and
  // never imports the combo module, so the adapter beside this file is what reconciles the two
  // `ComboInterval` types — and passing it here is the whole reason the range panel's combo chip
  // has anything to print.
  const intervals = useComboIntervals()
  const combo = useMemo(() => comboSource(intervals), [intervals])
  const stats = useMemo(() => (sel ? rangeStats({ snap: prog, range: sel, combo }) : null), [sel, prog, combo])
  // Rebuilt narrow, NOT the whole SelectionApi: the charts spread this straight onto a DOM
  // element, so anything else on the object would land there as an unknown attribute.
  const pointer = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  const chrome = scale ? { scale, bands, range: draft ?? sel, suppressed: dragging, pointer } : null
  return { chrome, legend, stats, clear }
}

/**
 * The tab's deep-link payload: the level a level-up toast asked us to open on
 * (docs/plans/levelup-whats-new.md §2). Absent ⇒ a plain tab switch, and the panel follows the
 * character's own level. The nonce is the standing contract (appRouting.ts): the tab stays
 * MOUNTED across a link, so the same level asked for twice must arrive twice.
 */
export interface LevelingViewProps {
  focusLevel?: number | null
  focusNonce?: number
  onFocusConsumed?: () => void
}

export default function LevelingView({
  focusLevel = null,
  focusNonce = 0,
  onFocusConsumed
}: LevelingViewProps): JSX.Element {
  const state = useModule<LevelingSnap, LevelingDelta>('leveling', applyLevelingDelta) ?? EMPTY_LEVELING
  const { levels, aaGains: aas, aaSpends: spends } = state
  // The SECOND module this view reads: the capped, range-queryable analytics series behind
  // the zone bands and the range panel. Deliberately separate from `leveling`, whose
  // contract is "everything, forever" (see src/main/modules/progression.ts).
  const prog = useModule<ProgressionSnap, ProgressionDelta>('progression', applyProgressionDelta) ?? EMPTY_PROGRESSION

  const sortedLevels = useMemo(() => sortLevels(levels), [levels])
  const sortedAAs = useMemo(() => [...aas].sort((a, b) => a.ts - b.ts), [aas])

  // CURRENT level is the LATEST reported one, never max(). You level three classes at once
  // and a loadout swap re-reports the level of the new (lowest) class — so the peak belongs
  // to a class that may no longer be in the loadout. It's surfaced separately as "peak".
  const levelSegments = useMemo(() => buildLevelSegments(sortedLevels), [sortedLevels])
  const currentLevel = latestLevel(sortedLevels)
  const peak = peakLevel(sortedLevels)
  const swaps = swapCount(levelSegments)

  // Refund-proof AA accounting (Task #48). The headline is NOT Σ gains — a respec
  // refunds points with no log line, they re-enter as fresh gain lines, so Σ gains
  // double-counts every refunded point. Instead:
  //   allocated = latest-epoch cost per (ability,rank), cost-0 auto-grants excluded
  //   unspent   = last authoritative "you now have" − spends after it
  //   earned    = allocated + unspent   (the identity the user validated)
  // See src/shared/aa.ts for the full derivation.
  const acct = useMemo(() => computeAAAccounting(aas, spends), [aas, spends])
  const aaEarned = acct.earned
  const aaSpent = acct.allocated
  const aaUnspent = aas.length ? acct.unspent : null
  const boughtCount = acct.boughtCount

  // Purchases list: newest first, with respec re-buys deduped. The same
  // ability+rank bought more than once (a respec then re-buy) collapses to its
  // most-recent purchase, tagged with a ×N count. Auto-grants (cost 0) are kept
  // but badged rather than counted as purchases.
  const purchases = useMemo(() => {
    const byKey = new Map<string, { ev: AASpendEvent; count: number }>()
    for (const s of spends) {
      const key = s.ability
      const prev = byKey.get(key)
      if (!prev) byKey.set(key, { ev: s, count: 1 })
      else byKey.set(key, { ev: s.ts >= prev.ev.ts ? s : prev.ev, count: prev.count + 1 })
    }
    return [...byKey.values()].sort((a, b) => b.ev.ts - a.ev.ts)
  }, [spends])

  // `nowHave` rides along so the hover readout can state the unspent balance the gain line
  // itself reported, instead of re-deriving a balance the log already gave us.
  const aaCumulative = useMemo<AaPoint[]>(() => {
    let sum = 0
    return sortedAAs.map((a) => ({ ts: a.ts, y: (sum += a.amount), nowHave: a.nowHave }))
  }, [sortedAAs])

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []
    for (const e of levelFeedEntries(sortedLevels)) {
      // A post-swap ding is the first level of a NEW loadout: the elapsed time back to the
      // previous ding spans the (unlogged) swap, so it is not a "time to level" — showing
      // `+38.9h` there would be fabricated. Label the swap instead.
      items.push({
        ts: e.ts,
        kind: e.afterSwap ? 'swap' : 'level',
        label: e.afterSwap ? `Level ${e.level} (class swap)` : `Level ${e.level}`,
        detail: e.afterSwap ? 'new loadout — level re-reported' : e.sinceMs != null ? `+${fmtDelta(e.sinceMs)}` : ''
      })
    }
    for (const a of sortedAAs) {
      items.push({ ts: a.ts, kind: 'aa', label: `+${a.amount} AA`, detail: `${a.nowHave} unspent` })
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 60)
  }, [sortedLevels, sortedAAs])

  const { chrome, legend, stats, clear } = useLevelingCharts(prog, sortedLevels, aaCumulative)

  const nothing = sortedLevels.length === 0 && sortedAAs.length === 0
  // One props object, two placements (see both call sites): the panel is the same surface in the
  // charted and the chart-less state, and spelling its four props twice is how they drift.
  const unlockPanel = {
    currentLevel,
    focusLevel,
    focusNonce,
    onFocusConsumed: onFocusConsumed ?? ((): void => undefined)
  }

  return (
    <Stack spacing={2} sx={{ height: '100%' }} data-testid="leveling-view">
      <LevelingHeroes
        currentLevel={currentLevel}
        levelCount={sortedLevels.length}
        peak={peak}
        swaps={swaps}
        aaEarned={aaEarned}
        aaSpent={aaSpent}
        aaUnspent={aaUnspent}
        boughtCount={boughtCount}
      />

      {nothing || !chrome ? (
        <Typography color="text.secondary" sx={{ p: 2 }} data-testid="leveling-empty">
          No level-ups or AA gains found in this character&apos;s log yet. They&apos;ll appear here live as you play.
        </Typography>
      ) : (
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
          {/* The charts column OWNS ITS SCROLL (the standing list law): its papers are
              intrinsically tall — two plots plus a range panel that mounts on a drag — and
              without this the column grew the app's content area instead, which is the one
              thing a view may never do. */}
          <Stack spacing={2} sx={{ flex: 2, minWidth: 320, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
            <AaOverTimePanel points={aaCumulative} aaEarned={aaEarned} chrome={chrome} />
            <LevelOverTimePanel
              segments={levelSegments}
              levelCount={sortedLevels.length}
              swaps={swaps}
              aaPoints={aaCumulative}
              chrome={chrome}
              legend={legend}
            />
            {stats && <RangeStatsPanel stats={stats} onClear={clear} />}
          </Stack>

          <Stack spacing={2} sx={{ flex: 1, minWidth: 260, minHeight: 0 }}>
            <AaPurchasesPanel purchases={purchases} boughtCount={boughtCount} />
            <ProgressFeedPanel feed={feed} />
          </Stack>
        </Stack>
      )}

      {/* OUTSIDE the branch, and LAST. Outside because it is the one surface here that needs no
          log at all — "what do I get at 30" is answered by the committed DBs, so a character with
          too few dings to draw a chart still gets it, and rendering it in both arms would remount
          it (and drop a deep link's level) every time the charts appeared. Last because the two
          plots are what this tab is for at a glance; pushing them down a screen for a browsable
          reference panel would cost the primary surface its position. */}
      <NewAtLevelPanel {...unlockPanel} />
    </Stack>
  )
}
