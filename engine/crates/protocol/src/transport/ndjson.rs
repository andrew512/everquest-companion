//! NDJSON framing — one JSON message per LF-terminated line.
//!
//! THIS IS THE ONLY MODULE IN THE CRATE THAT KNOWS A NEWLINE EXISTS, and keeping it that way is
//! the whole point of the transport seam (see the parent module). If the wire becomes WebSocket
//! frames over the open internet, this file gains a sibling and nothing else in the tree changes.
//!
//! WHY LF IS SAFE AS A DELIMITER, stated so nobody re-derives it nervously: `serde_json` escapes
//! every control character inside a string, so a serialized message can never contain a raw
//! newline however hostile its contents. `\n` in a row's text arrives on the wire as the two
//! characters `\` and `n`. That is a property of JSON, not of this app's data, so no amount of
//! game-log weirdness can smuggle a frame boundary through — and `tests/transport.rs` pins it with
//! a message whose payload is full of newlines.
//!
//! THE DELIMITER IS LF, NEVER CRLF. Windows is the only platform this app ships on and it is
//! exactly where a text-mode stream would helpfully translate one into the other; every stream this
//! transport touches is opened in binary and a trailing `\r` is stripped on decode rather than
//! trusted, so a peer that framed with CRLF is still read correctly.

use std::io::{BufRead, Write};
use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{Transport, TransportError};

/// The frame delimiter. One byte, and the only one this crate treats as structural.
pub const DELIMITER: u8 = b'\n';

/// The largest single frame this transport will assemble, in bytes.
///
/// It is a FRAMING guard, not a protocol rule: a peer that never sends a delimiter would otherwise
/// grow the read buffer without bound, which is a denial of service a loopback socket makes
/// trivial. Payload budgets — how big a view's window may be — are a protocol concern and live
/// engine-side, nowhere near this number. 8 MiB is far above any legitimate message and far below
/// anything that threatens the process.
pub const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Serialize one message into its wire form: the JSON, then the delimiter.
///
/// # Errors
/// [`TransportError::Encode`] if the message will not serialize.
pub fn encode_line<T: Serialize>(message: &T) -> Result<String, TransportError> {
    let mut line = serde_json::to_string(message).map_err(TransportError::Encode)?;
    line.push(char::from(DELIMITER));
    Ok(line)
}

/// Parse one wire line back into a message. The line must NOT carry its delimiter; a trailing
/// `\r` is tolerated so a CRLF-framing peer is still understood.
///
/// # Errors
/// [`TransportError::Decode`] if the line is not a message of this type.
pub fn decode_line<T: DeserializeOwned>(line: &str) -> Result<T, TransportError> {
    let trimmed = line.strip_suffix('\r').unwrap_or(line);
    serde_json::from_str(trimmed).map_err(TransportError::Decode)
}

/// A [`Transport`] over any pair of byte streams.
///
/// It is generic over the streams rather than tied to a socket because phase 0 has no socket: the
/// suite drives it over in-memory buffers, and the supervisor will hand it a `TcpStream` without
/// this file changing. `R` is buffered because framing needs to read up to a delimiter.
pub struct NdjsonTransport<R: BufRead, W: Write, Out: Serialize, In: DeserializeOwned> {
    reader: R,
    writer: W,
    line: String,
    outbound: PhantomData<Out>,
    inbound: PhantomData<In>,
}

impl<R: BufRead, W: Write, Out: Serialize, In: DeserializeOwned> NdjsonTransport<R, W, Out, In> {
    /// Wrap a reader and a writer. Nothing is read or written until [`Transport::send`] or
    /// [`Transport::recv`] is called.
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            line: String::new(),
            outbound: PhantomData,
            inbound: PhantomData,
        }
    }

    /// Give back the streams. Used by tests that want to inspect what was actually written — which
    /// is how the suite asserts that a conversation produced exactly N lines and no stray bytes.
    pub fn into_inner(self) -> (R, W) {
        (self.reader, self.writer)
    }
}

impl<R: BufRead, W: Write, Out: Serialize, In: DeserializeOwned> Transport
    for NdjsonTransport<R, W, Out, In>
{
    type Outbound = Out;
    type Inbound = In;

    fn send(&mut self, message: &Out) -> Result<(), TransportError> {
        let line = encode_line(message)?;
        self.writer.write_all(line.as_bytes())?;
        // Flushed per message on purpose. This protocol is a live one - a meter tick held in a
        // buffer waiting for the next tick to push it out is a meter that reads one frame late.
        self.writer.flush()?;
        Ok(())
    }

    fn recv(&mut self) -> Result<Option<In>, TransportError> {
        self.line.clear();
        loop {
            let available = self.reader.fill_buf()?;
            if available.is_empty() {
                // End of stream. A partial line here is a truncated frame, which is a decode
                // failure rather than a quiet `None` - silently discarding half a message is how a
                // client ends up rendering a world that was never sent.
                if self.line.is_empty() {
                    return Ok(None);
                }
                return decode_line(&self.line).map(Some);
            }
            let (chunk, found) = match available.iter().position(|b| *b == DELIMITER) {
                Some(at) => (&available[..at], Some(at)),
                None => (available, None),
            };
            if self.line.len() + chunk.len() > MAX_LINE_BYTES {
                return Err(TransportError::FrameTooLarge {
                    limit: MAX_LINE_BYTES,
                });
            }
            self.line.push_str(&String::from_utf8_lossy(chunk));
            let consumed = chunk.len() + usize::from(found.is_some());
            self.reader.consume(consumed);
            if found.is_some() {
                return decode_line(&self.line).map(Some);
            }
        }
    }
}
