// gear/GearTable.tsx — the windowed table: one uniform row per candidate item.
//
// THE FIXED-HEIGHT CONTRACT (JOS-260, lootRows.tsx states the full argument). `useWindowedRows` is
// a FIXED-row-height hook: every spacer, index and scroll offset it computes assumes each row is
// exactly `ROW_HEIGHT`, so a row that wraps to two lines desyncs the whole window and the drift
// compounds with every row above the viewport. `height` alone is only a MINIMUM for a table row,
// so the row states a maximum too and every cell is one clipped, ellipsised line — and the table
// is `tableLayout: fixed` with PERCENTAGE widths, so the columns are taken from the header alone
// (a windowed table can only ever SEE a screenful, and an auto layout would re-measure its columns
// every time scrolling swapped the rows underneath).
//
// A ROW'S KEY IS `row.key` — `itemKey(name)`, the corpus join key every other index in this app
// uses (loot, ownership, donors). That is deliberate and load-bearing beyond React, and phase 4
// (JOS-285) is what it was for: the OWNED column appends after `visibleColumns`' numerics and its
// cell is one `Map.get(row.key)` — no name matching, no normalising, nothing per row but a lookup.
// The words in that cell are all decided in `gearOwnership.ts`, which is pure and node-tested; the
// only judgement made HERE is that no witness at all means no column, because a blank ownership
// cell and "you do not own this" are two different statements and the app cannot tell them apart.
//
// NO MUI TOOLTIP ANYWHERE (JOS-143). These are dense rows under a toolbar full of selects and a
// slider; an interactive popper opened from the first row lands on those controls and eats the
// clicks aimed at them. Every explanation is a native `title`.
//
// AND SINCE JOS-297 THE COLUMN SET CAN BE WIDER THAN THE PANE. Nothing above changes: the table is
// still `tableLayout: fixed`, the row is still exactly `ROW_HEIGHT` tall with one clipped line per
// cell, and the windowing hook's contract does not know that widths exist. What changes is where
// the widths come from — `gearTableLayout` states percentages while they fit and stated pixels plus
// a table `minWidth` once they do not, so a thirty-column set overflows the table's OWN scroller
// (GearView's `gear-list` box, already `overflow: auto`) and never the page. Both halves are
// measured in `tests/e2e/gearColumnSteps.mts`, container-scroll and page-no-scroll in one step.
//
// AND SINCE JOS-335 A SEARCH ROW HAS A GESTURE AGAIN: it goes on the wish list. The tombstone in
// the name cell below records that JOS-325 took the sets `+` away and left the table with no
// per-row action at all, while the Exaltations donor rows kept theirs (JOS-326 re-aimed that button
// at the wish list). This restores the parity: same door (`useWishlist`), same document, same
// dedupe. What it deliberately does NOT restore is a COLUMN — the control shares the item name's
// cell exactly as the `+` did, because `gearTableLayout` states the width of every other column and
// a new one would be a change to the layout contract for a 22px button. See `WishButton`.

import { type JSX, memo, useMemo } from 'react'
import { IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel } from '@mui/material'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import type { GearRow } from '@shared/planner/gear'
import type { WindowedRows } from '../../lib/useWindowedRows'
import { EraChip, DonorName } from '../planner/PlannerChips'
import { gearTableLayout, statText, type GearColumn } from './gearColumns'
import { sortValue, type GearSort, type GearSortKey } from './gearFilter'
import { ownedCellText, ownedCellTitle, ownershipFor, type GearOwnershipMap } from './gearOwnership'
import type { ClassAbbr } from '@shared/classCombo'

/** Dense row height (px), MUI `size="small"` — the number the windowing hook is handed. */
export const ROW_HEIGHT = 37

