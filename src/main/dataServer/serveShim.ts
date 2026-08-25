// ============================================================================
// serveShim.ts — THE COMPAT SHIM, WIRED (JOS-489, phase 1 of the cutover).
// ============================================================================
//
// `readShim.ts` is the decision with no world attached; this is the world. It reads the flag, hands
// the shim a real connection and a real log sink, states what each of the three channels' served
// answers must look like to count as answers, and installs the harness seam the parity e2e reads.
// `src/main/ipc/world.ts` calls four things from here and nothing else.
//
// ── THE SECOND FLAG, AND WHY IT IS A SECOND FLAG ───────────────────────────────────────────────
//
// `EQC_ENGINE=1` means "run an engine". `EQC_ENGINE_SERVE=1` means "and let it answer the app's
// reads". They are separate because the first is already the whole of what the program has shipped
// so far and a developer must be able to keep it — an engine folding beside the app, the parity
// probe running, the performance panel populated — WITHOUT the product's answers moving. Every
// engine ticket up to this one had "no branch in the product reads anything the engine says" as an
// invariant; this is the ticket that ends it, and ending it deserves its own switch rather than a
// silent change of meaning for a flag developers already have in a shell.
//
// The serve flag is MEANINGLESS ALONE: `engineEnabled()` gates it, so `EQC_ENGINE_SERVE=1` with no
// engine asked for is off, not half-on. That is the same one-gate rule `engineHost.ts` states for
// the client and the broker, kept by importing its answer rather than by re-reading its variable.
//
// ── WHAT `world.ts` PAYS WHEN THE FLAG IS OFF ──────────────────────────────────────────────────
//
// One boolean read per call, and it is a read of a `const` computed at module load. The handler's
// expression is otherwise the one it has always been: same `timeSeam`, same synchronous return,
// same value. This file allocates nothing, opens nothing and registers nothing in that world — the
// shim object below is built lazily, on the first served call, so a launch that never serves never
// makes one.
//
// ── THE THREE PROJECTIONS, AND THE TWO GUESS TESTS ─────────────────────────────────────────────
//
// A reply that passed the protocol's own result guard can still not be an ANSWER (readShim.ts's
// header). Two of the three channels can say so cheaply and do:
//
//   * `module.snapshot` echoes the module it answered for. An echo that is not the id we asked for
//     is a bookkeeping failure somewhere between here and the fold, and the honest response is the
//     app's own state rather than another module's under this module's name.
//   * `combat.snapshot` states the instant it was taken at, and the schema is explicit that the
//     engine uses the FOLD's clock — the log's own timestamps, weeks or months old — at every
//     moment before its tail goes live. A snapshot stamped with the log's clock is a real prefix
//     state and a false present: every `active` flag and every elapsed time in it is measured
//     against a moment that is not now. The readiness gate already refuses a non-live engine, so
//     this is the belt to that pair of braces, and it is worth its two lines because the failure it
//     catches is invisible — the payload looks perfect.
//   * `combat.searchFights` has no such test and is not given a fake one. It is a ranked answer to
//     a question; there is no field in it that could be checked against anything this process knows
//     without re-running the search, which is the thing the shim exists to avoid.
//
// ── THE TWO CASTS, NAMED RATHER THAN HIDDEN ────────────────────────────────────────────────────
//
// `CombatState` and the protocol's `FightSearchHit` are the schema's deliberate holes: the schema
// says an OBJECT and nothing about its shape, because `src/shared/combat.ts CombatSnapshot` is the
// app's own contract with its renderer and a meter growing a column must not be a protocol change
// (protocol.generated.ts says exactly this on both types). So the shim asserts what the schema
// declined to state. THAT ASSERTION IS THE THING THE E2E EXISTS TO CHECK — the parity seam below
// compares the two worlds' answers field by field with `firstDiff`, which is the only honest way to
// hold a cast like this one accountable.

import { E2E } from '../e2e'
import { logInfo } from '../errorLog'
import { engineEnabled } from './engineHost'
import { engineRequest, engineServeReadiness } from './engineClientHost'
import { createReadShim, type ReadShim, type ServeOutcome } from './readShim'
import type { CombatSnapshot, FightSearchResult, SnapshotOpts } from '../../shared/combat'
import type { CombatSnapshotOpts } from '../../shared/dataServer/protocol.generated'

/** What `registry.snapshot(id)` answers with, and therefore what `module:getSnapshot` returns. */
export interface ModuleSnap {
  readonly seq: number
  readonly state: unknown
}

/**
 * THE APP'S OWN ARMS, handed in by `world.ts` so the TS fold stays visible at the call site the
 * cutover will one day delete. Nothing here imports `pipeline.ts`.
 */
export interface TsArms {
  module: (moduleId: string) => ModuleSnap | null
  combat: (opts: SnapshotOpts) => CombatSnapshot
  search: (text: string, limit: number | undefined) => FightSearchResult
}

