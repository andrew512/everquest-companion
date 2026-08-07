// SpeechBlock — the alert editor's SPEECH half (docs/plans/voice-alerts.md §4): what a speaking
// alert says and in whose voice, plus the CHANNEL CHOICE that decides whether it speaks at all.
//
// Its own file because AlertDialog.tsx is already at the factoring ceiling, and because this
// block is a self-contained sub-form: `useSpeechForm` owns its four fields, `speechFieldsFor`
// turns them back into the def's optional keys, and the component is the rendering. AlertDialog
// composes the three.
//
// TWO EXPORTED PIECES, DELIBERATELY SPLIT, because the dialog interleaves them with a section
// this file knows nothing about:
//   `AudioActionSection` — the channel (sound | speech | both) + the throttle opt-out. The dialog
//     renders it ABOVE both the Sound picker and this block, because it is the question that
//     decides which of the two is relevant.
//   `SpeechBlock` (default) — the Voice section proper, rendered only when the channel speaks.
// `playsSound`/`speaks` are the mapping between them, so the dialog's show/hide and the firing
// path's own reading of `audio` can never drift apart.
//
// THE PREVIEW IS LIVE AND NEEDS NO FIRING. `speechTextFor(def, firing?)` is pure and takes an
// OPTIONAL firing precisely so this line can be resolved while the user types (W1's contract) —
// so the user reads the actual sentence, resolved by the same function the player will run,
// before ever pressing ▶. On a spell mode there is no spell yet, so the preview shows the
// alertName FALLBACK — which is the honest answer: it is exactly what they will hear whenever
// the trigger turns out to name no spell.
//
// WHAT IS DELIBERATELY NOT HERE: rate, volume and the DEFAULT voice. Those are global (the
// Preferences → Voice section); this block only overrides. A per-alert rate would be four
// places to look when one alert sounds wrong.

