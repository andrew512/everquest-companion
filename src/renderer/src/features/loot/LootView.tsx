// LootView — the loot ledger, and (since 2026-08-04) the item drill-down that TAKES THE PANE.
//
// TWO STATES, ONE VIEW. `selected === null` is the ledger: toolbar, summary, notable pickups,
// and the windowed table. A selection swaps the whole body for `ItemDetailPane` — breadcrumb
// "Loot › <item>", a back chevron, and the drill-down at full width. The old modal is gone; see
// that file's header for why.
//
// SCROLL POSITION IS SAVED ACROSS THE SWAP, and that is not a nicety: this table is the
// character's entire loot history, and a reader who clicks a row two thousand rows down must
// come back to it rather than to the top. The list unmounts on the swap (it is the pane that
// takes over), so the offset is captured on the way in and re-applied in a LAYOUT effect on the
// way back — before paint, so there is no visible jump. The windowing hook re-reads the offset
// from the scroll event that assignment fires.
//
// A DEEP LINK LANDS DIRECTLY ON THE DETAIL PANE. `focusItem`/`focusNonce` come from App.tsx's
// `openLoot` (the Overview's drop rows). Keyed on the NONCE, exactly like the Mobs tab's target:
// this view is remounted per character rebuild and unmounted whenever you leave the tab, so the
// effect runs on arrival, and asking for the same item twice must open it twice.

import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { CountSource } from '@shared/types'
import type { NavBack } from '../../appRouting'
import { useWindowedRows } from '../../lib/useWindowedRows'
import { itemCountKey } from '../../lib/itemName'
import { formatDateTime, formatTime } from '../../lib/formatDate'
import { useFavorites } from '../favorites/useFavorites'
import { useProgress } from '../posky/useProgress'
import { ItemDetailPane } from './ItemDetailPane'
import { itemStats, questItemNames } from './lootItemData'
import { ROW_HEIGHT } from './lootRows'
import { LootTable } from './LootTables'
import {
  DEFAULT_LOOT_SORT,
  isLootSortKey,
  LOOT_SORT_OPTIONS,
  type LootSortKey
} from './lootSort'
import { NotablePickupsStrip, useNotableStrip } from './NotablePickupsStrip'
import { useLootRows } from './useLootRows'
import { Tooltip } from '../../lib/Tooltip'

