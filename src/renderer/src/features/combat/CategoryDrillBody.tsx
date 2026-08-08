// LEVEL 3 OF THE ONE DRILL: a single damage type of a single source — its lanes, its rates, and
// its multi-attack reading, in that order, in one column.
//
// THIS IS WHERE THE MULTI-ATTACK PANEL WENT (JOS-105, owner: "the multi-attack panel crowds out
// the normal combat panel. Kill the separate panel; integrate its stats into the single
// drill-down"). `MultiAttackPanel.tsx` used to render below the level-2 lane list as a second
// panel with its own heading, its own scroll box and its own fixed height, competing with the
// meter for the drill's vertical space. Its rows are unchanged — `multiAttackRows.ts` still
// shapes them and its tests still pin them — but they are now a SECTION of the level the user
// asked for, reached by clicking the damage type they are about.
//
// The rate is stated once, where it belongs: crit rate is the category's, off the engine's own
// `CategoryView.critPct`, not re-derived here. Resist rate appears only for the categories that
// can be resisted (the engine reports 0 for melee/slay/ds) — the same "state what exists, print
// no table of zeroes" rule the lane rows follow.
//
// Rendered by BOTH the Combat tab and the Overview card, from the same `MeterPanel` (level 3);
// `compact` is the Overview card's glance variant and is a PROP, never a second component.

import { Box, Stack, Typography } from '@mui/material'
import { CAT_COLOR, RESIST_COLOR, SkillBar } from './combatShared'
import { MoreRows, StatItem } from './meterBits'
import { procAnnotationFor, procTagIndex } from './procRows'
import type { CategoryDrillView } from './categoryDrill'
import type { MultiAttackRow } from './multiAttackRows'
import type { ProcSkillTag } from '@shared/procAnalytics'
import { formatNum as fmt } from '../../lib/formatRate'
import { useMemo } from 'react'

/** The multi-attack bar's accent — melee gold, because every round in it is a weapon swing. */
const ROUND_COLOR = CAT_COLOR.melee

/** A dense uppercase section caption, matching the drill's own readout captions. */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        fontSize: 9,
        lineHeight: 1.4,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'text.disabled'
      }}
    >
      {children}
    </Typography>
  )
}

/**
 * One attack type's multi-attack row: name, its own `est.` when the tier calls for it, then the
 * rates and the rounds they are over. Unchanged from the panel it came out of, down to the
 * testid — the e2e reads lanes by it, and the row did not change, only where it lives.
 */
function LaneRow({ row }: { row: MultiAttackRow }): React.JSX.Element {
  return (
    <Box
      data-testid="multi-attack-lane"
      sx={{ position: 'relative', height: 22, borderRadius: 0.5, mb: '3px', overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.04)' }}
    >
      <Box sx={{ position: 'absolute', inset: 0, width: `${Math.max(2, row.pct)}%`, bgcolor: ROUND_COLOR, opacity: 0.35 }} />
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ position: 'absolute', inset: 0, px: 0.75 }}>
        <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
          {row.label}
        </Typography>
        {row.estimated && (
          <Typography component="span" variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
            est.
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Typography component="span" variant="caption" noWrap sx={{ color: 'text.secondary' }}>
          {row.text}
        </Typography>
        <Typography component="span" variant="caption" noWrap>
          {fmt(row.rounds)} rounds
        </Typography>
      </Stack>
    </Box>
  )
}

/**
 * The category's headline figures. Crit rate is the one the ticket names; the rest are the
 * figures that were already on the level-2 legend chip this drill replaces, so nothing a reader
 * could see before is now one level further away.
 *
 * A rate that is not a thing for this category simply is not drawn (`resistPct` is 0 for every
 * melee-family category by construction of the engine's rollup).
 */
function CategoryStats({ d }: { d: CategoryDrillView }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
      <StatItem label="Total" value={fmt(d.total)} />
      <StatItem label="Hits" value={fmt(d.hits)} />
      <StatItem label="Crit rate" value={`${Math.round(d.critPct)}%`} />
      {d.crits > 0 && <StatItem label="Crits" value={fmt(d.crits)} />}
      <StatItem label="Max hit" value={fmt(d.max)} />
      {d.resists > 0 && (
        <StatItem label="Resist rate" value={`${Math.round(d.resistPct)}%`} color={RESIST_COLOR} />
      )}
    </Stack>
  )
}

/** The glance card's one-line stand-in for the stat strip — the same figures, no grid. */
function CompactStats({ d }: { d: CategoryDrillView }): React.JSX.Element {
  const parts = [`${fmt(d.total)} total`, `${fmt(d.hits)} hits`, `${Math.round(d.critPct)}% crit`]
  if (d.resists > 0) parts.push(`${Math.round(d.resistPct)}% resist`)
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.25 }}>
      {parts.join(' · ')}
    </Typography>
  )
}

/**
 * The multi-attack SECTION — the deleted panel's whole content, one level in. Silent for a
 * category that never opened an attack round, which is every caster category and is the same
 * silence the panel used to keep for a source that never swung.
 */
function MultiAttack({ d, cap }: { d: CategoryDrillView; cap: number | undefined }): React.JSX.Element | null {
  if (d.attack.length === 0 && d.flurry === null) return null
  const rows = cap === undefined ? d.attack : d.attack.slice(0, cap)
  return (
    <Box data-testid="multi-attack" sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <SectionLabel>Multi-attack</SectionLabel>
      <Box sx={{ mt: 0.5 }}>
        {rows.map((row) => (
          <LaneRow key={row.verb} row={row} />
        ))}
      </Box>
      {d.flurry !== null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {d.flurry}
        </Typography>
      )}
    </Box>
  )
}

export function CategoryDrillBody({
  detail,
  activeSec,
  procs,
  compact,
  maxRows,
  onMore
}: {
  detail: CategoryDrillView
  /** the segment's active seconds — every lane's own rate divides by it (petRows.laneDps). */
  activeSec: number
  /** the is-a-proc tags for THIS source — empty for anyone but you. */
  procs: readonly ProcSkillTag[]
  /** the Overview card's dense variant: one stat line, no grid. */
  compact?: boolean
  /** glance cap on the lane list and the attack list. */
  maxRows?: number
  onMore?: () => void
}): React.JSX.Element {
  const tags = useMemo(() => procTagIndex(procs), [procs])
  const shown = maxRows === undefined ? detail.rows : detail.rows.slice(0, maxRows)
  const hidden = detail.rows.length - shown.length
  return (
    <Box data-testid="category-drill">
      {compact ? <CompactStats d={detail} /> : <CategoryStats d={detail} />}
      {shown.map((s) => (
        <SkillBar
          key={`${s.category}|${s.name}`}
          s={s}
          activeSec={activeSec}
          compact={compact}
          proc={procAnnotationFor(tags, s.name)}
        />
      ))}
      {hidden > 0 && <MoreRows n={hidden} onMore={onMore} />}
      <MultiAttack d={detail} cap={maxRows} />
    </Box>
  )
}
