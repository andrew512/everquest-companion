// THE ROUNDS PANEL (docs/plans/attack-round-stats.md §3) — riposte, flurry, round structure and
// the modifier tallies for ONE source, rendered inside the Combat drill beside that source's
// skill breakdown. Scope-aware for free: it reads the SELECTED segment's `SourceView`, so a
// fight and a zone session answer with their own numbers and nothing here knows the difference.
//
// TWO HONESTY RULES DRIVE THE WHOLE LAYOUT:
//   1. DENOMINATORS ARE VISIBLE. Every rate prints beside the count it is over, and the count is
//      ROUNDS, never swings (law 11's spirit: a rate without its exposure is a lie). The
//      swings-per-round split is shown in full, so "60% multi" can always be checked.
//   2. THE TIER IS ON THE ROW. A reuse-timer lane (backstab, bash, kick, the monk strike lane)
//      shows its 2x/3x split as a per-event reading; a weapon verb shows the aggregate rate and
//      wears an `inferred` chip, because dual wield puts two weapons on one verb and a
//      same-second 2x may be two hands. The tooltip says which and why (roundRows.ts owns the
//      wording, so a node test can pin it).
//
// It REPLACES the one-line "Melee rounds:" footer this drill used to end with. That heuristic
// grouped by (skill, second) with no target grouping, no exclusions and landed hits only — it
// counted a double-attack round fanned across two mobs as two rounds, and a riposte counter as
// part of the round it interrupted. Its field stays on the wire (`SourceView.rounds`) and the
// clipboard still carries it; the screen now shows the better answer.

import { Box, Stack, Typography } from '@mui/material'
import { formatNum as fmt } from '../../lib/formatRate'
import { Tooltip } from '../../lib/Tooltip'
import { CAT_COLOR, RESIST_COLOR } from './combatShared'
import {
  exclusionHint,
  exclusionNote,
  flurryHint,
  riposteHint,
  roundLaneRows,
  type RoundLaneRow
} from './roundRows'
import type { SourceRoundsView, SourceView } from '@shared/combat'

/** The panel's own accent — melee gold, because every round in it is a weapon swing. */
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

/** One state chip. Chips convey STATE (UI conventions) — never a caption about method. */
function Chip({
  label,
  hint,
  color,
  outlined
}: {
  label: string
  hint: string
  color?: string
  outlined?: boolean
}): React.JSX.Element {
  return (
    <Tooltip title={hint}>
      <Box
        sx={{
          px: 0.75,
          py: '1px',
          borderRadius: 999,
          border: '1px solid',
          borderColor: outlined ? (color ?? 'divider') : 'divider',
          bgcolor: outlined ? 'transparent' : 'rgba(255,255,255,0.04)',
          whiteSpace: 'nowrap'
        }}
      >
        <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: color ?? 'text.secondary' }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  )
}

/** The header chips: the round denominator, riposte given/taken, flurry, rampage taken. */
function RoundChips({ r }: { r: SourceRoundsView }): React.JSX.Element {
  const excluded = exclusionNote(r)
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
      <Chip
        label={`${fmt(r.primaryRounds)} rounds`}
        hint="Attack rounds counted for this source: swings grouped by (verb, second, target), with one swing fanned across two defenders collapsed to a single round. Every rate in this panel is over THIS number."
        color={ROUND_COLOR}
        outlined
      />
      {(r.ripostesGiven > 0 || r.ripostesTaken > 0) && (
        <Chip
          label={`riposte ${r.ripostesGiven} given · ${r.ripostesTaken} taken`}
          hint={riposteHint(r)}
        />
      )}
      {r.flurries > 0 && (
        <Chip label={`flurry ×${r.flurries} · ${r.flurryPct.toFixed(1)}% of rounds`} hint={flurryHint(r)} />
      )}
      {r.rampagesTaken > 0 && (
        <Chip
          label={`rampage ×${r.rampagesTaken} taken`}
          hint="Rampage swings taken. There is deliberately no “given” twin: your own Rampage AA swings log with no annotation at all, so outgoing rampage is unknowable from this log — absent by law, not by omission."
          color={RESIST_COLOR}
        />
      )}
      {excluded !== null && <Chip label={`excluded ${excluded}`} hint={exclusionHint()} />}
    </Stack>
  )
}

/** One lane row: a rounds bar, the multi-swing rate, the full split, and the tier chip. */
function LaneRow({ row }: { row: RoundLaneRow }): React.JSX.Element {
  return (
    <Tooltip title={row.hint}>
      <Box
        data-testid="rounds-lane"
        sx={{ position: 'relative', height: 22, borderRadius: 0.5, mb: '3px', overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.04)' }}
      >
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.max(2, row.pct)}%`, bgcolor: ROUND_COLOR, opacity: 0.35 }} />
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ position: 'absolute', inset: 0, px: 0.75 }}>
          <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
            {row.label}
          </Typography>
          {row.aggregateOnly ? (
            <Typography component="span" variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
              inferred
            </Typography>
          ) : (
            row.splitDetail !== null && (
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                {row.splitDetail}
              </Typography>
            )
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Typography component="span" variant="caption" noWrap sx={{ color: 'text.secondary' }}>
            {row.splitText}
          </Typography>
          <Typography component="span" variant="caption" noWrap sx={{ whiteSpace: 'nowrap' }}>
            {Math.round(row.multiPct)}% multi · {fmt(row.rounds)}
          </Typography>
        </Stack>
      </Box>
    </Tooltip>
  )
}

/** The base-modifier tallies — the ×N rows the drill already earned (design §2, tier: stated). */
function ModifierTallies({ r }: { r: SourceRoundsView }): React.JSX.Element | null {
  if (r.modifiers.length === 0) return null
  return (
    <Box sx={{ mt: 0.75 }}>
      <SectionLabel>Modifiers</SectionLabel>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
        {r.modifiers.map((m) => (
          <Tooltip
            key={m.name}
            title={`${m.name}: ${m.count} annotated line${m.count === 1 ? '' : 's'}${
              m.avoided > 0 ? `, ${m.avoided} of them on an avoided swing` : ''
            }. Counted from the game's own paren annotation, compounds decomposed into their parts — an exact count, not an inference.`}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {m.name} <strong>×{fmt(m.count)}</strong>
            </Typography>
          </Tooltip>
        ))}
      </Stack>
    </Box>
  )
}

/**
 * The panel. Renders nothing at all when the source has no round payload — a caster with no
 * swings gets silence, not a table of zeroes.
 *
 * FIXED-HEIGHT LIST (UI conventions): the lane table scrolls inside its own box rather than
 * growing the drill, so a zone session with a dozen verbs cannot push the meter's own list
 * off screen.
 */
export function RoundsPanel({ source }: { source: SourceView }): React.JSX.Element | null {
  const r = source.roundStats
  if (!r || (r.lanes.length === 0 && r.modifiers.length === 0)) return null
  const rows = roundLaneRows(r)
  return (
    <Box
      data-testid="rounds-panel"
      sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}
    >
      <SectionLabel>Rounds</SectionLabel>
      <Box sx={{ mt: 0.5 }}>
        <RoundChips r={r} />
        {rows.length > 0 ? (
          <Box sx={{ maxHeight: 160, overflow: 'auto' }}>
            {rows.map((row) => (
              <LaneRow key={row.verb} row={row} />
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.disabled">
            No attack rounds in this segment — only annotated extra swings.
          </Typography>
        )}
        <ModifierTallies r={r} />
      </Box>
    </Box>
  )
}
