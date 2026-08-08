// ============================================================================
// THE ERROR REPORT'S VALIDATOR — the one event whose strings are patterns, not enums.
// ============================================================================
//
// Split out of `./telemetryValidate.ts` when JOS-100 pushed that file past the repo's
// 400-code-line ceiling, and it is the RIGHT cut rather than merely an available one: every
// other validator in that file is four lines of enum lookups, and this one is the whole
// argument for why an error report is allowed to exist at all. Read `./errorReport.ts` for the
// owner's ruling (diagnosability over pure anonymity, holding ONE bright line: GAMEPLAY DATA
// NEVER RIDES AUTOMATICALLY); what follows is how the wire holds it to that.
//
// FIVE INDEPENDENT REFUSALS, each of which alone would stop a log line reaching storage:
//
//   1. `redactedMessage` must match `REDACTED_MESSAGE_RE` — printable ASCII, length-capped. An
//      ESC, a NUL, a newline or a BiDi override is not a value this field can hold, which is
//      what makes `tests/wireSanitize.test.mts`'s adversarial pin hold for it.
//   2. …AND IT MUST EQUAL ITS OWN RE-REDACTION. This is the defense-in-depth check: the SERVER
//      runs the SAME redactor the client ran, and a message that changes under it is refused
//      outright. A client that skipped the redactor — buggy, forged, or simply older than a
//      pattern we later tightened — cannot store the raw string, because "unredacted" is
//      exactly "not a fixed point of `redactMessage`".
//      REPAIRING IT WOULD BE WORSE THAN REFUSING. A repaired message is a message we accepted
//      from a client that is not running the code we think it is, and one more count is worth
//      less than knowing that. It is also why `redactMessage` is written to be idempotent: the
//      check is only expressible because the function has a fixed point.
//   3. Every frame's `file` must match `^out/…` with no dot-leading segment. An absolute path
//      cannot satisfy it, and neither can `out/../../secret.txt` (which the first draft of that
//      pattern DID accept — `tests/errorReportContract.test.mts` caught the traversal).
//   4. Every frame's `func` must be identifier-shaped. A NAME WITH A SPACE IN IT IS PROSE.
//   5. Every breadcrumb `kind` must be a member of the closed parser-kind enum — so a
//      breadcrumb can say `damage` and can never say what was damaged.
//
// Plus the two bounds: at most `MAX_ERROR_FRAMES_WIRE` frames and `MAX_BREADCRUMBS` crumbs. An
// eleventh of either FAILS the event rather than being quietly trimmed, because a client
// sending eleven is a client that is not running this contract, and trimming would hide that.
//
// PURE and total, like the rest of the set.

import {
  ERROR_CODE_RE,
  ERROR_NAME_RE,
  FINGERPRINT_RE,
  FRAME_FILE_RE,
  FRAME_FUNC_RE,
  isTelemetryObject,
  MAX_BREADCRUMBS,
  MAX_BREADCRUMB_OFFSET_MS,
  MAX_COUNT,
  MAX_ERROR_FRAMES_WIRE,
  MAX_FRAME_POSITION_WIRE,
  REDACTED_MESSAGE_RE,
  SESSION_AGE_MS_EDGES,
  TELEMETRY_BREADCRUMB_KINDS,
  TELEMETRY_ERROR_MODES,
  TELEMETRY_ERROR_VIEWS,
  type EvErrorReport,
  type TelemetryBreadcrumb,
  type TelemetryFrame
} from './telemetry'
import { redactMessage } from './errorReport'
import { bucket, fail, matching, oneOf, whole, type Validated } from './telemetryValidateBase'

function vFrame(raw: unknown, i: number): Validated<TelemetryFrame> {
  const at = `frames[${String(i)}]`
  if (!isTelemetryObject(raw)) return fail(at, `${at} must be an object.`)
  const file = matching(raw.file, `${at}.file`, FRAME_FILE_RE, 'a bundle-relative path under out/')
  if (!file.ok) return file
  const line = whole(raw.line, `${at}.line`, MAX_FRAME_POSITION_WIRE)
  if (!line.ok) return line
  const col = whole(raw.col, `${at}.col`, MAX_FRAME_POSITION_WIRE)
  if (!col.ok) return col
  const func = matching(raw.func, `${at}.func`, FRAME_FUNC_RE, 'an identifier-shaped name')
  if (!func.ok) return func
  return {
    ok: true,
    value: { file: file.value, line: line.value, col: col.value, func: func.value }
  }
}

