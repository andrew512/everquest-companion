// audioCheck — the app's answer to "why did I not hear that?", as pure functions.
//
// JOS-442 (a LIVE owner failure): every alert sound and the spoken voice went silent on the
// owner's machine while everything upstream was provably healthy — the def enabled, the mp3 on
// disk, the trigger firing, the module delta arriving. The app could say NOTHING about it,
// because it had no audio state to say anything WITH: `playSound` swallowed every `play()`
// rejection in an empty catch, a failed fetch was cached as null forever, and no surface
// anywhere could report whether Windows had even been asked for sound. Silence looked exactly
// like success.
//
// So this module exists to make the audio path SAYABLE. It holds three things and no effects:
//
//   1. THE READOUT SHAPE (`AudioSessionReadout`) — what main's WASAPI probe found out about this
//      process's own audio session (audioSessionNative.ts). Declared here rather than in main so
//      the renderer, the preload and the tests all read one definition.
//   2. THE ATTEMPT SHAPE (`SoundTestAttempt`) — what the renderer observed when it actually tried
//      to play something: did the bytes arrive, did `play()` resolve, did the element advance.
//   3. THE VERDICT (`soundCheckVerdict`) — the ONE place those two halves are turned into a
//      sentence. It lives here, pure and node-tested, because "the test button reports honestly"
//      is the acceptance criterion, and a rule written inside a React component is a rule nobody
//      can pin.
//
// THE VERDICT NEVER GUESSES. Every branch below names the evidence it read, and where the two
// halves disagree it says so rather than picking the cheerful one: a `play()` that resolved
// while Windows shows no audio session for this process is reported as a FAILURE TO REACH THE
// DEVICE, not as a success — that combination is exactly what the owner's machine showed on
// 2026-08-21, and a button that answered "played" to it would have been the same lie the empty
// catch was.

/** Windows' DEVICE_STATE_*, as words. `unknown` means the probe read a value it does not know. */
export type AudioDeviceState = 'active' | 'disabled' | 'notpresent' | 'unplugged' | 'unknown'

/** AudioSessionState (IAudioSessionControl::GetState), as words. */
export type AudioSessionState = 'inactive' | 'active' | 'expired' | 'unknown'

/** This process's own session on the default render endpoint, when Windows has one. */
export interface OwnAudioSession {
  readonly state: AudioSessionState
  /** The per-app mute in the Windows volume mixer — the hypothesis this readout exists to test. */
  readonly muted: boolean
  /** The per-app volume slider, 0..1. */
  readonly volume: number
}

/**
 * What main's WASAPI probe found. `available:false` is a first-class answer, not an error: the
 * probe is a best-effort diagnostic and the app must stay useful without it (a non-Windows build,
 * a koffi binary this machine will not map, a COM call that refused). The reason is prose for the
 * card, never a code.
 */
export type AudioSessionReadout =
  | { readonly available: false; readonly reason: string }
  | {
      readonly available: true
      /** The default RENDER endpoint's friendly name — "Speakers (PRO X 2 LIGHTSPEED)". */
      readonly deviceName: string
      readonly deviceState: AudioDeviceState
      /** The endpoint's own mute + volume (the master slider), not this app's. */
      readonly endpointMuted: boolean
      readonly endpointVolume: number
      /**
       * This app's session, or NULL when Windows has none for it anywhere.
       *
       * Null is the loudest thing this readout can say. A session is created when a process
       * first opens a render stream and LINGERS (inactive) long after the sound stops — the
       * owner's machine showed sessions for eqgame, Discord and Chrome and none for this app,
       * which is what turned "the mixer must have muted us" into "we never reached the mixer".
       *
       * "THIS APP" IS NOT "THIS PROCESS", and getting that wrong would make the field lie
       * permanently. Chromium plays audio from its AUDIO SERVICE utility process, not from the
       * browser process — MEASURED on the owner's machine 2026-08-21, where Chrome's mixer entry
       * belonged to pid 28112 (`--utility-sub-type=audio.mojom.AudioService`) and not to any
       * process a `process.pid` compare would have found. The probe therefore matches on the
       * session's EXECUTABLE as well as its pid; see audioSessionNative.ts `isOurs`.
       */
      readonly session: OwnAudioSession | null
      /**
       * The name of the NON-DEFAULT endpoint this app's session was found on, when it was.
       *
       * This is the stale-binding shape stated as a fact rather than a suspicion: the device
       * changed under a running app, Windows moved the default, and the app is still holding a
       * stream on the endpoint nobody is listening to. Null means the session (if any) was on
       * the default endpoint, which is the healthy arrangement.
       */
      readonly sessionOnOtherDevice: string | null
    }

