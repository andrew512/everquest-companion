// planner/EffectBrowser.tsx — Effects mode: "which effect do I want, and who drops it?" (§5.2).
//
// THE LIST IS FLAT AND UNIFORM, and that is what lets it be windowed. Effect groups expand into
// their donors, so the natural shape is a tree — but `useWindowedRows` is a FIXED-row-height
// hook, and a growing list must live in a fixed-height scroll box (AGENTS.md UI conventions).
// So the tree is flattened into one row array of one height: an effect row, followed by its donor
// rows while it is open. Expanding is then just a longer array, and the DOM node count stays
// bounded whether the filter matches 3 effects or 300.
//
// EVERY DONOR ROW STATES ITS SOURCE, or says it has none. `sourceIndex` answers from the
// committed mob catalog; `quest` / `playerCrafted` ride on the donor row itself; an item with
// neither renders "no known source" rather than an empty space that reads like a loading state
// (law 1). Class chips are lit for the classes the SET can actually use — the wide-class donors
// light up most, which is precisely the R2 signal that makes them valuable.
//
// NO ITEM POPUP YET, deliberately. The obvious candidate (`loot/ItemDetailDialog`) is the LOOT
// drill-down: it renders "Times looted 0 · Distinct mobs 0 · No source recorded" for an item you
// have never looted, which would contradict the source line two pixels above it. Wave 3 wires a
// planner-appropriate popup; a donor name is plain text until then, so there is no affordance
// promising something that isn't there.

import { type JSX, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import type { ClassAbbr } from '@shared/classCombo'
import { EQUIP_SLOTS, type EquipSlot, type ExaltPlan, type SocketType } from '@shared/planner/types'
import { extractionTier } from '@shared/planner/rules'
import { useWindowedRows } from '../../lib/useWindowedRows'
import { itemIconUrl } from '../../lib/ItemWindow'
import { Tooltip } from '../../lib/Tooltip'
import {
  DEFAULT_FILTERS,
  classFit,
  filterDonors,
  groupByEffect,
  useDonors,
  type DonorFilters,
  type DonorRow,
  type EffectGroup
} from './plannerData'
import { sourceIndex, sourcesFor } from './sourceIndex'

const ROW_HEIGHT = 44
const SOCKETS: SocketType[] = ['proc', 'worn', 'focus', 'click']
const SOCKET_LABEL: Record<SocketType, string> = {
  proc: 'Proc',
  worn: 'Worn',
  focus: 'Focus',
  click: 'Click'
}
/** How many class chips fit on a dense row before the rest collapse into "+N". */
const CLASS_CHIP_CAP = 6

// ---- the filter bar ------------------------------------------------------------------

/** ONE nowrap row (the flexWrap law): controls never shrink, the search box is the one that does. */
function FilterBar({
  filters,
  setFilters,
  text,
  setText
}: {
  filters: DonorFilters
  setFilters: (f: DonorFilters) => void
  text: string
  setText: (v: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filters.socket}
        onChange={(_e, v: SocketType | null) => {
          if (v !== null) setFilters({ ...filters, socket: v })
        }}
        sx={{ flexShrink: 0 }}
      >
        {SOCKETS.map((s) => (
          <ToggleButton key={s} value={s} data-testid={`planner-socket-${s}`} sx={{ px: 1.5 }}>
            {SOCKET_LABEL[s]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        size="small"
        label="Search effect or item"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ minWidth: 140, flexShrink: 1 }}
      />

      <TextField
        select
        size="small"
        label="Slot"
        value={filters.slot ?? 'ALL'}
        onChange={(e) => setFilters({ ...filters, slot: e.target.value === 'ALL' ? null : (e.target.value as EquipSlot) })}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        <MenuItem value="ALL">Any slot</MenuItem>
        {EQUIP_SLOTS.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>

      <Tooltip title="Hide donors no class in this set can use. Donors whose page states no class list are kept and chipped 'class unknown'.">
        <Chip
          size="small"
          label="Usable by this set"
          color={filters.trioOnly ? 'primary' : 'default'}
          variant={filters.trioOnly ? 'filled' : 'outlined'}
          onClick={() => setFilters({ ...filters, trioOnly: !filters.trioOnly })}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>
    </Stack>
  )
}

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
  onAdd: (donor: DonorRow, anchor: HTMLElement) => void
}

function DonorLine({ donor, planClasses, planned, onAdd }: DonorLineProps): JSX.Element {
  const src = sourceText(donor)
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
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
      <Typography variant="body2" noWrap sx={{ minWidth: 0, flexShrink: 1, fontWeight: 500 }}>
        {donor.name}
      </Typography>
      <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
        {donor.slots.map((s) => (
          <Chip key={s} size="small" variant="outlined" label={s} sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }} />
        ))}
      </Stack>
      <ClassChips donor={donor} planClasses={planClasses} />
      <Tooltip title={`This effect only extracts once the donor is merged to +${String(donor.tierRequired)}.`}>
        <Chip size="small" color="secondary" variant="outlined" label={`+${String(donor.tierRequired)} to extract`} sx={{ height: 18, fontSize: 10 }} />
      </Tooltip>
      {donor.hasteLocked && <Chip size="small" color="warning" label="haste — can't move" sx={{ height: 18, fontSize: 10 }} />}
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
        disabled={donor.slots.length === 0}
        onClick={(e) => onAdd(donor, e.currentTarget)}
        sx={{ flexShrink: 0, minWidth: 88 }}
      >
        Add to set
      </Button>
    </Stack>
  )
}

