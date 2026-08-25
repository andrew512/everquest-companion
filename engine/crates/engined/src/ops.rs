//! WHAT THE ENGINE ANSWERS. Every shape here comes from the generated types and none of it is
//! hand-rolled JSON — the schema is the source of truth for both languages (owner ruling 14), so a
//! literal object written here would be a third opinion nobody regenerates.
//!
//! THERE IS NO GAME LOGIC IN THIS FILE and none may be added. `echo` proves a message crossed the
//! seam; `session.*` and `view.*` are answered at echo grade — the right envelope, the right
//! result shape, honest emptiness inside. Where an answer is a stub the doc comment says exactly
//! what it does and does not do, so that a later phase is filling a hole somebody described rather
//! than discovering one.
//!
//! DISPATCH IS A PURE FUNCTION OF (world, session, message). It returns messages instead of writing
//! them, which is what lets the whole op table be tested with no socket in the room — the same
//! argument `protocol::transport::memory` makes one layer down.

use protocol::generated::{
    AlertsDefineRequestOp, BuffTrustDefineRequestOp, ClientMessage, CombatSearchFightsRequestOp,
    CombatSearchFightsResult, CombatSnapshotOpts, CombatSnapshotRequestOp, CombatSnapshotResult,
    CombatState, ComboDefineRequestOp, DefineAck, EchoRequestOp, EchoResult, EngineMessage,
    ErrorCode, ErrorReply, ErrorReplyKind, FightSearchHit, FightSummary, HelloOp,
    ModuleSnapshotRequestOp, ModuleSnapshotResult, PerfSnapshotRequestOp, ProtocolError, Reply,
    ReplyKind, ReplyResult, RequestId, ResetMessage, ResetMessageKind, RespawnDefineRequestOp,
    RosterDefineRequestOp, SessionAttachRequestOp, SessionHealthRequestOp,
    SessionProgressRequestOp, SubscribeAck, ViewSubscribeRequestOp, ViewUnsubscribeRequestOp,
};

use crate::ingest::CombatOpts;
use crate::world::{CombatAnswer, ListenerId, PerfAnswer, SnapshotAnswer, World};

/// One connection's own state — everything that belongs to this conversation rather than to the
/// world.
///
/// SUBSCRIPTIONS ARE PER-CONNECTION BY CONSTRUCTION, AND THE WORLD IS WHERE THEY LIVE. A
/// subscription is named by the id of the request that opened it, and request ids are
/// client-chosen, so two renderers routinely pick the same number; the world keys them by
/// (listener, id), so one client can never unsubscribe another's stream — a property worth having
/// structurally rather than by a check somebody remembers to write. They moved there when the fold
/// did: a landing fold must reset EVERY open subscription on EVERY connection, and a set held out
/// here is a set the world cannot see. This session is therefore its receipt and nothing else.
pub struct Session {
    /// This connection's membership of the world.
    listener: ListenerId,
}

impl Session {
    /// The session of the connection holding this membership.
    #[must_use]
    pub fn new(listener: ListenerId) -> Self {
        Self { listener }
    }
}

/// What a dispatched message produced.
pub enum Outcome {
    /// Messages to send to THIS connection, in the order given.
    Send(Vec<EngineMessage>),
    /// The connection must end. The string is a stderr diagnostic, never sent to the peer: it
    /// describes a peer that broke the conversation's shape, and there is no request id to hang an
    /// error on (per the schema: a failure with no request behind it closes the connection).
    Close(String),
}

