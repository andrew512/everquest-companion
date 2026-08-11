// ============================================================================
// shadow.ts — THE FLEET BACKSTOP: cold-fold it again, quietly, and see (JOS-208 phase 3).
// ============================================================================
//
// THE THIRD RUNG OF THE PROOF STACK, and the only one that runs on machines nobody here owns. The
// differential harness proves the law over the fixture corpus; the e2e restart-compare proves it
// through the real app on a real restart; both are bounded by the logs this repo has. Shadow mode is
// what covers the logs it does NOT have — and it is the design's stated kill-switch trigger and the
// gate the default-on rollout waits behind.
//
//     take the container that is on disk, restore it into a throwaway world, cold-fold the log to
//     the same byte into a second throwaway world, tick both to the same instant, and compare every
//     published snapshot.
//
// WHAT IT REPORTS, AND THE BRIGHT LINE IT RESPECTS. To the fleet: two counts, "a check ran" and "a
// check found a difference". Never which module, never a field name, never a value, never a byte
// offset — a divergence report that named the module would be describing the user's own game state
// by inference (a `loot` divergence is a claim about what they looted), and the telemetry law here
// is diagnosability without gameplay data leaving the machine. LOCALLY, in `errors.log`, it says
// exactly which modules differed, because that file never leaves the machine unless its owner sends
// it and the owner is the person who has to fix the fold.
//
// WHY IT IS SAMPLED AND NOT ALWAYS-ON, in the design's own words: "never runs the identity reads
// cold twice in a row — sample, do not always-verify". A verification is a FULL cold read of the log
// prefix, which is precisely the cost this whole feature exists to remove. Running it every launch
// would hand every user the slow launch back and call it instrumentation. So: a dev/owner build
// verifies often, an opted-in install verifies rarely, and no install verifies twice inside its
// minimum gap — a duty cycle whose memory is one number in the settings file.
//
// AND IT NEVER COMPETES WITH THE LIVE SESSION. It starts a full delay after the app has settled, it
// folds through the ordinary duty-cycled slicer at a GENTLER duty than startup's, and it runs in a
// world with no IPC, no combat engine and its own loot index (shadowWorld.ts argues each).

import { logError, logInfo } from '../errorLog'
import { E2E } from '../e2e'
import { characterId } from '../log/config'
import { createSlicer } from '../log/replaySlicer'
import { scanLog } from '../log/scanHistory'
import { getFoldShadowLastMs, setFoldShadowLastMs } from '../storeFoldCache'
import { noteCheckpointShadow } from '../telemetry'
import { foldCacheEnabled } from './attach'
import { readCheckpoint } from './loader'
import { foldCachePath } from './paths'
import { divergentModules, shadowOverride, shouldRunShadow } from './policy'
import { buildShadowWorld, shadowSnapshots } from './shadowWorld'
import type { CharacterRef } from '../../shared/types'

/**
 * How long after the app is wired the verification may start.
 *
 * A whole minute, and generously so: the seconds after a launch belong to the renderer painting,
 * the overlays coming up and the user looking at their meter. The verification has no deadline at
 * all — it is a population measurement, and a reading that arrives on the next heartbeat instead of
 * this one costs nothing.
 */
export const SHADOW_START_DELAY_MS = 60_000

/** The duty the shadow fold holds. Deliberately under startup's 0.6: this fold is nobody's hurry. */
export const SHADOW_DUTY = 0.25

// ------------------------------------------------------------------------- the verification

/** What one verification found. Returned for the test seam; the fleet only ever sees the count. */
export interface ShadowResult {
  ran: boolean
  /** Why not, when `ran` is false — a log line's worth, never sent anywhere. */
  why?: string
  diverged?: string[]
  /** The byte the container claimed, i.e. how far the cold arm folded. */
  offset?: number
}

/**
 * RUN ONE VERIFICATION against the container currently on disk.
 *
 * IT VERIFIES THE FILE, NOT THE RESTORE THIS LAUNCH PERFORMED, and that is the stronger of the two.
 * The container on disk after `replayDone` is the one the NEXT launch will be served from, so
 * checking it catches a bad serializer before anybody is served by it; and when this launch itself
 * restored, that state is what the current file was written from, so the restore is covered too.
 * The alternative — pinning the bytes we restored from at attach time — would verify the past and
 * miss the write path entirely.
 */
