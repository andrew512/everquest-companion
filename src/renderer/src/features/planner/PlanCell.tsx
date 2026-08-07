// planner/PlanCell.tsx — ONE EQUIPMENT SLOT of the Inventory tab.
//
// Split out of `PlanBoard.tsx` when V7's auto-fill pushed that file past the measured
// 400-code-line ceiling, and this is the seam the ceiling was pointing at: the board is a GRID
// that owns the dump and the host picker, and the cell is one item's window.
//
// A CELL IS A HOST PLUS UP TO FOUR SOCKETS, which is exactly the game's rule (R1: one socket of
// each type per item, unlocked at +1/+2/+3/+4). The host comes from the user's own pick when they
// made one and from what they are WEARING when they did not (V7, `effectiveHost`) — the plan is
// never written by the dump, so a hand-pick always wins and an auto-filled host follows your gear
// instead of freezing the day you first opened the tab.
//
// THE SOCKET LIST IS THE ANCHOR (V8, owner 2026-08-05: "a different, item-focused way to plan").
// Once a cell has a host, ALL FOUR of its sockets are drawn, filled or not — the empty ones are
// the point, exactly as they are in the game's own item window. Clicking one opens the effect
// browser already narrowed to what can legally go there (that socket, this slot, this host's
// classes), so the second way into the planner is "open an item and fill it" rather than "find an
// effect and place it". A cell with NO host still draws only what is planned: four empty rows on
// twenty-one untouched cells would be noise, not an invitation.
//
// THE NARROWED-CLASS LINE IS R2 MADE VISIBLE. Socketing narrows the host's class list to the
// overlap with the donor's, so a six-class sword quietly becomes a four-class sword the moment you
// plan a Ranger-only proc into it.
//
// THE STATE CHIP IS THE ONLY PROGRESS THIS SURFACE SHOWS, and it is decoration (D6): a character
// with no dumps, no loot history and no observed merges renders twenty-one cells of `planned` and is
// a completely functional planner.

import { type JSX } from 'react'
import { Box, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { ClassAbbr } from '@shared/classCombo'
import type { PlannerInventoryHost } from '@shared/planner/inventorySlots'
import {
  planSlotLabel,
  SOCKET_TYPES,
  type PlanSlot,
  type PlanSlotId,
  type PlanSocket,
  type SocketType
} from '@shared/planner/types'
import { extractionTier, narrowedClasses } from '@shared/planner/rules'
import { Tooltip } from '../../lib/Tooltip'
import { DonorName, EraChip, MismatchChip, NoSlotChip, StateChip } from './PlannerChips'
import { classesMismatch } from './plannerClasses'
import { donorFor, isNonEquippable, type DonorRow } from './plannerData'
import { effectiveHost, type EffectiveHost } from './plannerInventory'
import type { PlannerProgressApi } from './plannerProgress'

const SOCKET_LABEL: Record<SocketType, string> = {
  focus: 'Focus',
  click: 'Click',
  worn: 'Worn',
  proc: 'Proc'
}

export type DonorIndex = ReadonlyMap<string, DonorRow[]>

/** The classes the corpus states for an item key — `[]` when it carries no row for it (unknown). */
function classesOf(index: DonorIndex, key: string | undefined): ClassAbbr[] {
  if (key === undefined) return []
  return index.get(key)?.[0]?.classes ?? []
}

/**
 * R2 folded over the cell: the host's classes narrowed by every planned donor in turn. Returns
 * `[]` when nothing in the cell states a class list — the line then renders nothing rather than
 * claiming "usable by nobody".
 *
 * `hostKey` is the EFFECTIVE host (V7), so an auto-filled host narrows exactly like a picked one.
 */
export function cellNarrowing(planSlot: PlanSlot, index: DonorIndex, hostKey?: string): ClassAbbr[] {
  let classes = classesOf(index, hostKey)
  for (const planned of Object.values(planSlot.sockets)) {
    if (!planned) continue
    const donor = donorFor(index, planned.donorKey, planned.effect)
    if (donor) classes = narrowedClasses(classes, donor.classes)
  }
  return classes
}

// ---- one socket line -----------------------------------------------------------------

interface SocketLineProps {
  slot: PlanSlotId
  socket: SocketType
  /** what the set plans here, or null for an EMPTY socket of a host (V8) */
  planned: PlanSocket | null
  /** the host's merge tier when it is known — decides whether a socket reads as unlocked yet */
  hostTier?: number
  /** the set's class FILTER — a donor outside it is chipped, never dropped (V2) */
  planClasses: readonly ClassAbbr[]
  index: DonorIndex
  progress: PlannerProgressApi
  onRemove: (slot: PlanSlotId, socket: SocketType) => void
  /**
   * Open the effect browser filtered to this socket of this host (V8) — NULL when the cell has no
   * host yet. The preset is "this socket of THIS item" (socket + slot + the host's own classes),
   * so with no host there is nothing legal to narrow to, and the socket label stops being a
   * control rather than staying a click that goes nowhere.
   */
  onBrowse: ((slot: PlanSlotId, socket: SocketType) => void) | null
  onOpenLoot?: (item: string) => void
}

/** R1 for one socket, read out of the rules and never restated: `@+2`, or `+2 to unlock`. */
function unlockText(socket: SocketType, hostTier: number | undefined): string {
  const at = extractionTier(socket)
  return hostTier !== undefined && hostTier < at ? `+${String(at)} to unlock` : `@+${String(at)}`
}

/** What a FILLED socket says: the effect, its donor, and how far along that donor is. */
function FilledSocket({
  planned,
  slot,
  socket,
  planClasses,
  index,
  progress,
  onRemove,
  onOpenLoot
}: SocketLineProps & { planned: PlanSocket }): JSX.Element {
  const donor = donorFor(index, planned.donorKey, planned.effect)
  // No corpus row (a donor the DB no longer carries) still has a KNOWN extraction tier: it is a
  // property of the SOCKET, not of the item (R1).
  const state = progress.of(planned.donorKey, donor?.tierRequired ?? extractionTier(socket))
  return (
    <>
      <Box sx={{ minWidth: 0, flexShrink: 1 }}>
        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }}>
          {planned.effect}
        </Typography>
        <Typography variant="caption" component="div" noWrap sx={{ color: 'text.secondary' }}>
          {donor === null ? planned.donorKey : <DonorName name={donor.name} onOpen={onOpenLoot} />}
        </Typography>
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 4 }} />
      {donor !== null && classesMismatch(donor.classes, planClasses) && <MismatchChip classes={donor.classes} />}
      {donor !== null && isNonEquippable(donor) && <NoSlotChip />}
      <EraChip subject={donor ?? { key: planned.donorKey }} />
      <StateChip progress={state} />
      <Tooltip title="Remove">
        <IconButton
          size="small"
          data-testid="planner-socket-remove"
          onClick={() => onRemove(slot, socket)}
          sx={{ flexShrink: 0, p: 0.25 }}
        >
          <CloseIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </>
  )
}

