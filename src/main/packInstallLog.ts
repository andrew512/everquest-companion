// ============================================================================
// packInstallLog.ts — where a failed pack install goes (JOS-307).
// ============================================================================
//
// The classification, the retry policy and the sentence are all in `shared/packInstall.ts`; this
// file answers the one remaining question — DOES IT GET FILED — and it is the same question
// `updateLog.ts` answers for the updater, deliberately with the same answers:
//
//   * A SWALLOWED ATTEMPT IS A WARN. An attempt that will be retried has not failed yet. Filing it
//     put THREE store rows in for one failed provisioning (provisionPacks logs every attempt at
//     error level), so an offline machine's every launch cost three reports saying the same thing
//     about its network.
//   * SOMEBODY ELSE'S NETWORK IS A WARN, ONCE PER CODE PER SESSION. JOS-266's rule, JOS-295's
//     application of it, unchanged. `provisionDefaultPacks` runs at EVERY startup, so an install
//     that can never reach GitHub is a per-launch report forever otherwise.
//   * AN ANSWER FROM GITHUB IS AN ERROR, EVERY TIME — and now it says which answer. The 404/403/429
//     that the `install <str> failed` family has been hiding since 0.16 is the entire point of the
//     ticket and is never withheld here. Bounding it is `errorRepeat`/`errorBudget`'s job
//     downstream, exactly as it is for every other error in the app.
//   * SO IS OUR OWN REFUSAL. `pack has no openpeon.json` means an upstream pack changed shape under
//     an immutable tag; that is ours to know about and it is not the user's network.
//
// It imports nothing but pure shared code — the two sinks are handed in — so
// `tests/packInstallRetry.test.mts` drives the REAL routing rule with no Electron in the process.

import {
  classifyPackInstallFailure,
  packInstallFailureLine,
  type PackInstallFailureKind
} from '../shared/packInstall'
import { updateFailureCode } from '../shared/update'

/** The two sinks, handed in by the caller. Same shape as `UpdateLogSinks`, same reason. */
export interface PackInstallLogSinks {
  /** `logError` — errors.log + dev stdout + the error report. */
  readonly error: (source: string, payload: unknown) => void
  /** `logWarn` — console only, and deliberately so. */
  readonly warn: (...args: unknown[]) => void
}

/** Source tag. The family the fleet already knows this cluster by — kept so the history joins up. */
export const PACK_INSTALL_SOURCE = 'main:packRegistry'

/** The console prefix for a swallowed attempt. */
export const PACK_INSTALL_LOG_PREFIX = '[everquest-companion] [packs]'

/** Distinct unreachable codes one session will warn about — `MAX_WARNED_UPDATE_CODES`'s reason. */
export const MAX_WARNED_PACK_CODES = 8

const warnedCodes = new Set<string>()

/** True the FIRST time this session an install failed with `code`; false forever after, including
 *  once the ceiling is reached. */
export function takePackNetworkWarning(code: string): boolean {
  if (warnedCodes.has(code)) return false
  if (warnedCodes.size >= MAX_WARNED_PACK_CODES) return false
  warnedCodes.add(code)
  return true
}

/** Forget the warned codes. Tests only. */
export function resetPackInstallWarnings(): void {
  warnedCodes.clear()
}

/** What `logError` is handed — a WRAPPER, for `caughtFields`' sake: the outer `message` names the
 *  pack, the attempt, the class and the cause, while the NESTED error still supplies the stack,
 *  the name and the code. */
export interface PackInstallFailurePayload {
  readonly pack: string
  readonly attempt: number
  readonly attempts: number
  readonly kind: PackInstallFailureKind
  readonly message: string
  /** The RAW error, exactly as `installPack` threw it. Never pre-formatted. */
  readonly error: unknown
}

/**
 * ROUTE ONE INSTALL FAILURE, and return the kind so the caller can say what it did.
 *
 * `final` is false for an attempt that is about to be retried — the whole decision is here rather
 * than at the two call sites (the registry browser and startup provisioning) so they cannot drift.
 */
export function logPackInstallFailure(
  opts: {
    readonly pack: string
    readonly attempt: number
    readonly attempts: number
    readonly final: boolean
    readonly err: unknown
  },
  sinks: PackInstallLogSinks
): PackInstallFailureKind {
  const { pack, attempt, attempts, final, err } = opts
  const kind = classifyPackInstallFailure(err)
  const line = packInstallFailureLine(pack, attempt, attempts, err)
  if (!final) {
    sinks.warn(PACK_INSTALL_LOG_PREFIX, `${line} - retrying`)
    return kind
  }
  if (kind === 'unreachable') {
    const code = updateFailureCode(err) ?? 'unreachable'
    if (takePackNetworkWarning(code)) {
      sinks.warn(
        PACK_INSTALL_LOG_PREFIX,
        `${line}; further unreachable installs this session are not logged`
      )
    }
    return kind
  }
  const payload: PackInstallFailurePayload = { pack, attempt, attempts, kind, message: line, error: err }
  sinks.error(PACK_INSTALL_SOURCE, payload)
  return kind
}
