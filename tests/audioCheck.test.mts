// THE SOUND CHECK REPORTS HONESTLY, AND THIS FILE IS WHAT MAKES THAT CHECKABLE (JOS-442).
//
// The owner's alert audio went completely silent for an evening while the app said nothing at
// all — the empty catch in `playSound` meant a failing audio stack produced zero log lines, and
// a null fetch was cached forever so the sound could never come back without a relaunch. The fix
// has a diagnostic at the end of it: a button that plays something and then REPORTS. A button
// that reports is only worth having if it cannot lie, so every rule it reports by lives in
// `shared/audioCheck.ts` as a pure function and is pinned here.
//
// What this file pins:
//   V-series  the verdict's ORDER — which evidence convicts first, and that "no evidence" never
//             convicts at all (the three-valued `advanced`, whose two-valued ancestor would have
//             called every healthy play a stalled one).
//   T-series  the failure log's throttle — never spammy AND never silent, including that a
//             suppressed burst is counted rather than forgotten.
//   P-series  which sound the button plays: the user's OWN alert first, because the owner's
//             failure had a healthy pack sitting next to a dead alert and a check that played
//             the pack's demo would have passed while the alert stayed silent.
//
// No DOM, no Electron, no fixture: it never skips. Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_FAILURE_THROTTLE_MS,
  audioFailureMessage,
  pickTestSound,
  readoutLines,
  shouldReportAudioFailure,
  soundCheckVerdict,
  type AudioSessionReadout,
  type SoundTestAttempt
} from '../src/shared/audioCheck'

/** A healthy machine: default device active, nothing muted, and this app has a live session. */
function healthy(over: Partial<Extract<AudioSessionReadout, { available: true }>> = {}): AudioSessionReadout {
  return {
    available: true,
    deviceName: 'Speakers (PRO X 2 LIGHTSPEED)',
    deviceState: 'active',
    endpointMuted: false,
    endpointVolume: 0.46,
    session: { state: 'active', muted: false, volume: 1 },
    sessionOnOtherDevice: null,
    ...over
  }
}

/** A play that worked, as the renderer would report it. */
function played(over: Partial<SoundTestAttempt> = {}): SoundTestAttempt {
  return { soundLabel: 'Kaffee hi', fetched: true, started: true, advanced: true, ...over }
}

// ---------------------------------------------------------------------------- V: the verdict

test('V1 a play that worked on a healthy machine is reported as ok, naming the device', () => {
  const v = soundCheckVerdict(played(), healthy())
  assert.equal(v.status, 'ok')
  assert.match(v.headline, /Played Kaffee hi on Speakers \(PRO X 2 LIGHTSPEED\)/)
})

test('V2 nothing to play is idle, not a failure — a fresh install is not broken', () => {
  const v = soundCheckVerdict(played({ soundLabel: '' }), healthy())
  assert.equal(v.status, 'idle')
})

test('V3 a fetch that never produced bytes is a failure, and says nothing reached Windows', () => {
  const v = soundCheckVerdict(played({ fetched: false, started: false }), healthy())
  assert.equal(v.status, 'failed')
  assert.match(v.headline, /could not read/)
  assert.match(v.headline, /nothing was sent to Windows/)
})

test('V4 a rejected play is a failure and carries the error NAME the caller saw', () => {
  const v = soundCheckVerdict(
    played({ started: false, errorName: 'NotAllowedError', advanced: null }),
    healthy()
  )
  assert.equal(v.status, 'failed')
  assert.match(v.headline, /NotAllowedError/)
})

test('V5 THE PER-APP MUTE outranks everything else the readout could say', () => {
  // Hypothesis 1 of the live triage. It is first because it is the one a person can go and undo.
  const v = soundCheckVerdict(
    played(),
    healthy({ session: { state: 'active', muted: true, volume: 1 }, endpointMuted: true })
  )
  assert.equal(v.status, 'silent')
  assert.match(v.headline, /MUTED in the Windows volume mixer/)
})

test('V6 a session on ANOTHER device is named, and outranks the default endpoint sliders', () => {
  // The stale-binding shape. The default endpoint's mute describes a device the app is not
  // playing to, so convicting it would send the owner to the wrong slider.
  const v = soundCheckVerdict(
    played(),
    healthy({
      endpointMuted: true,
      sessionOnOtherDevice: 'ROG XG27AQM (NVIDIA High Definition Audio)'
    })
  )
  assert.equal(v.status, 'silent')
  assert.match(v.headline, /still attached to ROG XG27AQM/)
  assert.match(v.headline, /Restarting the app/)
  // …and the endpoint mute is NOT what it blamed.
  assert.doesNotMatch(v.headline, /is muted\./)
})

test('V7 an absent session is convicted — the 2026-08-21 shape, and it must not read as success', () => {
  // Measured on the owner's machine at 19:40 PT: eqgame, Discord and Chrome all had sessions on
  // the default endpoint and this app had none anywhere. `play()` resolving while Windows has no
  // stream for us is the exact combination the old empty catch reported as nothing at all.
  const v = soundCheckVerdict(played(), healthy({ session: null }))
  assert.equal(v.status, 'silent')
  assert.match(v.headline, /never opened an audio stream/)
})

test('V8 the device mute and the zero volumes each get their own sentence', () => {
  assert.match(
    soundCheckVerdict(played(), healthy({ endpointMuted: true })).headline,
    /Speakers \(PRO X 2 LIGHTSPEED\) is muted/
  )
  assert.match(
    soundCheckVerdict(played(), healthy({ endpointVolume: 0 })).headline,
    /at zero volume/
  )
  assert.match(
    soundCheckVerdict(played(), healthy({ session: { state: 'active', muted: false, volume: 0 } }))
      .headline,
    /volume slider in the Windows mixer is at zero/
  )
})