/** What the renderer observed while trying to play the test sound. */
export interface SoundTestAttempt {
  /** What was played, for the message ("Kaffee hi (A Few Good Men)"). Empty means nothing was. */
  readonly soundLabel: string
  /** Did `getSoundData` hand back bytes? */
  readonly fetched: boolean
  /** Did `play()` RESOLVE (as opposed to rejecting)? False whenever `fetched` is false. */
  readonly started: boolean
  /** The rejection's `name` (`NotAllowedError`, `NotSupportedError`, `AbortError`), if any. */
  readonly errorName?: string
  /**
   * Did the element's `currentTime` advance past zero? THREE-VALUED: null means nobody watched
   * long enough to say, and the verdict convicts only on `false`. `play()` resolves the instant
   * playback begins, when the clock is still legitimately at zero — a two-valued field here would
   * have made every healthy play look like a stalled one.
   */
  readonly advanced: boolean | null
}

/** `ok` = heard it; `silent` = it ran and something ate it; `failed` = it never ran. */
export type SoundCheckStatus = 'ok' | 'silent' | 'failed' | 'idle'

export interface SoundCheckVerdict {
  readonly status: SoundCheckStatus
  /** One sentence, written for the owner rather than for a log. */
  readonly headline: string
  /** The evidence the headline rests on, one fact per line. Always present, always readable. */
  readonly detail: readonly string[]
}

function pct(v: number): string {
  return `${String(Math.round(Math.max(0, Math.min(1, v)) * 100))}%`
}

/**
 * The facts the readout carries, as lines a person can read. Rendered under EVERY verdict —
 * including the happy one — because the value of this card is that it always shows its work.
 */
export function readoutLines(readout: AudioSessionReadout): string[] {
  if (!readout.available) return [`Windows audio state could not be read: ${readout.reason}`]
  const lines = [
    `Playback device: ${readout.deviceName || '(unnamed)'} (${readout.deviceState})`,
    `Device volume: ${pct(readout.endpointVolume)}${readout.endpointMuted ? ' - MUTED' : ''}`
  ]
  lines.push(
    readout.session
      ? `This app in the volume mixer: ${pct(readout.session.volume)}${
          readout.session.muted ? ' - MUTED' : ''
        } (${readout.session.state})`
      : 'This app in the volume mixer: not present - Windows has no audio session for it'
  )
  if (readout.sessionOnOtherDevice !== null) {
    lines.push(`This app is still playing to: ${readout.sessionOnOtherDevice}`)
  }
  return lines
}

/** "It never ran" — the two ways the attempt can die before Windows is asked for anything. */
function refusedHeadline(attempt: SoundTestAttempt, what: string): string | null {
  if (!attempt.fetched) {
    return `The app could not read ${what} from disk, so nothing was sent to Windows.`
  }
  if (!attempt.started) {
    const why = attempt.errorName ? ` (${attempt.errorName})` : ''
    return `Playback of ${what} was refused before any sound was made${why}.`
  }
  return null
}

/**
 * "It ran and something ate it" — everything the WASAPI readout can convict, most actionable
 * first. Null means the readout found nothing to complain about, which is not the same as
 * proving the owner heard it.
 */
function eatenHeadline(readout: AudioSessionReadout): string | null {
  if (!readout.available) return null
  const device = readout.deviceName || 'your playback device'
  if (readout.session?.muted === true) {
    return 'It played, but this app is MUTED in the Windows volume mixer - unmute it there.'
  }
  // BEFORE the endpoint checks on purpose: when the session lives somewhere else, the default
  // endpoint's mute and volume describe a device this app is not playing to, and convicting them
  // would send the owner to the wrong slider.
  if (readout.sessionOnOtherDevice !== null) {
    return `It played, but this app is still attached to ${readout.sessionOnOtherDevice} while Windows now plays through ${device}. Restarting the app re-attaches it.`
  }
  // MEASURED, and it is why this branch is worded the way it is (JOS-442, 2026-08-21): the owner's
  // dev app was silenced by exactly this - electron.exe's slider at 0.000 with MUTE False on the
  // headset endpoint, persisted by Windows per executable and per device, so it survived every
  // restart and silenced every instance while anyone hunting for a MUTE found nothing. The
  // "while a sound is playing" clause is the other half of why it stayed hidden: this app only
  // appears in the mixer while it holds a session, and its session vanishes seconds after the
  // sound stops, so opening the mixer to look shows no row for the app at all.
  if (readout.session !== null && readout.session.volume === 0) {
    return "It played, but this app's slider in the Windows volume mixer is at zero. Open the mixer while a sound is playing and raise it - the app only appears there while it is making a noise."
  }
  if (readout.endpointMuted) return `It played, but ${device} is muted.`
  if (readout.endpointVolume === 0) return `It played, but ${device} is at zero volume.`
  // THE 2026-08-21 SHAPE. `play()` resolved and Windows still has no session for this app
  // anywhere, which means the sound never reached an audio device at all. A restart is the only
  // thing known to clear it, so the sentence says that rather than something reassuring.
  if (readout.session === null) {
    return 'It played inside the app, but Windows never opened an audio stream for it - the sound is not reaching your device. Restarting the app usually fixes this.'
  }
  return null
}

/**
 * Turn one test attempt plus one readout into an honest verdict.
 *
 * ORDER IS THE ARGUMENT. The branches run from "it never ran" to "it ran and something ate it"
 * to "it ran", and inside the middle group the ACTIONABLE causes come first. The last branch is
 * the only one that says it worked, and it is reachable only when nothing else had anything to
 * report — including the element's own admission that it never advanced.
 */
