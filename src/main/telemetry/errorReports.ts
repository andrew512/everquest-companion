// ============================================================================
// telemetry/errorReports.ts — turn a caught error into a reportable one (JOS-100).
// ============================================================================
//
// `health.ts` counts that something broke. This turns the SAME event into something a person
// could fix from: which error, at which bundle position, after which parser events, in which
// view, how far into the session, and how many times.
//
// ---------------------------------------------------------------------------------------
// WHERE IT IS FED FROM, AND WHY THERE
// ---------------------------------------------------------------------------------------
// `errorLog.ts logError` — the ONE funnel every main-process error append already passes
// through, and the same line `noteErrorLogLine()` is bumped on. Everything lands there:
//   * `main:uncaughtException` / `main:unhandledRejection` (crashGuards.ts),
//   * `renderer:ErrorBoundary`, `renderer:onerror`, `renderer:unhandledrejection` (the
//     `error:report` IPC in ipc/windowControls.ts, which the renderer's own handlers feed),
//   * `main:render-process-gone`, `main:did-fail-load`, `main:preload-error` (windowErrors.ts).
// One capture point rather than six is the same argument JOS-96 made for `mainErrorLogLines`:
// a producer that has to be remembered at each of six sites is a producer that will be
// forgotten at the seventh.
//
// IT MUST NOT IMPORT `collector.ts`. `collector` imports `errorLog`, and `errorLog` imports
// THIS — so reaching for `recordEvent`, `sessionUptimeMs` or the store from here would close
// the cycle `errorLog → errorReports → collector → errorLog`, on the app's error path, which is
// the single worst place in the process to find a module-init order bug (health.ts's header
// says the same thing about the same cycle). Hence:
//   * the session clock is kept HERE, stamped by `resetErrorReports(now)` from the collector's
//     own session boundaries, rather than read from the collector;
//   * nothing here transmits. Reports are held in memory and leave only through `recordEvent`,
//     which flush.ts calls at drain time and which is THE gate — the user's switch is checked
//     there and nowhere else, exactly as it is for every other event.
//
// ---------------------------------------------------------------------------------------
// ONE EXEMPLAR PER FINGERPRINT PER SESSION
// ---------------------------------------------------------------------------------------
// The first occurrence of a fingerprint keeps its message, frames and breadcrumbs. Every repeat
// adds to a count. A render loop that throws ten thousand times is ONE ring record carrying
// `count: 10000`, not ten thousand records that would blow the 500-entry ring and take every
// other counter in it out with them.
//
// The PENDING count is a delta drained by whichever session report fires first, exactly like
// `linesPending` and the health counters: no double counting, and a killed session loses at
// most its last window. The EXEMPLAR is kept across drains, so a fingerprint that fires again
// after a heartbeat re-sends the same stack with the new count — and the server's UPSERT is
// first-wins, so that is idempotent by construction rather than by agreement.

import {
  errorCodeOf,
  errorFingerprint,
  errorNameOf,
  parseStackFrames,
  redactMessage
} from '../../shared/errorReport'
import {
  bucketOf,
  MAX_SESSION_FINGERPRINTS,
  SESSION_AGE_MS_EDGES,
  TELEMETRY_BREADCRUMB_KINDS,
  TELEMETRY_ERROR_VIEWS,
  type EvErrorReport,
  type TelemetryBreadcrumb,
  type TelemetryBreadcrumbKind,
  type TelemetryErrorView
} from '../../shared/telemetry'
import { currentMode, readBreadcrumbs, resetBreadcrumbs } from './breadcrumbs'

/**
 * The ring's crumbs, narrowed onto the wire's closed enum.
 *
 * `breadcrumbs.ts` types its `kind` as a bare `string` because it may not import the enum — it
 * has to stay import-free to be callable from `LogBus.emit` — so the narrowing happens HERE,
 * at the one boundary where the two meet. It is a real FILTER and not a cast: every value it
 * sees today is a `LogEventKind` and so is a member, but a kind added to the parser and
 * forgotten in the duplicated wire list would otherwise fail the whole event at the validator
 * and take a real crash report down with it. Dropping one crumb is the cheaper failure, and
 * `tests/errorReportContract.test.mts` pins the two lists equal so it should never happen.
 */
function wireCrumbs(): TelemetryBreadcrumb[] {
  const known = TELEMETRY_BREADCRUMB_KINDS as readonly string[]
  return readBreadcrumbs()
    .filter((c) => known.includes(c.kind))
    .map((c) => ({ kind: c.kind as TelemetryBreadcrumbKind, offsetMs: c.offsetMs }))
}

/** The exemplar plus its undrained count. `report.count` is filled in at drain time. */
interface Pending {
  exemplar: Omit<EvErrorReport, 'count'>
  n: number
}

const pending = new Map<string, Pending>()
let sessionStartedAt = 0
let currentView: TelemetryErrorView = 'unknown'

/**
 * WHICH TAB IS OPEN, as the renderer last stated it.
 *
 * It comes from the renderer because that is the only process that knows. A MAIN-process error
 * therefore reports the last view a window mentioned, or `unknown` before any has — which is
 * why `unknown` is in the enum at all. Guessing `overview` because it is the default would put
 * a made-up value in the one column a reader would use to decide where to look.
 *
 * The value is checked against the closed enum HERE and not merely at the wire, because it
 * arrives over IPC from an untrusted renderer and is stored between calls: an unchecked one
 * would sit in this variable poisoning every LATER report, including main-process ones the
 * renderer had nothing to do with.
 */
