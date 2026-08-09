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
  redactMessage,
  type ErrorFrame
} from '../../shared/errorReport'
import {
  caughtFields,
  fingerprintFallback,
  parseComponentPath,
  parseExternalFrames,
  type CaughtFields
} from '../../shared/errorReportLocation'
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
 *
 * The read itself lives in `shared/errorReportLocation.ts` (`caughtFields`), because since
 * JOS-111 it also FOLLOWS NESTED ERRORS — `logError('main:preload-error', { preloadPath, error })`
 * carries a real stack one property down — and that unwrap is pure, adversarial, and worth
 * driving from a test with no Electron in the process.
 */
export type CaughtError = CaughtFields

/**
 * WHERE THIS ERROR HAPPENED, in the order that prefers the truest answer (JOS-111).
 *
 * 1. THE THROW'S OWN BUNDLE FRAMES. Everything below is only reached when there are none.
 * 2. THE CAPTURE SITE, synthesised from a stack `logError` took at its own call site. A forwarded
 *    renderer console error is `{ level, message, source }` and never had a stack; the app still
 *    knows which of its eighty-odd `logError` calls the report came out of, and those are
 *    different issues. It is labelled `capture` so it is never read as a throw site.
 * 3. NOTHING, and the fingerprint's fallback (below) is what stops that colliding.
 *
 * `externalFrames` is independent of all three: a stack can carry Node/Electron/dependency frames
 * whether or not it carries ours, and they are worth having either way.
 */
interface Location {
  frames: ErrorFrame[]
  external: ErrorFrame[]
  origin: 'thrown' | 'capture'
}

function locate(stack: unknown, captureSite: (() => string) | undefined): Location {
  const external = parseExternalFrames(stack)
  const frames = parseStackFrames(stack)
  if (frames.length > 0 || captureSite === undefined) {
    return { frames, external, origin: 'thrown' }
  }
  const site = parseStackFrames(captureSite())
  return site.length > 0
    ? { frames: site, external, origin: 'capture' }
    : { frames, external, origin: 'thrown' }
}

/**
 * RECORD ONE CAUGHT ERROR. Never throws — it is called from inside `logError`, which is itself
 * called from inside `catch` blocks and from process-level crash handlers. An exception here
 * would turn a logged error into an unlogged crash, so the whole body is guarded.
 *
 * `source` is the tag `logError` already uses (`main:uncaughtException`, `renderer:ErrorBoundary`,
 * …). It is NOT sent: it is free text by nature, and the frames say where far better. It is
 * taken only so this function can refuse the one source that would be circular.
 *
 * `captureSite` IS A THUNK AND IS CALLED AT MOST ONCE, only when the payload turned out to carry
 * no bundle frames of its own. Capturing a stack is the expensive part of this function and the
 * overwhelming majority of errors do not need it, so the cost is paid by the reports that would
 * otherwise have had no location at all. `errorLog.ts` supplies it; a direct caller (the tests,
 * and nothing else) may leave it out, in which case step 2 above simply does not happen.
 */
export function noteError(
  source: string,
  payload: unknown,
  now = Date.now(),
  captureSite?: () => string
): void {
  try {
    // A failure INSIDE the error-log writer must not mint a report about the error-log writer,
    // on the path that is already failing to write. `errorLog.ts` tags that line `[errorLog]`.
    if (source.includes('errorLog')) return
    const f = caughtFields(payload)
    const where = locate(f.stack, captureSite)
    const errorName = errorNameOf(f.name)
    const redactedMessage = redactMessage(f.message)
    // The fallback is read only when `where.frames` is empty (errorFingerprint says why), so a
    // report that HAS frames hashes exactly what it hashed before this ticket and keeps the
    // identity the error store already knows it by.
    const fingerprint = errorFingerprint(
      errorName,
      where.frames,
      fingerprintFallback(where.external, redactedMessage)
    )
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
    pending.set(fingerprint, {
      exemplar: exemplarOf({ errorName, redactedMessage, fingerprint }, where, f, now),
      n: 1
    })
  } catch {
    // A telemetry producer is never worth an app failure, and this one runs on the error path.
  }
}

/** The three values `noteError` has already computed and would otherwise pass one by one — the
 *  parameter that keeps `exemplarOf` inside the repo's four. */
interface Identity {
  errorName: string
  redactedMessage: string
  fingerprint: string
}

/**
 * THE EXEMPLAR. Every OPTIONAL field is set only when it has something to say, which is the wire
 * contract read from the producer's side: a field that is absent costs an older server nothing,
 * and a field that is present is one the reader can trust to mean something.
 */
function exemplarOf(
  id: Identity,
  where: Location,
  f: CaughtFields,
  now: number
): Omit<EvErrorReport, 'count'> {
  const exemplar: Omit<EvErrorReport, 'count'> = {
    t: 'errorReport',
    errorName: id.errorName,
    redactedMessage: id.redactedMessage,
    frames: where.frames,
    fingerprint: id.fingerprint,
    breadcrumbs: wireCrumbs(),
    view: currentView,
    sessionAgeBucket: bucketOf(sessionAgeMs(now), SESSION_AGE_MS_EDGES),
    mode: currentMode()
  }
  const code = errorCodeOf(f.code)
  if (code !== undefined) exemplar.code = code
  // Stated whenever there are frames to describe. A report with none says nothing about their
  // origin rather than claiming one, which is also what an exemplar from an older client means.
  if (where.frames.length > 0) exemplar.frameOrigin = where.origin
  if (where.external.length > 0) exemplar.externalFrames = where.external
  // BOTH CARRIERS, because the ErrorBoundary reports itself twice by design: over the `error:report`
  // IPC, where the marked component stack is appended to `stack`, and through `console.error`,
  // where the console forwarder's payload has no `stack` field at all and the whole line arrives
  // as `message`. Same marker, same parser, so neither path is the one that quietly does not work.
  const componentPath = parseComponentPath(f.stack) ?? parseComponentPath(f.message)
  if (componentPath !== undefined) exemplar.componentPath = componentPath
  return exemplar
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