function vFrames(raw: unknown): Validated<TelemetryFrame[]> {
  if (!Array.isArray(raw)) return fail('frames', 'frames must be a list.')
  if (raw.length > MAX_ERROR_FRAMES_WIRE) {
    return fail('frames', `frames must hold at most ${String(MAX_ERROR_FRAMES_WIRE)} entries.`)
  }
  const out: TelemetryFrame[] = []
  for (let i = 0; i < raw.length; i++) {
    const f = vFrame(raw[i], i)
    if (!f.ok) return f
    out.push(f.value)
  }
  return { ok: true, value: out }
}

function vCrumb(raw: unknown, i: number): Validated<TelemetryBreadcrumb> {
  const at = `breadcrumbs[${String(i)}]`
  if (!isTelemetryObject(raw)) return fail(at, `${at} must be an object.`)
  const kind = oneOf(raw.kind, `${at}.kind`, TELEMETRY_BREADCRUMB_KINDS)
  if (!kind.ok) return kind
  const offset = whole(raw.offsetMs, `${at}.offsetMs`, MAX_BREADCRUMB_OFFSET_MS)
  if (!offset.ok) return offset
  return { ok: true, value: { kind: kind.value, offsetMs: offset.value } }
}

function vBreadcrumbs(raw: unknown): Validated<TelemetryBreadcrumb[]> {
  if (!Array.isArray(raw)) return fail('breadcrumbs', 'breadcrumbs must be a list.')
  if (raw.length > MAX_BREADCRUMBS) {
    return fail('breadcrumbs', `breadcrumbs must hold at most ${String(MAX_BREADCRUMBS)} entries.`)
  }
  const out: TelemetryBreadcrumb[] = []
  for (let i = 0; i < raw.length; i++) {
    const c = vCrumb(raw[i], i)
    if (!c.ok) return c
    out.push(c.value)
  }
  return { ok: true, value: out }
}

/** The message, both ways: the character class, then the fixed-point check (header, points 1-2). */
function vRedactedMessage(raw: unknown): Validated<string> {
  const text = matching(
    raw,
    'redactedMessage',
    REDACTED_MESSAGE_RE,
    'printable ASCII, length-capped'
  )
  if (!text.ok) return text
  if (redactMessage(text.value) !== text.value) {
    return fail(
      'redactedMessage',
      'redactedMessage must already be redacted: it changed when the redactor was re-run.'
    )
  }
  return text
}

/** The four scalars that are not the message and not a list — split out so neither half of this
 *  validator is past the repo's complexity ceiling. */
interface ErrorContext {
  view: EvErrorReport['view']
  sessionAgeBucket: number
  mode: EvErrorReport['mode']
  count: number
}

function vContext(o: Record<string, unknown>): Validated<ErrorContext> {
  const view = oneOf(o.view, 'view', TELEMETRY_ERROR_VIEWS)
  if (!view.ok) return view
  const age = bucket(o.sessionAgeBucket, 'sessionAgeBucket', SESSION_AGE_MS_EDGES)
  if (!age.ok) return age
  const mode = oneOf(o.mode, 'mode', TELEMETRY_ERROR_MODES)
  if (!mode.ok) return mode
  const count = whole(o.count, 'count', MAX_COUNT)
  if (!count.ok) return count
  return {
    ok: true,
    value: { view: view.value, sessionAgeBucket: age.value, mode: mode.value, count: count.value }
  }
}

/**
 * ONE ERROR REPORT. Constructed field by field from the schema like every other validator in
 * this set, so a smuggled `characterName` is not stripped by a rule someone has to remember —
 * the property simply never appears in the value that comes back.
 */
export function validateErrorReport(o: Record<string, unknown>): Validated<EvErrorReport> {
  const name = matching(o.errorName, 'errorName', ERROR_NAME_RE, 'an identifier')
  if (!name.ok) return name
  const message = vRedactedMessage(o.redactedMessage)
  if (!message.ok) return message
  const frames = vFrames(o.frames)
  if (!frames.ok) return frames
  const fingerprint = matching(o.fingerprint, 'fingerprint', FINGERPRINT_RE, '16 hex characters')
  if (!fingerprint.ok) return fingerprint
  const crumbs = vBreadcrumbs(o.breadcrumbs)
  if (!crumbs.ok) return crumbs
  const ctx = vContext(o)
  if (!ctx.ok) return ctx
  const value: EvErrorReport = {
    t: 'errorReport',
    errorName: name.value,
    redactedMessage: message.value,
    frames: frames.value,
    fingerprint: fingerprint.value,
    breadcrumbs: crumbs.value,
    ...ctx.value
  }
  if (o.code !== undefined && o.code !== null) {
    const code = matching(o.code, 'code', ERROR_CODE_RE, 'a machine-readable error code')
    if (!code.ok) return code
    value.code = code.value
  }
  return { ok: true, value }
}
