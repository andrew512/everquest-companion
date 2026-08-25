# `src/main/dataServer` — main's half of the data server

Electron main's whole relationship with the Rust engine (`engine/crates/engined`, JOS-459). The
design and the owner's twenty rulings live in `docs/plans/data-server.md`; the engine's own side is
`engine/crates/engined/README.md`. Every file here carries its argument in its header — this page is
the map, plus the one thing no single file can state: **how the pieces connect at run time**.

Nothing in this directory does anything without `EQC_ENGINE=1` in the environment. That is the one
switch for the whole feature, read in exactly one place (`engineHost.ts engineEnabled`). Since
JOS-484 there is one channel registered in every build — `engine:connect`, beside `registerDevIpc` —
and it is not an exception to that rule: the handler holds no flag, is never told about a launch
without one, and therefore refuses. A registered door with nothing behind it, so the refusal is a
decision a test can watch being made rather than an absence nobody can observe.

## The files

| File | What it owns |
| --- | --- |
| `engineProtocol.ts` | The pure facts both halves share: the announce line's grammar, the binary's candidate paths, backoff, the exit-trail fold, `redactToken`. No I/O. |
| `token.ts` | Minting the per-launch secret. (`src/shared/dataServer/token.ts` holds the shape rules; loopback is not a permission boundary — the token is.) |
| `supervisor.ts` | The lifecycle STATE MACHINE: spawn, watch, respawn, kill. Electron-free and dependency-injected, so every failure path is a unit test with no app and no Rust. |
| `engineHost.ts` | The composition root's half: which binary, which spawn, which socket, which clock, where a line goes. The only file anyone would rewrite to run the engine some other way. |
| `socketChannel.ts` | The only file in the feature that knows a socket exists. |
| `engineHealth.ts` | "Is it actually serving?", asked as `hello` + `session.health` over the product's own door. |
| `engineClientHost.ts` | **The app as a CLIENT** (JOS-479): connect, attach, re-attach, and run the parity probe. Since JOS-483 it also answers two READS for the performance panel — `enginePerfSnapshot()` and `lastParitySummary()` — and still owns no channel. |
| `parityProbe.ts` | The probe's pure half — two snapshots in, one verdict out, one line. |
| `byteRelay.ts` | **The pump** (JOS-484): chunks between a socket and a MessagePort. Electron-free, so every teardown path is a unit test. |
| `rendererBroker.ts` | **The brokerage** (JOS-484): the `engine:connect` handler, the port handover, and the live-connection lifecycle. |

The engine's row in the app's performance panel is assembled **outside this directory**, in
`src/main/enginePerfWatch.ts`: it joins `enginePerfSnapshot()` with a native per-pid read
(`src/main/processSample.ts` — `app.getAppMetrics()` is Chromium's own process list and the engine
is not in it) and pushes one object over the perf IPC family. **It polls only while the panel is
open** — see "The polling discipline" in `engine/crates/engined/README.md` for the rule and why it
exists. The renderer never speaks to the engine; brokering a client into a window is a later ticket.

## The connect flow (JOS-479, phase 3)

```
 startEngineSupervisor()          [engineHost.ts, behind EQC_ENGINE=1]
   ├─ installEngineClient()       registers the world-rebuilt observer on pipeline.ts
   └─ supervisor.start()
        spawn engined.exe ─── token down stdin ──►  engine
        ◄── "EQC-ENGINE PORT=… PROTOCOL=…" on stdout
        hello + session.health over the port ──────────► a proven ROUND TRIP
        │
        └─ onReady({ port, token, pid, epoch, engineVersion })
             │                    [supervisor.ts, beside onPid]
             ▼
           engineClientHost.onEngineReady
             ├─ createEngineClient({ token })      one client per LAUNCH — see below
             ├─ connectToEngine(port) → NDJSON transport → client.attach(transport)
             └─ session.attach({ logPath })        the log THIS PROCESS IS TAILING
                  │
                  ▼
                (both worlds folding the same file)
                  │
   sendWorldRebuilt(character) ───┘   [pipeline.ts — the app's fold landed]
     ├─ re-attach IF THE LOG CHANGED (a character switch — all switch paths reach this one funnel)
     └─ THE PARITY PROBE
```

An attach is a whole re-fold, so it is sent only when the FILE changes. The flow above reaches
`attachAndProbe` twice on an ordinary launch — once at READY and once when this process's fold lands
— and a second attach there would make the engine read the log twice for nothing. It is not a
freshness risk: the engine folded the same file from byte zero and has been tailing it since, which
is the same lossless seam as the app's own scan→tail handoff.

