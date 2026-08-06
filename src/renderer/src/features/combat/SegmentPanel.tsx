// The dashboard's ANCHOR PANEL — the source meter (level 1) and, when drilled, ONE level-2
// subject. Split out of CombatView.tsx; the tab is now header + body + log, and this is the body's
// first cell.
//
// The two drill kinds are a union, so there is always exactly one breadcrumb: an entity's flat
// skill list, or a MOB's (everything you + pet landed on it).

import { useMemo, useState } from 'react'
import { Box, Breadcrumbs, Button, Link, Paper, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { TargetSkillBars } from './CombatDashboard'
import { EntityRow } from './EntityRow'
import { PetBar } from './PetBar'
import { CAT_COLOR, QuietNote, RESIST_COLOR, SkillBar } from './combatShared'
import { skillsForTarget, type Drill, type MeterMode, type TargetDetail } from './dashboardData'
import { HealBody } from './HealPanel'
import { MultiAttackPanel } from './MultiAttackPanel'
import { PetClaimOffer } from './PetClaimOffer'
import { SegmentHeader } from './SegmentHeader'
import { procAnnotationFor, procTagIndex } from './procRows'
import { meterPanel, type MeterPanel, type OwnRow } from './petRows'
import { scopeSources, scopeTotals } from './meterScope'
import { useCombinePetRow } from './useCombatPrefs'
import { formatEntityText, formatSegmentText, formatTargetText } from './copyText'
import { formatNum as fmt } from '../../lib/formatRate'
import type { DamageCategory, SegmentView, SourceView, TimelineView } from '@shared/combat'
import type { ProcSkillTag } from '@shared/procAnalytics'
import type { MeterScope, RosterSnap } from '@shared/roster'
import type { PetClaimsSnap } from '@shared/petClaims'
import { CATEGORY_LABEL } from '@shared/combat'
import { Tooltip } from '../../lib/Tooltip'

function IncomingHeals({ seg }: { seg: SegmentView }): React.JSX.Element | null {
  if (seg.incomingHealTotal <= 0) return null
  const top = seg.incomingHealers.slice(0, 4)
  return (
    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" sx={{ color: '#5fbf7f', fontWeight: 600 }}>
        Heals received: {fmt(seg.incomingHealTotal)}
      </Typography>
      {top.map((h) => (
        <Typography key={h.name} variant="caption" sx={{ display: 'block', color: 'text.secondary', pl: 1 }}>
          {h.name} · {fmt(h.total)} ({h.count})
        </Typography>
      ))}
    </Box>
  )
}

/**
 * The compact category legend above the flat list: swatch + label + total, carrying the
 * category-level badges (crit%, resist%) that used to live on the removed category bars.
 * Chips double as filters — click to isolate one category, click again to clear.
 */
function CategoryLegend({
  e,
  active,
  onToggle
}: {
  e: SourceView
  active: DamageCategory | null
  onToggle: (c: DamageCategory) => void
}): React.JSX.Element | null {
  if (e.categories.length === 0) return null
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
      {e.categories.map((c) => {
        const on = active === c.category
        return (
          <Tooltip
            key={c.category}
            title={`${CATEGORY_LABEL[c.category]}: ${fmt(c.total)} over ${c.hits} hits · max ${fmt(c.max)} — click to ${
              on ? 'show all categories' : 'show only this category'
            }`}
          >
            <Box
              onClick={() => onToggle(c.category)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: '2px',
                borderRadius: 999,
                cursor: 'pointer',
                userSelect: 'none',
                border: '1px solid',
                borderColor: on ? CAT_COLOR[c.category] : 'divider',
                bgcolor: on ? `${CAT_COLOR[c.category]}22` : 'transparent',
                opacity: active && !on ? 0.45 : 1,
                '&:hover': { borderColor: CAT_COLOR[c.category] }
              }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: CAT_COLOR[c.category], flexShrink: 0 }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {CATEGORY_LABEL[c.category]}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fmt(c.total)}
              </Typography>
              {c.critPct >= 1 && (
                <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                  {Math.round(c.critPct)}% crit
                </Typography>
              )}
              {c.resists > 0 && (
                <Typography component="span" variant="caption" sx={{ color: RESIST_COLOR }}>
                  {Math.round(c.resistPct)}% resist
                </Typography>
              )}
            </Box>
          </Tooltip>
        )
      })}
    </Stack>
  )
}