/** The socket's name. A CONTROL only where the browser has a host to narrow to (see `onBrowse`). */
function SocketChip({
  slot,
  socket,
  onBrowse
}: Pick<SocketLineProps, 'slot' | 'socket' | 'onBrowse'>): JSX.Element {
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      label={SOCKET_LABEL[socket]}
      data-testid="planner-socket-browse"
      {...(onBrowse === null ? {} : { onClick: () => onBrowse(slot, socket) })}
      sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
    />
  )
  if (onBrowse === null) return chip
  return <Tooltip title={`Browse ${SOCKET_LABEL[socket].toLowerCase()} effects for ${planSlotLabel(slot)}`}>{chip}</Tooltip>
}

function SocketLine(props: SocketLineProps): JSX.Element {
  const { slot, socket, planned, hostTier, onBrowse } = props
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      data-testid={planned === null ? 'planner-socket-open' : 'planner-socket-line'}
      data-socket={socket}
      sx={{ flexWrap: 'nowrap', minWidth: 0 }}
    >
      <SocketChip slot={slot} socket={socket} onBrowse={onBrowse} />
      {planned === null ? (
        <>
          {/* An empty socket only ever draws under a host (`rows` below), so this is always live. */}
          <Typography
            variant="caption"
            onClick={() => onBrowse?.(slot, socket)}
            sx={{ color: 'text.disabled', cursor: 'pointer', '&:hover': { color: 'text.secondary' } }}
          >
            pick an effect…
          </Typography>
          <Box sx={{ flexGrow: 1, minWidth: 4 }} />
          <Typography variant="caption" sx={{ color: 'text.disabled', flexShrink: 0 }}>
            {unlockText(socket, hostTier)}
          </Typography>
        </>
      ) : (
        <FilledSocket {...props} planned={planned} />
      )}
    </Stack>
  )
}

// ---- the host line -------------------------------------------------------------------

