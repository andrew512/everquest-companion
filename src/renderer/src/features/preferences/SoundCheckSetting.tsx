// SoundCheckSetting — Preferences → Sound → "Sound check": press it, and the app tells you
// whether it made a noise and, when it did not, WHY.
//
// THE POINT OF THIS CARD (JOS-442). Every alert sound and the spoken voice went silent on the
// owner's machine for an evening, and no surface in the app could say a single thing about it.
// The Alerts tab's preview button played nothing and reported nothing — the same silence as
// success. So this is deliberately not another play button: it plays, then it ASKS WINDOWS what
// happened, and it prints both halves.
//
// WHAT IT ASKS WINDOWS. `window.eq.readAudioSession()` runs a WASAPI read in main
// (main/audioSessionNative.ts): which device is the default, whether that device is muted, and
// whether THIS APP has an entry in the volume mixer at all — with its own mute and its own
// volume. That last one is the fact no renderer can see and the one that separates "you muted us"
// from "we never reached your sound card".
//
// THE VERDICT IS NOT WRITTEN HERE. `soundCheckVerdict` (shared/audioCheck.ts) turns the attempt
// and the readout into a sentence, is pure, and is pinned by tests/audioCheck.test.mts — because
// "reports honestly" is the acceptance criterion and a rule living inside a component is a rule
// nobody can test. This file renders what that function returns and adds nothing to it.
//
// STATE, NEVER PROCESS (the repo's UI law): the card says what is true — which device, what
// volume, when audio last worked — and never narrates IPC, COM or caches.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import type { AudioSessionReadout, SoundCheckVerdict } from '@shared/audioCheck'
import { pickTestSound, readoutLines, soundCheckVerdict } from '../../../../shared/audioCheck'
import { playSoundReporting } from '../alerts/soundCache'
import { audioHealthState } from '../alerts/audioHealth'
import { currentDefs, currentPrefs, refreshAlertStore } from '../alerts/player'
import type { PrefSection } from './PreferencesView'

/**
 * How long the check watches the element before deciding it never advanced.
 *
 * `play()` resolves the moment playback BEGINS, when `currentTime` is still legitimately zero, so
 * a check that read the clock straight away would call every healthy play a stalled one. A
 * quarter second is several audio buffers on any device and still fast enough that the button
 * feels immediate.
 */
const OBSERVE_MS = 250

