// AlertDialog — the add/EDIT dialog for one alert. Extracted from AlertsView.tsx
// (Wave D factoring); the form's behavior, validation and saved shape are unchanged.
//
// `initial` is null for "add", or an existing def for "edit" (including a seeded
// built-in — no special casing beyond keeping its id stable).
//
// THE ORDER OF THE SECTIONS IS THE ORDER OF THE DECISIONS: name → when it fires → what it does
// when it fires → the settings of whichever channel that turned out to be. The channel selector
// used to sit BELOW the sound picker, inside the Voice block, which meant a user choosing "Speak
// it" had already been asked to pick a sound that would never play. Sound and Voice are now
// shown only when the channel uses them (`playsSound`/`speaks`), so every control on screen is
// one that does something — and `formCanSave` stops requiring a sound the dialog is not asking
// for, because a hidden field must never be the reason a save is refused.

import {
  type Dispatch,
  type JSX,
  type SetStateAction,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import type { AlertDef, AlertTrigger, SoundPack } from '@shared/types'
import {
  blankCondition,
  type CombineMode,
  type ConditionDraft,
  conditionFieldValErr,
  conditionRawErr,
  draftFromPrimitive,
  primitiveFromDraft
} from './conditionDraft'
import TriggerSection from './TriggerSection'
import SoundPicker, { fallbackPack, firstSoundId } from './SoundPicker'
import SpeechBlock, {
  AudioActionSection,
  type CaptureHints,
  type SpeechForm,
  playsSound,
  speaks,
  speechFieldsFor,
  useSpeechForm
} from './SpeechBlock'
import { captureNamesFor, hasRawCondition } from '@shared/captureNames'
import type { VoiceSetupNotice } from './VoiceSetupLink'
import { DEFAULT_PACK_ID } from './suggestions'

const DEFAULT_COOLDOWN_MS = 2000

function newId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'alert'
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}

/** Everything the dialog's form owns; `useAlertForm` hydrates it from `initial`. */
interface AlertForm {
  name: string
  setName: (v: string) => void
  mode: CombineMode
  changeMode: (next: CombineMode) => void
  conditions: ConditionDraft[]
  setConditions: Dispatch<SetStateAction<ConditionDraft[]>>
  packId: string
  soundId: string
  setSound: (packId: string, soundId: string) => void
  volume: number
  setVolume: (v: number) => void
  cooldownMs: number
  setCooldownMs: (v: number) => void
  /** What the cooldown is measured per — one clock for the alert, or one per mob. */
  cooldownScope: CooldownScope
  setCooldownScope: (v: CooldownScope) => void
  /** The Speech block's own sub-form (voice-alerts §4) — see SpeechBlock.tsx. */
  speech: SpeechForm
}

/** Local alias for the def field, so the form and the def can never drift apart. */
type CooldownScope = NonNullable<AlertDef['cooldownScope']>