// ---- one effect row ------------------------------------------------------------------

function EffectLine({
  group,
  expanded,
  onToggle
}: {
  group: EffectGroup
  expanded: boolean
  onToggle: (effect: string) => void
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      onClick={() => onToggle(group.effect)}
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
        {group.effect}
      </Typography>
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

// ---- the flat row model --------------------------------------------------------------

type BrowserRow =
  | { kind: 'effect'; group: EffectGroup; expanded: boolean }
  | { kind: 'donor'; donor: DonorRow }

function flatten(groups: readonly EffectGroup[], open: ReadonlySet<string>): BrowserRow[] {
  const rows: BrowserRow[] = []
  for (const group of groups) {
    const expanded = open.has(group.effect)
    rows.push({ kind: 'effect', group, expanded })
    if (expanded) for (const donor of group.donors) rows.push({ kind: 'donor', donor })
  }
  return rows
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
}

export default function EffectBrowser({ plan, onSocket }: EffectBrowserProps): JSX.Element {
  const { donors, ready, unavailable } = useDonors()
  const [filters, setFilters] = useState<DonorFilters>(DEFAULT_FILTERS)
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
  const groups = useMemo(
    () => groupByEffect(filterDonors(donors, { ...filters, text: deferredText }, plan.classes)),
    [donors, filters, deferredText, plan.classes]
  )
  const rows = useMemo(() => flatten(groups, open), [groups, open])
  const planned = useMemo(() => plannedPairs(plan), [plan])
  const win = useWindowedRows({ count: rows.length, rowHeight: ROW_HEIGHT, scrollRef })

  const toggle = (effect: string): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(effect)) next.add(effect)
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
      <FilterBar filters={filters} setFilters={setFilters} text={text} setText={setText} />

      <Box
        ref={scrollRef}
        data-testid="planner-effect-list"
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        <Box sx={{ height: win.topPad }} />
        {rows.slice(win.start, win.end).map((row) =>
          row.kind === 'effect' ? (
            <EffectLine key={`e:${row.group.effect}`} group={row.group} expanded={row.expanded} onToggle={toggle} />
          ) : (
            <DonorLine
              key={`d:${row.donor.key}:${row.donor.effect}`}
              donor={row.donor}
              planClasses={plan.classes}
              planned={planned.has(`${row.donor.key}::${row.donor.effect}`)}
              onAdd={add}
            />
          )
        )}
        <Box sx={{ height: win.bottomPad }} />
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {unavailable
              ? 'The effect index is not available in this build yet.'
              : ready
                ? 'No effects match these filters.'
                : 'Reading the item database…'}
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