/** "3 minutes ago" / "just now" — relative because the absolute time means nothing here. */
function ago(at: number | null, now: number): string {
  if (at === null) return 'never'
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 90) return `${String(secs)}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 90) return `${String(mins)} min ago`
  return `${String(Math.round(mins / 60))} h ago`
}

/** The health facts the app keeps about itself, rendered under the readout. */
function healthLines(): string[] {
  const h = audioHealthState()
  const now = Date.now()
  const lines = [`A sound last played: ${ago(h.lastOkAt, now)}`]
  if (h.lastDeviceChangeAt !== null) {
    lines.push(`Your audio devices last changed: ${ago(h.lastDeviceChangeAt, now)}`)
  }
  if (h.lastFailure) {
    lines.push(
      `Last audio failure: ${h.lastFailure.kind} on '${h.lastFailure.key}'${
        h.lastFailure.errorName ? ` (${h.lastFailure.errorName})` : ''
      }, ${ago(h.lastFailure.at, now)} - ${String(h.failures)} since the app started`
    )
  }
  return lines
}

const SEVERITY = {
  ok: 'success',
  silent: 'warning',
  failed: 'error',
  idle: 'info'
} as const

export function SoundCheckSetting(): JSX.Element {
  const [readout, setReadout] = useState<AudioSessionReadout | null>(null)
  const [verdict, setVerdict] = useState<SoundCheckVerdict | null>(null)
  const [running, setRunning] = useState(false)

  // The facts, before anything is played. Shown on their own so the card is useful the moment it
  // opens — a muted mixer entry is worth seeing without pressing anything — while the VERDICT
  // stays something only an actual attempt can earn.
  useEffect(() => {
    let alive = true
    void window.eq.readAudioSession().then(
      (r) => {
        if (alive) setReadout(r)
      },
      () => {
        if (alive) setReadout({ available: false, reason: 'the app could not ask Windows' })
      }
    )
    return () => {
      alive = false
    }
  }, [])

  const run = useCallback(() => {
    setRunning(true)
    setVerdict(null)
    void (async (): Promise<void> => {
      try {
        // Re-read the alert store first: the check plays the user's OWN alert sound, and this
        // pane can be opened without the Alerts tab ever having been visited.
        await refreshAlertStore()
        const [packs, prefs] = await Promise.all([
          window.eq.listSoundPacks(),
          window.eq.getSoundPackPrefs()
        ])
        const pick = pickTestSound(currentDefs(), packs, prefs.defaultPackId ?? null)
        // VOLUME IGNORES THE MASTER MUTE ON PURPOSE: this is a test of the machine, not a
        // rehearsal of the alert, and answering "you have the app muted" is the job of a caption,
        // not of playing nothing. The per-alert volume is still respected via globalVolume.
        const gain = Math.max(0.2, currentPrefs().globalVolume)
        const outcome = pick
          ? await playSoundReporting(pick.packId, pick.soundId, gain, OBSERVE_MS)
          : { fetched: false, started: false, advanced: null as boolean | null }
        const fresh = await window.eq.readAudioSession()
        setReadout(fresh)
        setVerdict(
          soundCheckVerdict(
            {
              soundLabel: pick?.label ?? '',
              fetched: outcome.fetched,
              started: outcome.started,
              ...(outcome.errorName ? { errorName: outcome.errorName } : {}),
              advanced: outcome.advanced
            },
            fresh
          )
        )
      } catch (err: unknown) {
        setVerdict({
          status: 'failed',
          headline: `The sound check could not run: ${String(err)}`,
          detail: []
        })
      } finally {
        setRunning(false)
      }
    })()
  }, [])

  const lines = verdict ? verdict.detail : readout ? readoutLines(readout) : []

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Plays one of your alert sounds and reports what happened - including whether Windows has
        this app muted in its volume mixer, which nothing else in the app can see.
      </Typography>
      <Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={running ? <CircularProgress size={16} /> : <VolumeUpIcon />}
          disabled={running}
          onClick={run}
          data-testid="sound-check-run"
        >
          {running ? 'Testing…' : 'Test sound'}
        </Button>
      </Box>
      {verdict && (
        <Alert severity={SEVERITY[verdict.status]} data-testid="sound-check-verdict">
          {verdict.headline}
        </Alert>
      )}
      <Stack spacing={0.25} data-testid="sound-check-detail">
        {[...lines, ...healthLines()].map((l) => (
          <Typography key={l} variant="caption" color="text.secondary">
            {l}
          </Typography>
        ))}
      </Stack>
    </Stack>
  )
}

/**
 * "Sound" — its own rail section, named beside the card that fills it (the PerfSetting
 * precedent), and placed next to Voice because the two are the app's audio.
 *
 * A SECTION RATHER THAN A LINE INSIDE VOICE: the person who arrives here is not adjusting a
 * preference, they are asking why the app is silent, and the words they will type are "no sound",
 * "muted", "cannot hear" — none of which belong under a heading about speech. The keywords are
 * written for that arrival, including the ones describing what they HEARD (nothing) rather than
 * what the feature is called.
 */
export function soundSection(): PrefSection {
  return {
    id: 'sound',
    label: 'Sound',
    icon: <VolumeUpIcon fontSize="small" />,
    items: [
      {
        id: 'sound-check',
        label: 'Sound check',
        keywords:
          'sound audio no sound silent silence quiet cannot hear cant hear not working broken mute muted unmute volume mixer windows device speakers headset headphones output test check alert alerts play playback diagnose diagnostic troubleshoot fix',
        content: <SoundCheckSetting />
      }
    ]
  }
}
