# `engined` — the engine process

JOS-459. A binary that can be spawned, handed a secret, talked to over loopback TCP, and killed
(phase 0, JOS-466) — and, since **JOS-474**, one that INGESTS: `session.attach` opens the named log,
scans it at full speed and follows it live.

**The game logic is not in this crate.** `eqlog` owns what an event is (JOS-469, proven
byte-identical to the TS parser) and what a line is (JOS-472, proven scan-equivalent); the fold that
turns events into state arrives in `fold` (JOS-471) and reaches this crate through **one trait**
(`ingest::EventSink` — see "The sink seam"). This crate owns the process, the protocol, and the
question of *who is folding*.

## The spawn contract

Binding, and shared verbatim with the supervisor ticket (JOS-467):

1. The supervisor spawns `engined.exe` with **no secrets in argv or env**. The **first line on
   stdin** is the token, LF-terminated.
2. The engine binds `127.0.0.1:0` and prints **exactly one line** to stdout, flushed:
   `EQC-ENGINE PORT=<port> PROTOCOL=<protocolVersion>`. Nothing else ever goes to stdout;
   diagnostics go to stderr, tagged `[eqc-engine]`.
3. The engine **exits 0 promptly when stdin reaches EOF** — the dies-with-the-app law (owner ruling
   10). No orphan mode, no PID files, no heartbeat.
4. Every TCP connection opens with a valid `hello` (token + `protocolVersion`) or is closed. A
   failed handshake gets one `HelloReply { ok: false }` as a courtesy, then the socket closes.
5. A respawn is a launch: fresh token, fresh epoch, fresh world. Resume is always re-query.

Exit codes: `0` is the contract's own ending. `1` is a refusal to start — no token on stdin, a
first line that cannot be a token, or a loopback socket that would not bind. Everything else this
process can meet is a connection-level failure, and a connection-level failure closes a connection,
never the process.

## Ops

| Op | Answer | Behaviour |
| --- | --- | --- |
| `hello` | `HelloReply` | Token compared in constant time, then `protocolVersion`. A mismatch is fatal — version skew is a build error. |
| `echo` | `EchoResult` | Returns the text it was given. |
| `session.health` | `HealthResult` | The **ingest's** status — `idle` / `starting` / `attaching` / `folding` / `live` — plus the epoch and the process uptime. See "What an attach does". |
| `session.attach` | `AttachResult` | Bumps the epoch, broadcasts an `EpochMessage { reason: "attach" }` to every connection, replies `accepted: true`, and **starts an ingest** over `logPath`. Preempts any in-flight attach. |
| `session.progress` | `SubscribeAck` | Acknowledges the connection-wide progress channel. Its frames are `EpochMessage { reason: "progress", progress: { pct, events } }` — the schema says progress is not a fourth stream kind, it is this. Connection-wide, so an attach on *another* connection is heard here too. |
| `view.subscribe` | `SubscribeAck`, then a `reset` | Reset-then-diffs holds for an empty window: `total: 0`, `rows: []`. Every descriptor is accepted; the source registry (and its `notFound`) arrives in phase 3. The reset is stamped with the epoch **inside** the registration's critical section. |
| `view.unsubscribe` | `SubscribeAck { subscribed: false }` | `notFound` for a subscription this connection does not hold. Subscriptions are keyed by (connection, id), so one client can never close another's stream. |
| anything else | `ErrorReply { unknownOp }` | The connection survives — a refused request is not a broken conversation. |

A known op with unreadable params is `badParams`. A frame that is not a message at all, or one with
no `id` to correlate a refusal with, **closes the connection** — the schema's own rule is that a
failure with no request behind it has nowhere to put an error.

On the attaching connection the epoch announcement arrives **before** the reply, because the bump
and its broadcast happen in one critical section. That ordering is pinned by test: a client can
never see a reply naming a generation it has not been told about.

## What an attach does

One thread per attach (`src/ingest.rs`), and five states a client can watch:

