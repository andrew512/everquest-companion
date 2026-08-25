// ============================================================================
// engineHost.ts — the composition root's half of the engine supervisor (JOS-467, phase 0).
// ============================================================================
//
// `supervisor.ts` is the state machine and imports nothing from Electron, Node's child process or
// Node's net. This file is everything that was left over when that was made true: which binary,
// which spawn, which socket, which clock, where a line goes. It is the same split
// `processPriority.ts` describes — mechanism there, policy and wiring here — and it is deliberately
// the only file in `src/main/dataServer` that anybody would have to rewrite to run the engine some
// other way.
//
// THE FLAG. `EQC_ENGINE=1` in the environment, and nothing else, turns this on. It is an
// environment variable rather than a store preference or a vite `define` on purpose:
//   * a STORE PREFERENCE would be a user-facing switch for a feature no user can see yet, and
//     phase 0 ships no renderer surface at all;
//   * a VITE DEFINE would need the owner to restart `npm run dev` to change (AGENTS.md's rule), and
//     the whole point of this phase is that a developer can start and stop the engine at will;
//   * an env var read at boot is a thing the DEV can flip in one shell and the packaged app can
//     never accidentally inherit.
// THE E2E HARNESS IS NOT A SPECIAL CASE HERE, and that is deliberate rather than an omission. Every
// other gate in this process restates `EQ_E2E` because the thing it guards happens by DEFAULT (the
// sound-pack download, the telemetry flush, the presence thread); this one happens only when
// somebody sets a variable, and the harness sets nothing. So the suite is already unaffected —
// there is nothing to suppress — while the queued real-binary e2e (JOS-470) can opt in by setting
// both variables instead of having to undo a gate. The rule this repo actually keeps is that the
// test mode changes as little about the product as possible.
//
// AND SINCE JOS-479 THE FLAG BUYS ONE MORE THING: the app's own CLIENT. `engineClientHost.ts`
// connects to the launch this file supervises, attaches the engine to the log this process is
// tailing, and runs the parity probe. It is armed from inside the guard below and torn down beside
// the supervisor, so `EQC_ENGINE` remains the single switch for the whole feature — a second gate
// would be a second thing to forget.
//
// WHAT IT LOOKS LIKE WITH NO BINARY — which is any checkout that has not run `cargo build`, since
// a PACKAGED build now carries its own (JOS-473 ships `resources/engine/engined.exe`). The
// supervisor probes, finds nothing, logs one line naming what it looked for, and stops. No
// error-store entry, no retry storm, no crash. Absence is a CONDITION here, not a failure.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { logError, logInfo } from '../errorLog'
import { setEnginePid } from '../processPriority'
import { mintToken } from './token'
import { engineBinaryCandidates } from './engineProtocol'
import { connectToEngine } from './socketChannel'
import { createEngineSupervisor, type EngineSupervisor, type SupervisedChild } from './supervisor'
// THE APP'S OWN CLIENT (JOS-479, phase 3). It lives behind THIS file's flag and nothing else, which
// is why it reads no environment variable of its own: one gate, in one place.
import { installEngineClient, onEngineReady, stopEngineClient } from './engineClientHost'

/** How long a loopback connect may take before the probe gives up on it. Loopback either answers
 *  immediately or is not listening; this is a bound on the pathological case, not a budget. */
const CONNECT_TIMEOUT_MS = 2_000

/** The one instance. Module-level like every other singleton in `src/main`, because there is one
 *  app and one engine; the CLASS is per-instance so tests never see this. */
let supervisor: EngineSupervisor | null = null

/** Is the engine wanted on this launch at all? ONE variable, read at boot. */
export function engineEnabled(): boolean {
  return process.env.EQC_ENGINE === '1'
}

/**
 * Find the engine binary, or say there is none.
 *
 * A PROBE, not a guess — `sounds.ts bundledRoots()`'s precedent, and for its reason: one source
 * tree produces a dev run, an e2e build and a packaged app, and which one is running is not
 * something a module can read off its own path. The candidate list and its ORDER live in
 * `engineProtocol.ts` (pure, and therefore pinned by a test); the `existsSync` is here, because
 * touching the disk is exactly the kind of thing the pure half must not do.
 *
 * It NARRATES ITS OWN FAILURE. A resolver that answers null in silence is how "the feature is off"
 * and "the feature is broken" become the same observation; naming every path it looked at makes
 * the dev's next move obvious (`cargo build -p engined`).
 */