// The grouped table's order picker (JOS-91). Its own component so LootToolbar stays inside the
// measured lines-per-function ceiling.
//
// It is rendered ONLY when grouping is on, and that is a claim about honesty rather than about
// clutter: ungrouped, the ledger is already a chronological one — newest first — so an order
// picker there would be a control that either does nothing or lies about what it changed.
function LootSortSelect({
  sort,
  setSort
}: {
  sort: LootSortKey
  setSort: (v: LootSortKey) => void
}): JSX.Element {
  return (
    <Tooltip title="How the grouped rows are ordered. Favorites stay pinned on top.">
      <TextField
        select
        size="small"
        label="Sort"
        value={sort}
        onChange={(e) => setSort(e.target.value as LootSortKey)}
        sx={{ minWidth: 160 }}
        data-testid="loot-sort"
      >
        {LOOT_SORT_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
    </Tooltip>
  )
}

// The filter bar: search, the two view switches, the grouped table's sort, the opt-in
// inventory-only chip, and the count-source select that decides what "In inventory" is counting.
function LootToolbar({
  query,
  setQuery,
  groupByItem,
  setGroupByItem,
  questOnly,
  setQuestOnly,
  sort,
  setSort,
  invOnlyCount,
  showInventoryOnly,
  onToggleInventoryOnly,
  countSource,
  setCountSource,
  onReload
}: {
  query: string
  setQuery: (v: string) => void
  groupByItem: boolean
  setGroupByItem: (v: boolean) => void
  questOnly: boolean
  setQuestOnly: (v: boolean) => void
  sort: LootSortKey
  setSort: (v: LootSortKey) => void
  invOnlyCount: number
  showInventoryOnly: boolean
  onToggleInventoryOnly: () => void
  countSource: CountSource
  setCountSource: (s: CountSource) => void
  onReload: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
      <TextField
        size="small"
        label="Search looted item"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ minWidth: 260 }}
      />
      <FormControlLabel
        control={<Switch checked={groupByItem} onChange={(e) => setGroupByItem(e.target.checked)} />}
        label="Group by item"
      />
      <FormControlLabel
        control={<Switch checked={questOnly} onChange={(e) => setQuestOnly(e.target.checked)} />}
        label="Only Plane of Sky items"
      />
      {groupByItem && <LootSortSelect sort={sort} setSort={setSort} />}
      {groupByItem && invOnlyCount > 0 && (
        <Tooltip title="Items your inventory export holds that you haven’t looted this epoch.">
          <Chip
            size="small"
            variant={showInventoryOnly ? 'filled' : 'outlined'}
            color={showInventoryOnly ? 'primary' : 'default'}
            label={`+${invOnlyCount.toLocaleString()} in inventory only`}
            onClick={onToggleInventoryOnly}
          />
        </Tooltip>
      )}
      <Box sx={{ flexGrow: 1 }} />
      <Tooltip title="Which source feeds the ‘In inventory’ estimate.">
        <TextField
          select
          size="small"
          label="Count from"
          value={countSource}
          onChange={(e) => setCountSource(e.target.value as CountSource)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="log">Log (looted)</MenuItem>
          <MenuItem value="inventory">Inventory export</MenuItem>
          <MenuItem value="both">Both (max)</MenuItem>
        </TextField>
      </Tooltip>
      <Tooltip title="Run /outputfile inventory in-game, then reload">
        <IconButton size="small" onClick={onReload}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

// The one-line ledger caption. `autoUpdatedAt` is set when main's chokidar watch re-read the
// *-Inventory.txt underneath us — surfaced quietly, in success-green, rather than as a toast.
function LootSummary({
  eventCount,
  uniqueCount,
  inventoryInfo,
  autoUpdatedAt
}: {
  eventCount: number
  uniqueCount: number
  inventoryInfo?: { path: string; loadedAt: string }
  autoUpdatedAt: number | null
}): JSX.Element {
  return (
    <Typography variant="body2" color="text.secondary">
      {eventCount.toLocaleString()} loot events · {uniqueCount.toLocaleString()} unique items · click a
      row for mob/zone/drop-rate breakdown ·{' '}
      {inventoryInfo
        ? `inventory export ${formatDateTime(new Date(inventoryInfo.loadedAt).getTime())}`
        : 'no inventory export loaded'}
      {autoUpdatedAt && (
        <Typography component="span" variant="body2" sx={{ color: 'success.main' }}>
          {' '}· auto-updated {formatTime(autoUpdatedAt)}
        </Typography>
      )}
    </Typography>
  )
}

// The grouped table's order survives restarts, the way the Quests tab's does (useQuestList's
// `eq.questSort`). An order retired from LOOT_SORT_OPTIONS falls back to the default rather than
// sorting by nothing.
const SORT_KEY = 'eq.lootSort'

function loadLootSort(): LootSortKey {
  const v = localStorage.getItem(SORT_KEY)
  return isLootSortKey(v) ? v : DEFAULT_LOOT_SORT
}

/** The grouped order and its persistence, in one line of the view. */
function useLootSort(): [LootSortKey, (v: LootSortKey) => void] {
  const [sort, setSort] = useState<LootSortKey>(loadLootSort)
  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])
  return [sort, setSort]
}

// Nothing parsed yet is a STATE, not an error: say where the rows will come from.
function NoLootYet(): JSX.Element {
  return (
    <Alert severity="info">
      No loot parsed yet. Loot something in-game (or check your log path) — every{' '}
      <code>--You have looted …--</code> line shows up here in real time, and the full history is read
      from your log on launch.
    </Alert>
  )
}

export interface LootViewProps {
  /** An item to open on arrival — the Overview's drop rows deep-linking in. Re-applied whenever
   *  `focusNonce` changes, so the same item asked for twice opens twice. */
  focusItem?: string | null
  focusNonce?: number
  /** Told the moment the focus has been applied, so the router drops it and a later plain visit
   *  to this tab lands on the ledger rather than on wherever the last link pointed. */
  onFocusConsumed?: () => void
  /** The app's ONE back contract (appRouting `NavBack`, JOS-43). Present ⇒ the detail pane's Back
   *  returns to whatever tab deep-linked here (the Planner, the Overview, a Sky quest); absent or
   *  empty ⇒ it means the ledger, exactly as it always did. */
  nav?: NavBack
}

/** Which item the pane has taken over for, and the two ways in and out of it. */
interface LootDetail {
  selected: string | null
  open: (item: string) => void
  close: () => void
}

/**
 * THE PANE-TAKEOVER STATE, and the scroll contract it owes the ledger it replaces.
 *
 * The list unmounts on the swap, so the offset is captured on the way in and re-applied in a
 * LAYOUT effect on the way back — before paint, so returning never flashes the top of an
 * eleven-thousand-row table. A DEEP-LINKED entry saves 0 instead: the reader was on the Overview,
 * so there is no position of theirs to return to — and since JOS-43 "back" does not mean the
 * ledger for them at all, it means the tab they came from.
 *
 * Its own hook rather than inline, so `LootView` itself stays inside the measured
 * lines-per-function ceiling and this rule is readable in one screen.
 */
