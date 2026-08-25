// ============================================================================
// rendererBroker.ts — MAIN BROKERS A RENDERER'S CONNECTION, AND CARRIES NO FRAMES (JOS-484).
// ============================================================================
//
// Owner ruling 7, verbatim: "one connection per renderer, brokered by main". This file is the
// brokerage, and the whole design turns on one word in the sentence below it.
//
// ── BYTES, NOT FRAMES. THE ONE DECISION THIS FILE IS ───────────────────────────────────────────
//
// The obvious brokerage is a proxy: main runs an `EngineClient`, renderers ask over IPC, main
// serializes an answer per window. That is exactly the cost JOS-458 measured and named — a
// per-window serialization of state that main had already serialized once to get. The engine exists
// to delete that cost, and a broker that re-created it would have moved the fold and kept the bill.
//
// So main relays RAW BYTES and never parses one. A renderer asks; main opens a FRESH loopback
// connection to the engine, makes a `MessageChannelMain` pair, hands one port to that renderer, and
// pumps: socket chunk in → `port.postMessage(chunk)`; port message out → `socket.write(chunk)`. No
// JSON, no `LineDecoder`, no protocol type is imported by this file at all — the only thing it can
// do to a chunk is move it. The renderer runs the real `EngineClient` over a `messagePortChannel`
// (`src/shared/dataServer/messagePortChannel.ts`) and is a first-class peer of the engine: its
// subscriptions, its diffs and its epoch are its own, and main's cost per view is zero.
//
// ONE CONNECTION PER RENDERER is enforced HERE rather than trusted: a second `engine:connect` from
// a webContents that already holds one closes the first. A renderer that reloads therefore replaces
// its connection rather than leaking one per reload, and the engine's connection count stays a
// function of how many windows are open.
//
// ── THE TOKEN ──────────────────────────────────────────────────────────────────────────────────
//
// Loopback is not a permission boundary — the token is (`token.ts`) — and a renderer that holds a
// socket has to present one. It rides the SAME `postMessage` that carries the port, for two
// reasons. It is one delivery rather than two, so there is no window in which a renderer holds a
// wire it cannot use or a secret with nothing to use it on; and it never touches a channel anything
// persists. It is not in the store, not in a URL, not in the DOM, and not in `localStorage`: it
// lives in the preload's closure and in the `EngineClient` that preload's channel serves, both of
// which die with the renderer. A respawned engine mints a new secret (spawn contract rule 5), which
// is why every launch invalidates every port below.
//
// ── LIFECYCLE, ALL FOUR DIRECTIONS ─────────────────────────────────────────────────────────────
//
//   * THE RENDERER LETS GO — it closes its channel, which posts the end sentinel; the relay
//     destroys the socket. Same for a window that is destroyed outright (`webContents 'destroyed'`)
//     and for a port whose renderer-side end was collected (`MessagePortMain 'close'`).
//   * THE ENGINE DIES — the socket ends, the relay posts the sentinel and closes the port, and the
//     renderer's transport reports a failed connection. Its client keeps its rows (they were true
//     when they were sent) and shows an error until it reconnects.
//   * THE ENGINE RESPAWNS — `noteEngineLaunch` closes EVERY relay, because a new launch means a new
//     port and a new token and nothing about the old connection is valid. Renderers reconnect and
//     re-subscribe from scratch; RESUME IS RE-QUERY (diff-protocol rule 3), which the client library
//     already enforces on its own state, so there is nothing to carry across and nothing to resume.
//   * THE APP QUITS — `stopRendererBroker` closes everything, beside the supervisor's own teardown.
//
// ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────────────────────────
//
// No queueing, no reconnect timer, no state. A connection that fails is a connection the renderer
// asks for again; the retry policy belongs to the surface that wants a view, not to the plumbing.
// And no `EQC_ENGINE` read: `engineHost.ts` owns the one gate for this feature, and it simply never
// calls `noteEngineLaunch`, so the handler below finds no launch and refuses. One gate, one place.

