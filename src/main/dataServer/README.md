# `src/main/dataServer` — main's half of the data server

Electron main's whole relationship with the Rust engine (`engine/crates/engined`, JOS-459). The
design and the owner's twenty rulings live in `docs/plans/data-server.md`; the engine's own side is
`engine/crates/engined/README.md`. Every file here carries its argument in its header — this page is
the map, plus the one thing no single file can state: **how the pieces connect at run time**.

Nothing in this directory is reachable without `EQC_ENGINE=1` in the environment. That is the one
switch for the whole feature, read in exactly one place (`engineHost.ts engineEnabled`).

## The files

| File | What it owns |
| --- | --- |
| `engineProtocol.ts` | The pure facts both halves share: the announce line's grammar, the binary's candidate paths, backoff, the exit-trail fold, `redactToken`. No I/O. |
| `token.ts` | Minting the per-launch secret. (`src/shared/dataServer/token.ts` holds the shape rules; loopback is not a permission boundary — the token is.) |
| `supervisor.ts` | The lifecycle STATE MACHINE: spawn, watch, respawn, kill. Electron-free and dependency-injected, so every failure path is a unit test with no app and no Rust. |
| `engineHost.ts` | The composition root's half: which binary, which spawn, which socket, which clock, where a line goes. The only file anyone would rewrite to run the engine some other way. |
| `socketChannel.ts` | The only file in the feature that knows a socket exists. |
| `engineHealth.ts` | "Is it actually serving?", asked as `hello` + `session.health` over the product's own door. |
| `engineClientHost.ts` | **The app as a CLIENT** (JOS-479): connect, attach, re-attach, and run the parity probe. |
| `parityProbe.ts` | The probe's pure half — two snapshots in, one verdict out, one line. |

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
| `tests/dataServerParity.test.mts` | The probe's judgement: agreement, divergence, drift-is-a-skip, the two refusal sentences, the line's shape. |
| `tests/dataServerEngineChild.test.mts` | The real child, pipe and socket against a Node fake engine. |
| `tests/e2e/engine-boots.e2e.mts` | The real binary under the real app: spawn, ready, respawn, wrong token, quit, absence. |
| `tests/e2e/engine-parity.e2e.mts` | The connect flow and the probe end to end on a staged fixture. |
| `npm run oracle:rust-fold` | The semantics bar: twenty modules, six slices of the owner's real log. |