/**
 * Level-2 (one of two level-2 subjects): the category legend + ONE flat ranked list of every
 * skill/spell this entity landed. The multi-attack panel rides along below it.
 *
 * `rows` are `MeterPanel.rows` — built by `petRows.meterPanel`, the ONE row builder the floating
 * overlay uses too. They are this entity's skill lanes with any nested pets ranked among them
 * (non-empty only for YOUR row, and only while the 'Combine pet into your damage' preference is
 * on). Each pet nests as one line item that drills into that pet's own breakdown; nothing about
 * your per-skill rows changes, because a pet's damage is never folded into a lane of yours.
 *
 * A category filter hides them: the legend filters YOUR categories, and a pet is not one of
 * them — showing it under "Melee only" would claim it was melee damage of yours.
 */
function EntitySkillBars({
  e,
  rows: all,
  activeSec,
  procs,
  onDrillPet
}: {
  e: SourceView
  rows: OwnRow[]
  /** The segment's active seconds — every lane's own rate divides by it (petRows.laneDps). */
  activeSec: number
  /** The is-a-proc tags for THIS source — empty for anyone but you (see `SegmentContent`). */
  procs: readonly ProcSkillTag[]
  onDrillPet: (id: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<DamageCategory | null>(null)
  const rows = filter ? all.filter((r) => r.kind === 'skill' && r.skill.category === filter) : all
  const tags = useMemo(() => procTagIndex(procs), [procs])
  return (
    <Box>
      <CategoryLegend e={e} active={filter} onToggle={(c) => setFilter((f) => (f === c ? null : c))} />
      {rows.map((r) =>
        r.kind === 'pet' ? (
          <PetBar key={r.pet.id} pet={r.pet} pct={r.pct} onDrill={() => onDrillPet(r.pet.id)} />
        ) : (
          <SkillBar
            key={`${r.skill.category}|${r.skill.name}`}
            s={r.skill}
            activeSec={activeSec}
            proc={procAnnotationFor(tags, r.skill.name)}
          />
        )
      )}
      {rows.length === 0 && <QuietNote>No skill breakdown for this source.</QuietNote>}
      {/* MULTI-ATTACK (JOS-37): per attack type, how often it doubled, tripled, flurried — the
          stats that are orthogonal to damage. Reads the SELECTED segment's source row, so it is
          scope-aware (fight / overall) with no state of its own, and it renders nothing for a
          source that never swung. It stays HERE, one level down, because it is a statement about
          ONE source's swings and the drill is where a source is the subject. */}
      <MultiAttackPanel source={e} />
    </Box>
  )
}

/**
 * Drill-down breadcrumb + Back. Two levels, plus ONE nested case: a pet that was opened from
 * inside your breakdown (petRows.ts) is a level below it, and the crumb says so —
 * `All › You › Vebarn`. `parent` is what makes the trail honest: Back goes to the row the pet
 * was clicked from, "All" still goes all the way out, and neither pretends the pet is a
 * top-level source while it is being shown as a line item of yours.
 */
function DrillCrumb({
  crumb,
  isTarget,
  parent,
  setDrill
}: {
  crumb: string
  isTarget: boolean
  /** the source this drill was nested inside, when it was (your row, for a nested pet). */
  parent: SourceView | null
  setDrill: (d: Drill | null) => void
}): React.JSX.Element {
  const up = (): void => setDrill(parent ? { kind: 'entity', entityId: parent.id } : null)
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75, flexShrink: 0 }}>
      <Button
        size="small"
        data-testid="drill-back"
        startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
        onClick={up}
        sx={{ minWidth: 0, py: 0 }}
      >
        Back
      </Button>
      <Breadcrumbs separator="›" sx={{ fontSize: 12 }}>
        <Link component="button" underline="hover" color="inherit" onClick={() => setDrill(null)} sx={{ fontSize: 12 }}>
          All
        </Link>
        {parent ? (
          <Link component="button" underline="hover" color="inherit" onClick={up} sx={{ fontSize: 12 }}>
            {parent.name}
          </Link>
        ) : null}
        <Typography variant="caption" color="text.primary">
          {isTarget ? `damage to ${crumb}` : crumb}
        </Typography>
      </Breadcrumbs>
    </Stack>
  )
}