import { type JSX, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { AlertAudio, AlertDef, AlertSpeech, SpeechMode } from '@shared/types'
import {
  ALERT_AUDIO_ACTIONS,
  MAX_SPEECH_CHARS,
  SPEECH_MODES,
  placeholdersIn,
  speechTextFor
} from '@shared/speechText'
import { currentVoicePrefs, speak } from '../../lib/speech'
import { useVoiceOptions } from '../../lib/useVoices'
import VoiceSetupLink, { type VoiceSetupNotice } from './VoiceSetupLink'

/** Human labels for the audio-action selector. Keyed off the closed union, never free text. */
const AUDIO_LABELS: Record<AlertAudio, string> = {
  sound: 'Play a sound',
  speech: 'Speak it',
  both: 'Sound, then speak'
}

/** Human labels for the mode picker, in the order SPEECH_MODES declares. */
const MODE_LABELS: Record<SpeechMode, string> = {
  alertName: 'the alert’s name',
  spellName: 'the spell’s name',
  spellFirstWord: 'the spell’s first word',
  custom: 'a phrase I write'
}

/** The sub-form AlertDialog holds and this block renders. */
export interface SpeechForm {
  audio: AlertAudio
  setAudio: (v: AlertAudio) => void
  mode: SpeechMode
  setMode: (v: SpeechMode) => void
  phrase: string
  setPhrase: (v: string) => void
  /** '' = use the global default voice. */
  voiceId: string
  setVoiceId: (v: string) => void
  alwaysPlay: boolean
  setAlwaysPlay: (v: boolean) => void
}

/** The four fields + the opt-out, read off a def (edit) or at their defaults (add). */
function speechDefaults(initial: AlertDef | null): {
  audio: AlertAudio
  mode: SpeechMode
  phrase: string
  voiceId: string
  alwaysPlay: boolean
} {
  const speech = initial?.speech
  return {
    audio: initial?.audio ?? 'sound',
    mode: speech?.mode ?? 'alertName',
    phrase: speech?.phrase ?? '',
    voiceId: speech?.voiceId ?? '',
    alwaysPlay: initial?.alwaysPlay === true
  }
}

/** Hydrate the speech sub-form from `initial` (edit) or its defaults (add), on every open. */
export function useSpeechForm(open: boolean, initial: AlertDef | null): SpeechForm {
  const [audio, setAudio] = useState<AlertAudio>('sound')
  const [mode, setMode] = useState<SpeechMode>('alertName')
  const [phrase, setPhrase] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [alwaysPlay, setAlwaysPlay] = useState(false)

  useEffect(() => {
    if (!open) return
    const d = speechDefaults(initial)
    setAudio(d.audio)
    setMode(d.mode)
    setPhrase(d.phrase)
    setVoiceId(d.voiceId)
    setAlwaysPlay(d.alwaysPlay)
  }, [open, initial])

  return {
    audio,
    setAudio,
    mode,
    setMode,
    phrase,
    setPhrase,
    voiceId,
    setVoiceId,
    alwaysPlay,
    setAlwaysPlay
  }
}

/**
 * The def keys this block owns. Each is OMITTED at its default, so an alert that never asked to
 * speak saves byte-identically to how it always did — which is what keeps every pre-voice def,
 * every share string and the import de-duplication fingerprint stable.
 */
export function speechFieldsFor(f: SpeechForm): Pick<AlertDef, 'audio' | 'speech' | 'alwaysPlay'> {
  const speech: AlertSpeech = { mode: f.mode }
  const phrase = f.phrase.trim().slice(0, MAX_SPEECH_CHARS)
  if (phrase) speech.phrase = phrase
  if (f.voiceId) speech.voiceId = f.voiceId
  const configured = f.mode !== 'alertName' || speech.phrase !== undefined || speech.voiceId !== undefined
  return {
    ...(f.audio === 'sound' ? {} : { audio: f.audio }),
    ...(configured ? { speech } : {}),
    ...(f.alwaysPlay ? { alwaysPlay: true } : {})
  }
}

/**
 * WHICH SECTIONS THE CHANNEL GOVERNS — the whole of "the Sound options may not be relevant",
 * as two predicates rather than as two `!==` scattered through a JSX tree.
 *
 * They are the same reading `speechPlan` (lib/speech.ts) makes at FIRE time, which is the point:
 * the dialog shows exactly the sections that will be used, so a control on screen is a control
 * that does something and a control that does something is on screen.
 *   'sound'  → the pack sound only.
 *   'speech' → the utterance only; the sound is kept on the def but never played.
 *   'both'   → the sound, then the utterance queued behind it (voice-alerts D5).
 */
export function playsSound(f: SpeechForm): boolean {
  return f.audio !== 'speech'
}
export function speaks(f: SpeechForm): boolean {
  return f.audio !== 'sound'
}

/**
 * WHICH `$<name>` PLACEHOLDERS THIS TRIGGER OFFERS — computed by AlertDialog from the condition
 * drafts the user is editing (shared/captureNames.ts) and handed down, because the trigger and
 * the phrase live in two different halves of the same dialog.
 *
 * `partial` is set when any condition is a raw regex: such a match ALSO carries the fields of
 * whatever event the line parsed to, and which event that is is unknowable until a line arrives.
 * The block says so in words rather than listing a kind it would be guessing at.
 */
export interface CaptureHints {
  names: string[]
  partial: boolean
}

const NO_CAPTURES: CaptureHints = { names: [], partial: false }

/**
 * Stand-in values for the editor's preview, so it shows the SENTENCE that will be spoken rather
 * than the holes a firing has not filled in yet.
 *
 * The stand-in is the NAME ITSELF, bare — not a bracketed marker. The ▶ button speaks this exact
 * string through the real engine, and a marker character would be read aloud as punctuation.
 * "attacker hit you for amount" is a sentence; "‹attacker› hit you for ‹amount›" is a noise.
 */
function sampleCaptures(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, n]))
}

/**
 * The resolved sentence this alert will speak — W1's editor-preview contract, now resolved
 * against `hints` so a phrase with placeholders previews as prose.
 *
 * A placeholder the trigger does NOT offer resolves to nothing here, exactly as it would at fire
 * time. That is deliberate feedback, and `unknownPlaceholders` below names it out loud.
 */
