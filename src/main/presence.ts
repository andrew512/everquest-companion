// ============================================================================
// presence.ts — the WATCHER: one long-running child, and the state it maintains.
// ============================================================================
//
// Two features need the same four facts — is EQ running, is EQ the foreground window, where is
// that window, and is the system cursor being drawn — so they are answered ONCE, here:
//
//   * overlay AUTO-HIDE (hide the floating meters when the game isn't running / isn't focused)
//   * the CURSOR RING (a halo drawn only over the EQ window, only while it is focused)
//
// THE COST MODEL IS THE DESIGN. Windows has no cross-process "foreground window changed" event
// an Electron main process can subscribe to without native code, so somebody has to poll. The
// naive shape — `exec('powershell …')` on a timer — spawns a PROCESS per sample, and a
// PowerShell cold start is ~100 ms of CPU. At any useful cadence that is a permanent tax on a
// machine that is also running a game.
//
// So: ONE long-running child. It is spawned lazily (only when a feature that needs it is
// switched on — see `presenceNeeded` in shared/presencePrefs.ts), it polls in-process at
// ~150 ms, and it prints a line ONLY when something CHANGES. Steady state is a sleeping process
// and an idle pipe — near-zero CPU on both sides, and Node does no work at all between
// transitions. It is killed the moment the last consumer goes away. Never spawned in e2e
// (`EQ_E2E=1`) or off Windows.
//
// THE PURE HALF — the stdout line protocol, the EQ-window predicate, the alt-tab debounce and
// the gating matrix — lives in `presenceProtocol.ts` (the security.ts ↔ windows.ts split), which
// is what `tests/presence.test.mts` drives with no Electron in sight. `presenceEffects.ts` is
// what ACTS on any of it; this file only knows facts.

import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { E2E } from './e2e'
import { logError, logInfo } from './errorLog'
import { notePresenceRestart } from './telemetry'
import { effectiveEqRoot } from './log/config'
import {
  type PresenceRecord,
  type WatcherExitTrail,
  FOREGROUND_EVERY_TICKS,
  NEW_WATCHER_EXIT_TRAIL,
  WATCHER_HEARTBEAT_MS,
  WATCHER_STALE_MS,
  WATCHER_TICK_MS,
  eqRootPrefix,
  focusDebounceStep,
  isEqWindow,
  newFocusDebounce,
  parsePresenceLine,
  watcherExitStep,
  watcherIsStale,
  watcherRestartDelayMs
} from './presenceProtocol'
// The child's whole program lives in its own module so a node test can compile and run it; see
// that file's header for why (JOS-164).
import { watcherScript } from './presenceWatcherScript'
import { INITIAL_PRESENCE } from '../shared/presencePrefs'
import type { PresenceState, ScreenRect } from '../shared/presencePrefs'

// ------------------------------------------------------------------ the watcher child itself

/** Process-existence cadence. "Is the game running" changes twice a session. */
const RUNNING_POLL_MS = 5000

type Listener = (state: PresenceState) => void

/** stdin is 'ignore' (the script arrives base64 on the command line), stdout/stderr are pipes. */
type WatcherChild = ChildProcessByStdio<null, Readable, Readable>

const listeners = new Set<Listener>()
let child: WatcherChild | null = null
let stdoutTail = ''
let focus = newFocusDebounce(false)
let focusTimer: NodeJS.Timeout | null = null
let lastObservedFocus = false

// ---- watcher health (see presenceProtocol.ts's "watcher health" section for the WHY) --------
/** When the current child last said ANYTHING — seeded at spawn, so the one-time `Add-Type`
 *  compile is inside the first staleness window rather than a false positive against it. */
let lastSignalAt = 0
/** When the current child was spawned. Only a child that has outlived a full staleness window
 *  is allowed to forgive its predecessors' failures — see `noteSignal`. */
