import { type JSX, useMemo, useState } from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type {
  AAEvent,
  LevelingDelta,
  LevelingSnap,
  ProgressionDelta,
  ProgressionSnap
} from '@shared/types'
import { computeAAAccounting } from '@shared/aa'
import { aaPace } from '@shared/aaPace'
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
import { chartDomain, dataBounds, mergeZoneBands, zoneLegend, type ZoneLegend } from './zoneBands'
// The timescale (JOS-71): which slice of the history the two plots show. The derivation is pure
// and lives beside them; this view owns only the PICK, which is session-lifetime state like every
// other toggle on this tab (nothing here is persisted, and the range selection never was either).
import {
  availableTimescales,
  resolveTimescale,
  visibleFrom,
  visibleSegments,
  type Timescale,
  type TimescaleId
} from './chartWindow'
import { TimescaleBar } from './TimescaleBar'
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
// The per-ability AA ladder — the flat purchases list's replacement in the same slot.
import { AaLedgerPanel } from './AaLedgerPanel'
// AA pace (AA/hr, points/hr, next-AA estimate, potion charges) — the tab's answer once the
// level bar caps out. `levelingWindows` is borrowed from the Overview card rather than
// re-derived: "the last hour of LOG time, anchored on the data's clock" is one rule, and two
// copies of it would drift the day one of them learns something. The dependency runs one way
// (that module already imports this feature's formatters; nothing there imports this view).
import { HEADLINE_WINDOW_LABEL, levelingWindows } from '../overview/overviewLevelingData'
import { AaPacePanel } from './AaPacePanel'

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
  drawn,
  aaEarned,
  chrome
}: {
  /** the WHOLE series — it decides whether this character has a curve at all. */
  points: AaPoint[]
  /** the part of it inside the chosen timescale — what the chart draws and the hover reads. */
  drawn: AaPoint[]
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
      <AreaChart points={drawn} color="#6fb3d2" chrome={chrome} />
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
  /** the runs inside the chosen timescale (the whole history at `All`). */
  segments: LevelSegment[]
  /** dings in the WHOLE series — it decides whether this character has a curve at all. */
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
  /** the scales this history can fill, and the one in force (which is `full` unless the pick
   *  survives the current character's span — see chartWindow.ts `resolveTimescale`). */
  scales: Timescale[]
  id: TimescaleId
  /** The AA curve CLIPPED to the window. Drawn by the chart and read by its hover layer — one
   *  array, so the tooltip can never name a point the curve does not show. */
  aaVisible: AaPoint[]
  /** The level runs clipped to the same window, with the same one-array rule. */
  segVisible: LevelSegment[]
}

/**
 * Everything the two charts must AGREE on, derived once.
 *
 * The domain is the seam (plan §6.1): both charts used to compute their own `t0/t1`, so a
 * zone band or a range selection at the same pixel meant two different instants. One
 * `ChartScale` over the level dings + AA gains + every progression column feeds the strip,
 * the drag selection and both plots — and since JOS-71 the TIMESCALE replaces that one object
 * wholesale, so a zoom moves everything at once or nothing at all (world-model law 9).
 *
 * The selection lives here (one hook call, not one per chart) — that is what makes a drag on
 * the AA chart and a drag on the level chart the SAME selection, with the newer one winning.
 */
function useLevelingCharts(o: {
  prog: ProgressionSnap
  levels: readonly LevelPoint[]
  aas: readonly AaPoint[]
  segments: readonly LevelSegment[]
  /** what the user asked for; the hook resolves it against what the log can fill. */
  picked: TimescaleId
}): LevelingCharts {
  const { prog, levels, aas, segments, picked } = o
  const extraTs = useMemo(() => [...levels.map((p) => p.ts), ...aas.map((a) => a.ts)], [levels, aas])
  const spanMs = useMemo(() => {
    const b = dataBounds(prog, extraTs)
    return b ? b.hi - b.lo : 0
  }, [prog, extraTs])
  const scales = useMemo(() => availableTimescales(spanMs), [spanMs])
  const id = resolveTimescale(picked, spanMs)
  const scale = useMemo(() => chartDomain(prog, extraTs, id), [prog, extraTs, id])
  // The two windowed series. Both charts and both hover layers read exactly these.
  const aaVisible = useMemo(() => (scale ? visibleFrom(aas, scale.t0) : []), [aas, scale])
  const segVisible = useMemo(() => (scale ? visibleSegments(segments, scale.t0) : []), [segments, scale])
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
  return { chrome, legend, stats, clear, scales, id, aaVisible, segVisible }
}