impl Session {
    /// Answer one well-formed client message.
    pub fn dispatch(&mut self, world: &World, message: ClientMessage) -> Outcome {
        match message {
            // A SECOND HELLO IS THE END OF THE CONVERSATION. `Hello` carries no request id — it is
            // the one client message that cannot be answered with an error — and a peer that
            // re-handshakes mid-stream is a peer whose state machine disagrees with this one's.
            // Guessing at what it meant is how a session ends up authenticated twice with two
            // different tokens.
            ClientMessage::Hello(_) => {
                Outcome::Close("a second hello arrived on an open connection".to_owned())
            }

            // ECHO. The whole point of the op: a message the client composed came back with its
            // contents intact, which proves the envelope, the framing, the token check and the
            // reply correlation all work before a single log byte exists.
            ClientMessage::EchoRequest(request) => reply(
                request.id,
                ReplyResult::EchoResult(EchoResult {
                    text: request.params.text,
                }),
            ),

            ClientMessage::SessionHealthRequest(request) => {
                reply(request.id, ReplyResult::HealthResult(world.health()))
            }

            // ATTACH. Bumps the generation, announces it, and STARTS AN INGEST over the named log:
            // scan at full speed, then tail live. See `World::attach` for the critical section and
            // `ingest.rs` for the generation law that makes a second attach preempt this one.
            ClientMessage::SessionAttachRequest(request) => reply(
                request.id,
                ReplyResult::AttachResult(world.attach(&request.params.log_path)),
            ),

            // PROGRESS. Acknowledged with a `SubscribeAck` naming this request, because that is
            // what the op IS: a subscription to the connection-wide progress channel, whose frames
            // are `EpochMessage`s carrying `progress` (the schema says so in as many words — they
            // are not a fourth stream kind). The registry of reply shapes is closed and has no
            // arm of its own for this op; the ack shape fits it exactly, which is why no schema
            // change was needed to answer it honestly.
            //
            // THE FRAMES ARRIVE ON THE CHANNEL THIS ACK NAMES, and since JOS-474 they are real:
            // an attach starts a fold and the fold announces itself at a bounded cadence. They are
            // connection-wide, so an attach on ANOTHER connection is heard here too — which is what
            // makes a second renderer's loading state honest without it having asked for anything.
            ClientMessage::SessionProgressRequest(request) => {
                let subscription = RequestId(*request.id);
                reply(
                    request.id,
                    ReplyResult::SubscribeAck(SubscribeAck {
                        subscription,
                        subscribed: true,
                    }),
                )
            }

            // MODULE.SNAPSHOT — THE FIRST DATA-BEARING OP (JOS-478). Everything above this line is
            // an envelope; this one carries the fold's own answer.
            //
            // THE ANSWER IS THE INGEST THREAD'S, fetched through the one door. This dispatch stays
            // a pure function of (world, session, message) because `World::module_snapshot` returns
            // a value rather than writing one — it is the WAIT that is new, and it is bounded and
            // owned by the world (see that method for why the lock is not held across it).
            //
            // THREE OUTCOMES, THREE SENTENCES. A module the registry does not carry is `notFound`,
            // because the registry is the authority and an empty state would be a lie about a
            // module that does not exist. A world with no fold is `unavailable` — nothing is wrong
            // with the request, there is simply nothing attached yet, and telling a client
            // `notFound` there would send it hunting for a typo in a name that is perfectly good.
            ClientMessage::ModuleSnapshotRequest(request) => {
                let module = request.params.module;
                match world.module_snapshot(&module) {
                    SnapshotAnswer::Snapshot(snapshot) => reply(
                        request.id,
                        ReplyResult::ModuleSnapshotResult(ModuleSnapshotResult {
                            module,
                            seq: snapshot.seq,
                            state: snapshot.state,
                        }),
                    ),
                    SnapshotAnswer::NotFound => error(
                        request.id,
                        ErrorCode::NotFound,
                        format!("this engine folds no module named {module:?}"),
                    ),
                    SnapshotAnswer::Unavailable(why) => {
                        error(request.id, ErrorCode::Unavailable, why)
                    }
                }
            }

            // PERF.SNAPSHOT — THE ENGINE APPEARS IN THE APP'S PERFORMANCE PANEL (ruling 19 surface,
            // JOS-483). The one op whose subject is this process rather than the game.
            //
            // TWO OUTCOMES, NOT THREE. There is nothing here that could be `notFound` — the request
            // names no module, no source, nothing that might be absent — and an engine with nothing
            // attached is NOT `unavailable` either: it is an idle engine, and it answers with its
            // real status, epoch and uptime beside an empty serve list. The single refusal is a fold
            // that had a door and did not answer through it, which is a wedged ingest, and telling a
            // panel that is far more useful than drawing it a row of zeros.
            ClientMessage::PerfSnapshotRequest(request) => match world.perf_snapshot() {
                PerfAnswer::Perf(perf) => reply(request.id, ReplyResult::PerfSnapshotResult(*perf)),
                PerfAnswer::Unavailable(why) => error(request.id, ErrorCode::Unavailable, why),
            },

            // SUBSCRIBE. Validate the descriptor, acknowledge, then open the stream with a reset —
            // reset-then-diffs is rule 1 of the diff protocol, and it holds even when the window is
            // empty. A client that special-cased "no reset because there was nothing" would be a
            // client that cannot tell an empty view from a view that never opened.
            //
            // THE SOURCE REGISTRY IS HERE NOW (JOS-480), and phase 0's accept-everything is gone.
            // The views schema is explicit that an unknown source is a `notFound` error and never
            // an empty result; `views::validate` is where that becomes true, along with every other
            // name in the descriptor — a sort term over a field the source does not carry, a
            // direction that is not asc/desc, a window outside the payload budget. Each is refused
            // BY NAME, because a client that silently gets a window it did not ask for has no way
            // to notice.
            //
            // THE OPENING RESET IS EMPTY EVEN OVER A LIVE FOLD, and that is a property of where the
            // rows live rather than of the protocol: they are on the ingest thread, this is a
            // connection thread, and the full window arrives from the fold at the next boundary it
            // already reaches. See `World::open_subscription`.
            ClientMessage::ViewSubscribeRequest(request) => {
                let view = match crate::views::validate(&request.params) {
                    Ok(view) => view,
                    Err(refusal) => {
                        return error(request.id, refusal.code, refusal.message);
                    }
                };
                // THE REGISTRATION AND THE STAMP ARE ONE ACT (`World::open_subscription`), so the
                // epoch this reset names cannot be superseded between reading it and sending it.
                let epoch = world.open_subscription(self.listener, *request.id, view);
                let subscription = RequestId(*request.id);
                let ack = Reply {
                    kind: ReplyKind::Reply,
                    id: RequestId(*request.id),
                    ok: true,
                    result: ReplyResult::SubscribeAck(SubscribeAck {
                        subscription,
                        subscribed: true,
                    }),
                };
                let reset = ResetMessage {
                    kind: ResetMessageKind::Reset,
                    id: RequestId(*request.id),
                    epoch,
                    total: 0,
                    rows: Vec::new(),
                };
                Outcome::Send(vec![
                    EngineMessage::Reply(ack),
                    EngineMessage::ResetMessage(reset),
                ])
            }

            // UNSUBSCRIBE. `notFound` for a subscription this connection does not hold — including
            // one it held a moment ago. Answering `subscribed: false` to a stream that was never
            // open would tell a client its bookkeeping is fine when it is not.
            ClientMessage::ViewUnsubscribeRequest(request) => {
                let named = *request.params.subscription;
                if world.close_subscription(self.listener, named) {
                    reply(
                        request.id,
                        ReplyResult::SubscribeAck(SubscribeAck {
                            subscription: RequestId(named),
                            subscribed: false,
                        }),
                    )
                } else {
                    error(
                        request.id,
                        ErrorCode::NotFound,
                        format!("no subscription {named} is open on this connection"),
                    )
                }
            }

            // ── THE FIVE `*.define` COMMANDS (JOS-482, boundary verdict 3) ──────────────────────
            //
            // APP KNOWLEDGE FLOWS IN HERE and nowhere else. The store stays persistence truth on
            // the app side — the engine never reads a settings file — and every preference the fold
            // used to read out of it arrives as one of these, pushed on connect and on change.
            //
            // EACH IS AN IDEMPOTENT FULL-SET REPLACE, which is why five near-identical arms are the
            // right shape rather than one generic one: the payload is TYPED per family (that is
            // what `count` is read off), and the only thing they share is the law. `World::define`
            // records the push and hands it to the live fold; see it for why the ack waits.
            //
            // THERE IS NO REFUSAL PATH. A payload that reached this point deserialized against the
            // schema, and a family this build folds no module for would be an engine bug rather
            // than a client mistake — so `applied` is pinned true by the schema and the honest
            // failure mode is a `badParams` refusal one layer up, in `classify`.
            ClientMessage::AlertsDefineRequest(request) => define(
                world,
                request.id,
                "alerts",
                &request.params.defs,
                json(&request.params.defs),
            ),

            ClientMessage::BuffTrustDefineRequest(request) => define(
                world,
                request.id,
                "buffTrust",
                // NOT A LIST: the family's knowledge is one object, so the ack carries no `count`.
                &(),
                json(&request.params.trust),
            ),

            ClientMessage::RespawnDefineRequest(request) => define(
                world,
                request.id,
                "respawn",
                &(),
                json(&request.params.prefs),
            ),

            ClientMessage::ComboDefineRequest(request) => define(
                world,
                request.id,
                "combo",
                &request.params.corrections,
                json(&request.params.corrections),
            ),

            ClientMessage::RosterDefineRequest(request) => define(
                world,
                request.id,
                "roster",
                &request.params.edits,
                json(&request.params.edits),
            ),

            // ── THE COMBAT SURFACE (JOS-485) ───────────────────────────────────────────────────
            //
            // COMBAT.SNAPSHOT. `src/main/ipc/world.ts`'s `combat:snapshot` handler, moved to the
            // process that owns the fold — and the ONE difference from that handler is the one
            // worth stating: it passes `Date.now()`, and this passes nothing, because the instant
            // is the engine's to choose and only the thread holding the fold knows whether this
            // world has reached its tail (`crate::foldsink`'s header). The reply says which instant
            // it chose.
            //
            // TWO OUTCOMES, LIKE `perf.snapshot` AND UNLIKE `module.snapshot`. The request names no
            // module, no source, nothing that could be absent — so there is no `notFound` here, and
            // every way of having nothing to ask is one `unavailable`.
            ClientMessage::CombatSnapshotRequest(request) => {
                let opts = combat_opts(request.params.opts.as_ref());
                match world.combat_snapshot(&opts) {
                    CombatAnswer::Unavailable(why) => {
                        error(request.id, ErrorCode::Unavailable, why)
                    }
                    CombatAnswer::Answer(snapshot) => match snapshot.state {
                        // THE SHAPE IS CHECKED RATHER THAN COERCED. `CombatEngine::snapshot`
                        // publishes an object and the schema says so, but "an empty object" is what
                        // an `unwrap_or_default` would put on the wire if it ever stopped — a
                        // meter with no rows, indistinguishable from a session with no fights. An
                        // engine bug says it is one.
                        serde_json::Value::Object(state) => reply(
                            request.id,
                            ReplyResult::CombatSnapshotResult(CombatSnapshotResult {
                                now: snapshot.now,
                                snapshot: CombatState(state),
                            }),
                        ),
                        other => error(
                            request.id,
                            ErrorCode::Internal,
                            format!(
                                "the combat engine published a {} where the protocol states an object",
                                shape_of(&other)
                            ),
                        ),
                    },
                }
            }

            // COMBAT.SEARCHFIGHTS. `world.ts:27`'s semantics, kept verbatim: a `limit` is CLAMPED
            // rather than refused, and the clamp is here rather than in the fold because it is a
            // payload decision about a wire message. The query needs no coercion on this side — the
            // schema makes it a string or the frame is `badParams` one layer up, which is the typed
            // half of `typeof text === 'string' ? text : ''`.
            ClientMessage::CombatSearchFightsRequest(request) => {
                let limit = clamp_hits(request.params.limit);
                match world.search_fights(&request.params.query, limit) {
                    CombatAnswer::Unavailable(why) => {
                        error(request.id, ErrorCode::Unavailable, why)
                    }
                    CombatAnswer::Answer(found) => reply(
                        request.id,
                        ReplyResult::CombatSearchFightsResult(CombatSearchFightsResult {
                            corpus: found.corpus,
                            hits: found
                                .hits
                                .into_iter()
                                .map(|hit| FightSearchHit {
                                    score: hit.score,
                                    summary: FightSummary(match hit.summary {
                                        serde_json::Value::Object(map) => map,
                                        // A summary is an object by construction; an empty one is
                                        // the honest floor if a future builder ever published
                                        // something else, and unlike the snapshot above it costs a
                                        // ROW rather than the whole answer.
                                        _ => serde_json::Map::new(),
                                    }),
                                })
                                .collect(),
                        }),
                    ),
                }
            }
        }
    }
}

