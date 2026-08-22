// BEST AT THIS LEVEL — the Leveling tab's right-hand efficiency readout (JOS-445).
//
// "New at this level" says what a level GAVE you. This says what to cast: of everything the loadout
// already owns, ranked at the level being viewed. The arithmetic is all in `shared/bestSpells.ts`
// (pure, node-tested); this file decides only how it is drawn.
//
// TWO SECTIONS, NOT ONE TABLE WITH A TOGGLE. The owner asked for seven sortable columns and for two
// answers — best damage by dps, best healing by hps. This column is a third of the row at `lg` with
// a 260px floor at the app's own minimum width, so seven numeric columns is ~30px each and reads as
// nothing. `SIDE_COLUMNS` splits them four and four (mana in both, because "what does it cost" is
// the same question either way) and both sections are drawn at once: a toggle would hide one of the
// two answers behind a click, and the page is the scroller here (JOS-289) so vertical space is the
// cheap axis. Each section carries its OWN sort, which is what makes "best damage by dps AND best
// healing by hps" a default state rather than a thing to set up.
//
// IT IS NOT GATED ON THE CHARTS, and that is the placement rule (owner, 2026-08-22: the readout
// belongs on the right side of the panel). Its neighbour below, `LedgerColumn`, is every panel that
// reads a SCOPE and therefore needs a chartable log; this one needs no log at all beyond the
// loadout, exactly like `NewAtLevelPanel`. A fresh character with two dings still wants to know
// which nuke is his best. So the right column exists whenever EITHER is drawable and this sits at
// the top of it.
//
// THE LEVEL IS THE TAB'S, NOT THIS PANEL'S. `LevelingView` owns the viewed level and hands the same
// number to this panel and to the stepper inside `NewAtLevelPanel` — one control, two readouts. Two
// steppers would be two levels on one screen and no way to tell which one a table is about.
//
// NO INNER SCROLLER (JOS-289, and `leveling.e2e` measures it): the top ten are drawn and the rest
// sit behind a `+N more` disclosure, the same one-click shape the out-of-era rows use. A porthole
// in a column that has no height to give is exactly what that ticket removed.
//
// ERA: `outOfEraLabel`, IMPORTED from the mob page the way `UnlockList` imports it — a second copy
// would be a second wording. Positive verdicts fold; silence is not a verdict and stays in place.

import { type JSX, useMemo, useState } from 'react'
import {
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography
} from '@mui/material'
import {
  COLUMN_LABEL,
  COLUMN_TITLE,
  SIDE_COLUMNS,
  bestSpellsAt,
  columnValue,
  defaultSort,
  type BestSpellColumn,
  type BestSpellRow,
  type BestSpellSide,
  type BestSpellSort,
  type BestSpellsSide
} from '@shared/bestSpells'
import { Tooltip } from '../../lib/Tooltip'
import { SpellTooltip } from '../../lib/SpellCard'
import { outOfEraLabel } from '../mobs/dropEra'
import { NONE } from './rangeStatsRows'
import { useCurrentComboClasses, useLevelUnlocks } from './useLevelUnlocks'
import { comboClassSet } from '@shared/levelUnlocks'

/** How many rows are drawn before the disclosure. The owner's suggestion, and it fits the column. */
const TOP_N = 10

const CELL_SX = { py: 0.25, px: 0.6, fontSize: 11, borderBottom: 'none' } as const
const HEAD_SX = { ...CELL_SX, fontWeight: 700, whiteSpace: 'nowrap', color: 'text.secondary' } as const

/** The two sections, in the order the owner named them. */
const SIDES: readonly { side: BestSpellSide; title: string }[] = [
  { side: 'damage', title: 'Best damage' },
  { side: 'heal', title: 'Best healing' }
]

/**
 * A figure, formatted the way `spellMetricsParts` formats the same figure on an unlock row.
 *
 * Totals and rates are whole numbers (nobody buys a spell on a tenth of a point); the per-mana
 * ratios keep the one decimal `spellMetricsAt` rounded them to, because there the tenth is most of
 * the difference between two spells. An ABSENT figure is the app's null cell, never a zero.
 */