// ── drill resolution ───────────────────────────────────────────────────────────────────

/** Which level-2 subject (if any) the current drill resolves to, against THIS segment. */
interface DrillState {
  entity: SourceView | undefined
  targetName: string | null
  targetDetail: TargetDetail | null
  /** the breadcrumb label; null means we are at level 1. */
  crumb: string | null
}

/**
 * The ENTITY half of the drill is `MeterPanel`'s business — including the stale case, where a
 * drill pointing at an entity no longer present (the fight changed) resolves to level 1. This
 * hook only adds the MOB drill, which is this surface's alone: it reads the timeline's ring, and
 * goes stale the same way when the ring disappears.
 */
function useDrillState(panel: MeterPanel, tl: TimelineView | null, drill: Drill | null): DrillState {
  const entity = panel.level === 2 ? panel.subject : undefined
  const targetName = drill?.kind === 'target' ? drill.target : null
  const targetDetail = useMemo(
    () => (tl && targetName ? skillsForTarget(tl, targetName) : null),
    [tl, targetName]
  )
  return { entity, targetName, targetDetail, crumb: entity?.name ?? (targetDetail ? targetName : null) }
}

/**
 * The is-a-proc tags that belong to ONE drilled source: yours, or none.
 *
 * The proc ledger is folded from YOUR procs — poison Strikes on your blades, cast-less effects
 * behind your swings — so tagging a pet's lanes with those rates would credit your blades to the
 * pet. Its own function rather than a ternary at the call site so `SegmentContent` stays inside
 * the complexity budget with room to spare.
 */
function ownProcTags(seg: SegmentView, e: SourceView): readonly ProcSkillTag[] {
  return e.kind === 'you' ? (seg.procs.procSkills ?? []) : []
}

/** The scrolling body: the ranked source list at level 1, one level-2 subject when drilled. */
function SegmentContent({
  seg,
  mode,
  rows,
  ownRows,
  scope,
  roster,
  d,
  drill,
  setDrill
}: {
  seg: SegmentView
  mode: MeterMode
  /** the level-1 bars — `MeterPanel.sources`, so the pet is folded into your row when the
   *  preference says so and appears nowhere twice. Empty while a level-2 subject is open. */
  rows: SourceView[]
  /** the drilled source's rows (skill lanes + nested pets) — `MeterPanel.rows`, empty at level 1. */
  ownRows: OwnRow[]
  scope: MeterScope
  roster: RosterSnap
  d: DrillState
  /** the raw token — the Healing dimension resolves it against healers, not damage sources. */
  drill: Drill | null
  setDrill: (drill: Drill | null) => void
}): React.JSX.Element {
  // THE HEALING DIMENSION IS ITS OWN LIST, top to bottom (P2). It shares this scroll box, the
  // drill token and the segment header — and nothing else: healers are not damage sources, so
  // there is no ranked-source level to reuse and no category legend to filter by.
  if (mode === 'heal') {
    return (
      <Box data-testid="meter-body" sx={{ overflow: 'auto', flexGrow: 1, minHeight: 0 }}>
        <HealBody healing={seg.healing} scope={scope} roster={roster} drill={drill} setDrill={setDrill} />
      </Box>
    )
  }

  return (
    <Box data-testid="meter-body" sx={{ overflow: 'auto', flexGrow: 1, minHeight: 0 }}>
      {!d.crumb &&
        (rows.length ? (
          rows.map((e, i) => (
            <EntityRow
              key={e.id}
              e={e}
              rank={i + 1}
              onDrill={mode === 'out' ? () => setDrill({ kind: 'entity', entityId: e.id }) : undefined}
            />
          ))
        ) : (
          <QuietNote>
            {mode === 'out' ? 'No outgoing damage in this segment.' : 'No incoming damage in this segment.'}
          </QuietNote>
        ))}

      {/* Keyed by entity so switching sources resets the legend's category filter. Pets nest
          into YOUR row only — drilling the pet itself shows the pet's own list, never a pet
          nested inside a pet. */}
      {d.entity && (
        <EntitySkillBars
          key={d.entity.id}
          e={d.entity}
          rows={ownRows}
          activeSec={seg.activeSec}
          procs={ownProcTags(seg, d.entity)}
          onDrillPet={(id) => setDrill({ kind: 'entity', entityId: id })}
        />
      )}
      {!d.entity && d.targetDetail && d.targetName && (
        <TargetSkillBars target={d.targetName} detail={d.targetDetail} seg={seg} />
      )}

      {mode === 'in' && !d.crumb && <IncomingHeals seg={seg} />}
    </Box>
  )
}

