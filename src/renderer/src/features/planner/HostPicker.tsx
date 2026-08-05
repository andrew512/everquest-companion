// planner/HostPicker.tsx — "which item am I socketing this into?" (design §5.3, the host line).
//
// A POPOVER OVER THE CELL, not a page: picking a host is one decision about one slot, and the
// board around it is the context you are picking against. It searches main's item index
// (`plannerSearchItems`, substring over item NAMES, capped at 50) and then narrows what came back
// to what can actually go in THIS cell — R2's two halves:
//   * the item must occupy this equip slot, and
//   * it must share a class with the set's trio.
// Both filters run HERE rather than in main because the cell (its slot, its set's classes) is the
// only place that knows them, and 50 rows is nothing to scan.
//
// A CLASS THE PAGE NEVER STATED IS NOT A FAILED CLASS (law 1): items whose page lists no usable
// classes stay in the list, chipped `class unknown`, instead of being silently filtered out on
// the strength of a fact nobody wrote down.
//
// The list is a FIXED-height scroll box for the standing reason (AGENTS.md): a popover that grows
// with its hit count would walk off the screen.

import { type JSX, useDeferredValue, useEffect, useState } from 'react'
import { Box, Chip, CircularProgress, Popover, Stack, TextField, Typography } from '@mui/material'
import type { ClassAbbr } from '@shared/classCombo'
import type { EquipSlot, PlannerItemHit } from '@shared/planner/types'
import { itemIconUrl } from '../../lib/ItemWindow'

/** Shortest query worth a round trip — one letter matches thousands of items and says nothing. */
const MIN_QUERY = 2
const LIST_MAX_H = 260

/** R2, client side: this item can host in this cell for this set. Unknown classes stay in. */
export function hostFits(
  hit: PlannerItemHit,
  slot: EquipSlot,
  planClasses: readonly ClassAbbr[]
): boolean {
  if (!hit.slots.includes(slot)) return false
  if (planClasses.length === 0 || hit.classes.length === 0) return true
  return hit.classes.some((c) => planClasses.includes(c))
}

interface HitsState {
  hits: PlannerItemHit[]
  loading: boolean
}

/** One search per settled query. An in-flight answer for an older query is dropped, not shown. */
function useHostSearch(query: string, open: boolean): HitsState {
  const [state, setState] = useState<HitsState>({ hits: [], loading: false })
  useEffect(() => {
    if (!open || query.trim().length < MIN_QUERY) {
      setState({ hits: [], loading: false })
      return
    }
    let alive = true
    setState((prev) => ({ hits: prev.hits, loading: true }))
    void window.eq
      .plannerSearchItems(query.trim())
      .then((hits) => {
        if (alive) setState({ hits, loading: false })
      })
      .catch(() => {
        /* main never rejects; an empty list is the honest answer */
        if (alive) setState({ hits: [], loading: false })
      })
    return () => {
      alive = false
    }
  }, [query, open])
  return state
}

export interface HostPickerProps {
  slot: EquipSlot
  planClasses: readonly ClassAbbr[]
  anchor: HTMLElement | null
  onClose: () => void
  onPick: (hit: PlannerItemHit) => void
}

function HitRow({ hit, onPick }: { hit: PlannerItemHit; onPick: (h: PlannerItemHit) => void }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="planner-host-hit"
      onClick={() => onPick(hit)}
      sx={{
        px: 1,
        py: 0.5,
        cursor: 'pointer',
        flexWrap: 'nowrap',
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      {hit.iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(hit.iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: 20, height: 20, imageRendering: 'pixelated', flexShrink: 0 }}
        />
      )}
      <Typography variant="body2" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
        {hit.name}
      </Typography>
      <Box sx={{ flexGrow: 1, minWidth: 4 }} />
      {hit.classes.length === 0 && (
        <Chip size="small" variant="outlined" label="class unknown" sx={{ height: 18, fontSize: 10 }} />
      )}
    </Stack>
  )
}

export default function HostPicker({ slot, planClasses, anchor, onClose, onPick }: HostPickerProps): JSX.Element {
  const [text, setText] = useState('')
  const query = useDeferredValue(text)
  const open = anchor !== null
  const { hits, loading } = useHostSearch(query, open)
  const usable = hits.filter((h) => hostFits(h, slot, planClasses))

  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 340 } } }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={`Host item for ${slot}`}
          value={text}
          data-testid="planner-host-search"
          onChange={(e) => setText(e.target.value)}
        />
      </Box>
      <Box sx={{ maxHeight: LIST_MAX_H, overflow: 'auto', borderTop: 1, borderColor: 'divider' }}>
        {usable.map((hit) => (
          <HitRow key={hit.key} hit={hit} onPick={onPick} />
        ))}
        {usable.length === 0 && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5 }}>
            {loading && <CircularProgress size={14} />}
            <Typography variant="caption" color="text.secondary">
              {text.trim().length < MIN_QUERY
                ? 'Type at least two letters.'
                : loading
                  ? 'Searching…'
                  : `No item matching that can go in ${slot} for this set.`}
            </Typography>
          </Stack>
        )}
      </Box>
    </Popover>
  )
}