function useAlertForm(open: boolean, initial: AlertDef | null, packs: SoundPack[]): AlertForm {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<CombineMode>('single')
  const [conditions, setConditions] = useState<ConditionDraft[]>([blankCondition()])
  const [packId, setPackId] = useState(fallbackPack(packs)?.id ?? DEFAULT_PACK_ID)
  const [soundId, setSoundId] = useState(firstSoundId(fallbackPack(packs)))
  const [volume, setVolume] = useState(1)
  const [cooldownMs, setCooldownMs] = useState(DEFAULT_COOLDOWN_MS)
  const [cooldownScope, setCooldownScope] = useState<CooldownScope>('alert')
  // The Speech block hydrates itself from the same `open`/`initial` pair.
  const speech = useSpeechForm(open, initial)

  /**
   * WHAT HAS ALREADY BEEN HYDRATED — the guard that makes this form survive a window focus.
   *
   * The effect below hydrates from props, so anything that re-runs it OVERWRITES what the user
   * has typed. It used to re-run on `packs`, and `packs` changes identity on every store reload:
   * the always-mounted AlertPlayer refreshes the shared store on window FOCUS (player.tsx), the
   * view re-`reload()`s, and `listSoundPacks()` returns a fresh array over IPC even when the pack
   * set is identical. Alt-tab out and back with the dialog open and every field went blank —
   * except the Speech sub-form, which does not depend on `packs`, so the form was left in a
   * half-reset state that a Save would then persist.
   *
   * So hydration is keyed on the thing it actually means: ONE hydrate per opening. `undefined`
   * is "nothing hydrated yet" and is deliberately distinct from `null`, which is a live "add"
   * (re-opening Add after Cancel must blank the form again, and `null === null` would skip it).
   * The dep array can safely keep every value the effect reads — this guard, not the deps, is
   * what pins the behavior, so a future prop cannot quietly reintroduce the reset.
   */
  const hydratedFor = useRef<AlertDef | null | undefined>(undefined)

  // Hydrate the form from `initial` (edit) or blanks (add) once per opening — never again while
  // it stays open, however often the props are refreshed underneath it.
  useEffect(() => {
    if (!open) {
      hydratedFor.current = undefined
      return
    }
    if (hydratedFor.current === initial) return
    hydratedFor.current = initial
    if (initial) {
      setName(initial.name)
      const t = initial.trigger
      if ('conditions' in t) {
        setMode(t.type)
        setConditions(t.conditions.length ? t.conditions.map(draftFromPrimitive) : [blankCondition()])
      } else {
        setMode('single')
        setConditions([draftFromPrimitive(t)])
      }
      setPackId(initial.sound.packId)
      setSoundId(initial.sound.soundId)
      setVolume(initial.volume ?? 1)
      setCooldownMs(initial.cooldownMs ?? DEFAULT_COOLDOWN_MS)
      setCooldownScope(initial.cooldownScope ?? 'alert')
    } else {
      setName('')
      setMode('single')
      setConditions([blankCondition()])
      const preset = fallbackPack(packs)
      setPackId(preset?.id ?? DEFAULT_PACK_ID)
      setSoundId(firstSoundId(preset))
      setVolume(1)
      setCooldownMs(DEFAULT_COOLDOWN_MS)
      setCooldownScope('alert')
    }
  }, [open, initial, packs])

  // Switching INTO a composite from single keeps the existing condition and adds a second so
  // the OR/AND is meaningful; switching back to single collapses to the first condition.
  const changeMode = (next: CombineMode): void => {
    setMode(next)
    if (next === 'single') setConditions((prev) => prev.slice(0, 1))
    else setConditions((prev) => (prev.length >= 2 ? prev : [...prev, blankCondition()]))
  }

  const setSound = (p: string, s: string): void => {
    setPackId(p)
    setSoundId(s)
  }

  return {
    name,
    setName,
    mode,
    changeMode,
    conditions,
    setConditions,
    packId,
    soundId,
    setSound,
    volume,
    setVolume,
    cooldownMs,
    setCooldownMs,
    cooldownScope,
    setCooldownScope,
    speech
  }
}

function triggerFromForm(mode: CombineMode, conditions: ConditionDraft[]): AlertTrigger {
  if (mode === 'single') return primitiveFromDraft(conditions[0])
  return { type: mode, conditions: conditions.map(primitiveFromDraft) }
}

/**
 * The `$<name>` values the trigger BEING EDITED offers, recomputed on every keystroke from the
 * same drafts that will be saved — so the chips under the phrase field always describe the
 * trigger actually in the form, not the one the def was opened with.
 */
function captureHints(f: AlertForm): CaptureHints {
  const trigger = triggerFromForm(f.mode, f.conditions)
  return { names: captureNamesFor(trigger), partial: hasRawCondition(trigger) }
}

function formCanSave(f: AlertForm): boolean {
  const conditionsValid = f.conditions.every(
    (c) => conditionRawErr(c) == null && conditionFieldValErr(c) == null
  )
  // A HIDDEN FIELD MAY NEVER BE THE REASON A DIALOG WILL NOT SAVE. The sound is required only
  // when the alert actually plays one — otherwise a speech-only alert authored before the
  // default pack has self-provisioned (a first run, the e2e channel) would sit behind a disabled
  // Add button with nothing on screen saying why. The def still CARRIES whatever sound it had:
  // `defFromForm` always writes the pair, so switching back to "Play a sound" finds it intact.
  const soundReady = !playsSound(f.speech) || (f.packId.length > 0 && f.soundId.length > 0)
  return f.name.trim().length > 0 && f.conditions.length > 0 && conditionsValid && soundReady
}