let childStartedAt = 0
/** Consecutive spawn/exit/wedge failures; indexes the backoff schedule. */
let restartFailures = 0
let restartTimer: NodeJS.Timeout | null = null
let staleTimer: NodeJS.Timeout | null = null
/** The current child's last word, if it managed one (`X|parent-gone`). Cleared at every spawn, so
 *  it can only ever describe the child whose exit is being handled. */
let lastExitReason: string | null = null
/** How many self-reap-shaped exits in a row, and whether the diagnosis has been written — the
 *  whole reason 245 identical error reports become three (presenceProtocol.ts, JOS-164). */
let exitTrail: WatcherExitTrail = NEW_WATCHER_EXIT_TRAIL

let state: PresenceState = INITIAL_PRESENCE

/** The presence facts as of the last watcher line. Defaults are "nothing seen yet". */
export function presenceSnapshot(): PresenceState {
  return state
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(state)
    } catch (err) {
      // One bad subscriber must not stop the others (or kill the stdout pump).
      logError('main:presence', err)
    }
  }
}

/** Commit a new state object and notify, but ONLY when something actually differs. */
function update(next: Partial<PresenceState>): void {
  const merged: PresenceState = { ...state, ...next }
  const same =
    merged.observed === state.observed &&
    merged.eqRunning === state.eqRunning &&
    merged.eqFocused === state.eqFocused &&
    merged.cursorVisible === state.cursorVisible &&
    sameRect(merged.eqBounds, state.eqBounds)
  if (same) return
  state = merged
  emit()
}

