//! THE WORKED MOMENTS, PROVEN IN RUST.
//!
//! `protocol/fixtures/*.json` holds the four worked moments from the subscription-diff section of
//! `docs/plans/data-server.md`, plus the phase-0 handshake. They are the FIRST cross-language
//! artifacts in this repo: this suite deserializes every one of them into the generated types and
//! re-serializes it, and `tests/protocolSchema.test.mts` does the same on the TypeScript side over
//! the same bytes. A shape either language cannot express is a red suite in that language, which
//! is the only way a "contract" between two codebases stays one.
//!
//! ROUND-TRIP MEANS VERBATIM. The comparison is over parsed JSON values rather than bytes — key
//! order and whitespace are not part of the contract, and no JSON serializer promises them — but
//! nothing else is forgiven. A dropped field, an added default, an integer that came back as a
//! float: all of those are a failed assertion here. That last one is not hypothetical; it is why
//! `protocol::cell::Cell` is hand-written.

use std::fs;
use std::path::{Path, PathBuf};

use protocol::generated::{
    ClientMessage, DiffOp, EngineMessage, EpochReason, ProtocolMessage, ReplyResult,
    PROTOCOL_VERSION,
};

/// One line of a fixture conversation.
struct Frame {
    dir: String,
    raw: serde_json::Value,
}

/// One fixture file: a named moment and the messages it is made of.
struct Fixture {
    name: String,
    moment: String,
    frames: Vec<Frame>,
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the crate is three levels below the repo root")
        .to_path_buf()
}

fn fixtures() -> Vec<Fixture> {
    let dir = repo_root().join("protocol").join("fixtures");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no fixtures in {}", dir.display());

    names
        .into_iter()
        .map(|name| {
            let text = fs::read_to_string(dir.join(&name)).expect("fixture is readable");
            let doc: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("{name} is not valid JSON: {e}"));
            let moment = doc["moment"]
                .as_str()
                .expect("every fixture names its moment")
                .to_owned();
            let frames = doc["messages"]
                .as_array()
                .expect("every fixture carries a messages array")
                .iter()
                .map(|frame| Frame {
                    dir: frame["dir"]
                        .as_str()
                        .expect("every frame names a direction")
                        .to_owned(),
                    raw: frame["message"].clone(),
                })
                .collect();
            Fixture {
                name,
                moment,
                frames,
            }
        })
        .collect()
}

/// Deserialize one frame into the union its direction names, then serialize it back.
fn round_trip(frame: &Frame, fixture: &str) -> serde_json::Value {
    match frame.dir.as_str() {
        "client" => {
            let typed: ClientMessage = serde_json::from_value(frame.raw.clone())
                .unwrap_or_else(|e| panic!("{fixture}: not a ClientMessage: {e}\n{}", frame.raw));
            serde_json::to_value(&typed).expect("a ClientMessage serializes")
        }
        "engine" => {
            let typed: EngineMessage = serde_json::from_value(frame.raw.clone())
                .unwrap_or_else(|e| panic!("{fixture}: not an EngineMessage: {e}\n{}", frame.raw));
            serde_json::to_value(&typed).expect("an EngineMessage serializes")
        }
        other => panic!("{fixture}: unknown direction {other}"),
    }
}

// ---- 1. every fixture, verbatim ---------------------------------------------------------------

#[test]
fn every_worked_moment_round_trips_verbatim() {
    let all = fixtures();
    let mut frames = 0;
    for fixture in &all {
        for frame in &fixture.frames {
            let back = round_trip(frame, &fixture.name);
            assert_eq!(
                back, frame.raw,
                "{} ({}): a message did not survive the round trip",
                fixture.name, fixture.moment
            );
            frames += 1;
        }
    }
    assert!(frames >= 12, "only {frames} frames were exercised");
}

#[test]
fn every_message_is_also_a_protocol_message() {
    // The root type the transport seam is generic over has to accept everything either side can
    // send, or a transport could not carry the whole protocol.
    for fixture in &fixtures() {
        for frame in &fixture.frames {
            let typed: ProtocolMessage = serde_json::from_value(frame.raw.clone())
                .unwrap_or_else(|e| panic!("{}: not a ProtocolMessage: {e}", fixture.name));
            assert_eq!(
                serde_json::to_value(&typed).expect("serializes"),
                frame.raw,
                "{}: ProtocolMessage lost something on the way back",
                fixture.name
            );
        }
    }
}

#[test]
fn the_four_plan_doc_moments_are_all_here() {
    let names: Vec<String> = fixtures().into_iter().map(|f| f.name).collect();
    for expected in [
        "01-subscribe.json",
        "02-live-diff.json",
        "03-meter-tick.json",
        "04-character-switch.json",
    ] {
        assert!(
            names.contains(&expected.to_owned()),
            "{expected} is missing"
        );
    }
}

