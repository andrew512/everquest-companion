// ============================================================================
// packInstall.ts — a failed sound-pack install finally says WHY (JOS-307).
// ============================================================================
//
// THE READING THIS FILE EXISTS FOR. The `install-failed` family in the fleet's error store is the
// single largest non-presence cluster the updater ticket's triage turned up, and it is not the
// auto-updater at all — it is the sound-pack registry:
//
//   6e42033dce2bdd33  0.25.0  x26   Error: install <str> failed
//   ed2cfb95cdc785ab  0.26.0  x21   Error: install <str> failed
//   ed…, a44e…, a318…, 7fab…, 0778…, 4934…  the same message on six more builds
//
// EVERY ONE OF THOSE ROWS IS THE SAME SENTENCE, AND THE SENTENCE SAYS NOTHING. `ipc/sounds.ts`
// filed `{ message: "install '<name>' failed", err }`, and `caughtFields`
// (shared/errorReportLocation.ts) has a rule that is right in general and wrong here: THE OUTER
// LAYER WINS EVERY FIELD IT HAS. So the wrapper's message is what reached the store and the nested
// cause's message — the only part that differs between a 404, a rate limit, a truncated tarball
// and a pack with no audio in it — was dropped on the floor. Sixty-odd occurrences across eight
// builds, and not one of them says which.
//
// THE STACK IS WHAT IDENTIFIED THEM, since the message could not: every exemplar's single in-bundle
// frame is `ClientRequest.<anonymous>`, under `parserOnIncomingClient` — the RESPONSE callback of
// `packRegistry.ts httpGetBuffer`. That is the release-tarball GET answering with a status we
// refuse, not a socket that never connected. So these are answers, and an answer has a number.
//
// ---------------------------------------------------------------------------------------
// WHAT IS RETRIED, AND WHY THE DEFAULT IS "NO"
// ---------------------------------------------------------------------------------------
// The registry browser's install path had NO retry at all (provisionPacks.ts has had one since it
// was written — the asymmetry is the bug). A retry is added here, and the predicate defaults to
// NOT transient: a failure we do not recognize is attempted ONCE. That direction is deliberate and
// is the opposite of the classifier's in shared/update.ts, because the two are answering different
// questions — an unknown FAILURE should be reported (report what you do not understand), but an
// unknown failure should not be RE-REQUESTED (a pack that is gone is gone, and three requests
// prove it no better than one while costing a stranger's bandwidth three times over).
//
// Everything this file is pure so `tests/packInstallRetry.test.mts` can drive the real rule with
// no Electron and no network in the process — the same technique updateLog.ts is written for.

import { isUnreachableFailure } from './update'

/** Attempts a user-initiated install gets, INCLUDING the first. Matches provisionPacks' own
 *  `MAX_ATTEMPTS`, which is the number this path should have had all along. */
export const MAX_INSTALL_ATTEMPTS = 3

/** First backoff between install attempts; doubles per retry. Shorter than provisioning's 2s
 *  because a person is watching this one — provisioning is invisible by design and can afford
 *  to be politer. */
export const INSTALL_RETRY_BASE_MS = 1_500

/** No store row, no console line and no chip caption carries a stack or a headers dump. */
export const MAX_INSTALL_MESSAGE_CHARS = 200

/** Which kind of failure an install hit. `rejected` is OUR OWN refusal — the archive was the
 *  wrong shape, the name was not installable, the conversion produced nothing. */
export type PackInstallFailureKind = 'http' | 'unreachable' | 'truncated' | 'rejected' | 'other'

/**
 * OUR OWN REFUSALS, matched on the sentences `packRegistry.ts` itself throws. A list rather than a
 * pattern, and each entry is a literal from that file — if one is reworded this stops matching and
 * the failure classes as 'other', which is reported and never retried. Failing that way round is
 * the point: the cost of a stale entry is a less precise word in a log line, never a swallowed
 * failure or a retry storm.
 */
const REJECTION_MESSAGES = [
  'pack name is not a valid identifier',
  'pack source fields are not valid',
  'is reserved for your imported sounds',
  'archive contained no files',
  'unsafe archive path',
  'pack has no openpeon.json',
  'pack contained no audio files',
  'openpeon.json is not valid JSON',
  'no sounds after conversion',
  'download exceeded size cap',
  'too many redirects'
] as const

