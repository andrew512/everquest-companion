// posky/QuestFilterBar.tsx — the Sky tracker's one toolbar row.
//
// Split out of `PoskyView.tsx` when that file crossed the measured 400-line readability ceiling
// (2026-08-05), and this is the seam the ceiling was pointing at — the same one the planner's
// `EffectFilterBar` was cut on: the view is a windowed LIST plus its tabs and toasts, the bar is a
// set of independent CONTROLS, and they share nothing but the list state they read and write. No
// behaviour changed in the move.
//
// TWO KINDS OF CONTROL, and the `flexGrow` spacer between them is the whole layout argument.
// LEFT: class / island / boss filters, search, sort and the three hide-toggles — all of them narrow
// the list you are looking at, and all of them live on `useQuestList`'s state, so this file owns
// none of that storage. RIGHT: "Count items from" and "Reload inventory" — these change what the
// tab counts you as HOLDING, which moves every progress number under the bar rather than the set of
// rows above it. Mixing the two groups would read as one undifferentiated row of knobs.
//
// The three pickers lead, in the order a player narrows: class (who am I), island (where am I),
// boss (what am I standing in front of) — the WHERE facets sit beside the WHO facet rather than
// beside the search box, because all three answer "which quests are mine right now".
//
// This row WRAPS (`flexWrap="wrap" useFlexGap`), unlike the planner's nowrap bar: there are twelve
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
import { withPicked } from './questFacets'
import type { QuestListState } from './useQuestList'

export interface QuestFilterBarProps {
  list: QuestListState
  classes: string[]
  countSource: CountSource
  onCountSource: (s: CountSource) => void
  onReload: () => Promise<void>
}

// The three "which quests are mine right now" pickers, in the order a player narrows: who I am,
// where I am, what I am standing in front of. Each is a closed list of what the data offers, and
// each stores its picks, so this is also the group whose state survives leaving the tab.
function QuestPickers({ list, classes }: { list: QuestListState; classes: string[] }): JSX.Element {
  return (
    <>
      <ChipMultiSelect
        options={classes}
        value={list.selectedClasses}
        onChange={(v) => list.setSelectedClasses(v)}
        label="Filter by class"
        placeholder="All classes"
      />
      {/* The two JOS-124 facets. Both are stored preferences, so both carry a testid the
          persistence spec reads back, and both offer `withPicked` options so a stored pick the
          data no longer knows still shows as a removable chip. */}
      <ChipMultiSelect
        options={withPicked(list.facets.islands, list.islands)}
        value={list.islands}
        onChange={(v) => list.setIslands(v)}
        label="Filter by island"
        placeholder="All islands"
        minWidth={190}
        testId="posky-island-filter"
      />
      <ChipMultiSelect
        options={withPicked(list.facets.bosses, list.bosses)}
        value={list.bosses}
        onChange={(v) => list.setBosses(v)}
        label="Filter by boss"
        placeholder="All bosses"
        minWidth={230}
        testId="posky-boss-filter"
      />
    </>
  )
}

// The three pickers, search, sort, the three hide-toggles, and the inventory controls that decide
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
      <QuestPickers list={list} classes={classes} />
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
      <Tooltip title="Which source decides what you have. An inventory export resets the count and loot since then adds to it, so an item you got rid of in game disappears when you reload. The log by itself counts everything you have ever looted, so it cannot see that.">
        <TextField
          select
          size="small"
          label="Count items from"
          value={countSource}
          onChange={(e) => onCountSource(e.target.value as CountSource)}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="log">Log (ever looted)</MenuItem>
          <MenuItem value="inventory">Export, plus loot since</MenuItem>
          <MenuItem value="both">Export if any, else log</MenuItem>
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