export function previewTextFor(name: string, f: SpeechForm, hints: CaptureHints = NO_CAPTURES): string | null {
  const fields = speechFieldsFor(f)
  const def = { name, ...(fields.speech ? { speech: fields.speech } : {}) }
  return speechTextFor(def, { captures: sampleCaptures(hints.names) })
}

/**
 * Placeholders the phrase names that this trigger cannot fill — a typo, or a group left behind
 * after the trigger was edited. Empty for a raw trigger with `partial` hints: the event half of
 * its namespace is unknown at edit time, so calling a name "unknown" there would be a false alarm.
 */
export function unknownPlaceholders(f: SpeechForm, hints: CaptureHints): string[] {
  if (f.mode !== 'custom' || hints.partial) return []
  const offered = new Set(hints.names)
  return placeholdersIn(f.phrase).filter((n) => !offered.has(n))
}

/**
 * THE CHANNEL CHOICE — audio-channel selector + the always-play opt-out.
 *
 * EXPORTED, and rendered by AlertDialog ABOVE the two sections it governs rather than buried in
 * the Voice block below them. It is the question that decides whether Sound and Voice are
 * relevant at all, so it has to be asked first; a user who picks "Speak it" should never have
 * scrolled past a sound picker that will not be used to find out.
 *
 * BOTH CONTROLS BELONG TO EVERY ALERT, which is why they are here and not in either dependent
 * section: the channel is the choice itself, and `alwaysPlay` opts out of the cross-alert audio
 * throttle whichever channel it comes out of (audioThrottle.ts — one occupancy, not one per
 * channel).
 */