/**
 * The interleaved level/AA/swap feed, newest first — a pure derivation, lifted out of the view
 * so the component stays inside its measured line budget.
 *
 * A post-swap ding is the first level of a NEW loadout: the elapsed time back to the previous
 * ding spans the (unlogged) swap, so it is not a "time to level" — showing `+38.9h` there would
 * be fabricated. Label the swap instead.
 */
function buildFeed(levels: readonly LevelPoint[], aas: readonly AAEvent[]): FeedItem[] {
  const items: FeedItem[] = []
  for (const e of levelFeedEntries(levels)) {
    items.push({
      ts: e.ts,
      kind: e.afterSwap ? 'swap' : 'level',
      label: e.afterSwap ? `Level ${e.level} (class swap)` : `Level ${e.level}`,
      detail: e.afterSwap ? 'new loadout — level re-reported' : e.sinceMs != null ? `+${fmtDelta(e.sinceMs)}` : ''
    })
  }
  for (const a of aas) {
    items.push({ ts: a.ts, kind: 'aa', label: `+${a.amount} AA`, detail: `${a.nowHave} unspent` })
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, 60)
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

  // The purchases list itself moved into AaLedgerPanel, which regroups the same deduped
  // (ability, rank) purchases into per-ability LADDERS (src/shared/aaLedger.ts) — the model
  // always knew the rungs; only this view was flat.

  // `nowHave` rides along so the hover readout can state the unspent balance the gain line
  // itself reported, instead of re-deriving a balance the log already gave us.
  // `gain` rides along for the same reason: a windowed curve can open on a gain that has no
  // predecessor in the drawn array, and the tooltip must still name that LINE's own points.
  const aaCumulative = useMemo<AaPoint[]>(() => {
    let sum = 0
    return sortedAAs.map((a) => ({ ts: a.ts, y: (sum += a.amount), nowHave: a.nowHave, gain: a.amount }))
  }, [sortedAAs])

  const feed = useMemo(() => buildFeed(sortedLevels, sortedAAs), [sortedLevels, sortedAAs])

  // The timescale PICK — session-lifetime component state, exactly like the range selection this
  // tab already keeps that way. No store key: no adjacent toggle on this view persists (JOS-71's
  // brief), and a window is a thing you choose while you are looking, not a preference.
  const [picked, setPicked] = useState<TimescaleId>('full')
  const { chrome, legend, stats, clear, scales, id, aaVisible, segVisible } = useLevelingCharts({
    prog,
    levels: sortedLevels,
    aas: aaCumulative,
    segments: levelSegments,
    picked
  })

  // AA pace over the last hour of LOG time. A THIRD `rangeStats` call on this tab and
  // deliberately its own: the drag selection answers "how was that stretch", this answers "how
  // is it going right now", and folding the two would make the panel change meaning the moment
  // a user dragged. Null before the snapshot has folded anything at all.
  const pace = useMemo(() => {
    const hour = levelingWindows(prog).hour
    if (!hour || state.aaGains.length === 0) return null
    return aaPace({ leveling: state, prog, window: rangeStats({ snap: prog, range: hour }) })
  }, [prog, state])

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
            {pace && <AaPacePanel pace={pace} windowLabel={HEADLINE_WINDOW_LABEL} />}
            {/* Directly above the plots it governs, and ABOVE BOTH of them: the two charts draw
                one time base, so there is one control for it. */}
            <TimescaleBar scales={scales} id={id} scale={chrome.scale} onPick={setPicked} />
            <AaOverTimePanel points={aaCumulative} drawn={aaVisible} aaEarned={aaEarned} chrome={chrome} />
            <LevelOverTimePanel
              segments={segVisible}
              levelCount={sortedLevels.length}
              swaps={swaps}
              aaPoints={aaVisible}
              chrome={chrome}
              legend={legend}
            />
            {stats && <RangeStatsPanel stats={stats} onClear={clear} />}
          </Stack>

          <Stack spacing={2} sx={{ flex: 1, minWidth: 260, minHeight: 0 }}>
            <AaLedgerPanel spends={spends} allocated={aaSpent} />
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
