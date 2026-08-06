import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useCombat } from './useCombat'
import { CombatTimeline } from './CombatTimeline'
import { CombatHeader } from './CombatHeader'
import { ProcessingLog } from './ProcessingLog'
import { SegmentBody } from './SegmentPanel'
import { DpsChartCard, MobDamageCard, type Ringless } from './CombatDashboard'
import { ProcsCard } from './ProcsPanel'
import { scopeOptions, type CombatScope, type Drill, type MeterMode, type ScopeOptions } from './dashboardData'
import { useMeterScope } from './useCombatPrefs'
import { EMPTY_ROSTER, type MeterScope, type RosterSnap } from '@shared/roster'
import { EMPTY_PET_CLAIMS, type PetClaimsSnap } from '@shared/petClaims'
import type { CombatFocus } from './combatFocus'
import type { CombatSnapshot, SegmentView, TimelineView } from '@shared/combat'

/**
 * Stabilise the timeline's IDENTITY across snapshot ticks. Every poll rebuilds the payload,
 * so a frozen finalized encounter would hand the dashboard a brand-new (but identical)
 * object each second and re-run every derivation. The signature below changes exactly when
 * the content can have changed — id, event count, raw count, duration — so a static
 * selection derives ONCE and a live fight still recomputes every tick.
 *
 * NO_SIG is the first-render sentinel: it only has to differ from every real signature (a
 * real one is '' for "no timeline", else 'id|…' with pipes) so the first render adopts.
 */
const NO_SIG = '<none>'

function useStableTimeline(tl: TimelineView | null | undefined): TimelineView | null {
  const sig = tl ? `${tl.id}|${tl.rawCount}|${tl.events.length}|${tl.durationMs}|${tl.lanes.length}` : ''
  const sigRef = useRef<string>(NO_SIG)
  const valRef = useRef<TimelineView | null>(null)
  if (sig !== sigRef.current) {
    sigRef.current = sig
    valRef.current = tl ?? null
  }
  return valRef.current
}

/**
 * HYDRATION state (Task #56). During the startup replay the engine is folding the whole log,
 * so every snapshot's "current fight" is an encounter from hours ago: the dashboard churned
 * through historical pulls as if they were live, then snapped to the real present. That is a
 * lie the UI shouldn't tell, so while `snap.hydrating` is true the dashboard body is this
 * quiet, dense placeholder — state ("Reading log…"), never process.
 */
function HydratingPanel(): React.JSX.Element {
  return (
    <Paper
      variant="outlined"
      data-testid="combat-hydrating"
      sx={{ p: 1.5, flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <CircularProgress size={13} thickness={5} />
        <Typography variant="caption" color="text.secondary">
          Reading log…
        </Typography>
      </Stack>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rounded" height={22} sx={{ mb: '3px', opacity: 1 - i * 0.15 }} />
      ))}
    </Paper>
  )
}

/**
 * Dashboard: FOUR EQUAL panels in a 2x2 grid — source meter, DPS over time, PROCS, damage by mob.
 *
 * THE ARRANGEMENT (JOS-37, owner ask). Cell 3 used to be the dedicated "You" breakdown preview:
 * a category bar plus your top skills, which is exactly what drilling your own row shows. It
 * retired. The cell went to PROCS — previously hidden behind a tab pair inside that very card,
 * where the owner could not find it, and the one dashboard subject that belongs to the SELECTION
 * rather than to a source. Multi-attack (the old Rounds block) deliberately did NOT take a cell:
 * it is a statement about one SOURCE's swings, so it stays in the drill beside that source's
 * skill list — a top-level "your multi-attack" panel would have re-created the You panel this
 * ticket just deleted. Four cells, four subjects: WHO, WHEN, WHAT FIRED, WHOM.
 *
 * `minmax(0, 1fr)` on both axes is the load-bearing bit: it lets every track
 * shrink below its content, so no panel can dictate the grid's size (the old flex rail gave the
 * meter a 1.5x column and squeezed the other three into a strip, and an intrinsic-size track is
 * exactly how a growing panel used to push the page taller). Each cell is a `fill` panel: 100%
 * of the cell, its own internal `overflow: auto`. At md the region is `overflow: hidden` and
 * sized by flexGrow between the header and the fixed-height combat log — so the view still has
 * NO page-level scroll (Task #56). Below md it collapses to ONE column of comfortably-tall
 * panels and the region scrolls.
 */