import { ipcMain, MessageChannelMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import { logInfo } from '../errorLog'
import { connectToEngine } from './socketChannel'
import type { ReadyEngine } from './supervisor'
import type { ByteChannel } from '../../shared/dataServer/ndjson'

/** How long a renderer's loopback connect may take. `engineClientHost.ts`'s bound, for its reason:
 *  the supervisor's probe just completed a round trip on this port, so this covers the pathological
 *  case rather than budgeting the ordinary one. */
const CONNECT_TIMEOUT_MS = 2_000

/**
 * What this file needs from an Electron `MessagePortMain`, structurally.
 *
 * Stated as an interface rather than imported so `relayBytes` — the only part of this file with any
 * logic in it — can be driven by a fake in a unit test with no Electron, no window and no engine.
 * It is `supervisor.ts`'s discipline applied one file over.
 */
export interface RelayPort {
  postMessage(message: unknown): void
  on(channel: 'message', handler: (event: { data: unknown }) => void): this
  on(channel: 'close', handler: () => void): this
  start(): void
  close(): void
}

/** The one payload on this wire that is not bytes: the stream ended. The renderer's half of the
 *  convention (and the argument for it) is `shared/dataServer/messagePortChannel.ts`. */
const PORT_END = null

/**
 * THE PUMP. Join one byte channel and one port so every chunk crosses untouched, in both
 * directions, and either end closing closes the other.
 *
 * `settled` is the same latch both adapters carry, and it is what makes "the socket ended" and "the
 * renderer let go" ONE event however they arrive — a second teardown would post a sentinel down a
 * port that is already closed, and on Electron that is a throw from inside an event handler.
 *
 * NOTHING HERE INSPECTS A CHUNK. A string from the socket is posted; a string from the port is
 * written. The only value with a meaning is the sentinel, and its meaning is "stop".
 */
export function relayBytes(channel: ByteChannel, port: RelayPort): () => void {
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    // The sentinel goes out BEFORE the close, because closing an entangled port discards anything
    // not yet posted — without it, a renderer learns its engine is gone only by timing out.
    try {
      port.postMessage(PORT_END)
    } catch {
      // The peer is already gone. That is the case this is announcing; it is not a failure.
    }
    port.close()
    channel.close()
  }

  channel.onData((chunk) => {
    if (settled) return
    try {
      port.postMessage(chunk)
    } catch {
      settle()
    }
  })
  channel.onClose(() => {
    settle()
  })
  port.on('message', (event) => {
    if (settled) return
    if (event.data === PORT_END) {
      settle()
      return
    }
    // Renderer input, and it reaches a socket — so it is checked for being what it claims rather
    // than trusted. A non-string is not written: `socket.write` would coerce an object to
    // `[object Object]` and hand the engine a frame nobody sent.
    if (typeof event.data !== 'string') return
    channel.write(event.data)
  })
  port.on('close', () => {
    settle()
  })
  port.start()
  return settle
}

// ── the live relays ────────────────────────────────────────────────────────────────────────────

/** One brokered connection: which window holds it, and how to take it away. */
interface Relay {
  readonly holder: WebContents
  readonly close: () => void
}

/** Keyed by `webContents.id` — which is what makes ONE CONNECTION PER RENDERER structural rather
 *  than a rule somebody has to remember. */
const relays = new Map<number, Relay>()

/** The launch a renderer would be connected to, or null when there is no engine. Set only by
 *  `engineHost.ts`, which is where this feature's one flag is read. */
let launch: ReadyEngine | null = null

function debug(line: string): void {
  logInfo(`[everquest-companion] ${line}`)
}

/** Take one renderer's connection away. Idempotent, and safe for a window that never had one. */
function dropRelay(id: number, why: string): void {
  const relay = relays.get(id)
  if (relay === undefined) return
  relays.delete(id)
  relay.close()
  debug(`data-server broker: closed the connection for window ${String(id)} (${why})`)
}

