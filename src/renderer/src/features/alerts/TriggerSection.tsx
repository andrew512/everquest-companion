// TriggerSection — the alert editor's TRIGGER half: "Fire when…" (single / any / all) plus the
// condition list that combine mode governs.
//
// Lifted out of AlertDialog.tsx verbatim when that file crossed the 400-code-line factoring
// ceiling — the same cut, for the same reason, that put the speech sub-form in SpeechBlock.tsx.
// Behavior, markup and props are unchanged; this is a move, not a rewrite.
//
// It lands HERE rather than in ConditionEditor.tsx because the two answer different questions:
// ConditionEditor edits ONE primitive condition (and is reused for the single-condition case and
// for each row of a composite), while this file owns how many conditions there are and how they
// combine. One is a field, the other is the list.

import { type Dispatch, type JSX, type SetStateAction } from 'react'
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ConditionEditor from './ConditionEditor'
import { blankCondition, type CombineMode, type ConditionDraft } from './conditionDraft'
import { Tooltip } from '../../lib/Tooltip'

/** "Fire when…" — the single/any/all combine-mode picker plus the same-event caveat. */
function CombineModeSection({
  mode,
  onChange
}: {
  mode: CombineMode
  onChange: (next: CombineMode) => void
}): JSX.Element {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Fire when…
      </Typography>
      <Select
        size="small"
        fullWidth
        data-testid="alert-combine-mode"
        value={mode}
        onChange={(e) => onChange(e.target.value as CombineMode)}
      >
        <MenuItem value="single">a single condition matches</MenuItem>
        <MenuItem value="any">ANY of these conditions matches (or)</MenuItem>
        <MenuItem value="all">ALL of these match the same event (and)</MenuItem>
      </Select>
      {mode === 'all' && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          “All” requires every condition to match the SAME incoming log event (same-event,
          not a correlation window).
        </Typography>
      )}
    </Box>
  )
}

/** One numbered condition card inside a composite trigger. */
function ConditionRow({
  index,
  draft,
  canRemove,
  onChange,
  onRemove
}: {
  index: number
  draft: ConditionDraft
  canRemove: boolean
  onChange: (next: ConditionDraft) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, position: 'relative' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Condition {index + 1}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Remove condition">
          <span>
            <IconButton size="small" color="error" disabled={!canRemove} onClick={onRemove}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <ConditionEditor draft={draft} onChange={onChange} />
    </Paper>
  )
}

/** Single mode renders one bare editor; composite modes render the add/remove list. */
function ConditionsSection({
  mode,
  conditions,
  setConditions
}: {
  mode: CombineMode
  conditions: ConditionDraft[]
  setConditions: Dispatch<SetStateAction<ConditionDraft[]>>
}): JSX.Element {
  const setCondition = (i: number, next: ConditionDraft): void =>
    setConditions((prev) => prev.map((c, j) => (j === i ? next : c)))
  const addCondition = (): void => setConditions((prev) => [...prev, blankCondition()])
  const removeCondition = (i: number): void =>
    setConditions((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))

  if (mode === 'single') {
    return <ConditionEditor draft={conditions[0]} onChange={(next) => setCondition(0, next)} />
  }
  return (
    <Stack spacing={1.5}>
      {conditions.map((c, i) => (
        <ConditionRow
          key={i}
          index={i}
          draft={c}
          canRemove={conditions.length > 1}
          onChange={(next) => setCondition(i, next)}
          onRemove={() => removeCondition(i)}
        />
      ))}
      <Button startIcon={<AddIcon />} size="small" onClick={addCondition} sx={{ alignSelf: 'flex-start' }}>
        Add condition
      </Button>
    </Stack>
  )
}

/**
 * The trigger half, whole. `spacing={2}` reproduces the gap the two pieces had as siblings of the
 * dialog's own Stack, so the move is invisible on screen.
 */
export default function TriggerSection({
  mode,
  onModeChange,
  conditions,
  setConditions
}: {
  mode: CombineMode
  onModeChange: (next: CombineMode) => void
  conditions: ConditionDraft[]
  setConditions: Dispatch<SetStateAction<ConditionDraft[]>>
}): JSX.Element {
  return (
    <Stack spacing={2}>
      <CombineModeSection mode={mode} onChange={onModeChange} />
      <ConditionsSection mode={mode} conditions={conditions} setConditions={setConditions} />
    </Stack>
  )
}