function sameRect(a: ScreenRect | null, b: ScreenRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Run the debounce for the current raw observation and schedule the wake-up that will commit it
 * if the signal holds. Called on every foreground line and from the timer it sets.
 */
function applyFocus(observed: boolean): void {
  lastObservedFocus = observed
  if (focusTimer) {
    clearTimeout(focusTimer)
    focusTimer = null
  }
  const step = focusDebounceStep(focus, observed, Date.now())
  focus = step.state
  if (step.changed) update({ eqFocused: focus.committed })
  else if (step.waitMs !== null) {
    focusTimer = setTimeout(() => {
      focusTimer = null
      applyFocus(lastObservedFocus)
    }, step.waitMs)
    // A watcher timer must never be the reason the app stays alive at quit.
    focusTimer.unref?.()
  }
}

/**
 * Fold one decoded record into the state.
 *
 * THE OWN-WINDOWS RULE lives here: a foreground window belonging to THIS process counts as
 * "EQ side". Every window this app creates (main, the five overlays, the ring) is owned by the
 * main process, so `pid === process.pid` identifies all of them at once — and that is what
 * makes "clicking your own overlay must not hide it" true by construction rather than by a list
 * of window handles somebody has to remember to extend.
 *
 * Bounds are updated ONLY for a genuine EQ window: our own windows are EQ-side for the FOCUS
 * question but they are not where the game is, and the ring must not jump onto them.
 */
function applyRecord(rec: PresenceRecord): void {
  // The heartbeat is LIVENESS, not an observation. It says the loop is turning, which is exactly
  // what `noteSignal` already recorded; it deliberately does not set `observed`, because a beat
  // is not a look at the world and must never be the reason auto-hide starts acting.
  if (rec.t === 'beat') return
  // Neither is the exit line: it is a note for the log the `'exit'` handler is about to write
  // (`pumpStdout` has already kept it) and says nothing about the world.
  if (rec.t === 'exit') return
  // ANY record means we have actually looked (the child emits a `C`, an `F` and an `R` on its
  // very first tick, in that order — the cursor check leads because it is the one that runs on
  // every tick, JOS-120; all three still land in the first tick's single write). Until then
  // `observed:false` keeps auto-hide from acting on a default that only looks like a fact — see
  // `overlaysShouldHide`.
  if (rec.t === 'run') {
    update({ observed: true, eqRunning: rec.running })
    return
  }
  if (rec.t === 'cursor') {
    update({ observed: true, cursorVisible: rec.visible })
    return
  }
  const ours = rec.pid === process.pid
  const isEq = !ours && isEqWindow(rec, effectiveEqRoot())
  update(isEq ? { observed: true, eqBounds: rec.rect } : { observed: true })
  applyFocus(isEq || ours)
}

/**
 * Note that the child is alive and talking. Any well-formed record counts, including a bare
 * heartbeat — the watchdog's question is "is the loop turning", not "did the world change".
 *
 * IT IS ALSO WHERE THE BACKOFF DEBT IS FORGIVEN, and the condition is the load-bearing part: a
 * child clears the counter only once it has run a FULL staleness window without going quiet.
 * Resetting on the first record instead would make a watcher that dies right after its first
 * line retry at 1 s forever — a spawn storm dressed up as a recovery.
 */
function noteSignal(): void {
  const now = Date.now()
  lastSignalAt = now
  if (restartFailures > 0 && now - childStartedAt >= WATCHER_STALE_MS) restartFailures = 0
}

/** Split the stdout stream into lines, carrying the partial tail across chunks. */
function pumpStdout(chunk: string): void {
  stdoutTail += chunk
  const lines = stdoutTail.split('\n')
  stdoutTail = lines.pop() ?? ''
  for (const line of lines) {
    const rec = parsePresenceLine(line)
    if (!rec) continue
    // KEPT, NOT LOGGED HERE. The pipe closes a moment later and the `'exit'` handler is the one
    // place that knows the code and the lifetime, so the reason waits there for its sentence.
    if (rec.t === 'exit') lastExitReason = rec.reason
    noteSignal()
    applyRecord(rec)
  }
}

/**
 * Fall back to "nothing known" and tell everyone.
 *
 * THIS IS THE WHOLE SAFETY PROPERTY, so it is worth stating what `INITIAL_PRESENCE` buys: with
 * `eqFocused:false` and `eqBounds:null` the ring PARKS (`cursorRingActive` needs both), and with
 * `observed:false` auto-hide fails OPEN and un-hides the overlays (`overlaysShouldHide`'s first
 * line). A presence source that has stopped being trustworthy must take the features it drives
 * with it — a frozen `eqFocused:true` is what left a halo chasing the pointer across the user's
 * browser, and a frozen `eqRunning:false` would hide every overlay forever.
 */
function resetPresence(): void {
  if (focusTimer) {
    clearTimeout(focusTimer)
    focusTimer = null
  }
  focus = newFocusDebounce(false)
  lastObservedFocus = false
  stdoutTail = ''
  if (state === INITIAL_PRESENCE) return
  state = INITIAL_PRESENCE
  emit()
}

/**
 * Unhook a child so nothing it does on the way out can move any state or fire any handler.
 *
 * A RETIRED CHILD STILL NEEDS AN `'error'` SINK, on the process and on both pipes. `'error'` is
 * not an ordinary event: an EventEmitter with no listener for it THROWS the payload, so removing
 * the handlers wholesale converts a failed `kill()` or a post-mortem EPIPE from a log line into
 * an uncaught exception in the main process. These sinks are terminal on purpose — this child is
 * already on its way out, and there is nothing left to do about it but say so.
 */
function detach(c: WatcherChild): void {
  const sink = (what: string) => (err: unknown) =>
    logError('main:presence', { message: `retired watcher child (${what})`, err })
  c.stdout.removeAllListeners()
  c.stderr.removeAllListeners()
  c.removeAllListeners('exit')
  c.removeAllListeners('error')
  c.on('error', sink('process'))
  c.stdout.on('error', sink('stdout'))
  c.stderr.on('error', sink('stderr'))
}

function clearStaleWatchdog(): void {
  if (!staleTimer) return
  clearInterval(staleTimer)
  staleTimer = null
}

/**
 * THE STALENESS WATCHDOG — the half of the fix that a dead-child handler cannot cover.
 *
 * A child that EXITS announces itself. A child that WEDGES — alive, pid intact, loop not
 * advancing (a blocked handle, a suspended process, a pipe nobody drained) — announces nothing
 * at all, and the only evidence is the heartbeat that stopped arriving. So: check the clock, and
 * when the pipe has been silent past `WATCHER_STALE_MS`, treat the child as gone. Reset FIRST
 * (the state has been wrong for thirty seconds already and the respawn takes another second),
 * then kill and restart on the same backoff an exit uses.
 *
 * The interval exists only while a child does, and is unref'd: it can never be the reason the
 * app stays alive at quit.
 */
function armStaleWatchdog(): void {
  clearStaleWatchdog()
  staleTimer = setInterval(() => {
    const c = child
    if (!c || !watcherIsStale(lastSignalAt, Date.now())) return
    logError('main:presence', {
      message: 'presence watcher went silent; assuming it is wedged and restarting',
      silentMs: Date.now() - lastSignalAt
    })
    child = null
    clearStaleWatchdog()
    detach(c)
    c.kill()
    resetPresence()
    restartFailures++
    scheduleRestart()
  }, WATCHER_HEARTBEAT_MS)
  staleTimer.unref?.()
}

/**
 * Bring the watcher back after a failure, on a capped backoff.
 *
 * Not restarting at all was the old behavior and it is a silent, permanent feature outage: the
 * state reset made the app SAFE (overlays back, ring parked) but nothing ever looked at the game
 * again for the rest of the session. Both consumers are supposed to be always-on.
 *
 * The `listeners.size` check is what makes this respect the ref-count: a restart scheduled a
 * moment before the user turns the last feature off must not spawn a child nobody wants.
 */
function scheduleRestart(): void {
  if (restartTimer || listeners.size === 0) return
  // COUNTED WHERE THE RESTART IS COMMITTED TO (JOS-96), after the guard rather than before it: a
  // call that is refused because a restart is already pending, or because nobody is listening any
  // more, did not restart anything and must not read as a health event. All three restart causes
  // (the stale-child watchdog, the child-gone handler, a failed spawn) funnel through here, so
  // this is the one increment site. `restartFailures` cannot serve — it is a backoff index that
  // resets to 0 on a healthy child.
  notePresenceRestart()
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (listeners.size === 0 || child) return
    startWatcher()
  }, watcherRestartDelayMs(restartFailures))
  restartTimer.unref?.()
}

