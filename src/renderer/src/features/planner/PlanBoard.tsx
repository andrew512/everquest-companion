// planner/PlanBoard.tsx — Board mode: the whole set on one screen (design §5.3).
//
// EIGHTEEN CELLS IN CHARACTER-SHEET ORDER, always all of them (`EQUIP_SLOTS`). A board that only
// drew the slots you had already planned would answer "what have you done" when the question is
// "what is left"; the empty cells are the point, and they are drawn QUIET — a slot label and one
// muted invitation, never an error, never a warning about a decision you simply have not made.
//
// EACH CELL IS A HOST PLUS UP TO FOUR SOCKETS, which is exactly the game's rule (R1: one socket
// of each type per item, unlocked at +1/+2/+3/+4). Sockets are added in Effects mode — that is
// where you can see every donor of an effect — so the cell's own affordances are the two things
// only the cell knows: which item is hosting, and dropping a socket you changed your mind about.
//
// THE NARROWED-CLASS LINE IS R2 MADE VISIBLE. Socketing narrows the host's class list to the
// overlap with the donor's, so a six-class sword quietly becomes a four-class sword the moment
// you plan a Ranger-only proc into it. The line states the result of every socket in the cell,
// folded — and when the host's own page states no class list it says what the SOCKETS narrow to,
// because an unknown host list is not an empty one (narrowedClasses' contract).
//
// THE STATE CHIP IS THE ONLY PROGRESS THIS SURFACE SHOWS, and it is decoration (D6): a character
// with no dumps, no loot history and no observed merges renders eighteen cells of `planned` and
// is a completely functional planner.

import { type JSX, useMemo, useState } from 'react'
import { Box, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { ClassAbbr } from '@shared/classCombo'
import {
  EQUIP_SLOTS,
  SOCKET_TYPES,
  type EquipSlot,
  type ExaltPlan,
  type PlanSlot,
  type PlannerItemHit,
  type SocketType
} from '@shared/planner/types'
import { extractionTier, narrowedClasses } from '@shared/planner/rules'
import { Tooltip } from '../../lib/Tooltip'
import HostPicker from './HostPicker'
import { DonorName, EraChip, StateChip } from './PlannerChips'
import { donorFor, indexDonors, useDonors, type DonorRow } from './plannerData'
import type { PlannerProgressApi } from './plannerProgress'

const SOCKET_LABEL: Record<SocketType, string> = {
  focus: 'Focus',
  click: 'Click',
  worn: 'Worn',
  proc: 'Proc'
}

type DonorIndex = ReadonlyMap<string, DonorRow[]>

/** The classes the corpus states for an item key — `[]` when it carries no row for it (unknown). */
function classesOf(index: DonorIndex, key: string | undefined): ClassAbbr[] {
  if (key === undefined) return []
  return index.get(key)?.[0]?.classes ?? []
}

/**
 * R2 folded over the cell: the host's classes narrowed by every planned donor in turn. Returns
 * `[]` when nothing in the cell states a class list — the line then renders nothing rather than
 * claiming "usable by nobody".
 */
export function cellNarrowing(planSlot: PlanSlot, index: DonorIndex): ClassAbbr[] {
  let classes = classesOf(index, planSlot.hostKey)
  for (const planned of Object.values(planSlot.sockets)) {
    if (!planned) continue
    const donor = donorFor(index, planned.donorKey, planned.effect)
    if (donor) classes = narrowedClasses(classes, donor.classes)
  }
  return classes
}

// ---- one socket line -----------------------------------------------------------------

function SocketLine({
  slot,
  socket,
  effect,
  donorKey,
  index,
  progress,
  onRemove
}: {
  slot: EquipSlot
  socket: SocketType
  effect: string
  donorKey: string
  index: DonorIndex
  progress: PlannerProgressApi
  onRemove: (slot: EquipSlot, socket: SocketType) => void
}): JSX.Element {
  const donor = donorFor(index, donorKey, effect)
  // No corpus row (a donor the DB no longer carries) still has a KNOWN extraction tier: it is a
  // property of the SOCKET, not of the item (R1).
  const state = progress.of(donorKey, donor?.tierRequired ?? extractionTier(socket))
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      data-testid="planner-socket-line"
      sx={{ flexWrap: 'nowrap', minWidth: 0 }}
    >
      <Chip size="small" variant="outlined" label={SOCKET_LABEL[socket]} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flexShrink: 1 }}>
        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }}>
          {effect}
        </Typography>
        <Typography variant="caption" component="div" noWrap sx={{ color: 'text.secondary' }}>
          {donor === null ? donorKey : <DonorName name={donor.name} />}
        </Typography>
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 4 }} />
      <EraChip donorKey={donorKey} />
      <StateChip progress={state} />
      <Tooltip title="Remove this socket from the set">
        <IconButton
          size="small"
          data-testid="planner-socket-remove"
          onClick={() => onRemove(slot, socket)}
          sx={{ flexShrink: 0, p: 0.25 }}
        >
          <CloseIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

