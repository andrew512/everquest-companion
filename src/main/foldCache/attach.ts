// ============================================================================
// attach.ts — THE APP'S SIDE OF THE CHECKPOINT (JOS-208).
// ============================================================================
//
// Everything else in this directory is Electron-free and unit-testable. This is the one file that
// knows about the running app: the module registry, the settings store, this channel's userData,
// and the live event stream. `session.ts` calls three functions from here and nothing else, which
// is what keeps the feature's whole footprint in the app's hottest path down to two `if`s.
//
// THE FLAG IS RESOLVED ONCE PER LAUNCH and the answer is logged, because "why did it cold-start"
// is the first question anybody will ask of this feature and the boot log should already answer it.
//
// AND WHEN IT IS OFF, NOTHING HAPPENS — not a probe, not a subscription, not a `stat`. The
// last-event-timestamp tracker below is a per-event cost (one comparison across 1.4M events), so it
// is installed only when the flag is on. A feature that is off by default must cost nothing by
// default, or the measurement that decides whether to turn it on is measuring the wrong program.

import { logInfo } from '../errorLog'
import { characterId } from '../log/config'
import { noteCheckpointVerdict } from '../perf'
import { bus, combat, epoch, registry, sessionDetector } from '../pipeline'
import { getFoldCacheEnabled } from '../storeFoldCache'
import { resolveFoldCacheFlag } from './flag'
import {
  readCheckpoint,
  writeCheckpoint,
  writeCheckpointSync,
  checkpointableUnits,
  type RestoreResult,
  type WriteCheckpointArgs
} from './loader'
import { foldCachePath } from './paths'
import type { FoldUnit } from './serialize'
import type { CheckpointOrigin, CheckpointVerdict } from '../../shared/perf'
import type { CharacterRef } from '../../shared/types'

let flag: { enabled: boolean; why: string } | null = null
/** The `ts` of the last event any feeder emitted — see the header for why it is conditional. */
let lastEventTs = 0
let probeInstalled = false
/**
 * WHAT THIS PROCESS'S LOADER DECIDED, most recent first (JOS-208 phase 3).
 *
 * Two readers, and they want different things, which is why the verdict is BOTH pushed and kept.
 * `perf.ts` is pushed the FIRST one (the launch's own, for the profile and the summary line); the
 * shadow verifier reads the LATEST one, because after a character switch the fold that is on
 * screen is the one it has to be able to check.
 */
let verdict: CheckpointVerdict = { outcome: 'off' }

/** The loader's decision as it stands. Read by the shadow verifier (`shadow.ts`). */
export function checkpointVerdict(): CheckpointVerdict {
  return verdict
}

/** Record a decision: kept here for the shadow verifier, pushed once to the startup profile. */
function decide(next: CheckpointVerdict): void {
  verdict = next
  noteCheckpointVerdict(next)
}

/** The launch's answer, resolved once and logged once. */
export function foldCacheEnabled(): boolean {
  if (!flag) {
    flag = resolveFoldCacheFlag({ pref: getFoldCacheEnabled(), env: process.env.EQ_FOLD_CACHE })
    logInfo(`[everquest-companion] Fold checkpoint: ${flag.enabled ? 'ON' : 'off'} (${flag.why}).`)
  }
  return flag.enabled
}

/**
 * EVERYTHING THE CONTAINER CARRIES, in a fixed order: the registry's checkpointable modules first
 * (registration order), then the two DERIVED-EVENT PRODUCERS.
 *
 * The producers are here because they are fold state that publishes nothing and that the modules'
 * correctness depends on — the differential harness proved it on its first run, and the story is in
 * `serialize.ts` under `FoldUnit`. This list is the answer to "what is a complete fold", and it is
 * ONE list so a write and a read cannot disagree about it.
 *
 * PHASE 2 CLOSED THE MODULE SET. Every module the registry folds now declares a shape, and two of
 * phase 1's three named debts are paid INSIDE the modules that own their lifetimes rather than as
 * units of their own: the shared `MobLootIndex` rides in the `consider` blob (which folds it and
 * resets it), and the `MessageOverlayMiner` rides in `buffs` (which publishes what it builds).
 * The buffs module also carries the two halves it SHARES with `buffTimers` — the cast anchors and
 * the duration learner — so they are written exactly once.
 *
 * PHASE 4 CLOSED THE LAST GAP: the `CombatEngine` is here now, between the modules and the two
 * producers. The phase-2 argument for leaving it out — "nothing reads engine state back, so its
 * absence cannot make a checkpointed module wrong, and what it costs is a combat meter that starts
 * empty, exactly as after a cold start" — was half true and half false, and the owner's live retest
 * found the false half: a COLD start folds the engine from the whole log, so its meter comes up
 * full. Only a RESTORED launch came up empty. Uniform state, no tiers; the size of the thing is a
 * measurement to report, never a reason to serve a different world.
 *
 * NOTHING IS OUTSIDE IT NOW, and that is a machine-checked claim rather than a paragraph:
 * `tests/foldConsumerCensus.test.mts` enumerates every bus subscriber and every reader of log bytes
 * in `src/main/**` and requires each to be a checkpointed unit or a committed exemption with its
 * argument. A future consumer wired outside the registry — which is exactly how the engine escaped
 * phases 1–3 — fails CI by name.
 */