function cellText(row: BestSpellRow, column: BestSpellColumn): string {
  const v = columnValue(row, column)
  if (v === null) return NONE
  return column === 'damagePerMana' || column === 'healPerMana' ? String(v) : String(Math.round(v))
}

/** One sortable header. Clicking the active column flips it; clicking another takes it descending. */
function HeadCell({
  column,
  sort,
  onSort
}: {
  column: BestSpellColumn
  sort: BestSpellSort
  onSort: (s: BestSpellSort) => void
}): JSX.Element {
  const active = sort.column === column
  return (
    <TableCell align="right" sx={HEAD_SX} sortDirection={active ? (sort.desc ? 'desc' : 'asc') : false}>
      <Tooltip title={COLUMN_TITLE[column]}>
        <TableSortLabel
          active={active}
          direction={active && !sort.desc ? 'asc' : 'desc'}
          data-testid="best-spells-sort"
          data-column={column}
          data-active={active ? 'true' : 'false'}
          onClick={() => onSort({ column, desc: active ? !sort.desc : true })}
        >
          {COLUMN_LABEL[column]}
        </TableSortLabel>
      </Tooltip>
    </TableCell>
  )
}

/**
 * One spell row: the name (carrying the full spell card, like every other spell name in this tab),
 * the level it became yours, and the side's four figures.
 *
 * The gain level is the row's own provenance and the reason this table is not a repeat of the panel
 * below it: `Garrison's Mighty Mana Shock` sitting second at 35 with an `L18` beside it is the
 * whole answer the owner asked for.
 */
function SpellRow({ row, columns }: { row: BestSpellRow; columns: readonly BestSpellColumn[] }): JSX.Element {
  return (
    <TableRow hover data-testid="best-spells-row" data-name={row.name}>
      <TableCell sx={{ ...CELL_SX, maxWidth: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ minWidth: 0 }}>
          <SpellTooltip name={row.name}>
            <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600 }} noWrap>
              {row.name}
            </Typography>
          </SpellTooltip>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9.5 }} noWrap>
            L{row.gainedAt}
          </Typography>
        </Stack>
      </TableCell>
      {columns.map((c) => (
        <TableCell key={c} align="right" sx={CELL_SX} data-testid="best-spells-cell" data-column={c}>
          {cellText(row, c)}
        </TableCell>
      ))}
    </TableRow>
  )
}

/** A one-click disclosure over rows the section is not showing by default. */
function RowDisclosure({
  label,
  testid,
  rows,
  columns
}: {
  label: string
  testid: string
  rows: readonly BestSpellRow[]
  columns: readonly BestSpellColumn[]
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <>
      <TableRow>
        <TableCell colSpan={columns.length + 1} sx={{ ...CELL_SX, py: 0 }}>
          <Box
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setOpen(!open)
            }}
            data-testid={testid}
            sx={{ cursor: 'pointer', color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <Typography variant="caption" sx={{ fontSize: 10 }}>
              {label}
            </Typography>
          </Box>
        </TableCell>
      </TableRow>
      {open && rows.map((r) => <SpellRow key={r.name} row={r} columns={columns} />)}
    </>
  )
}

/**
 * One side's table. Empty is STATED rather than blank: a wizard has no healing table and a warrior
 * has neither, and both are honest answers rather than a panel that failed to load.
 */
