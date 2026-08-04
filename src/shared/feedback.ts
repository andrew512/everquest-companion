// ============================================================================
// FEEDBACK CONTRACT — the ONE definition of the report wire format.
// ============================================================================
//
// Imported by THREE consumers and owned by none of them:
//   * the renderer dialog  (gates Send on `validateDraft`, so a round trip is never spent
//     learning something we already knew),
//   * the main process     (assembles `SubmitRequest`, re-validates at the IPC handler —
//     renderer-supplied strings are validated AT THE BOUNDARY, same law as `sounds:getData`),
//   * the ingest Lambda    (`validateSubmit` is the server's whole shape check).
//
// One definition, three consumers — that is the point. A limit that lives in two places is a
// limit that will disagree with itself, and the disagreement will show up as a 400 the user
// cannot act on.
//
// LAWS THIS FILE OBEYS:
//   * PURE. Its ONLY import is the pure sibling `./sanitizeText` — no `node:`, no Electron, no
//     DOM. `src/shared/**` compiles under BOTH tsconfigs and this module additionally has to
//     bundle into a Lambda.
//   * REJECT, NEVER TRUNCATE (§8.3 step 2). A description that is too long is an error the
//     user is told about; silently cutting it is a lie to both parties. The validators trim
//     SURROUNDING whitespace (normalization) and never shorten content.
//   * TEXT ON THE WIRE IS TEXT, NOT TERMINAL INSTRUCTIONS. Sanitization used to be entirely
//     CLIENT-side; a hostile client simply does not run it. So the two text shapes on this wire
//     are now governed here, at the boundary all three consumers share:
//
//       description (multi-line prose) — control characters are STRIPPED. `\n` and `\t` stay;
//         every other C0 control, DEL, C1, whole ANSI/VT escape sequence and invisible/BiDi
//         formatting character is removed BEFORE the trim and BEFORE the length bound. This is
//         NORMALIZATION, of exactly the kind `trim` already is: nobody typed a NUL or an
//         `ESC ] 0 ;` into a bug report, so removing one never shortens what the user WROTE.
//         (It is therefore not in tension with REJECT-NEVER-TRUNCATE, which is about LENGTH.)
//
//       env.* (single-line runtime strings) — control characters are REJECTED, `invalid_payload`
//         naming the field. `os.release()` and `process.versions.*` cannot legitimately contain
//         one, so a control character there does not mean "needs tidying", it means the payload
//         is forged, and a forged payload deserves an honest 400 rather than a quiet repair.
//
//     The character classes themselves live in ONE place, `./sanitizeText`, which the owner-side
//     triage readers use too — so what the wire refuses and what the terminal is protected from
//     can never drift apart.
//   * The validators are total and side-effect free: every failure is a typed value, nothing
//     throws, and the same call on the same input always returns the same answer.
//
// Plan of record: docs/plans/feedback-triage.md §3.1 (shape), §8.3 (handler contract).

import { hasWireControls, sanitizeMultiline } from './sanitizeText'

/** Bumped only for a BREAKING wire change; the server rejects anything else outright. */
export const FEEDBACK_API_VERSION = 1

// ---- the record ------------------------------------------------------------------------

export type FeedbackType = 'feature' | 'bug'
/** `'e2e'` is deliberately absent: the headless harness never submits (§6.6). */
export type AppChannelTag = 'prod' | 'dev'
export type ReportStatus =
  | 'new'
  | 'triaged'
  | 'accepted'
  | 'shipped'
  | 'wontfix'
  | 'duplicate'
  | 'spam'
export type Severity = 'p0' | 'p1' | 'p2' | 'p3'

/** Runtime-checkable spellings of the unions above (validators + the triage CLI's `set`). */
export const FEEDBACK_TYPES = ['feature', 'bug'] as const
export const APP_CHANNEL_TAGS = ['prod', 'dev'] as const
export const UPDATE_CHANNELS = ['main', 'stable'] as const
export const REPORT_STATUSES = [
  'new',
  'triaged',
  'accepted',
  'shipped',
  'wontfix',
  'duplicate',
  'spam',
] as const
export const SEVERITIES = ['p0', 'p1', 'p2', 'p3'] as const

