// planner/PlannerView.tsx — the Planner shell: which set you are editing, for which classes,
// in which mode (design §5.1).
//
// A SET IS A LOADOUT'S SHOPPING LIST. You keep several — the trio you run now, the trio you are
// building toward — so the toolbar leads with the set switcher, and each set carries its OWN
// target classes (D5). A brand-new set defaults to the combo the app has INFERRED for this
// character, because that is what you are almost certainly planning for; when nothing is inferred
// yet it starts EMPTY rather than guessing a trio (law 1), and an empty trio simply means "no
// class filter" everywhere downstream.
//
// ONE NOWRAP TOOLBAR ROW (the flexWrap law): controls never shrink, and the one thing carrying
// world-supplied text — the set names — is the group allowed to scroll.
//
// THREE MODES, ONE SET: Effects picks what you want, Board shows where it all goes, Farm turns
// what is missing into a route. All three read the SAME selected plan, and the progress join is
// mounted ONCE here and handed to Board and Farm — two mounts would subscribe to the inventory,
// the loot module and the observed tiers twice over to compute the identical answer.

import { type JSX, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { CLASS_ABBRS, MAX_COMBO_SLOTS, resolvedClasses, type ClassAbbr } from '@shared/classCombo'
import type { ExaltPlan } from '@shared/planner/types'
import { useComboSnap } from '../profiles/ClassComboData'
import { Tooltip } from '../../lib/Tooltip'
import EffectBrowser from './EffectBrowser'
import FarmList from './FarmList'
import PlanBoard from './PlanBoard'
import { usePlannerProgress, type PlannerProgressApi } from './plannerProgress'
import { usePlans, type PlannerMode, type PlansApi } from './usePlans'

const MODES: { value: PlannerMode; label: string }[] = [
  { value: 'effects', label: 'Effects' },
  { value: 'board', label: 'Board' },
  { value: 'farm', label: 'Farm' }
]

// ---- the class trio editor -----------------------------------------------------------

/**
 * The 16 codes as toggles, capped at three — the same picker shape the class-combo correction
 * dialog uses (features/profiles/ClassComboEditor). It is local rather than imported because that
 * one is a private component of a dialog that WRITES A CORRECTION; this one edits a plan.
 */
function ClassPickerDialog({
  plan,
  onClose,
  onSave
}: {
  plan: ExaltPlan | null
  onClose: () => void
  onSave: (classes: ClassAbbr[]) => void
}): JSX.Element {
  const [picked, setPicked] = useState<ClassAbbr[]>(plan?.classes ?? [])
  const full = picked.length >= MAX_COMBO_SLOTS
  const toggle = (c: ClassAbbr): void => {
    setPicked((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : prev.length < MAX_COMBO_SLOTS ? [...prev, c] : prev
    )
  }
  return (
    <Dialog open={plan !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Which classes is this set for?</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ pt: 0.5 }}>
          {CLASS_ABBRS.map((abbr) => {
            const on = picked.includes(abbr)
            return (
              <Chip
                key={abbr}
                size="small"
                label={abbr}
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                onClick={() => toggle(abbr)}
                disabled={!on && full}
                sx={{ height: 24, fontWeight: on ? 700 : 400 }}
              />
            )
          })}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {picked.length === 0
            ? `No classes picked — nothing is filtered out.`
            : `${picked.join(' / ')} — ${String(picked.length)} of ${String(MAX_COMBO_SLOTS)} slots.`}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" data-testid="planner-classes-save" onClick={() => onSave(picked)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RenameDialog({
  plan,
  onClose,
  onSave
}: {
  plan: ExaltPlan | null
  onClose: () => void
  onSave: (name: string) => void
}): JSX.Element {
  const [name, setName] = useState(plan?.name ?? '')
  return (
    <Dialog open={plan !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Rename set</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={name.trim() === ''} onClick={() => onSave(name.trim())}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---- the toolbar ---------------------------------------------------------------------

/** The set switcher + its overflow menu. The chip strip is the one group allowed to scroll. */
function SetSwitcher({
  plans,
  onNew,
  onMenu
}: {
  plans: PlansApi
  onNew: () => void
  onMenu: (anchor: HTMLElement) => void
}): JSX.Element {
  return (
    <>
      <Stack direction="row" spacing={0.5} sx={{ minWidth: 0, flexShrink: 1, overflowX: 'auto', py: 0.25 }}>
        {plans.plans.map((p) => (
          <Chip
            key={p.id}
            size="small"
            label={p.name}
            data-testid="planner-set-chip"
            color={plans.selected?.id === p.id ? 'primary' : 'default'}
            variant={plans.selected?.id === p.id ? 'filled' : 'outlined'}
            onClick={() => plans.select(p.id)}
            sx={{ flexShrink: 0 }}
          />
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} data-testid="planner-new-set" onClick={onNew} sx={{ flexShrink: 0 }}>
        New set
      </Button>
      <IconButton
        size="small"
        disabled={plans.selected === null}
        onClick={(e) => onMenu(e.currentTarget)}
        sx={{ flexShrink: 0 }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </>
  )
}

/** The set's target classes, as chips that open the picker. Empty = "any class". */
function TrioChips({ plan, onEdit }: { plan: ExaltPlan; onEdit: () => void }): JSX.Element {
  return (
    <Tooltip title="The classes this set is planned for. A donor must share one of them to be socketable (and socketing narrows the host to the overlap).">
      <Stack direction="row" spacing={0.5} onClick={onEdit} sx={{ cursor: 'pointer', flexShrink: 0 }}>
        {plan.classes.length === 0 ? (
          <Chip size="small" variant="outlined" label="any class" data-testid="planner-trio" />
        ) : (
          plan.classes.map((c) => (
            <Chip key={c} size="small" color="primary" variant="filled" label={c} data-testid="planner-trio" />
          ))
        )}
      </Stack>
    </Tooltip>
  )
}

// ---- empty + not-yet states ----------------------------------------------------------

function NoSets({ onNew }: { onNew: () => void }): JSX.Element {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ height: '100%', color: 'text.secondary' }}>
      <AutoAwesomeIcon sx={{ fontSize: 44, opacity: 0.6 }} />
      <Typography variant="body2">Create a set to start planning.</Typography>
      <Button variant="contained" size="small" startIcon={<AddIcon />} data-testid="planner-new-set-empty" onClick={onNew}>
        New set
      </Button>
    </Stack>
  )
}

/** The three modes over ONE selected set. Split out so the view itself stays a shell. */
function ModePane({
  plan,
  plans,
  progress,
  onOpenLoot
}: {
  plan: ExaltPlan
  plans: PlansApi
  progress: PlannerProgressApi
  onOpenLoot?: (item: string) => void
}): JSX.Element {
  if (plans.mode === 'board') {
    return (
      <PlanBoard
        plan={plan}
        progress={progress}
        onSocket={plans.setSocket}
        onHost={plans.setHost}
        onOpenLoot={onOpenLoot}
      />
    )
  }
  if (plans.mode === 'farm') return <FarmList plan={plan} progress={progress} onOpenLoot={onOpenLoot} />
  return <EffectBrowser plan={plan} onSocket={plans.setSocket} onOpenLoot={onOpenLoot} />
}

// ---- the view ------------------------------------------------------------------------

interface Editing {
  rename: ExaltPlan | null
  classes: ExaltPlan | null
  menu: HTMLElement | null
}

const NO_EDIT: Editing = { rename: null, classes: null, menu: null }

export interface PlannerViewProps {
  /**
   * Deep-link an item name into the Loot tab's drill-down (App's `openLoot`). Optional so the
   * pane still renders standalone; every donor name in all three modes becomes a link when it
   * is supplied, and stays a pure hover surface when it is not.
   */
  onOpenLoot?: (item: string) => void
}

export default function PlannerView({ onOpenLoot }: PlannerViewProps = {}): JSX.Element {
  const plans = usePlans()
  const combo = useComboSnap()
  const progress = usePlannerProgress()
  const [editing, setEditing] = useState<Editing>(NO_EDIT)
  const selected = plans.selected

  // A new set defaults to the CURRENTLY INFERRED combo (D5). An unresolved slot contributes
  // nothing, so a half-known combo seeds the classes it does know and nothing it doesn't.
  const newSet = (): void => {
    plans.create(combo.current === null ? [] : resolvedClasses(combo.current))
  }

  if (!plans.ready) return <Box />
  if (plans.plans.length === 0 || selected === null) return <NoSets onNew={newSet} />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-testid="planner-view">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1.5 }}>
        <SetSwitcher plans={plans} onNew={newSet} onMenu={(menu) => setEditing({ ...NO_EDIT, menu })} />
        <Box sx={{ flexGrow: 1, minWidth: 8 }} />
        <TrioChips plan={selected} onEdit={() => setEditing({ ...NO_EDIT, classes: selected })} />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={plans.mode}
          onChange={(_e, v: PlannerMode | null) => {
            if (v !== null) plans.setMode(v)
          }}
          sx={{ flexShrink: 0 }}
        >
          {MODES.map((m) => (
            <ToggleButton key={m.value} value={m.value} data-testid={`planner-mode-${m.value}`} sx={{ px: 1.5 }}>
              {m.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <ModePane plan={selected} plans={plans} progress={progress} onOpenLoot={onOpenLoot} />

      <Menu anchorEl={editing.menu} open={editing.menu !== null} onClose={() => setEditing(NO_EDIT)}>
        <MenuItem onClick={() => setEditing({ ...NO_EDIT, rename: selected })}>Rename</MenuItem>
        <MenuItem
          onClick={() => {
            plans.duplicate(selected.id)
            setEditing(NO_EDIT)
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          onClick={() => {
            plans.remove(selected.id)
            setEditing(NO_EDIT)
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      {/* Keyed on the set id so each open starts from THAT set's current values. */}
      <RenameDialog
        key={`rename:${editing.rename?.id ?? 'none'}`}
        plan={editing.rename}
        onClose={() => setEditing(NO_EDIT)}
        onSave={(name) => {
          if (editing.rename) plans.rename(editing.rename.id, name)
          setEditing(NO_EDIT)
        }}
      />
      <ClassPickerDialog
        key={`classes:${editing.classes?.id ?? 'none'}:${editing.classes?.classes.join('') ?? ''}`}
        plan={editing.classes}
        onClose={() => setEditing(NO_EDIT)}
        onSave={(classes) => {
          if (editing.classes) plans.setClasses(editing.classes.id, classes)
          setEditing(NO_EDIT)
        }}
      />
    </Box>
  )
}