/// THE MOST HITS THIS ENGINE WILL RANK, whoever asks — `world.ts:30`'s own 500.
const MAX_FIGHT_HITS: i64 = 500;

/// The hits a request that named no limit gets — `fightSearch.ts`'s `DEFAULT_LIMIT`. The UI shows a
/// ranked list, not a page of 1,400.
const DEFAULT_FIGHT_HITS: i64 = 50;

/// `Math.min(Math.max(1, Math.floor(limit)), 500)`, and the floor is free: the wire type is an
/// integer, so a fractional limit is a frame the generated types already refused.
///
/// CLAMPED, NEVER REFUSED, which is the difference between this and a view's `window.limit`. A view
/// refuses an over-budget window BY NAME because the client stated a query it will keep re-cutting
/// and a silently-shrunk one it cannot notice is a window it did not ask for. A search is one
/// answer to one keystroke and the ranking is already truncated — so the smaller list IS the
/// answer, and a search box that stopped answering because a number was silly would be the worse
/// failure. `world.ts` made the same call and this is it kept.
fn clamp_hits(limit: Option<i64>) -> usize {
    let wanted = limit.map_or(DEFAULT_FIGHT_HITS, |n| n.clamp(1, MAX_FIGHT_HITS));
    usize::try_from(wanted).unwrap_or(0)
}