/** What the user typed. Renderer-owned; validated by the SAME function main and the Lambda use.
 *
 *  `title` and `contact` were REMOVED from the contract: the description is the whole report,
 *  and anyone who wants a follow-up puts their email/Discord in the body. Old clients that
 *  still send them are not rejected — the validator simply drops unknown fields — and the
 *  `report` table keeps its columns for the legacy rows that carry values. */
export interface FeedbackDraft {
  type: FeedbackType
  /** MIN_DESCRIPTION..MAX_DESCRIPTION after trim. */
  description: string
}

/** Everything the CLIENT knows about itself. Assembled in main; never typed by the user. */
export interface FeedbackEnv {
  appVersion: string // app.getVersion()
  channel: AppChannelTag // src/main/channel.ts CHANNEL
  updateChannel: 'main' | 'stable' // store.getUpdateChannel()
  platform: string // process.platform
  osRelease: string // os.release()
  arch: string // process.arch
  electron: string // process.versions.electron
  chrome: string // process.versions.chrome
  node: string // process.versions.node
}

/** Metadata about an attached slice. The BYTES go to S3, never through this JSON. */
export interface LogSliceMeta {
  bytes: number // gzipped size the client is about to upload
  lines: number // lines AFTER scrub
  dropped: number // lines the scrub removed (shown in the preview, honest by construction)
  fromMs: number // first kept line's timestamp
  toMs: number // last kept line's timestamp
  sha256: string // hex digest of the gz bytes — integrity, and a free dedupe key
}

export interface SubmitRequest {
  v: typeof FEEDBACK_API_VERSION
  draft: FeedbackDraft
  env: FeedbackEnv
  installId: string // uuid v4 shape
  clientReportId: string // uuid v4 — IDEMPOTENCY key across offline retries (§6.4)
  clientTs: number // client clock, untrusted, kept for skew diagnostics
  log: LogSliceMeta | null
}

export type SubmitResponse =
  | { ok: true; reportId: string; upload: PresignedUpload | null }
  | {
      ok: false
      error: SubmitErrorCode
      message: string
      field?: string
      retryAfterSec?: number
    }

export type SubmitErrorCode =
  | 'invalid_payload'
  | 'blocked'
  | 'quota_exceeded'
  | 'closed'
  | 'too_large'
  | 'internal'

export interface PresignedUpload {
  url: string // S3 endpoint — VALIDATED before main POSTs to it (§6.5)
  fields: Record<string, string> // the POST policy fields
  key: string
  expiresInSec: number
}

// ---- the IPC-crossing shapes -------------------------------------------------------------
//
// §4.2 of the plan sketches these as `src/main/feedback/index.ts` return types. They cannot
// live there: the RENDERER names every one of them (the dialog's header, the preview box, the
// submit outcome) and the renderer cannot import from `src/main`. Anything that crosses the
// preload bridge is by definition a SHARED type, so they live here with the rest of the
// contract — main and the renderer both import them from one file.

/** Everything the dialog needs to render its header + gate its controls. */
export interface FeedbackContext {
  env: FeedbackEnv
  /** False when this build has no `FEEDBACK_API_URL` compiled in — the UI says so honestly
   *  instead of failing (F1 ships dark on purpose). */
  endpointConfigured: boolean
  /** Reports waiting in the offline queue (§6.4). */
  queued: number
  /** False when no character log is resolved, so the attach section cannot be offered. */
  logAvailable: boolean
}

/**
 * What crosses IPC for the preview (§5.4): the true counts plus AT MOST `PREVIEW_MAX_LINES`
 * lines of text. The gz BYTES never cross — a 4 MB string does not belong on the bridge.
 * `truncatedPreview` is what the UI must state out loud, since "you can see exactly what is
 * sent" is otherwise a claim about a truncated view.
 */
export interface FeedbackSlicePreview extends LogSliceMeta {
  previewLines: string[]
  truncatedPreview: boolean
}

/**
 * The end of a Send. `submitFeedback` NEVER rejects — every outcome, including a dead network,
 * is one of these values (§4.2).
 */
export type SubmitResult =
  | { ok: true; reportId: string; logUploaded: boolean }
  | { ok: false; error: SubmitErrorCode; message: string; queued: boolean }