export function soundCheckVerdict(
  attempt: SoundTestAttempt,
  readout: AudioSessionReadout
): SoundCheckVerdict {
  const detail = readoutLines(readout)
  const what = attempt.soundLabel || 'the test sound'

  if (!attempt.soundLabel) {
    return { status: 'idle', headline: 'No sound is set up to test yet.', detail }
  }
  const refused = refusedHeadline(attempt, what)
  if (refused !== null) return { status: 'failed', headline: refused, detail }

  const eaten = eatenHeadline(readout)
  if (eaten !== null) return { status: 'silent', headline: eaten, detail }

  // `false`, never `null` — see SoundTestAttempt.advanced. No evidence is not evidence.
  if (attempt.advanced === false) {
    return {
      status: 'silent',
      headline: `Playback of ${what} started but never advanced - the audio stack accepted it and produced nothing.`,
      detail
    }
  }

  const where = readout.available && readout.deviceName ? ` on ${readout.deviceName}` : ''
  return { status: 'ok', headline: `Played ${what}${where}.`, detail }
}

// ------------------------------------------------------------------- what the button plays

/** The sound the check will play, and what to call it in the verdict. */
export interface TestSoundPick {
  readonly packId: string
  readonly soundId: string
  readonly label: string
}

/**
 * Choose what the sound check plays.
 *
 * IT PREFERS AN ALERT THE USER ACTUALLY SET UP, because the question being asked is "why did I
 * not hear my alert", and testing a different sound through a different pack answers a different
 * question — the owner's failure had a healthy pack sitting beside a silent alert, and a check
 * that played the pack's own demo would have passed while the alert stayed dead. Falling back to
 * the default pack's first line keeps the button useful on a fresh install with no alerts yet;
 * null means there is genuinely nothing installed to play, which the verdict reports as `idle`
 * rather than as a failure.
 */
export function pickTestSound(
  defs: readonly {
    enabled: boolean
    name: string
    sound: { packId: string; soundId: string }
  }[],
  packs: readonly { id: string; name: string; sounds: Record<string, { label: string }> }[],
  defaultPackId: string | null
): TestSoundPick | null {
  const byId = new Map(packs.map((p) => [p.id, p]))
  for (const def of defs) {
    if (!def.enabled) continue
    const pack = byId.get(def.sound.packId)
    const sound = pack?.sounds[def.sound.soundId]
    if (pack && sound) {
      return { packId: pack.id, soundId: def.sound.soundId, label: `${sound.label} (${def.name})` }
    }
  }
  const fallback = (defaultPackId !== null ? byId.get(defaultPackId) : undefined) ?? packs[0]
  if (!fallback) return null
  const first = Object.keys(fallback.sounds)[0]
  if (first === undefined) return null
  return {
    packId: fallback.id,
    soundId: first,
    label: `${fallback.sounds[first]?.label ?? first} (${fallback.name})`
  }
}

// ---------------------------------------------------------------- the failure log's throttle

/**
 * How long ONE audio failure key stays quiet after it has been reported once.
 *
 * A failing audio stack fails on EVERY alert, and an alert-heavy pull can fire a dozen times in
 * as many seconds — so the unthrottled version of this would put hundreds of identical lines in
 * errors.log and make the report unreadable. A minute per key is long enough that a burst is one
 * line and short enough that a failure spanning a play session is still visibly recurring.
 */
export const AUDIO_FAILURE_THROTTLE_MS = 60_000

/**
 * Should this failure be written, given when its key was last written? Pure so the rule is
 * pinned by a test rather than by a Map in a module nobody can reach.
 */
export function shouldReportAudioFailure(
  lastReportedAt: number | undefined,
  now: number,
  throttleMs: number = AUDIO_FAILURE_THROTTLE_MS
): boolean {
  if (lastReportedAt === undefined) return true
  return now - lastReportedAt >= throttleMs
}

/** Which step of the audio path failed. Part of the log line, so it is a closed set. */
export type AudioFailureKind = 'fetch' | 'play' | 'devicechange'

/**
 * The ONE sentence an audio failure puts in errors.log.
 *
 * Written as a formatter rather than inline at each call site so that the shape — kind, sound
 * key, error name — is the same for every failure and a report can be grouped by it. `suppressed`
 * says how many identical failures the throttle ate since the last line, so a quiet log never
 * under-states a loud problem.
 */
export function audioFailureMessage(
  kind: AudioFailureKind,
  key: string,
  errorName: string,
  suppressed = 0
): string {
  const head =
    kind === 'fetch'
      ? `alert sound '${key}' could not be loaded`
      : kind === 'play'
        ? `alert sound '${key}' failed to play`
        : `audio device change while '${key}' was in flight`
  const why = errorName ? `: ${errorName}` : ''
  const more = suppressed > 0 ? ` (+${String(suppressed)} more since the last report)` : ''
  return `${head}${why}${more}`
}
