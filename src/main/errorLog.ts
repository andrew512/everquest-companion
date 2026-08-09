import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
// TWO LEAF MODULES, and their leaf-ness is what makes these imports safe on the error path:
// `telemetry/collector.ts` imports THIS file (`logInfo`), so anything that lived there would
// close the cycle errorLog → collector → errorLog. `health.ts` imports nothing at all;
// `errorReports.ts` imports only pure `shared/` code and its own sibling ring. See the headers
// of both for the full argument.
import { noteErrorLogLine, noteSuppressedErrorLine } from './telemetry/health'
import { noteError } from './telemetry/errorReports'
// A THIRD LEAF, same argument (JOS-133): `errorRepeat.ts` imports nothing at all, so the repeat
// cap cannot close a cycle on the error path. Its header carries the whole rule.
import { errorRepeat } from './errorRepeat'

/**
 * Tiny append-only error logger. Every captured error (main-process crashes,
 * renderer window.onerror, React ErrorBoundary, forwarded renderer console
 * errors, failed loads, dead render processes) funnels through here so a BLANK
 * WINDOW is never silent again.
 *
 * Writes to BOTH sinks:
 *   (a) `<userData>/errors.log` — a durable file agents/devs can read after the
 *       fact (truncated at ~1MB to stay small; we keep it dead simple).
 *   (b) `console.error` with the grep-able `[everquest-companion:error]` prefix so the
 *       `electron-vite dev --watch` stdout captures it live for agents.
 */

const MAX_LOG_BYTES = 1_000_000 // ~1MB — rotate by truncation past this.
const PREFIX = '[everquest-companion:error]'

/**
 * THE CAPTURE SITE, as a stack (JOS-111) — a location for the reports that have none.
 *
 * Most of what reaches this function has a stack of its own. A good deal does not and never did:
 * a forwarded renderer console message is `{ level, message, source }`, a failed load is four
 * fields about a URL, a rejected string is a string. Those used to reach the error report with an
 * empty frame list, which made every one of them the SAME fingerprint — `hash('Error')` — so the
 * loudest issues in the fleet were a single row nobody could act on.
 *
 * `Error.captureStackTrace(holder, logError)` is what makes this honest AND cheap to reason about:
 * V8 drops every frame up to and INCLUDING `logError`, so the top frame is the caller — the real
 * capture site — with no fixed depth to count and nothing to re-tune when a helper is inserted.
 * It is not the throw site and the report never says it is (`frameOrigin: 'capture'`).
 *
 * It is a THUNK because `noteError` calls it only when the payload turned out to have no bundle
 * frames of its own. Capturing a stack is the expensive part; the common error pays nothing.
 */
function captureSite(): string {
  const holder: { stack?: string } = {}
  Error.captureStackTrace(holder, logError)
  return holder.stack ?? ''
}

let cachedPath: string | null = null

/** Resolve (and memoize) `<userData>/errors.log`, creating userData if needed. */
function logPath(): string {
  if (cachedPath) return cachedPath
  const dir = app.getPath('userData')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // userData almost always exists; ignore if the mkdir races/fails.
  }
  cachedPath = join(dir, 'errors.log')
  return cachedPath
}

/** Best-effort JSON stringify that survives Errors and circular refs. */
function stringifyPayload(payload: unknown): string {
  if (payload instanceof Error) {
    return `${payload.name}: ${payload.message}\n${payload.stack ?? '(no stack)'}`
  }
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, replacer())
  } catch {
    return String(payload)
  }
}

/** JSON replacer that unwraps nested Error objects and drops circular refs. */
function replacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet()
  return (_key, value) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack }
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

/**
 * Log an error to the file + console. `source` is a short tag (e.g.
 * `main:uncaughtException`, `renderer:onerror`, `renderer:console`) so lines are
 * greppable by origin. Never throws — logging must not itself crash the app.
 *
 * REPEATS ARE CAPPED (JOS-133): the first `MAX_IDENTICAL_ERROR_LINES` copies of one identical
 * line are written as always, then one notice replaces the next, and everything after it is a
 * count on the health rollup rather than a line. See `./errorRepeat.ts`.
 */