function useLootDetail(
  props: LootViewProps,
  scrollRef: React.RefObject<HTMLDivElement | null>
): LootDetail {
  const { focusItem, focusNonce, onFocusConsumed } = props
  const [selected, setSelected] = useState<string | null>(null)
  const savedScroll = useRef(0)

  // An inbound focus opens the detail pane, then is consumed. Keyed on the NONCE, not the item's
  // identity — the same item asked for twice must open twice.
  useEffect(() => {
    if (focusItem == null) return
    savedScroll.current = 0
    setSelected(focusItem)
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  useLayoutEffect(() => {
    if (selected === null && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current
  }, [selected, scrollRef])

  return {
    selected,
    open: (item) => {
      savedScroll.current = scrollRef.current?.scrollTop ?? 0
      // A NATIVE drill: the reader clicked a row in the ledger they are standing in, so the list
      // IS where back goes — and whatever a link parked before belongs to a journey that ended
      // when they started browsing here (navOrigin.ts).
      props.nav?.clear()
      setSelected(item)
    },
    close: () => setSelected(null)
  }
}

export default function LootView(props: LootViewProps = {}): JSX.Element {
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  // ONE subscription to the loot module: useProgress already owns it (and needs it for the
  // reconcile), so the merged view reads its history from there rather than holding a
  // second copy of the full loot snapshot.
  const {
    lootHistory: history,
    inventoryRows,
    countSource,
    setCountSource,
    reloadInventory,
    inventoryInfo
  } = useProgress()
  const [query, setQuery] = useState('')
  const [groupByItem, setGroupByItem] = useState(true)
  const [questOnly, setQuestOnly] = useState(false)
  const [sort, setSort] = useLootSort()
  const [showInventoryOnly, setShowInventoryOnly] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // When main auto-reloads the *-Inventory.txt (chokidar watch), surface it quietly.
  const [autoUpdatedAt, setAutoUpdatedAt] = useState<number | null>(null)
  const { knowledgeByKey, strip } = useNotableStrip(history)
  const { events, grouped, groupRows, invOnlySource, invByKey } = useLootRows({
    history,
    inventoryRows,
    query,
    questOnly,
    showInventoryOnly,
    sort,
    isFavorite
  })

  useEffect(() => {
    const off = window.eq.onInventoryReload(() => setAutoUpdatedAt(Date.now()))
    return off
  }, [])

  const onReload = async (): Promise<void> => setToast(await reloadInventory())

  const scrollRef = useRef<HTMLDivElement>(null)
  // Window whichever list is active — only the rows intersecting the viewport are
  // mounted, so a filter keystroke never mounts hundreds of MUI rows synchronously.
  const rowCount = groupByItem ? groupRows.length : events.length
  const win = useWindowedRows({ count: rowCount, rowHeight: ROW_HEIGHT, scrollRef })
  const detail = useLootDetail(props, scrollRef)

  const selected = detail.selected
  if (selected !== null) {
    return (
      <ItemDetailPane
        item={selected}
        events={history.filter((e) => e.item.toLowerCase() === selected.toLowerCase())}
        stats={itemStats[itemCountKey(selected)]}
        isQuestItem={questItemNames.has(itemCountKey(selected))}
        // Back consults the origin stack FIRST and falls back to closing the pane — the whole
        // JOS-43 contract in one line. `back()` reports whether it navigated, so a natively
        // opened drill (nothing parked) behaves exactly as it did before.
        onBack={() => {
          if (!props.nav?.back()) detail.close()
        }}
        onList={detail.close}
        origin={props.nav?.origin?.label ?? null}
      />
    )
  }

  return (
    <Stack spacing={2} data-testid="loot-list" sx={{ height: '100%' }}>
      <LootToolbar
        query={query}
        setQuery={setQuery}
        groupByItem={groupByItem}
        setGroupByItem={setGroupByItem}
        questOnly={questOnly}
        setQuestOnly={setQuestOnly}
        sort={sort}
        setSort={setSort}
        invOnlyCount={invOnlySource.length}
        showInventoryOnly={showInventoryOnly}
        onToggleInventoryOnly={() => setShowInventoryOnly((v) => !v)}
        countSource={countSource}
        setCountSource={setCountSource}
        onReload={() => void onReload()}
      />

      <LootSummary
        eventCount={history.length}
        uniqueCount={grouped.length}
        inventoryInfo={inventoryInfo}
        autoUpdatedAt={autoUpdatedAt}
      />

      <NotablePickupsStrip {...strip} onSelect={detail.open} />

      {history.length === 0 && <NoLootYet />}

      {/* The scroll container owns the ref the windowing hook reads. Spacer rows
          (top/bottom) reserve the full scroll height so only the visible slice of
          MUI rows is mounted — see useWindowedRows. */}
      <Box ref={scrollRef} sx={{ flexGrow: 1, overflow: 'auto' }}>
        <LootTable
          groupByItem={groupByItem}
          rows={groupRows}
          events={events}
          ctx={{ win, isFavorite, knowledgeByKey, invByKey, onToggleFavorite: toggleFavorite, onSelect: detail.open }}
        />
      </Box>

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  )
}
