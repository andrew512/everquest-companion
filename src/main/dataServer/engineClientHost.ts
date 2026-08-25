// ============================================================================
// engineClientHost.ts — THE APP BECOMES A CLIENT OF ITS OWN ENGINE (JOS-479, phase 3).
// ============================================================================
//
// Three things existed before this file and none of them had ever met. `supervisor.ts` spawns the
// engine and proves it healthy (JOS-467). `shared/dataServer/client.ts` is the app's side of the
// protocol — epoch law, typed requests, subscriptions (JOS-468). `engined` serves `module.snapshot`
// off a real twenty-module fold (JOS-478). This is the wiring that joins them INSIDE THE RUNNING
// PRODUCT, and it is the moment owner ruling 20 names: the first real client testing against the
// server.
//
// WHAT IT DOES, in five sentences. When the supervisor says READY it takes the port and the token
// that launch minted, opens one loopback connection, hellos, and attaches the engine to THE SAME
// LOG THIS PROCESS IS TAILING. When the character changes — or any time the TypeScript world is
// rebuilt — it attaches again, because that is the same funnel and last-pick-wins is the ENGINE's
// law now (`session.attach` preempts, never queues). When the engine dies and is respawned it does
// all of that over: a respawn is a launch, the token and port are new, resume is re-query. When
// both worlds have landed on the same log it runs THE PARITY PROBE and writes one line to the dev
// log. And that line is the entire user-visible surface of this ticket.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
//
// No IPC, no `window.eq`, no renderer anything. No store write. No branch in the product reads
// anything the engine says. The TypeScript fold remains the app's only source of truth and will be
// until the cutover deletes it (plan, phase 3). The cost when `EQC_ENGINE` is unset is exactly one
// `if` in `engineHost.ts` — `installEngineClient` is never called, no observer is registered, and
// `pipeline.ts sendWorldRebuilt` finds a null.
//
// ── WHY A FRESH CLIENT PER LAUNCH, RATHER THAN `client.attach` OVER A REPLACEMENT TRANSPORT ────
//
// `EngineClient` takes its token at construction and holds it for the life of the object, which is
// right: a token IS the identity of one connection to one launch. A respawn mints a NEW secret
// (contract rule 5), so a client that survived it would be an object holding credentials for a
// process that no longer exists. So a respawn builds a new client and closes the old one, and
// `client.attach` is used for what it is for — handing this client its transport, which is also the
// path a future reconnect-to-the-same-launch would take. Nothing is carried across, which is
// exactly the resume-is-requery law the client library already enforces on its own state.
//
// ── PREEMPTION, LOCALLY ────────────────────────────────────────────────────────────────────────
//
// Everything below is asynchronous — a connect, an attach round trip, a fold that takes as long as
// the log is big, five snapshot round trips — and all of it can be superseded mid-flight by a
// character switch or an engine respawn. `switchController.ts`'s answer is the one used here: a
// GENERATION counter, re-asked after every suspension point. A turn that has lost touches nothing
// and, in particular, WRITES NO LINE — a parity verdict from a world somebody has since replaced
// would be a measurement of nothing, printed with authority.

import { logInfo } from '../errorLog'
import { registry, setWorldRebuiltObserver } from '../pipeline'
import { getActiveCharacter } from '../session'
import { createEngineClient, EngineError, type EngineClient } from '../../shared/dataServer/client'
import { createNdjsonTransport, type ByteChannel } from '../../shared/dataServer/ndjson'
import type { ClientMessage, EngineMessage } from '../../shared/dataServer/protocol.generated'
import { connectToEngine } from './socketChannel'
import {
  PARITY_PROBE_MODULES,
  judgeParity,
  parityLine,
  type EngineMark,
  type ParityAsk,
  type ParityVerdict
} from './parityProbe'
import type { ReadyEngine } from './supervisor'
import type { CharacterRef } from '../../shared/types'

/** How long the client's own loopback connect may take. The supervisor's probe just completed a
 *  round trip on this port, so this is a bound on the pathological case and not a budget. */
const CONNECT_TIMEOUT_MS = 2_000

/** How long the probe waits for the ENGINE's fold to land before it gives up and reports what it
 *  actually found. A bound rather than a deadline: an engine still `folding` is not broken, and the
 *  line says `folding` and reports every module as drifted, which is the honest reading. Generous
 *  because a first attach on the owner's real log is hundreds of megabytes. */
const FOLD_WAIT_BUDGET_MS = 120_000
const FOLD_POLL_MS = 400

/** One live engine and the client talking to it. */
interface LiveEngine {
  readonly engine: ReadyEngine
  readonly client: EngineClient
  /** The log this client last successfully attached the engine to. */
  attachedTo: string | null
}

let live: LiveEngine | null = null

/**
 * The log the TYPESCRIPT world last finished folding, or null when nothing is attached.
 *
 * It is the probe's readiness half. `sendWorldRebuilt` is the app's own "the fold landed and every
 * consumer should re-hydrate" moment, so it is precisely when this process's module snapshots stop
 * being a mid-scan prefix — and comparing a mid-scan prefix against the engine would report a race.
 */
