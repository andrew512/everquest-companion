// THE DAMAGE METER'S BODY — every level of it, for every surface that shows one.
//
// WHY IT IS ITS OWN MODULE (JOS-105, owner): "the Overview tab's damage panel behaves differently
// from the Combat tab - bars are not clickable, drill does not work. It must use THE EXACT SAME
// components so behavior is identical everywhere: combat overlay = combat module = overview
// combat tab. No forked panel implementations."
//
// It was already true of the ROWS' DATA — `petRows.meterPanel` has been the one row builder since
// JOS-35 — and false of the COMPONENTS. The Overview card drew its own bars (`Bar` with no
// `onClick`), kept its own three-value drill vocabulary (`sources | self | pet`), and reached
// past `meterPanel` to `ownBreakdown`/`nestedRows` directly. So a bar that drilled on the Combat
// tab was inert on Overview, and the two surfaces disagreed about what a drill even was.
//
// Now both render THIS, from the same `MeterPanel` and the same `Drill` token, and the glance
// card's density is a PROP:
//   `compact` — fewer badges per row, one stat line instead of a stat grid;
//   `maxRows` — the glance cap, with an honest `+n more` tail.
// A compact variant is a prop on the shared component, never a copy of it.
//
// The floating overlay renders the same LEVELS from the same builder but keeps its own chrome —
// it is a separate renderer entry with no MUI theme and cannot import a single component here
// (meterBars.tsx says so at length). Shared shaping, forked pixels, and that seam is deliberate.

import { useMemo } from 'react'
import { Box, Breadcrumbs, Button, IconButton, Link, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { CAT_COLOR, QuietNote, RESIST_COLOR, SkillBar } from './combatShared'
import { MoreRows } from './meterBits'
import { CategoryDrillBody } from './CategoryDrillBody'
import { EntityRow } from './EntityRow'
import { PetBar } from './PetBar'
import { procAnnotationFor, procTagIndex } from './procRows'
import type { Drill } from './dashboardData'
import type { MeterPanel, OwnRow } from './petRows'
import type { ProcSkillTag } from '@shared/procAnalytics'
import type { DamageCategory, SourceView } from '@shared/combat'
import { CATEGORY_LABEL } from '@shared/combat'
import { formatNum as fmt } from '../../lib/formatRate'
import { Tooltip } from '../../lib/Tooltip'

/** How a drill token is handed back up. `null` is level 1 — the explicit un-drill. */
export type SetDrill = ((d: Drill | null) => void) | null

/**
 * THE CATEGORY STRIP above the flat lane list — swatch, label, total, and the category-level
 * badges (crit%, resist%) that have lived on it since the category bars were removed.
 *
 * THE CHIPS NOW DRILL (JOS-105). They used to FILTER: clicking one hid every other category's
 * rows from the list below. That was a second interaction mechanic living beside the drill, and
 * the ticket's whole point is that there is one — so a click opens that damage type's own level,
 * which is the filtered list plus the stats the filter could never show (crit rate, and the
 * multi-attack reading that used to be a panel of its own).
 */
function CategoryStrip({
  e,
  active,
  onDrill
}: {
  e: SourceView
  /** the category currently open one level down, outlined so the strip says where you are. */
  active: DamageCategory | null
  onDrill: ((c: DamageCategory) => void) | null
}): React.JSX.Element | null {
  if (e.categories.length === 0) return null
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
      {e.categories.map((c) => {
        const on = active === c.category
        return (
          <Tooltip key={c.category} title={`${CATEGORY_LABEL[c.category]}: ${fmt(c.total)} over ${c.hits} hits · max ${fmt(c.max)}`}>
            <Box
              data-testid="category-chip"
              onClick={onDrill ? () => onDrill(c.category) : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.75,
                py: '2px',
                borderRadius: 999,
                cursor: onDrill ? 'pointer' : 'default',
                userSelect: 'none',
                border: '1px solid',
                borderColor: on ? CAT_COLOR[c.category] : 'divider',
                bgcolor: on ? `${CAT_COLOR[c.category]}22` : 'transparent',
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
              {onDrill && <ChevronRightIcon sx={{ fontSize: 13, color: 'text.disabled' }} />}
            </Box>
          </Tooltip>
        )
      })}
    </Stack>
  )
}

/**
 * LEVEL 2: the category strip + ONE flat ranked list of every skill/spell this entity landed.
 *
 * `rows` are `MeterPanel.rows` — this entity's lanes with any nested pets ranked among them
 * (non-empty only for YOUR row, and only while the 'Combine pet into your damage' preference is
 * on). Each pet nests as one line item that drills into that pet's own breakdown; nothing about
 * your per-skill rows changes, because a pet's damage is never folded into a lane of yours.
 *
 * The multi-attack panel used to ride below this list. It is one level down now — see
 * CategoryDrillBody.tsx.
 */
function EntityLanes({
  rows,
  activeSec,
  procs,
  compact,
  maxRows,
  onMore,
  setDrill
}: {
  rows: OwnRow[]
  /** The segment's active seconds — every lane's own rate divides by it (petRows.laneDps). */
  activeSec: number
  /** The is-a-proc tags for THIS source — empty for anyone but you. */
  procs: readonly ProcSkillTag[]
  compact?: boolean
  maxRows?: number
  onMore?: () => void
  setDrill: SetDrill
}): React.JSX.Element {
  const tags = useMemo(() => procTagIndex(procs), [procs])
  const shown = maxRows === undefined ? rows : rows.slice(0, maxRows)
  const hidden = rows.length - shown.length
  return (
    <Box>
      {shown.map((r) =>
        r.kind === 'pet' ? (
          <PetBar
            key={r.pet.id}
            pet={r.pet}
            pct={r.pct}
            onDrill={setDrill ? () => setDrill({ kind: 'entity', entityId: r.pet.id }) : undefined}
          />
        ) : (
          <SkillBar
            key={`${r.skill.category}|${r.skill.name}`}
            s={r.skill}
            activeSec={activeSec}
            compact={compact}
            proc={procAnnotationFor(tags, r.skill.name)}
          />
        )
      )}
      {rows.length === 0 && <QuietNote>No skill breakdown for this source.</QuietNote>}
      {hidden > 0 && <MoreRows n={hidden} onMore={onMore} />}
    </Box>
  )
}

/**
 * Drill-down breadcrumb + Back — ONE mechanism, at every level and on every surface.
 *
 * Two levels of nesting are possible below the source list, plus the pet case: a pet opened from
 * inside your breakdown is a level below it, and a category opened from inside a source's lane
 * list is a level below THAT. `parent` is what makes the trail honest in all three: Back goes to
 * the row this level was opened from, "All" still goes all the way out, and neither pretends a
 * nested pet was ever a top-level bar or that a damage type is a source.
 *
 * `compact` is the glance card's spelling of the same control — a chevron and the subject's name,
 * because a card four rows tall cannot spend a line on a breadcrumb trail. Same handler, same
 * destination, same `data-testid`.
 */
export function DrillCrumb({
  crumb,
  isTarget,
  parent,
  compact,
  setDrill
}: {
  crumb: string
  isTarget?: boolean
  /** the row this level was opened from (your row for a nested pet, the source for a category). */
  parent: SourceView | null
  compact?: boolean
  setDrill: (d: Drill | null) => void
}): React.JSX.Element {
  const up = (): void => setDrill(parent ? { kind: 'entity', entityId: parent.id } : null)
  const label = isTarget ? `damage to ${crumb}` : crumb
  if (compact) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mb: 0.25, minWidth: 0 }}>
        <IconButton size="small" data-testid="drill-back" onClick={up} sx={{ p: 0.25 }}>
          <ChevronLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Typography variant="caption" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Stack>
    )
  }
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
        <Link
          component="button"
          data-testid="drill-all"
          underline="hover"
          color="inherit"
          onClick={() => setDrill(null)}
          sx={{ fontSize: 12 }}
        >
          All
        </Link>
        {parent ? (
          <Link component="button" underline="hover" color="inherit" onClick={up} sx={{ fontSize: 12 }}>
            {parent.name}
          </Link>
        ) : null}
        <Typography variant="caption" color="text.primary">
          {label}
        </Typography>
      </Breadcrumbs>
    </Stack>
  )
}