test('V9 `advanced` is THREE-VALUED: false convicts, null never does', () => {
  // The trap this guards: `play()` resolves the instant playback begins, when currentTime is
  // still legitimately 0. A two-valued field would have made every healthy play look stalled.
  assert.equal(soundCheckVerdict(played({ advanced: false }), healthy()).status, 'silent')
  assert.equal(soundCheckVerdict(played({ advanced: null }), healthy()).status, 'ok')
})

test('V10 an unavailable readout still produces a verdict, and never convicts on what it lacks', () => {
  const blind: AudioSessionReadout = { available: false, reason: 'koffi would not load' }
  const v = soundCheckVerdict(played({ advanced: null }), blind)
  assert.equal(v.status, 'ok')
  assert.deepEqual(v.detail, ['Windows audio state could not be read: koffi would not load'])
  // …and the renderer's OWN evidence still convicts without any native help at all.
  assert.equal(soundCheckVerdict(played({ fetched: false, started: false }), blind).status, 'failed')
})

test('V11 every verdict shows its work — the detail lines are the readout, always', () => {
  const lines = soundCheckVerdict(played(), healthy()).detail
  assert.equal(lines.length, 3)
  assert.match(lines[0] ?? '', /Playback device: Speakers \(PRO X 2 LIGHTSPEED\) \(active\)/)
  assert.match(lines[1] ?? '', /Device volume: 46%/)
  assert.match(lines[2] ?? '', /This app in the volume mixer: 100% \(active\)/)
})

test('V12 the readout lines name a missing session and a mute in words, not codes', () => {
  assert.match(
    readoutLines(healthy({ session: null })).join('\n'),
    /not present — Windows has no audio session for it/
  )
  assert.match(
    readoutLines(healthy({ session: { state: 'inactive', muted: true, volume: 0.5 } })).join('\n'),
    /This app in the volume mixer: 50% — MUTED \(inactive\)/
  )
  assert.match(
    readoutLines(healthy({ sessionOnOtherDevice: 'VS248' })).join('\n'),
    /This app is still playing to: VS248/
  )
})

// ------------------------------------------------------------------------ T: the throttle

test('T1 the first failure of a key always reports', () => {
  assert.equal(shouldReportAudioFailure(undefined, 1_000_000), true)
})

test('T2 a repeat inside the window is swallowed, and the window is exactly one minute', () => {
  const t0 = 1_000_000
  assert.equal(shouldReportAudioFailure(t0, t0 + 1), false)
  assert.equal(shouldReportAudioFailure(t0, t0 + AUDIO_FAILURE_THROTTLE_MS - 1), false)
  assert.equal(shouldReportAudioFailure(t0, t0 + AUDIO_FAILURE_THROTTLE_MS), true)
  assert.equal(AUDIO_FAILURE_THROTTLE_MS, 60_000)
})

test('T3 the line names the step, the sound and the error — and never drops the count', () => {
  assert.equal(
    audioFailureMessage('play', 'afewgoodmen/kaffee_hi', 'NotSupportedError'),
    "alert sound 'afewgoodmen/kaffee_hi' failed to play: NotSupportedError"
  )
  assert.equal(
    audioFailureMessage('fetch', 'afewgoodmen/kaffee_hi', 'NoSoundData'),
    "alert sound 'afewgoodmen/kaffee_hi' could not be loaded: NoSoundData"
  )
  // NEVER SILENT: a quiet log must not under-state a loud problem.
  assert.match(audioFailureMessage('play', 'x/y', 'AbortError', 41), /\(\+41 more since the last report\)/)
  // A nameless throw still produces a readable line rather than a dangling colon.
  assert.equal(audioFailureMessage('play', 'x/y', ''), "alert sound 'x/y' failed to play")
})

// -------------------------------------------------------------- P: what the button plays

const PACKS = [
  {
    id: 'afewgoodmen',
    name: 'A Few Good Men',
    sounds: { kaffee_hi: { label: 'Kaffee hi' }, truth: { label: 'You want the truth' } }
  },
  { id: 'rickman', name: 'Alan Rickman', sounds: { moment: { label: 'A moment of your time' } } }
]

test('P1 it plays the first ENABLED alert the user set up, labelled with that alert', () => {
  const pick = pickTestSound(
    [
      { enabled: false, name: 'Off one', sound: { packId: 'afewgoodmen', soundId: 'truth' } },
      { enabled: true, name: 'Mote dropped', sound: { packId: 'afewgoodmen', soundId: 'kaffee_hi' } }
    ],
    PACKS,
    'rickman'
  )
  assert.deepEqual(pick, {
    packId: 'afewgoodmen',
    soundId: 'kaffee_hi',
    label: 'Kaffee hi (Mote dropped)'
  })
})

test('P2 an alert pointing at a pack that is gone is skipped, not played into the void', () => {
  const pick = pickTestSound(
    [{ enabled: true, name: 'Dangling', sound: { packId: 'deleted', soundId: 'nope' } }],
    PACKS,
    'rickman'
  )
  assert.equal(pick?.packId, 'rickman')
  assert.equal(pick?.label, 'A moment of your time (Alan Rickman)')
})

test('P3 with no alerts at all it falls back to the default pack, so the button still works', () => {
  assert.equal(pickTestSound([], PACKS, 'rickman')?.packId, 'rickman')
  // No stated default: the first installed pack answers rather than nothing happening.
  assert.equal(pickTestSound([], PACKS, null)?.packId, 'afewgoodmen')
})

test('P4 nothing installed is null — which the verdict reports as idle, never as broken', () => {
  assert.equal(pickTestSound([], [], null), null)
  assert.equal(soundCheckVerdict(played({ soundLabel: '' }), healthy()).status, 'idle')
})