/** The "Save a copy…" escape hatch: the OS save dialog lives in main (§4.2). */
export interface SaveSliceResult {
  ok: boolean
  path?: string
  canceled?: boolean
}

// ---- limits ----------------------------------------------------------------------------
//
// Here, and nowhere else, so the dialog, the slicer and the Lambda cannot disagree.

export const MIN_DESCRIPTION = 10
export const MAX_DESCRIPTION = 4_000
export const MAX_BODY_BYTES = 32 * 1024 // whole JSON request
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // gzipped slice
export const MAX_SLICE_LINES = 50_000
export const PREVIEW_MAX_LINES = 5_000 // what crosses IPC for the preview (§5.4)
export const LOG_WINDOW_CHOICES = [15, 30, 60] as const // minutes
export const DEFAULT_LOG_WINDOW = 30
/** Per-field ceiling for the free-form `FeedbackEnv` runtime strings (`os.release()`,
 *  `process.versions.*`). NOT in the plan's limit block — added because "bounded by
 *  MAX_BODY_BYTES" is a whole-body bound, and a 30 KB `arch` should fail on the field that
 *  is wrong rather than on the body that contains it. Real values are <= 24 chars. */
export const MAX_ENV_FIELD = 120

/** `crypto.randomUUID()` shape. Case-insensitive to read; clients emit lowercase. */
export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** `app.getVersion()` — semver, optionally with the CI channel prerelease tag. */
export const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
/** A sha-256 digest as hex. `createHash('sha256').digest('hex')` is lowercase; both read. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/i

// ---- validation ------------------------------------------------------------------------

/** Every rejection is `invalid_payload` — §8.3 decides 413 `too_large` from Content-Length,
 *  BEFORE a body is parsed, so an oversize body never reaches these functions. */
export interface ValidationFailure {
  ok: false
  error: 'invalid_payload'
  /** Safe to render to the user verbatim: it names the field and the limit, nothing internal. */
  message: string
  /** Dotted path of the offending field, so the dialog can focus the right input. */
  field: string
}

export type Validated<T> = { ok: true; value: T } | ValidationFailure

const fail = (field: string, message: string): ValidationFailure => ({
  ok: false,
  error: 'invalid_payload',
  message,
  field,
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The LENGTH half, shared by both text shapes below. Measured on the already-normalized value,
 * which is the value that will be STORED — the number in the error message is a number the user
 * can act on, not one about some intermediate form they never saw.
 */
function bounded(t: string, field: string, max: number, min: number): Validated<string> {
  if (t.length < min)
    return min === 1
      ? fail(field, `${field} is required.`)
      : fail(field, `${field} must be at least ${min} characters.`)
  if (t.length > max)
    return fail(
      field,
      `${field} must be ${max} characters or fewer (it is ${t.length}).`,
    )
  return { ok: true, value: t }
}

/**
 * A SINGLE-LINE runtime string (`env.platform`, `env.osRelease`, `env.arch`, `env.electron`,
 * `env.chrome`, `env.node`). Required, non-empty after trim, <= max — and REJECTED outright if
 * anything survives the trim that is a control character or an invisible formatting character.
 *
 * Trim first, THEN test: surrounding whitespace has always been normalized away here and a
 * trailing newline from a sloppy caller is not an attack. A control character in the INTERIOR
 * of `os.release()` is.
 */
function lineText(raw: unknown, field: string, max: number): Validated<string> {
  if (typeof raw !== 'string') return fail(field, `${field} must be text.`)
  const t = raw.trim()
  if (hasWireControls(t))
    return fail(field, `${field} must not contain control characters.`)
  return bounded(t, field, max, 1)
}

/**
 * MULTI-LINE prose the user typed (`draft.description`). Control characters are STRIPPED, then
 * the value is trimmed, then bounded — in that order, deliberately:
 *
 *   * strip before trim, so a description made entirely of NULs and escape sequences collapses
 *     to '' and fails the MINIMUM like the empty report it is, rather than passing as content;
 *   * strip before the maximum, so the length the user is told about is the length of the text
 *     we will actually keep. Removing a non-character is not the "truncation" §8.3 forbids —
 *     what that law protects is the user's WORDS, and no word is being shortened.
 */
function blockText(raw: unknown, field: string, max: number, min: number): Validated<string> {
  if (typeof raw !== 'string') return fail(field, `${field} must be text.`)
  return bounded(sanitizeMultiline(raw).trim(), field, max, min)
}

function integerInRange(
  raw: unknown,
  field: string,
  min: number,
  max: number,
): Validated<number> {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
    return fail(field, `${field} must be a whole number.`)
  if (raw < min || raw > max)
    return fail(field, `${field} must be between ${min} and ${max} (it is ${raw}).`)
  return { ok: true, value: raw }
}

function oneOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
): Validated<T> {
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw))
    return { ok: true, value: raw as T }
  return fail(field, `${field} must be one of: ${allowed.join(', ')}.`)
}