// ---- 2. the rules the moments are there to demonstrate -----------------------------------------

fn engine_frames(file: &str) -> Vec<EngineMessage> {
    fixtures()
        .into_iter()
        .find(|f| f.name == file)
        .unwrap_or_else(|| panic!("{file} is missing"))
        .frames
        .iter()
        .filter(|f| f.dir == "engine")
        .map(|f| serde_json::from_value(f.raw.clone()).expect("an engine frame"))
        .collect()
}

#[test]
fn rule_one_a_subscription_opens_with_a_full_reset() {
    let [ack, reset] = engine_frames("01-subscribe.json")
        .try_into()
        .expect("an ack and a reset");

    // THE ACK IS NOT THE DATA. It says the subscription exists; the reset says what is in it. Two
    // messages rather than one because a subscription can be opened over a view whose first fold
    // has not landed yet, and a client that conflated them would have nothing to render and no way
    // to tell that from an empty view.
    let EngineMessage::Reply(ack) = ack else {
        panic!("a subscribe request is acknowledged before its data")
    };
    assert_eq!(*ack.id, 7);
    let ReplyResult::SubscribeAck(ack) = ack.result else {
        panic!("view.subscribe answers with a SubscribeAck")
    };
    assert_eq!(*ack.subscription, 7);
    assert!(ack.subscribed);

    let EngineMessage::ResetMessage(reset) = reset else {
        panic!("a subscription must open with a reset");
    };
    assert_eq!(*reset.id, 7);
    assert_eq!(*reset.epoch, 3);
    assert_eq!(reset.total, 1834, "total counts the VIEW, not the window");
    assert!(!reset.rows.is_empty());
}

#[test]
fn rule_two_an_update_carries_only_the_cells_that_moved() {
    let [diff] = engine_frames("03-meter-tick.json")
        .try_into()
        .expect("one engine frame");
    let EngineMessage::DiffMessage(diff) = diff else {
        panic!("a meter tick is a diff")
    };
    assert!(
        diff.total.is_none(),
        "the row count did not move, so total is absent"
    );

    let DiffOp::UpdateOp(update) = &diff.ops[0] else {
        panic!("the first op is an update")
    };
    assert_eq!(update.cells.len(), 3, "only the three cells that changed");
    for moved in ["damage", "dps", "share"] {
        assert!(update.cells.contains_key(moved), "{moved} is missing");
    }
    assert!(
        !update.cells.contains_key("name"),
        "a cell that did not change must be ABSENT, not resent"
    );

    // …and the insert names an anchor. Exactly one of before/after, which the schema cannot say.
    let DiffOp::InsertOp(insert) = &diff.ops[1] else {
        panic!("the second op is an insert")
    };
    assert!(
        insert.before.is_some() ^ insert.after.is_some(),
        "an insert names exactly one anchor"
    );
    assert_eq!(
        insert.after.as_deref().map(String::as_str),
        Some("ally:Rowel")
    );
}

#[test]
fn a_live_diff_moves_the_window_and_says_so() {
    let [diff] = engine_frames("02-live-diff.json")
        .try_into()
        .expect("one engine frame");
    let EngineMessage::DiffMessage(diff) = diff else {
        panic!("expected a diff")
    };
    assert_eq!(diff.total, Some(1835), "total moved, so it is present");
    assert_eq!(diff.ops.len(), 2);
    let DiffOp::InsertOp(insert) = &diff.ops[0] else {
        panic!("a kill inserts a row")
    };
    assert_eq!(
        insert.before.as_deref().map(String::as_str),
        Some("loot:9412")
    );
    let DiffOp::DropOp(dropped) = &diff.ops[1] else {
        panic!("the oldest row falls out")
    };
    assert_eq!(dropped.key.as_str(), "loot:8790");
}

#[test]
fn rule_three_an_epoch_bump_is_connection_wide_and_the_reset_follows_it() {
    let frames = engine_frames("04-character-switch.json");
    let [bump, reset] = frames.try_into().expect("a bump and a reset");

    let EngineMessage::EpochMessage(bump) = bump else {
        panic!("expected an epoch message")
    };
    assert_eq!(*bump.epoch, 4);
    assert!(matches!(bump.reason, EpochReason::Attach));
    let progress = bump.progress.expect("an attach reports its fold progress");
    // EXACT equality on an f64 is right here, and only here: this is the same decimal literal
    // parsed by the same routine that produced the fixture, so both sides land on the identical
    // nearest-f64. It is the byte-verbatim claim, restated at the field level - if it ever needed
    // an epsilon, the round-trip assertion above would already have failed.
    assert_eq!(
        progress.pct, 62.4,
        "the fold percent, fractional and unrounded"
    );
    assert_eq!(progress.events, 1_571_003);

    // …AND IT GOES BACK OUT AS THE SAME TEXT. This is the whole reason the worked example uses a
    // fractional value: `pct` is an f64, and Rust writes a whole f64 as `62.0`, which would not be
    // the `62` the plan doc prints. Pinned rather than assumed, because the claim the fixtures make
    // is byte-verbatim across two languages and this is the one field where the two could differ.
    let text = serde_json::to_string(&progress).expect("progress serializes");
    assert!(
        text.contains("\"pct\":62.4"),
        "the fold percent did not come back as 62.4: {text}"
    );

    let EngineMessage::ResetMessage(reset) = reset else {
        panic!("expected a reset")
    };
    assert_eq!(*reset.epoch, 4, "the reset is in the NEW generation");
    assert_eq!(*reset.id, 7, "the same subscription, re-reset");
    assert!(reset.rows.is_empty());
    assert_eq!(reset.total, 0);
}

