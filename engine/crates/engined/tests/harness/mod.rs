//! THE SUITE DRIVES THE REAL BINARY. Every test in this crate's `tests/` spawns
//! `CARGO_BIN_EXE_engined` as a child process, hands it a token on stdin, parses the announce line
//! off its stdout and talks to it over a real loopback socket.
//!
//! WHY NOT TEST THE FUNCTIONS DIRECTLY. Because the thing this ticket delivers is a CONTRACT
//! BETWEEN TWO PROCESSES written in two languages, and every interesting way it can break lives in
//! the seams a unit test does not have: a token that never arrives, a line that is not flushed, a
//! socket that hands over half a frame, a stdin that closes while three connections are open. The
//! op table has its own unit tests beside the code; this suite exists to prove the process.
//!
//! `dead_code` is allowed because this module is compiled into EVERY test binary in `tests/`, and
//! no single one of them uses all of it. That is the standard shape for a shared test harness and
//! the alternative — splitting the harness per consumer — would duplicate the part most worth
//! having one copy of.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use protocol::generated::{
    ClientMessage, EchoParams, EchoRequest, EchoRequestOp, EngineMessage, Hello, HelloOp, NoParams,
    RequestId, SessionAttachParams, SessionAttachRequest, SessionAttachRequestOp,
    SessionHealthRequest, SessionHealthRequestOp, SessionProgressRequest, SessionProgressRequestOp,
    Token, ViewDescriptor, ViewSubscribeRequest, ViewSubscribeRequestOp, ViewUnsubscribeParams,
    ViewUnsubscribeRequest, ViewUnsubscribeRequestOp,
};
use protocol::transport::ndjson::NdjsonTransport;
use protocol::transport::{Transport, TransportError};

/// A token of exactly the shape the app mints: 64 hex characters, 256 bits.
pub const TOKEN: &str = "0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f7089";

/// A different token of the same shape. Used to prove the compare is a compare.
pub const WRONG_TOKEN: &str = "0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f708a";

/// How long any read in this suite may block before the test is called hung.
///
/// It is a FAILURE MECHANISM, not a synchronization one: nothing here waits for the clock, every
/// assertion waits for a condition, and this is only what turns a deadlock into a red test instead
/// of a cargo run that never returns.
///
/// THIRTY SECONDS BECAUSE A FOLD IS A REAL PIECE OF WORK NOW (JOS-474). `tests/ingest.rs` waits for
/// a debug-build engine to build the whole committed spell DB and scan ~900 KB of log before its
/// first frame can exist — measured in seconds, not milliseconds — and a patience shorter than the
/// work is a timeout pretending to be an assertion. It costs nothing on a passing run.
pub const PATIENCE: Duration = Duration::from_secs(30);

/// A spawned engine process, with its stdin, its stdout and the port it announced.
pub struct Engine {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    /// The loopback port from the announce line.
    pub port: u16,
    /// The protocol version from the announce line.
    pub protocol_version: i64,
    /// The announce line itself, terminator included.
    pub announce: String,
}

impl Engine {
    /// Spawn an engine holding the suite's usual token.
    #[must_use]
    pub fn start() -> Self {
        Self::start_with(TOKEN)
    }

    /// Spawn an engine holding a token of the caller's choosing.
    ///
    /// # Panics
    /// If the binary will not run, or does not announce a port in the agreed shape.
    #[must_use]
    pub fn start_with(token: &str) -> Self {
        let (mut child, mut stdin) = spawn();
        // THE TERMINATOR IS AN EXPLICIT LF. `writeln!` would be the same bytes today, but the
        // contract says LF and this file is one half of a cross-language agreement — the other half
        // is a Node `child.stdin.write()`, which has no opinion about platform line endings either.
        stdin
            .write_all(format!("{token}\n").as_bytes())
            .and_then(|()| stdin.flush())
            .expect("the token reaches the engine");

        let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
        let mut announce = String::new();
        let read = stdout
            .read_line(&mut announce)
            .expect("the engine's stdout is readable");
        assert!(
            read > 0,
            "the engine exited without announcing a port (status {:?})",
            child.wait().ok()
        );
        let (port, protocol_version) = parse_announce(&announce);

        Self {
            child: Some(child),
            stdin: Some(stdin),
            stdout: Some(stdout),
            port,
            protocol_version,
            announce,
        }
    }

