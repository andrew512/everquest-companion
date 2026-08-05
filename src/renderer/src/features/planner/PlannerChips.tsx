// planner/PlannerChips.tsx — the planner's three shared atoms: the state chip, the era chip, and
// a donor NAME that opens the app's item window.
//
// ONE CHIP PER SOCKET (UI conventions: chips convey STATE, never process). The Board cell and the
// Farm row show the same four states in the same colours, so a socket you looked at on the board
// is recognisable in the rollup without re-reading it.
//
// THE DONOR NAME IS THE APP'S EXISTING ITEM POPUP. `KnownItemTooltip` (lib/) is what every other
// item name in this app opens — the EQ-style item window over `window.eq.lookupItem`, plus the
// quests and recipes the item is part of — and it fetches only while it is open, so a Farm list
// of forty donors costs zero lookups until one is pointed at. The loot tab's `ItemDetailDialog`
// was deliberately NOT reused: it is the LOOT drill-down, and it would answer a donor row that
// just told you where an item drops with "Times looted 0 · No source recorded".

import type { JSX } from 'react'
import { Box, Chip } from '@mui/material'
import { EQ_ITEM_COLORS } from '../../lib/ItemWindow'
import { KnownItemTooltip } from '../../lib/KnownItemTooltip'
import { Tooltip } from '../../lib/Tooltip'
import { eraChipLabel } from './plannerData'
import type { DonorProgress, DonorState } from './plannerProgress'

const CHIP_SX = { height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.6 } } as const

type ChipColor = 'default' | 'primary' | 'success' | 'warning' | 'info'

const STATE_COLOR: Record<DonorState, ChipColor> = {
  planned: 'default',
  have: 'primary',
  partial: 'info',
  ready: 'success'
}

/** What each state MEANS, in the tooltip — the chip itself stays one word. */
const STATE_HINT: Record<DonorState, string> = {
  planned: 'Nothing observed yet: no copy in your inventory dump, none in your loot history, and no merge seen in the log.',
  have: 'You hold (or have looted) a copy. The log has not seen you merge it yet.',
  partial: 'The log saw you merge this item to the tier shown, of the tier the effect extracts at.',
  ready: 'The log saw this item merged to at least the tier its effect extracts at.'
}

/** The counts behind the chip, stated only when there are any (law 1: silence, not "0"). */
function evidence(progress: DonorProgress): string {
  const parts: string[] = []
  if (progress.held > 0) parts.push(`${String(progress.held)} in your last inventory dump`)
  if (progress.looted > 0) parts.push(`looted ${String(progress.looted)}×`)
  return parts.length === 0 ? '' : ` — ${parts.join(', ')}.`
}

/** The ONE state chip a planned socket carries. */
export function StateChip({ progress }: { progress: DonorProgress }): JSX.Element {
  return (
    <Tooltip title={`${STATE_HINT[progress.state]}${evidence(progress)}`}>
      <Chip
        size="small"
        label={progress.label}
        data-testid="planner-state-chip"
        data-state={progress.state}
        color={STATE_COLOR[progress.state]}
        variant={progress.state === 'ready' ? 'filled' : 'outlined'}
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/**
 * The era chip, or nothing. An in-era donor says nothing at all (that is the normal case and
 * needs no decoration); `era?` means no source zone states an era, which is a fact about our
 * table, not about the item.
 */
export function EraChip({ donorKey }: { donorKey: string }): JSX.Element | null {
  const label = eraChipLabel(donorKey)
  if (label === null) return null
  const unknown = label === 'era?'
  return (
    <Tooltip
      title={
        unknown
          ? 'No zone this donor drops in is in the era table, so we do not claim it is out of era.'
          : `This donor's sources are in ${label}.`
      }
    >
      <Chip
        size="small"
        label={label}
        data-testid="planner-era-chip"
        color={unknown ? 'default' : 'warning'}
        variant="outlined"
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/** An item name that opens the app's item window on hover, in the game's own item colour. */
export function DonorName({ name, bold }: { name: string; bold?: boolean }): JSX.Element {
  return (
    <KnownItemTooltip name={name}>
      <Box
        component="span"
        data-testid="planner-donor-name"
        sx={{
          color: EQ_ITEM_COLORS.name,
          fontWeight: bold === true ? 600 : 400,
          textDecoration: 'underline dotted',
          textUnderlineOffset: 2,
          // NOT a pointer: the name is a hover surface, not a link. A hand cursor here would
          // promise a click that does nothing (the exact complaint behind e8d0fd0's cursor fix).
          cursor: 'default',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {name}
      </Box>
    </KnownItemTooltip>
  )
}