export function logError(source: string, payload: unknown): void {
  const ts = new Date().toISOString()
  const body = stringifyPayload(payload)

  // THE ERROR REPORT (JOS-100), built from the STRUCTURED payload rather than from `body` — the
  // frames and the code are still objects here and are strings by the next line. It is taken
  // BEFORE the file write, unlike `noteErrorLogLine` below, and the two orderings are both
  // deliberate: that counter means "lines in this fleet's error logs" and so must not count a
  // write that threw, while a report is about the ERROR and is worth having whether or not the
  // disk cooperated. `noteError` cannot throw (its whole body is guarded) and cannot re-enter
  // this function.
  //
  // THE CAPTURE SITE RIDES ALONG AS A THUNK (JOS-111): a payload with no stack of its own gets one
  // synthesised from THIS call site, which is the difference between eighty-odd frameless sources
  // sharing one fingerprint and each of them being its own issue. See `captureSite` above.
  noteError(source, payload, Date.now(), captureSite)

  // THE REPEAT CAP (JOS-133), between the report and the sinks, and in that order for a reason:
  // the ERROR REPORT above is unaffected — it has its own per-fingerprint dedupe with an honest
  // `count` — so capping what the disk holds never costs the fleet a single observation. What is
  // capped is the two SINKS, together: a dev watching stdout is reading the same flood a reader
  // of errors.log is, and one rule for both is what keeps them describing the same file.
  //
  // A suppressed occurrence is COUNTED (`suppressedErrorLines`), so
  // `mainErrorLogLines + suppressedErrorLines` is still exactly how many times this happened.
  // `errorRepeat` imports nothing and cannot throw; see its header for the whole rule.
  const repeat = errorRepeat(source, body)
  if (repeat.suppressed) noteSuppressedErrorLine()
  if (!repeat.write && repeat.notice === null) return
  // The notice names its own source, so it is written WITHOUT the `[source]` tag the payload
  // lines carry — the tag would say the same thing twice on the one line that already explains
  // itself. Everything else about the line (timestamp, prefix, grep-ability) is identical.
  const line = repeat.write ? `${ts} ${PREFIX} [${source}] ${body}\n` : `${ts} ${PREFIX} ${repeat.notice}\n`

  // (b) console.error first — cheapest, always reaches dev stdout even if the
  // file write fails (e.g. app not ready yet).
  if (repeat.write) {
    // eslint-disable-next-line no-console
    console.error(PREFIX, `[${source}]`, body)
  } else {
    // eslint-disable-next-line no-console
    console.error(PREFIX, repeat.notice)
  }

  // (a) durable file, with lazy truncation-based rotation.
  try {
    const path = logPath()
    try {
      if (statSync(path).size > MAX_LOG_BYTES) {
        writeFileSync(path, `${ts} ${PREFIX} [errorLog] log truncated at ~1MB\n`)
      }
    } catch {
      // File doesn't exist yet — appendFileSync will create it.
    }
    appendFileSync(path, line)
    // COUNT THE LINE THAT WAS ACTUALLY WRITTEN (JOS-96), after the append rather than before it:
    // `mainErrorLogLines` is meant to be readable as "lines in this fleet's error logs", so a
    // write that threw must not be counted as one. `noteErrorLogLine` is a plain integer add in a
    // module that imports nothing (telemetry/health.ts says why), so it cannot throw and cannot
    // re-enter this function. The one-off repeat NOTICE is counted too, and correctly: it is a
    // line that really was written, and there is at most one per distinct failure per session.
    noteErrorLogLine()
  } catch (err) {
    // Last resort: don't let a logging failure become a new uncaught error.
    // eslint-disable-next-line no-console
    console.error(PREFIX, '[errorLog] failed to write errors.log', err)
  }
}

/** Absolute path of the error log, for diagnostics/tests. */
export function errorLogPath(): string {
  return logPath()
}

// ---- info/warn narration (console-only) ------------------------------------
//
// The main process narrates its startup and lifecycle to dev stdout with the
// `[everquest-companion]` prefix (channel + userData, spell-DB sizes, the tailed character,
// replay totals, inventory reloads…). Those lines are NOT errors and deliberately do NOT go
// into errors.log — that file exists so a blank window is never silent, and burying it under
// routine progress would defeat it.
//
// They funnel through here anyway so that ONE module in src/main owns the console (this one),
// which is what lets `no-console` stay on everywhere else instead of decaying into a
// disable-comment per call site. Nothing is prefixed, tagged or reformatted on the way
// through: the arguments reach `console.*` exactly as the caller wrote them, so the emitted
// text is byte-identical to a direct call.

/** `console.log`, verbatim. Routine `[everquest-companion] …` narration. */
export function logInfo(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args)
}

/** `console.warn`, verbatim. A condition worth noticing that is not a failure. */
export function logWarn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(...args)
}

/**
 * `console.error`, verbatim — WITHOUT the errors.log record `logError` makes. For the few
 * long-standing sites that report to stdout only (a tailer/watcher stream error, the
 * image-cache default sink); keeping them console-only preserves their exact output.
 */
export function logConsoleError(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(...args)
}
