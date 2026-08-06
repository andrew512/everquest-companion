// THE MULTI-ATTACK PANEL (JOS-37) — how often each of ONE source's attack types landed a second,
// third or fourth swing in the same round, rendered inside the Combat drill beside that source's
// skill breakdown. Scope-aware for free: it reads the SELECTED segment's `SourceView`, so a fight
// and a zone session answer with their own numbers and nothing here knows the difference.
//
// IT LIVES IN THE DRILL ON PURPOSE (the arrangement decision, JOS-37). Multi-attack is a
// statement about ONE source's swings, and the drill is the level where a source is the subject.
// Promoting it to a dashboard cell would have meant binding it to "you" at the top level — which
// is exactly the dedicated You panel this ticket retired.
//
// It replaces the "Rounds" block: same engine counters (multiAttackRows.ts says what changed and
// why), one row per attack type, `<rounds> rounds · 24% doubled · 3% tripled`, and a single
// `est.` on the dual-wieldable verbs where a same-second second swing may be an off-hand. No
// tooltips: the labels say what they are, and the TOOLTIP AND CAVEAT DIET (AGENTS.md) is what
// this ticket is enforcing.

import { Box, Stack, Typography } from '@mui/material'
import { formatNum as fmt } from '../../lib/formatRate'
import { CAT_COLOR } from './combatShared'
import { flurryText, multiAttackRows, type MultiAttackRow } from './multiAttackRows'
import type { SourceView } from '@shared/combat'

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

/** One attack type: name, its own `est.` when the tier calls for it, then the rates and rounds. */
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
 * The panel. Renders nothing at all when the source opened no attack round — a caster with no
 * swings gets silence, not a table of zeroes.
 *
 * FIXED-HEIGHT LIST (UI conventions): the lane table scrolls inside its own box rather than
 * growing the drill, so a zone session with a dozen verbs cannot push the meter's own list
 * off screen.
 */
export function MultiAttackPanel({ source }: { source: SourceView }): React.JSX.Element | null {
  const r = source.roundStats
  if (!r) return null
  const rows = multiAttackRows(r)
  const flurry = flurryText(r)
  if (rows.length === 0 && flurry === null) return null
  return (
    <Box data-testid="multi-attack-panel" sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <SectionLabel>Multi-attack</SectionLabel>
      <Box sx={{ mt: 0.5, maxHeight: 160, overflow: 'auto' }}>
        {rows.map((row) => (
          <LaneRow key={row.verb} row={row} />
        ))}
      </Box>
      {flurry !== null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {flurry}
        </Typography>
      )}
    </Box>
  )
}
