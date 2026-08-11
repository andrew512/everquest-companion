/**
 * ============================================================================
 * fold-restart.e2e.mts — THE RESTART-COMPARE (JOS-208 phase 3, deliverable 1).
 * ============================================================================
 *
 * The owner's law for the startup checkpoint is
 *
 *     restore(checkpoint(fold(prefix))) + fold(tail)   ==   fold(prefix + tail)
 *
 * and `tests/foldCheckpointDifferential.test.mts` proves it over the fixture corpus at a matrix of
 * split points — in ONE process, with the modules constructed by hand. What that harness cannot
 * see is the ELECTRON GLUE, which is most of what a user actually depends on: `foldCache/attach.ts`
 * deciding, `session.ts` starting the scan at B instead of 0, `foldCache/schedule.ts` writing at
 * all, the teardown steps, the container landing in a real `userData`, and the loader reading it
 * back on a genuinely new process. Phase 1 shipped every one of those unproven.
 *
 * SO THIS SPEC RESTARTS THE REAL APP AND COMPARES WHAT THE RENDERER SEES. Its control is the same
 * app, on the same log, in the same `userData`, with the checkpoint switched off for one launch —
 * which is the only control worth having: a fresh `userData` would differ in store-derived state
 * (alert ids, prefs) and every difference it produced would have to be explained away.
 *
 * FOUR ARRANGEMENTS, in one sequence of seven launches:
 *
 *   1. A KILLED FIRST LAUNCH. The app is hard-killed after its fold — no quit events, nothing
 *      graceful — and the NEXT launch still restores. This is the owner's own repro: phase 1 wrote
 *      only on the clean-quit paths, electron-vite's dev watcher kills its child, and he ran the
 *      feature for a day with the preference on and never once got a restore or even a file.
 *   2. A PLAIN RESTART, no new bytes: restore + an empty tail must equal a cold fold.
 *   3. A STAGED TAIL: a scripted fight is appended between the two launches, so the warm arm
 *      restores at B and folds a real tail, and the control folds [0, EOF) in one go.
 *   4. AN INVALIDATED CACHE: a byte of the container is flipped. The app must cold-replay — and
 *      still match, because the failure mode this feature is allowed to have is slow-once.
 *
 * …plus the shadow verifier (deliverable 2) driven end to end on the real app, so the counter that
 * gates the whole rollout is observed doing its job rather than assumed to.
 *
 * WHY THE VERDICT ASSERTIONS ARE NOT DECORATION. A "warm" launch whose cache was quietly refused
 * would cold-replay, match the control perfectly and pass — proving nothing. So every launch is
 * held against `perf-startup.json`'s checkpoint verdict (deliverable 3), which states restored /
 * refused+reason / off and, when restored, WHICH WRITE produced the file it read.
 *
 * Run: `node --import tsx tests/e2e/fold-restart.e2e.mts` (also in tests/e2e/run-all.mts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIfStale, check, note, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { closeWindows, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import {
  cachePath,
  checkSame,
  settleVerdict,
  checkVerdict,
  settleContainer,
  corruptCache,
  hardKill,
  lastLogInstant,
  mainOutput,
  moduleSnapshots,
  resetLearnedOverlay,
  settleCacheWritten,
  telemetryEvents,
  userDataListing,
  type Snapshots
} from './foldRestartSteps.mjs'

/** Cache ON for a launch, through the dev escape hatch — never by writing the user's settings. */
const WARM = { EQ_FOLD_CACHE: '1' }
/** …and OFF, which is the CONTROL. The env var overrides in both directions (foldCache/flag.ts). */
const COLD = { EQ_FOLD_CACHE: '0' }

/**
 * A scripted pull, for the staged-tail arrangement. Damage this repo STATES (the `gameplay.mts`
 * discipline): a zone line, two swings, a kill and a loot line, a second apart, so the tail carries
 * a real encounter — an open fight, a kill, a drop — rather than four bytes the fold barely notices.
 *
 * IT CONTINUES THE LOG'S OWN CLOCK rather than starting at wall-clock now, and that is a measured
 * correction rather than a nicety: see `lastLogInstant`. A tail stamped "today" on top of a fixture
 * whose last line is weeks old manufactures an offline gap, and the world model's answer to an
 * unexplained gap is deliberately wall-clock sensitive — so the two arms of this comparison would
 * be answering a question about time rather than about the checkpoint.
 */
function playTail(log: FixtureLog): void {
  const at = new Date(lastLogInstant(log.logPath).getTime() + 1_000)
  const step = (n: number): Date => new Date(at.getTime() + n * 1_000)
  log.appendAt(step(0), 'You have entered Plane of Fear.')
  log.appendAt(step(1), 'You slash a fire giant warrior for 128 points of damage.')
  log.appendAt(step(2), 'You crush a fire giant warrior for 64 points of damage.')
  log.appendAt(step(3), 'You have slain a fire giant warrior!')
  log.appendAt(step(4), '--You have looted a Fire Emerald.--')
}