    /// Open a connection to this engine. The socket carries a read timeout so a hung engine fails
    /// a test instead of hanging the runner.
    ///
    /// # Panics
    /// If the port will not accept a connection.
    #[must_use]
    pub fn connect(&self) -> Client {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, self.port));
        let stream = TcpStream::connect_timeout(&address, PATIENCE).expect("the engine accepts");
        Client::over(stream)
    }

    /// Open a connection and complete the handshake with the right token.
    ///
    /// # Panics
    /// If the handshake is refused.
    #[must_use]
    pub fn connected(&self) -> Client {
        let mut client = self.connect();
        client.handshake(TOKEN, self.protocol_version);
        client
    }

    /// Close stdin — the supervisor going away — and wait for the process to end.
    ///
    /// # Panics
    /// If the engine has not exited within [`PATIENCE`].
    pub fn close_stdin_and_wait(&mut self) -> std::process::ExitStatus {
        self.stdin = None;
        let child = self.child.as_mut().expect("the engine is still held");
        let deadline = Instant::now() + PATIENCE;
        loop {
            match child.try_wait().expect("the child can be waited on") {
                Some(status) => return status,
                None => assert!(
                    Instant::now() < deadline,
                    "the engine outlived its stdin by more than {PATIENCE:?}"
                ),
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// Everything the engine wrote to stdout after the announce line. Consumes the reader, so call
    /// it once, after the process has exited.
    ///
    /// # Panics
    /// If stdout cannot be read.
    pub fn remaining_stdout(&mut self) -> String {
        let mut rest = String::new();
        self.stdout
            .take()
            .expect("stdout is still held")
            .read_to_string(&mut rest)
            .expect("stdout is readable");
        rest
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // A FAILING TEST MUST NOT LEAK A PROCESS. Closing stdin is the polite ending and the one
        // the contract names; the kill is for the case where the assertion that failed was
        // precisely "it exits when stdin closes".
        self.stdin = None;
        if let Some(mut child) = self.child.take() {
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let _ignored = child.kill();
            let _ignored = child.wait();
        }
    }
}

/// Spawn the binary under test with its three streams arranged.
///
/// STDERR GOES NOWHERE ON PURPOSE. The engine writes a diagnostic for every refused connection and
/// this suite refuses a great many on purpose; inheriting it would bury the runner's own output in
/// expected noise, and piping it without draining it would eventually block the child on a full
/// pipe. When a test needs to see a diagnostic, run the binary by hand — the crate README says how.
fn spawn() -> (Child, ChildStdin) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_engined"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the engine binary runs");
    let stdin = child.stdin.take().expect("stdin is piped");
    (child, stdin)
}

/// Spawn the binary and give the caller the raw child, for the tests that are about STARTUP rather
/// than about a running engine.
///
/// # Panics
/// If the binary will not run.
#[must_use]
pub fn spawn_raw() -> (Child, ChildStdin) {
    spawn()
}

