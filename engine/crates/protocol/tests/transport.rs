//! THE SEAM, PROVEN.
//!
//! The owner's constraint on this protocol was that the wire method must be swappable by replacing
//! one artifact — "im thinking over the open internet via websockets etc." The structural answer is
//! that protocol logic talks to a [`Transport`] and only one module below it knows what a frame is.
//!
//! A claim like that is cheap to make and easy to break silently, so this suite makes it a
//! MEASUREMENT: one conversation — the real handshake, a real subscribe, a real reset, a real diff
//! — is run twice, once over a transport that has no bytes in it at all and once over NDJSON, and
//! the two are asserted to deliver the same messages. Code that can run with the framing removed
//! is code that was not depending on the framing. A future WebSocket adapter is a third row in the
//! same table.

use std::io::Cursor;

use protocol::generated::{ClientMessage, EngineMessage};
use protocol::transport::ndjson::{self, NdjsonTransport, DELIMITER, MAX_LINE_BYTES};
use protocol::transport::{memory, Transport, TransportError};

/// The conversation under test, built from the committed fixtures so the suite and the plan doc
/// cannot drift apart. Returns the client's turns and the engine's turns, in order.
fn conversation() -> (Vec<ClientMessage>, Vec<EngineMessage>) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the crate is three levels below the repo root")
        .join("protocol")
        .join("fixtures");

    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();

    let mut client = Vec::new();
    let mut engine = Vec::new();
    for name in names {
        let text = std::fs::read_to_string(dir.join(&name)).expect("fixture is readable");
        let doc: serde_json::Value = serde_json::from_str(&text).expect("fixture is JSON");
        for frame in doc["messages"].as_array().expect("messages array") {
            let raw = frame["message"].clone();
            match frame["dir"].as_str().expect("a direction") {
                "client" => client.push(serde_json::from_value(raw).expect("a client message")),
                "engine" => engine.push(serde_json::from_value(raw).expect("an engine message")),
                other => panic!("unknown direction {other}"),
            }
        }
    }
    assert!(
        client.len() >= 6 && engine.len() >= 6,
        "the conversation is too thin to prove anything"
    );
    (client, engine)
}

fn as_json<T: serde::Serialize>(items: &[T]) -> Vec<serde_json::Value> {
    items
        .iter()
        .map(|m| serde_json::to_value(m).expect("serializes"))
        .collect()
}

// ---- the two adapters, delivering the same conversation ----------------------------------------

/// Play the conversation over the in-memory pair: no bytes, no frames, no newline anywhere.
fn over_memory() -> (Vec<ClientMessage>, Vec<EngineMessage>) {
    let (client_turns, engine_turns) = conversation();
    let (mut app, mut eng) = memory::pair::<ClientMessage, EngineMessage>();

    for message in &client_turns {
        app.send(message).expect("the app can speak");
    }
    for message in &engine_turns {
        eng.send(message).expect("the engine can speak");
    }

    let mut heard_by_engine = Vec::new();
    while let Some(message) = eng.recv().expect("the engine can listen") {
        heard_by_engine.push(message);
    }
    let mut heard_by_app = Vec::new();
    while let Some(message) = app.recv().expect("the app can listen") {
        heard_by_app.push(message);
    }
    (heard_by_engine, heard_by_app)
}

/// Play the same conversation over NDJSON, through real bytes and a real delimiter.
fn over_ndjson() -> (Vec<ClientMessage>, Vec<EngineMessage>, Vec<u8>, Vec<u8>) {
    let (client_turns, engine_turns) = conversation();

    let mut app_out: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, ClientMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(Vec::new()), Vec::new());
    for message in &client_turns {
        app_out.send(message).expect("the app can write");
    }
    let (_, to_engine) = app_out.into_inner();

    let mut eng_out: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, ClientMessage> =
        NdjsonTransport::new(Cursor::new(Vec::new()), Vec::new());
    for message in &engine_turns {
        eng_out.send(message).expect("the engine can write");
    }
    let (_, to_app) = eng_out.into_inner();

    let mut eng_in: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, ClientMessage> =
        NdjsonTransport::new(Cursor::new(to_engine.clone()), Vec::new());
    let mut heard_by_engine = Vec::new();
    while let Some(message) = eng_in.recv().expect("the engine can read") {
        heard_by_engine.push(message);
    }

    let mut app_in: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, ClientMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(to_app.clone()), Vec::new());
    let mut heard_by_app = Vec::new();
    while let Some(message) = app_in.recv().expect("the app can read") {
        heard_by_app.push(message);
    }

    (heard_by_engine, heard_by_app, to_engine, to_app)
}