/// The wire's opts in the ingest's vocabulary, with every absence resolved to the app's own default.
///
/// THE DEFAULTS ARE `snapshot()`'s, not zero: `maxSegments` absent is 100 because that is what
/// `engine.ts` reads (`opts.maxSegments ?? 100`), and a cap of zero would serve a meter with no
/// fight list at all to a client that asked for the ordinary thing.
fn combat_opts(opts: Option<&CombatSnapshotOpts>) -> CombatOpts {
    /// `engine.ts snapshot`'s `opts.maxSegments ?? 100`.
    const DEFAULT_MAX_SEGMENTS: i64 = 100;
    let Some(opts) = opts else {
        return CombatOpts {
            max_segments: usize::try_from(DEFAULT_MAX_SEGMENTS).unwrap_or(0),
            ..CombatOpts::default()
        };
    };
    CombatOpts {
        selected_id: opts.selected_id.clone(),
        show_unparsed: opts.show_unparsed.unwrap_or(false),
        max_segments: usize::try_from(opts.max_segments.unwrap_or(DEFAULT_MAX_SEGMENTS).max(0))
            .unwrap_or(0),
        timeline: opts.timeline.unwrap_or(false),
    }
}

/// What a JSON value IS, for a diagnostic that has to say why an answer was refused.
fn shape_of(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// WHAT A DEFINE'S `count` IS — the number of entries a LIST-shaped payload carried, and nothing
/// for a payload that is one object.
///
/// A trait rather than a parameter so the two answers are decided by the payload's own TYPE at each
/// call site: `()` is the family that pushes an object, a slice is the family that pushes a list.
/// A hand-written `Some(n)` at five call sites would be five chances to count the wrong thing.
trait Counted {
    fn count(&self) -> Option<i64>;
}

impl Counted for () {
    fn count(&self) -> Option<i64> {
        None
    }
}

impl<T> Counted for Vec<T> {
    fn count(&self) -> Option<i64> {
        Some(i64::try_from(self.len()).unwrap_or(i64::MAX))
    }
}

/// The payload as the fold reads it — the INNER value (the list, or the prefs object), never the
/// request's params wrapper. The wrapper is the protocol's envelope and the fold has no business
/// knowing the op it arrived under.
fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

/// Record one family's push, apply it to the live fold, and acknowledge it.
fn define(
    world: &World,
    id: RequestId,
    family: &str,
    counted: &dyn Counted,
    payload: serde_json::Value,
) -> Outcome {
    world.define(family, payload);
    reply(
        id,
        ReplyResult::DefineAck(DefineAck {
            applied: true,
            count: counted.count(),
        }),
    )
}

/// Wrap one result in the reply envelope.
fn reply(id: RequestId, result: ReplyResult) -> Outcome {
    Outcome::Send(vec![EngineMessage::Reply(Reply {
        kind: ReplyKind::Reply,
        id,
        // The schema pins this to `true`; an unsuccessful answer is an `ErrorReply`, which is a
        // different message with a different discriminant rather than a flag on this one.
        ok: true,
        result,
    })])
}

/// Refuse one request, by its id.
fn error(id: RequestId, code: ErrorCode, message: String) -> Outcome {
    Outcome::Send(vec![EngineMessage::ErrorReply(ErrorReply {
        kind: ErrorReplyKind::Error,
        id,
        ok: false,
        error: ProtocolError { code, message },
    })])
}

/// What a frame turned out to be when the generated types could not read it as a whole message.
///
/// WHY THIS EXISTS AT ALL — the load-bearing paragraph of this file. `ClientMessage` is an untagged
/// union of seven request types, each with `deny_unknown_fields`. That makes it a perfect
/// discriminator for a message this build knows and a total loss for one it does not: serde tries
/// every arm, every arm fails, and the error says "data did not match any variant" without telling
/// anyone which `id` was in the frame. An engine that cannot name the request id cannot send an
/// `ErrorReply` — the schema requires one on every error — so a client's promise waits forever on
/// an op the engine simply does not have. Answering `unknownOp` is therefore only possible if the
/// raw frame survives the failed parse, which is why the transport's inbound type is
/// `serde_json::Value` and this function exists.
///
/// IT READS EXACTLY TWO FIELDS, `id` and `op`, and only after the typed parse has already failed.
/// Everything the engine does with a message it CAN read goes through the generated types.
pub enum Unreadable {
    /// A well-formed request naming an op this build does not implement.
    UnknownOp {
        /// The request to answer.
        id: RequestId,
        /// What it asked for, for the diagnostic. Bounded before it is quoted — see
        /// [`MAX_QUOTED_OP`].
        op: String,
    },
    /// A request for a known op whose params this build cannot read.
    BadParams {
        /// The request to answer.
        id: RequestId,
        /// The op it named.
        op: String,
    },
    /// Nothing correlatable: no object, no integer `id`, no string `op`. There is no request to
    /// answer, so the connection ends.
    Uncorrelatable,
}

/// The longest op string this engine will quote back in an error message.
///
/// A refusal is a diagnostic and a diagnostic gets pasted into bug reports, so a hostile peer must
/// not be able to choose a megabyte of it. The same reasoning as `MAX_CAPTURE_CHARS` app-side.
const MAX_QUOTED_OP: usize = 64;

/// Decide what to say about a frame the generated types refused.
#[must_use]
pub fn classify(raw: &serde_json::Value) -> Unreadable {
    let (Some(id), Some(op)) = (
        raw.get("id").and_then(serde_json::Value::as_i64),
        raw.get("op").and_then(serde_json::Value::as_str),
    ) else {
        return Unreadable::Uncorrelatable;
    };
    let quoted: String = op.chars().take(MAX_QUOTED_OP).collect();
    if is_known_op(op) {
        Unreadable::BadParams {
            id: RequestId(id),
            op: quoted,
        }
    } else {
        Unreadable::UnknownOp {
            id: RequestId(id),
            op: quoted,
        }
    }
}

/// Turn a classification into the message to send.
#[must_use]
pub fn refuse(what: &Unreadable) -> Option<EngineMessage> {
    let (id, code, message) = match what {
        Unreadable::UnknownOp { id, op } => (
            id,
            ErrorCode::UnknownOp,
            format!("this engine has no op named {op:?}"),
        ),
        Unreadable::BadParams { id, op } => (
            id,
            ErrorCode::BadParams,
            format!("the params of {op:?} are not the shape this protocol version states"),
        ),
        Unreadable::Uncorrelatable => return None,
    };
    match error(RequestId(**id), code, message) {
        Outcome::Send(mut messages) => messages.pop(),
        Outcome::Close(_) => None,
    }
}

/// Is this one of the ops the contract names?
///
/// THE STRINGS COME FROM THE GENERATED TAG ENUMS, never from literals typed here. `session.attach`
/// spelled by hand in this file would be a fourth place the op table lives, and the one that no
/// codegen run would ever correct.
fn is_known_op(op: &str) -> bool {
    [
        HelloOp::Hello.to_string(),
        EchoRequestOp::Echo.to_string(),
        SessionAttachRequestOp::SessionAttach.to_string(),
        SessionHealthRequestOp::SessionHealth.to_string(),
        SessionProgressRequestOp::SessionProgress.to_string(),
        ModuleSnapshotRequestOp::ModuleSnapshot.to_string(),
        PerfSnapshotRequestOp::PerfSnapshot.to_string(),
        ViewSubscribeRequestOp::ViewSubscribe.to_string(),
        ViewUnsubscribeRequestOp::ViewUnsubscribe.to_string(),
        AlertsDefineRequestOp::AlertsDefine.to_string(),
        BuffTrustDefineRequestOp::BuffTrustDefine.to_string(),
        RespawnDefineRequestOp::RespawnDefine.to_string(),
        ComboDefineRequestOp::ComboDefine.to_string(),
        RosterDefineRequestOp::RosterDefine.to_string(),
        CombatSnapshotRequestOp::CombatSnapshot.to_string(),
        CombatSearchFightsRequestOp::CombatSearchFights.to_string(),
    ]
    .iter()
    .any(|known| known == op)
}

#[cfg(test)]
mod tests {
    use super::{classify, refuse, Outcome, Session, Unreadable};
    use crate::world::World;
    use protocol::generated::{
        ClientMessage, EchoParams, EchoRequest, EchoRequestOp, EngineMessage, ErrorCode, Hello,
        HelloOp, ModuleSnapshotParams, ModuleSnapshotRequest, ModuleSnapshotRequestOp,
        PerfSnapshotRequest, PerfSnapshotRequestOp, ReplyResult, RequestId, SessionAttachParams,
        SessionAttachRequest, SessionAttachRequestOp, SessionHealthRequest, SessionHealthRequestOp,
        Token, ViewDescriptor, ViewSubscribeRequest, ViewSubscribeRequestOp, ViewUnsubscribeParams,
        ViewUnsubscribeRequest, ViewUnsubscribeRequestOp,
    };

    fn echo(id: i64, text: &str) -> ClientMessage {
        ClientMessage::EchoRequest(EchoRequest {
            id: RequestId(id),
            op: EchoRequestOp::Echo,
            params: EchoParams {
                text: text.to_owned(),
            },
        })
    }

    fn subscribe(id: i64) -> ClientMessage {
        ClientMessage::ViewSubscribeRequest(ViewSubscribeRequest {
            id: RequestId(id),
            op: ViewSubscribeRequestOp::ViewSubscribe,
            params: ViewDescriptor {
                source: "loot.ledger".to_owned(),
                filter: None,
                sort: Vec::new(),
                window: None,
            },
        })
    }

    fn unsubscribe(id: i64, subscription: i64) -> ClientMessage {
        ClientMessage::ViewUnsubscribeRequest(ViewUnsubscribeRequest {
            id: RequestId(id),
            op: ViewUnsubscribeRequestOp::ViewUnsubscribe,
            params: ViewUnsubscribeParams {
                subscription: RequestId(subscription),
            },
        })
    }

    fn sent(outcome: Outcome) -> Vec<EngineMessage> {
        match outcome {
            Outcome::Send(messages) => messages,
            Outcome::Close(why) => panic!("expected messages, got a close: {why}"),
        }
    }

    /// A world whose attaches START NOTHING, and one connection joined to it.
    ///
    /// The op table's job is the envelope, and every test here is about a shape rather than about a
    /// fold; giving these tests a real ingest would make them depend on a file, a thread and a spell
    /// DB none of them says anything about. `ingest.rs` and `tests/ingest.rs` own that half.
    fn table() -> (World, Session) {
        let world = World::with_ingest(std::sync::Arc::new(|_world, _generation, _log| {}));
        let session = Session::new(world.join().id);
        (world, session)
    }

    /// The path an attach names in this module. Nothing opens it.
    const A_LOG: &str = "C:/nowhere/eqlog_Primitive_freeport.txt";

    #[test]
    fn echo_returns_what_it_was_given() {
        let (world, mut session) = table();
        let messages = sent(session.dispatch(&world, echo(11, "a\nb\tc")));
        let [EngineMessage::Reply(reply)] = messages.as_slice() else {
            panic!("one reply");
        };
        assert_eq!(*reply.id, 11);
        assert!(reply.ok);
        let ReplyResult::EchoResult(result) = &reply.result else {
            panic!("an echo result");
        };
        assert_eq!(result.text, "a\nb\tc");
    }

    #[test]
    fn health_reports_the_worlds_generation() {
        let (world, mut session) = table();
        world.attach(A_LOG);
        let messages = sent(session.dispatch(
            &world,
            ClientMessage::SessionHealthRequest(SessionHealthRequest {
                id: RequestId(3),
                op: SessionHealthRequestOp::SessionHealth,
                params: protocol::generated::NoParams {},
            }),
        ));
        let [EngineMessage::Reply(reply)] = messages.as_slice() else {
            panic!("one reply");
        };
        let ReplyResult::HealthResult(result) = &reply.result else {
            panic!("a health result");
        };
        assert_eq!(*result.epoch, 2);
    }

    #[test]
    fn attach_answers_with_the_new_generation() {
        let (world, mut session) = table();
        let messages = sent(session.dispatch(
            &world,
            ClientMessage::SessionAttachRequest(SessionAttachRequest {
                id: RequestId(4),
                op: SessionAttachRequestOp::SessionAttach,
                params: SessionAttachParams {
                    log_path: "C:/nowhere/eqlog_Primitive_freeport.txt".to_owned(),
                },
            }),
        ));
        let [EngineMessage::Reply(reply)] = messages.as_slice() else {
            panic!("one reply");
        };
        let ReplyResult::AttachResult(result) = &reply.result else {
            panic!("an attach result");
        };
        assert!(result.accepted);
        assert_eq!(*result.epoch, 2);
    }

    #[test]
    fn a_subscription_acknowledges_then_opens_with_an_empty_reset() {
        let (world, mut session) = table();
        let messages = sent(session.dispatch(&world, subscribe(7)));
        let [EngineMessage::Reply(reply), EngineMessage::ResetMessage(reset)] = messages.as_slice()
        else {
            panic!("an ack then a reset, in that order");
        };
        let ReplyResult::SubscribeAck(ack) = &reply.result else {
            panic!("a subscribe ack");
        };
        assert_eq!(*ack.subscription, 7);
        assert!(ack.subscribed);
        assert_eq!(*reset.id, 7);
        assert_eq!(reset.total, 0);
        assert!(reset.rows.is_empty());
        assert_eq!(*reset.epoch, 1);
    }

    #[test]
    fn unsubscribing_closes_the_stream_once_and_then_reports_not_found() {
        let (world, mut session) = table();
        sent(session.dispatch(&world, subscribe(7)));

        let first = sent(session.dispatch(&world, unsubscribe(8, 7)));
        let [EngineMessage::Reply(reply)] = first.as_slice() else {
            panic!("one reply");
        };
        let ReplyResult::SubscribeAck(ack) = &reply.result else {
            panic!("a subscribe ack");
        };
        assert_eq!(*ack.subscription, 7);
        assert!(!ack.subscribed);

        let again = sent(session.dispatch(&world, unsubscribe(9, 7)));
        let [EngineMessage::ErrorReply(refusal)] = again.as_slice() else {
            panic!("a refusal");
        };
        assert_eq!(*refusal.id, 9);
        assert!(!refusal.ok);
        assert!(matches!(refusal.error.code, ErrorCode::NotFound));
    }

    #[test]
    fn one_connection_cannot_unsubscribe_anothers_stream() {
        let (world, mut mine) = table();
        // A SECOND CONNECTION, joined to the SAME world: the isolation is between listeners, so a
        // test that shared one membership would prove nothing.
        let mut theirs = Session::new(world.join().id);
        sent(mine.dispatch(&world, subscribe(7)));

        let messages = sent(theirs.dispatch(&world, unsubscribe(1, 7)));
        let [EngineMessage::ErrorReply(refusal)] = messages.as_slice() else {
            panic!("a refusal");
        };
        assert!(matches!(refusal.error.code, ErrorCode::NotFound));
    }

    #[test]
    fn a_second_hello_ends_the_conversation() {
        let (world, mut session) = table();
        let hello = ClientMessage::Hello(Hello {
            op: HelloOp::Hello,
            protocol_version: protocol::PROTOCOL_VERSION,
            token: Token::try_from(
                "0f7d2c9a4b1e6538aa03d7c5e9124f86b0d3a7c1e2f4085967ab3cd12e4f7089",
            )
            .expect("a token"),
        });
        assert!(matches!(session.dispatch(&world, hello), Outcome::Close(_)));
    }

    #[test]
    fn an_op_this_build_has_never_heard_of_is_named_and_refused() {
        let raw = serde_json::json!({"id": 42, "op": "loot.summon", "params": {}});
        let what = classify(&raw);
        assert!(matches!(what, Unreadable::UnknownOp { .. }));
        let Some(EngineMessage::ErrorReply(refusal)) = refuse(&what) else {
            panic!("a refusal");
        };
        assert_eq!(*refusal.id, 42);
        assert!(matches!(refusal.error.code, ErrorCode::UnknownOp));
    }

    #[test]
    fn a_known_op_with_the_wrong_params_is_a_different_refusal() {
        let raw = serde_json::json!({"id": 43, "op": "echo", "params": {"txt": "typo"}});
        let what = classify(&raw);
        let Some(EngineMessage::ErrorReply(refusal)) = refuse(&what) else {
            panic!("a refusal");
        };
        assert_eq!(*refusal.id, 43);
        assert!(matches!(refusal.error.code, ErrorCode::BadParams));
    }

    #[test]
    fn a_frame_with_no_request_in_it_is_not_answerable() {
        for raw in [
            serde_json::json!({"op": "echo"}),
            serde_json::json!({"id": 1}),
            serde_json::json!([1, 2, 3]),
            serde_json::json!("hello"),
            serde_json::json!({"id": "seven", "op": "echo"}),
        ] {
            let what = classify(&raw);
            assert!(matches!(what, Unreadable::Uncorrelatable), "{raw}");
            assert!(refuse(&what).is_none());
        }
    }

    #[test]
    fn module_snapshot_is_an_op_this_build_knows() {
        // THE KNOWN-OP LIST IS BUILT FROM THE GENERATED TAG ENUMS and a new op must be added to it,
        // or a request with a typo'd param gets `unknownOp` — which sends a client hunting for a
        // missing feature instead of for its own mistake. This is the pin for the op JOS-478 added.
        let raw =
            serde_json::json!({"id": 44, "op": "module.snapshot", "params": {"modul": "loot"}});
        let Some(EngineMessage::ErrorReply(refusal)) = refuse(&classify(&raw)) else {
            panic!("a refusal");
        };
        assert!(matches!(refusal.error.code, ErrorCode::BadParams));
    }

    #[test]
    fn a_module_snapshot_with_no_fold_is_unavailable_rather_than_not_found() {
        // A world whose attaches start NOTHING has no ingest to ask, and the two refusals mean
        // different things to a client — see the dispatch arm.
        let (world, mut session) = table();
        world.attach(A_LOG);
        let messages = sent(session.dispatch(
            &world,
            ClientMessage::ModuleSnapshotRequest(ModuleSnapshotRequest {
                id: RequestId(12),
                op: ModuleSnapshotRequestOp::ModuleSnapshot,
                params: ModuleSnapshotParams {
                    module: "loot".to_owned(),
                },
            }),
        ));
        let [EngineMessage::ErrorReply(refusal)] = messages.as_slice() else {
            panic!("a refusal");
        };
        assert_eq!(*refusal.id, 12);
        assert!(matches!(refusal.error.code, ErrorCode::Unavailable));
    }

    #[test]
    fn perf_snapshot_is_an_op_this_build_knows() {
        // Same pin as `module_snapshot_is_an_op_this_build_knows`, and for the same failure: an op
        // missing from the known-op list answers `unknownOp` to a request with a typo'd param,
        // which sends a client hunting for a feature that is right there.
        let raw = serde_json::json!({"id": 45, "op": "perf.snapshot", "params": {"who": "me"}});
        let Some(EngineMessage::ErrorReply(refusal)) = refuse(&classify(&raw)) else {
            panic!("a refusal");
        };
        assert!(matches!(refusal.error.code, ErrorCode::BadParams));
    }

    #[test]
    fn a_perf_snapshot_with_no_fold_answers_rather_than_refusing() {
        // THE ASYMMETRY WITH `module.snapshot` IS THE POINT. A world with no fold cannot answer a
        // module question at all, so that op says `unavailable`; a perf question names nothing that
        // could be absent, and an engine that has not attached yet is simply IDLE. A panel drawing
        // the engine on every launch depends on this being an answer.
        let (world, mut session) = table();
        let messages = sent(session.dispatch(
            &world,
            ClientMessage::PerfSnapshotRequest(PerfSnapshotRequest {
                id: RequestId(13),
                op: PerfSnapshotRequestOp::PerfSnapshot,
                params: protocol::generated::NoParams {},
            }),
        ));
        let [EngineMessage::Reply(reply)] = messages.as_slice() else {
            panic!("one reply");
        };
        assert_eq!(*reply.id, 13);
        let ReplyResult::PerfSnapshotResult(result) = &reply.result else {
            panic!("a perf snapshot result");
        };
        assert!(matches!(
            result.status,
            protocol::generated::PerfSnapshotResultStatus::Idle
        ));
        assert_eq!(*result.epoch, 1);
        assert!(result.serve.is_empty());
        // Absent, not zero — nothing has been measured.
        assert_eq!(result.ingest.scan_ms, None);
        assert_eq!(result.ingest.scan_bytes, None);
        assert_eq!(result.ingest.spell_db_ms, None);
    }

    #[test]
    fn a_perf_snapshot_counts_the_subscriptions_that_are_open_right_now() {
        // The world's own half of the answer, and the half no meter could give: the meter counts
        // frames that were sent and knows nothing about who is still listening. A source with a
        // subscriber and no frames yet is a row, because "opened and nothing came" and "never
        // opened" are different things to be looking at.
        let (world, mut session) = table();
        sent(session.dispatch(&world, subscribe(7)));
        let messages = sent(session.dispatch(
            &world,
            ClientMessage::PerfSnapshotRequest(PerfSnapshotRequest {
                id: RequestId(14),
                op: PerfSnapshotRequestOp::PerfSnapshot,
                params: protocol::generated::NoParams {},
            }),
        ));
        let [EngineMessage::Reply(reply)] = messages.as_slice() else {
            panic!("one reply");
        };
        let ReplyResult::PerfSnapshotResult(result) = &reply.result else {
            panic!("a perf snapshot result");
        };
        let [row] = result.serve.as_slice() else {
            panic!("one watched source, got {:?}", result.serve);
        };
        assert_eq!(row.source, "loot.ledger");
        assert_eq!(row.subscribers, 1);
        assert_eq!(row.frames, 0, "the serve pass has not run");
        assert_eq!(row.fold_to_frame_us_mean, None, "nothing was timed");

        // …and the count is LIVE: closing the window drops it, and the row goes with it because
        // nothing was ever served over it either.
        sent(session.dispatch(&world, unsubscribe(8, 7)));
        let after = sent(session.dispatch(
            &world,
            ClientMessage::PerfSnapshotRequest(PerfSnapshotRequest {
                id: RequestId(15),
                op: PerfSnapshotRequestOp::PerfSnapshot,
                params: protocol::generated::NoParams {},
            }),
        ));
        let [EngineMessage::Reply(reply)] = after.as_slice() else {
            panic!("one reply");
        };
        let ReplyResult::PerfSnapshotResult(result) = &reply.result else {
            panic!("a perf snapshot result");
        };
        assert!(result.serve.is_empty());
    }

    #[test]
    fn a_hostile_op_name_cannot_choose_the_length_of_the_diagnostic() {
        let raw = serde_json::json!({"id": 1, "op": "x".repeat(4096), "params": {}});
        let Unreadable::UnknownOp { op, .. } = classify(&raw) else {
            panic!("an unknown op");
        };
        assert_eq!(op.len(), super::MAX_QUOTED_OP);
    }
}