let tsWorldPath: string | null = null

/** THE TURN. Bumped by every event that replaces the world: a new engine, a character switch, a
 *  rebuild. Read after every `await` — see the header. */
let gen = 0

function debug(line: string): void {
  logInfo(`[everquest-companion] ${line}`)
}

/** A promise that resolves later without ever being the reason this process stays alive —
 *  `engineHost.ts`'s timer rule, restated for the one place here that waits on a clock. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const handle = setTimeout(resolve, ms)
    handle.unref()
  })
}

function describeErr(err: unknown): string {
  if (err instanceof EngineError) return `${err.code}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/**
 * Where the engine should be pointed right now.
 *
 * TWO SOURCES, AND THE ORDER MATTERS. `tsWorldPath` is the log whose fold has LANDED here, which is
 * what the probe compares against; `getActiveCharacter()` is the log this process is tailing, which
 * during a historical fold is already the new character. Preferring the former means a re-attach
 * caused by a rebuild names the log that rebuild was about; falling back to the latter is what lets
 * an engine that became ready DURING the first fold attach immediately instead of sitting idle
 * until something else happens.
 */
function attachTarget(): string | null {
  return tsWorldPath ?? getActiveCharacter()?.logPath ?? null
}

// ── the connection ─────────────────────────────────────────────────────────────────────────────

/**
 * THE SUPERVISOR'S READY EDGE. `null` means the launch that was ready is over.
 *
 * Synchronous by signature because the supervisor's callback is, and every asynchronous thing it
 * starts is voided deliberately: a supervisor must never be made to wait on a client.
 */
export function onEngineReady(info: ReadyEngine | null): void {
  gen += 1
  const mine = gen
  live?.client.close()
  live = null
  if (info === null) {
    debug('data-server client: the engine is gone; the connection is closed')
    return
  }
  const client = createEngineClient({
    token: info.token,
    debug: (note) => {
      debug(`data-server client: ${note}`)
    }
  })
  live = { engine: info, client, attachedTo: null }
  void openConnection(mine, info, client)
}

async function openConnection(mine: number, info: ReadyEngine, client: EngineClient): Promise<void> {
  let channel: ByteChannel
  try {
    channel = await connectToEngine(info.port, CONNECT_TIMEOUT_MS)
  } catch (err) {
    debug(`data-server client: could not reach the engine on port ${String(info.port)} (${describeErr(err)})`)
    return
  }
  if (gen !== mine) {
    channel.close()
    return
  }
  // The hello rides this call — the client sends it the moment it has a transport, and queues
  // everything else behind the answer, so there is no handshake to sequence here.
  client.attach(createNdjsonTransport<ClientMessage, EngineMessage>(channel))
  debug(`data-server client: connected to the engine on port ${String(info.port)}`)
  await attachAndProbe(mine)
}

// ── the attach ─────────────────────────────────────────────────────────────────────────────────

/**
 * Point the engine at the app's log, then — if the app's own fold has landed on it — compare.
 *
 * THE ATTACH HAPPENS EVEN WHEN THE PROBE CANNOT. An engine that becomes ready mid-fold should start
 * reading the log immediately; the comparison waits for the other world, and the two are separate
 * questions.
 */
async function attachAndProbe(mine: number): Promise<void> {
  const target = attachTarget()
  const l = live
  if (l === null || gen !== mine) return
  if (target === null) {
    debug('data-server client: no character is attached here, so the engine is left idle')
    return
  }
  // AN ATTACH IS A WHOLE RE-FOLD, so it is sent only when the FILE changes. This runs twice on an
  // ordinary launch — once when the engine becomes ready (pointed at the log this process is
  // already tailing) and once when this process's own fold lands on that same log — and issuing a
  // second attach there would make the engine read the whole log twice for nothing. It is not a
  // freshness risk: the engine folded the same file from byte zero and has been tailing it since,
  // which is the same lossless seam the app's own scan→tail handoff is. A character switch changes
  // the path and does attach, which is the case the re-attach exists for.
  if (l.attachedTo !== target && (await sendAttach(mine, l, target)) === null) return
  if (gen !== mine) return
  if (tsWorldPath !== target) {
    debug('data-server client: the app has not finished folding this log yet — the parity probe waits')
    return
  }
  await runParityProbe(mine, l, target)
}

/** `session.attach`, and what it answered. Null when it was refused or superseded. */
async function sendAttach(mine: number, l: LiveEngine, logPath: string): Promise<number | null> {
  try {
    const result = await l.client.request('session.attach', { logPath })
    if (gen !== mine) return null
    l.attachedTo = logPath
    debug(
      `data-server engine attached: ${logPath} (epoch ${String(result.epoch)}, ` +
        `accepted ${String(result.accepted)})`
    )
    return result.epoch
  } catch (err) {
    debug(`data-server client: session.attach was refused (${describeErr(err)})`)
    return null
  }
}