function SideTable({
  side,
  title,
  data,
  sort,
  onSort
}: {
  side: BestSpellSide
  title: string
  data: BestSpellsSide
  sort: BestSpellSort
  onSort: (s: BestSpellSort) => void
}): JSX.Element {
  const columns = SIDE_COLUMNS[side]
  const top = data.shown.slice(0, TOP_N)
  const rest = data.shown.slice(TOP_N)
  return (
    <Box data-testid="best-spells-section" data-side={side} data-sort={sort.column} data-desc={String(sort.desc)}>
      <Typography variant="caption" color="text.secondary">
        {title} ({data.shown.length})
      </Typography>
      {data.shown.length === 0 && data.outOfEra.length === 0 ? (
        <Typography variant="caption" color="text.disabled" display="block" data-testid="best-spells-empty">
          nothing this loadout owns yet
        </Typography>
      ) : (
        <Table size="small" sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_SX}>spell</TableCell>
              {columns.map((c) => (
                <HeadCell key={c} column={c} sort={sort} onSort={onSort} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {top.map((r) => (
              <SpellRow key={r.name} row={r} columns={columns} />
            ))}
            <RowDisclosure
              label={`+${String(rest.length)} more`}
              testid="best-spells-more"
              rows={rest}
              columns={columns}
            />
            <RowDisclosure
              label={outOfEraLabel(data.outOfEra.length)}
              testid="best-spells-era-toggle"
              rows={data.outOfEra}
              columns={columns}
            />
          </TableBody>
        </Table>
      )}
    </Box>
  )
}

export interface BestSpellsPanelProps {
  /** The level the TAB is showing — the same number the unlock stepper displays. */
  level: number
}

/**
 * WILL THERE BE A READOUT? Asked one layer up, by the column that HOLDS it.
 *
 * The `chartedOf` arrangement in LevelingView, for the same reason: two placements read one gate.
 * The right column exists when this panel or the ledger below it is drawable, and a column band
 * with nothing in it is a layout the tab's own e2e measures (`columnsInfo` counts the bands). The
 * test is `comboClassSet(...).length > 0` and it is the SAME test the panel applies to itself —
 * `bestSpellsAt` returns exactly that set as `classes`.
 */
export function useBestSpellsVisible(): boolean {
  const combo = useCurrentComboClasses()
  return comboClassSet(combo).length > 0
}

/**
 * THE PANEL. Null when the loadout is unknown, and that is the one gate: every row here is a claim
 * about spells YOU own, and there is no honest version of it over sixteen candidate classes. The
 * panel below already teaches the two ways to fix that (a `/who`, or a Profile correction), so
 * repeating the sentence in the column beside it would be the same instruction twice.
 */
export function BestSpellsPanel({ level }: BestSpellsPanelProps): JSX.Element | null {
  const data = useLevelUnlocks()
  const combo = useCurrentComboClasses()
  const [sorts, setSorts] = useState<Record<BestSpellSide, BestSpellSort>>({
    damage: defaultSort('damage'),
    heal: defaultSort('heal')
  })
  // Re-ranked by the LEVEL and by the SORT, and by nothing else — the whole readout is one pure
  // call over an already-cached dataset, so stepping the level costs one fold of ~1,450 rows.
  const best = useMemo(() => bestSpellsAt(data, combo, level, sorts), [data, combo, level, sorts])
  if (best.classes.length === 0) return null
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="best-spells" data-level={String(level)}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">Best at level {level}</Typography>
        {/* THE SAME ONE QUIET WORD the panel below says, for the same reason: these are base
            figures with no crits, focus, AA or recast in them. Said once per surface, never on a
            row (AGENTS.md, the caveat diet). */}
        <Typography variant="caption" color="text.disabled" data-testid="best-spells-directional">
          directional
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {best.ambiguous && (
          <Tooltip title="Covers every class your loadout could still be.">
            <Chip
              size="small"
              label="~ambiguous"
              data-testid="best-spells-ambiguous"
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
          </Tooltip>
        )}
      </Stack>
      <Stack spacing={1}>
        {SIDES.map((s) => (
          <SideTable
            key={s.side}
            side={s.side}
            title={s.title}
            data={best[s.side]}
            sort={sorts[s.side]}
            onSort={(next) => setSorts((prev) => ({ ...prev, [s.side]: next }))}
          />
        ))}
      </Stack>
    </Paper>
  )
}