/** What the crumb above a panel says, or null at level 1. Derived from the panel, never stored. */
export function crumbOf(panel: MeterPanel): { crumb: string; parent: SourceView | null } | null {
  if (panel.level === 1) return null
  if (panel.level === 2) return { crumb: panel.subject.name, parent: panel.parent }
  return { crumb: CATEGORY_LABEL[panel.detail.category], parent: panel.subject }
}

/**
 * THE BODY. One `MeterPanel` in, one column of rows out, at whichever level the shared builder
 * resolved. Every surface that shows a damage meter with MUI available renders exactly this.
 */
export function MeterRows({
  panel,
  activeSec,
  procs,
  setDrill,
  compact,
  maxRows,
  onMore,
  empty
}: {
  panel: MeterPanel
  activeSec: number
  /** the is-a-proc tags for the drilled source — the caller decides whose (yours, or none). */
  procs: readonly ProcSkillTag[]
  /** null ⇒ the rows render with no drill affordance (the Incoming direction, a locked surface). */
  setDrill: SetDrill
  compact?: boolean
  maxRows?: number
  onMore?: () => void
  /** what level 1 says when there is nothing to rank. */
  empty?: string
}): React.JSX.Element {
  // The category strip sits above BOTH inner levels: at level 2 it is the way in, and at level 3
  // it is still the way in — outlined on the type you are inside, so a reader can cross from
  // Melee to DoTs without stepping back out first. It is the drill's own map, not a filter.
  if (panel.level !== 1) {
    const subject = panel.subject
    return (
      // Keyed by subject so switching sources remounts the list rather than reconciling a
      // stranger's rows into it.
      <Box key={subject.id}>
        <CategoryStrip
          e={subject}
          active={panel.level === 3 ? panel.detail.category : null}
          onDrill={setDrill ? (c) => setDrill({ kind: 'category', entityId: subject.id, category: c }) : null}
        />
        {panel.level === 3 ? (
          <CategoryDrillBody
            detail={panel.detail}
            activeSec={activeSec}
            procs={procs}
            compact={compact}
            maxRows={maxRows}
            onMore={onMore}
          />
        ) : (
          <EntityLanes
            rows={panel.rows}
            activeSec={activeSec}
            procs={procs}
            compact={compact}
            maxRows={maxRows}
            onMore={onMore}
            setDrill={setDrill}
          />
        )}
      </Box>
    )
  }
  const shown = maxRows === undefined ? panel.sources : panel.sources.slice(0, maxRows)
  const hidden = panel.sources.length - shown.length
  if (shown.length === 0) return <QuietNote>{empty ?? 'No outgoing damage in this segment.'}</QuietNote>
  return (
    <>
      {shown.map((e, i) => (
        <EntityRow
          key={e.id}
          e={e}
          rank={i + 1}
          compact={compact}
          onDrill={setDrill ? () => setDrill({ kind: 'entity', entityId: e.id }) : undefined}
        />
      ))}
      {hidden > 0 && <MoreRows n={hidden} onMore={onMore} />}
    </>
  )
}