/**
 * The one path off the child, for every way it can end: a clean exit, a crash, a spawn that
 * never happened, and the watchdog's kill. Idempotent by identity — `child !== proc` means this
 * one has already been retired (or replaced), so a late `'exit'` after an `'error'` is a no-op
 * rather than a second restart.
 *
 * WHAT IT SAYS ABOUT THE EXIT IS `watcherExitStep`'S CALL (JOS-164), and both halves of that
 * matter. The LIFETIME rides along with the code, because "exited with 0" and "exited with 0 after
 * 900 ms, again" are different facts and only the second one is a diagnosis; and a run of those is
 * collapsed into ONE distinctly-named error rather than one entry per restart forever. The
 * fold is pure and lives beside the protocol, so the whole sequence is a unit test.
 */
function handleChildGone(proc: WatcherChild, code: number | null): void {
  if (child !== proc) return
  child = null
  clearStaleWatchdog()
  detach(proc)
  const lifetimeMs = Date.now() - childStartedAt
  const reason = lastExitReason
  lastExitReason = null
  // An exit while consumers remain is a real failure (the script threw, PowerShell is missing, or
  // the child decided we were gone). Report it, fall back to "nothing known", and try again on
  // the backoff. With no consumers left there is nothing to report and nothing to restart, and
  // the trail is deliberately left alone: a teardown is not evidence either way.
  if (listeners.size === 0) return
  const step = watcherExitStep(exitTrail, { code, lifetimeMs, reason })
  exitTrail = step.trail
  if (step.log) logError('main:presence', step.log)
  resetPresence()
  restartFailures++
  scheduleRestart()
}

