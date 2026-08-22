// audioHealth — the app's memory of whether its own audio is working, and the ONE door every
// audio failure leaves through.
//
// WHY IT EXISTS (JOS-442). Before this module the app had no audio state at all: `playSound`
// caught every `play()` rejection into an empty block, a failed fetch was cached as null for the
// life of the process, and nothing anywhere recorded that a sound had ever succeeded. When the
// owner's audio went silent for an entire evening, the app's own error log had NOTHING in it for
// the whole failure window — not one line — because there was no code that could have written
// one. That absence is the defect this module closes.
//
// THREE THINGS, AND NO POLICY ABOUT SOUND ITSELF:
//   1. LAST-PLAYED-OK. A timestamp, set by the one call site that knows a play started. It is
//      what lets a diagnostic say "the last sound that worked was 40 minutes ago" instead of
//      shrugging.
//   2. EVERY FAILURE SAYS SO, ONCE PER MINUTE PER KEY. A broken audio stack breaks on every
//      alert, so an unthrottled report would put hundreds of identical lines in errors.log and
//      bury the diagnosis in its own noise. The throttle is per (kind, sound) and it COUNTS what
//      it swallowed, so the line that does get written says how many it stands for — quiet, but
//      never under-stating.
//   3. DEVICE CHANGES ARE FACTS TOO. `navigator.mediaDevices.ondevicechange` is the one signal
//      the renderer gets when the machine's audio hardware moves under it, and it is recorded
//      here so the diagnostic can put "your headset came back at 18:31" next to "and nothing has
//      played since".
//
// THE THROTTLE IS PURE AND LIVES ELSEWHERE (`shared/audioCheck.ts`): this file holds the state
// the rule is applied to, so the rule itself stays testable without one.
//
// Value imports from `shared/` are RELATIVE, never `@shared/*` — the repo-wide rule for anything
// node:test loads (AGENTS.md toolchain gotchas, the mobSearch.ts precedent).

import {
  audioFailureMessage,
  shouldReportAudioFailure,
  type AudioFailureKind
} from '../../../../shared/audioCheck'

/** What this module knows. Read by the Preferences sound check; written by nothing else. */
export interface AudioHealthState {
  /** When a sound last STARTED playing without rejecting, or null if none ever has. */
  readonly lastOkAt: number | null
  /** What last went wrong, whether or not the throttle let it reach errors.log. */
  readonly lastFailure: {
    readonly at: number
    readonly kind: AudioFailureKind
    readonly key: string
    readonly errorName: string
  } | null
  /** Every failure since the app started, throttled or not. */
  readonly failures: number
  /** When the machine's audio devices last changed under us. */
  readonly lastDeviceChangeAt: number | null
}

interface ThrottleCell {
  reportedAt: number
  suppressed: number
}

const throttle = new Map<string, ThrottleCell>()
let lastOkAt: number | null = null
let lastFailure: AudioHealthState['lastFailure'] = null
let failures = 0
let lastDeviceChangeAt: number | null = null

/** The current state, as a plain snapshot (never a live reference). */
export function audioHealthState(): AudioHealthState {
  return { lastOkAt, lastFailure, failures, lastDeviceChangeAt }
}

/** Drop everything. Tests only — nothing in the app has a reason to forget this. */
export function resetAudioHealth(): void {
  throttle.clear()
  lastOkAt = null
  lastFailure = null
  failures = 0
  lastDeviceChangeAt = null
}

/**
 * A sound started playing. Called from the ONE place that knows it — after `play()` resolves —
 * and it also clears that sound's throttle cell, so a sound that recovers and breaks again gets
 * a fresh line rather than being silenced by the minute it failed in an hour ago.
 */
export function noteAudioPlayed(key: string, now: number = Date.now()): void {
  lastOkAt = now
  throttle.delete(`play:${key}`)
  throttle.delete(`fetch:${key}`)
}

/** An error's own name, which is the useful half at an audio boundary (`NotSupportedError`). */
function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name
  if (typeof err === 'string' && err) return err
  return ''
}

/**
 * The renderer's error channel, guarded.
 *
 * `window.eq` is absent in the overlay bundle and in node:test, and an audio failure must never
 * become a SECOND failure — this module exists because the last one was invisible, not so it can
 * throw on the way to saying so.
 */
function forward(message: string, name: string): void {
  try {
    const bridge = (globalThis as { window?: { eq?: { reportError?: (r: unknown) => void } } })
      .window?.eq?.reportError
    if (typeof bridge !== 'function') return
    bridge({ source: 'renderer:alertAudio', message, ...(name ? { name } : {}) })
  } catch {
    // A broken bridge is not worth a second exception on the path that reports breakage.
  }
}

/**
 * Record an audio failure, and write ONE line to errors.log if this key has been quiet for the
 * throttle window. Returns whether it wrote — which is what the unit test asserts on, and what
 * makes "never spammy, never silent" a checkable claim rather than a promise.
 */
export function reportAudioFailure(
  kind: AudioFailureKind,
  key: string,
  err: unknown,
  now: number = Date.now()
): boolean {
  const name = errorName(err)
  failures += 1
  lastFailure = { at: now, kind, key, errorName: name }

  const cell = throttle.get(`${kind}:${key}`)
  if (!shouldReportAudioFailure(cell?.reportedAt, now)) {
    if (cell) cell.suppressed += 1
    return false
  }
  forward(audioFailureMessage(kind, key, name, cell?.suppressed ?? 0), name)
  throttle.set(`${kind}:${key}`, { reportedAt: now, suppressed: 0 })
  return true
}

/**
 * The machine's audio devices changed. Recorded rather than acted on: the per-play `new Audio()`
 * elements rebind to whatever the audio stack considers current, so there is nothing to reset —
 * see `player.tsx`, which measured that and says so.
 */
export function noteDeviceChange(now: number = Date.now()): void {
  lastDeviceChangeAt = now
}
