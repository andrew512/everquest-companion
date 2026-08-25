/**
 * THE TWO FOLDS, COMPARED INSIDE THE RUNNING APP (JOS-479, phase 3).
 *
 * WHAT IS NEW HERE, AND WHY IT IS NOT `engine-boots`. That spec owns the LIFECYCLE seam — spawn,
 * ready, kill, respawn, quit, absence — and to observe a READY line it deliberately KILLS the
 * engine, because a tap attached when the launch resolves has already missed the first one. This
 * spec's subject is the opposite: an engine that lives long enough to fold a whole log and answer
 * questions about it. Putting both in one file would make each claim's evidence depend on the
 * other's staged failure (a probe running against the SECOND engine, its attach racing a backoff),
 * and it would put two full app launches and two full folds inside one 5-minute spec cap. Two
 * launches of two different shapes, so two specs.
 *
 * WHAT IT CLAIMS, in the order it proves them:
 *
 *   1. THE APP IS A CLIENT, AND THE ENGINE IS ON THE APP'S OWN LOG. The probe line's bracket quotes
 *      the engine's `session.health` mark — `mark <offset> of <path>`, the (log identity, byte
 *      offset) coordinate the whole design addresses state by (ruling 18 law 3) — and that path is
 *      the harness's private staged fixture. The engine NEVER DISCOVERS A PATH OF ITS OWN and never
 *      reads a settings file (`SessionAttachParams`), so an engine folding this file can only have
 *      been told to by this app's client. The epoch in the same bracket is `2` rather than `1`,
 *      which is the accepted attach that put it there.
 *
 *      WHY NOT ASSERT THE APP'S OWN `data-server engine attached: …` SENTENCE, which exists and is
 *      right there in the dev log? MEASURED on this ticket: it is printed BEFORE `electron.launch()`
 *      resolves, so a tap attached the instant a launch resolves has already missed it — the same
 *      rule `engine-boots.e2e.mts` documents for the READY line. And the mark echo is the stronger
 *      claim anyway: it is the ENGINE's statement about what it is doing, not the app's statement
 *      about what it asked for. Nothing here reaches for `window.eq`: the renderer is untouched by
 *      this ticket, and a spec that added a bridge to observe a main-process instrument would be
 *      testing a product nobody shipped.
 *
 *   2. BOTH WORLDS LANDED AND WERE COMPARED AT MATCHED MARKS. `skipped: 0` is load-bearing rather
 *      than tidy — the probe SKIPS any module whose two seqs disagree, so a run that skipped
 *      everything would report `0 diverge` and read like success.
 *
 *   3. THE VERDICT, MODULE BY MODULE, INCLUDING THE TWO THAT DO NOT AGREE — see below.
 *
 * ── THE TWO KNOWN ASYMMETRIES, MEASURED ON THIS TICKET AND PINNED RATHER THAN EXCUSED ──────────
 *
 * The brief expected all five to agree. They do not, and both reasons turned out to be structural
 * facts about where the wall clock and the filesystem live rather than fold defects — which is
 * precisely what an IN-APP probe can see and the offline oracle (`npm run oracle:rust-fold`, green
 * on all twenty modules over six slices) structurally cannot. So they are asserted as they are,
 * WITH THEIR PATHS, so that the day either is closed this spec goes red and somebody deletes the
 * exemption instead of a divergence quietly appearing under a green tick.
 *
 *   * `character` at `.character.lastPlayed` — the app's `CharacterRef` carries
 *     `statSync(logPath).mtimeMs` (`main/log/config.ts`), pushed into the module by
 *     `session.ts resetWorldFor`. It is a FILESYSTEM fact, not a fold fact; the engine derives its
 *     ref from the log's file NAME and never stats anything, so the field is honestly absent there
 *     (`engined/README.md`, "The fold seam"). The oracle cannot see this because its TS world is
 *     built from a three-field ref — MEASURED: a bench fold of this very fixture publishes
 *     `{name, server, logPath}` and no `lastPlayed`.
 *
 *   * `buffs` at `.active.length` — the engine published 12 actives and the app 3. MEASURED, on a
 *     bench fold of the same bytes: the TS fold publishes **12** before any tick and **3** after a
 *     single `registry.tick(Date.now())`. So the engine's fold agrees exactly with the app's fold;
 *     what differs is that the app runs a wall-clock heartbeat over its modules (`session.ts
 *     startHeartbeat`) and the engine's `Fold` never calls `on_tick` — deliberately, because no
 *     module in that crate may read a wall clock (ruling 18, law 1). Where the heartbeat lives once
 *     the fold is engine-side is a phase-3 design question, not a defect this spec can call.
 *
 * WHY THE FIXTURE MAKES THIS DETERMINISTIC. `logFixture.mts` stages a private copy of a committed
 * log and this spec never appends to it, so both folds read the same finite bytes and stop. On the
 * owner's live log the same probe would honestly report drift for anything the two worlds had not
 * reached together; here there is nothing left to reach. The two pinned divergences are stable for
 * the same reason: an mtime is always present, and the hygiene sweep only ever REMOVES actives, so
 * the two counts can never coincide however long the fixture ages.
 *
 * Run: `npm run test:e2e -- engine-parity`
 */