#[test]
fn rule_four_rows_are_render_ready_scalars() {
    let [_ack, reset] = engine_frames("01-subscribe.json")
        .try_into()
        .expect("an ack and a reset");
    let EngineMessage::ResetMessage(reset) = reset else {
        panic!("expected a reset")
    };
    for row in &reset.rows {
        assert!(!row.key.is_empty(), "every row is identified");
        assert!(!row.cells.is_empty(), "every row says something");
        for (field, cell) in row.cells.iter() {
            assert!(
                protocol::Cell::is_scalar(cell.as_json()),
                "{field} is not render-ready"
            );
        }
    }
}

// ---- 3. the handshake and the reply envelope ---------------------------------------------------

#[test]
fn the_handshake_presents_and_answers_this_build_s_version() {
    let fixture = fixtures()
        .into_iter()
        .find(|f| f.name == "05-handshake.json")
        .expect("handshake");
    let ClientMessage::Hello(hello) =
        serde_json::from_value(fixture.frames[0].raw.clone()).expect("the first frame is a hello")
    else {
        panic!("the FIRST message on a connection is always a hello");
    };
    assert_eq!(hello.protocol_version, PROTOCOL_VERSION);
    assert!(protocol::token::well_formed(&hello.token));

    let EngineMessage::HelloReply(reply) =
        serde_json::from_value(fixture.frames[1].raw.clone()).expect("the answer")
    else {
        panic!("a hello is answered by a hello");
    };
    assert!(reply.ok);
    assert_eq!(reply.protocol_version, PROTOCOL_VERSION);
}

#[test]
fn ok_agrees_with_kind_in_every_reply_the_repo_ships() {
    // `kind` is the discriminant both sides branch on; `ok` is the ticket's spelling of the same
    // fact and a one-field check for a caller that does not want to match. The schema pins the
    // value with `enum: [true] / [false]` and a 2020-12 validator enforces it, but the Rust type
    // is a plain bool - typify does not specialize a boolean constant. So the agreement is
    // asserted here, over every reply this repo commits.
    for fixture in &fixtures() {
        for frame in &fixture.frames {
            if frame.dir != "engine" {
                continue;
            }
            match serde_json::from_value(frame.raw.clone()).expect("an engine message") {
                EngineMessage::Reply(reply) => {
                    assert!(reply.ok, "{}: a reply said ok:false", fixture.name)
                }
                EngineMessage::ErrorReply(err) => {
                    assert!(!err.ok, "{}: an error said ok:true", fixture.name);
                }
                _ => {}
            }
        }
    }
}

#[test]
fn a_message_from_the_wrong_direction_is_refused() {
    // The two unions are not interchangeable, and that is what keeps an engine from being handed
    // its own output. Without the typed tag enums this would silently succeed.
    let hello = serde_json::json!({
        "op": "hello",
        "token": "0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f7089",
        "protocolVersion": PROTOCOL_VERSION
    });
    assert!(serde_json::from_value::<EngineMessage>(hello).is_err());

    let reset = serde_json::json!({ "kind": "reset", "id": 1, "epoch": 0, "total": 0, "rows": [] });
    assert!(serde_json::from_value::<ClientMessage>(reset).is_err());
}

#[test]
fn two_ops_with_identical_parameter_shapes_stay_apart() {
    // `session.health` and `session.progress` are structurally identical - same id, same op field,
    // same empty params. Before the tag properties were given real types, an untagged union
    // deserialized BOTH as the first variant and the op silently vanished. This is the pin.
    let progress = serde_json::json!({ "id": 4, "op": "session.progress", "params": {} });
    let typed: ClientMessage =
        serde_json::from_value(progress.clone()).expect("a progress request");
    assert!(
        matches!(typed, ClientMessage::SessionProgressRequest(_)),
        "session.progress was read as something else"
    );
    assert_eq!(serde_json::to_value(&typed).expect("serializes"), progress);
}