| status | what is happening |
| --- | --- |
| `idle` | Nothing is folding: a fresh process, or one whose ingest ended. |
| `starting` | An attach was accepted. Set inside the epoch's critical section, before the ingest exists. |
| `attaching` | Opening the log and building what a parse is a pure function of — the spell DB and the character name, which comes off the FILE NAME (`eqlog_<Name>_<server>.txt`, or the oracle corpus's `…_<server>.<slice>.txt`). |
| `folding` | The historical scan, at full speed. No yield, no throttle: that is the whole point of the process boundary. |
| `live` | The scan's end offset was handed to the tail (`TailStart::At`) — the lossless seam — and the tail owns the file. |

**The generation law.** An attach PREEMPTS any in-flight attach: last pick wins, never queued.
This is `src/main/switchController.ts`'s `owns()` moved engine-side. The in-flight scan polls the
generation at its read boundaries and abandons **silently** when superseded, and every statement an
ingest makes goes through a `report_*` method that re-asks ownership *inside* the world's lock — so
a turn that has lost can write nothing, ever, however long it takes to notice. No event can
interleave structurally: each attach builds its own sink and its own parser.

**Progress** is bounded to ~4/s and never per line, `pct` is a float measured in bytes
(`mark / bytes × 100`), and the final frame of a scan is forced — a loading bar must not lose the
one frame that states the whole fold to a fold that finished inside one cadence interval. Frames
continue while live whenever the count advances; that is the only wire evidence a live line landed
until views arrive in phase 3.

**The mark.** The engine owns `checkpoint_offset` (boundary verdict 4): the end of the last
*complete* line folded, which is the same definition as `ScanResult.endOffset`. A half-written line
is not an event and the mark waits with it.

> **Schema gap, for the integrator.** `HealthResult` carries `status`, `epoch` and `uptimeMs` and
> has nowhere to put the mark, the folded event count, or the log's last timestamp. The engine owns
> all three and answers them to its own callers through `World::mark`; only `pct`/`events` on a
> progress frame reach a client today. Putting the mark on the wire is a schema change and goes
> through the integrator, not through a worker.

> **Measured, for the integrator.** The spell DB is rebuilt **per attach** (386 ms release, ~5 s
> debug — the ingest prints its own measurement to stderr). It ought to be built once per process:
> it is a pure function of committed data. It is not, because `eqlog::Parser` owns its `SpellDb` by
> value and `SpellDb` is neither `Clone` nor shareable, so a second parser cannot be handed one that
> already exists. Closing it is a one-line change in `eqlog` (derive `Clone`, or take an `Arc`),
> which this ticket did not own.

## The sink seam (for the phase-2a integrator)

Ingest terminates in one trait. Today it is a counter; the fold registry drops in without touching
the ingest loops, the generation law, the progress cadence or the mark.

```rust
pub struct Event<'a> { pub json: &'a str, pub seq: i64, pub live: bool }

pub trait EventSink: Send {
    fn event(&mut self, event: &Event<'_>);
    fn report(&self) -> SinkReport { SinkReport::default() }   // defaulted
}
```

The whole edit is **construction**, in two places. Written against the `fold` crate as it stands on
main (JOS-471/477), whose `Fold` facade already has exactly the shape this seam wants — one
`on_primary(&Event, live)`, and its own `events()`/`last_ts()` to answer with:

```rust
// 1. one impl — it must live in THIS crate anyway, by the orphan rule
impl ingest::EventSink for fold::Fold {
    fn event(&mut self, event: &ingest::Event<'_>) {
        // `Event::from_json` is the fold's own door; a line it declines is a line no module wanted.
        if let Some(ev) = fold::Event::from_json(event.json) {
            self.on_primary(&ev, event.live);
        }
    }
    fn report(&self) -> ingest::SinkReport {
        ingest::SinkReport {
            events: i64::try_from(self.events()).unwrap_or(i64::MAX),
            last_ts: Some(self.last_ts()),
            ..ingest::SinkReport::default()
        }
    }
}

// 2. one line in main.rs
let world = World::with_ingest(ingest::starter(Arc::new(|| {
    Box::new(fold::Fold::new(fold::cluster_2a(known_spell()), LAUNCH_MS))
})));
```

Two questions that construction raises and this crate does not answer, both for the integrator:
`cluster_2a` wants the spell DB's key set, which today is built **inside** the ingest thread (see
the measured note above — that is the same knot); and `Fold::new` wants the launch instant, which
is app knowledge and therefore a `*.define` command's job rather than a constant (boundary verdict
3: the engine never reads a settings file).