export function AudioActionSection({ form }: { form: SpeechForm }): JSX.Element {
  return (
    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
      <Box sx={{ minWidth: 200 }}>
        <Typography variant="caption" color="text.secondary">
          When this fires…
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="alert-audio-action"
          value={form.audio}
          onChange={(e) => form.setAudio(e.target.value as AlertAudio)}
        >
          {ALERT_AUDIO_ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>
              {AUDIO_LABELS[a]}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="alert-always-play"
            checked={form.alwaysPlay}
            onChange={(e) => form.setAlwaysPlay(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Always play (skip audio throttle)</Typography>}
      />
    </Stack>
  )
}

/**
 * The `$<name>` values this trigger offers, as chips that INSERT rather than merely inform —
 * clicking one appends it to the phrase, so the syntax never has to be typed from memory or
 * learned from a tooltip.
 *
 * Renders nothing when the trigger offers nothing AND there is no raw condition to explain: an
 * empty "you can use:" row is dead state (AGENTS.md: state, never process).
 */
function PlaceholderChips({ form, hints }: { form: SpeechForm; hints: CaptureHints }): JSX.Element | null {
  if (hints.names.length === 0 && !hints.partial) return null
  const insert = (n: string): void => form.setPhrase(`${form.phrase}${form.phrase ? ' ' : ''}$<${n}>`)
  return (
    <Box data-testid="alert-speech-placeholders">
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        This trigger can say:
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {hints.names.map((n) => (
          <Chip
            key={n}
            size="small"
            variant="outlined"
            label={`$<${n}>`}
            onClick={() => insert(n)}
            sx={{ fontFamily: 'monospace' }}
          />
        ))}
      </Stack>
      {hints.partial && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          A raw trigger can also say any field of the event the matched line turns out to be —
          <code> $&lt;target&gt;</code>, <code>$&lt;amount&gt;</code> and so on.
        </Typography>
      )}
    </Box>
  )
}

/** Mode picker + live preview + (custom only) the capped phrase field and its placeholders. */
function SaysRow({
  name,
  form,
  hints
}: {
  name: string
  form: SpeechForm
  hints: CaptureHints
}): JSX.Element {
  const preview = previewTextFor(name, form, hints)
  const unknown = unknownPlaceholders(form, hints)
  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="caption" color="text.secondary">
          Say…
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="alert-speech-mode"
          value={form.mode}
          onChange={(e) => form.setMode(e.target.value as SpeechMode)}
        >
          {SPEECH_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {MODE_LABELS[m]}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {form.mode === 'custom' && (
        <>
          <TextField
            size="small"
            label="Phrase"
            data-testid="alert-speech-phrase"
            value={form.phrase}
            onChange={(e) => form.setPhrase(e.target.value)}
            slotProps={{ htmlInput: { maxLength: MAX_SPEECH_CHARS } }}
            error={unknown.length > 0}
            helperText={
              unknown.length > 0
                ? `${unknown.map((n) => `$<${n}>`).join(', ')} — this trigger does not offer that; it will be left out.`
                : `${String(form.phrase.length)} / ${String(MAX_SPEECH_CHARS)}`
            }
          />
          <PlaceholderChips form={form} hints={hints} />
        </>
      )}

      <Typography variant="caption" color="text.secondary" data-testid="alert-speech-preview">
        {preview ? `Speaks: “${preview}”` : 'Speaks nothing — give the alert a name or a phrase.'}
      </Typography>
    </Stack>
  )
}

/** Per-alert voice override + the ▶ that speaks the preview through the real engine. */
function VoiceRow({
  name,
  form,
  hints
}: {
  name: string
  form: SpeechForm
  hints: CaptureHints
}): JSX.Element {
  const prefs = currentVoicePrefs()
  const voices = useVoiceOptions(prefs.engine)
  const preview = previewTextFor(name, form, hints)
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
      <Box sx={{ minWidth: 240, flexGrow: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Voice
        </Typography>
        <Select
          size="small"
          fullWidth
          displayEmpty
          data-testid="alert-speech-voice"
          value={voices.some((v) => v.id === form.voiceId) ? form.voiceId : ''}
          onChange={(e) => form.setVoiceId(e.target.value)}
        >
          <MenuItem value="">Default voice</MenuItem>
          {voices.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.label}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <Button
        size="small"
        startIcon={<PlayArrowIcon />}
        data-testid="alert-speech-test"
        disabled={!preview}
        onClick={() => {
          if (preview) void speak(preview, prefs, { ...(form.voiceId ? { voiceId: form.voiceId } : {}) })
        }}
      >
        Test
      </Button>
    </Stack>
  )
}

/**
 * THE VOICE SECTION — what a speaking alert says, and in whose voice.
 *
 * IT RENDERS ONLY WHEN THE ALERT SPEAKS, and the CALLER decides that (`speaks()` below, used by
 * AlertDialog) rather than this component returning null. The dialog owns the layout — which
 * section follows which, and which divider goes between them — so a section that is absent must
 * be absent to the thing doing the arranging, not merely invisible inside its own box. A
 * self-hiding block would leave the dialog rendering a separator above nothing.
 *
 * The channel selector that governs this is `AudioActionSection` above, rendered by the dialog
 * ahead of both dependent sections. What is left here is speech-only by construction.
 */
export default function SpeechBlock({
  name,
  form,
  voiceSetup,
  hints = NO_CAPTURES
}: {
  name: string
  form: SpeechForm
  /** Whether there is a voice to speak with, and how to go set one up (VoiceSetupLink.tsx). */
  voiceSetup: VoiceSetupNotice
  /**
   * The `$<name>` values the trigger being edited offers. Defaults to none so a caller with no
   * trigger in hand (and every test that mounts this block bare) still compiles — the phrase
   * field simply offers no chips, which is what an app-signal alert genuinely has.
   */
  hints?: CaptureHints
}): JSX.Element {
  return (
    <Box data-testid="alert-speech-block">
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
        <VolumeUpIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">
          Voice
        </Typography>
      </Stack>
      <Stack spacing={1.5}>
        {/* No master switch to warn about any more (this used to say "spoken alerts are switched
            off in Preferences"): choosing 'Speak it' above IS the switch. The only thing left to
            say is that the chosen tier has nothing to speak with — and it says it with a LINK. */}
        <VoiceSetupLink notice={voiceSetup} testId="alert-speech-setup" />
        <SaysRow name={name} form={form} hints={hints} />
        <VoiceRow name={name} form={form} hints={hints} />
      </Stack>
    </Box>
  )
}
