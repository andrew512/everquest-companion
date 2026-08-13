// gear/GearSetTotalsPanel.tsx — WHAT THE SET ADDS UP TO, and how it compares to your body
// (JOS-286, phase 5).
//
// EVERY NUMBER ON THIS PANEL COMES FROM `sumGear` (shared/characterSheet.ts) BY WAY OF
// `gearSetTotals`. Nothing here adds anything up — not the totals, not the diff, not the
// per-item contributions. That matters beyond tidiness: `sumGear` is where this repo's refusal to
// sum percentages lives, and a panel that did its own arithmetic would be free to quietly break it.
//
// THREE BLOCKS, AND THE THIRD IS THE ONE PEOPLE FORGET.
//   1. TOTALS — AC, the attributes, the saves. Each row states how many items contributed, because
//      "Strength 84 from 9 items" is a different claim from "Strength 84".
//   2. NOT SUMMED — the percent-valued stats, listed as the individual values the items state and
//      never added. Whether worn haste stacks is a game rule no source in this repo states (law 6,
//      and `sumGear`'s own header), so the honest answer is the list. IT IS ALWAYS VISIBLE when it
//      is non-empty: hiding it behind a disclosure would turn "we cannot say" into "there is
//      nothing here", which is the lie the refusal exists to avoid.
//   3. AGAINST EQUIPPED — the same rows, minus what the character is actually wearing right now
//      (`equippedHosts` → `equippedRead` → the same fold). Only the rows that MOVED are drawn:
//      a diff whose zero rows outnumber its answers is a table, not a comparison.
//
// AND IT SAYS WHAT IT COULD NOT READ. An assignment whose key the corpus cannot resolve is
// `GearTotals.unknown` and contributes to nothing; worn items whose name stated no ` +N` are read
// at base and counted. Both are stated rather than smoothed over — the character sheet's own
// habit, reached through the same fold.

import type { JSX } from 'react'
import { Box, Divider, Stack, Typography } from '@mui/material'
import type { GearStat, GearTotals } from '@shared/characterSheet'
import type { GearDiffRow, GearSetDiff } from '@shared/planner/gearSetTotals'

/** `+84` / `-3` / `0` — a total reads as a modifier, which is what every one of these is. */
function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n)
}

function TotalRow({ stat }: { stat: GearStat }): JSX.Element {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      data-testid="gear-set-total"
      data-label={stat.label}
      title={`${stat.label} ${signed(stat.total)} from ${String(stat.from)} ${stat.from === 1 ? 'item' : 'items'}`}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {stat.label}
      </Typography>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {signed(stat.total)}
        <Typography component="span" variant="caption" color="text.disabled">
          {' '}
          ·{stat.from}
        </Typography>
      </Typography>
    </Stack>
  )
}

function DiffLine({ row }: { row: GearDiffRow }): JSX.Element {
  return (
    <Stack direction="row" justifyContent="space-between" data-testid="gear-set-diff-row" data-label={row.label}>
      <Typography variant="caption" color="text.secondary" noWrap>
        {row.label}
      </Typography>
      <Typography
        variant="caption"
        color={row.delta > 0 ? 'success.main' : 'error.main'}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
        title={`${String(row.set)} planned vs ${String(row.equipped)} worn`}
      >
        {signed(row.delta)}
      </Typography>
    </Stack>
  )
}

/** The percent list — stated, never added. See block 2 in the header. */
function NotSummed({ totals }: { totals: GearTotals }): JSX.Element | null {
  if (totals.unsummed.length === 0) return null
  return (
    <Box data-testid="gear-set-unsummed">
      <Typography
        variant="caption"
        color="warning.main"
        title="Percentage-valued stats are stated, never added: whether these stack is a game rule no source in this app states, so it lists what each item says."
      >
        Not summed
      </Typography>
      {totals.unsummed.map((u) => (
        <Stack key={u.label} direction="row" justifyContent="space-between" data-testid="gear-set-unsummed-row">
          <Typography variant="caption" color="text.secondary" noWrap>
            {u.label}
          </Typography>
          <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {u.values.join(' · ')}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

/** The comparison block — only the rows that moved, plus the two sentences about what was read. */
function AgainstEquipped({
  diff,
  unstated,
  unknown
}: {
  diff: GearSetDiff
  unstated: number
  unknown: number
}): JSX.Element {
  const moved = [diff.ac, ...diff.stats, ...diff.saves].filter((r) => r.delta !== 0)
  return (
    <Box data-testid="gear-set-diff">
      <Typography variant="caption" color="text.secondary" data-testid="gear-set-diff-summary">
        {moved.length === 0
          ? 'Against equipped: nothing moves.'
          : `Against equipped: ${String(moved.length)} numbers move across ${String(diff.cellsChanged)} ${diff.cellsChanged === 1 ? 'cell' : 'cells'}.`}
      </Typography>
      {moved.map((row) => (
        <DiffLine key={row.label} row={row} />
      ))}
      {unstated > 0 && (
        <Typography variant="caption" color="text.disabled" display="block" data-testid="gear-set-diff-unstated">
          {unstated} worn {unstated === 1 ? 'item states' : 'items state'} no +N and {unstated === 1 ? 'is' : 'are'} read at
          base.
        </Typography>
      )}
      {unknown > 0 && (
        <Typography variant="caption" color="text.disabled" display="block">
          {unknown} worn {unknown === 1 ? 'item is' : 'items are'} not in the item database and {unknown === 1 ? 'is' : 'are'}{' '}
          in no total.
        </Typography>
      )}
    </Box>
  )
}

export interface GearSetTotalsPanelProps {
  totals: GearTotals
  /** the comparison, when this character has a dump to compare against — `null` when they do not */
  against: { diff: GearSetDiff; unstated: number; unknown: number } | null
}

export default function GearSetTotalsPanel({ totals, against }: GearSetTotalsPanelProps): JSX.Element {
  return (
    <Stack spacing={0.25} data-testid="gear-set-totals" sx={{ px: 1, py: 0.5 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          TOTALS
        </Typography>
        <Typography variant="caption" color="text.disabled" data-testid="gear-set-counted">
          {totals.counted} counted{totals.unknown > 0 ? ` · ${String(totals.unknown)} unknown` : ''}
        </Typography>
      </Stack>

      <Stack direction="row" justifyContent="space-between" data-testid="gear-set-total" data-label="AC">
        <Typography variant="caption" color="text.secondary">
          AC
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {signed(totals.ac)}
        </Typography>
      </Stack>
      {totals.stats.map((s) => (
        <TotalRow key={s.label} stat={s} />
      ))}
      {totals.saves.map((s) => (
        <TotalRow key={s.label} stat={s} />
      ))}

      <NotSummed totals={totals} />

      {against !== null && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <AgainstEquipped diff={against.diff} unstated={against.unstated} unknown={against.unknown} />
        </>
      )}
    </Stack>
  )
}