function HostLine({
  slot,
  host,
  onPickHost,
  onHost,
  onOpenLoot
}: {
  slot: PlanSlotId
  host: EffectiveHost | null
  onPickHost: (slot: PlanSlotId, anchor: HTMLElement) => void
  onHost: (slot: PlanSlotId, host: null) => void
  onOpenLoot?: (item: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, flexWrap: 'nowrap' }}>
      {host === null ? (
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
            <DonorName name={host.name} bold onOpen={onOpenLoot} />
          </Box>
          {host.tier !== undefined && (
            <Chip
              size="small"
              variant="outlined"
              label={`+${String(host.tier)}`}
              sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
            />
          )}
          {/* State, not process: one word says this host came from the dump, not from a pick. */}
          {host.equipped && (
            <Chip
              size="small"
              label="worn"
              data-testid="planner-host-worn"
              sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
            />
          )}
          <Tooltip title="Pick a different host">
            <Typography
              variant="caption"
              data-testid="planner-host-pick"
              onClick={(e) => onPickHost(slot, e.currentTarget)}
              sx={{ color: 'text.disabled', cursor: 'pointer', flexShrink: 0 }}
            >
              change
            </Typography>
          </Tooltip>
          {/* Only a PICKED host can be cleared: clearing an auto-filled one would ask the user to
              stop wearing it. Picking a different host is the move there, and it is one click. */}
          {!host.equipped && (
            <Tooltip title="Clear the host item">
              <IconButton size="small" onClick={() => onHost(slot, null)} sx={{ flexShrink: 0, p: 0.25 }}>
                <CloseIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}
    </Stack>
  )
}

// ---- the cell ------------------------------------------------------------------------

export interface PlanCellProps {
  slot: PlanSlotId
  planSlot: PlanSlot
  planClasses: readonly ClassAbbr[]
  /** what the dump says is worn here; absent when there is no dump or the slot is empty */
  equipped: PlannerInventoryHost | undefined
  index: DonorIndex
  progress: PlannerProgressApi
  onSocket: (slot: PlanSlotId, socket: SocketType, planned: null) => void
  onHost: (slot: PlanSlotId, host: { key: string; name: string } | null) => void
  onPickHost: (slot: PlanSlotId, anchor: HTMLElement) => void
  /** open the effect browser filtered to one socket of this cell's host (V8) */
  onBrowse: (slot: PlanSlotId, socket: SocketType, host: EffectiveHost) => void
  onOpenLoot?: (item: string) => void
}

export default function PlanCell(props: PlanCellProps): JSX.Element {
  const { slot, planSlot, planClasses, equipped, index, progress, onSocket, onHost, onPickHost, onBrowse, onOpenLoot } =
    props
  const host = effectiveHost(planSlot, equipped)
  const planned = SOCKET_TYPES.filter((s) => planSlot.sockets[s] !== undefined)
  const empty = planned.length === 0 && host === null
  const narrowed = planned.length === 0 ? [] : cellNarrowing(planSlot, index, host?.key)
  // With a host, the item window: all four sockets, filled or not. Without one, only what is
  // planned — four empty rows on twenty-one untouched cells would be noise, not an invitation.
  const rows = host === null ? planned : SOCKET_TYPES

  return (
    <Paper
      variant="outlined"
      data-testid="planner-board-cell"
      data-slot={slot}
      sx={{ p: 1, opacity: empty ? 0.65 : 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}
    >
      {/* The CELL's name — "FINGER 1" / "FINGER 2" for a paired slot, the slot's own name for the
          rest. Numbered rather than named (left/right): the inventory dump prints two rows in an
          order and no column saying which hand, so a name would be a claim we cannot support. */}
      <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: 0.6, fontWeight: 700 }}>
        {planSlotLabel(slot)}
      </Typography>
      <HostLine slot={slot} host={host} onPickHost={onPickHost} onHost={onHost} onOpenLoot={onOpenLoot} />
      {narrowed.length > 0 && (
        <Typography variant="caption" data-testid="planner-narrowed" sx={{ color: 'text.secondary' }}>
          narrows to {narrowed.join('/')}
        </Typography>
      )}
      {rows.map((socket) => (
        <SocketLine
          key={socket}
          slot={slot}
          socket={socket}
          planned={planSlot.sockets[socket] ?? null}
          hostTier={host?.tier}
          planClasses={planClasses}
          index={index}
          progress={progress}
          onRemove={(s, k) => onSocket(s, k, null)}
          onBrowse={host === null ? null : (s, k) => onBrowse(s, k, host)}
          onOpenLoot={onOpenLoot}
        />
      ))}
    </Paper>
  )
}