/**
 * THE CHARACTER-SWITCH FUNNEL, and the app-side half of the probe's readiness.
 *
 * Registered on `pipeline.ts sendWorldRebuilt`, which is the ONE place this process says "the world
 * for this character was rebuilt" — the same signal every window that folds a module already rides.
 * A switch reaches it, the idle rescan reaches it, an EQ-dir change reaches it, and a live epoch
 * boundary reaches it, so hooking it is how this feature inherits every one of those without a
 * second call site to keep in step.
 *
 * A REBUILD OF THE SAME LOG IS NOT A RE-ATTACH — see `attachAndProbe`. It is still a fresh TURN and
 * a fresh probe, because this process's snapshots have just been rebuilt and are worth re-checking.
 */
function onWorldRebuilt(character: CharacterRef | null): void {
  tsWorldPath = character?.logPath ?? null
  gen += 1
  const mine = gen
  const l = live
  if (l === null) return
  if (tsWorldPath === null) {
    // The app stopped tailing (an EQ dir with no logs). There is no `session.detach` in the
    // protocol and inventing one here would be a schema change; the engine keeps folding a file
    // nobody is asking about until the next attach replaces it, which costs a tail poll. Forgetting
    // what it is attached to is how that next attach is guaranteed to be sent — even if the log the
    // app comes back to is the one the engine still has open, which after an interlude of not
    // watching is the safe direction.
    l.attachedTo = null
    debug('data-server client: the app has no character; the engine keeps its last attach')
    return
  }
  void attachAndProbe(mine)
}

// ── the probe ──────────────────────────────────────────────────────────────────────────────────

/**
 * Ask the engine for five modules, ask this process for the same five, and say whether they agree.
 *
 * IT WAITS FOR THE ENGINE'S FOLD FIRST, because a mid-scan answer is a real prefix state (the
 * engine's `SnapshotAsk` design guarantees that) but a prefix of a different length than ours — so
 * probing early would produce five honest DRIFT lines and no information. The wait is bounded and
 * its expiry is not an error: the line reports whatever status the engine was in.
 */
async function runParityProbe(mine: number, l: LiveEngine, logPath: string): Promise<void> {
  const health = await waitForFold(mine, l)
  if (health === null || gen !== mine) return
  const asks: ParityAsk[] = []
  for (const module of PARITY_PROBE_MODULES) {
    const ask = await askOne(l, module)
    if (gen !== mine) return
    asks.push(ask)
  }
  const verdicts: ParityVerdict[] = judgeParity(asks)
  debug(
    parityLine({
      logPath,
      mark: health.mark ?? null,
      epoch: health.epoch,
      engineStatus: health.status,
      engineEvents: health.events ?? null,
      verdicts
    })
  )
}

/** What `session.health` last said. Only the fields the line quotes. */
interface EngineHealthSay {
  readonly status: string
  readonly epoch: number
  readonly events?: number
  /** The engine's own (log identity, byte offset). Absent until it has folded something. */
  readonly mark?: EngineMark
}

/** Poll `session.health` until the engine's ingest is `live`, or the budget runs out. Null only
 *  when this turn was superseded or the connection failed — both of which mean "say nothing". */
async function waitForFold(mine: number, l: LiveEngine): Promise<EngineHealthSay | null> {
  const deadline = Date.now() + FOLD_WAIT_BUDGET_MS
  for (;;) {
    let health: EngineHealthSay
    try {
      health = await l.client.request('session.health', {})
    } catch (err) {
      debug(`data-server client: session.health was refused (${describeErr(err)})`)
      return null
    }
    if (gen !== mine) return null
    if (health.status === 'live' || Date.now() >= deadline) return health
    await delay(FOLD_POLL_MS)
    if (gen !== mine) return null
  }
}

/**
 * One module, from both worlds.
 *
 * THE TWO READS ARE AS CLOSE TOGETHER AS THIS PROCESS PERMITS, and that is the whole reason the
 * app's snapshot is taken HERE rather than collected in a batch before or after the five round
 * trips. `registry.snapshot` runs in the microtask continuation of the reply that just arrived, so
 * the only thing that can advance the app's fold between the two reads is another microtask — never
 * a tailer line, never a heartbeat tick, both of which are macrotasks. Matched marks are what make
 * the comparison sound (parityProbe.ts's header); this is what makes matched marks likely.
 */
async function askOne(l: LiveEngine, module: string): Promise<ParityAsk> {
  try {
    const result = await l.client.request('module.snapshot', { module })
    const app = registry.snapshot(module)
    return { module, engine: { seq: result.seq, state: result.state }, app }
  } catch (err) {
    return { module, engine: null, app: registry.snapshot(module), refusal: describeErr(err) }
  }
}

// ── the composition root's two verbs ────────────────────────────────────────────────────────────

/**
 * Arm the client. Called by `engineHost.ts` from inside its own `EQC_ENGINE` guard, so this file
 * never reads the flag and there is one gate rather than two.
 */
export function installEngineClient(): void {
  setWorldRebuiltObserver(onWorldRebuilt)
}

/** Let go: no observer, no connection. Idempotent, and safe on a process that never armed one. */
export function stopEngineClient(): void {
  gen += 1
  setWorldRebuiltObserver(null)
  live?.client.close()
  live = null
}