/**
 * One launch: run it, read every module's snapshot, and quit it the way a USER quits.
 *
 * `closeWindows` rather than `close()` alone, and it matters here as much as it does in the
 * telemetry spec that measured it (appWindow.mts's header): `ElectronApplication.close()` calls
 * `app.quit()`, which never emits `window-all-closed`, so the whole teardown list hanging off that
 * event — `stopSession`, `stopTelemetry`, `stopPerf` — is skipped. A restart-compare that exited
 * the wrong way would be comparing launches that never really shut down.
 */
async function readSnapshots(
  log: FixtureLog,
  userData: string,
  env: Record<string, string>
): Promise<Snapshots> {
  resetLearnedOverlay(userData)
  const { app, close } = await launchOnFixture(log, { userData, env })
  try {
    const page = await mainWindow(app)
    await waitHydrated(page)
    const snap = await moduleSnapshots(page)
    await closeWindows(app)
    return snap
  } finally {
    await close()
  }
}

// ---- 1. the killed first launch ------------------------------------------------------------

/**
 * LAUNCH 1 EXISTS TO BE KILLED. It folds the fixture cold, and the `replay` write — four seconds
 * after the fold finishes — is what has to leave a checkpoint behind, because nothing else will:
 * this process is going to be terminated where it stands.
 */
async function stepSeedAndKill(log: FixtureLog, userData: string): Promise<void> {
  console.log('launch 1: fold cold, write the checkpoint, then get killed…')
  const { app, close } = await launchOnFixture(log, { userData, env: WARM })
  try {
    const page = await mainWindow(app)
    await waitHydrated(page)
    // THE CONDITION IS THE FILE APPEARING, not a sleep past the write's delay.
    const file = await settleCacheWritten(userData)
    // …and the profile is written when the LAST phase lands, which races the hydration wait above,
    // so the verdict is read only once there is a checkpoint to have decided about.
    await settleVerdict(userData)
    checkVerdict('launch 1', userData, { outcome: 'refused' })
    if (!check('a checkpoint is written while the app is RUNNING, with no quit involved', file !== null)) return
    const header = await settleContainer(file as string)
    check(
      '…and it says which write made it: the post-fold one, not a shutdown',
      typeof header !== 'string' && header.origin === 'replay',
      JSON.stringify(header)
    )
  } finally {
    // NOT `close()`: the whole arrangement is a process that never gets to run a teardown step.
    await hardKill(app)
    void close
  }
}

// ---- 2 & 3. the restart compares -------------------------------------------------------------

/** One warm launch, one cold control, compared — the spec's whole assertion, run twice. */
async function stepCompare(
  tag: string,
  log: FixtureLog,
  userData: string,
  wantOrigin: string
): Promise<void> {
  console.log(`${tag}: restore + tail, then the same app with the checkpoint switched off…`)
  const warm = await readSnapshots(log, userData, WARM)
  const verdict = checkVerdict(tag, userData, { outcome: 'restored', origin: wantOrigin })
  const cold = await readSnapshots(log, userData, COLD)
  checkVerdict(`${tag} control`, userData, { outcome: 'off' })
  note(`${tag}: the warm launch resumed at byte ${String(verdict?.offset ?? 0)}`)
  checkSame(tag, warm, cold)
}

// ---- 4. the invalidation ----------------------------------------------------------------------

/**
 * A CORRUPT CONTAINER MUST LAND ON THE COLD PATH AND STILL BE RIGHT.
 *
 * The design's principle is that the log stays truth and a checkpoint is only a memo, so any doubt
 * discards it: the failure mode is slow-once, never wrong. This is that sentence, executed.
 */
async function stepInvalidated(log: FixtureLog, userData: string, cold: Snapshots): Promise<void> {
  console.log('the invalidation variant: flip a byte in the container and launch anyway…')
  const file = cachePath(userData)
  if (!check('there is a container to corrupt', file !== null)) return
  const at = corruptCache(file as string)
  const warm = await readSnapshots(log, userData, WARM)
  const verdict = checkVerdict('corrupt', userData, { outcome: 'refused' })
  check(
    '…and the refusal names the doubt that caught it, rather than a shrug',
    typeof verdict?.reason === 'string' && verdict.reason.startsWith('decode:'),
    `${JSON.stringify(verdict)} (byte ${String(at)} flipped)`
  )
  checkSame('corrupt', warm, cold)
}

// ---- the shadow verifier ----------------------------------------------------------------------

/**
 * DELIVERABLE 2, END TO END. The background verification is sampled — an installed build takes two
 * launches in a hundred — so the spec forces it with `EQ_FOLD_SHADOW=1`, the same dev escape hatch
 * `EQ_FOLD_CACHE` already is and for the same stated reason.
 *
 * WHAT IS ASSERTED IS THE WHOLE PATH: a real launch restores from a real container, re-folds the
 * log the slow way in a throwaway world, compares every published snapshot, finds nothing, and
 * leaves a COUNT on the session report — and the report carries no hint of what was compared,
 * which is the bright line this feature is shaped around.
 */