function defFromForm(f: AlertForm, initial: AlertDef | null): AlertDef {
  return {
    // Preserve id + note on edit (stable ids for built-ins); mint on add.
    id: initial?.id ?? newId(f.name),
    name: f.name.trim(),
    enabled: initial?.enabled ?? true,
    trigger: triggerFromForm(f.mode, f.conditions),
    sound: { packId: f.packId, soundId: f.soundId },
    volume: f.volume,
    cooldownMs: f.cooldownMs,
    // Omitted at its default, like the speech fields below: a def that never asked for per-mob
    // scope saves byte-identically to how it always did, so import dedupe keeps matching it.
    ...(f.cooldownScope === 'target' ? { cooldownScope: 'target' as const } : {}),
    note: initial?.note,
    // audio / speech / alwaysPlay, each omitted at its default so a sound-only alert saves
    // byte-identically to how it always did (SpeechBlock.speechFieldsFor).
    ...speechFieldsFor(f.speech)
  }
}

/** The per-alert volume slider + cooldown field + what that cooldown is counted per. */
function VolumeCooldownSection({ f }: { f: AlertForm }): JSX.Element {
  return (
    <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
      <Stack sx={{ minWidth: 180 }}>
        <Typography variant="caption" color="text.secondary">
          Volume ({Math.round(f.volume * 100)}%)
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={f.volume}
          onChange={(_e, v) => f.setVolume(v as number)}
          sx={{ width: 160 }}
        />
      </Stack>
      <TextField
        size="small"
        type="number"
        label="Cooldown (ms)"
        data-testid="alert-cooldown"
        value={f.cooldownMs}
        onChange={(e) => f.setCooldownMs(Math.max(0, Number(e.target.value) || 0))}
        sx={{ width: 140 }}
      />
      {/* Sits against the cooldown field because it only qualifies THAT number. "Per mob" is
          a state ("this alert is quiet per mob"), not a description of how the engine keys a
          map — and the caption below says what changes, never how. */}
      <Stack sx={{ minWidth: 150 }}>
        <Typography variant="caption" color="text.secondary">
          Counted
        </Typography>
        <Select
          size="small"
          value={f.cooldownScope}
          onChange={(e) => f.setCooldownScope(e.target.value as CooldownScope)}
        >
          <MenuItem value="alert">per alert</MenuItem>
          <MenuItem value="target">per mob</MenuItem>
        </Select>
      </Stack>
      {f.cooldownScope === 'target' && (
        <Typography variant="caption" color="text.secondary" sx={{ flexBasis: '100%' }}>
          The first match on each mob always plays; only repeats on that same mob wait out the
          cooldown.
        </Typography>
      )}
    </Stack>
  )
}

export default function AlertDialog({
  open,
  initial,
  packs,
  voiceSetup,
  onClose,
  onSave
}: {
  open: boolean
  initial: AlertDef | null
  packs: SoundPack[]
  /** Whether there is a voice to speak with, and how to go set one up (VoiceSetupLink.tsx). */
  voiceSetup: VoiceSetupNotice
  onClose: () => void
  onSave: (def: AlertDef) => void
}): JSX.Element {
  const f = useAlertForm(open, initial, packs)
  const editing = initial != null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="alert-dialog">
      <DialogTitle>{editing ? `Edit alert — ${initial?.name}` : 'Add alert'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="Name"
            data-testid="alert-name"
            value={f.name}
            onChange={(e) => f.setName(e.target.value)}
            autoFocus
          />
          <TriggerSection
            mode={f.mode}
            onModeChange={f.changeMode}
            conditions={f.conditions}
            setConditions={f.setConditions}
          />

          <Divider />

          {/* THE CHANNEL FIRST, then only the sections it actually governs. Sound used to sit
              above this choice, so a speech-only alert made you scroll past a picker it would
              never use to reach the one it would. */}
          <AudioActionSection form={f.speech} />

          {playsSound(f.speech) && (
            <Box data-testid="alert-sound-section">
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Sound
              </Typography>
              <SoundPicker
                packs={packs}
                packId={f.packId}
                soundId={f.soundId}
                onChange={f.setSound}
              />
            </Box>
          )}

          {/* NOT conditional, and not an oversight: the per-alert volume scales the utterance as
              well as the sound (player.tsx hands `effectiveVolume` to `speak` as its gain), and
              the cooldown governs the firing rather than either channel. */}
          <VolumeCooldownSection f={f} />

          {speaks(f.speech) && (
            <>
              <Divider />
              <SpeechBlock
                name={f.name}
                form={f.speech}
                voiceSetup={voiceSetup}
                hints={captureHints(f)}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          data-testid="alert-save"
          disabled={!formCanSave(f)}
          onClick={() => onSave(defFromForm(f, initial))}
        >
          {editing ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