/// Read the announce line the contract states, strictly.
///
/// STRICT ON PURPOSE. This is the one line a supervisor written in another language has to parse,
/// so the test that reads it must not be more forgiving than the parser on the other side will be.
///
/// # Panics
/// If the line is not exactly `EQC-ENGINE PORT=<port> PROTOCOL=<version>` with an LF terminator.
#[must_use]
pub fn parse_announce(line: &str) -> (u16, i64) {
    assert!(
        line.ends_with('\n'),
        "the announce line must be terminated: {line:?}"
    );
    assert!(
        !line.trim_end_matches('\n').contains('\r'),
        "the terminator is LF, never CRLF: {line:?}"
    );
    let fields: Vec<&str> = line.trim_end().split(' ').collect();
    let [tag, port, protocol] = fields.as_slice() else {
        panic!("the announce line has three fields: {line:?}");
    };
    assert_eq!(*tag, "EQC-ENGINE", "{line:?}");
    let port = port
        .strip_prefix("PORT=")
        .unwrap_or_else(|| panic!("{line:?}"))
        .parse()
        .unwrap_or_else(|e| panic!("{line:?}: {e}"));
    let protocol = protocol
        .strip_prefix("PROTOCOL=")
        .unwrap_or_else(|| panic!("{line:?}"))
        .parse()
        .unwrap_or_else(|e| panic!("{line:?}: {e}"));
    (port, protocol)
}

/// The client end of one connection.
///
/// ITS OUTBOUND TYPE IS `serde_json::Value` SO THE SUITE CAN BE RUDE. Well-formed requests are
/// built from the generated types and converted — the shapes are never hand-written — but a suite
/// that could only send legal messages could not test `unknownOp`, `badParams`, or a malformed
/// frame, and those are three of the paths most worth pinning.
pub struct Client {
    transport: NdjsonTransport<BufReader<TcpStream>, TcpStream, serde_json::Value, EngineMessage>,
    raw: TcpStream,
}

impl Client {
    fn over(stream: TcpStream) -> Self {
        stream
            .set_read_timeout(Some(PATIENCE))
            .expect("a read timeout can be set");
        stream.set_nodelay(true).expect("nodelay can be set");
        let raw = stream.try_clone().expect("the socket can be duplicated");
        let write = stream.try_clone().expect("the socket can be duplicated");
        Self {
            transport: NdjsonTransport::new(BufReader::new(stream), write),
            raw,
        }
    }

    /// Send one well-formed client message.
    ///
    /// # Panics
    /// If the message will not serialize or the socket will not take it.
    pub fn send(&mut self, message: &ClientMessage) {
        let value = serde_json::to_value(message).expect("a client message serializes");
        self.transport
            .send(&value)
            .expect("the engine is listening");
    }

    /// Send bytes exactly as given — no framing help, no encoding.
    ///
    /// # Panics
    /// If the socket will not take them.
    pub fn send_bytes(&mut self, bytes: &[u8]) {
        self.raw.write_all(bytes).expect("the socket accepts bytes");
        self.raw.flush().expect("the socket flushes");
    }

