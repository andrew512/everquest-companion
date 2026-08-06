// ONE ROW of the source meter — the ranked bar that IS the combat tab's level 1. Its
// value-equality memo is the reason a 1s snapshot tick doesn't re-render a frozen fight's whole
// list, so it lives in its own module with that gate.

import { memo, useState } from 'react'
import { Box, Chip, Collapse, Typography } from '@mui/material'
import { Bar, KIND_COLOR, RESIST_COLOR, SkillBar } from './combatShared'
import { flattenSkills } from './dashboardData'
import { formatNum as fmt, formatRate } from '../../lib/formatRate'
import type { SourceView } from '@shared/combat'
import { Tooltip } from '../../lib/Tooltip'

/**
 * WHOSE ROW THIS IS, in one word beside the name. `you` and `enemy` get nothing: the direction
 * filter already said which of the two you are looking at, and a row tagged 'you' in your own
 * damage list is noise. The two that DO need a word are the ones a bare name cannot tell apart
 * from you — your pet, and a group-mate (docs/plans/group-model.md).
 *
 * State, never process (AGENTS.md): the word names what the row IS, and it carries no tooltip,
 * because a chip reading 'group' beside a player's name has nothing left to explain. "Why is
 * this name here?" is answered where it can be answered properly — the roster popover, with
 * provenance (ScopeChip.tsx).
 *
 * HERE rather than in combatShared.tsx because this is that file's only consumer and it sits at
 * the measured line ceiling: the rule is to split rather than ratchet.
 */
const KIND_TAG: Partial<Record<string, string>> = { pet: 'pet', member: 'group' }

function KindChip({ kind }: { kind: string }): React.JSX.Element | null {
  const tag = KIND_TAG[kind]
  if (tag === undefined) return null
  return (
    <Chip label={tag} size="small" sx={{ ml: 0.5, height: 14, fontSize: 9, bgcolor: `${KIND_COLOR[kind] ?? '#888'}33` }} />
  )
}

function missSummary(m: SourceView['missBreakdown']): string {
  const parts: string[] = []
  if (m.miss) parts.push(`${m.miss} miss`)
  if (m.dodge) parts.push(`${m.dodge} dodge`)
  if (m.parry) parts.push(`${m.parry} parry`)
  if (m.riposte) parts.push(`${m.riposte} riposte`)
  if (m.block) parts.push(`${m.block} block`)
  if (m.absorb) parts.push(`${m.absorb} absorb`)
  return parts.join(' · ') || 'none'
}

export const EntityRow = memo(function EntityRow({
  e,
  rank,
  onDrill
}: {
  e: SourceView
  rank: number
  onDrill?: () => void
}): React.JSX.Element {
  // Fallback inline expand (the same flat, category-colored skill list) for the incoming
  // view, which has no drill-down; the outgoing view uses onDrill instead.
  const [open, setOpen] = useState(false)
  const crit = e.critPct >= 1 ? ` · ${Math.round(e.critPct)}% crit` : ''
  // hit% only meaningful when swings were avoided (melee sources); hide at 100%.
  const swings = e.hits + e.misses
  const hitBadge =
    e.misses > 0 ? (
      <Tooltip title={`${e.hits} landed / ${swings} swings — avoided: ${missSummary(e.missBreakdown)}`}>
        <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary' }}>
          {Math.round(e.hitPct)}% hit
        </Typography>
      </Tooltip>
    ) : null
  // Spell-resist rate badge (Task #51 v2) — resists / (spell+dot casts + resists).
  const resistBadge =
    e.resists > 0 ? (
      <Tooltip title={`${e.resists} of your detrimental spells were resisted — ${Math.round(e.resistPct)}% resist rate (resists ÷ spell casts).`}>
        <Typography component="span" variant="caption" sx={{ ml: 0.5, color: RESIST_COLOR }}>
          {Math.round(e.resistPct)}% resist
        </Typography>
      </Tooltip>
    ) : null
  const onClick = onDrill ?? (e.skills.length ? () => setOpen((o) => !o) : undefined)
  return (
    <Box data-testid="meter-row">
      <Bar
        color={KIND_COLOR[e.kind] ?? '#888'}
        pct={e.pct}
        rank={rank}
        onClick={onClick}
        name={
          <>
            {e.name}
            <KindChip kind={e.kind} />
            {/* Not gated on `kind` any more: with the pet preference on, a pet's damage is
                folded into YOUR level-1 bar (petRows.meterSources) and its name-ambiguity comes
                with it. The badge belongs to the number, wherever the number is shown. */}
            {e.ambiguousHits > 0 && (
              <Tooltip
                title={`${e.ambiguousHits} hit${e.ambiguousHits === 1 ? '' : 's'} (${fmt(
                  e.ambiguousTotal
                )} dmg) are name-ambiguous: a same-named hostile twin exists, so this damage could belong to the twin rather than your pet.`}
              >
                <Chip
                  label="~"
                  size="small"
                  sx={{ ml: 0.5, height: 14, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(207,102,121,0.25)' }}
                />
              </Tooltip>
            )}
            {hitBadge}
            {resistBadge}
          </>
        }
        right={`${fmt(e.total)} · ${formatRate(e.dps)}${crit}`}
      />
      {!onDrill && (
        <Collapse in={open}>
          <Box sx={{ pl: 3, pr: 0.5, py: 0.5 }}>
            {flattenSkills(e).map((s) => (
              <SkillBar key={`${s.category}|${s.name}`} s={s} />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  )
},
// Value-equality gate: a fresh snapshot rebuilds every SourceView object each
// tick (new references) even when the underlying data is unchanged — which is
// ALWAYS the case for a selected finalized fight (its aggregate is frozen). A
// reference-only memo would never skip; comparing the rendered fields by value
// lets those rows skip re-render, so only the genuinely-changing live/current
// rows re-render per tick. The SourceView is small, so this compare is cheap.
sourceViewEqual)

function sourceViewEqual(
  prev: { e: SourceView; rank: number; onDrill?: () => void },
  next: { e: SourceView; rank: number; onDrill?: () => void }
): boolean {
  return prev.rank === next.rank && !!prev.onDrill === !!next.onDrill && JSON.stringify(prev.e) === JSON.stringify(next.e)
}