/**
 * The regex-pinned fields (`appVersion`, both UUIDs, `log.sha256`) need no separate control-
 * character rule and MUST NOT get one: every pattern here is `^…$` over a closed character set,
 * and in JavaScript — unlike Perl or Python — an un-flagged `$` matches only the very end of the
 * input, never before a trailing newline. `\d`, `\w` and `[0-9a-f]` admit no control character,
 * so a forged `appVersion` with an ESC in it already fails on the shape.
 */
function matching(
  raw: unknown,
  field: string,
  re: RegExp,
  what: string,
): Validated<string> {
  if (typeof raw === 'string' && re.test(raw)) return { ok: true, value: raw }
  return fail(field, `${field} must be ${what}.`)
}

/**
 * The user's own words. Gates the dialog's Send button AND runs again in main and in the
 * Lambda — the same code, so the three can never disagree about what "valid" means.
 *
 * Returns the draft with control characters stripped, surrounding whitespace trimmed and blank
 * optionals dropped. Content is NEVER shortened: an over-long description is a rejection, not a
 * truncation. A stripped ESC is not content being shortened — see the header's law.
 */
export function validateDraft(input: unknown): Validated<FeedbackDraft> {
  if (!isRecord(input)) return fail('draft', 'A report is required.')

  const type = oneOf(input.type, 'type', FEEDBACK_TYPES)
  if (!type.ok) return type

  const description = blockText(
    input.description,
    'description',
    MAX_DESCRIPTION,
    MIN_DESCRIPTION,
  )
  if (!description.ok) return description

  // A retired-field `title`/`contact` from an older client is dropped, never rejected: the
  // constructed value below carries only the fields the contract still has.
  return {
    ok: true,
    value: {
      type: type.value,
      description: description.value,
    },
  }
}

/** What the client says about itself. Every field is required — main always knows all of them. */
export function validateEnv(input: unknown): Validated<FeedbackEnv> {
  if (!isRecord(input)) return fail('env', 'env is required.')

  const appVersion = matching(
    input.appVersion,
    'env.appVersion',
    APP_VERSION_RE,
    'a semver version',
  )
  if (!appVersion.ok) return appVersion
  const channel = oneOf(input.channel, 'env.channel', APP_CHANNEL_TAGS)
  if (!channel.ok) return channel
  const updateChannel = oneOf(
    input.updateChannel,
    'env.updateChannel',
    UPDATE_CHANNELS,
  )
  if (!updateChannel.ok) return updateChannel

  // The remaining fields are free-form runtime strings (`process.platform`, `os.release()`,
  // `process.versions.*`): present, bounded, and SINGLE-LINE — `lineText` rejects any control
  // or invisible character outright, because these values are printed straight into the owner's
  // terminal by the triage CLI and none of them can legitimately carry one.
  const platform = lineText(input.platform, 'env.platform', MAX_ENV_FIELD)
  if (!platform.ok) return platform
  const osRelease = lineText(input.osRelease, 'env.osRelease', MAX_ENV_FIELD)
  if (!osRelease.ok) return osRelease
  const arch = lineText(input.arch, 'env.arch', MAX_ENV_FIELD)
  if (!arch.ok) return arch
  const electron = lineText(input.electron, 'env.electron', MAX_ENV_FIELD)
  if (!electron.ok) return electron
  const chrome = lineText(input.chrome, 'env.chrome', MAX_ENV_FIELD)
  if (!chrome.ok) return chrome
  const node = lineText(input.node, 'env.node', MAX_ENV_FIELD)
  if (!node.ok) return node

  return {
    ok: true,
    value: {
      appVersion: appVersion.value,
      channel: channel.value,
      updateChannel: updateChannel.value,
      platform: platform.value,
      osRelease: osRelease.value,
      arch: arch.value,
      electron: electron.value,
      chrome: chrome.value,
      node: node.value,
    },
  }
}