    /// Send bytes ONE AT A TIME, flushing after each.
    ///
    /// THE ADVERSARIAL CASE, and the reason it is here: `OneByteAtATime` in
    /// `engine/crates/protocol/tests/transport.rs` proves the codec survives a read boundary in any
    /// position, but it proves it over a `Cursor`. This proves it over the thing the engine will
    /// actually be handed — a socket, with the kernel deciding where the boundaries fall — by
    /// making every boundary fall in the worst place there is.
    ///
    /// # Panics
    /// If the socket will not take them.
    pub fn send_bytes_one_at_a_time(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.raw.write_all(&[*byte]).expect("the socket accepts");
            self.raw.flush().expect("the socket flushes");
        }
    }

    /// Take the next message, insisting there is one.
    ///
    /// # Panics
    /// If the connection ended or the wire failed.
    pub fn recv(&mut self) -> EngineMessage {
        match self.transport.recv() {
            Ok(Some(message)) => message,
            Ok(None) => panic!("the engine closed the connection when a message was expected"),
            Err(e) => panic!("the engine's wire failed when a message was expected: {e}"),
        }
    }

    /// Take the next message, or `None` if the connection ended.
    ///
    /// # Errors
    /// Whatever the transport reports.
    pub fn try_recv(&mut self) -> Result<Option<EngineMessage>, TransportError> {
        self.transport.recv()
    }

    /// Assert the engine has closed this connection.
    ///
    /// A CLEAN FIN AND A RESET ARE THE SAME OUTCOME. Windows will report a socket closed with
    /// unread data in its buffer as a reset rather than an orderly end, and which one a test sees
    /// depends on timing the engine does not control. A READ TIMEOUT IS NOT ACCEPTED, because a
    /// timeout means the connection is still open — which is the failure this assertion exists to
    /// catch.
    ///
    /// # Panics
    /// If a message arrives, or if the read times out with the connection still open.
    pub fn expect_closed(&mut self) {
        match self.transport.recv() {
            Ok(None) => {}
            Ok(Some(message)) => panic!("expected a closed connection, got {message:?}"),
            Err(TransportError::Io(e)) => {
                assert!(
                    !matches!(
                        e.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ),
                    "the connection was still open after {PATIENCE:?}"
                );
            }
            Err(e) => panic!("expected a closed connection, got {e}"),
        }
    }

    /// Present a hello and take the reply, whatever it says.
    ///
    /// # Panics
    /// If the token is not a legal shape or the reply is not a hello reply.
    pub fn say_hello(
        &mut self,
        token: &str,
        protocol_version: i64,
    ) -> protocol::generated::HelloReply {
        self.send(&ClientMessage::Hello(Hello {
            op: HelloOp::Hello,
            protocol_version,
            token: Token::try_from(token).expect("a token of legal shape"),
        }));
        match self.recv() {
            EngineMessage::HelloReply(reply) => reply,
            other => panic!("a hello is answered by a hello reply, got {other:?}"),
        }
    }

    /// Present a hello and insist it is accepted.
    ///
    /// # Panics
    /// If the handshake is refused.
    pub fn handshake(&mut self, token: &str, protocol_version: i64) {
        let reply = self.say_hello(token, protocol_version);
        assert!(reply.ok, "the handshake was refused: {reply:?}");
    }
}

/// One `echo` request.
#[must_use]
pub fn echo(id: i64, text: &str) -> ClientMessage {
    ClientMessage::EchoRequest(EchoRequest {
        id: RequestId(id),
        op: EchoRequestOp::Echo,
        params: EchoParams {
            text: text.to_owned(),
        },
    })
}

/// One `session.health` request.
#[must_use]
pub fn health(id: i64) -> ClientMessage {
    ClientMessage::SessionHealthRequest(SessionHealthRequest {
        id: RequestId(id),
        op: SessionHealthRequestOp::SessionHealth,
        params: NoParams {},
    })
}

/// One `session.attach` request.
#[must_use]
pub fn attach(id: i64, log_path: &str) -> ClientMessage {
    ClientMessage::SessionAttachRequest(SessionAttachRequest {
        id: RequestId(id),
        op: SessionAttachRequestOp::SessionAttach,
        params: SessionAttachParams {
            log_path: log_path.to_owned(),
        },
    })
}

/// One `session.progress` request.
#[must_use]
pub fn progress(id: i64) -> ClientMessage {
    ClientMessage::SessionProgressRequest(SessionProgressRequest {
        id: RequestId(id),
        op: SessionProgressRequestOp::SessionProgress,
        params: NoParams {},
    })
}

/// One `view.subscribe` request over the named source.
#[must_use]
pub fn subscribe(id: i64, source: &str) -> ClientMessage {
    ClientMessage::ViewSubscribeRequest(ViewSubscribeRequest {
        id: RequestId(id),
        op: ViewSubscribeRequestOp::ViewSubscribe,
        params: ViewDescriptor {
            source: source.to_owned(),
            filter: None,
            sort: Vec::new(),
            window: None,
        },
    })
}

/// One `view.unsubscribe` request naming a subscription.
#[must_use]
pub fn unsubscribe(id: i64, subscription: i64) -> ClientMessage {
    ClientMessage::ViewUnsubscribeRequest(ViewUnsubscribeRequest {
        id: RequestId(id),
        op: ViewUnsubscribeRequestOp::ViewUnsubscribe,
        params: ViewUnsubscribeParams {
            subscription: RequestId(subscription),
        },
    })
}
