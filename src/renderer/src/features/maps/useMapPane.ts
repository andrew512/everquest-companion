// The zone pane's STATE — its query, its two filtered lists, and which row is selected.
//
// IT LIVES ABOVE THE PANE, not inside it, and that is the whole reason this file exists: the
// pane LISTS the mobs and the surface PINS them, and both must be showing the same set. Typing
// "sarnak" has to narrow the map and the list together, so the filtered rows are derived exactly
// once, here, and handed to both. A pane that owned its own query would need a callback back up
// to the surface, and the two would be one render out of step forever.
//
// EVERYTHING IS DERIVED FROM THE DATA, NEVER FROM THE QUERY. `mobRows` walks the 7,866-row
// catalog and `labelRows` walks the map's points; both are memoized on the zone / the points, so
// a keystroke re-filters an array that already exists. The catalog scan is the expensive half and
// it runs once per zone (MEASURED precedent: the same join costs ~3ms on the Mobs tab).
//
// THE SELECTION IS A ROW ID, not a coordinate. Ids survive re-filtering (the ring stays on the
// row you clicked while you keep typing) and they are cleared when the map changes, because a
// mob id means nothing in another zone.

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { MapData, MapPoint } from '@shared/maps'
import type { MobEntry } from '@shared/types'
import { MOB_CATALOG } from '../mobs/mobSearch'
import { loadPaneOpen, savePaneOpen } from './useMapData'
import type { MapViewport } from './useMapViewport'
import {
  filterPaneRows,
  labelRows,
  mobRows,
  paneCounts,
  pinsForRows,
  rowTarget,
  type LabelPaneRow,
  type MapPaneRow,
  type MobPaneRow,
  type PaneCounts,
  type PlacedPin
} from './mobPins'

export interface MapPaneArgs {
  /** The LONG zone name to join the catalog on. `null` ⇒ no zone is open. */
  zoneName: string | null
  /** The map's own label points — `MapData.points`, already parsed by main. */
  points: readonly MapPoint[]
  /** The committed mob catalog. */
  catalog: MobEntry[]
  /** Identity of the loaded map. A change clears the selection. */
  mapId: string
  /** Centre the viewport on a map coordinate — `vp.centerOn`, curried by the caller. */
  onCenter: (x: number, y: number) => void
}

export interface MapPaneState {
  query: string
  setQuery: (q: string) => void
  /** The mobs currently listed AND pinned. */
  mobs: MobPaneRow[]
  labels: LabelPaneRow[]
  counts: PaneCounts
  /** The pins the surface draws — computed HERE so the list and the map share one walk. */
  pins: PlacedPin[]
  /** The drawn set hit `MAX_PINS`. Stated in the pane rather than silently trimmed. */
  pinsCapped: boolean
  selectedId: string | null
  /** Where the selected row is, in map coordinates — the ring's position. */
  selectedAt: { x: number; y: number } | null
  select: (row: MapPaneRow) => void
}

export function useMapPane({ zoneName, points, catalog, mapId, onCenter }: MapPaneArgs): MapPaneState {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ id: string; x: number; y: number } | null>(null)
  // The box echoes every keystroke; only the filtering waits for the paint to settle.
  const q = useDeferredValue(query)

  const allMobs = useMemo<MobPaneRow[]>(
    () => (zoneName == null ? [] : mobRows(zoneName, catalog)),
    [zoneName, catalog]
  )
  const allLabels = useMemo<LabelPaneRow[]>(() => labelRows(points), [points])
  const mobs = useMemo(() => filterPaneRows(allMobs, q), [allMobs, q])
  const labels = useMemo(() => filterPaneRows(allLabels, q), [allLabels, q])
  const counts = useMemo(() => paneCounts(allMobs, allLabels), [allMobs, allLabels])
  const drawn = useMemo(() => pinsForRows(mobs), [mobs])

  // A row id from another zone would ring a coordinate that is no longer on this map.
  useEffect(() => {
    setSelected(null)
  }, [mapId])

  const select = useCallback(
    (row: MapPaneRow) => {
      const at = rowTarget(row)
      // Unlocatable rows are already disabled in the pane; this is the belt-and-braces half, so
      // no caller can ever produce a ring floating at a position nothing stated.
      if (at == null) return
      setSelected({ id: row.id, x: at.x, y: at.y })
      onCenter(at.x, at.y)
    },
    [onCenter]
  )

  return {
    query,
    setQuery,
    mobs,
    labels,
    counts,
    pins: drawn.pins,
    pinsCapped: drawn.capped,
    selectedId: selected?.id ?? null,
    selectedAt: selected ? { x: selected.x, y: selected.y } : null,
    select
  }
}

// ---- the view's whole pane wiring, in one call ------------------------------------------

/** Scale bump when centring from a FITTED view — fitted, a spawn point is a couple of pixels. */
const JUMP_ZOOM = 6

/** Module-level so "no map loaded" is a STABLE reference: a fresh `[]` per render would
 *  re-derive the label rows on every render of the view. */
const NO_POINTS: readonly MapPoint[] = []

export interface ZonePaneState extends MapPaneState {
  /** Is the pane on screen? Off by default, remembered in `eq.maps.pane`. */
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * Everything MapsView needs to render the pane and its pins: the persisted open flag, and the
 * pane state itself wired to the viewport's `centerOn`.
 *
 * It lives here rather than inline in the view for the reason the whole module does — the pane
 * and the surface must read ONE derivation — and because the view is at the repo's complexity
 * ceiling and this is a self-contained slice of it.
 */
export function useZonePane(args: {
  vp: MapViewport
  /** The map on screen, or null while none is loaded. */
  data: MapData | null
  /** The LONG zone name to join the catalog on, or null when nothing is open. */
  zoneName: string | null
}): ZonePaneState {
  const { vp, data, zoneName } = args
  const [open, setOpenState] = useState<boolean>(loadPaneOpen)
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    savePaneOpen(next)
  }, [])

  const { centerOn, zoomedIn, view } = vp
  const onCenter = useCallback(
    (x: number, y: number) => {
      // The same rule the label search's jump uses: centring from a fitted view also zooms in;
      // an already-zoomed view keeps the scale the user chose.
      centerOn(x, y, zoomedIn ? undefined : view.scale * JUMP_ZOOM)
    },
    [centerOn, zoomedIn, view.scale]
  )

  const pane = useMapPane({
    zoneName,
    points: data?.points ?? NO_POINTS,
    catalog: MOB_CATALOG,
    mapId: data?.zone ?? '',
    onCenter
  })
  return { ...pane, open, setOpen }
}

/** What the surface needs from the pane: the pins and the selection. Null ⇒ draw nothing. */
export interface PaneOverlay {
  pins: readonly PlacedPin[]
  selectedId: string | null
  selectedAt: { x: number; y: number } | null
}

export function paneOverlay(pane: ZonePaneState): PaneOverlay | null {
  if (!pane.open) return null
  return { pins: pane.pins, selectedId: pane.selectedId, selectedAt: pane.selectedAt }
}