function foldUnits(): FoldUnit[] {
  return checkpointableUnits([...registry.list(), combat, epoch, sessionDetector])
}

/** Install the last-event clock. Idempotent; only ever called when the flag is on. */
function installProbe(): void {
  if (probeInstalled) return
  probeInstalled = true
  bus.subscribe((ev) => {
    if (ev.ts > lastEventTs) lastEventTs = ev.ts
  })
}

/**
 * TRY TO START FROM A CHECKPOINT. Returns the byte offset and seq the fold was restored to, or
 * null — and null is the ordinary answer, not an error: no cache, a cache from another build, a
 * log that was archived, a module that refused its blob. Every one of them means "cold-replay",
 * which is what the caller does anyway.
 *
 * THE CALLER MUST HAVE RESET THE REGISTRY FIRST. `session.ts` does (`resetWorldFor`), and this
 * relies on it: a restore drops state onto modules that are at zero, and on the refusal path the
 * modules are left exactly as the reset left them — except for the all-or-nothing case the loader
 * documents, where a partial adoption is possible and the caller resets again below.
 */
export async function restoreFold(ref: CharacterRef): Promise<{ offset: number; seq: number } | null> {
  if (!foldCacheEnabled()) {
    // OFF IS A VERDICT, not a silence. Without this the startup profile simply has no `checkpoint`
    // field on the launches where the feature was switched off — which is indistinguishable from a
    // build that predates the readout, and leaves "is the preference even on?" as the one question
    // a triage session still has to ask the user. (Caught by the e2e restart-compare's control arm,
    // which is exactly the arrangement that was silent.)
    decide({ outcome: 'off' })
    return null
  }
  installProbe()
  const modules = foldUnits()
  if (modules.length === 0) return null
  const res: RestoreResult = await readCheckpoint({
    cachePath: foldCachePath(characterId(ref)),
    logPath: ref.logPath,
    characterKey: `${ref.name}@${ref.server}`.toLowerCase(),
    modules
  })
  if (!res.restored) {
    // A refusal may have left SOME units holding a blob (the loader's all-or-nothing note), so the
    // world goes back to zero before the cold replay that follows. All THREE resets, in the same
    // order `resetWorldFor` does them — the detectors are units now, so a registry reset alone
    // would leave the half of the fold that publishes nothing half-restored.
    //
    // ONLY WHEN SOMETHING WAS ACTUALLY ADOPTED, and that condition was earned. This used to be
    // unconditional on the grounds that it was cheap and that reasoning about which half adopted
    // was the very state it avoided. It is not cheap: a reset BUMPS every module's private
    // revision counter, which is published as the snapshot's `seq` and is itself checkpointed — so
    // a launch that merely LOOKED for a cache and found none folded one revision ahead of a launch
    // that never looked, and every checkpoint written from it carried the offset forward. The e2e
    // restart-compare measured it (three modules, one count each) and the shadow verifier would
    // have reported a divergence on every check. The loader now says whether it touched anything,
    // so a refused cache leaves the world EXACTLY as a cold start would — which is what
    // "slow-once, never wrong" has to mean if it means anything.
    if (res.adopted) {
      registry.reset()
      combat.reset()
      // …AND RE-INJECT THE NAME THE RESET JUST DROPPED. `resetWorldFor` calls `setPlayerName` right
      // after its own `combat.reset()`, because the engine has to know whose heals are incoming
      // before the replay's first line — so a reset here without the re-injection would leave the
      // cold replay that follows in a state the cold path never has. (The registry's two injections
      // survive their own reset; the engine's does not, by design: `reset()` is also what a
      // character switch runs.)
      combat.setPlayerName(ref.name)
      epoch.reset()
      sessionDetector.reset()
    }
    decide({ outcome: 'refused', reason: res.why })
    logInfo(`[everquest-companion] Fold checkpoint: cold start (${res.why}).`)
    return null
  }
  lastEventTs = res.lastEventTs
  decide({ outcome: 'restored', offset: res.offset, origin: res.origin })
  logInfo(
    `[everquest-companion] Fold checkpoint: restored ${modules.length} modules at byte ${res.offset} (seq ${res.seq}, written at ${res.origin}); replaying the tail only.`
  )
  return { offset: res.offset, seq: res.seq }
}