const FIXED_ROW = {
  height: ROW_HEIGHT,
  maxHeight: ROW_HEIGHT,
  '& td': {
    py: 0,
    maxHeight: ROW_HEIGHT,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
} as const

/**
 * The numeric columns' halved side padding — the other half of `MAX_NUMERIC_WIDTH`'s bargain
 * (gearColumns.ts). The ceiling only holds if a sortable header (label + arrow, ~60px for
 * `Ratio`) fits the cell it states: a label wider than its sticky cell slides under the NEXT
 * header, which then intercepts the click aimed at it — gear.e2e.mts measured exactly that.
 * MUI's default 16px a side spends 32px of a ~60px cell on air; 8px keeps the header its own.
 */
const NUMERIC_PAD = { px: 1 } as const

/** Sixteen classes is `Class: ALL`, and sixteen chips would be the widest cell in the table. */
function classText(classes: readonly ClassAbbr[]): string {
  if (classes.length === 0) return ''
  if (classes.length >= 16) return 'ALL'
  return classes.join(' ')
}

export interface GearTableProps {
  rows: readonly GearRow[]
  columns: readonly GearColumn[]
  win: WindowedRows
  sort: GearSort
  /**
   * The ownership join (JOS-285), keyed by `row.key` — `null` when this character has never
   * written a dump, which removes the column entirely rather than drawing a blank one
   * (gearColumns.ts states why).
   */
  ownership: GearOwnershipMap | null
  /** the Owned header's own explanation, including the uncounted-keyring note when there is one */
  ownedHint: string
  onSort: (key: GearSortKey) => void
  /**
   * Deep-link an item into the Loot tab's drill-down, where the ItemWindow draws its tier block.
   *
   * THE ONLY PER-ROW ACTION THIS TABLE HAS, since JOS-325. There was a second — `onAssign`, the `+`
   * that dropped a search row into the selected gear set (JOS-286) — and it went with the sets
   * surface the owner retired: no pane, no set to add to, nothing for the button to mean. The
   * argument it used to carry (absent beats disabled, because a button that does nothing is a worse
   * answer than no button) survives it as a general rule, and this prop is now the whole of its
   * application here: a host that has nowhere to send the click passes nothing, and `DonorName`
   * draws plain text rather than a link that goes nowhere.
   */
  onOpenLoot?: (item: string) => void
  /**
   * PUT THIS ROW ON THE WISH LIST (JOS-335) — the second per-row action, and the one the general
   * rule above was waiting for.
   *
   * ABSENT, NEVER DISABLED, when the host has no wish list to write to. That is the same house rule
   * `onOpenLoot` applies one prop up, and here it covers exactly one case: the wish document has not
   * loaded yet, so `wished` would be a GUESS rather than a fact and a lit state read off an empty
   * list would be a lie about what is already on it. A button that appears a beat late is honest; a
   * button that says "not wished" about an item that is, is not.
   */
  onWish?: (row: GearRow) => void
  /**
   * The item keys already on the wish list — the lit state, and the reason a second click on the
   * same row is nothing. Keys are `itemKey(name)`, which IS `row.key`: the corpus join key this
   * whole table is built on, so the membership test is one `Set.has` per rendered row.
   */
  wished: ReadonlySet<string>
}

/**
 * ADD TO THE WISH LIST, FROM A SEARCH ROW (JOS-335) — the Exaltations donor row's control, shrunk
 * to what a dense table can carry.
 *
 * WHAT IT SHARES WITH `EffectRows.AddButton`, which is everything that matters: one click, the same
 * `useWishlist` door, the same `WishEntry` dedupe by `itemKey`, no dialog and no menu, and a state
 * that says on sight whether the item is already wanted.
 *
 * WHAT IT CANNOT SHARE IS THE WORDS. That button is a 96px text button reading "Add to wish list" /
 * "Wished" on a 44px browse row whose name column is free to shrink. This table is `tableLayout:
 * fixed` at `ROW_HEIGHT` 37 with a stated width for every column but the name, so a text button in
 * the name cell would take ~100px of it off every one of 6,766 rows, permanently, to say a thing the
 * lit icon says. The icon is the wish list's OWN mark (`WishlistView`'s empty state draws the same
 * heart), so the two surfaces still read as one feature.
 *
 * IT STAYS ENABLED WHEN IT IS LIT, and that is a deliberate divergence from the donor row rather
 * than an omission. Two reasons, and they point the same way. The ticket's own rule is that adding
 * an item that is already wished is a NO-OP — which is what `addWish` does on its own (same list
 * object back, no write, no re-render), so the model is the enforcement and the button does not
 * have to be. And this control explains itself only through its native `title` (JOS-143: no popper
 * anywhere in this table), which Chromium never shows for a disabled control — disabling it would
 * take the lit state's explanation away at exactly the moment there is something to explain.
 */
function WishButton({
  row,
  wished,
  onWish
}: {
  row: GearRow
  wished: boolean
  onWish: (row: GearRow) => void
}): JSX.Element {
  return (
    <IconButton
      size="small"
      data-testid="gear-wish"
      data-wished={wished ? 'true' : undefined}
      color={wished ? 'success' : 'default'}
      aria-label={wished ? `${row.name} is on your wish list` : `Add ${row.name} to your wish list`}
      title={
        wished
          ? 'Already on your wish list. The Wish list tab is where it comes off.'
          : 'Add to your wish list, where it joins the route grouped by where it drops.'
      }
      onClick={() => onWish(row)}
      sx={{ flexShrink: 0, p: 0.25 }}
    >
      {wished ? <FavoriteIcon fontSize="inherit" /> : <FavoriteBorderIcon fontSize="inherit" />}
    </IconButton>
  )
}

/** The spacer rows that reserve the full scroll height — see useWindowedRows. */
function PadRow({ height, colSpan }: { height: number; colSpan: number }): JSX.Element | null {
  if (height <= 0) return null
  return (
    <TableRow style={{ height }}>
      <TableCell colSpan={colSpan} sx={{ p: 0, border: 0 }} />
    </TableRow>
  )
}

/**
 * ONE CANDIDATE. Every number on it is the SCALED one — the row this component is handed has
 * already been through `scaleAll` at the table's plus-state, so nothing here knows the simulation
 * exists. `memo` because a slider drag re-renders the table and most visible rows are unchanged
 * objects when only the sort moved.
 */
const GearLine = memo(function GearLine({
  row,
  columns,
  ownership,
  wished,
  on
}: {
  row: GearRow
  columns: readonly GearColumn[]
  ownership: GearOwnershipMap | null
  /** already on the wish list — a BOOLEAN and not the set, so `memo` can compare it (JOS-335) */
  wished: boolean
  on: { openLoot?: (item: string) => void; wish?: (row: GearRow) => void }
}): JSX.Element {
  // ONE MAP LOOKUP PER RENDERED ROW, and only for the screenful the window mounted. `row.key` is
  // already the ownership key — phase 3's seam — so there is nothing to normalise here.
  const owned = ownership === null ? null : ownershipFor(ownership, row)
  const wish = on.wish
  return (
    <TableRow hover data-testid="gear-row" data-item-key={row.key} sx={FIXED_ROW}>
      <TableCell>
        {/* THE `+` IS GONE FROM THIS CELL (JOS-325) — it put the row into the selected gear set, and
            the sets are retired. WHAT STANDS IN ITS PLACE IS NOT IT (JOS-335): the heart writes a
            wish, which is a document that outlives any pane, and it leads the cell for the reason
            the `+` did — a control column down the left edge of the Item column is one target to
            aim at, where a control after a variable-width name is a moving one. The `Stack` was
            always what let the name share this cell with the era chip, and the FIXED_ROW contract
            above is what keeps all three one clipped line rather than two. */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
          {wish !== undefined && <WishButton row={row} wished={wished} onWish={wish} />}
          <DonorName name={row.name} onOpen={on.openLoot} />
          {/* THE ONE CHIP A SEARCH ROW WEARS, and it is a POINTER rather than a verdict: the era
              join's (out of era / era?), which explains a row you can SEE.

              THE CLASS MISMATCH CHIP IS GONE FROM THIS TABLE (owner ruling 2026-08-13, JOS-302:
              *obviously wrong, it should just be removed*). A row this character's classes cannot
              use is no longer chipped here — it is not here at all, because `filterGearRows` now
              removes it (gearFilter.ts `GearFilters.classes` carries the full argument, including
              why the planner build pane's own mismatch chip stays exactly where it is). A chip that
              can only ever appear on a row the filter already removed would be dead code pretending
              to be a law. */}
          <EraChip subject={row} />
        </Stack>
      </TableCell>
      <TableCell title={row.slots.join(' ')}>{row.slots.join(' ')}</TableCell>
      <TableCell title={row.classes.join(' ')}>{classText(row.classes)}</TableCell>
      {columns.map((c) => (
        <TableCell key={c.key} align="right" data-testid={`gear-cell-${c.key}`} sx={NUMERIC_PAD}>
          {statText(sortValue(row, c.key), c.key)}
        </TableCell>
      ))}
      {owned !== null && (
        <TableCell data-testid="gear-cell-owned" title={ownedCellTitle(owned)}>
          {ownedCellText(owned)}
        </TableCell>
      )}
    </TableRow>
  )
})

/** One sortable header cell — clicking it sorts by that column, clicking again flips direction. */
function SortHeader({
  column,
  sort,
  width,
  align,
  onSort
}: {
  column: { key: GearSortKey; label: string }
  sort: GearSort
  width?: string
  align?: 'right'
  onSort: (key: GearSortKey) => void
}): JSX.Element {
  const active = sort.key === column.key
  return (
    <TableCell align={align} sx={{ ...(width === undefined ? {} : { width }), ...(align === 'right' ? NUMERIC_PAD : {}) }}>
      <TableSortLabel
        active={active}
        direction={active ? sort.dir : 'desc'}
        data-testid={`gear-sort-${column.key}`}
        onClick={() => onSort(column.key)}
      >
        {column.label}
      </TableSortLabel>
    </TableCell>
  )
}

export default function GearTable({
  rows,
  columns,
  win,
  sort,
  ownership,
  ownedHint,
  onSort,
  onOpenLoot,
  onWish,
  wished
}: GearTableProps): JSX.Element {
  const span = columns.length + (ownership === null ? 3 : 4)
  const layout = gearTableLayout(columns.length, ownership !== null)
  // ONE object for the row's callbacks, memoized on the callbacks themselves: `GearLine` is
  // `memo`'d and a fresh literal per render would defeat it on every keystroke. It held two until
  // JOS-325 retired the `+`, and holds two again since JOS-335 — which is exactly why it stayed an
  // object through the year it held one: the wrapper is what the memo depends on.
  const handlers = useMemo(() => ({ openLoot: onOpenLoot, wish: onWish }), [onOpenLoot, onWish])
  return (
    <Table
      size="small"
      stickyHeader
      data-testid="gear-table"
      data-layout={layout.mode}
      // `minWidth`, never `width`: a pane wider than the set still fills it, a narrower one scrolls
      // the table sideways inside its own box. 0 in percentage mode means the table IS the pane.
      sx={{ tableLayout: 'fixed', minWidth: layout.minWidth === 0 ? undefined : layout.minWidth }}
    >
      <TableHead>
        <TableRow>
          {/* In percentage mode the item NAME states no width and takes whatever the stated columns
              leave (LootTables.tsx); in pixel mode every column is stated, because the SUM is what
              makes the table wider than the pane. */}
          <SortHeader column={{ key: 'name', label: 'Item' }} sort={sort} width={layout.name} onSort={onSort} />
          <TableCell sx={{ width: layout.slot }}>Slot</TableCell>
          <TableCell sx={{ width: layout.classes }}>Classes</TableCell>
          {columns.map((c) => (
            <SortHeader key={c.key} column={c} sort={sort} width={layout.numeric} align="right" onSort={onSort} />
          ))}
          {/* The one column that is not a number and not sortable: it reports a live file, and the
              header carries the two things a reader has to know about it — that a `+N` is its own
              copy, and which key rings the fold left out. It stays LAST whatever the picker shows
              (JOS-297): the numerics are what an item reads, this is what you have. */}
          {ownership !== null && (
            <TableCell sx={{ width: layout.owned }} title={ownedHint} data-testid="gear-owned-header">
              Owned
            </TableCell>
          )}
        </TableRow>
      </TableHead>
      <TableBody>
        <PadRow height={win.topPad} colSpan={span} />
        {rows.slice(win.start, win.end).map((row) => (
          <GearLine
            key={row.key}
            row={row}
            columns={columns}
            ownership={ownership}
            wished={wished.has(row.key)}
            on={handlers}
          />
        ))}
        <PadRow height={win.bottomPad} colSpan={span} />
      </TableBody>
    </Table>
  )
}
