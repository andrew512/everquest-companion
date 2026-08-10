// ============================================================================
// presenceProtocol.ts — the PURE half of "what is EverQuest doing right now?"
// ============================================================================
//
// The `src/main/security.ts` ↔ `src/main/windows.ts` split, applied to presence: everything
// here is a function of its arguments — the watcher's stdout line protocol, the "is this window
// EverQuest" predicate, the alt-tab debounce, and the gating matrix that decides whether the
// overlays hide and whether the 8 ms cursor stream runs.
//
// No Electron, no child process, no `fs`, no store. That is what lets `tests/presence.test.mts`
// pin the performance contract ("nothing runs when nothing is on", "the stream stops when EQ is
// unfocused") as ordinary unit tests that never skip, instead of as claims somebody re-measures
// by hand. `src/main/presence.ts` is the impure half that spawns the watcher and feeds these.

import type {
  CursorRingPrefs,
  OverlayAutoHidePrefs,
  PresenceState,
  ScreenRect
} from '../shared/presencePrefs'

// ---------------------------------------------------------------- the line protocol
//
// The watcher child prints one record per line to stdout, and ONLY when something changed:
//
//   F|<pid>|<x>|<y>|<w>|<h>|<exePath>|<title>   foreground window changed
//   R|<0|1>                                      EQ process existence changed (5 s cadence)
//   C|<0|1>                                      system cursor visibility changed
//   H                                            heartbeat — "still looping" (5 s cadence)
//   X|<reason>                                   the LAST line: why the loop is about to stop
//
// `title` is last because it is the only field that may contain anything (including `|`); a
// Windows path cannot contain `|`, so every field before it is unambiguous.
//
// THE HEARTBEAT IS THE ONE UNCONDITIONAL LINE, and it is why it exists. Every other record is
// printed ONLY on a change, so a healthy watcher's steady state is total silence on the pipe —
// which is exactly what a WEDGED watcher looks like from the parent. Without an explicit
// liveness signal there is no observation that separates "nothing has happened" from "nothing
// will ever happen again", and the second one FREEZES the presence state: `eqFocused:true`
// outlives the alt-tab that should have cleared it and the ring keeps drawing over whatever the
// user switched to. One 1-byte line per 5 s on an otherwise idle pipe buys that distinction.
//
// THE EXIT LINE IS THE CHILD'S LAST WORD (JOS-164). A watcher child can end itself — it self-reaps
// when its parent is gone, because Windows orphans children rather than killing them — and from
// the parent side that was indistinguishable from every other way a process can stop existing:
// `'exit'`, code 0, no explanation. That mattered exactly once and then mattered a great deal, when
// a machine whose `Get-Process` could not see a LIVE parent made the child reap itself a second
// after every spawn, forever, and the parent's only evidence was 245 identical "exited
// unexpectedly" lines. `X|<reason>` costs one line on a pipe that is about to close and turns that
// into a sentence. It is advisory by construction: a child that is killed, crashes, or is starved
// prints nothing, and the parent must still handle the exit.

/** One decoded watcher record. */
export type PresenceRecord =
  | { t: 'fg'; pid: number; rect: ScreenRect; exePath: string; title: string }
  | { t: 'run'; running: boolean }
  | { t: 'cursor'; visible: boolean }
  | { t: 'beat' }
  | { t: 'exit'; reason: string }