Three things worth knowing before writing that impl:

* **The event is its serialized JSON.** There is no struct per kind to hand over — `eqlog` writes a
  struct per *branch*, because the phase-1 bar is byte identity with `JSON.stringify(ev)` and
  insertion order is a property of the code path. A fold that wants fields parses the line it is
  given, exactly as `session.ts` hands `Tailer`'s line to the parser today.
* **`event.json` is borrowed** and valid for exactly that call; it lives in the parser's reused
  buffer. A sink that keeps it copies it, which makes the copy the sink's decision.
* **`event()` runs on the ingest thread and on no other**, one call per event, in emission order —
  and a *new* sink is built for every attach, so a registry never sees two folds. There is no reset
  to implement: a preempted fold's sink is dropped with its thread.

A sink that panics costs the fold and nothing else: the panic is caught, logged to stderr, and the
world goes `idle` with its epoch untouched.

## Running it by hand

Three lines, and the transcript below is a real session (`cargo run` writes its build output to
stderr, so stdout stays clean):

```console
$ TOKEN=0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f7089
$ cd engine
$ { printf '%s\n' "$TOKEN"; sleep 20; } | cargo run -q -p engined
EQC-ENGINE PORT=60869 PROTOCOL=1
```

The `sleep` is the whole trick: it holds stdin open. Pipe the token in on its own and the engine
sees EOF immediately and exits 0, exactly as the contract says it should.

From a second shell, one echo round trip (Node, because the supervisor is written in it and this is
the cheapest proof the two languages agree):

```console
$ node -e "$(cat <<'JS'
const net=require('net');const s=net.connect({host:'127.0.0.1',port:60869});
s.on('data',d=>process.stdout.write('<- '+d));
s.on('connect',()=>{
  s.write(JSON.stringify({op:'hello',token:process.env.TOKEN,protocolVersion:1})+'\n');
  s.write(JSON.stringify({id:1,op:'echo',params:{text:'hello from the app side'}})+'\n');
  setTimeout(()=>s.end(),400);
});
JS
)"
<- {"engineVersion":"0.1.0","kind":"hello","ok":true,"protocolVersion":1}
<- {"id":1,"kind":"reply","ok":true,"result":{"text":"hello from the app side"}}
```

Closing the first shell's pipe (or letting the `sleep` finish) ends the process with status 0.

## Watching a real fold, by hand

Everything below is a **real session**, run against a release build over a copy of a committed
fixture. The driver is one script because the interesting part is the timing — a fold, then an
append — and two shells cannot hold still for it. It stages the log, spawns the engine, attaches,
prints every frame both ways, appends one line when the fold lands, and leaves.

```js
// scratch/drive.mjs — node scratch/drive.mjs <repo root> [repeats]
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.argv[2]
const REPEATS = Number(process.argv[3] ?? 20)   // 20 copies of a 459 KB fixture ≈ 9 MB
const TOKEN = '0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f7089'

// THE LOG IS A COPY, NAMED THE WAY THE PRODUCT NAMES ONE — that is where the character comes from.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engined-manual-'))
const log = path.join(dir, 'eqlog_Primitive_freeport.txt')
const fixture = fs.readFileSync(path.join(ROOT, 'tests/fixtures/cw2-loadout-swap-aug2.log'))
for (let i = 0; i < REPEATS; i++) fs.appendFileSync(log, fixture)
console.log(`# staged ${log} (${fs.statSync(log).size} bytes)`)