/**
 * Strip PowerShell's CLIXML framing out of a stderr chunk.
 *
 * MEASURED, not defensive: a `-EncodedCommand` child writes a `#< CLIXML` preamble (and, when
 * anything touches the error stream, an `<Objs …>…</Objs>` envelope) to stderr on a perfectly
 * healthy run. Logging that verbatim would put a junk `[everquest-companion:error]` line in
 * errors.log every time the watcher starts — and errors.log is the FIRST place anyone looks
 * when something is weird, so filling it with noise from a component that is working is a real
 * cost. What remains after the framing is stripped is a genuine failure and is logged.
 */
function cleanWatcherStderr(text: string): string {
  return text
    .replace(/#<\s*CLIXML/g, '')
    .replace(/<Objs[\s\S]*?<\/Objs>/g, '')
    .replace(/<Objs[^>]*\/>/g, '')
    .trim()
}

function startWatcher(): void {
  if (child || E2E || process.platform !== 'win32') return
  const script = watcherScript(
    eqRootPrefix(effectiveEqRoot()),
    {
      runningPollMs: RUNNING_POLL_MS,
      tickMs: WATCHER_TICK_MS,
      foregroundEveryTicks: FOREGROUND_EVERY_TICKS
    },
    // Baked in so the child can reap ITSELF when this process dies without running its quit path
    // (a crash, or a force-kill of the tree). Windows orphans children rather than killing them.
    process.pid
  )
  let proc: WatcherChild
  try {
    proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (err) {
    logError('main:presence', { message: 'could not start the presence watcher', err })
    // A spawn that throws is as much a failure as one that exits, and it is the one most likely
    // to be transient (a momentarily unavailable powershell.exe). Back off and try again.
    restartFailures++
    scheduleRestart()
    return
  }
  child = proc
  childStartedAt = Date.now()
  // Seed the silence clock at the spawn, not at the first line: the child pays a one-time
  // `Add-Type` compile before it can say anything, and that quiet second is normal.
  lastSignalAt = childStartedAt
  logInfo('[everquest-companion] presence watcher started')
  stdoutTail = ''
  lastExitReason = null
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', pumpStdout)
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (text: string) => {
    const message = cleanWatcherStderr(text)
    if (message) logError('main:presence', { stderr: message.slice(0, 500) })
  })
  proc.on('error', (err) => {
    logError('main:presence', err)
    handleChildGone(proc, null)
  })
  proc.on('exit', (code) => handleChildGone(proc, code))
  armStaleWatchdog()
}

function stopWatcher(): void {
  if (focusTimer) {
    clearTimeout(focusTimer)
    focusTimer = null
  }
  clearStaleWatchdog()
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  // A deliberate stop is not a failure — the next start deserves a clean slate, including the
  // self-reap trail: whatever the last run was doing, the next one gets to report it fresh.
  restartFailures = 0
  exitTrail = NEW_WATCHER_EXIT_TRAIL
  lastExitReason = null
  const c = child
  child = null
  if (!c) return
  detach(c)
  c.kill()
  logInfo('[everquest-companion] presence watcher stopped')
  state = INITIAL_PRESENCE
  focus = newFocusDebounce(false)
  lastObservedFocus = false
  stdoutTail = ''
}

/**
 * Subscribe to presence. REF-COUNTED: the first subscriber starts the child, the last one to
 * unsubscribe kills it. That is the whole "lazy" contract — with the ring off and both
 * auto-hide switches at a state that needs no watcher, nothing is ever spawned.
 *
 * The callback fires on every CHANGE (never on a repeat), and once immediately with whatever is
 * already known, so a late subscriber needs no separate hydration path.
 */
export function subscribePresence(cb: Listener): () => void {
  listeners.add(cb)
  if (listeners.size === 1) startWatcher()
  cb(state)
  let released = false
  return () => {
    if (released) return
    released = true
    listeners.delete(cb)
    if (listeners.size === 0) stopWatcher()
  }
}

/** Tear the watcher down regardless of subscribers (app quit). */
export function stopPresence(): void {
  listeners.clear()
  stopWatcher()
}

/** TEST/diagnostic seam: is a watcher child alive right now? */
export function presenceWatcherRunning(): boolean {
  return child !== null
}
