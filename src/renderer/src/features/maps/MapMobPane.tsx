// The Maps tab's RIGHT-HAND PANE: what the wiki says lives in this zone, and what the map file
// itself labels — one search box over both, click to light it up on the map.
//
// TWO SECTIONS BECAUSE THERE ARE TWO AUTHORITIES, and merging them would be the unlabelled
// inference the world-model laws forbid. "Named mobs" is the committed wiki catalog joined to
// this zone; "Map labels" is the parser's own `MapData.points` — the same points already drawn
// on the surface, never re-parsed. A row from one is never silently presented as a row from the
// other.
//
// THE HONEST BIT IS THE PIN AFFORDANCE. Roughly four in five catalog pages state coordinates;
// the rest say "Various" or "?" (MEASURED, 2026-08-04: 6,283 of 7,866 state at least one). A mob
// with no stated position is STILL LISTED — it lives here, and that is the fact the pane exists
// to carry — but it has no pin mark, it is not clickable, and the header chip says how many of
// the listed mobs are placeable at all. There is no zone-centre fallback and there must never be
// one (world-model law 1).
//
// PURELY PRESENTATIONAL. Query, filtering and selection live in `useMapPane` one level up,
// because the SURFACE pins the same filtered rows this list shows: one derivation, two readers,
// never a frame out of step.
//
// FIXED HEIGHT, OWN SCROLLER (AGENTS.md: "a growing list lives in a FIXED-height scroll box").
// Both sections share one `flexGrow:1; minHeight:0; overflow:auto` column, so 343 mobs scroll
// inside the pane instead of pushing the map out of the window.
//
// THE PANE DOES NOT EXIST WHEN IT IS OFF. MapsView renders nothing rather than a zero-width box,
// so the map's flex child is the only thing in the row and the ResizeObserver sees one clean
// resize on toggle — no width animation, no fixed-size arithmetic, nothing that could feed back
// into its own measurement.

import type { JSX } from 'react'
import {
  Box,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import PlaceIcon from '@mui/icons-material/Place'
import {
  MAX_PINS,
  isLocatable,
  type LabelPaneRow,
  type MapPaneRow,
  type MobPaneRow,
  type PaneCounts
} from './mobPins'

/** The pane's width. Fixed and `flexShrink:0` so the map, not the list, absorbs a window resize. */
export const PANE_WIDTH = 268

/** Rendered rows per section. The list is a filter, not a pager; typing is how you reach row 400. */
const SECTION_ROWS = 300

export interface MapMobPaneProps {
  /** Null ⇒ no zone is open, which the mob section states rather than showing an empty list. */
  zoneName: string | null
  mobs: readonly MobPaneRow[]
  labels: readonly LabelPaneRow[]
  counts: PaneCounts
  query: string
  onQuery: (q: string) => void
  selectedId: string | null
  onSelect: (row: MapPaneRow) => void
  /** The drawn pin set hit its ceiling — said out loud rather than quietly trimmed. */
  pinsCapped: boolean
}

/** The pin affordance: present exactly when the row has a real coordinate behind it. */
function PinMark({ locatable }: { locatable: boolean }): JSX.Element {
  return (
    <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0, pt: 0.25 }}>
      {locatable ? (
        <PlaceIcon data-testid="maps-pane-pin" sx={{ fontSize: 15, color: 'warning.main' }} />
      ) : (
        // Deliberately EMPTY, not a greyed pin: a dimmed marker still reads as "there is a
        // position here, somewhere", and there is not.
        <Box sx={{ width: 15 }} />
      )}
    </Box>
  )
}

/**
 * The one-line "and what else does this row know" text. Null when it knows nothing extra.
 *
 * The two "no pin" reasons are DIFFERENT FACTS and are said differently: a page that stated
 * nothing, and a page that stated a position but named several zones so it cannot be attributed
 * to this map. Collapsing them into one message would misreport the second as missing data.
 */