/** Where the fold has reached, as the two writes below both state it. */
interface WriteAt {
  offset: number
  seq: number
  origin: CheckpointOrigin
}

/** Everything every write shares, so no two writes can disagree about where or for whom. */
function writeArgs(ref: CharacterRef, at: WriteAt, modules: readonly FoldUnit[]): WriteCheckpointArgs {
  return {
    cachePath: foldCachePath(characterId(ref)),
    logPath: ref.logPath,
    characterKey: `${ref.name}@${ref.server}`.toLowerCase(),
    offset: at.offset,
    seq: at.seq,
    lastEventTs,
    origin: at.origin,
    modules
  }
}

/**
 * WRITE A CHECKPOINT for the fold as it stands at `offset`. SYNCHRONOUS, because its caller is the
 * quit path — see `writeCheckpointSync`'s header for why that is not a shortcut.
 *
 * `offset` is the caller's: `Tailer.checkpointOffset()`, the end of the last COMPLETE line the live
 * tail emitted. The write TIMING is a tail-length pragmatic and not a correctness need (the design
 * says so) — a checkpoint at any byte position is as valid as one at any other — so a missed write
 * costs a longer tail replay next launch and nothing else.
 *
 * IT IS NO LONGER THE ONLY WRITE, and that was a real defect rather than a tuning question: a
 * process that is KILLED never runs a quit path, and electron-vite's dev watcher kills its child on
 * every reload. The owner ran with the preference on for a day, restarted repeatedly and never got
 * a single restore, because no file had ever been written. `saveFoldAsync` below is the fix; this
 * write stays as the freshest possible final word.
 */
export function saveFold(ref: CharacterRef, offset: number, seq: number): boolean {
  if (!foldCacheEnabled()) return false
  const modules = foldUnits()
  if (modules.length === 0) return false
  const ok = writeCheckpointSync(writeArgs(ref, { offset, seq, origin: 'quit' }, modules))
  logInfo(
    ok
      ? `[everquest-companion] Fold checkpoint: wrote ${modules.length} modules at byte ${offset} (quit).`
      : `[everquest-companion] Fold checkpoint: not written (byte ${offset}).`
  )
  return ok
}

/**
 * THE SAME WRITE, ASYNCHRONOUSLY — for the two writes that happen while the app is RUNNING.
 *
 * `replay` fires moments after the historical fold finishes: the fold has just been computed and
 * proven, so it is remembered right there rather than being staked on a shutdown that may never
 * come. `quiet` fires at idle moments through a long session so the next launch's tail stays short.
 *
 * WHAT IS SYNCHRONOUS ABOUT IT AND WHY. The module states are serialized in ONE turn inside
 * `writeCheckpoint` (its `serializeStates` note says why: a state captured across an `await` would
 * describe a byte position the fold has already left). That turn is the only cost this write puts on
 * the main loop, and the SCHEDULING is what keeps it off the hot path — `schedule.ts` never calls
 * this during the fold or while lines are arriving. Everything after it (the identity block's
 * bounded reads, the temp write, the rename) is off-thread.
 *
 * Failure is silent-but-logged, exactly like the quit write's: there is no caller behaviour to
 * change, because a launch with no checkpoint is the launch this app has always had.
 */
export async function saveFoldAsync(
  ref: CharacterRef,
  offset: number,
  seq: number,
  origin: CheckpointOrigin
): Promise<boolean> {
  if (!foldCacheEnabled()) return false
  const modules = foldUnits()
  if (modules.length === 0) return false
  const ok = await writeCheckpoint(writeArgs(ref, { offset, seq, origin }, modules))
  logInfo(
    ok
      ? `[everquest-companion] Fold checkpoint: wrote ${modules.length} modules at byte ${offset} (${origin}).`
      : `[everquest-companion] Fold checkpoint: not written (byte ${offset}, ${origin}).`
  )
  return ok
}
