// The map viewer's CONTROLS: the zone selector, zoom / fit, the layer toggles, the per-layer
// pack choice.
//
// THE ZONE SELECTOR IS THE ONLY CONTROL THAT RENDERS WITH NO MAP ON SCREEN, and it renders
// FIRST. Everything else here describes the drawing — which layers, which floor, which pack —
// and a control that states a fact about nothing is worse than an absent one. The selector is
// the opposite case: it is how you get a map at all, and how you leave the one you have
// (MapZoneSelect.tsx carries why that has to be permanent).
//
// STATE, NEVER PROCESS (AGENTS.md UI conventions). Every control here states a fact — which
// layers are drawn, which pack each half came from, which zone is open. Nothing narrates.
//
// NOTHING HERE SEARCHES. The bar used to carry a `Search labels…` box, a This zone / All zones
// scope toggle and a sidebar toggle called `Zone` — three controls asking the same question the
// sidebar's one box now answers, in a hit list that lived somewhere else entirely (MapMobPane.tsx
// carries the merge). What is left describes the DRAWING, which is the only thing this row was
// ever coherent about.
//
// WHY THE PACK CHOICE IS PER LAYER, and why `Auto` is the default: MEASURED (§1a) — the game's
// own map set holds 285 label points across 58 files while the shipped Brewall pack holds 26,607
// across 562. Geometry wants the EQL-authored default set; labels are a Brewall-pack feature.
// `Auto` is that resolution order, and it is what makes the search box non-empty on a stock
// install. Naming a pack here only overrides the order, never the merge.
//
// THE LEGEND LAYER IS OFF BY DEFAULT and that is not cosmetic: `_2` files draw a colour key at
// fixed off-map coordinates (measured, `brewall\airplane_2.txt`: y ∈ [-250, 4800] against a map
// of y ∈ [-1668, 1737]). It is excluded from the bounds by the parser, so switching it on shows
// it sitting outside the zone rather than shrinking the zone to a speck.

