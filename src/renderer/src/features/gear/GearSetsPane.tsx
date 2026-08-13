// gear/GearSetsPane.tsx — THE SETS PANE: named virtual loadouts, beside the search table
// (JOS-286, phase 5 of the gear planner).
//
// ADDITIVE UI, AND THAT IS THE OWNER'S RULING RATHER THAN A LAYOUT CHOICE. Search is the default
// surface: the tab opens on 6,766 rows with no set, no selection and no pane, exactly as phase 3
// shipped it. This pane appears when the user asks for it, takes a fixed column beside the table
// (its own scroller — the standing "a growing list never grows the page" law), and closing it puts
// the tab back in the state it opened in. Nothing about the table depends on it.
//
// ADDING FROM A SEARCH ROW IS THE GESTURE (the ticket's own words). Every row of the table carries
// a `+` while a set is selected; clicking it drops that item into the first free cell its slot can
// occupy and DISPLACES whoever was there when none is free. The pane states the displacement in
// one sentence rather than letting an item disappear.
//
// THREE READS, EACH ARRIVING BY ITS OWN ROUTE AND JOINING ON `itemKey`:
//   * the CORPUS (`rows`, already in the window from phase 3) — an assignment's numbers;
//   * the OWNERSHIP fold (phase 4's map, already in the window) — where a copy of it is;
//   * the DUMP's equipped rows (`usePlannerInventory`, read here so a closed pane costs nothing) —
//     what is on the character right now, for the comparison.
// All three are keyed by `itemKey(name)`, which is why none of this needs a matcher.

import { useMemo, type JSX } from 'react'
import { Box, Divider, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import type { GearRow } from '@shared/planner/gear'
import { assignedCount } from '@shared/planner/gearSet'
import { equippedRead, gearSetDiff, gearSetTotals } from '@shared/planner/gearSetTotals'
import { usePlannerInventory } from '../planner/plannerInventory'
import GearSetCells from './GearSetCells'
import GearSetTotalsPanel from './GearSetTotalsPanel'
import type { GearOwnershipMap } from './gearOwnership'
import type { GearSetsApi } from './useGearSets'

/** The pane's width. Fixed, so opening it narrows the table by a known amount and never reflows it. */
export const SETS_PANE_WIDTH = 380

/** The set picker, the new/delete buttons and the name box — one row, `nowrap` (the flexWrap law). */
function SetToolbar({ api }: { api: GearSetsApi }): JSX.Element {
  const selected = api.selected
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', px: 1, pt: 1 }}>
      <TextField
        select
        size="small"
        label="Set"
        value={selected?.id ?? ''}
        data-testid="gear-set-select"
        onChange={(e) => api.select(e.target.value)}
        sx={{ minWidth: 130, flexShrink: 1 }}
      >
        {api.sets.map((s) => (
          <MenuItem key={s.id} value={s.id} data-testid="gear-set-option">
            {s.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        size="small"
        label="Name"
        value={selected?.name ?? ''}
        disabled={selected === null}
        data-testid="gear-set-name"
        onChange={(e) => {
          if (selected !== null) api.rename(selected.id, e.target.value)
        }}
        sx={{ minWidth: 110, flexGrow: 1 }}
      />

      <IconButton size="small" data-testid="gear-set-new" aria-label="New gear set" title="New gear set" onClick={api.create}>
        <AddIcon fontSize="inherit" />
      </IconButton>
      <IconButton
        size="small"
        data-testid="gear-set-delete"
        aria-label="Delete this gear set"
        title="Delete this gear set"
        disabled={selected === null}
        onClick={() => {
          if (selected !== null) api.remove(selected.id)
        }}
      >
        <DeleteOutlineIcon fontSize="inherit" />
      </IconButton>
    </Stack>
  )
}

/** The empty state: a pane with no sets in it says what the one button does. */
function NoSets(): JSX.Element {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }} data-testid="gear-sets-empty">
      No sets yet. A set is a virtual loadout - one item per equipment cell, each at whatever +N you
      plan to merge it to. Make one with the + above, then add items from the table with the + on
      each row.
    </Typography>
  )
}

export interface GearSetsPaneProps {
  api: GearSetsApi
  /** the BASE corpus rows — every assignment scales itself, so nothing pre-scaled may arrive here */
  rows: readonly GearRow[]
  ownership: GearOwnershipMap | null
}

export default function GearSetsPane({ api, rows, ownership }: GearSetsPaneProps): JSX.Element {
  const { inventory } = usePlannerInventory()
  // Keyed ONCE per corpus change, not per cell and never per render: an assignment resolves by
  // `Map.get` and a set has at most twenty-three of them.
  const index = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const rowFor = useMemo(() => (key: string) => index.get(key), [index])

  const selected = api.selected
  const totals = useMemo(
    () => (selected === null ? null : gearSetTotals(selected, rowFor)),
    [selected, rowFor]
  )

  // THE COMPARISON, and it is null until there is something to compare against: a character who
  // has never run `/outputfile inventory` gets the totals and no diff, rather than a diff against
  // an empty body claiming they are wearing nothing.
  const against = useMemo(() => {
    if (selected === null || totals === null || inventory === null || inventory.hosts.length === 0) return null
    const read = equippedRead(inventory.hosts)
    const worn = gearSetTotals(read.set, rowFor)
    return {
      diff: gearSetDiff({ set: totals, equipped: worn }, { set: selected, equipped: read.set }),
      unstated: read.unstated,
      unknown: worn.unknown
    }
  }, [selected, totals, inventory, rowFor])

  return (
    <Box
      data-testid="gear-sets-pane"
      sx={{
        width: SETS_PANE_WIDTH,
        flexShrink: 0,
        ml: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1
      }}
    >
      <SetToolbar api={api} />
      {api.note !== null && (
        <Typography variant="caption" color="text.secondary" data-testid="gear-set-note" sx={{ px: 1, pt: 0.5 }}>
          {api.note.text}
        </Typography>
      )}

      {selected === null ? (
        <NoSets />
      ) : (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', pb: 1 }}>
          <Typography variant="caption" color="text.disabled" sx={{ px: 1 }} data-testid="gear-set-filled">
            {assignedCount(selected)} of 23 cells
          </Typography>
          <GearSetCells
            set={selected}
            rowFor={rowFor}
            ownership={ownership}
            onCellState={api.setCellState}
            onClear={api.clear}
          />
          <Divider sx={{ my: 0.5 }} />
          {totals !== null && <GearSetTotalsPanel totals={totals} against={against} />}
        </Box>
      )}
    </Box>
  )
}
