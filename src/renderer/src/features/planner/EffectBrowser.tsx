// planner/EffectBrowser.tsx — Effects mode: "which effect do I want, and who drops it?" (§5.2).
//
// THE LIST IS FLAT AND UNIFORM, and that is what lets it be windowed. Groups expand into their
// donors, so the natural shape is a tree — but `useWindowedRows` is a FIXED-row-height hook, and a
// growing list must live in a fixed-height scroll box (AGENTS.md UI conventions). So the tree is
// flattened into one row array of one height: a HEADER row, followed by its donor rows while it is
// open. Expanding is then just a longer array, and the DOM node count stays bounded whether the
// filter matches 3 groups or 300.
//
// WHAT THE HEADERS ARE IS A CHOICE NOW, NOT A CONSTANT (V4): `plannerGroups.ts` owns the axes —
// effect, focus family, slot, era — and this file owns none of that logic; it draws whatever
// groups it is handed and remembers which of them are open BY GROUP ID. Switching the axis
// therefore collapses everything, which is correct: the old ids named groups that no longer exist.
//
// EVERY DONOR ROW STATES ITS SOURCE, or says it has none. `sourceIndex` answers from the
// committed mob catalog; `quest` / `playerCrafted` ride on the donor row itself; an item with
// neither renders "no known source" rather than an empty space that reads like a loading state
// (law 1). Class chips are lit for the classes the SET can actually use — the wide-class donors
// light up most, which is precisely the R2 signal that makes them valuable.
//
// THE DONOR NAME HOVERS THE ITEM WINDOW AND CLICKS THROUGH TO THE LOOT DRILL-DOWN
// (`PlannerChips.DonorName`). Both affordances at once: the popup answers "what is it", the link
// answers "and everything else we know about it" — the drill now states the committed DBs' drop
// sources beside the observed ones, which is what made it a fair destination for a never-looted
// donor (see PlannerChips' header, and features/loot/ItemDbSources.tsx).
//
// TWO FILTERS SHRINK THE CORPUS BEFORE ANY OF THAT, and they are opposites in spirit.
//
// THE ERA FILTER IS ON BY DEFAULT and is the difference between a plan and a wish list. The
// committed corpus is scraped from a wiki that documents every expansion, so more than half the
// proc donors drop in Kunark and Velious zones this server has not opened; the toggle hides them,
// donors whose zones the era table cannot place stay visible with a quiet `era?`, and an effect
// whose every donor was hidden disappears with them — an effect row promising four donors that
// expand into nothing would be worse than not listing it.
//
// THE NON-EQUIPPABLE FILTER IS OFF BY DEFAULT, and it is R2 rather than taste: a donor with no
// equipment slot shares a slot with nothing, so its effect can never be socketed anywhere. 284 of
// the 1,468 donor rows are slotless — 217 of them in the Click tab, which is the potion mass, and
// 67 procs, which are poisons and coatings. Turning it on shows them chipped `no slot`, because an
// empty slot list is "the page stated none" (law 1) and just occasionally that is a wiki gap.