function DashboardGrid({
  seg,
  tl,
  mode,
  meterScope,
  roster,
  petClaims,
  drill,
  setDrill,
  live,
  ringless
}: {
  seg: SegmentView
  tl: TimelineView | null
  mode: MeterMode
  meterScope: MeterScope
  roster: RosterSnap
  petClaims: PetClaimsSnap
  drill: Drill | null
  setDrill: (d: Drill | null) => void
  live: boolean
  ringless: Ringless
}): React.JSX.Element {
  return (
    <Box
      data-testid="combat-dashboard"
      sx={{
        display: 'grid',
        gap: 1.5,
        flexGrow: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: { xs: 'auto', md: 'hidden' },
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
        gridTemplateRows: { xs: 'none', md: 'repeat(2, minmax(0, 1fr))' },
        // xs rows are a DEFINITE height on purpose: `auto` would let the meter's row list
        // size the track (an append-only panel sizing its own box is the Task #56 bug), so
        // each stacked panel gets a comfortable fixed box and scrolls inside it.
        gridAutoRows: { xs: '320px', md: 'minmax(0, 1fr)' },
        '& > *': { minWidth: 0, minHeight: 0 }
      }}
    >
      <SegmentBody
        seg={seg}
        tl={tl}
        mode={mode}
        scope={meterScope}
        roster={roster}
        petClaims={petClaims}
        drill={drill}
        setDrill={setDrill}
      />
      <DpsChartCard tl={tl} live={live} ringless={ringless} />
      {/* PROCS: the selection's own ledger, three columns (name · PPM · count). No subject of its
          own to keep in sync — it reads the same segment the meter ranks. */}
      <ProcsCard seg={seg} />
      {/* The mob card is DAMAGE by mob, and its level-2 body renders inside the meter panel — so
          in the Healing dimension (where that panel is listing healers) its rows are read-only
          rather than a click that opens nothing. It still shows its numbers: "what did I kill"
          is worth reading beside a heal meter, it just cannot take the panel over. */}
      <MobDamageCard
        seg={seg}
        tl={tl}
        ringless={ringless}
        drill={drill}
        setDrill={mode === 'heal' ? null : setDrill}
      />
    </Box>
  )
}

/**
 * DRILL STATE for the main panel — and the LEVEL it opens on.
 *
 * LEVEL 1, ALWAYS (owner ruling, 2026-08-05 — JOS-35): the tab opens on the ranked source list,
 * one bar per combatant, and a drill is something the USER did. It used to open on your own
 * breakdown whenever the pet preference was on (`petRows.defaultDrill`, deleted) — a shortcut
 * from when this app assumed solo play, and one that hid every group-mate's row behind a chevron
 * the moment the meters learned about groups.
 *
 * Two states now, not three: `null` is level 1 and it is both the opening value and what an
 * explicit un-drill produces, so there is nothing left for a third state to distinguish.
 *
 * Navigation NEVER writes a preference: drilling your row, a mob or a nested pet — and backing
 * out of any of them — is movement inside one fight, and the next fight still opens on level 1.
 * (A nested pet's Back hands us its PARENT, your breakdown, not `null`; the crumb spells that
 * hierarchy out.)
 */
function useDashboardDrill({
  mode,
  selection,
  view
}: {
  mode: MeterMode
  selection: string
  view: 'dash' | 'timeline'
}): { drill: Drill | null; setDrill: (d: Drill | null) => void } {
  const [drill, setDrill] = useState<Drill | null>(null)

  // A drill is per-fight and per-direction: changing either returns to level 1.
  useEffect(() => setDrill(null), [selection, mode])

  // Esc leaves the drill-down.
  useEffect(() => {
    if (view !== 'dash' || !drill) return
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      // Esc belongs to the innermost open thing. The fight picker owns it while its popover is
      // up (that is how you dismiss the search), so leaving the drill alone here is what keeps
      // one keypress from doing two things at once. The popover is portalled to <body>, so a
      // React-level stopPropagation in the picker could never reach this window listener.
      if (document.querySelector('[data-testid="fight-picker"]')) return
      setDrill(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, drill])

  return { drill, setDrill }
}

/** The timeline pane's defensive fallback — see CombatBody for why it should be unreachable. */
function NoTimelinePane(): React.JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2, flexGrow: 1 }}>
      <Typography color="text.secondary">No timeline for this selection — pick a recent fight.</Typography>
    </Paper>
  )
}