async function stepShadow(log: FixtureLog, userData: string): Promise<void> {
  console.log('the shadow verifier: cold-fold it again in the background and compare…')
  const { app, close } = await launchOnFixture(log, {
    userData,
    env: { ...WARM, EQ_FOLD_SHADOW: '1' }
  })
  const out = mainOutput(app)
  try {
    const page = await mainWindow(app)
    await waitHydrated(page)
    // The verification stamps its duty-cycle mark BEFORE it starts work, so the mark appearing is
    // the condition that says it ran at all. (It is stamped first on purpose: a verification that
    // takes the process down with it must still count, or a repeatable failure becomes a cold read
    // on every launch forever.)
    const started = await settle(
      () => Promise.resolve(shadowMark(userData)),
      (ms) => ms > 0,
      { timeoutMs: 60_000 }
    )
    if (!check('a forced launch really does run the background verification', started > 0)) return
    // …and its ANSWER is a `logInfo`, i.e. the line an owner reads in their terminal. Waiting for
    // it is the completion condition; the ring assertion below is about the WIRE shape.
    const said = await settle(
      () => Promise.resolve(out.lines.filter((l) => l.includes('Fold shadow:'))),
      (ls) => ls.length > 0,
      { timeoutMs: 90_000 }
    )
    check(
      'the verification compares the checkpoint against a cold fold and finds NOTHING',
      said.some((l) => l.includes('matches a cold fold')),
      said.join(' | ') || 'the verifier never said anything'
    )
    // …and the counters reach the ring on `sessionEnd`, which only a REAL quit writes.
    await closeWindows(app)
  } finally {
    await close()
  }
  // The counters reach the local ring on `sessionEnd`, which the clean close above just wrote.
  const reports = telemetryEvents(userData).filter(
    (ev) => ev.t === 'sessionEnd' || ev.t === 'sessionHeartbeat'
  )
  const carrier = reports.find((ev) => typeof ev.checkpointShadowChecks === 'number')
  if (
    !check(
      'the verification lands on a session report as a COUNT',
      carrier !== undefined,
      // The ring and the dir listing only when it is MISSING — on the happy path the interesting
      // reading is the next two checks, and a screenful of every session this spec ran buries them.
      carrier === undefined ? `${JSON.stringify(reports)} | ${userDataListing(userData)}` : `${String(reports.length)} session reports`
    )
  ) {
    return
  }
  const ev = carrier as Record<string, unknown>
  check(
    '…one check, ZERO divergences — the fold survives the round trip through the real app',
    ev.checkpointShadowChecks === 1 && ev.checkpointDivergences === 0,
    JSON.stringify(ev)
  )
  // THE BRIGHT LINE, asserted on the bytes that would actually leave the machine: the report may
  // say THAT something diverged, never WHICH. A module name is a claim about the player's game.
  const text = JSON.stringify(ev)
  check(
    '…and the report names no module, no field and no value',
    !/loot|respawn|kills|combo|progression|leveling|buff/i.test(text),
    text
  )
}

/**
 * The verifier's duty-cycle mark, out of the launch's own settings file.
 *
 * `STORE_NAME` is spelled out rather than imported, the same way tests/e2e/telemetry.e2e.mts spells
 * it: the constant lives in `src/main/channel.ts`, which imports Electron at module scope and so
 * cannot be loaded by a plain node process.
 */
function shadowMark(userData: string): number {
  try {
    const raw = JSON.parse(
      readFileSync(join(userData, 'everquest-companion-progress.json'), 'utf8')
    ) as { foldCache?: { shadowLastMs?: unknown } }
    return typeof raw.foldCache?.shadowLastMs === 'number' ? raw.foldCache.shadowLastMs : 0
  } catch {
    return 0
  }
}

// ---- the flow ---------------------------------------------------------------------------------

async function main(): Promise<void> {
  await buildIfStale()
  const userData = makeUserData()
  // ONE staged install for every launch: the whole spec turns on seven processes reading the same
  // growing file, which is exactly the arrangement a restart is.
  const log = stageFixture('e2e-combat.log')
  try {
    await stepSeedAndKill(log, userData)

    // 2. THE PLAIN RESTART. The container came from the killed launch's post-fold write, so this
    //    is also the assertion that the kill cost nothing.
    await stepCompare('restart', log, userData, 'replay')

    // 3. THE STAGED TAIL. The control launch above ran with the cache OFF and therefore wrote
    //    nothing, so the container standing here is the one the WARM launch left on its clean
    //    quit — which is why this arrangement expects the 'quit' origin and covers that write too.
    playTail(log)
    await stepCompare('staged tail', log, userData, 'quit')

    // 4. THE INVALIDATION. The cold control from the run above is the answer it must still reach.
    const cold = await readSnapshots(log, userData, COLD)
    await stepInvalidated(log, userData, cold)

    await stepShadow(log, userData)
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }
  reportRun()
}

void main()