export async function runShadowVerification(ref: CharacterRef): Promise<ShadowResult> {
  const cachePath = foldCachePath(characterId(ref))
  const characterKey = `${ref.name}@${ref.server}`.toLowerCase()

  // THE WARM ARM. `readCheckpoint` is the production loader, doubting exactly what it doubts at
  // startup — including the identity block against the log as it stands now — so a container this
  // arm refuses is one the next launch would refuse too, which is not a divergence but a cold start.
  const warmWorld = buildShadowWorld(ref)
  const res = await readCheckpoint({ cachePath, logPath: ref.logPath, characterKey, modules: warmWorld.units })
  if (!res.restored) return { ran: false, why: `container refused (${res.why})` }

  // THE COLD ARM. The production scanner over [0, B) — the same bytes, through the same parser,
  // into the same module list, at a gentler duty than a startup fold takes.
  const coldWorld = buildShadowWorld(ref)
  await scanLog(ref.logPath, coldWorld.bus, 0, {
    slicer: createSlicer({ duty: SHADOW_DUTY }),
    endOffset: res.offset
  })

  // ONE INSTANT FOR BOTH SWEEPS. The published snapshots of anything carrying a live clock (the
  // respawn rows' ordering) are a function of WHEN they are asked, and these two worlds were built
  // seconds apart — so the go-live tick that precedes every real publish is run here with one
  // pinned value, exactly as the differential harness pins its own.
  const nowMs = Date.now()
  const diverged = divergentModules(shadowSnapshots(warmWorld, nowMs), shadowSnapshots(coldWorld, nowMs))
  return { ran: true, diverged, offset: res.offset }
}

// ------------------------------------------------------------------------- the scheduler

let started = false
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * ARM THE VERIFICATION for this launch, if the sample says so. Idempotent, and a no-op when the
 * fold cache is off — no timer, no store read past the two this rule needs, nothing.
 *
 * `active` is the composition root's accessor for the character being tailed, asked at FIRE time
 * rather than at arm time: a launch that switches character in its first minute must verify the
 * fold that is actually on screen.
 */
export function startShadowVerification(active: () => CharacterRef | null): void {
  if (started) return
  started = true
  const forced = shadowOverride(process.env.EQ_FOLD_SHADOW)
  if (forced === false) return
  const decided =
    forced === true ||
    shouldRunShadow({
      enabled: foldCacheEnabled(),
      dev: isDevBuild(),
      lastRunMs: getFoldShadowLastMs(),
      nowMs: Date.now(),
      draw: Math.random()
    })
  if (!decided) return
  // A forced run is a run somebody is WATCHING (the owner, or the e2e spec), so it does not spend a
  // minute proving it can wait. The delay is the politeness of an unattended sample, not a rule.
  timer = setTimeout(() => {
    timer = null
    void fire(active)
  }, forced === true ? 2_000 : SHADOW_START_DELAY_MS)
  timer.unref()
}

/** Stop a pending verification on the way out. */
export function stopShadowVerification(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

async function fire(active: () => CharacterRef | null): Promise<void> {
  const ref = active()
  if (ref === null) return
  // The mark is written BEFORE the work, not after: a verification that crashes the process (or
  // whose launch is killed half-way through a 128 MB read) must still count against the duty cycle,
  // or a repeatable failure becomes a cold read on every single launch.
  setFoldShadowLastMs(Date.now())
  try {
    const result = await runShadowVerification(ref)
    if (!result.ran) {
      logInfo(`[everquest-companion] Fold shadow: not verified (${result.why ?? 'no reason given'}).`)
      return
    }
    const diverged = result.diverged ?? []
    noteCheckpointShadow(diverged.length > 0)
    logInfo(
      diverged.length === 0
        ? `[everquest-companion] Fold shadow: checkpoint matches a cold fold at byte ${String(result.offset ?? 0)}.`
        : `[everquest-companion] Fold shadow: DIVERGED at byte ${String(result.offset ?? 0)} - ${diverged.join(', ')}.`
    )
  } catch (err) {
    logError('main:foldShadow', { message: 'shadow verification failed', err })
  }
}

/**
 * IS THIS A BUILD WHERE VERIFYING OFTEN IS THE RIGHT TRADE?
 *
 * `app.isPackaged` is FALSE in a self-compiled build from this public repo (AGENTS.md's owner-tools
 * story), so a contributor's local build verifies at the dev rate. That is the harmless direction:
 * they get a slower background fold and a correctness check, not a missing feature — and it is the
 * same population that would be fixing a divergence if one appeared. The e2e channel is excluded
 * outright, because a suite that cold-folded every fixture twice would be measuring itself.
 */
function isDevBuild(): boolean {
  return !E2E && process.env.NODE_ENV !== 'production'
}