/**
 * WHAT THE SELECTED DIMENSION IS MADE OF: the rows it ranks and the two headline figures.
 *
 * The header total/DPS stay the SEGMENT's (you + every pet) at every drill level — the same
 * aggregate the Overview card headlines, so the two surfaces can never disagree on a number.
 * The healing pair is `HealingView`'s own total/hps: restored hit points + granted absorption,
 * exactly the figures the heal overlays headline (shared/combat.ts states what each includes).
 *
 * Healing ranks HEALERS, not damage sources, so `rows` is empty there rather than borrowed —
 * `meterPanel` over an empty list yields level 1 with nothing in it, the right no-op while
 * another dimension is on screen.
 */
function dimension(seg: SegmentView, mode: MeterMode): { rows: SourceView[]; total: number; dps: number } {
  if (mode === 'heal') return { rows: [], total: seg.healing.total, dps: seg.healing.hps }
  if (mode === 'in') return { rows: seg.incoming, total: seg.inTotal, dps: seg.inDps }
  return { rows: seg.entities, total: seg.outTotal, dps: seg.outDps }
}

/**
 * …and the same three things once the SCOPE has had its say (docs/plans/group-model.md §2).
 *
 * Only the OUTGOING dimension is scoped, because scope is a statement about whose damage — the
 * incoming list is always "what is hitting You", and no roster changes that. The headline pair
 * is recomputed from the surviving rows rather than carried over: `outTotal` counts members, so
 * a You-scoped list under a group-scoped total would headline a number no visible row explains.
 */
function scopedDimension(
  seg: SegmentView,
  mode: MeterMode,
  scope: MeterScope,
  roster: RosterSnap
): { rows: SourceView[]; total: number; dps: number } {
  const base = dimension(seg, mode)
  if (mode !== 'out') return base
  const rows = scopeSources(base.rows, scope, roster)
  return { rows, ...scopeTotals(base.rows, rows, base.total, base.dps) }
}

/**
 * MAY THE PET QUESTION BE ASKED HERE? (JOS-47 + JOS-49.)
 *
 * OUTGOING, because that is the only list a pet's damage belongs in. Deliberately NOT filtered
 * by the You/Group/Everyone scope: ownership is not a scoped idea, and no scope makes an unowned
 * pet appear.
 *
 * LIVE SELECTION, which is the owner's JOS-49 override of exactly that reasoning. Ownership is
 * not scoped, but the QUESTION is: it asks the user to look up at the fight in front of them and
 * say whose that pet is. Above a finalized fight, or a zone session left days ago, there is
 * nothing to look at — and a wall of those rows is what made the meter unusable. Main's currency
 * gate decides WHETHER there is a current question; this decides WHERE it may be asked.
 *
 * A function rather than an inline conjunction because the panel is at its complexity ceiling,
 * and because the overlay makes the identical decision (overlay/meterBars.tsx) — the two are
 * pinned together by tests/petOfferSurface.test.mts.
 */
