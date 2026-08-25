# `engined` — the engine process

JOS-459. A binary that can be spawned, handed a secret, talked to over loopback TCP, and killed
(phase 0, JOS-466); one that INGESTS (JOS-474): `session.attach` opens the named log, scans it at
full speed and follows it live; and, since **JOS-478**, one that SERVES — the twenty-module fold
runs on the ingest thread and `module.snapshot` answers a client with a module's published state.

**The game logic is not in this crate.** `eqlog` owns what an event is (JOS-469, proven
byte-identical to the TS parser) and what a line is (JOS-472, proven scan-equivalent); the fold that
turns events into state lives in `fold` (JOS-471/475/476, all twenty modules proven against the TS
snapshots on six slices) and reaches this crate through **one trait** (`ingest::EventSink`, joined
in `src/foldsink.rs` — see "The fold seam"). This crate owns the process, the protocol, and the
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
| `session.health` | `HealthResult` | The **ingest's** status — `idle` / `starting` / `attaching` / `folding` / `live` — plus the epoch, the process uptime, and, once a log is attached, **the mark** (`{log, offset}`), the folded event count and the log's own last timestamp. Those three are OPTIONAL and absent before the first attach: a zero would be a measurement nobody took. |
| `module.snapshot` | `ModuleSnapshotResult` | **The first data-bearing op.** One module's published `{seq, state}`, straight off the fold on the ingest thread. `notFound` for a name the registry does not carry; `unavailable` when nothing is attached. See "The fold seam". |
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
| `attaching` | Opening the log and building what a fold depends on — the spell DB, the character name (off the FILE NAME: `eqlog_<Name>_<server>.txt`, or the oracle corpus's `…_<server>.<slice>.txt`), and the twenty-module registry. |
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

**Both integrator notes phase 2 left here are closed** (JOS-478). The mark, the folded event count
and the log's last timestamp are on the wire now, optional, in `HealthResult` — the schema gap is
gone. And the spell DB is built **once per process**: `eqlog::Parser` holds an `Arc<SpellDb>` and
`eqlog::spelldb::shared()` is the one copy, so the 386 ms rebuild that used to happen on every attach
happens once — and the fold's own resist catalog, which was quietly doing a *second* full load behind
its lazy table, reads that same handle. The ingest still prints its measurement, so a slow attach
still says why.

## The fold seam

Ingest terminates in one trait, and `src/foldsink.rs` is the whole of what joins it to `fold` — the
ingest loops, the generation law, the progress cadence and the mark did not move to let it in.

```rust
pub struct Event<'a> { pub json: &'a str, pub seq: i64, pub live: bool }

pub trait EventSink {
    fn event(&mut self, event: &Event<'_>);
    fn report(&self) -> SinkReport { SinkReport::default() }              // defaulted
    fn snapshot(&self, _module: &str) -> Option<ModuleSnapshot> { None }  // defaulted
}

pub struct SinkInputs<'a> {
    pub log: &'a Path,
    pub character: Option<&'a str>,
    pub db: Option<&'a spelldb::SpellDb>,   // the PARSER's own catalog, never a second load
    pub clock: &'a Clock,                   // the PARSER's own clock, so the launch anchor agrees
    pub attached_at_ms: i64,                // the construction clock: WHEN this world was built
}
```

**The trait is not `Send`, and the factory takes the parse's inputs.** Those are one edit, and it is
the edit that made the fold constructible at all. A sink used to be built on the *connection* thread
and moved into the ingest thread; it is built on the ingest thread now, after the parser and the
catalog exist — so `fold::ClusterDeps` can see the spell DB's key set and its class index, which is
the knot phase 2 wrote down here and could not untie. Two things fall out of it: tens of
milliseconds of index projection no longer sit in front of the `accepted` reply, and the sink never
crosses a thread boundary, so `Send` would now FORBID the fold (`fold::Fold` holds the
buffs/buffTimers shared core in an `Rc<RefCell<…>>` — exactly right for state that lives on one
thread, and exactly what `Send` refuses). The single-threadedness is stated by the type rather than
promised by a comment.

`src/foldsink.rs`'s header argues every `ClusterDeps` field. Five are committed data read off the
catalog; three are **app knowledge and empty on purpose** — `self_name`, `respawn_prefs`, and the
app-supplied halves of alerts / buff trust / combo corrections / roster edits. Those arrive as
`*.define` commands when the app connects (boundary verdict 3: the engine never reads a settings
file). Until then the engine is constructed exactly as `tests/bench/foldArm.mts construct()` builds
the bench world, which is not a shortcut: that is the world the six-slice equivalence oracle recorded
its goldens under, so an engine matching anything else would be provably right about a world nobody
has measured. The `character` ref is the one exception and is *not* pushed — `{name, server,
logPath}` comes off the log's own file name, the same fact the parser derives its character from.

**The construction clock is the attach instant, and that is production-faithful.** `respawn` seeds
an ordering clock from `WorldOpts.constructionNowMs`; the golden recorder pins it to the slice's last
timestamped line so a golden re-checks tomorrow, but production TypeScript has always used
`Date.now()` at construction. A live world is built when the attach happens, so that is the instant —
and it is the only wall clock any of this reaches (ruling 18 law 1).

**Answering `module.snapshot` is a channel, not a lock.** The fold lives on the ingest thread; a
request arrives on a connection thread. A `Mutex<Fold>` would make the fold's hot loop take a lock
per event for a reader that asks twice a minute, and would put a second owner on state whose whole
design is one door. A snapshot copy published after every event is a cache, which ruling 5 forbids.
So the reader posts an ask and waits, and the ingest answers it at a boundary it *already reaches* —
between two reads of the scan, or between two naps of the tail. The fold is never shared, never
locked and never interrupted mid-event, which is what makes a mid-scan answer a **real prefix
state**: every event up to `seq` and no part of another. `World::module_snapshot` owns the
five-second deadline that turns a wedged ingest into an `unavailable` reply rather than a connection
that never answers, and it holds no lock across the wait. `ingest.rs`'s `SnapshotAsk` header carries
the full argument, including the two shapes that were rejected.

**The combat engine is deliberately not subscribed.** It is not a module — `WIRING_ORDER` does not
name it and `module.snapshot` is a registry op — and its surfaces are views (`.combat.selected`,
`.combat.timeline`, the scopes walk). The ticket that builds `view.subscribe`'s source registry turns
it on with one builder call (`Fold::with_combat`) and nothing else here moves; the coupling is
one-way and checked, so a fold without it publishes exactly what a fold with it publishes.

Three things worth knowing about the seam:

* **The event is its serialized JSON.** There is no struct per kind to hand over — `eqlog` writes a
  struct per *branch*, because the phase-1 bar is byte identity with `JSON.stringify(ev)` and
  insertion order is a property of the code path. A fold that wants fields parses the line it is
  given, exactly as `session.ts` hands `Tailer`'s line to the parser today.
* **`event.json` is borrowed** and valid for exactly that call; it lives in the parser's reused
  buffer. A sink that keeps it copies it, which makes the copy the sink's decision.
* **`event()` runs on the ingest thread and on no other**, one call per event, in emission order —
  and a *new* sink is built for every attach, so a registry never sees two folds. There is no reset
  to implement: a preempted fold's sink is dropped with its thread. `snapshot()` runs there too, and
  takes `&self`: reading a module's state is a read, and a snapshot that could advance the fold
  would make the answer depend on who asked.

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

> That transcript is from JOS-474, when the sink was a counter and the fold's own numbers reached
> nobody. It is kept because every claim in it still holds — with one line's wording moved: the
> diagnostic now reads `spell db ready in …`, because a second attach in the same process no longer
> BUILDS one. The next section is the same session with the fold turned on.

## Watching the fold serve, by hand

Another **real session**, same shape as above — a release build, a copy of the same committed
fixture staged twenty times over. The driver is a sibling of the one above with the interesting
lines swapped: it asks `session.health` and `module.snapshot` BEFORE the attach, twice DURING the
scan, and once after the tail takes over.

```js
// scratch/drive478.mjs — node scratch/drive478.mjs <repo root> [repeats]
// (staging, spawn and frame printing are drive.mjs's, verbatim; only `talk` differs)
function talk(port) {
  const s = net.connect({ host: '127.0.0.1', port })
  let buf = ''
  let landed = false
  const send = (o) => { console.log('-> ' + JSON.stringify(o)); s.write(JSON.stringify(o) + '\n') }
  s.on('connect', () => {
    send({ op: 'hello', token: TOKEN, protocolVersion: 1 })
    send({ id: 1, op: 'session.health', params: {} })     // no attach: no coordinate at all
    send({ id: 2, op: 'module.snapshot', params: { module: 'leveling' } })   // no fold to ask
    send({ id: 3, op: 'session.attach', params: { logPath: log } })
    setTimeout(() => send({ id: 4, op: 'module.snapshot', params: { module: 'leveling' } }), 600)
    setTimeout(() => send({ id: 5, op: 'module.snapshot', params: { module: 'leveling' } }), 900)
  })
  s.on('data', (d) => {
    buf += d.toString()
    const parts = buf.split('\n'); buf = parts.pop()
    for (const line of parts.filter(Boolean)) {
      console.log('<- ' + (line.length > 250 ? line.slice(0, 250) + ' …' : line))
      const msg = JSON.parse(line)
      if (!landed && msg.kind === 'epoch' && msg.reason === 'progress' && msg.progress.pct === 100) {
        landed = true
        setTimeout(() => {
          send({ id: 6, op: 'module.snapshot', params: { module: 'leveling' } })
          send({ id: 7, op: 'module.snapshot', params: { module: 'character' } })
          send({ id: 8, op: 'module.snapshot', params: { module: 'loot.ledger' } })
          send({ id: 9, op: 'session.health', params: {} })
          setTimeout(() => { s.end(); engine.stdin.end(); fs.rmSync(dir, { recursive: true }) }, 400)
        }, 150)
      }
    }
  })
}
```

**The only edit to the frames below is the `…`**: four `leveling`/`character` lines are cut at
column 250, because a module's state is as long as the module says it is and this is a README. Every
other byte is what came off the socket.

```console
$ cargo build --release -p engined
$ node scratch/drive478.mjs C:/Users/jmoye/everquest-companion 20
# staged C:\t478\engined-478-6ikaTi\eqlog_Primitive_freeport.txt (9185240 bytes)
EQC-ENGINE PORT=64299 PROTOCOL=1
-> {"op":"hello","token":"0f7d…7089","protocolVersion":1}
-> {"id":1,"op":"session.health","params":{}}
-> {"id":2,"op":"module.snapshot","params":{"module":"leveling"}}
-> {"id":3,"op":"session.attach","params":{"logPath":"C:\\t478\\engined-478-6ikaTi\\eqlog_Primitive_freeport.txt"}}
<- {"engineVersion":"0.1.0","kind":"hello","ok":true,"protocolVersion":1}
<- {"id":1,"kind":"reply","ok":true,"result":{"epoch":1,"status":"idle","uptimeMs":1}}
<- {"error":{"code":"unavailable","message":"no log is attached, so there is no fold to ask"},"id":2,"kind":"error","ok":false}
<- {"epoch":2,"kind":"epoch","reason":"attach"}
<- {"id":3,"kind":"reply","ok":true,"result":{"accepted":true,"epoch":2}}
[eqc-engine] ingest: spell db ready in 403 ms
<- {"epoch":2,"kind":"epoch","progress":{"events":15932,"pct":11.415401230670074},"reason":"progress"}
-> {"id":4,"op":"module.snapshot","params":{"module":"leveling"}}
<- {"id":4,"kind":"reply","ok":true,"result":{"module":"leveling","seq":47889,"state":{"aaGains":[],"aaPotions":[],"aaSpends":[],"levels":[{"level":50,"ts":1785539944000},{"level":11,"ts":1785662014000},{"level":12,"ts":1785662400000},{"level":13,"ts":1 …
<- {"epoch":2,"kind":"epoch","progress":{"events":79788,"pct":57.07925976893363},"reason":"progress"}
-> {"id":5,"op":"module.snapshot","params":{"module":"leveling"}}
<- {"id":5,"kind":"reply","ok":true,"result":{"module":"leveling","seq":111762,"state":{"aaGains":[],"aaPotions":[],"aaSpends":[],"levels":[{"level":50,"ts":1785539944000},{"level":11,"ts":1785662014000},{"level":12,"ts":1785662400000},{"level":13,"ts": …
[eqc-engine] fold landed: 139860 events, mark 9185240 of C:\t478\engined-478-6ikaTi\eqlog_Primitive_freeport.txt, now live
<- {"epoch":2,"kind":"epoch","progress":{"events":139860,"pct":100.0},"reason":"progress"}
-> {"id":6,"op":"module.snapshot","params":{"module":"leveling"}}
-> {"id":7,"op":"module.snapshot","params":{"module":"character"}}
-> {"id":8,"op":"module.snapshot","params":{"module":"loot.ledger"}}
-> {"id":9,"op":"session.health","params":{}}
<- {"id":6,"kind":"reply","ok":true,"result":{"module":"leveling","seq":139859,"state":{"aaGains":[],"aaPotions":[],"aaSpends":[],"levels":[{"level":50,"ts":1785539944000},{"level":11,"ts":1785662014000},{"level":12,"ts":1785662400000},{"level":13,"ts": …
<- {"id":7,"kind":"reply","ok":true,"result":{"module":"character","seq":37,"state":{"character":{"logPath":"C:\\t478\\engined-478-6ikaTi\\eqlog_Primitive_freeport.txt","name":"Primitive","server":"freeport"},"level":{"level":42,"source":"ding","ts":178 …
<- {"error":{"code":"notFound","message":"this engine folds no module named \"loot.ledger\""},"id":8,"kind":"error","ok":false}
<- {"id":9,"kind":"reply","ok":true,"result":{"epoch":2,"events":139860,"lastEventTs":1785795360000,"mark":{"log":"C:\\t478\\engined-478-6ikaTi\\eqlog_Primitive_freeport.txt","offset":9185240},"status":"live","uptimeMs":1304}}
```

Seven things in that transcript are this ticket:

1. **A world with no fold says so, and says it differently from a world with no such module.** `id:2`
   is `unavailable` — nothing is attached, and the request was fine. `id:8`, after the fold is live,
   is `notFound`: `loot.ledger` is a VIEW source name, and a client that confused the two has to be
   told rather than handed an empty state.
2. **Health before the attach carries `status`, `epoch`, `uptimeMs` and nothing else.** No `mark`, no
   `events`, no `lastEventTs` — absent, not zero, because a fresh process has no coordinate and
   `offset: 0` would be a measurement nobody took.
3. **The scan is answerable while it runs.** `id:4` comes back at `seq: 47889` and `id:5` at
   `111762`, both of them mid-fold — the door opens before the first byte is folded, and each answer
   is served at a read boundary the scan was going to reach anyway.
4. **Those two answers are PREFIX STATES, not previews.** `levels` grows between them and neither is
   torn: `tests/module_snapshot.rs` catches a mid-scan answer, folds the same bytes stopped at the
   `seq` it named, and deep-equals the two.
5. **A module's `seq` is its own.** `leveling` lands on `139859` — the last event of 139,860,
   counting from zero — while `character` answers `37`, because it is one of the four modules that
   publish a private REVISION counter (JOS-87). The protocol says `seq` is a hydration cursor and not
   the fold's event count, and this is the line that shows why the two had to be different fields.
6. **The state's shape is the module's.** `leveling` publishes an object of four arrays; `character`
   publishes the CharacterRef the engine DERIVED from the log's file name — `{name, server, logPath}`
   — beside a level the log stated. The protocol names neither shape.
7. **Health carries the mark.** `9185240`, which is the file's last byte because this fixture ends on
   a newline; `events: 139860`, the count `eqlog`'s proven scan finds in the same bytes; and
   `lastEventTs`, the LOG's clock rather than the host's. That is ruling 18 law 3 on the wire: state
   addressed by (log identity, byte offset), and never by "current".

The `spell db ready in 403 ms` line is a first attach. A second attach in the same process reads ~0:
the catalog is `Arc`-shared per process now, and the fold's resist catalog reads that same one rather
than loading a second.

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

**And the fold is proven against a second fold** (`tests/module_snapshot.rs`). It attaches a staged
fixture to the real binary and, for **every module in `WIRING_ORDER`**, deep-equals the answer with
what a `fold::Fold` of the same bytes publishes — built beside it, in the test process, from the
same eight `ClusterDeps` fields. `respawn` is the one exception and is named rather than dropped: it
seeds an ordering clock from the construction instant, which is the attach engine-side and the
test's own `now` here, so it is compared for shape.

That is a SELF-CONSISTENCY claim and it is deliberately not a semantics one: it proves the path a
request travels — socket, op table, channel, ingest thread, registry — hands back what the fold in
that thread actually holds. `npm run oracle:rust-fold` proves the fold's semantics against the
recorded TypeScript snapshots on six slices of the owner's real log, and re-litigating that here
over a 900 KB fixture would be a weaker copy of a stronger test.

The other three claims in that file: a snapshot caught MID-SCAN deep-equals a fold of the same bytes
stopped at the `seq` it named (the prefix claim, which is the whole reason the design is a channel
rather than a lock); four non-module names are refused, `loot.ledger` among them; and health carries
the mark, the count and the log's clock once live, and none of the three before an attach.

All of them stage a copy of a committed fixture (`tests/fixtures/cw2-loadout-swap-aug2.log`) into a scratch
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
* `src/ingest.rs` — **what an attach does**, the generation law engine-side, the sink seam, and
  `SnapshotAsk`: why a reader talks to the fold through a channel instead of a lock.
* `src/foldsink.rs` — **the join.** One `impl EventSink`, and the only place either crate's
  construction is spelled: what an attach builds, which `ClusterDeps` fields are app knowledge, and
  why the combat engine is not in it.
* `src/ops.rs` — the op table, and the argument for why the inbound type is `serde_json::Value`
  rather than `ClientMessage`.
* `src/conn.rs` — one connection from hello to close, and the two-thread/one-outbox shape.