**Where the log path comes from.** `session.ts` already exports `getActiveCharacter()`, and
`sendWorldRebuilt` already carries the `CharacterRef`. Those two are the whole hook: *no line of
`session.ts` changed for this feature.* The rebuild funnel is preferred (it names the log whose fold
has LANDED here) with the tailing character as the fallback, which is what lets an engine that
becomes ready mid-fold start reading immediately instead of idling until the next switch.

**Why a fresh client per launch.** A respawn mints a new token and binds a new port (spawn contract
rule 5), so a client that survived one would be holding credentials for a process that no longer
exists. The old client is closed and a new one is built; `client.attach` is what hands it its
transport. Nothing is carried across — which is the same resume-is-re-query law the client library
already enforces on its own window state.

**Preemption.** Every step here is asynchronous and every one of them can be superseded by a
character switch or an engine respawn. `switchController.ts`'s answer is used verbatim: a GENERATION
counter, re-asked after each suspension point. A turn that has lost touches nothing and — crucially
— writes no line, because a verdict about a world somebody has since replaced is a measurement of
nothing printed with authority.

## The renderer brokerage (JOS-484, ruling 7)

Owner ruling 7, verbatim: *"one connection per renderer, brokered by main"*. Everything above is
main talking to the engine for its own reasons; this is main getting out of the way so a **renderer**
can talk to it.

```
 renderer                         MAIN                                  engine
  window.eq.engineConnect()
      │ invoke engine:connect(nonce) ──────►  rendererBroker.onConnect
      │                                         ├─ connectToEngine(port)  ──── TCP ────►  accept
      │                                         ├─ new MessageChannelMain()
      │                                         ├─ relayBytes(socketChannel, port1)
      │  ◄── postMessage(engine:port,           └─ sender.postMessage(…, [port2])
      │        {nonce, token}, [port])
      │
   preload wraps the port           ┌──────────────────────────────────────────┐
   messagePortChannel(port)         │  socket chunk  →  port.postMessage(chunk) │  byteRelay.ts
      │                             │  port message  →  socket.write(chunk)     │  (no parsing,
   createNdjsonTransport            └──────────────────────────────────────────┘   no protocol
      │                                                                             types at all)
   createEngineClient({token}).attach(…) ── hello ─────────────────────────────►  hello reply
```

### Why BYTES and not frames

The obvious brokerage is a proxy: main runs an `EngineClient`, renderers ask over IPC, main
serializes an answer per window. **That is exactly the cost the engine exists to delete** — JOS-458
measured the per-window serialization of fold state, and a broker that re-created it would have moved
the fold and kept the bill.

So main relays raw chunks and never parses one. `byteRelay.ts` imports no protocol type, no codec and
no Electron; the only thing it can do to a chunk is move it, and its one type check exists because a
renderer's message reaches a socket (`socket.write` would coerce an object to `[object Object]` and
hand the engine a frame nobody sent). The renderer runs the real `EngineClient` over
`shared/dataServer/messagePortChannel.ts` and is a **first-class peer of the engine**: its
subscriptions, its diffs, its epoch, its window state. Main's cost per view is zero, because there is
nothing in the path to cost anything.

The temptation on this wire is to post one protocol message per `postMessage` and delete the codec on
the renderer's side — a MessagePort is message-oriented, after all. That would be a **second framing,
in a second place**, disagreeing with the first the day either changed (owner ruling 15). The port
carries the socket's own chunks, unaligned, and `LineDecoder` reassembles them exactly once.
`tests/dataServerBroker.test.mts` feeds a real conversation **one character at a time** to keep that
honest.

### The token handoff

Loopback is not a permission boundary — the token is (`token.ts`) — so a renderer holding a socket has
to present one. It rides the **same `postMessage` that carries the port**: one delivery, so there is
no window in which a renderer holds a wire it cannot use or a secret with nothing to use it on.

Where it lives: the preload's closure, and the `EngineClient` that preload's channel serves. Not the
store, not a URL, not the DOM, not `localStorage`. **The MessagePort itself never crosses the context
bridge at all** — `src/preload/engine.ts` wraps it and hands the renderer four plain functions
(`write`/`onData`/`onClose`/`close`), because a preload that gives out a port it cannot take back is a
preload that cannot enforce a lifetime. A respawn mints a new secret regardless (spawn contract
rule 5), which is why every launch invalidates every port below.

### Lifecycle, all five directions

