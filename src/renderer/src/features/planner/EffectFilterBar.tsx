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
// FIVE CONTROLS, TWO KINDS. Socket type / search / slot are this mount's own state; "Usable by this
// set" reads the plan. "Current era", "Non-equippable" and "Group by" are the PERSISTED set
// (`eq.planner.*`), handed in as their `useState`-shaped tuples so this file owns none of that
// storage — see plannerData for what each one means and why the two toggles' defaults are opposites.
//
// GROUP BY offers only the axes its socket tab can serve (`plannerGroups.axesFor` — "Focus family"
// exists on the Focus tab and nowhere else), so the control can never ask for a fold the model
// would answer with one header.

import type { JSX } from 'react'
import { Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { EQUIP_SLOTS, type EquipSlot, type SocketType } from '@shared/planner/types'
import { Tooltip } from '../../lib/Tooltip'
import { CURRENT_ERA_LABEL, type DonorFilters } from './plannerData'
import { AXIS_LABEL, SOCKET_LABEL, axesFor, type GroupAxis } from './plannerGroups'
import type { BrowsePreset } from './plannerPreset'

/** The socket tabs, in the order the planner leads with (proc first — see DEFAULT_FILTERS). */
const SOCKETS: SocketType[] = ['proc', 'worn', 'focus', 'click']

/**
 * The bar's ON/OFF idiom: one chip, lit when the filter is on, and a tooltip that says what it
 * hides and what it deliberately keeps. Three of them read identically because they ARE identical
 * — the differences worth seeing are in the words, not in the markup.
 */
function ToggleChip({
  label,
  hint,
  on,
  onToggle,
  testId
}: {
  label: string
  hint: string
  on: boolean
  onToggle: () => void
  testId?: string
}): JSX.Element {
  return (
    <Tooltip title={hint}>
      <Chip
        size="small"
        label={label}
        data-testid={testId}
        color={on ? 'primary' : 'default'}
        variant={on ? 'filled' : 'outlined'}
        onClick={onToggle}
        sx={{ flexShrink: 0 }}
      />
    </Tooltip>
  )
}

/**
 * THE PRESET CHIP (V8) — "HEAD · Proc · Valorium Helmet", with an X.
 *
 * It is the whole of the browser's honesty about arriving from an item window: the socket tabs and
 * the slot select beside it are showing values you did not choose, and this says who did. Clearing
 * it (or touching any other control) hands the browser back with those values still selected.
 */
function PresetChip({ label, onClear }: { label: string; onClear: () => void }): JSX.Element {
  return (
    <Chip
      size="small"
      color="primary"
      label={label}
      data-testid="planner-preset-chip"
      onDelete={onClear}
      sx={{ flexShrink: 0, maxWidth: 260 }}
    />
  )
}

export interface EffectFilterBarProps {
  filters: DonorFilters
  setFilters: (f: DonorFilters) => void
  /** the RAW search text (the browser defers it before filtering — the standing search law) */
  text: string
  setText: (v: string) => void
  era: [boolean, (v: boolean) => void]
  nonEquip: [boolean, (v: boolean) => void]
  groupBy: [GroupAxis, (v: GroupAxis) => void]
  /** V8 — the socket-of-a-host filter the browser was opened with, if any */
  preset?: BrowsePreset | null
  onClearPreset?: () => void
}

export default function EffectFilterBar({
  filters,
  setFilters,
  text,
  setText,
  era,
  nonEquip,
  groupBy,
  preset = null,
  onClearPreset
}: EffectFilterBarProps): JSX.Element {
  const [eraOnly, setEraOnly] = era
  const [showNonEquip, setShowNonEquip] = nonEquip
  const [axis, setAxis] = groupBy
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1 }}>
      {preset !== null && (
        <PresetChip
          label={`${preset.slot} · ${SOCKET_LABEL[preset.socket]} · ${preset.hostName}`}
          onClear={() => onClearPreset?.()}
        />
      )}
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

      <TextField
        select
        size="small"
        label="Group by"
        data-testid="planner-groupby"
        value={axis}
        onChange={(e) => setAxis(e.target.value as GroupAxis)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {axesFor(filters.socket).map((a) => (
          <MenuItem key={a} value={a} data-testid={`planner-groupby-${a}`}>
            {AXIS_LABEL[a]}
          </MenuItem>
        ))}
      </TextField>

      <ToggleChip
        label="Usable by this set"
        on={filters.trioOnly}
        onToggle={() => setFilters({ ...filters, trioOnly: !filters.trioOnly })}
        hint="Hide donors no class in this set can use"
      />

      <ToggleChip
        label="Current era"
        testId="planner-era-toggle"
        on={eraOnly}
        onToggle={() => setEraOnly(!eraOnly)}
        hint={`Hide donors from outside ${CURRENT_ERA_LABEL}`}
      />

      <ToggleChip
        label="Non-equippable"
        testId="planner-nonequip-toggle"
        on={showNonEquip}
        onToggle={() => setShowNonEquip(!showNonEquip)}
        hint="Show items whose page states no equipment slot"
      />
    </Stack>
  )
}