import { type JSX, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import type { ClassAbbr } from '@shared/classCombo'
import type { EquipSlot, ExaltPlan, SocketType } from '@shared/planner/types'
import { effectOneLiner } from '@shared/planner/effectText'
import { extractionTier } from '@shared/planner/rules'
import { useWindowedRows } from '../../lib/useWindowedRows'
import { itemIconUrl } from '../../lib/ItemWindow'
import { Tooltip } from '../../lib/Tooltip'
import EffectFilterBar from './EffectFilterBar'
import {
  DEFAULT_FILTERS,
  classFit,
  donorEraOf,
  filterDonors,
  isNonEquippable,
  useDonors,
  useEraOnly,
  useGroupBy,
  useNonEquip,
  type DonorFilters,
  type DonorRow
} from './plannerData'
import {
  SOCKET_LABEL,
  browserRows,
  groupDonors,
  type BrowserRow,
  type DonorGroup
} from './plannerGroups'
import { BestChip, DonorName, EraChip, NoSlotChip } from './PlannerChips'
import { sourceIndex, sourcesFor } from './sourceIndex'

const ROW_HEIGHT = 44
/** How many class chips fit on a dense row before the rest collapse into "+N". */
const CLASS_CHIP_CAP = 6

// ---- one donor's source line ---------------------------------------------------------

interface SourceText {
  text: string
  /** "+3 more" when the catalog knows other mobs; empty when it doesn't */
  more: string
}

/**
 * What the catalog knows about where this donor comes from, in one line. The FIRST source plus a
 * count — a 40-mob drop list belongs in Farm mode, not on a dense row.
 */
function sourceText(donor: DonorRow): SourceText {
  const sources = sourcesFor(donor.key)
  const first = sources[0]
  if (first) {
    const zone = first.zones[0] ?? 'zone unstated'
    return { text: `${first.mob} — ${zone}`, more: sources.length > 1 ? `+${String(sources.length - 1)} more` : '' }
  }
  if (donor.quest) return { text: 'quest reward', more: '' }
  if (donor.playerCrafted) return { text: 'player crafted', more: '' }
  return { text: 'no known source', more: '' }
}

// ---- one donor row -------------------------------------------------------------------

function ClassChips({ donor, planClasses }: { donor: DonorRow; planClasses: readonly ClassAbbr[] }): JSX.Element {
  const fit = classFit(donor, planClasses)
  if (fit === 'unknown') {
    return <Chip size="small" variant="outlined" label="class unknown" sx={{ height: 18, fontSize: 10 }} />
  }
  const lit = donor.classes.filter((c) => planClasses.includes(c))
  const rest = donor.classes.filter((c) => !planClasses.includes(c))
  const shown = [...lit, ...rest].slice(0, CLASS_CHIP_CAP)
  return (
    <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
      {shown.map((c) => (
        <Chip
          key={c}
          size="small"
          label={c}
          color={lit.includes(c) ? 'primary' : 'default'}
          variant={lit.includes(c) ? 'filled' : 'outlined'}
          sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
        />
      ))}
      {donor.classes.length > CLASS_CHIP_CAP && (
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          +{donor.classes.length - CLASS_CHIP_CAP}
        </Typography>
      )}
    </Stack>
  )
}

interface DonorLineProps {
  donor: DonorRow
  planClasses: readonly ClassAbbr[]
  planned: boolean
  /** V5 — this row holds the top tier of its focus family among the rows that survived the filters */
  best: boolean
  /** the header above does not name this row's effect (any axis but `effect`), so the row does */
  namesEffect: boolean
  onAdd: (donor: DonorRow, anchor: HTMLElement) => void
  /** deep-link this donor into the Loot drill-down; absent when the app wired no router */
  onOpenLoot?: (item: string) => void
}

function DonorLine({ donor, planClasses, planned, best, namesEffect, onAdd, onOpenLoot }: DonorLineProps): JSX.Element {
  const src = sourceText(donor)
  // V6 — "Beneficial · Single Friendly · 27 minutes", or '' when the spell DB never named this
  // effect. Same 44px row (the windowing law): muted inline text, ellipsized, with the full line
  // in `title` for the ones that do not fit.
  const says = effectOneLiner(donor)
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="planner-donor-row"
      sx={{ height: ROW_HEIGHT, pl: 5, pr: 1, flexWrap: 'nowrap', borderBottom: 1, borderColor: 'divider' }}
    >
      {donor.iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(donor.iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: 22, height: 22, imageRendering: 'pixelated', flexShrink: 0 }}
        />
      )}
      <Typography variant="body2" component="div" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
        <DonorName name={donor.name} bold onOpen={onOpenLoot} />
      </Typography>
      {namesEffect && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
          {donor.effect}
        </Typography>
      )}
      {says !== '' && (
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          title={says}
          data-testid="planner-effect-says"
          sx={{ minWidth: 0, flexShrink: 1 }}
        >
          {says}
        </Typography>
      )}
      {best && <BestChip />}
      <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
        {donor.slots.map((s) => (
          <Chip key={s} size="small" variant="outlined" label={s} sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }} />
        ))}
      </Stack>
      {isNonEquippable(donor) && <NoSlotChip />}
      <ClassChips donor={donor} planClasses={planClasses} />
      <Tooltip title={`This effect only extracts once the donor is merged to +${String(donor.tierRequired)}.`}>
        <Chip size="small" color="secondary" variant="outlined" label={`+${String(donor.tierRequired)} to extract`} sx={{ height: 18, fontSize: 10 }} />
      </Tooltip>
      {donor.hasteLocked && <Chip size="small" color="warning" label="haste — can't move" sx={{ height: 18, fontSize: 10 }} />}
      <EraChip subject={donor} />
      <Box sx={{ flexGrow: 1, minWidth: 8 }} />
      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1, maxWidth: 320 }}>
        {src.text}
      </Typography>
      {src.more !== '' && (
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
          {src.more}
        </Typography>
      )}
      {planned && <Chip size="small" color="success" variant="outlined" label="in set" sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />}
      <Button
        size="small"
        data-testid="planner-add"
        disabled={donor.slots.length === 0}
        onClick={(e) => onAdd(donor, e.currentTarget)}
        sx={{ flexShrink: 0, minWidth: 88 }}
      >
        Add to set
      </Button>
    </Stack>
  )
}

