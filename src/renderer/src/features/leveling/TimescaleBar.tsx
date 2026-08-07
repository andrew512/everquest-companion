// The leveling charts' TIMESCALE control (JOS-71) — one segmented control above the two plots,
// because they draw ONE time base and a per-chart picker would be two opinions about the same
// window (world-model law 9, the whole reason `ChartChrome` exists).
//
// It says WHAT YOU ARE LOOKING AT and nothing about how: the buttons name windows (`All`, `24h`,
// `1h`), the caption names the window's ends, and neither mentions zooming, bucketing or a
// sampling grid (UI conventions: state, never process). No tooltips — the labels are the whole
// vocabulary, and a caveat about what a scale "means" is exactly the footnote the caveat diet
// deletes.

import type { JSX } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { formatDateTime } from '../../lib/formatDate'
import type { Timescale, TimescaleId } from './chartWindow'
import type { ChartScale } from './levelChartGeometry'

/** One shape for both ends, whatever the scale: `Aug 5, 18:00`. */
function edge(ts: number): string {
  return formatDateTime(ts, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function TimescaleBar({
  scales,
  id,
  scale,
  onPick
}: {
  /** Only the scales this character's history can fill (chartWindow.ts `availableTimescales`). */
  scales: readonly Timescale[]
  id: TimescaleId
  /** The window in force — the SAME object the charts draw with, so the caption cannot lie. */
  scale: ChartScale
  onPick: (id: TimescaleId) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" data-testid="leveling-timescale" sx={{ flexWrap: 'nowrap' }}>
      {/* A single available scale is not a choice, so it is not drawn as one — a short history
          keeps the caption (which still states what it is showing) and loses the buttons. */}
      {scales.length > 1 && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={id}
          onChange={(_e, next: TimescaleId | null) => {
            // MUI reports a null when the active button is clicked again. A chart must always be
            // showing SOME window, so that is a no-op rather than an empty selection.
            if (next) onPick(next)
          }}
        >
          {scales.map((s) => (
            <ToggleButton
              key={s.id}
              value={s.id}
              data-testid={`leveling-timescale-${s.id}`}
              sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4 }}
            >
              {s.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
      {/* The control never shrinks; the window caption does (the compact-bar contract). */}
      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }} data-testid="leveling-timescale-window">
        {edge(scale.t0)} → {edge(scale.t1)}
      </Typography>
    </Stack>
  )
}
