// planner/EffectFilterBar.tsx — the Effects browser's one toolbar row.
//
// Split out of `EffectBrowser.tsx` when the non-equippable toggle pushed that file past the
// measured 400-code-line ceiling (2026-08-04), and this is the seam the ceiling was pointing at:
// the browser is a windowed LIST, the bar is a set of independent CONTROLS, and they share nothing
// but the filter object they read and write. No behaviour changed in the move.
//
// ONE NOWRAP ROW (the flexWrap law): every control keeps its size and the search box is the only
// thing allowed to shrink — a bar that wraps turns a toolbar into a growing block and pushes the
// list it filters off the bottom of the pane.
//
// FOUR FILTERS, TWO KINDS. Socket type / search / slot are this mount's own state; "Usable by this
// set" reads the plan. "Current era" and "Non-equippable" are the PERSISTED pair (`eq.planner.*`),
// handed in as their `useState`-shaped tuples so this file owns none of that storage — see
// plannerData for what each one means and why their defaults are opposites.

import type { JSX } from 'react'
import { Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { EQUIP_SLOTS, type EquipSlot, type SocketType } from '@shared/planner/types'
import { Tooltip } from '../../lib/Tooltip'
import { CURRENT_ERA_LABEL, type DonorFilters } from './plannerData'

/** The socket tabs, in the order the planner leads with (proc first — see DEFAULT_FILTERS). */
const SOCKETS: SocketType[] = ['proc', 'worn', 'focus', 'click']

/** The ONE spelling of a socket type in this feature's UI — the tabs and the effect rows share it. */
export const SOCKET_LABEL: Record<SocketType, string> = {
  proc: 'Proc',
  worn: 'Worn',
  focus: 'Focus',
  click: 'Click'
}

export interface EffectFilterBarProps {
  filters: DonorFilters
  setFilters: (f: DonorFilters) => void
  /** the RAW search text (the browser defers it before filtering — the standing search law) */
  text: string
  setText: (v: string) => void
  era: [boolean, (v: boolean) => void]
  nonEquip: [boolean, (v: boolean) => void]
}

export default function EffectFilterBar({
  filters,
  setFilters,
  text,
  setText,
  era,
  nonEquip
}: EffectFilterBarProps): JSX.Element {
  const [eraOnly, setEraOnly] = era
  const [showNonEquip, setShowNonEquip] = nonEquip
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filters.socket}
        onChange={(_e, v: SocketType | null) => {
          if (v !== null) setFilters({ ...filters, socket: v })
        }}
        sx={{ flexShrink: 0 }}
      >
        {SOCKETS.map((s) => (
          <ToggleButton key={s} value={s} data-testid={`planner-socket-${s}`} sx={{ px: 1.5 }}>
            {SOCKET_LABEL[s]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        size="small"
        label="Search effect or item"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ minWidth: 140, flexShrink: 1 }}
      />

      <TextField
        select
        size="small"
        label="Slot"
        value={filters.slot ?? 'ALL'}
        onChange={(e) => setFilters({ ...filters, slot: e.target.value === 'ALL' ? null : (e.target.value as EquipSlot) })}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        <MenuItem value="ALL">Any slot</MenuItem>
        {EQUIP_SLOTS.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>

      <Tooltip title="Hide donors no class in this set can use. Donors whose page states no class list are kept and chipped 'class unknown'.">
        <Chip
          size="small"
          label="Usable by this set"
          color={filters.trioOnly ? 'primary' : 'default'}
          variant={filters.trioOnly ? 'filled' : 'outlined'}
          onClick={() => setFilters({ ...filters, trioOnly: !filters.trioOnly })}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>

      <Tooltip title={`Hide donors whose only known sources are outside ${CURRENT_ERA_LABEL}. Donors no zone places stay, chipped 'era?'.`}>
        <Chip
          size="small"
          label="Current era"
          data-testid="planner-era-toggle"
          color={eraOnly ? 'primary' : 'default'}
          variant={eraOnly ? 'filled' : 'outlined'}
          onClick={() => setEraOnly(!eraOnly)}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>

      <Tooltip title="Show items whose page states no equipment slot — potions, poisons and the like. An exaltation can only move between items sharing a slot, so these can never donate; they are hidden by default and chipped 'no slot' when shown.">
        <Chip
          size="small"
          label="Non-equippable"
          data-testid="planner-nonequip-toggle"
          color={showNonEquip ? 'primary' : 'default'}
          variant={showNonEquip ? 'filled' : 'outlined'}
          onClick={() => setShowNonEquip(!showNonEquip)}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>
    </Stack>
  )
}