// ---- one group header row --------------------------------------------------------------

function GroupLine({
  group,
  expanded,
  onToggle
}: {
  group: DonorGroup
  expanded: boolean
  onToggle: (id: string) => void
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="planner-effect-row"
      data-axis={group.axis}
      onClick={() => onToggle(group.id)}
      sx={{
        height: ROW_HEIGHT,
        px: 1,
        flexWrap: 'nowrap',
        cursor: 'pointer',
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover'
      }}
    >
      <IconButton size="small" sx={{ flexShrink: 0 }}>
        {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      <Typography variant="body2" noWrap sx={{ minWidth: 0, flexShrink: 1, fontWeight: 600 }}>
        {group.label}
      </Typography>
      {group.note !== '' && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
          best: {group.note}
        </Typography>
      )}
      <Chip size="small" variant="outlined" label={SOCKET_LABEL[group.socket]} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />
      <Chip
        size="small"
        color="secondary"
        variant="outlined"
        label={`+${String(extractionTier(group.socket))} to extract`}
        sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
      />
      {group.hasteLocked && <Chip size="small" color="warning" label="haste — can't move" sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />}
      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {group.donors.length} {group.donors.length === 1 ? 'donor' : 'donors'}
      </Typography>
    </Stack>
  )
}

/** Which (donor, effect) pairs the selected set already plans — the "in set" chip. */
function plannedPairs(plan: ExaltPlan | null): ReadonlySet<string> {
  const out = new Set<string>()
  for (const planSlot of Object.values(plan?.slots ?? {})) {
    for (const socket of Object.values(planSlot?.sockets ?? {})) {
      if (socket) out.add(`${socket.donorKey}::${socket.effect}`)
    }
  }
  return out
}

// ---- the browser ---------------------------------------------------------------------

interface PendingAdd {
  donor: DonorRow
  anchor: HTMLElement
}

export interface EffectBrowserProps {
  plan: ExaltPlan
  /** write one socket of the selected set (usePlans' `setSocket`) */
  onSocket: (slot: EquipSlot, socket: SocketType, planned: { effect: string; donorKey: string }) => void
  /** deep-link a donor into the Loot tab's item drill-down (App's `openLoot`) */
  onOpenLoot?: (item: string) => void
}