/**
 * How long the engine arm may take. A BOUND ON THE PATHOLOGICAL CASE, not a budget — a loopback
 * round trip to a process that has already folded the log is sub-millisecond, and the deadline
 * exists for the engine that accepted a request and will never answer it. Two seconds is the same
 * number `engineHost.ts` and `engineClientHost.ts` already use for a loopback connect, for the same
 * reason: loopback either answers immediately or is not going to.
 */
const SERVE_TIMEOUT_MS = 2_000

/** How often the coalesced fallback sentence may be printed. Five seconds is long enough that a
 *  disconnected engine costs one line per five seconds rather than one per poll, and short enough
 *  that a developer flipping the flag sees the answer before they alt-tab away. */
const NOTE_EVERY_MS = 5_000

/**
 * HOW FAR THE ENGINE'S `now` MAY BE FROM THIS PROCESS'S before its combat snapshot is treated as a
 * guess. Both processes are on the same machine and the same wall clock, so a LIVE engine's stamp
 * and `Date.now()` differ by the round trip. Anything approaching a minute is not clock skew, it is
 * the fold's own clock — which is the schema's stated behaviour before the tail goes live and is
 * exactly the state this test is for.
 */
const NOW_SKEW_MS = 60_000

/**
 * IS THE ENGINE ANSWERING THIS APP'S READS ON THIS LAUNCH? Read once, at module load, for
 * `engineEnabled()`'s reason: an environment variable is a fact about how the process was started,
 * and re-reading it per call would invite the belief that it can change.
 */
const SERVING = engineEnabled() && process.env.EQC_ENGINE_SERVE === '1'

/** The gate `world.ts` branches on. */
export function shimServing(): boolean {
  return SERVING
}

/** A promise that resolves later without ever being the reason this process stays alive —
 *  `engineClientHost.ts`'s timer rule, restated for the deadline. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const handle = setTimeout(resolve, ms)
    handle.unref()
  })
}

/** Built on first use, so a launch with the flag off allocates nothing at all. */
let shim: ReadShim | null = null

function readShim(): ReadShim {
  shim ??= createReadShim({
    readiness: engineServeReadiness,
    request: engineRequest,
    note: (line) => {
      logInfo(`[everquest-companion] ${line}`)
    },
    now: () => Date.now(),
    timeoutMs: SERVE_TIMEOUT_MS,
    noteEveryMs: NOTE_EVERY_MS,
    delay
  })
  return shim
}

// ── the options, translated once ───────────────────────────────────────────────────────────────

/**
 * `SnapshotOpts` → the schema's `CombatSnapshotOpts`, field by field.
 *
 * NOT A SPREAD, AND NOT A CAST. The two shapes agree today and the schema's own comment says an
 * unlisted key is IGNORED rather than refused, so a spread would compile and work — right up to the
 * day the app grows an option, at which point it would travel to an engine that silently does not
 * do it and nobody would find out from the code. Writing the four out makes `OPTS_ARE_STATED`
 * below a compile-time tripwire on exactly that day.
 *
 * ABSENT STAYS ABSENT. Every field is absent-means-the-engine's-default (schema), so a `false` or a
 * `0` the caller did not write must not be invented here.
 */
function engineOpts(o: SnapshotOpts): CombatSnapshotOpts {
  const out: CombatSnapshotOpts = {}
  if (o.selectedId !== undefined) out.selectedId = o.selectedId
  if (o.showUnparsed !== undefined) out.showUnparsed = o.showUnparsed
  if (o.maxSegments !== undefined) out.maxSegments = o.maxSegments
  if (o.timeline !== undefined) out.timeline = o.timeline
  return out
}

/** THE TRIPWIRE. A new member of `SnapshotOpts` is a compile error here until `engineOpts` carries
 *  it — or until somebody writes it down as deliberately app-side, which is a decision that should
 *  cost a line rather than happening by omission. */
export const OPTS_ARE_STATED: Record<keyof SnapshotOpts, true> = {
  selectedId: true,
  showUnparsed: true,
  maxSegments: true,
  timeline: true
}

// ── the three channels ─────────────────────────────────────────────────────────────────────────

/** `module:getSnapshot`, served — see the header for the echo test. */
export function serveModuleSnapshot(
  moduleId: string,
  own: () => ModuleSnap | null
): Promise<ModuleSnap | null> {
  return readShim().serve(
    'module.snapshot',
    { module: moduleId },
    (r) => (r.module === moduleId ? { seq: r.seq, state: r.state } : null),
    own
  )
}

/** `combat:snapshot`, served — see the header for the clock test and for the cast. */
export function serveCombatSnapshot(
  opts: SnapshotOpts,
  own: () => CombatSnapshot
): Promise<CombatSnapshot> {
  return readShim().serve(
    'combat.snapshot',
    { opts: engineOpts(opts) },
    (r) =>
      Math.abs(r.now - Date.now()) > NOW_SKEW_MS ? null : (r.snapshot as unknown as CombatSnapshot),
    own
  )
}

