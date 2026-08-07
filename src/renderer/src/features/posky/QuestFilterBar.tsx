// posky/QuestFilterBar.tsx — the Sky tracker's one toolbar row.
//
// Split out of `PoskyView.tsx` when that file crossed the measured 400-line readability ceiling
// (2026-08-05), and this is the seam the ceiling was pointing at — the same one the planner's
// `EffectFilterBar` was cut on: the view is a windowed LIST plus its tabs and toasts, the bar is a
// set of independent CONTROLS, and they share nothing but the list state they read and write. No
// behaviour changed in the move.
//
// TWO KINDS OF CONTROL, and the `flexGrow` spacer between them is the whole layout argument.
// LEFT: class filter / search / sort / the three hide-toggles — all of them narrow the list you are
// looking at, and all of them live on `useQuestList`'s state, so this file owns none of that
// storage. RIGHT: "Count items from" and "Reload inventory" — these change what the tab counts you
// as HOLDING, which moves every progress number under the bar rather than the set of rows above it.
// Mixing the two groups would read as one undifferentiated row of knobs.
//
// This row WRAPS (`flexWrap="wrap" useFlexGap`), unlike the planner's nowrap bar: there are ten
// controls here and the tab's body is a scrolling accordion list that can afford to start lower.

import type { JSX } from 'react'
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import type { CountSource } from '@shared/types'
import ChipMultiSelect from '../../components/ChipMultiSelect'
import { Tooltip } from '../../lib/Tooltip'
import { SORT_OPTIONS, type SortKey } from './questSort'
import type { QuestListState } from './useQuestList'

export interface QuestFilterBarProps {
  list: QuestListState
  classes: string[]
  countSource: CountSource
  onCountSource: (s: CountSource) => void
  onReload: () => Promise<void>
}

// Class filter, search, sort, the three hide-toggles, and the inventory controls that decide
// which items the whole tab counts you as holding.
export default function QuestFilterBar({
  list,
  classes,
  countSource,
  onCountSource,
  onReload
}: QuestFilterBarProps): JSX.Element {
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center" useFlexGap>
      <ChipMultiSelect
        options={classes}
        value={list.selectedClasses}
        onChange={(v) => list.setSelectedClasses(v)}
        label="Filter by class"
        placeholder="All classes"
      />
      <TextField
        size="small"
        label="Search item / quest / reward"
        value={list.query}
        onChange={(e) => list.setQuery(e.target.value)}
        sx={{ minWidth: 240 }}
      />
      <TextField
        select
        size="small"
        label="Sort"
        value={list.sort}
        onChange={(e) => list.setSort(e.target.value as SortKey)}
        sx={{ minWidth: 180 }}
      >
        {SORT_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={
          <Checkbox
            // The stable handle for the persistence spec (tests/e2e/sky-filters.e2e.mts): this
            // box's tick is a stored preference, so it is the one control here an e2e reads back.
            data-testid="posky-hide-completed"
            checked={list.hideCompleted}
            onChange={(e) => list.setHideCompleted(e.target.checked)}
          />
        }
        label="Hide completed"
      />
      <FormControlLabel
        control={<Checkbox checked={list.hideNoItems} onChange={(e) => list.setHideNoItems(e.target.checked)} />}
        label="Only quests with turn-ins"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={list.favoritesOnly}
            onChange={(e) => list.setFavoritesOnly(e.target.checked)}
            icon={<StarBorderIcon />}
            checkedIcon={<StarIcon />}
            sx={{ color: 'warning.main', '&.Mui-checked': { color: 'warning.main' } }}
          />
        }
        label="Favorites only"
      />
      <Box sx={{ flexGrow: 1 }} />
      <Tooltip title="Which source decides what you have.">
        <TextField
          select
          size="small"
          label="Count items from"
          value={countSource}
          onChange={(e) => onCountSource(e.target.value as CountSource)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="log">Log (looted)</MenuItem>
          <MenuItem value="inventory">Inventory export</MenuItem>
          <MenuItem value="both">Both (max)</MenuItem>
        </TextField>
      </Tooltip>
      <Tooltip title="Run /outputfile inventory in-game, then reload">
        <span>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void onReload()}
            disabled={countSource === 'log'}
          >
            Reload inventory
          </Button>
        </span>
      </Tooltip>
    </Stack>
  )
}
