// gear/GearSetCells.tsx — THE BOARD: one row per equipment cell, each with its own plus-state
// slider (JOS-286, phase 5).
//
// THE CELL MODEL IS `PLAN_SLOTS` (shared/planner/types.ts) AND IT IS NOT RESTATED HERE. Twenty-three
// cells: the eighteen equip slots, the second ear/wrist/ring (JOS-67 — you wear two of each) and
// the two any-slots (JOS-104). Every cell is drawn whether or not it holds anything, because an
// empty cell is where the next item goes and a board that hid them would be a list.
//
// EACH ASSIGNMENT HAS ITS OWN SLIDER, AND IT MOVES WHOLE TIERS. That is the owner's both-modes
// ruling — the tab's global slider restates the whole corpus at one `+N` for comparison, and a set
// is a plan for specific items at specific states. The control writes `{ full, fraction: 0 }`
// rather than exposing the fraction, and the reason is EVIDENCE rather than screen space: every
// witness this app has of a real item's state is the ` +N` suffix in a `/outputfile inventory`
// dump, which states a WHOLE tier and never a partial one. The model keeps the fraction
// (`ItemUpgradeState` all the way through, so phase 0's arithmetic is reached unchanged) and the
// UI states only what a source can say.
//
// AND A CELL SAYS WHERE ITS ITEM ACTUALLY IS, in phase 4's own words. `ownedCellText` /
// `ownedCellTitle` (gearOwnership.ts) are the ownership vocabulary the table's Owned column
// already speaks — `Equipped +5`, `Bank +2 · Inventory`, `Looted` — so a plan naming an item you
// have in the bank says so with the same sentence, in the same place order, with no second
// wording to keep in sync.

import type { JSX } from 'react'
import { Box, IconButton, Slider, Stack, Typography } from '@mui/material'
import ClearIcon from '@mui/icons-material/Clear'
import { ITEM_MAX_TIER } from '@shared/itemStats'
import { percentLabel, type ItemUpgradeState } from '@shared/itemUpgrade'
import type { GearRow } from '@shared/planner/gear'
import { setCells, type GearAssignment, type GearSet } from '@shared/planner/gearSet'
import { assignmentBlock, assignmentStats } from '@shared/planner/gearSetTotals'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'
import { ownedCellText, ownedCellTitle, ownershipFor, type GearOwnershipMap } from './gearOwnership'

/** The cell label column — wide enough for `SHOULDERS` and `ANY SLOT 1` without wrapping. */
const LABEL_WIDTH = 84

/** What one assignment contributes, at its own state — `AC +10 · Wisdom +19`. */
function statLine(row: GearRow | undefined, state: ItemUpgradeState): string {
  if (row === undefined) return ''
  return assignmentStats(assignmentBlock(row, state))
    .map((s) => `${s.label} ${s.value}`)
    .join(' · ')
}

function FilledCell({
  cell,
  assignment,
  deps,
  on
}: {
  cell: PlanSlotId
  assignment: GearAssignment
  deps: { row: GearRow | undefined; ownership: GearOwnershipMap | null }
  on: { state: (cell: PlanSlotId, state: ItemUpgradeState) => void; clear: (cell: PlanSlotId) => void }
}): JSX.Element {
  const { row, ownership } = deps
  const owned = ownership === null ? null : ownershipFor(ownership, { key: assignment.key })
  const stats = statLine(row, assignment.state)
  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
        <Typography variant="caption" color="text.disabled" sx={{ width: LABEL_WIDTH, flexShrink: 0 }} noWrap>
          {planSlotLabel(cell)}
        </Typography>
        <Typography variant="caption" data-testid="gear-set-cell-name" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
          {assignment.name}
        </Typography>
        {/* PHASE 4's WORDS, RE-USED (see the header): where this app can see a copy of it. */}
        {owned !== null && (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="gear-set-cell-place"
            title={ownedCellTitle(owned)}
            sx={{ flexShrink: 0 }}
          >
            {ownedCellText(owned)}
          </Typography>
        )}
        <IconButton
          size="small"
          data-testid="gear-set-cell-clear"
          aria-label={`Clear ${planSlotLabel(cell)}`}
          onClick={() => on.clear(cell)}
          sx={{ flexShrink: 0 }}
        >
          <ClearIcon fontSize="inherit" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0, pl: 1 }}>
        <Box sx={{ width: 96, flexShrink: 0, px: 1 }}>
          <Slider
            size="small"
            min={0}
            max={ITEM_MAX_TIER}
            step={1}
            value={assignment.state.full}
            data-testid="gear-set-tier"
            aria-label={`Planned upgrade tier for ${assignment.name}`}
            onChange={(_e, v) => {
              on.state(cell, { full: typeof v === 'number' ? v : v[0], fraction: 0 })
            }}
          />
        </Box>
        <Typography
          variant="caption"
          color={assignment.state.full === 0 ? 'text.disabled' : 'primary.main'}
          data-testid="gear-set-cell-plus"
          sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 56 }}
        >
          {percentLabel(assignment.state)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="gear-set-cell-stats"
          title={stats === '' ? 'This item is not in the committed item database, so it is in no total.' : stats}
          sx={{ flexGrow: 1, minWidth: 0 }}
          noWrap
        >
          {stats === '' ? 'not in the item database' : stats}
        </Typography>
      </Stack>
    </Box>
  )
}

function EmptyCell({ cell }: { cell: PlanSlotId }): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
      <Typography variant="caption" color="text.disabled" sx={{ width: LABEL_WIDTH, flexShrink: 0 }} noWrap>
        {planSlotLabel(cell)}
      </Typography>
      <Typography variant="caption" color="text.disabled" noWrap>
        empty
      </Typography>
    </Stack>
  )
}

export interface GearSetCellsProps {
  set: GearSet
  /** the corpus row behind an assignment's key — `undefined` when this build's corpus has none */
  rowFor: (key: string) => GearRow | undefined
  ownership: GearOwnershipMap | null
  onCellState: (cell: PlanSlotId, state: ItemUpgradeState) => void
  onClear: (cell: PlanSlotId) => void
}

export default function GearSetCells({
  set,
  rowFor,
  ownership,
  onCellState,
  onClear
}: GearSetCellsProps): JSX.Element {
  return (
    <Stack spacing={0.25} sx={{ px: 1 }}>
      {setCells(set).map(({ cell, assignment }) => (
        <Box key={cell} data-testid="gear-set-cell" data-cell={cell}>
          {assignment === null ? (
            <EmptyCell cell={cell} />
          ) : (
            <FilledCell
              cell={cell}
              assignment={assignment}
              deps={{ row: rowFor(assignment.key), ownership }}
              on={{ state: onCellState, clear: onClear }}
            />
          )}
        </Box>
      ))}
    </Stack>
  )
}