| What happened | What closes | How |
| --- | --- | --- |
| The renderer lets go | the socket | the channel posts the end sentinel; the relay destroys the socket |
| The window is destroyed | the socket | `webContents 'destroyed'` → `dropRelay` |
| The window's port is collected | the socket | `MessagePortMain 'close'` → the same settle |
| The engine dies | the port | the socket ends; the relay posts the sentinel and closes the port; the renderer's transport reports a failed connection |
| The engine respawns | **every** relay | `noteEngineLaunch` — the port and token a renderer holds name a process that no longer exists |

A respawn is answered by the renderers asking again: a fresh connect, a fresh token, a fresh reset.
That is **resume-is-re-query** (diff-protocol rule 3), which the client library already enforces on its
own window state, so there is nothing to carry across and nothing to resume. `EngineProvider`'s retry
is a flat 4 s timer rather than a backoff — the whole feature is behind a developer's environment
variable and the cost of being wrong is one refused IPC call.

**One connection per renderer is enforced, not trusted**: the relays are keyed by `webContents.id`, so
a second `engine:connect` from a window that already holds one closes the first. A renderer that
reloads replaces its connection instead of leaking one per reload.

**There is no second gate.** `rendererBroker.ts` reads no environment variable: `engineHost.ts` owns
the one flag and simply never calls `noteEngineLaunch`, so the handler finds no launch and answers
`{ok:false}`. The IPC channel is registered in every build, exactly like `registerDevIpc` beside it —
the refusal is a decision a test can watch being made.

### The first surface, and what it proved

`src/renderer/src/features/loot/EngineLootLedger.tsx` is the first product surface on `useView`: the
loot ledger drawn from `loot.ledger`, behind a dev-only toggle that is gated on a **live connection**
rather than on a flag. `tests/e2e/engine-loot-view.e2e.mts` opens the flat ledger, reads every
rendered row, flips the toggle, reads them again and asserts they are identical cell for cell — the
DOM as the oracle, one layer above what `engine-parity` can see.

Two things that comparison found, both worth keeping written down:

1. **The plan's example descriptor draws a different ledger.** `sort: [["at","desc"]]` is not the flat
   ledger's order. Every sort ends in the source's tiebreak and `loot.ledger`'s is `seq` ASC, so the
   one-term form orders each same-second group backwards — and EQ stamps to the second, so a corpse
   yielding three items is exactly such a group. The descriptor names `["at","desc"], ["seq","desc"]`.
2. **The two modes do not mount the same number of rows, and should not.** Both virtualize over the
   same row height, but the app-fed ledger carries a slice bar, a toolbar, a caption, a strip and its
   notices above the scroll box while the served one carries a toggle and a caption — so the served
   box is taller and shows more of the same list (29 vs 35). The e2e asserts the served window
   *covers* the app's and agrees with it over the whole of it, rather than pretending the counts match.

**The ledger virtualizes; it does not page.** There is no page control, no offset state and no next
button on that tab, so there is no paging to wire the descriptor's window to; it is a fixed newest-50
and the caption says so against the view's own `total`. Moving `offset` into state and re-subscribing
per page is the upgrade when a surface wants one — cheap, because `useView` already treats a changed
descriptor as a new query — and it is deliberately not built speculatively.

## The parity probe

Once the engine's ingest is `live` and this process's fold has landed on the same log, the probe
asks the engine for `module.snapshot` on five modules (`loot`, `kills`, `leveling`, `character`,
`buffs`), asks `registry.snapshot(id)` for the same five here, deep-compares each pair, and writes
**one line** to the dev log:

```
data-server parity: 3 agree, 2 diverge, 0 skipped of 5 [epoch 2, engine live, 1599 events, mark 129297 of …\eqlog_Primitive_freeport.txt]
  — loot AGREE(seq 1598) · kills AGREE(seq 1598) · leveling AGREE(seq 1598)
  · character DIVERGE(seq 3) at .character.lastPlayed: engine (absent) vs app 1787649515839.0056
  · buffs DIVERGE(seq 1598) at .active.length: engine 12 vs app 3
```

(That is a real run, wrapped for this page; it is one line on the wire.)

The coordinate in the bracket is **the engine's own `session.health` mark**, quoted rather than
assumed: the comparison only means anything if both worlds folded the same file, and the app cannot
establish that by remembering what it asked for. An echo is evidence; a variable is a belief. When
the two disagree the clause becomes `LOG MISMATCH: app … but engine …`, which is deliberately the
loudest phrasing in the sentence — it is the one failure that would make every other number in the
line a lie.

**It is LOG ONLY.** No IPC, no renderer, no store write, no branch in the product reads a verdict.
The TypeScript fold remains the app's only source of truth until the cutover deletes it.