/**
 * Empty scope. A Fight scope with nothing in it stays empty on purpose — it does NOT borrow the
 * zone aggregate to look busy; Overall is one click away and says so.
 */
function ScopeEmptyPane({ scope }: { scope: 'fight' | 'overall' }): React.JSX.Element {
  return (
    <Paper variant="outlined" data-testid="scope-empty" sx={{ p: 2, flexGrow: 1 }}>
      <Typography color="text.secondary">
        {scope === 'fight'
          ? 'No fights yet — engage something and it’ll appear here live. Switch to Overall for this zone’s totals.'
          : 'No zone session yet — it starts with your first damage in a zone.'}
      </Typography>
    </Paper>
  )
}

/**
 * @param focus             a scope + selection to land on (a deep link from another tab —
 *                          Overview's "Open in Combat"). Re-applied whenever `focusNonce`
 *                          changes, so asking for the SAME fight twice works twice.
 * @param onFocusConsumed   told the moment the focus has been applied, so the router drops it.
 *                          Load-bearing: this view unmounts when you switch tabs, and a focus
 *                          still parked in the router would silently re-select a fight you had
 *                          already navigated away from the next time you came here.
 */
export default function CombatView({
  focus,
  focusNonce,
  onFocusConsumed
}: {
  focus?: CombatFocus | null
  focusNonce?: number
  onFocusConsumed?: () => void
}): React.JSX.Element {
  const {
    snap,
    showUnparsed,
    setShowUnparsed,
    selection,
    setSelection,
    scope,
    setScope,
    focusFight,
    maxSegments,
    loadMore
  } = useCombat()
  const [mode, setMode] = useState<MeterMode>('out')
  const [view, setView] = useState<'dash' | 'timeline'>('dash')
  // WHOSE damage (docs/plans/group-model.md §2) — persisted per surface, so the docked tab and a
  // pinned overlay can answer different questions. `EMPTY_ROSTER` while the first snapshot is in
  // flight means Group renders as Everyone for that instant, never as an empty meter.
  const [meterScope, setMeterScope] = useMeterScope('combat')
  const roster = snap?.roster ?? EMPTY_ROSTER
  const petClaims = petClaimsOf(snap)

  // An inbound focus (deep link) picks the scope + selection, then is consumed. Keyed on the
  // NONCE, not the payload's identity: the same fight asked for twice must select twice.
  useEffect(() => {
    if (!focus) return
    focusFight(focus)
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  const { opts, capped } = segmentOptions(snap, scope, maxSegments)
  // A single `now` for the whole render so all the relative-age labels agree; it advances
  // each snapshot tick (~1s idle, sub-second live) so ages stay live-updating and coarse.
  const now = Date.now()

  // Startup replay in progress (Task #56): the engine is still folding history, so nothing in
  // this snapshot describes the present. `snap === null` (first fetch in flight) reads the same
  // way — both are "we're not ready", and both render the quiet loading state.
  const hydrating = snap?.hydrating ?? true
  const seg = snap?.selected ?? null
  const tl = useStableTimeline(snap?.timeline)
  const ringless = ringlessOf(tl, seg)
  const live = isLiveSelection(opts, selection)
  const { drill, setDrill } = useDashboardDrill({ mode, selection, view })

  // TIMELINE AVAILABILITY. The timeline is drawn from an encounter's event ring, and a ring only
  // exists for the live + most recent fights (older ones drop theirs at finalize; a zone
  // aggregate never had one). Offering Timeline for those selections led straight to an empty
  // pane, which reads as a broken view rather than as "this selection has no such data" — so the
  // option DISABLES instead (with a tooltip saying why), and any selection change that would
  // strand you on an empty timeline falls back to the dashboard. `hydrating` is excluded because
  // during the startup replay `tl` is legitimately absent for a moment; disabling then would make
  // the switch flicker.
  const noTimeline = !hydrating && !tl
  useEffect(() => {
    if (view === 'timeline' && noTimeline) setView('dash')
  }, [view, noTimeline])

  return (
    // The tab owns exactly the height it's given: the dashboard (flexGrow) takes what's left
    // after the header and the FIXED-height combat log, and nothing here may spill into the
    // app's scrolling content area. Before Task #56 the unbounded log below did exactly that —
    // it grew past the viewport and pushed the dashboard to 0px, leaving "just a combat log".
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <CombatHeader
        seg={seg}
        snap={snap}
        scope={scope}
        setScope={setScope}
        opts={opts}
        selection={selection}
        setSelection={setSelection}
        loadMore={loadMore}
        capped={capped}
        hydrating={hydrating}
        now={now}
        view={view}
        setView={setView}
        noTimeline={noTimeline}
        mode={mode}
        setMode={setMode}
        meterScope={meterScope}
        setMeterScope={setMeterScope}
        roster={roster}
      />

      <CombatBody
        hydrating={hydrating}
        view={view}
        seg={seg}
        tl={tl}
        mode={mode}
        meterScope={meterScope}
        roster={roster}
        petClaims={petClaims}
        drill={drill}
        setDrill={setDrill}
        live={live}
        ringless={ringless}
        scope={scope}
      />

      <ProcessingLog lines={snap?.recent ?? []} showUnparsed={showUnparsed} setShowUnparsed={setShowUnparsed} />
    </Stack>
  )
}

/**
 * SCOPE decides what the selector may list — fights only, or zone sessions only. There is no
 * automatic switch between the two any more: between pulls the Fight scope keeps showing the
 * LAST fight (labeled as the last one), it never swaps itself to the zone aggregate.
 *
 * `capped`: the segment payload is capped at `maxSegments` finalized fights (newest-first), so
 * offer a "Load more" when the cap is likely truncating history.
 */
function segmentOptions(
  snap: CombatSnapshot | null,
  scope: CombatScope,
  maxSegments: number
): { opts: ScopeOptions; capped: boolean } {
  const segs = snap?.segments ?? []
  const zones = snap?.zoneSessions ?? []
  return {
    opts: scopeOptions(scope, segs, zones),
    capped: scope === 'fight' && segs.filter((s) => s.kind === 'fight').length >= maxSegments
  }
}

/**
 * Why the event-derived panels have nothing to show: a zone session keeps no ring at all, an
 * older fight had its ring dropped at finalize. Both are quiet notes, never errors.
 */
function ringlessOf(tl: TimelineView | null, seg: SegmentView | null): Ringless {
  if (tl) return null
  return seg?.kind === 'zone' ? 'zone' : 'evicted'
}

/**
 * A GENUINELY live selection — the open fight, or the running zone session. The scrolling chart
 * window only follows `now` for these: the head row between pulls is a finished fight, so it
 * must not scroll as if time were still passing in it.
 */
function isLiveSelection(opts: ScopeOptions, selection: string): boolean {
  return !!opts.head && selection === opts.head.value && opts.head.live
}

/**
 * The pet questions the meter should be asking (JOS-47). Off the SAME snapshot as the rows they
 * sit above, so an offer can never describe a fight the meter is no longer showing; empty while
 * the first fetch is in flight, which is also what nearly every player sees forever.
 */
function petClaimsOf(snap: CombatSnapshot | null): PetClaimsSnap {
  return snap?.petClaims ?? EMPTY_PET_CLAIMS
}

/** The one body slot: loading, the timeline, the 2x2 dashboard, or the honest empty state. */
function CombatBody({
  hydrating,
  view,
  seg,
  tl,
  scope,
  ...rest
}: {
  hydrating: boolean
  view: 'dash' | 'timeline'
  seg: SegmentView | null
  tl: TimelineView | null
  mode: MeterMode
  meterScope: MeterScope
  roster: RosterSnap
  petClaims: PetClaimsSnap
  drill: Drill | null
  setDrill: (d: Drill | null) => void
  live: boolean
  ringless: Ringless
  scope: 'fight' | 'overall'
}): React.JSX.Element {
  if (hydrating) return <HydratingPanel />
  if (view === 'timeline') {
    // Defensive only: the Timeline option now disables (and this view falls back to the
    // dashboard) whenever the selection has no event ring, so the fallback pane should be
    // unreachable. It stays as the belt-and-braces for a selection that loses its ring
    // between renders.
    return tl ? <CombatTimeline tl={tl} /> : <NoTimelinePane />
  }
  if (!seg) return <ScopeEmptyPane scope={scope} />
  return <DashboardGrid seg={seg} tl={tl} {...rest} />
}