function resolveEngineBinary(): string | null {
  const candidates = engineBinaryCandidates({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath ?? '',
    cwd: process.cwd()
  })
  const found = candidates.find((path) => existsSync(path))
  if (found === undefined) {
    logInfo(`[everquest-companion] engine binary not found; looked in: ${candidates.join(', ')}`)
    return null
  }
  return found
}

/**
 * Spawn the engine.
 *
 * NO SECRETS IN ARGV OR ENV (contract rule 1): no arguments at all, and the environment is
 * inherited untouched. The token goes down stdin, which is why all three streams are pipes.
 *
 * `windowsHide` so a console window never flashes over a full-screen game — the same courtesy every
 * other child this app has ever spawned was given. `cwd` is the binary's own directory, matching
 * the DLL-resolution law in AGENTS.md: a shipped native binary resolves its imports from its own
 * directory, so that is where it should be standing.
 */
function spawnEngine(binPath: string): SupervisedChild {
  return spawn(binPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: dirOf(binPath)
  })
}

/** The directory part of a path, with either separator. Two lines rather than a `node:path` import
 *  because `engineBinaryCandidates` builds these strings with `/` and `dirname` on Windows is happy
 *  with both — this keeps the two halves spelling paths the same way. */
function dirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut === -1 ? '.' : path.slice(0, cut)
}

/**
 * Start the supervisor, if this launch wants an engine.
 *
 * Called from the composition root beside `startTailing`. Idempotent: a second call while one is
 * running is the supervisor's own no-op.
 */
export function startEngineSupervisor(): void {
  if (!engineEnabled()) return
  // ARMED BEFORE THE SUPERVISOR CAN REACH READY. `installEngineClient` only registers the
  // world-rebuilt observer — it opens no socket — but the TypeScript fold can land at any moment
  // and a rebuild that arrived before the observer existed would be a rebuild the client never
  // hears about, i.e. an engine that stays pointed at nothing until the next character switch.
  installEngineClient()
  supervisor ??= createEngineSupervisor({
    resolveBinary: resolveEngineBinary,
    spawn: spawnEngine,
    connect: (port) => connectToEngine(port, CONNECT_TIMEOUT_MS),
    mintToken,
    // UNREF'D, ALWAYS. Nothing this supervisor holds may be the reason a quitting process stays
    // alive — `presence.ts`'s rule for its restart timer, and the same hazard: a 30 s backoff timer
    // armed at the moment the user hits X would otherwise hold the app open for 30 seconds.
    timer: (fn, ms) => {
      const handle = setTimeout(fn, ms)
      handle.unref?.()
      return () => clearTimeout(handle)
    },
    now: () => Date.now(),
    debug: (line) => logInfo(`[everquest-companion] ${line}`),
    // The name/message/code triple `engineProtocol.ts` built. `logError` reads `name`, `message`,
    // `stack` and `code` off whatever it is handed (`caughtFields`), which is the whole reason the
    // supervisor reports an OBJECT rather than an Error — see childProcessGone.ts's header for the
    // five releases that lesson cost.
    report: (log) => logError('main:dataServerEngine', log),
    // The priority arm. Below-normal, following the same switch as the rest of the app — the
    // argument is on `setEnginePid` in processPriority.ts.
    onPid: setEnginePid,
    // …and the CLIENT arm (JOS-479): the port and the launch's token, at the one moment a round
    // trip has proven there is something to talk to. `onPid` is about a process and this is about a
    // connection — see the dep's own comment for why they are two callbacks rather than one.
    onReady: onEngineReady
  })
  supervisor.start()
}

/**
 * Stop the engine. Called from BOTH quit paths through `teardownStep`, for `stopPresenceEffects`'s
 * reason exactly: `window-all-closed` is the ordinary teardown but an auto-updater's
 * `quitAndInstall`, an `app.quit()` from anywhere, or an OS logoff can reach `before-quit` on a
 * path that never lands there — and a CHILD PROCESS is the case Windows does not clean up for us.
 * Idempotent, so running it twice costs one `end()` on a closed pipe.
 *
 * IT DOES NOT WAIT. Closing stdin is the shutdown signal and the engine exits on its own; the
 * escalation to `kill` is armed on an unref'd timer inside the supervisor. Blocking quit on a
 * child's exit is how a wedged child becomes a window that will not close.
 */
export function stopEngineSupervisor(): void {
  // THE CLIENT GOES FIRST, and the order is the same courtesy the supervisor extends to the engine:
  // closing our socket before closing the engine's stdin means the engine sees a client leave and
  // then a shutdown, rather than being asked to exit while a connection is still open. Idempotent
  // and safe on a launch that never armed a client.
  stopEngineClient()
  supervisor?.stop()
  setEnginePid(null)
}
