// planner/PlannerChips.tsx — the planner's shared atoms: the state chip, the era chip, the
// no-slot chip, and a donor NAME that both hovers and links.
//
// ONE CHIP PER SOCKET (UI conventions: chips convey STATE, never process). The Board cell and the
// Farm row show the same four states in the same colours, so a socket you looked at on the board
// is recognisable in the rollup without re-reading it.
//
// THE DONOR NAME HOVERS *AND* CLICKS (owner, 2026-08-04). The hover is unchanged:
// `KnownItemTooltip` (lib/) is what every other item name in this app opens — the EQ-style item
// window over `window.eq.lookupItem`, plus the quests and recipes the item is part of — and it
// fetches only while it is open, so a Farm list of forty donors costs zero lookups until one is
// pointed at. The CLICK is new, and it is the app's standing link idiom (`openLoot`, appRouting):
// it takes the Loot tab over with that item's drill-down.
//
// WHY THE DRILL-DOWN IS NOW A FAIR DESTINATION. It used to be exactly the wrong one — its "Dropped
// by / Zones" columns were built from OBSERVED loot events alone, so a donor you have never looted
// answered "Times looted 0 · No source recorded" one click after a planner row told you which mob
// in which zone drops it. That contradiction is what `features/loot/ItemDbSources.tsx` closes: the
// drill now also states what the committed DBs know, labelled `db` beside the `observed` columns.
// With both witnesses on screen, the deep link is a promotion, not a downgrade.

import type { JSX } from 'react'
import { Box, Chip } from '@mui/material'
import { EQ_ITEM_COLORS } from '../../lib/ItemWindow'
import { KnownItemTooltip } from '../../lib/KnownItemTooltip'
import { Tooltip } from '../../lib/Tooltip'
import { eraChip, type EraSubject } from './plannerData'
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
 * needs no decoration); `era?` means NOTHING states an era — not the catalog, not the item page's
 * own drop list, not its era banner — which is a fact about our tables, not about the item.
 *
 * The subject is the donor ROW wherever the caller has one, because the page's drop list and era
 * banner ride on it; a plan entry the corpus has no row for passes `{ key }` and gets the
 * catalog-only answer. `plannerData.eraChip` writes the tooltip, so the chip never has to guess
 * which witness spoke.
 */
export function EraChip({ subject }: { subject: EraSubject }): JSX.Element | null {
  const info = eraChip(subject)
  if (info === null) return null
  return (
    <Tooltip title={info.tooltip}>
      <Chip
        size="small"
        label={info.label}
        data-testid="planner-era-chip"
        color={info.unknown ? 'default' : 'warning'}
        variant="outlined"
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/**
 * THE CROWN (V5) — this row carries the highest tier of its focus family that the current filters
 * left visible.
 *
 * Worded as "of the ones on screen" on purpose: turn the era filter off and a Velious donor may
 * take the crown, which is honest rather than surprising. Every row at the top tier wears it — if
 * three items carry Improved Healing III, all three ARE the best, and picking one to crown would
 * be the planner inventing a preference between them.
 */
export function BestChip(): JSX.Element {
  return (
    <Tooltip title="The highest tier of this focus family among the donors these filters leave visible. The corpus states no focus percentages anywhere — the rank in the effect's name is the only magnitude signal there is.">
      <Chip size="small" label="best" data-testid="planner-best-chip" color="primary" sx={CHIP_SX} />
    </Tooltip>
  )
}

/**
 * THE CLASS MISMATCH (V2) — this donor is already in the build and no longer matches the set's
 * class filter.
 *
 * NOTHING IS REMOVED, and that is the decision this chip exists to make visible: the trio is a
 * FILTER, not a rule, so re-inference or a loadout switch can never invalidate work you already
 * planned. It can only point at it. Same family as the era chip on purpose — both say "this row
 * survives, and here is why it looks out of place".
 */
export function MismatchChip({ classes }: { classes: readonly string[] }): JSX.Element {
  return (
    <Tooltip title={`Usable by ${classes.join('/')}`}>
      <Chip
        size="small"
        label="off filter"
        data-testid="planner-mismatch-chip"
        color="warning"
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/**
 * NO EQUIP SLOT — the R2 disqualifier, stated rather than assumed.
 *
 * An exaltation can only be socketed into an item sharing the donor's equipment slot, so a donor
 * with no slot can never legally donate; the browser's default filter drops these entirely and
 * this chip only ever appears once the escape toggle is on. It is worded as a fact about the PAGE,
 * not about the game (law 1): an empty slot list means the wiki stated none, which is nearly
 * always a consumable and occasionally a gap in the scrape.
 */
export function NoSlotChip(): JSX.Element {
  return (
    <Tooltip title="This page states no equipment slot, so nothing shares a slot with it and its effect can never be socketed elsewhere (R2). Usually a potion or a poison; occasionally a gap on the wiki page.">
      <Chip
        size="small"
        label="no slot"
        data-testid="planner-noslot-chip"
        color="warning"
        variant="outlined"
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/**
 * An item name: the app's item window on HOVER, the Loot drill-down on CLICK.
 *
 * `onOpen` is optional and the cursor follows it exactly — a hand only ever appears where a click
 * actually goes somewhere (the complaint behind e8d0fd0's cursor fix). Without it the name is a
 * pure hover surface and keeps the default cursor, which is what a name inside a tooltip card or
 * any other non-routed context should be.
 */
export function DonorName({
  name,
  bold,
  onOpen
}: {
  name: string
  bold?: boolean
  onOpen?: (name: string) => void
}): JSX.Element {
  const linked = onOpen !== undefined
  return (
    <KnownItemTooltip name={name}>
      <Box
        component="span"
        data-testid="planner-donor-name"
        onClick={linked ? () => onOpen(name) : undefined}
        sx={{
          color: EQ_ITEM_COLORS.name,
          fontWeight: bold === true ? 600 : 400,
          textDecoration: 'underline dotted',
          textUnderlineOffset: 2,
          cursor: linked ? 'pointer' : 'default',
          ...(linked ? { '&:hover': { textDecoration: 'underline' } } : {}),
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