#[test]
fn the_same_conversation_survives_both_transports_identically() {
    let (client_turns, engine_turns) = conversation();
    let (mem_engine, mem_app) = over_memory();
    let (nd_engine, nd_app, _, _) = over_ndjson();

    assert_eq!(
        as_json(&mem_engine),
        as_json(&client_turns),
        "memory lost a client turn"
    );
    assert_eq!(
        as_json(&mem_app),
        as_json(&engine_turns),
        "memory lost an engine turn"
    );
    assert_eq!(
        as_json(&nd_engine),
        as_json(&client_turns),
        "ndjson lost a client turn"
    );
    assert_eq!(
        as_json(&nd_app),
        as_json(&engine_turns),
        "ndjson lost an engine turn"
    );
    assert_eq!(
        as_json(&mem_engine),
        as_json(&nd_engine),
        "the two adapters disagree"
    );
    assert_eq!(
        as_json(&mem_app),
        as_json(&nd_app),
        "the two adapters disagree"
    );
}

#[test]
fn the_framing_is_exactly_one_message_per_line() {
    let (client_turns, engine_turns) = conversation();
    let (_, _, to_engine, to_app) = over_ndjson();

    for (bytes, expected) in [
        (&to_engine, client_turns.len()),
        (&to_app, engine_turns.len()),
    ] {
        assert_eq!(
            bytes.iter().filter(|b| **b == DELIMITER).count(),
            expected,
            "one delimiter per message, no more and no fewer"
        );
        assert_eq!(
            bytes.last().copied(),
            Some(DELIMITER),
            "every frame is terminated"
        );
        let text = String::from_utf8(bytes.clone()).expect("the wire is utf-8");
        for line in text.lines() {
            serde_json::from_str::<serde_json::Value>(line)
                .expect("every line is one whole message");
        }
    }
}

// ---- the framing cannot be broken from above ----------------------------------------------------

#[test]
fn a_payload_full_of_newlines_cannot_forge_a_frame() {
    // The property that makes LF safe as a delimiter, asserted rather than assumed: serde_json
    // escapes every control character inside a string, so no message content can smuggle a frame
    // boundary. Nothing above the transport has to know this, which is the point.
    let hostile = "line one\nline two\r\n{\"kind\":\"epoch\"}\n\n";
    let message: EngineMessage = serde_json::from_value(serde_json::json!({
        "kind": "reset",
        "id": 1,
        "epoch": 0,
        "total": 1,
        "rows": [{ "key": "row:1", "cells": { "text": hostile } }]
    }))
    .expect("a reset carrying a hostile string");

    let line = ndjson::encode_line(&message).expect("encodes");
    assert_eq!(
        line.bytes().filter(|b| *b == DELIMITER).count(),
        1,
        "the only newline is the frame terminator"
    );

    let mut reader: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(line.into_bytes()), Vec::new());
    let back = reader.recv().expect("decodes").expect("one message");
    assert_eq!(
        serde_json::to_value(&back).expect("serializes"),
        serde_json::to_value(&message).expect("serializes"),
        "the hostile payload came back byte-identical"
    );
    assert!(reader.recv().expect("no second frame").is_none());
}

#[test]
fn a_crlf_framing_peer_is_still_understood() {
    let line = "{\"kind\":\"epoch\",\"epoch\":2,\"reason\":\"restart\"}\r\n";
    let mut reader: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(line.as_bytes().to_vec()), Vec::new());
    let message = reader.recv().expect("decodes").expect("one message");
    assert!(matches!(message, EngineMessage::EpochMessage(_)));
}

#[test]
fn a_truncated_final_frame_is_an_error_rather_than_a_quiet_nothing() {
    // Half a message discarded in silence is how a client ends up rendering a world nobody sent.
    let truncated = "{\"kind\":\"epoch\",\"epoch\":2,\"rea";
    let mut reader: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(truncated.as_bytes().to_vec()), Vec::new());
    assert!(matches!(reader.recv(), Err(TransportError::Decode(_))));
}

#[test]
fn an_unterminated_flood_is_refused_at_the_framing_limit() {
    // A peer that never sends a delimiter would otherwise grow the read buffer without bound - on
    // loopback, a one-line denial of service. The limit is a FRAMING concern and lives here, not
    // in the protocol.
    let flood = vec![b'x'; MAX_LINE_BYTES + 1024];
    let mut reader: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(flood), Vec::new());
    assert!(matches!(
        reader.recv(),
        Err(TransportError::FrameTooLarge { limit }) if limit == MAX_LINE_BYTES
    ));
}

#[test]
fn an_empty_stream_reads_as_nothing_at_all() {
    let mut reader: NdjsonTransport<Cursor<Vec<u8>>, Vec<u8>, EngineMessage, EngineMessage> =
        NdjsonTransport::new(Cursor::new(Vec::new()), Vec::new());
    assert!(reader.recv().expect("no error").is_none());
}