/** `combat:searchFights`, served. The clamp stays in `world.ts`: the schema mirrors this app's own
 *  clamping rule, so sending a pre-clamped number means both worlds search the same corpus slice
 *  rather than each applying its own bound to a different input. */
export function serveSearchFights(
  text: string,
  limit: number | undefined,
  own: () => FightSearchResult
): Promise<FightSearchResult> {
  return readShim().serve(
    'combat.searchFights',
    limit === undefined ? { query: text } : { query: text, limit },
    (r) => ({ hits: r.hits, corpus: r.corpus }) as unknown as FightSearchResult,
    own
  )
}

// NO TEARDOWN FLUSH, AND THAT IS A DECISION. The tally prints its FIRST fallback immediately
// (`readShim.ts NoteTally`), so the state a developer actually needs to see — the engine never
// served anything — is on screen within the second; what a trailing flush would add is the last
// few counts of a window that was already being printed every five seconds. Wiring it would mean
// `engineHost.ts` importing this file, which imports `engineHost.ts` for its gate, and a cycle
// between the composition root and a leaf is not worth a partial line at quit.

// ── the harness seam (EQ_E2E only) ─────────────────────────────────────────────────────────────
//
// WHY A SEAM RATHER THAN TWO LAUNCHES. The shim IS a parity instrument, and a parity claim is only
// worth making AT A MATCHED MARK (parityProbe.ts's header). Flipping the flag per launch would put
// the two answers in two processes, minutes apart, each having folded its own staged copy — so
// every field that moves with the clock would differ for a reason that has nothing to do with the
// two folds agreeing, and the spec would have to weaken until it proved very little. Asking one
// running app for BOTH arms, back to back, is what the in-app probe already does and for the same
// reason: the engine's reply lands, and the app's own read happens in that reply's microtask
// continuation, where the only thing that can have advanced this process's fold is another
// microtask — never a tailer line, never a heartbeat tick, both of which are macrotasks.
//
// AND IT DOES NOT REPLACE THE PRODUCT PATH IN THE SPEC. The e2e still calls `window.eq` for the
// real answer and checks it against this seam's ENGINE arm; the seam's job is to supply the second
// arm, which the product deliberately no longer exposes when the flag is on.
//
// Nothing in the product reads this object, it exists only under `EQ_E2E=1` AND the serve flag, and
// it crosses no IPC — `overlayHover.ts`'s probe on the same terms.

/** One question, asked of both worlds. `engine` is null when the engine did not serve, and `why`
 *  says which of the shim's reasons that was. */
export interface BothArms<T> {
  readonly engine: T | null
  readonly why: string | null
  readonly ts: T
}

function both<T>(outcome: ServeOutcome<T>, ts: T): BothArms<T> {
  if (outcome.served) return { engine: outcome.value, why: null, ts }
  return { engine: null, why: `${outcome.why}: ${outcome.detail}`, ts }
}

/** What the harness finds on `globalThis`. Every member takes the same arguments its IPC does. */
export interface ShimProbe {
  module: (moduleId: string) => Promise<BothArms<ModuleSnap | null>>
  combat: (opts: SnapshotOpts) => Promise<BothArms<CombatSnapshot>>
  search: (text: string, limit?: number) => Promise<BothArms<FightSearchResult>>
}

function buildProbe(arms: TsArms): ShimProbe {
  const s = readShim()
  return {
    module: async (moduleId) =>
      both(
        await s.ask('module.snapshot', { module: moduleId }, (r) =>
          r.module === moduleId ? { seq: r.seq, state: r.state } : null
        ),
        arms.module(moduleId)
      ),
    combat: async (opts) =>
      both(
        await s.ask(
          'combat.snapshot',
          { opts: engineOpts(opts) },
          (r) => r.snapshot as unknown as CombatSnapshot
        ),
        arms.combat(opts)
      ),
    search: async (text, limit) =>
      both(
        await s.ask(
          'combat.searchFights',
          limit === undefined ? { query: text } : { query: text, limit },
          (r) => ({ hits: r.hits, corpus: r.corpus }) as unknown as FightSearchResult
        ),
        arms.search(text, limit)
      )
  }
}

/**
 * Install the seam, or do nothing at all.
 *
 * THE CLOCK TEST IS DELIBERATELY NOT APPLIED HERE. The probe's job is to report what the engine
 * ACTUALLY said so a spec can pin the difference; a projection that answered `null` for a stamp the
 * spec is trying to measure would hide the very asymmetry the ticket asks to be documented.
 */
export function installShimProbe(arms: TsArms): void {
  if (!E2E || !SERVING) return
  ;(globalThis as unknown as Record<string, unknown>).__eqcEngineShim = buildProbe(arms)
}