import { buildEngineIfStale, buildIfStale, check, failures, note, reportRun } from './appHarness.mjs'
import { closeWindows, mainWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLaunch } from './logFixture.mjs'
import { PARITY_PROBE_MODULES } from '../../src/main/dataServer/parityProbe'
import { settleParity, tapOutput, type AppOutput, type ParitySay } from './engineSteps.mjs'

/**
 * The richest committed fixture whose subject is the MODEL rather than a window: buff landings and
 * wear-offs, loot, kills and level-ups over 129 KB. Chosen because `buffs` is the hardest module in
 * the probe set — cluster 2c, a shared core with buffTimers, the message-overlay miner riding along
 * — and a fixture that never lands a buff would compare five empty states and prove very little.
 */
const FIXTURE = 'e2e-overlay.log'

/** The two divergences this ticket MEASURED and is pinning, with the exact path each occurs at.
 *  Every other module in the probe set must agree. Deleting a row here is how a fix is claimed. */
const KNOWN_ASYMMETRY: Readonly<Record<string, string>> = {
  character: '.character.lastPlayed',
  buffs: '.active.length'
}

/** Everything the app said about the engine — the failure detail for a claim whose evidence is a
 *  sentence that never arrived. */
function engineNarration(out: AppOutput): string {
  const said = out
    .text()
    .split('\n')
    .filter((line) => line.includes('data-server'))
  return said.slice(-6).join(' | ') || 'the app never mentioned the engine at all'
}

/** Windows says the same path in more than one case; the comparison is about WHICH FILE. */
function samePath(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
}

/**
 * STEP 1 — the engine is folding the app's own log, and says so itself.
 *
 * The strongest claim available without a renderer, and it needs no second wait: the engine's
 * `session.health` mark is quoted in the very line this spec already waited for. See the header for
 * why the app's own attach sentence is not the evidence.
 */
function stepEngineIsOnOurLog(launch: FixtureLaunch, parity: ParitySay): void {
  const where = parity.engineLog
  check(
    'the ENGINE says it is folding the very log this app staged — it discovers no path of its own, so the app told it',
    where !== null && samePath(where, launch.log.logPath),
    where === null ? parity.where : `engine ${where} · app ${launch.log.logPath}`
  )
  check(
    '…in a generation the app’s own session.attach created: a fresh engine is epoch 1, and this is not',
    /epoch [2-9]\d*/.test(parity.where),
    parity.where
  )
}

