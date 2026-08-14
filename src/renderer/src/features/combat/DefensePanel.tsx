// YOUR DEFENCE — the block/parry/dodge/riposte readout (JOS-354).
//
// WHERE IT LIVES, AND WHY IT IS NOT A FIFTH DASHBOARD CELL. The dashboard is four equal panels
// answering four questions — WHO, WHEN, WHAT FIRED, WHOM (CombatView.DashboardGrid says so at
// length, and the arrangement is an owner ruling). Defence is not a fifth subject: it is the other
// half of the one the INCOMING direction already shows. So it draws at the top of the meter panel
// whenever that panel is listing what is hitting you, above the mob rows it is derived from —
// the same placement `IncomingHeals` has at the bottom of that list, for the same reason.
//
// IT IS NEVER SHOWN IN THE OUTGOING DIRECTION. A source's own `missBreakdown` there is the MOB's
// avoidance of YOUR swings, which is the opposite fact; putting a defensive summary above it would
// invite exactly the misreading this panel exists to end.
//
// THE BARS ARE THE APP'S `Bar`, coloured with the enemy hue like every other incoming row, so the
// panel reads as part of the direction it sits in rather than as a new visual language.

import { Box, Stack, Typography } from '@mui/material'
import { Bar, KIND_COLOR, QuietNote } from './combatShared'
import { defenseHeadline, defenseRows, riposteLine, ripostesTakenLine } from './defenseRows'
import { Tooltip } from '../../lib/Tooltip'
import type { DefenseView } from '@shared/combat'

/** The dimmed caption rows under the bars (riposte's two halves, and what mobs riposted). */
function Notes({ d }: { d: DefenseView }): React.JSX.Element | null {
  const lines = [riposteLine(d), ripostesTakenLine(d)].filter((l): l is string => l !== null)
  if (lines.length === 0) return null
  return (
    <Box sx={{ mt: 0.5 }}>
      {lines.map((l) => (
        <Typography key={l} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {l}
        </Typography>
      ))}
    </Box>
  )
}

export function DefensePanel({ d }: { d: DefenseView }): React.JSX.Element {
  const rows = defenseRows(d)
  return (
    <Box data-testid="defense-panel" sx={{ mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
        <Typography
          variant="caption"
          noWrap
          sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}
        >
          Your defence
        </Typography>
        <Typography variant="caption" color="text.secondary" data-testid="defense-headline" noWrap sx={{ minWidth: 0 }}>
          {defenseHeadline(d)}
        </Typography>
      </Stack>
      {d.swings === 0 ? (
        <QuietNote>Nothing has swung at you in this segment - no defensive rate to state yet.</QuietNote>
      ) : (
        rows.map((r) => (
          <Tooltip key={r.key} title={`${r.hint} ${r.count} of ${d.swings} swings aimed at you.`}>
            <Box>
              <Bar
                color={KIND_COLOR.enemy}
                // The four ACTIVE defences carry the accent stripe; the mob's own whiff and your
                // rune do not, so "what I did" is separable from "what happened" at a glance.
                accent={r.active ? KIND_COLOR.you : undefined}
                pct={r.fill}
                name={r.label}
                right={`${r.count} · ${r.pct.toFixed(1)}%`}
              />
            </Box>
          </Tooltip>
        ))
      )}
      <Notes d={d} />
    </Box>
  )
}