function rowNote(row: MapPaneRow): string | null {
  if (row.kind !== 'mob') return null
  if (row.unattributable) return `position stated, but the page lists ${String(row.zoneCount)} zones`
  if (row.pins.length === 0) return 'no location on the wiki page'
  return row.pins.length > 1 ? `${String(row.pins.length)} spawn points` : null
}

function Row({
  row,
  selected,
  onSelect
}: {
  row: MapPaneRow
  selected: boolean
  onSelect: (row: MapPaneRow) => void
}): JSX.Element {
  const locatable = isLocatable(row)
  const level = row.kind === 'mob' ? row.level : undefined
  return (
    <ListItemButton
      dense
      disabled={!locatable}
      selected={selected}
      data-testid={row.kind === 'mob' ? 'maps-pane-mob' : 'maps-pane-label'}
      onClick={() => {
        onSelect(row)
      }}
      sx={{ gap: 0.75, alignItems: 'flex-start' }}
    >
      <PinMark locatable={locatable} />
      <ListItemText
        primary={row.name}
        secondary={rowNote(row)}
        slotProps={{ primary: { variant: 'body2', noWrap: true }, secondary: { variant: 'caption' } }}
      />
      {level !== undefined && level !== '' && (
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0, pt: 0.25 }}>
          {level}
        </Typography>
      )}
    </ListItemButton>
  )
}

/** One titled section with its own list. An empty section still renders its title and says why. */
function Section({
  title,
  note,
  rows,
  selectedId,
  onSelect,
  empty
}: {
  title: string
  note: string
  rows: readonly MapPaneRow[]
  selectedId: string | null
  onSelect: (row: MapPaneRow) => void
  empty: string
}): JSX.Element {
  return (
    <Stack spacing={0.5} sx={{ mb: 1 }}>
      <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ px: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.disabled" noWrap>
          {note}
        </Typography>
      </Stack>
      {rows.length > 0 ? (
        <List dense disablePadding>
          {rows.slice(0, SECTION_ROWS).map((r) => (
            <Row key={r.id} row={r} selected={r.id === selectedId} onSelect={onSelect} />
          ))}
        </List>
      ) : (
        <Typography variant="caption" color="text.disabled" sx={{ px: 1, pb: 0.5 }}>
          {empty}
        </Typography>
      )}
    </Stack>
  )
}

export default function MapMobPane(props: MapMobPaneProps): JSX.Element {
  const { zoneName, mobs, labels, counts, query, onQuery, selectedId, onSelect, pinsCapped } = props
  return (
    <Paper
      variant="outlined"
      data-testid="maps-pane"
      sx={{
        width: PANE_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      <Box sx={{ p: 1, pb: 0.75, flexShrink: 0 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Find a mob or label…"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
          }}
          slotProps={{ htmlInput: { 'data-testid': 'maps-pane-search' } }}
        />
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
          <Tooltip
            title={`${String(counts.located)} of ${String(counts.mobs)} named mobs here state a position on their wiki page — the rest are listed without a pin`}
          >
            <Chip
              size="small"
              variant="outlined"
              data-testid="maps-pane-counts"
              label={`${String(counts.located)}/${String(counts.mobs)} placed`}
            />
          </Tooltip>
          <Chip size="small" variant="outlined" label={`${String(counts.labels)} labels`} />
          {pinsCapped && (
            <Tooltip title="Narrow the search to see the rest — the map draws a bounded number of pins at once">
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                data-testid="maps-pane-capped"
                label={`first ${String(MAX_PINS)} pinned`}
              />
            </Tooltip>
          )}
        </Stack>
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }} data-testid="maps-pane-scroll">
        <Section
          title="Named mobs"
          note="wiki"
          rows={mobs}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={
            zoneName == null
              ? 'No zone is open.'
              : counts.mobs === 0
                ? 'The mob catalog has no rows for this zone.'
                : 'No mob matches.'
          }
        />
        <Section
          title="Map labels"
          note="this map"
          rows={labels}
          selectedId={selectedId}
          onSelect={onSelect}
          empty={counts.labels === 0 ? 'This map has no label points.' : 'No label matches.'}
        />
      </Box>
    </Paper>
  )
}