// ---- one cell ------------------------------------------------------------------------

export interface PlanBoardProps {
  plan: ExaltPlan
  progress: PlannerProgressApi
  onSocket: (slot: EquipSlot, socket: SocketType, planned: null) => void
  onHost: (slot: EquipSlot, host: { key: string; name: string } | null) => void
}

interface CellProps extends PlanBoardProps {
  slot: EquipSlot
  index: DonorIndex
  onPickHost: (slot: EquipSlot, anchor: HTMLElement) => void
}

function HostLine({
  slot,
  planSlot,
  onPickHost,
  onHost
}: {
  slot: EquipSlot
  planSlot: PlanSlot
  onPickHost: (slot: EquipSlot, anchor: HTMLElement) => void
  onHost: (slot: EquipSlot, host: null) => void
}): JSX.Element {
  const name = planSlot.hostName
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, flexWrap: 'nowrap' }}>
      {name === undefined ? (
        <Typography
          variant="caption"
          data-testid="planner-host-pick"
          onClick={(e) => onPickHost(slot, e.currentTarget)}
          sx={{ color: 'text.disabled', cursor: 'pointer', '&:hover': { color: 'text.secondary' } }}
        >
          pick host…
        </Typography>
      ) : (
        <>
          <Box sx={{ minWidth: 0, flexShrink: 1 }} data-testid="planner-host-name">
            <DonorName name={name} bold />
          </Box>
          <Tooltip title="Pick a different host item">
            <Typography
              variant="caption"
              data-testid="planner-host-pick"
              onClick={(e) => onPickHost(slot, e.currentTarget)}
              sx={{ color: 'text.disabled', cursor: 'pointer', flexShrink: 0 }}
            >
              change
            </Typography>
          </Tooltip>
          <Tooltip title="Clear the host item (the planned sockets stay)">
            <IconButton size="small" onClick={() => onHost(slot, null)} sx={{ flexShrink: 0, p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  )
}

function Cell({ slot, plan, index, progress, onSocket, onHost, onPickHost }: CellProps): JSX.Element {
  const planSlot: PlanSlot = plan.slots[slot] ?? { sockets: {} }
  const planned = SOCKET_TYPES.filter((s) => planSlot.sockets[s] !== undefined)
  const empty = planned.length === 0 && planSlot.hostName === undefined
  const narrowed = planned.length === 0 ? [] : cellNarrowing(planSlot, index)

  return (
    <Paper
      variant="outlined"
      data-testid="planner-board-cell"
      data-slot={slot}
      sx={{ p: 1, opacity: empty ? 0.65 : 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: 0.6, fontWeight: 700 }}>
        {slot}
      </Typography>
      <HostLine slot={slot} planSlot={planSlot} onPickHost={onPickHost} onHost={onHost} />
      {narrowed.length > 0 && (
        <Tooltip title="Socketing narrows the host item's class list to the overlap with every donor it carries.">
          <Typography variant="caption" data-testid="planner-narrowed" sx={{ color: 'text.secondary' }}>
            narrows to {narrowed.join('/')}
          </Typography>
        </Tooltip>
      )}
      {planned.map((socket) => {
        const entry = planSlot.sockets[socket]
        if (!entry) return null
        return (
          <SocketLine
            key={socket}
            slot={slot}
            socket={socket}
            effect={entry.effect}
            donorKey={entry.donorKey}
            index={index}
            progress={progress}
            onRemove={(s, k) => onSocket(s, k, null)}
          />
        )
      })}
    </Paper>
  )
}

// ---- the board -----------------------------------------------------------------------

interface Picking {
  slot: EquipSlot
  anchor: HTMLElement
}

export default function PlanBoard(props: PlanBoardProps): JSX.Element {
  const { donors } = useDonors()
  const index = useMemo(() => indexDonors(donors), [donors])
  const [picking, setPicking] = useState<Picking | null>(null)

  const pick = (hit: PlannerItemHit): void => {
    if (picking) props.onHost(picking.slot, { key: hit.key, name: hit.name })
    setPicking(null)
  }

  return (
    <Box
      data-testid="planner-board"
      sx={{
        flexGrow: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 1,
        alignContent: 'start',
        pr: 0.5
      }}
    >
      {EQUIP_SLOTS.map((slot) => (
        <Cell
          key={slot}
          slot={slot}
          index={index}
          onPickHost={(s, anchor) => setPicking({ slot: s, anchor })}
          {...props}
        />
      ))}
      {picking && (
        <HostPicker
          slot={picking.slot}
          planClasses={props.plan.classes}
          anchor={picking.anchor}
          onClose={() => setPicking(null)}
          onPick={pick}
        />
      )}
    </Box>
  )
}
