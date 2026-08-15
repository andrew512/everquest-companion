// ============================================================================
// packInstallRun.ts — ONE retry loop for pack installs, for BOTH callers (JOS-307).
// ============================================================================
//
// THE ASYMMETRY THIS DELETES. There were two ways a sound pack got installed and they disagreed
// about everything that matters when the network is having a bad day:
//
//   * startup provisioning (`provisionPacks.ts`) retried three times with backoff, and filed an
//     ERROR for every attempt — three store rows per failed launch, forever, on a machine that
//     simply cannot reach GitHub;
//   * the registry browser (`ipc/sounds.ts`) did not retry AT ALL, and filed one row whose message
//     was `install '<name>' failed` with the cause thrown away.
//
// Neither behaviour was chosen; they were written months apart. So the loop lives once, here, and
// both callers get the same three things: bounded retries on failures a retry could plausibly fix,
// ONE routed log line per attempt (`packInstallLog.ts` decides warn vs error), and a bounded
// sentence naming the cause handed back for the UI to render.
//
// The policy itself is pure and elsewhere (`shared/packInstall.ts`) — this file is the I/O.

import { logError, logWarn } from './errorLog'
import { installPack } from './packRegistry'
import { logPackInstallFailure, type PackInstallLogSinks } from './packInstallLog'
import {
  MAX_INSTALL_ATTEMPTS,
  describePackInstallFailure,
  isTransientPackInstallFailure,
  packInstallRetryDelayMs
} from '../shared/packInstall'
import type { PackInstallProgress, RegistryPack } from '../shared/types'

/** The two sinks, named once. Same handover as `updater.ts`'s `LOG_SINKS`, same reason. */
const LOG_SINKS: PackInstallLogSinks = { error: logError, warn: logWarn }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** What an install run produced. `error` is the bounded, human-readable cause of the FINAL
 *  attempt — the string the pack row renders and the string the IPC result carries. */
export interface PackInstallRunResult {
  readonly ok: boolean
  readonly error?: string
  /** How many attempts were actually made (1 when the first succeeded or was not worth retrying). */
  readonly attempts: number
}

/**
 * Install a pack, retrying only what a retry could fix.
 *
 * A NON-TRANSIENT FAILURE STOPS IMMEDIATELY and is reported as final on its first attempt —
 * `packInstallFailureLine` then says `attempt 1/3`, which is the honest reading: the budget was
 * three and we spent one because the second would have asked the same question and got the same
 * 404. See `shared/packInstall.ts` for why the default is "not transient".
 */
export async function installPackWithRetry(
  pack: RegistryPack,
  onProgress: (p: PackInstallProgress) => void,
  opts?: { readonly targetRoot?: string; readonly attempts?: number }
): Promise<PackInstallRunResult> {
  const attempts = Math.max(1, opts?.attempts ?? MAX_INSTALL_ATTEMPTS)
  for (let attempt = 1; ; attempt++) {
    try {
      await installPack(pack, onProgress, opts?.targetRoot)
      return { ok: true, attempts: attempt }
    } catch (err) {
      const more = attempt < attempts && isTransientPackInstallFailure(err)
      logPackInstallFailure(
        { pack: pack.name, attempt, attempts, final: !more, err },
        LOG_SINKS
      )
      if (!more) return { ok: false, error: describePackInstallFailure(err), attempts: attempt }
      await sleep(packInstallRetryDelayMs(attempt))
    }
  }
}