const engine = spawn(path.join(ROOT, 'engine/target/release/engined.exe'), {
  stdio: ['pipe', 'pipe', 'inherit'],           // stderr inherited: the engine's diagnostics show
})
engine.stdin.write(TOKEN + '\n')                // the token, and the pipe stays open

let announced = ''
engine.stdout.on('data', (d) => {
  announced += d.toString()
  if (!announced.includes('\n')) return
  console.log(announced.trim())
  talk(Number(/PORT=(\d+)/.exec(announced)[1]))
})

function talk(port) {
  const s = net.connect({ host: '127.0.0.1', port })
  let buf = ''
  let appended = false
  const send = (o) => { console.log('-> ' + JSON.stringify(o)); s.write(JSON.stringify(o) + '\n') }
  s.on('connect', () => {
    send({ op: 'hello', token: TOKEN, protocolVersion: 1 })
    send({ id: 5, op: 'session.progress', params: {} })
    send({ id: 7, op: 'view.subscribe', params: { source: 'loot.ledger' } })
    send({ id: 3, op: 'session.attach', params: { logPath: log } })
  })
  s.on('data', (d) => {
    buf += d.toString()
    const parts = buf.split('\n'); buf = parts.pop()
    for (const line of parts.filter(Boolean)) {
      console.log('<- ' + line)
      const msg = JSON.parse(line)
      if (!appended && msg.kind === 'reset' && msg.epoch === 2) {   // the fold landed
        appended = true
        setTimeout(() => {
          console.log('# the game writes a line')
          fs.appendFileSync(log, '[Wed Aug 19 16:21:54 2026] You gain experience! (3.288%)\n')
          send({ id: 9, op: 'session.health', params: {} })
        }, 300)
      }
      if (appended && msg.kind === 'epoch' && msg.reason === 'progress') {
        setTimeout(() => { s.end(); engine.stdin.end(); fs.rmSync(dir, { recursive: true }) }, 200)
      }
    }
  })
}
```

```console
$ cargo build --release -p engined
$ node scratch/drive.mjs C:/Users/jmoye/everquest-companion 20
# staged C:\Users\…\Temp\engined-manual-MWaZP7\eqlog_Primitive_freeport.txt (9185240 bytes)
EQC-ENGINE PORT=61699 PROTOCOL=1
-> {"op":"hello","token":"0f7d…7089","protocolVersion":1}
-> {"id":5,"op":"session.progress","params":{}}
-> {"id":7,"op":"view.subscribe","params":{"source":"loot.ledger"}}
-> {"id":3,"op":"session.attach","params":{"logPath":"C:\\Users\\…\\eqlog_Primitive_freeport.txt"}}
<- {"engineVersion":"0.1.0","kind":"hello","ok":true,"protocolVersion":1}
<- {"id":5,"kind":"reply","ok":true,"result":{"subscribed":true,"subscription":5}}
<- {"id":7,"kind":"reply","ok":true,"result":{"subscribed":true,"subscription":7}}
<- {"epoch":1,"id":7,"kind":"reset","rows":[],"total":0}
<- {"epoch":2,"kind":"epoch","reason":"attach"}
<- {"id":3,"kind":"reply","ok":true,"result":{"accepted":true,"epoch":2}}
[eqc-engine] ingest: spell db built in 386 ms
<- {"epoch":2,"kind":"epoch","progress":{"events":15932,"pct":11.415401230670074},"reason":"progress"}
[eqc-engine] fold landed: 139860 events, mark 9185240 of C:\Users\…\eqlog_Primitive_freeport.txt, now live
<- {"epoch":2,"kind":"epoch","progress":{"events":139860,"pct":100.0},"reason":"progress"}
<- {"epoch":2,"id":7,"kind":"reset","rows":[],"total":0}
# the game writes a line
-> {"id":9,"op":"session.health","params":{}}
<- {"id":9,"kind":"reply","ok":true,"result":{"epoch":2,"status":"live","uptimeMs":925}}
<- {"epoch":2,"kind":"epoch","progress":{"events":139861,"pct":100.0},"reason":"progress"}
```

Six things in that transcript are the whole ticket:

1. **The announcement precedes the reply.** `{"epoch":2,…,"reason":"attach"}` arrives before the
   `accepted` reply, and it carries **no** `progress` — at the bump the fold has not opened the file
   and a percentage would be an invented measurement.
2. **Progress is a cadence, not a stream.** 9.19 MB and 139,860 events produced *two* frames: one at
   11.4% and the forced final one. `pct` is a float (owner ruling 17).
3. **The final frame states the whole fold** — 139,860, which is exactly what `eqlog`'s proven scan
   finds in those bytes, and what `tests/ingest.rs` asserts against rather than against a number
   anybody typed.
4. **The fold lands as a reset**, per open subscription, naming generation 2. `total: 0` and empty
   rows until the fold registry arrives.
5. **`live` means the tail owns the file** — and the mark, `9185240`, is the file's last byte,
   because this fixture ends on a newline.
6. **The appended line arrives**: `events` goes to 139,861 with `pct` still at its ceiling. That
   round trip — file → poll → parser → sink → wire — took one tail poll.

The `uptimeMs: 925` is the measurement worth keeping: a cold process, a 404 ms spell-DB build and a
9.19 MB fold, all inside a second. (Debug builds are ~10× slower on both halves; the ingest prints
its own spell-DB number so a slow run says why.)

## Tests

```console
$ cd engine
$ cargo test -p engined
```

The integration suites spawn the built binary (`CARGO_BIN_EXE_engined`) and drive the whole contract
through a real socket: the announce line, every op, a wrong token, a skewed `protocolVersion`, an
unknown op, a malformed frame, four concurrent connections, a request delivered **one byte at a
time**, and stdin EOF. `tests/harness/mod.rs` is the shared client; its stderr goes to `null`
because the suite refuses a great many connections on purpose — when a diagnostic matters, run the
binary by hand as above.

**The ingest is proven twice, and the two halves are different claims.**

* `src/ingest.rs`'s own tests drive it **in-process**, where a sink can be held still at a gate.
  That is what makes the awkward claims deterministic rather than timed: the health states walk
  `starting → attaching → folding → live` with the scan frozen at its first event; a second attach
  preempts a fold that is *provably* still running; each sink's stream is contiguous, so an
  interleaving would be visible rather than inferred.
* `tests/ingest.rs` drives it **over the socket**, against the real binary, and owns what a client
  can see: the frames arrive in the promised order, bounded and monotonic, and an appended line
  shows up as a live frame.

Both stage a copy of a committed fixture (`tests/fixtures/cw2-loadout-swap-aug2.log`) into a scratch
directory under the product's own file-name shape. **Every count is settled against
`eqlog::scan::scan_bytes` over the same bytes** — never against a number typed into the test, which
would stop meaning anything the first time the parser learned a line shape. Nothing here touches a
real game log.

## Reading order

* `src/main.rs` — the spawn contract, stated in full, and the accept loop.
* `src/spawn.rs` — the token, the announce line, the stdin watch. The announce line is a pure
  function because it is a cross-language contract.
* `src/wire.rs` — why one socket becomes two transports, and why no byte of framing lives here.
* `src/world.rs` — **the one door.** Read this before adding any state anywhere: it carries the
  cache-transparency laws (owner ruling 18) that every later phase inherits, and the critical
  section the epoch, the generation and the subscription resets all share.
* `src/ingest.rs` — **what an attach does**, the generation law engine-side, and the sink seam.
* `src/ops.rs` — the op table, and the argument for why the inbound type is `serde_json::Value`
  rather than `ClientMessage`.
* `src/conn.rs` — one connection from hello to close, and the two-thread/one-outbox shape.