function askPetClaim(mode: MeterMode, live: boolean): boolean {
  return mode === 'out' && live
}

export function SegmentBody({
  seg,
  tl,
  mode,
  scope,
  roster,
  petClaims,
  live,
  drill,
  setDrill
}: {
  seg: SegmentView
  tl: TimelineView | null
  mode: MeterMode
  scope: MeterScope
  roster: RosterSnap
  petClaims: PetClaimsSnap
  /** Is the SELECTION the live one — an open fight or the running zone session? Gates the pet
   *  question alone (dashboardData `isLiveSelection`); nothing else in this panel reads it. */
  live: boolean
  drill: Drill | null
  setDrill: (d: Drill | null) => void
}): React.JSX.Element {
  const heal = mode === 'heal'
  const { rows: scoped, total, dps } = scopedDimension(seg, mode, scope, roster)
  const [combinePetRow] = useCombinePetRow()
  // THE one row builder — the same call the floating overlay makes (petRows.meterPanel). Nesting
  // is an OUTGOING idea: the Incoming direction lists enemies, and none of them owns a pet of
  // yours, so the preference is folded into the `combine` argument rather than tested downstream.
  const panel = meterPanel(scoped, mode === 'out' && combinePetRow, drill?.kind === 'entity' ? drill.entityId : null)
  const d = useDrillState(panel, tl, drill)
  // The BARS are the builder's, not the scoped list: at level 1 that is the list with your pets
  // folded into your row (JOS-35 — with the preference on the pet must not also be its own bar).
  const rows = panel.level === 1 ? panel.sources : []
  const ownRows = panel.level === 2 ? panel.rows : []
  const pets = panel.level === 2 ? panel.pets : []
  // A drilled pet is NESTED (and so has a parent in the trail) only while it is actually being
  // shown as a line item inside your row — i.e. while the preference is on and you have a row.
  const nestedIn = panel.level === 2 ? panel.parent : null

  // "Copy this view" means THIS view: the same three-way choice the body below makes, so the
  // clipboard can never hold a level the user isn't looking at. Built on click, never on render.
  const copyView = (): string =>
    d.entity
      ? // The SAME pets the body nests into this list — `MeterPanel.pets` IS what was nested,
        // so the clipboard can no longer drop a row the reader can see on screen.
        formatEntityText(seg, d.entity, pets)
      : d.targetDetail && d.targetName
        ? formatTargetText(seg, d.targetName, d.targetDetail)
        : formatSegmentText(seg, mode === 'in' ? 'in' : 'out')

  return (
    // Grid-cell sizing, exactly like DashCard's `fill`: 100% of the cell, zero intrinsic
    // height (so a `minmax(0, 1fr)` row can shrink it), everything below the header scrolls
    // internally. The meter must never be what makes the dashboard taller than its box.
    <Paper
      variant="outlined"
      data-testid="dash-panel"
      sx={{
        p: 1.5,
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <SegmentHeader seg={seg} mode={mode} total={total} dps={dps} copyView={heal ? null : copyView} />
      {/* "IS THIS YOURS?" (JOS-47 + JOS-49) — directly under the headline it would change.
          `askPetClaim` above has the two conditions and why each one is there. */}
      {askPetClaim(mode, live) && <PetClaimOffer petClaims={petClaims} />}
      {/* The damage crumb; the Healing dimension draws its own inside HealBody, because its one
          drill level has no nested-pet case and therefore no parent link to render. */}
      {!heal && d.crumb && (
        <DrillCrumb crumb={d.crumb} isTarget={!!d.targetDetail} parent={nestedIn} setDrill={setDrill} />
      )}
      <SegmentContent
        seg={seg}
        mode={mode}
        rows={rows}
        ownRows={ownRows}
        scope={scope}
        roster={roster}
        d={d}
        drill={drill}
        setDrill={setDrill}
      />
    </Paper>
  )
}
