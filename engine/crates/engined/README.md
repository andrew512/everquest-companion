# `engined` — the engine process

Phase 0 of JOS-459 (JOS-466). A binary that can be spawned, handed a secret, talked to over
loopback TCP, and killed. **There is no game logic in this crate** — no tailer, no parser, no fold.
Those arrive in later crates and are reached through the one door in `src/world.rs`.

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

| Op | Answer | Phase 0 behaviour |
| --- | --- | --- |
| `hello` | `HelloReply` | Token compared in constant time, then `protocolVersion`. A mismatch is fatal — version skew is a build error. |
| `echo` | `EchoResult` | Returns the text it was given. |
| `session.health` | `HealthResult` | `status: "idle"` always: nothing folds here, so no other status would be honest. Plus the epoch and the process uptime. |
| `session.attach` | `AttachResult` | **Stub.** Bumps the epoch and broadcasts an `EpochMessage { reason: "attach" }` to every connection, then replies `accepted: true`. Opens no file, reads no byte, folds nothing; `logPath` is not read. |
| `session.progress` | `SubscribeAck` | Acknowledges the connection-wide progress channel. No frame ever follows in phase 0 — the attach stub starts no fold, so there is no progress to report. |
| `view.subscribe` | `SubscribeAck`, then a `reset` | Reset-then-diffs holds for an empty window: `total: 0`, `rows: []`. Every descriptor is accepted; the source registry (and its `notFound`) arrives in phase 3. |
| `view.unsubscribe` | `SubscribeAck { subscribed: false }` | `notFound` for a subscription this connection does not hold. Subscriptions are per-connection, so one client can never close another's stream. |
| anything else | `ErrorReply { unknownOp }` | The connection survives — a refused request is not a broken conversation. |

A known op with unreadable params is `badParams`. A frame that is not a message at all, or one with
no `id` to correlate a refusal with, **closes the connection** — the schema's own rule is that a
failure with no request behind it has nowhere to put an error.

On the attaching connection the epoch announcement arrives **before** the reply, because the bump
and its broadcast happen in one critical section. That ordering is pinned by test: a client can
never see a reply naming a generation it has not been told about.

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

## Reading order

* `src/main.rs` — the spawn contract, stated in full, and the accept loop.
* `src/spawn.rs` — the token, the announce line, the stdin watch. The announce line is a pure
  function because it is a cross-language contract.
* `src/wire.rs` — why one socket becomes two transports, and why no byte of framing lives here.
* `src/world.rs` — **the one door.** Read this before adding any state anywhere: it carries the
  cache-transparency laws (owner ruling 18) that every later phase inherits.
* `src/ops.rs` — the op table, and the argument for why the inbound type is `serde_json::Value`
  rather than `ClientMessage`.
* `src/conn.rs` — one connection from hello to close, and the two-thread/one-outbox shape.