/** Take every connection away — a respawn, or a quit. */
function dropAll(why: string): void {
  for (const id of Array.from(relays.keys())) dropRelay(id, why)
}

/**
 * THE SUPERVISOR'S READY EDGE, for the broker. `null` means the launch that was ready is over.
 *
 * EVERY EXISTING RELAY DIES HERE, including on the way IN to a new launch: the port and the token a
 * renderer is holding belong to a process that no longer exists, and a socket to a port some other
 * program may now own is worse than no socket at all. The renderers notice through their own
 * transports and ask again — which is a fresh connect, a fresh token and a fresh reset, i.e.
 * exactly the resume-is-re-query law the protocol already runs on.
 */
export function noteEngineLaunch(info: ReadyEngine | null): void {
  launch = info
  dropAll(info === null ? 'the engine is gone' : 'the engine was relaunched')
}

/** Let go of everything. Called from `stopEngineSupervisor`; idempotent. */
export function stopRendererBroker(): void {
  launch = null
  dropAll('the app is shutting down')
}

// ── the IPC door ───────────────────────────────────────────────────────────────────────────────

/** What `engine:connect` answers. The PORT does not travel in this reply — it travels on the
 *  `engine:port` push that precedes it, because a MessagePort is transferred, never returned. */
export interface EngineConnectReply {
  ok: boolean
  /** Why not, as prose for a dev log. Never a code: nothing branches on this. */
  reason?: string
}

/**
 * Open one renderer's connection.
 *
 * THE ORDER IS DELIBERATE: the port is posted BEFORE this resolves, so a renderer that awaits the
 * reply and then reads its inbox can never be told `ok` for a port that has not been sent. The
 * `nonce` is the renderer's own correlation handle, echoed rather than interpreted — it exists
 * because a window may ask twice before either answer lands, and the second port must not be
 * mistaken for the first.
 */
async function onConnect(event: IpcMainInvokeEvent, nonce: unknown): Promise<EngineConnectReply> {
  const sender = event.sender
  const id = sender.id
  const info = launch
  if (info === null) return { ok: false, reason: 'no engine is running on this launch' }
  // Renderer input, re-validated at the handler like every other channel in this process — it is
  // echoed back into a renderer, so a non-number would simply never match and the caller would hang
  // rather than fail.
  if (typeof nonce !== 'number' || !Number.isFinite(nonce)) {
    return { ok: false, reason: 'a connect must carry a numeric nonce' }
  }
  // ONE CONNECTION PER RENDERER (ruling 7). A window that asks again has replaced its own.
  dropRelay(id, 'the window asked for a new connection')

  let channel: ByteChannel
  try {
    channel = await connectToEngine(info.port, CONNECT_TIMEOUT_MS)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    debug(`data-server broker: could not reach the engine for window ${String(id)} (${why})`)
    return { ok: false, reason: why }
  }
  // The window may have gone while the connect was in flight, and the launch may have been replaced
  // — both are ordinary. A socket nobody will read is closed rather than relayed into a dead port.
  if (sender.isDestroyed() || launch !== info) {
    channel.close()
    return { ok: false, reason: 'the connection was superseded before it was handed over' }
  }

  const { port1, port2 } = new MessageChannelMain()
  const close = relayBytes(channel, port1)
  relays.set(id, { holder: sender, close })
  sender.once('destroyed', () => {
    dropRelay(id, 'the window was destroyed')
  })
  // THE TOKEN RIDES THE PORT. One delivery, and it lands in the preload's closure — see the header.
  sender.postMessage(IPC.onEnginePort, { nonce, token: info.token }, [port2])
  debug(`data-server broker: window ${String(id)} is connected to the engine on port ${String(info.port)}`)
  return { ok: true }
}

/** Register the one channel. Called from `registerIpc()` beside every other domain. */
export function registerRendererBrokerIpc(): void {
  ipcMain.handle(IPC.engineConnect, onConnect)
}