import type { JSX, KeyboardEvent } from 'react'
import {
  Box,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import type { MapLayer, MapPackInfo, MapPackPrefs, ZoneShort } from '@shared/maps'
import { bandLabel, type FloorBand } from './floorSlice'
import type { LayerMask } from './mapGeometry'
import ZoneSelect from './MapZoneSelect'
import { Tooltip } from '../../lib/Tooltip'

/** The three optional layers, in file order. Layer 0 (the zone's geometry) is always drawn. */
const TOGGLEABLE: { layer: MapLayer; label: string }[] = [
  { layer: 1, label: 'Labels' },
  { layer: 2, label: 'Legend' },
  { layer: 3, label: 'Extra' }
]

/**
 * The FLOOR STEPPER — a discrete walk up and down the zone's clustered elevations (§8).
 *
 * IT IS MANUAL, AND SAYING SO IS THE POINT. The in-game height filter follows your CHARACTER
 * ("N units above and below"); the log states the zone you entered and nothing else positional,
 * so there is no character z here and no honest auto-select. Default is All levels; the control
 * never claims to know which floor you are standing on (world-model law 1 and law 6).
 *
 * Compact by construction — two arrows and a chip — because a dozen bands as a button group
 * would be wider than every other control on this row put together. Fully keyboard operable:
 * both arrows are real buttons, and ↑/↓/Home work anywhere in the group.
 */
function FloorStepper({
  bands,
  floor,
  onFloor
}: {
  bands: readonly FloorBand[]
  floor: number | null
  onFloor: (floor: number | null) => void
}): JSX.Element | null {
  // One band is not a slice — there is nothing to step between, so the control does not appear.
  if (bands.length < 2) return null
  const at = floor ?? -1
  // -1 is "All levels", so the list is [All, floor 1 … floor N] and stepping is plain arithmetic.
  const step = (d: number): void => {
    const next = Math.min(bands.length - 1, Math.max(-1, at + d))
    onFloor(next < 0 ? null : next)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowUp') step(1)
    else if (e.key === 'ArrowDown') step(-1)
    else if (e.key === 'Home') onFloor(null)
    else return
    e.preventDefault()
  }
  const band = floor == null ? null : bands[floor]
  return (
    <Stack direction="row" spacing={0.25} alignItems="center" data-testid="maps-floors" onKeyDown={onKeyDown}>
      <Tooltip title="Lower level">
        <span>
          <IconButton size="small" data-testid="maps-floor-down" disabled={at <= -1} onClick={() => { step(-1) }}>
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip
        title={
          band ? `Elevation ${bandLabel(band)}` : 'Every elevation'
        }
      >
        <Chip
          size="small"
          variant={floor == null ? 'outlined' : 'filled'}
          data-testid="maps-floor-label"
          onClick={() => { onFloor(null) }}
          label={floor == null ? 'All levels' : `Level ${String(floor + 1)} of ${String(bands.length)}`}
          sx={{ minWidth: 104 }}
        />
      </Tooltip>
      <Tooltip title="Higher level">
        <span>
          <IconButton
            size="small"
            data-testid="maps-floor-up"
            disabled={at >= bands.length - 1}
            onClick={() => { step(1) }}
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
}

export interface MapToolbarProps {
  /** Every stem any installed pack provides, ascending — the selector's corpus. */
  zones: readonly ZoneShort[]
  /** The stem the viewer is pointed at, drawn or not. */
  zone: ZoneShort | null
  onPick: (zone: ZoneShort) => void
  /** Is a map actually DRAWN? Everything but the selector describes the drawing, so nothing
   *  else renders without one — a floor stepper over no floors states nothing. */
  hasMap: boolean
  layers: LayerMask
  onLayers: (layers: LayerMask) => void
  /** The zone's clustered floors, ascending. Fewer than two ⇒ the stepper does not render. */
  bands: readonly FloorBand[]
  /** The active floor index, or null for All levels. */
  floor: number | null
  onFloor: (floor: number | null) => void
  packs: readonly MapPackInfo[]
  prefs: MapPackPrefs
  onPrefs: (prefs: MapPackPrefs) => void
  /** The view is tighter than the whole zone — zoom-out and Fit have something to do. */
  zoomedIn: boolean
  /** > 1 zooms in, < 1 out, around the pane centre. */
  onZoom: (factor: number) => void
  onFit: () => void
}

/**
 * The "no preference" option's value.
 *
 * A SENTINEL rather than `''`: an empty-string value renders an empty closed select, so the only
 * thing visible is the floating field label and the control reads as if it had failed to load.
 * `Auto` is a real, statable choice — it is the cross-pack resolution order (§6.3) — so it says
 * so. The `#` makes it unspellable as a pack id — ids are directory names run through
 * `isSafePackId` (`/^[A-Za-z0-9_][A-Za-z0-9._-]*$/`), so no real pack can ever collide with it.
 */
const AUTO = '#auto'

/** One `<TextField select>` over the installed packs. `AUTO` is the resolution order. */
function PackSelect({
  label,
  value,
  packs,
  onChange
}: {
  label: string
  value: string | undefined
  packs: readonly MapPackInfo[]
  onChange: (id: string | undefined) => void
}): JSX.Element {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? AUTO}
      onChange={(e) => {
        onChange(e.target.value === AUTO ? undefined : e.target.value)
      }}
      sx={{ minWidth: 150 }}
    >
      <MenuItem value={AUTO}>Auto</MenuItem>
      {packs.map((p) => (
        <MenuItem key={p.id} value={p.id}>
          {p.name}
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * The controls that describe the DRAWING — absent when there is nothing drawn.
 *
 * A Fragment, not a Box: `Stack useFlexGap` spaces its DOM children, and a wrapper here would
 * collapse eight controls into one gap-spaced unit and re-open the layout question the toolbar
 * already answered.
 */
function DrawnControls(props: MapToolbarProps): JSX.Element {
  const { layers, onLayers, bands, floor, onFloor, packs, prefs, onPrefs } = props
  const { zoomedIn, onZoom, onFit } = props
  const on = TOGGLEABLE.filter((t) => layers[t.layer]).map((t) => String(t.layer))
  return (
    <>
      <Box>
        <Tooltip title="Zoom in">
          <IconButton size="small" data-testid="maps-zoom-in" onClick={() => { onZoom(1.35) }}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton size="small" data-testid="maps-zoom-out" onClick={() => { onZoom(1 / 1.35) }}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit the whole zone">
          <span>
            <IconButton size="small" data-testid="maps-fit" disabled={!zoomedIn} onClick={onFit}>
              <CenterFocusStrongIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <ToggleButtonGroup
        size="small"
        value={on}
        data-testid="maps-layers"
        onChange={(_e, next: string[]) => {
          onLayers([true, next.includes('1'), next.includes('2'), next.includes('3')])
        }}
      >
        {TOGGLEABLE.map((t) => (
          <ToggleButton key={t.layer} value={String(t.layer)} data-testid={`maps-layer-${String(t.layer)}`}>
            {t.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <FloorStepper bands={bands} floor={floor} onFloor={onFloor} />

      <PackSelect
        label="Geometry"
        value={prefs.geometry}
        packs={packs}
        onChange={(id) => {
          onPrefs({ ...prefs, ...(id == null ? { geometry: undefined } : { geometry: id }) })
        }}
      />
      <PackSelect
        label="Labels"
        value={prefs.labels}
        packs={packs}
        onChange={(id) => {
          onPrefs({ ...prefs, ...(id == null ? { labels: undefined } : { labels: id }) })
        }}
      />
    </>
  )
}

export default function MapToolbar(props: MapToolbarProps): JSX.Element {
  const { zones, zone, onPick, hasMap } = props
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      data-testid="maps-toolbar"
      sx={{ flexShrink: 0 }}
    >
      <ZoneSelect zones={zones} zone={zone} onPick={onPick} />
      {hasMap && <DrawnControls {...props} />}
    </Stack>
  )
}