/** STEP 2 — the probe ran, both worlds had landed, and it compared rather than skipped. */
function stepProbeIsSound(parity: ParitySay): boolean {
  const live = check(
    'the probe waited for the ENGINE’s fold: it reports a live ingest with an event count of its own',
    /engine live/.test(parity.where) && /[1-9]\d* events/.test(parity.where),
    parity.where
  )
  const whole = check(
    `every module in the probe set was asked (${String(PARITY_PROBE_MODULES.length)})`,
    parity.probed === PARITY_PROBE_MODULES.length,
    `probed ${String(parity.probed)}`
  )
  // THE ANTI-VACUITY CHECK. A module whose two seqs disagree is SKIPPED, never compared, so a run
  // that skipped everything would report `0 diverge` and read like success.
  const compared = check(
    '…and every one of them was compared AT A MATCHED MARK — nothing was skipped for drift',
    parity.skipped === 0,
    `${String(parity.skipped)} skipped · ${parity.line}`
  )
  return live && whole && compared
}

/** One module the two worlds are expected to agree about. */
function checkAgrees(parity: ParitySay, module: string): void {
  const verdict = parity.verdict(module)
  check(
    `…${module}: the Rust fold's published state deep-equals this process's`,
    verdict === 'AGREE',
    verdict === 'AGREE' ? 'deep-equal' : `said ${verdict ?? 'nothing — the line never named it'}`
  )
}

/** One module carrying a known asymmetry: it must still diverge, and at exactly the known path. */
function checkKnownAsymmetry(parity: ParitySay, module: string, path: string): void {
  const where = parity.divergePath(module)
  const detail =
    where === path
      ? `still ${path}`
      : where === null
        ? `it says ${parity.verdict(module) ?? 'nothing'} now — if this is a FIX, delete the row from KNOWN_ASYMMETRY`
        : `diverged at ${where} instead — a NEW divergence, not the known one`
  check(`…${module}: the KNOWN asymmetry at ${path}, and nothing else`, where === path, detail)
}

/** STEP 3 — the verdict, module by module, so a red run names which fold moved. */
function stepVerdicts(parity: ParitySay): void {
  const expectedAgree = PARITY_PROBE_MODULES.filter((m) => !(m in KNOWN_ASYMMETRY))
  check(
    'the two folds agree everywhere they can: no divergence outside the two known asymmetries',
    parity.agree === expectedAgree.length && parity.diverge === Object.keys(KNOWN_ASYMMETRY).length,
    parity.line
  )
  for (const module of PARITY_PROBE_MODULES) {
    const known = KNOWN_ASYMMETRY[module]
    if (known === undefined) checkAgrees(parity, module)
    else checkKnownAsymmetry(parity, module, known)
  }
}

async function main(): Promise<void> {
  buildIfStale()
  // The engine's own gate — build.mts says why it is a second gate rather than a wider `isFresh`.
  buildEngineIfStale()

  const launch = await launchOnFixture(FIXTURE, { env: { EQC_ENGINE: '1' } })
  // FIRST, before anything is driven: every line the app prints from here is this spec's evidence.
  const out = tapOutput(launch.app)
  let parity: ParitySay | null = null
  try {
    await mainWindow(launch.app)
    parity = await settleParity(out)
    const ran = check(
      'the parity probe runs once BOTH worlds have landed, and says so in one line',
      parity !== null,
      parity === null ? engineNarration(out) : parity.line
    )
    if (ran && parity !== null) {
      stepEngineIsOnOurLog(launch, parity)
      if (stepProbeIsSound(parity)) stepVerdicts(parity)
    }
    await closeWindows(launch.app)
  } finally {
    await launch.close()
  }

  if (parity !== null) note(`the probe reported: ${parity.line}`)
  if (failures.length === 0) {
    note('LOG ONLY, by ruling: the probe writes one dev-log line and no product code reads a verdict')
    note('the two pinned divergences are wall-clock and filesystem asymmetries, not fold defects — the header carries both measurements')
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