export default function EffectBrowser({ plan, onSocket, onOpenLoot }: EffectBrowserProps): JSX.Element {
  const { donors, ready } = useDonors()
  const era = useEraOnly()
  const nonEquip = useNonEquip()
  const [filters, setFilters] = useState<DonorFilters>(DEFAULT_FILTERS)
  const groupBy = useGroupBy(filters.socket)
  const [text, setText] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Warm the source index AFTER mount, not on the render path: the first donor row to ask for a
  // source would otherwise pay the whole ~33k-link build inside a paint (design §4.2, "off-path").
  useEffect(() => {
    sourceIndex()
  }, [])

  // The input echoes instantly; the FILTER runs on the deferred value (the standing search law).
  const deferredText = useDeferredValue(text)
  // Read out of the tuples so the memo's dependency list names the BOOLEANS: the setter half of
  // each tuple is a fresh identity nothing here depends on.
  const eraOnly = era[0]
  const showNonEquip = nonEquip[0]
  const axis = groupBy[0]
  // TWO MEMOS, NOT ONE: the FILTER is what a keystroke changes, and the GROUPING then keys off the
  // filtered array's identity — so switching the group-by axis never re-filters 1.6k rows, and a
  // keystroke never pays for a fold it is about to redo.
  const filtered = useMemo(
    () => filterDonors(donors, { ...filters, text: deferredText }, plan.classes, { eraOnly, nonEquip: showNonEquip }),
    [donors, filters, deferredText, plan.classes, eraOnly, showNonEquip]
  )
  const groups = useMemo(() => groupDonors(filtered, axis, donorEraOf), [filtered, axis])
  const rows = useMemo(() => browserRows(groups, open), [groups, open])
  const planned = useMemo(() => plannedPairs(plan), [plan])
  const win = useWindowedRows({ count: rows.length, rowHeight: ROW_HEIGHT, scrollRef })

  const toggle = (id: string): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // One slot ⇒ one click. Several ⇒ a menu of the donor's own slots, because the planner must not
  // pick which of PRIMARY/SECONDARY a sword is going into on the user's behalf.
  const add = (donor: DonorRow, anchor: HTMLElement): void => {
    if (donor.slots.length === 1) onSocket(donor.slots[0], donor.socket, { effect: donor.effect, donorKey: donor.key })
    else if (donor.slots.length > 1) setPending({ donor, anchor })
  }

  const chooseSlot = (slot: EquipSlot): void => {
    if (pending) onSocket(slot, pending.donor.socket, { effect: pending.donor.effect, donorKey: pending.donor.key })
    setPending(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <EffectFilterBar
        filters={filters}
        setFilters={setFilters}
        text={text}
        setText={setText}
        era={era}
        nonEquip={nonEquip}
        groupBy={groupBy}
      />

      <Box
        ref={scrollRef}
        data-testid="planner-effect-list"
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        <Box sx={{ height: win.topPad }} />
        {rows.slice(win.start, win.end).map((row: BrowserRow) =>
          row.kind === 'header' ? (
            <GroupLine key={row.group.id} group={row.group} expanded={row.expanded} onToggle={toggle} />
          ) : (
            <DonorLine
              key={`${row.groupId}:${row.donor.key}:${row.donor.effect}`}
              donor={row.donor}
              planClasses={plan.classes}
              planned={planned.has(`${row.donor.key}::${row.donor.effect}`)}
              best={row.best}
              namesEffect={row.namesEffect}
              onAdd={add}
              onOpenLoot={onOpenLoot}
            />
          )
        )}
        <Box sx={{ height: win.bottomPad }} />
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {ready ? 'No effects match these filters.' : 'Reading the item database…'}
          </Typography>
        )}
      </Box>

      <Menu anchorEl={pending?.anchor ?? null} open={pending !== null} onClose={() => setPending(null)}>
        {(pending?.donor.slots ?? []).map((slot) => (
          <MenuItem key={slot} onClick={() => chooseSlot(slot)}>
            {slot}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