/**
 * A DOWNLOAD THAT ARRIVED BROKEN. zlib's words for a truncated/garbled gzip body plus the stream
 * errors Node prints when a connection dies mid-body. All of these are worth exactly one more
 * attempt: the bytes were wrong, and the next set of bytes may not be.
 */
const TRUNCATED_RE =
  /incorrect header check|unexpected end of file|invalid distance|invalid block type|Z_BUF_ERROR|Z_DATA_ERROR|premature close|socket hang up|\baborted\b|ERR_STREAM_PREMATURE_CLOSE/i

/** `err.message` when there is one, else the value stringified. */
function failureText(err: unknown): string {
  return String((err as { message?: unknown } | null | undefined)?.message ?? err)
}

/**
 * The HTTP status behind an install failure, or null.
 *
 * `statusCode` first — `packRegistry.ts httpGetBuffer` hangs it off the error it throws for exactly
 * this reader. The `→ <status>` arm is the same fact read back out of the SENTENCE, which is what
 * survives when the error has been through a log line and lost its properties; `HTTP_ERROR_<n>` is
 * builder-util-runtime's spelling and is here so one reader covers both downloaders.
 */
export function packInstallHttpStatus(err: unknown): number | null {
  const direct = (err as { statusCode?: unknown } | null | undefined)?.statusCode
  if (typeof direct === 'number' && Number.isInteger(direct) && direct >= 400 && direct <= 599) {
    return direct
  }
  const text = failureText(err)
  const m = /→\s*(\d{3})\b/.exec(text) ?? /\bHTTP_ERROR_(\d{3})\b/.exec(text)
  if (m === null) return null
  const status = Number(m[1])
  return status >= 400 && status <= 599 ? status : null
}

/** Which of the five kinds this failure is. Our own refusals are asked FIRST: they are the only
 *  ones whose text we wrote, so nothing else may claim them. */
export function classifyPackInstallFailure(err: unknown): PackInstallFailureKind {
  if (err == null) return 'other'
  const text = failureText(err)
  if (REJECTION_MESSAGES.some((m) => text.includes(m))) return 'rejected'
  if (packInstallHttpStatus(err) !== null) return 'http'
  if (isUnreachableFailure(err)) return 'unreachable'
  if (TRUNCATED_RE.test(text)) return 'truncated'
  return 'other'
}

/**
 * Is another attempt worth making? See the header for why the default is NO.
 *
 * A 4xx is an answer about the pack — 404 (the tag is gone), 403 (the repo went private) — and a
 * second identical request cannot change it. The two exceptions are the two 4xx that are about
 * TIMING rather than the resource: 408 and 429.
 */
export function isTransientPackInstallFailure(err: unknown): boolean {
  switch (classifyPackInstallFailure(err)) {
    case 'unreachable':
    case 'truncated':
      return true
    case 'http': {
      const status = packInstallHttpStatus(err) ?? 0
      return status === 408 || status === 429 || status >= 500
    }
    default:
      return false
  }
}

/** How long to wait before attempt `attempt` (1-based: the delay BEFORE attempt 2 is the base). */
export function packInstallRetryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt))
  return INSTALL_RETRY_BASE_MS * 2 ** (n - 1)
}

/** The cause, as ONE bounded line. The full object still reaches errors.log through the nested
 *  error; this is the headline the store row and the console get. */
export function describePackInstallFailure(err: unknown): string {
  if (err == null) return 'unknown error'
  const oneLine = failureText(err).split('\n')[0].trim()
  if (oneLine.length === 0) return 'unknown error'
  return oneLine.length > MAX_INSTALL_MESSAGE_CHARS
    ? `${oneLine.slice(0, MAX_INSTALL_MESSAGE_CHARS - 1).trimEnd()}…`
    : oneLine
}

/**
 * THE LINE THE STORE ROW READS, and every word of it is a fact the old one lacked: which pack,
 * which attempt of how many, which class (with the status when there is one) — and then the CAUSE,
 * which is the whole ticket.
 *
 *   install 'alan-rickman' failed (attempt 3/3, http 404): GET https://github.com/… → 404
 */
export function packInstallFailureLine(
  name: string,
  attempt: number,
  attempts: number,
  err: unknown
): string {
  const kind = classifyPackInstallFailure(err)
  const status = packInstallHttpStatus(err)
  const klass = kind === 'http' && status !== null ? `http ${String(status)}` : kind
  return (
    `install '${name}' failed (attempt ${String(attempt)}/${String(attempts)}, ${klass}): ` +
    describePackInstallFailure(err)
  )
}