/** A finite integer from one protocol field, or null when the field is not one. */
function intField(s: string | undefined): number | null {
  if (s === undefined || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

/** The `<0|1>` payload `R` and `C` share, or null when the field is not one. */
function boolField(s: string | undefined): boolean | null {
  const v = intField(s)
  return v === null ? null : v !== 0
}

/** The one record with a payload: `F|<pid>|<x>|<y>|<w>|<h>|<exePath>|<title>`. */
function parseForeground(parts: string[]): PresenceRecord | null {
  if (parts.length < 7) return null
  const [pid, x, y, w, h] = [1, 2, 3, 4, 5].map((i) => intField(parts[i]))
  if (pid === null || x === null || y === null || w === null || h === null) return null
  return {
    t: 'fg',
    pid,
    rect: { x, y, width: w, height: h },
    exePath: parts[6] ?? '',
    // The title is whatever remains — it is user/game-supplied text and may contain `|`.
    title: parts.slice(7).join('|')
  }
}

/**
 * The shape of an exit REASON: a lowercase kebab token, capped.
 *
 * Narrow on purpose, and narrow enough that `X|1|2` is still junk rather than a reason of `1|2`
 * (the malformed-line suite has always asserted that line decodes to nothing, and it still must).
 * The child writes these strings itself so the field is not hostile input in the way a window
 * title is — but it lands in the parent's error log, which is a place text goes to be read by a
 * person, so it is bounded by SHAPE here rather than trusted by provenance. The one reason the
 * watcher prints today is `parent-gone`.
 */
const EXIT_REASON_RE = /^[a-z][a-z0-9-]{0,62}$/

/**
 * Decode one stdout line. Returns null for anything that is not a well-formed record, which is
 * the only correct answer for a stream that can also carry a PowerShell warning, a stray blank
 * line, or a partially-flushed write — a malformed line must never move the state.
 */
export function parsePresenceLine(line: string): PresenceRecord | null {
  const trimmed = line.replace(/\r$/, '').trim()
  if (trimmed === '') return null
  const parts = trimmed.split('|')
  if (parts[0] === 'F') return parseForeground(parts)
  if (parts[0] === 'X') {
    const reason = parts[1] ?? ''
    return parts.length === 2 && EXIT_REASON_RE.test(reason) ? { t: 'exit', reason } : null
  }
  // The heartbeat carries no payload, so it is the whole line or it is not a heartbeat.
  if (trimmed === 'H') return { t: 'beat' }
  const flag = boolField(parts[1])
  if (parts[0] === 'R') return flag === null ? null : { t: 'run', running: flag }
  if (parts[0] === 'C') return flag === null ? null : { t: 'cursor', visible: flag }
  return null
}

// ------------------------------------------------------- is this window EverQuest?

/** `<root>\` — a separator-terminated prefix, so `…\EverQuest Legends2` never matches
 *  `…\EverQuest Legends`. Empty in, empty out (an unresolvable root disables path matching). */
export function eqRootPrefix(root: string): string {
  const trimmed = root.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('\\') || trimmed.endsWith('/') ? trimmed : `${trimmed}\\`
}

/**
 * The image names the EverQuest CLIENT actually ships under. `eqgame.exe` has been the client
 * binary on every build from Titanium to Live, and it is the SAME name the watcher's own
 * "is the game running" scan keys on (`$p.ProcessName -eq 'eqgame'`) — one fact, one spelling.
 */
const EQ_CLIENT_EXES = new Set(['eqgame.exe'])

/** The last path segment of a Windows image path, lowercased. */
function exeBaseName(exePath: string): string {
  const p = exePath.trim().toLowerCase()
  const cut = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return cut === -1 ? p : p.slice(cut + 1)
}

/**
 * Does this title belong to the EverQuest CLIENT — as opposed to a window that merely mentions
 * the game? The client titles its window "EverQuest" (some builds append a server or character),
 * so the match is ANCHORED at the start and stops at a word boundary. `…includes('everquest')`
 * was the old test and it is the bug this predicate exists to not have: a browser tab reading
 * "EverQuest Wiki — Google Chrome" contains the substring in the middle, and so does a Discord
 * window sitting in an #everquest channel.
 */
function titleIsEqClient(title: string): boolean {
  return /^everquest\b/i.test(title.trim())
}

/**
 * Is the foreground window EverQuest?
 *
 * PRIMARY signal: the process image lives under the effective EQ install root
 * (`log/config.ts effectiveEqRoot()` — never a hardcoded Daybreak path). That is an identity,
 * not a guess, and it follows the user's Settings override for free.
 *
 * THE PATH, WHEN WE HAVE ONE, IS THE ANSWER — and this is the fix for a real, reported bug: the
 * cursor ring followed the pointer around the user's WEB BROWSER. The old predicate fell back to
 * "the title contains EverQuest" for EVERY window the root check declined, so any window of any
 * process — a browser on an EQ wiki, a chat client in an #everquest channel — was classified as
 * the game, took `eqFocused`, and handed the ring its own rectangle to draw in. A READABLE image
 * path is a positive answer to "whose window is this?", so once we have one the only thing that
 * can still make it EverQuest is the client's own image NAME. That keeps the case the fallback
 * was actually written for — a second install the app was never pointed at — while costing every
 * unrelated process its ability to impersonate the game by title.
 *
 * THE TITLE IS THE LAST RESORT, and only when the path is UNKNOWN (elevation, protected
 * processes: the watcher reports an empty path and there is nothing else to go on).
 *
 * (This app's own windows are titled "EQ Legends Companion" / "… Overlay" / "Cursor Ring" and
 * match none of it — and are classified by pid before they ever reach this predicate.)
 */
export function isEqWindow(w: { exePath: string; title: string }, eqRoot: string): boolean {
  const prefix = eqRootPrefix(eqRoot).toLowerCase()
  const exe = w.exePath.trim().toLowerCase()
  if (prefix && exe.startsWith(prefix)) return true
  if (exe) return EQ_CLIENT_EXES.has(exeBaseName(exe))
  return titleIsEqClient(w.title)
}

// ---------------------------------------------------------------- the focus debounce

/**
 * Alt-tab is not one transition, it is a burst of them: Windows briefly makes the task-switcher
 * (and sometimes the desktop shell) foreground on the way between two apps. Acting on the raw
 * signal would strobe every overlay off and back on. So the raw value must hold STILL for
 * `debounceMs` before it is committed.
 *
 * A state machine rather than a timer wrapper, so the decision is testable without clocks: the
 * caller supplies `now`, and re-runs the step when its own timer fires.
 */
export interface FocusDebounce {
  /** The value everyone downstream sees. */
  committed: boolean
  /** A different value we are waiting out, or null when the raw signal agrees with `committed`. */
  candidate: boolean | null
  /** When `candidate` was first observed. */
  since: number
}

export const FOCUS_DEBOUNCE_MS = 300

export function newFocusDebounce(committed = false): FocusDebounce {
  return { committed, candidate: null, since: 0 }
}

export interface FocusDebounceStep {
  state: FocusDebounce
  /** True exactly when `state.committed` differs from the input state's. */
  changed: boolean
  /** ms until this candidate would commit, or null when nothing is pending. */
  waitMs: number | null
}

/**
 * Fold one observation into the debounce. Idempotent for a steady signal (a repeated
 * observation that already matches `committed` clears any pending candidate and reports no
 * change), which is what makes it safe to call on every single watcher line.
 */
export function focusDebounceStep(
  state: FocusDebounce,
  observed: boolean,
  now: number,
  debounceMs = FOCUS_DEBOUNCE_MS
): FocusDebounceStep {
  if (observed === state.committed) {
    // The flap resolved back to where we already were: forget the candidate entirely.
    return { state: { ...state, candidate: null, since: 0 }, changed: false, waitMs: null }
  }
  const since = state.candidate === observed ? state.since : now
  if (now - since >= debounceMs) {
    return { state: { committed: observed, candidate: null, since: 0 }, changed: true, waitMs: null }
  }
  return {
    state: { ...state, candidate: observed, since },
    changed: false,
    waitMs: debounceMs - (now - since)
  }
}

// ------------------------------------------------------------------- the gating matrix

/**
 * Should the floating overlays be hidden right now? The two settings are independent and either
 * one can hide on its own — that is what "two toggles" means, and it is why this is not a
 * three-valued mode.
 *
 * With BOTH off this is always false: a user who wants none of it gets the pre-feature behavior
 * exactly, and (via `presenceNeeded`) never even starts the watcher.
 */
export function overlaysShouldHide(p: PresenceState, prefs: OverlayAutoHidePrefs): boolean {
  // NEVER HIDE ON A GUESS. Before the watcher's first line `eqRunning:false` means "we have not
  // looked yet", not "the game is closed" — and the child pays a one-time compile before it can
  // say otherwise. Acting on it would blink every overlay off at launch and back on a second
  // later on a machine where the game was running the whole time. Fail OPEN, always: the same
  // rule covers a watcher that died, which is why presence.ts resets this flag on exit.
  if (!p.observed) return false
  if (prefs.hideWhenNotRunning && !p.eqRunning) return true
  if (prefs.hideWhenUnfocused && !p.eqFocused) return true
  return false
}

/**
 * Should the cursor ring be on screen — and, identically, should main be streaming cursor
 * samples to it? ONE predicate for both, because "visible but not tracking" is a lagging ghost
 * ring and "tracking but not visible" is exactly the poll the performance contract exists to
 * avoid. Requires known bounds: the ring is sized and positioned to the EQ window, and there is
 * nowhere to put it until that window has been seen.
 *
 * A HIDDEN CURSOR IS NOT A CURSOR. EverQuest hides the pointer for the duration of mouselook and
 * re-centers it every frame, so `getCursorScreenPoint()` oscillates around a pointer that is not
 * on screen — the ring danced by itself. `cursorVisible` defaults true, so this narrows the
 * predicate only once the watcher has actually measured a hidden cursor.
 */
export function cursorRingActive(p: PresenceState, ring: CursorRingPrefs): boolean {
  return ring.enabled && p.eqFocused && p.cursorVisible && p.eqBounds !== null
}

// ------------------------------------------------------------------- the cadences
//
// THREE CLOCKS, AND THE ONLY ONE THAT MATTERS IS THE RATIO BETWEEN TWO OF THEM (JOS-120).
//
// `cursorVisible` is a GATE on an 8 ms consumer. The ring stops drawing when Windows stops
// drawing a pointer — and EverQuest stops drawing one the instant a mouse button goes down in
// the world view, while it re-centers the pointer every frame underneath. So the interesting
// number is not "how fast does the watcher poll", it is HOW MANY SAMPLES THE RING CAN PAINT
// FROM A POINTER THAT IS ALREADY GONE, and that is `gate latency / sampler period`.
//
// It used to be ~19. The whole loop — five user32 calls, a `Get-Process`, a string build and a
// compare — ran on ONE 150 ms tick, and the cursor check rode along with it, so a 100 ms click
// could pass without the gate ever looking. That is the reported twitch: for up to 150 ms the
// ring faithfully tracked a cursor nobody could see.
//
// The fix is not a faster loop, it is a SPLIT one. `CursorShowing()` is a single `GetCursorInfo`
// and costs essentially nothing, so it runs every tick at the platform's floor; the expensive
// foreground work keeps the cadence it has always had by running every Nth tick.
//
// MEASURED on this machine (20-25 s windows, `Get-Process.TotalProcessorTime`): the shipped
// single-cadence loop cost 0.06-0.16 % of one core; the split loop costs 0.19-0.31 %. That is
// the entire price — about 1.3 ms of CPU per second — and it buys a gate that closes inside one
// display frame instead of nine.

/**
 * The tick the watcher ASKS for, in ms. One, i.e. "the platform's floor" — the same request the
 * cursor sampler makes for the same reason.
 *
 * MEASURED: a `Start-Sleep -Milliseconds 1` loop in PowerShell actually turns every ~16 ms
 * (avg 15.96, max 31.65 over 25 s), because Windows' default timer quantum is 15.6 ms. Asking
 * for 1 is a request for whatever the platform will give, not a claim that it gives 1.
 */
export const WATCHER_TICK_MS = 1

/** What that request MEASURES at. Worst case is ~2x this — one missed quantum. */
export const WATCHER_TICK_FLOOR_MS = 16

/**
 * How many ticks between foreground/running/heartbeat scans. Ten ticks x ~16 ms ~= 160 ms, which
 * is the ~150 ms cadence this loop has always had: fine enough that alt-tab feels instant,
 * coarse enough that the expensive half of the loop is still effectively asleep.
 */
export const FOREGROUND_EVERY_TICKS = 10

/**
 * The cursor sampler's period (presenceEffects.ts's `setInterval`). It lives HERE, next to the
 * watcher's cadence, because neither number means anything without the other — see
 * `unguardedSamplesPerHiddenCursor`.
 *
 * Ask for 8 ms, i.e. "as fast as the platform will give us". MEASURED (Electron, 3x 30 s windows
 * on this machine): a `setInterval(8)` in Electron's main process actually fires ~64 times a
 * second, not 125 — the same 15.6 ms quantum, and Chromium does not raise the system timer
 * resolution for a main-process timer. The number stays 8: it is a request for the platform's
 * floor, and the renderer already coalesces to `requestAnimationFrame` and drops the surplus.
 */
export const CURSOR_POLL_MS = 8

/** Worst-case latency of the cursor-visibility gate: one tick that overran its quantum. */
export const CURSOR_GATE_LATENCY_MS = WATCHER_TICK_FLOOR_MS * 2

/**
 * THE DEFECT, AS A NUMBER. How many cursor samples the ring can still paint from a pointer the
 * game has already hidden and started re-centering — the gate's observation latency over the
 * sampler's period. Pure so `tests/presence.test.mts` can pin it instead of anyone re-deriving
 * it from two constants in two files.
 */
export function unguardedSamplesPerHiddenCursor(
  gateLatencyMs: number,
  samplerMs: number = CURSOR_POLL_MS
): number {
  if (samplerMs <= 0) return 0
  return Math.ceil(gateLatencyMs / samplerMs)
}

// ------------------------------------------------------------------- watcher health
//
// THE STATE IS ONLY AS GOOD AS THE STREAM THAT FEEDS IT. `PresenceState` is a CACHE of the last
// thing the watcher said, and every consumer treats it as current fact — so a stream that stops
// does not make the app cautious, it makes the app confidently wrong. The reported failure is
// the ring: `cursorRingActive` needs `eqFocused && cursorVisible && eqBounds`, all three of
// which SURVIVE a dead pipe, so a watcher that stops mid-game leaves a halo chasing the pointer
// across whatever the user alt-tabs to.
//
// Two things can stop the stream, and they need different answers:
//
//   * the child EXITS — observable directly (`'exit'`), handled in presence.ts.
//   * the child WEDGES — alive, pid intact, loop not advancing. Only the HEARTBEAT's absence
//     reveals it, which is what these two functions decide.
//
// Both are decided here, purely, so `tests/presence.test.mts` can pin them with an injected
// clock instead of a real 30-second wait.

/** Heartbeat cadence inside the child. Rides the existing 5 s process-existence poll. */
export const WATCHER_HEARTBEAT_MS = 5_000

/**
 * How long a silent pipe is tolerated before the watcher is declared wedged.
 *
 * SIX missed heartbeats. Deliberately generous: the cost of being wrong in one direction is a
 * needless respawn (a one-second PowerShell compile nobody sees), and in the other it is the
 * ring drawing over the user's browser until they quit the app. It still has to be a multiple,
 * not a margin — a machine that is swapping, or a game that just grabbed every core for a zone
 * load, can starve a 150 ms loop for several seconds without anything being wrong with it.
 */
export const WATCHER_STALE_MS = 30_000

/**
 * Has the watcher gone quiet long enough to be presumed wedged? `lastSignalAt` is the timestamp
 * of the last thing the child said OR of the spawn itself — a child that has never spoken is
 * given exactly the same window as one that has stopped, which is correct: the one-time
 * `Add-Type` compile means silence right after a spawn is normal and silence forever is not.
 */
export function watcherIsStale(
  lastSignalAt: number,
  now: number,
  staleMs: number = WATCHER_STALE_MS
): boolean {
  return now - lastSignalAt >= staleMs
}

/**
 * The respawn schedule, in ms, indexed by how many times in a row we have had to do it.
 *
 * CAPPED, and capped low enough to still be a recovery. A watcher can fail for a reason that is
 * never going to clear on this machine — PowerShell removed by policy, an execution policy that
 * kills the child on sight — and an uncapped retry against that is a spawn storm. It can also
 * fail for a reason that clears on its own in a second, which is why the first retry is fast.
 * The counter resets the moment a child produces a record, so an app that runs for eight hours
 * with one hiccup at hour three retries at 1 s, not at 30.
 */
export const WATCHER_RESTART_BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 15_000, 30_000]

/** The delay before restart attempt number `consecutiveFailures` (1-based); the last entry is
 *  the ceiling and every later failure sits on it. */
export function watcherRestartDelayMs(consecutiveFailures: number): number {
  const last = WATCHER_RESTART_BACKOFF_MS.length - 1
  const i = Number.isFinite(consecutiveFailures) ? Math.floor(consecutiveFailures) - 1 : 0
  return WATCHER_RESTART_BACKOFF_MS[Math.min(Math.max(i, 0), last)]
}

// ------------------------------------------------------------- the self-reap loop (JOS-164)
//
// A LOOP IS ONE FACT, AND IT WAS BEING REPORTED AS N FACTS. The error store's evidence for this
// ticket was 245+ copies of `presence watcher exited unexpectedly` from ONE install over two days,
// still climbing — one every ~32 s, forever, because the child was reaping itself about a second
// after each spawn and the backoff was sitting on its 30 s ceiling. Every one of those entries said
// the same thing, none of them said the interesting thing, and the interesting thing is only
// visible from the SHAPE of the sequence: a clean exit (code 0) that keeps happening far inside the
// staleness window is not a watcher that keeps failing, it is a watcher that keeps DECIDING to
// stop.
//
// So the parent recognizes the pattern and says it once. The first `WATCHER_SELF_REAP_STREAK - 1`
// exits are reported as they always were — a single fast clean exit really can be a one-off, and
// silencing it would trade this bug for a quieter one. The exit that completes the streak carries a
// DIFFERENT error name, which is what makes it a distinct fingerprint in the error store
// (`errorFingerprint` hashes the name and the frames, never the message), and every later exit in
// the same run is not logged at all until something breaks the pattern.
//
// Pure, and folded rather than counted in place, so `tests/presence.test.mts` drives the whole
// sequence — including the part that must NOT fire — without a child process anywhere.

/**
 * How many consecutive clean, sub-staleness-window exits it takes to call it a loop.
 *
 * THREE. It has to be more than one (a single fast exit is a one-off — PowerShell losing a race
 * with an antivirus scan, a machine mid-suspend — and reporting it is right) and more than two (two
 * in a row is a bad minute; the backoff's own first two steps are 1 s and 2 s, so two failures can
 * be inside three seconds of one hiccup). Three consecutive is the first count that can only be
 * produced by a condition that is not clearing, and it costs the store two ordinary entries before
 * the diagnosis instead of one — cheap, and those two are the exemplars a reader wants anyway. It
 * is deliberately NOT tuned against the observed 245: any N in this range collapses that to one.
 */
export const WATCHER_SELF_REAP_STREAK = 3

/**
 * The `name` the collapsed entry carries, and the whole reason it is a separate row in the error
 * store rather than a 246th copy of the old one. `shared/errorReport.ts errorFingerprint` hashes
 * the error NAME plus the top frames — never the message — so a distinct diagnosis needs a distinct
 * name, and `errorNameOf` accepts exactly this shape (identifier, ≤64 chars).
 */
export const SELF_REAP_LOOP_ERROR_NAME = 'PresenceSelfReapLoop'

/** What the watcher's exit trail knows: how long the current streak of self-reap-shaped exits is,
 *  and whether the one collapsed diagnosis has already been written for it. */
export interface WatcherExitTrail {
  readonly streak: number
  readonly collapsed: boolean
}

export const NEW_WATCHER_EXIT_TRAIL: WatcherExitTrail = { streak: 0, collapsed: false }

/** What the parent observed about one dead child. `reason` is the child's own last word
 *  (`X|parent-gone`) when it managed to say one, and null when it did not. */
export interface WatcherExitFacts {
  readonly code: number | null
  readonly lifetimeMs: number
  readonly reason: string | null
}

/** The payload `presence.ts` hands to `logError`, or null when this exit is inside a run that has
 *  already been diagnosed. Every field is here because a reader of errors.log asked for it. */
export interface WatcherExitLog {
  readonly message: string
  readonly code: number | null
  /** How long the child lived. The number that turns "it exited" into "it exited immediately". */
  readonly lifetimeMs: number
  readonly reason: string | null
  /** Set only on the collapsed entry — see `SELF_REAP_LOOP_ERROR_NAME`. */
  readonly name?: string
  /** Set only on the collapsed entry: how many exits in a row got us here. */
  readonly exits?: number
}

export interface WatcherExitStep {
  readonly trail: WatcherExitTrail
  readonly log: WatcherExitLog | null
}

/**
 * Is this exit SHAPED like a self-reap? Clean (code 0) and gone well inside the window a healthy
 * child is expected to be talking for. A non-zero code is PowerShell failing, which is a different
 * story and gets the ordinary report; an exit after a long healthy run is a watcher that was
 * running fine until it wasn't.
 */
function selfReapShaped(facts: WatcherExitFacts, staleMs: number): boolean {
  return facts.code === 0 && facts.lifetimeMs >= 0 && facts.lifetimeMs < staleMs
}

/**
 * Fold one dead child into the trail and say what to log.
 *
 * ANY exit that is not self-reap-shaped RESETS the trail — including a healthy child that finally
 * outlived the window — so a machine that hiccups once an hour never accumulates its way into the
 * collapsed state, and a machine that is fixed starts reporting normally again from the next
 * failure.
 */
export function watcherExitStep(
  trail: WatcherExitTrail,
  facts: WatcherExitFacts,
  streakToCollapse: number = WATCHER_SELF_REAP_STREAK,
  staleMs: number = WATCHER_STALE_MS
): WatcherExitStep {
  const base = { code: facts.code, lifetimeMs: facts.lifetimeMs, reason: facts.reason }
  if (!selfReapShaped(facts, staleMs)) {
    return {
      trail: NEW_WATCHER_EXIT_TRAIL,
      log: { message: 'presence watcher exited unexpectedly', ...base }
    }
  }
  // Already diagnosed: the pattern is unchanged, so there is nothing new to say. The streak is
  // held (not incremented) so the number can never run away on a session that lasts all day.
  if (trail.collapsed) return { trail, log: null }
  const streak = trail.streak + 1
  if (streak < streakToCollapse) {
    return {
      trail: { streak, collapsed: false },
      log: { message: 'presence watcher exited unexpectedly', ...base }
    }
  }
  return {
    trail: { streak, collapsed: true },
    log: {
      name: SELF_REAP_LOOP_ERROR_NAME,
      message:
        `presence watcher self-reap loop: ${String(streak)} consecutive clean exits inside the ` +
        `${String(staleMs)} ms staleness window. The child is deciding its parent is gone while ` +
        'this process is alive; overlay auto-hide and the cursor ring are dead for this session. ' +
        'Further identical exits are counted by the restart backoff, not logged.',
      exits: streak,
      ...base
    }
  }
}