**Matched marks, or no comparison.** The two worlds fold the same bytes at different speeds and the
file may be growing while they do. So every module is compared only when the two `seq` values agree
— a module's OWN published seq, which for sixteen of them is the last event folded and for four
(combo, character, respawn, buffTimers) is a private revision counter (JOS-87). Unequal is DRIFT,
reported as SKIPPED with both numbers, and counted separately from agreement: a probe that silently
compared nothing and reported "0 divergences" would read like proof.

**One field is dropped, from both sides:** `overlay.updatedAt`, which the message-overlay miner
stamps with the wall clock when a snapshot is TAKEN. The golden oracle drops exactly this and
nothing else. The app's state is also round-tripped through `JSON` first, so a serializer's opinion
(an `undefined` value that exists in an object and vanishes on the wire) cannot be reported as a
fold divergence.

**What it is FOR, given the oracle already exists.** `npm run oracle:rust-fold` proves all twenty
modules equivalent over 1.28M events of the owner's real log — offline, at a bench, with both worlds
built to order. This probe asks a different question: does the SHIPPING pipeline agree — the engine
the supervisor spawned, folding the log the app is tailing, against the registry in this process, as
constructed by the real composition root? It found two things the oracle structurally cannot see.

### The two known asymmetries (measured 2026-08-25, JOS-479)

Both are pinned by `tests/e2e/engine-parity.e2e.mts` **with their exact paths**, so the day either
closes the spec goes red and somebody deletes the exemption. Neither is a fold defect.

1. **`character` at `.character.lastPlayed`.** The app's `CharacterRef` carries
   `statSync(logPath).mtimeMs` (`log/config.ts`), pushed in by `session.ts resetWorldFor`. It is a
   FILESYSTEM fact, not a fold fact. The engine derives its ref from the log's file NAME and never
   stats anything, so the field is honestly absent there. The oracle cannot see it because its TS
   world is built from a three-field ref (measured: a bench fold of the same fixture publishes
   `{name, server, logPath}` and no `lastPlayed`). An mtime could not live inside a deterministic
   fold anyway — ruling 18 law 1 — so the open question is whether the app should be publishing one
   through a fold module at all, or whether it becomes pushed app knowledge like the other impure
   inputs (boundary verdict 3). **Owner call, not a worker's.**

2. **`buffs` at `.active.length` — engine 12, app 3.** MEASURED on a bench fold of the same bytes:
   the TypeScript fold publishes **12** actives before any tick and **3** after a single
   `registry.tick(Date.now())`. So the two folds agree exactly; what differs is that the app runs a
   wall-clock heartbeat over its modules (`session.ts startHeartbeat`, one tick before the interval)
   and the engine's `Fold` never calls `on_tick` — deliberately, because no module in that crate may
   read a wall clock (ruling 18 law 1: determinism IS cacheability). The method exists on the Rust
   trait and is documented as "the live tail's". **Where the heartbeat lives once the fold is
   engine-side is a phase-3 design question**, and it is the first thing this program has met that
   the equivalence oracle cannot decide, because the oracle never ticks either side.

## Tests

| | |
| --- | --- |
| `tests/dataServerSupervisor.test.mts` | Every lifecycle failure path, plus the READY handover. No app, no Rust. |
| `tests/dataServerBroker.test.mts` | Both ends of the brokered wire: splits cross unchanged, four teardown paths, and a real conversation delivered one character at a time. |
| `tests/e2e/engine-loot-view.e2e.mts` | The row-parity oracle — the app-fed and served ledgers, compared as DOM. |
| `tests/dataServerParity.test.mts` | The probe's judgement: agreement, divergence, drift-is-a-skip, the two refusal sentences, the line's shape. |
| `tests/dataServerEngineChild.test.mts` | The real child, pipe and socket against a Node fake engine. |
| `tests/e2e/engine-boots.e2e.mts` | The real binary under the real app: spawn, ready, respawn, wrong token, quit, absence. |
| `tests/enginePerf.test.mts` | The performance panel's engine row above the FFI boundary: the per-pid CPU arithmetic over a fake pid, the formatters' absent cases, and `useEnginePerf` run for real (arming, disarming, the null push). |
| `tests/e2e/engine-parity.e2e.mts` | The connect flow and the probe end to end on a staged fixture — **and** (`enginePerfSteps.mts`) the ENGINE section of the in-app performance panel, whose verbatim text the run prints. |
| `npm run oracle:rust-fold` | The semantics bar: twenty modules, six slices of the owner's real log. |