/**
 * The attached slice's metadata. The BYTES never pass through here — this is what lets the
 * server size the presign policy (`content-length-range 1..MAX_UPLOAD_BYTES`) before a single
 * byte of log exists in the cloud.
 *
 * An EMPTY window is not an attachment: main sends `log: null` rather than a zero-line slice,
 * so `lines >= 1` and `bytes >= 1` are both real conditions here.
 */
export function validateLogMeta(input: unknown): Validated<LogSliceMeta> {
  if (!isRecord(input)) return fail('log', 'log must be an object or null.')

  const bytes = integerInRange(input.bytes, 'log.bytes', 1, MAX_UPLOAD_BYTES)
  if (!bytes.ok) return bytes
  const lines = integerInRange(input.lines, 'log.lines', 1, MAX_SLICE_LINES)
  if (!lines.ok) return lines
  const dropped = integerInRange(input.dropped, 'log.dropped', 0, Number.MAX_SAFE_INTEGER)
  if (!dropped.ok) return dropped
  const fromMs = integerInRange(input.fromMs, 'log.fromMs', 0, Number.MAX_SAFE_INTEGER)
  if (!fromMs.ok) return fromMs
  const toMs = integerInRange(input.toMs, 'log.toMs', 0, Number.MAX_SAFE_INTEGER)
  if (!toMs.ok) return toMs
  // The span is a span: a slice cannot end before it starts.
  if (toMs.value < fromMs.value)
    return fail('log.toMs', 'log.toMs must be at or after log.fromMs.')
  const sha256 = matching(input.sha256, 'log.sha256', SHA256_HEX_RE, '64 hex characters')
  if (!sha256.ok) return sha256

  return {
    ok: true,
    value: {
      bytes: bytes.value,
      lines: lines.value,
      dropped: dropped.value,
      fromMs: fromMs.value,
      toMs: toMs.value,
      sha256: sha256.value,
    },
  }
}

/**
 * The whole request, as the Lambda sees it (§8.3 step 2). Cheapest checks first; the first
 * failure wins and names its field.
 *
 * `clientTs` is accepted as any finite timestamp ON PURPOSE — it is the CLIENT's clock, kept
 * only for skew diagnostics. The authoritative time is `receivedAt`, written server-side.
 */
export function validateSubmit(input: unknown): Validated<SubmitRequest> {
  if (!isRecord(input)) return fail('body', 'A JSON object body is required.')
  if (input.v !== FEEDBACK_API_VERSION)
    return fail('v', `v must be ${FEEDBACK_API_VERSION}.`)

  const draft = validateDraft(input.draft)
  if (!draft.ok) return draft
  const env = validateEnv(input.env)
  if (!env.ok) return env

  const installId = matching(input.installId, 'installId', UUID_V4_RE, 'a v4 UUID')
  if (!installId.ok) return installId
  const clientReportId = matching(
    input.clientReportId,
    'clientReportId',
    UUID_V4_RE,
    'a v4 UUID',
  )
  if (!clientReportId.ok) return clientReportId

  if (typeof input.clientTs !== 'number' || !Number.isFinite(input.clientTs))
    return fail('clientTs', 'clientTs must be a number.')

  let log: LogSliceMeta | null = null
  if (input.log !== null && input.log !== undefined) {
    const meta = validateLogMeta(input.log)
    if (!meta.ok) return meta
    log = meta.value
  }

  return {
    ok: true,
    value: {
      v: FEEDBACK_API_VERSION,
      draft: draft.value,
      env: env.value,
      installId: installId.value,
      clientReportId: clientReportId.value,
      clientTs: input.clientTs,
      log,
    },
  }
}
