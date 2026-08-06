// character/GearStats — what the worn gear adds up to, and only that.
//
// THE HONEST LABEL IS THE WHOLE DESIGN. The JOS-45 spike read the shipped client's own string
// table: no `/outputfile` variant exports character stats, and no AA export exists at all. So
// the app cannot know your AC — it can only know what your ITEMS say, and this panel says so
// once, in its heading, in three words. Per the tooltip-and-caveat diet that is the entire
// disclosure: no footnote about base stats, no lecture about buffs, no asterisks.
//
// The `base` chip is the second and last honesty marker: these are the item pages' BASE values,
// and every one of these items is worn at some ` +N` item level whose uplift we do not
// distribute per stat (shared/characterSheet.ts says why). Hovering the item shows its own
// "+N% stats" line, which is where that fact already lives.
//
// PERCENTAGES ARE STATED, NEVER ADDED. Two worn items in the real dump carry Haste (+36% and
// +21%). Whether worn haste stacks is a game rule no source in this repo states, so the row
// shows the values the items state, side by side, and never a total (law 6).

import type { JSX } from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type { GearStat, GearTotals } from '@shared/characterSheet'

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n))

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
    </Stack>
  )
}

function StatRows({ rows }: { rows: readonly GearStat[] }): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <Box sx={{ flex: '1 1 150px', minWidth: 140 }}>
      {rows.map((s) => (
        <Row key={s.label} label={s.label} value={signed(s.total)} />
      ))}
    </Box>
  )
}

export default function GearStats({ totals }: { totals: GearTotals }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }} data-testid="character-gear-stats">
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2">Stats from gear</Typography>
        <Chip size="small" variant="outlined" label="base" sx={{ height: 18, fontSize: 10 }} />
      </Stack>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <StatRows rows={[{ label: 'AC', total: totals.ac, from: totals.counted }]} />
        <StatRows rows={totals.stats} />
        <StatRows rows={totals.saves} />
        {totals.unsummed.length > 0 && (
          <Box sx={{ flex: '1 1 150px', minWidth: 140 }}>
            {totals.unsummed.map((u) => (
              <Row key={u.label} label={u.label} value={u.values.join('  ')} />
            ))}
          </Box>
        )}
      </Box>

      {/* A count, not a caveat: it says how much of your gear these numbers actually cover. */}
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
        {totals.counted} of {totals.counted + totals.unknown} worn items
        {totals.unknown > 0 ? ` · ${String(totals.unknown)} not in the item database` : ''}
      </Typography>
    </Paper>
  )
}