export function noteCurrentView(view: unknown): void {
  if (typeof view !== 'string') return
  if (!(TELEMETRY_ERROR_VIEWS as readonly string[]).includes(view)) return
  currentView = view as TelemetryErrorView
}

/**
 * What `logError` hands over. Deliberately NOT `Error`: the renderer's IPC report is a plain
 * object, `unhandledRejection` can carry anything at all, and `throw 42` is legal JavaScript.
 * Every field is read defensively and every one has an honest fallback.
 */
export interface CaughtError {
  name?: unknown
  message?: unknown
  stack?: unknown
  code?: unknown
}

/** Pull the four fields out of whatever was actually thrown. */
function fieldsOf(payload: unknown): CaughtError {
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack,
      // Node hangs `code` off the error object; it is not on the `Error` type.
      code: (payload as unknown as { code?: unknown }).code
    }
  }
  if (typeof payload === 'object' && payload !== null) return payload
  // A thrown string or number is its own message and has nothing else.
  return { message: typeof payload === 'string' ? payload : String(payload) }
}

/**
 * RECORD ONE CAUGHT ERROR. Never throws — it is called from inside `logError`, which is itself
 * called from inside `catch` blocks and from process-level crash handlers. An exception here
 * would turn a logged error into an unlogged crash, so the whole body is guarded.
 *
 * `source` is the tag `logError` already uses (`main:uncaughtException`, `renderer:ErrorBoundary`,
 * …). It is NOT sent: it is free text by nature, and the frames say where far better. It is
 * taken only so this function can refuse the one source that would be circular.
 */
export function noteError(source: string, payload: unknown, now = Date.now()): void {
  try {
    // A failure INSIDE the error-log writer must not mint a report about the error-log writer,
    // on the path that is already failing to write. `errorLog.ts` tags that line `[errorLog]`.
    if (source.includes('errorLog')) return
    const f = fieldsOf(payload)
    const frames = parseStackFrames(f.stack)
    const errorName = errorNameOf(f.name)
    const fingerprint = errorFingerprint(errorName, frames)
    const held = pending.get(fingerprint)
    if (held) {
      held.n += 1
      return
    }
    // THE STORM BOUND. A session that has already produced this many DISTINCT issues is a
    // session where something is badly wrong, and the twenty-first fingerprint is not the one
    // that explains it. Repeats of a fingerprint already held still count (the branch above),
    // so the cap limits distinct exemplars and never the totals of what is already tracked.
    if (pending.size >= MAX_SESSION_FINGERPRINTS) return
    const code = errorCodeOf(f.code)
    const exemplar: Omit<EvErrorReport, 'count'> = {
      t: 'errorReport',
      errorName,
      redactedMessage: redactMessage(f.message),
      frames,
      fingerprint,
      breadcrumbs: wireCrumbs(),
      view: currentView,
      sessionAgeBucket: bucketOf(sessionAgeMs(now), SESSION_AGE_MS_EDGES),
      mode: currentMode()
    }
    if (code !== undefined) exemplar.code = code
    pending.set(fingerprint, { exemplar, n: 1 })
  } catch {
    // A telemetry producer is never worth an app failure, and this one runs on the error path.
  }
}

function sessionAgeMs(now: number): number {
  return sessionStartedAt === 0 ? 0 : Math.max(0, now - sessionStartedAt)
}

/**
 * Drain the reports for one session report. Returns one event per fingerprint that has fired
 * SINCE THE LAST DRAIN, with its accumulated count; the exemplar stays behind so a later
 * recurrence re-sends the same stack (the server's UPSERT is first-wins, so that is free).
 *
 * A fingerprint with nothing pending yields NOTHING — unlike `takeHealth`, which always
 * reports. The difference is deliberate and is the same reasoning read from the other side:
 * `healthCounters` is written even when zero BECAUSE the report itself is the per-version
 * "this build can report" signal, and `healthReports` is the denominator every rate is divided
 * by. That denominator already exists, so an empty errorReport would add a record to the ring
 * every five minutes to say nothing that `healthReports` does not already say.
 */
export function takeErrorReports(): EvErrorReport[] {
  const out: EvErrorReport[] = []
  for (const held of pending.values()) {
    if (held.n <= 0) continue
    out.push({ ...held.exemplar, count: held.n })
    held.n = 0
  }
  return out
}

/**
 * Drop everything, including the breadcrumb ring. Called from the collector's session
 * boundaries beside `resetHealth()` — a switch turned off must not leave a session's errors
 * waiting to be reported if it is turned back on, and the crumbs that would have travelled with
 * them are the same data.
 */
export function resetErrorReports(now = Date.now()): void {
  pending.clear()
  sessionStartedAt = now
  currentView = 'unknown'
  resetBreadcrumbs()
}

/** The undrained reports, for tests and for nothing else. Never sent. */
export function peekErrorReports(): { fingerprint: string; n: number }[] {
  return [...pending.entries()].map(([fingerprint, held]) => ({ fingerprint, n: held.n }))
}
