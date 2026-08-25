//! THE ONE DOOR. Every piece of state this process holds lives behind [`World`], and every reader —
//! including the engine's own — asks for it by calling a method.
//!
//! WHY A STORE THAT HOLDS THIS LITTLE IS SHAPED THIS WAY. Owner ruling 18 (docs/plans/
//! data-server.md, "Cache transparency"): the destination is an engine that parses any given log
//! byte once, ever, with a cache under the store seam so transparent that even the engine's own
//! internal callers cannot tell cached from computed. Nothing is cached now and nothing may be —
//! but the interface laws that keep that door open are cheapest to obey while there is little
//! behind it, and impossible to retrofit once twenty modules have reached into each other's fields.
//! The four that bind this file:
//!
//! * **Reads go through one door** (law 2). There is no `pub` field here and no way to borrow the
//!   state. A caller asks [`World::health`] a question and gets an answer; whether that answer was
//!   computed just now or lifted from a checkpoint is not a distinction the caller can make.
//! * **State is addressed by (log identity, byte offset)** (law 3). Nothing here means "current"
//!   implicitly. The epoch is the world's generation and it is stated on every answer that depends
//!   on it; what the fold has consumed is stated as [`World::mark`] — a path and THE MARK, the end
//!   of the last complete line folded — and never as a time or a "so far".
//! * **Determinism is cacheability** (law 1). The one clock read in this file is `uptimeMs`, and
//!   it is a property of the PROCESS rather than of the world: it is derived from the start
//!   instant, never from anything the fold computes. No world state may ever be a function of the
//!   wall clock.
//! * **A cache invalidates by version, never by patching** (law 5). Which is the same statement as
//!   the epoch: a new generation is a new world, and the only way to move between generations is to
//!   take the fresh reset. There is no incremental repair here and there never will be.
//!
//! THE EPOCH AND ITS ANNOUNCEMENT ARE ONE CRITICAL SECTION. [`World::attach`] bumps the generation
//! and pushes the [`EpochMessage`] to every connection while still holding the lock, so no two
//! attaches can interleave their announcements and no connection can ever be told about generation
//! N+1 before generation N. That is not a performance decision — the lock is held for the length of
//! a few `Sender::send` calls into unbounded queues — it is the ordering the client's
//! drop-and-reset rule depends on. Opening a subscription and stamping its reset happen in that
//! same critical section ([`World::open_subscription`]), for the same reason.
//!
//! THE GENERATION IS THE INGEST'S OWNERSHIP TOKEN (JOS-457, engine-side). It is bumped under this
//! file's lock and readable without it, because the question an in-flight fold asks at every slice
//! boundary — "do I still own the world?" — must not contend with the world it no longer owns. Every
//! statement an ingest makes about the world goes through a `report_*` method that re-asks it INSIDE
//! the lock and answers `false` to a turn that has lost; a loser can therefore write nothing, ever,
//! however long it takes to notice. See `ingest.rs` for the other half.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use protocol::generated::{
    AttachResult, EngineMessage, Epoch, EpochMessage, EpochMessageKind, EpochReason, FoldProgress,
    HealthResult, HealthResultStatus, LogMark, RequestId, ResetMessage, ResetMessageKind,
};

use crate::ingest::{self, Starter};

/// The generation a fresh process starts in.
///
/// One, not zero: there is always a world, even when it is an empty one, and an epoch of zero would
/// read as "no world yet" to anybody skimming a log. A launch is generation 1 and the first attach
/// makes it 2.
const FIRST_EPOCH: i64 = 1;

/// How long [`World::module_snapshot`] waits for the ingest thread before calling it unreachable.
///
/// GENEROUS ON PURPOSE, AND THE ARITHMETIC IS THE REASON. The ingest answers at a boundary it
/// already reaches: one 1 MiB read of the scan, or one 25 ms nap of the tail. A release build folds
/// ~9 MB/s through the twenty modules, so that boundary is ~110 ms; a DEBUG build is an order of
/// magnitude slower, which puts one slice near a second, and a loaded machine further still. Five
/// seconds clears all of that by a wide margin while still being short enough that a client's
/// request does not look hung — and every millisecond above the real wait is spent only on a fold
/// that is not coming back.
const SNAPSHOT_PATIENCE: std::time::Duration = std::time::Duration::from_secs(5);

/// What [`World::module_snapshot`] found.
///
/// THREE OUTCOMES AND NOT TWO, because "this engine has no such module" and "this engine has no
/// fold" are different sentences and a client branches on them differently: the first is a caller
/// bug (or a build skew), the second is a session that has not attached yet and will.
#[derive(Debug)]
pub enum SnapshotAnswer {
    /// The module answered with its published state.
    Snapshot(ingest::ModuleSnapshot),
    /// The fold carries no module by that name. The REGISTRY is the authority — see
    /// [`ingest::EventSink::snapshot`].
    NotFound,
    /// Nothing is folding, or the fold could not be reached. The string is the diagnostic that
    /// reaches the client's `ErrorReply.message`.
    Unavailable(String),
}

/// A handle on the process's whole state. Cheap to clone; every clone is the same world.
#[derive(Clone)]
pub struct World {
    inner: Arc<Inner>,
}

struct Inner {
    /// When this process started. See the header: process metadata, never world state.
    started: Instant,
    /// THE INGEST'S OWNERSHIP TOKEN. Written only under `state`'s lock; read without it.
    generation: AtomicU64,
    /// What an accepted attach starts. See [`ingest::Starter`] — this is the phase-2a seam, and the
    /// whole extent of what the fold registry changes here.
    ingest: Starter,
    state: Mutex<State>,
}

struct State {
    epoch: i64,
    /// Every open connection's outbox. Connection-wide messages — [`EpochMessage`], and the
    /// per-subscription resets a landing fold produces — are pushed here under the same lock that
    /// owns the epoch.
    listeners: Vec<Listener>,
    /// The next listener id. Monotonic, never reused, so a stale id can never name a live
    /// connection.
    next_listener: u64,
    /// What the ingest is doing. `Idle` when there is none — see [`World::health`].
    status: HealthResultStatus,
    /// What the current ingest has folded, in the only coordinates law 3 allows.
    fold: Fold,
    /// THE WAY TO ASK THE CURRENT FOLD A QUESTION, or `None` when nothing is folding.
    ///
    /// It is a SENDER and not the fold, which is the whole design (see [`ingest::SnapshotAsk`]):
    /// the world holds a way to reach the ingest thread, never a second handle on its state. A
    /// preemption drops it — `attach` clears the field under the same lock that bumps the epoch —
    /// so a reader can never be answered by a fold the world has already disowned.
    snapshots: Option<Sender<ingest::SnapshotAsk>>,
}

/// What the world's fold has consumed. A COORDINATE PAIR plus what was counted along the way.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Fold {
    /// The log being folded, or `None` before the first attach.
    log: Option<PathBuf>,
    /// THE MARK: the end of the last complete line folded (`eqlog::tail`'s `checkpoint_offset`,
    /// which is the same definition as `ScanResult.endOffset`). The engine owns it — boundary
    /// verdict 4 — and it is the coordinate any future checkpoint is keyed by.
    checkpoint: u64,
    /// Events folded in this generation. Counts EVENTS, not lines.
    events: i64,
    /// The `ts` of the last event folded — THE LOG'S own clock.
    last_ts: Option<i64>,
}

/// One measurement of an ingest, as the ingest thread hands it to the world.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FoldMark {
    /// THE MARK — see [`Fold::checkpoint`].
    pub checkpoint: u64,
    /// Events folded so far.
    pub events: i64,
    /// How far through the bytes the mark has reached, as a percentage. A FLOAT (owner ruling 17),
    /// bytes over bytes, engine-measured.
    pub pct: f64,
    /// The `ts` of the last event folded, if one could be read.
    pub last_ts: Option<i64>,
}

/// What the fold has consumed, as a coordinate the caller can name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mark {
    /// The log being folded, or `None` before the first attach.
    pub log: Option<PathBuf>,
    /// THE MARK: the end of the last complete line folded.
    pub checkpoint: u64,
    /// Events folded in this generation.
    pub events: i64,
    /// The `ts` of the last event folded.
    pub last_ts: Option<i64>,
}

struct Listener {
    id: ListenerId,
    outbox: Sender<EngineMessage>,
    /// The subscribe-request ids open on this connection.
    ///
    /// THEY LIVE HERE, NOT ON THE CONNECTION, for two reasons that only became true when a fold
    /// arrived: a landing fold must reset EVERY open subscription, which is a statement about all
    /// connections at once; and a subscription's opening reset must be stamped with the epoch under
    /// the same lock that can bump it. Per-connection ISOLATION is unchanged — request ids are
    /// client-chosen and two renderers routinely pick the same number, so a subscription is named
    /// by (listener, id) and one client still cannot unsubscribe another's stream.
    subscriptions: std::collections::BTreeSet<i64>,
}

/// Names one connection's membership of the world. Opaque on purpose: it is a receipt to hand back
/// to [`World::leave`], never a thing to do arithmetic on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ListenerId(u64);

/// What [`World::join`] hands a connection: its receipt, its way to send, and its way to receive.
pub struct Membership {
    /// The receipt for [`World::leave`].
    pub id: ListenerId,
    /// The connection's outbox. Its reader thread pushes replies here; the world pushes
    /// connection-wide messages here. ONE QUEUE, so the order a connection observes is the order
    /// things happened.
    pub outbox: Sender<EngineMessage>,
    /// The other end, drained by the connection's writer thread.
    pub inbox: Receiver<EngineMessage>,
}

impl World {
    /// A fresh world folding into counting sinks. A respawn is a launch (owner ruling 10), so this
    /// is the only way one is ever made and there is no state to restore.
    #[must_use]
    pub fn new() -> Self {
        Self::with_ingest(ingest::default_starter())
    }

    /// A fresh world whose attaches start the ingest the caller names. THE PHASE-2a SEAM: the fold
    /// registry arrives as `ingest::starter(<its factory>)` here and nothing else in this crate
    /// moves.
    #[must_use]
    pub fn with_ingest(ingest: Starter) -> Self {
        Self {
            inner: Arc::new(Inner {
                started: Instant::now(),
                generation: AtomicU64::new(0),
                ingest,
                state: Mutex::new(State {
                    epoch: FIRST_EPOCH,
                    listeners: Vec::new(),
                    next_listener: 0,
                    status: HealthResultStatus::Idle,
                    fold: Fold::default(),
                    snapshots: None,
                }),
            }),
        }
    }

    /// Register a connection and give it its queue.
    pub fn join(&self) -> Membership {
        let (outbox, inbox) = channel();
        let mut state = self.lock();
        let id = ListenerId(state.next_listener);
        state.next_listener += 1;
        state.listeners.push(Listener {
            id,
            outbox: outbox.clone(),
            subscriptions: std::collections::BTreeSet::new(),
        });
        Membership { id, outbox, inbox }
    }

    /// Deregister a connection, and with it every subscription it held. Idempotent: leaving twice is
    /// not an error, because a connection can end in more than one way and the tidy-up path must not
    /// care which.
    pub fn leave(&self, id: ListenerId) {
        self.lock().listeners.retain(|l| l.id != id);
    }

    /// Open one subscription and answer with the epoch its reset must name.
    ///
    /// ONE CRITICAL SECTION, and that closes the caveat phase 0 wrote down here: a caller that read
    /// the epoch and then built a reset from it was racing an attach on another connection, so a
    /// subscription's opening reset could name a generation that had already been superseded. It
    /// cannot now — the registration and the stamp happen together, and an attach that lands after
    /// this returns finds the subscription already registered and resets it when its fold lands.
    pub fn open_subscription(&self, listener: ListenerId, subscription: i64) -> Epoch {
        let mut state = self.lock();
        let epoch = Epoch(state.epoch);
        if let Some(l) = state.listeners.iter_mut().find(|l| l.id == listener) {
            l.subscriptions.insert(subscription);
        }
        epoch
    }

    /// Close one subscription. `false` when this connection does not hold it — including one it held
    /// a moment ago, which is the honest answer rather than a comforting one.
    pub fn close_subscription(&self, listener: ListenerId, subscription: i64) -> bool {
        let mut state = self.lock();
        state
            .listeners
            .iter_mut()
            .find(|l| l.id == listener)
            .is_some_and(|l| l.subscriptions.remove(&subscription))
    }

    /// Answer `session.health`.
    ///
    /// THE STATUS IS THE INGEST'S, AND IT IS HONEST NOW (JOS-474): `idle` when no fold exists —
    /// a fresh process, or one whose ingest ended — then `starting` at the instant an attach is
    /// accepted, `attaching` while the log is opened and the parse's inputs are built, `folding`
    /// for the length of the historical scan, and `live` once the tail owns the file.
    ///
    /// THE MARK IS ON THE WIRE NOW (JOS-478), and the schema gap phase 2 wrote down here is closed:
    /// `HealthResult` carries the mark — the addressable coordinate of ruling 18 law 3, a log
    /// identity and the byte offset of the last complete line folded — plus the event count and the
    /// log's own last timestamp. The engine still OWNS all three (boundary verdict 4); it merely
    /// answers them to a client as well as to itself.
    ///
    /// ALL THREE ARE ABSENT BEFORE THE FIRST ATTACH, and absent is not zero. A fresh process has no
    /// log, so it has no coordinate; publishing `offset: 0` would be a measurement nobody took, and
    /// a client cannot tell "nothing folded" from "folded nothing" if the two look the same. The
    /// discriminator is the LOG: the world knows one from the instant an attach is accepted, and
    /// from that instant the count and the mark are real answers even while they read zero.
    #[must_use]
    pub fn health(&self) -> HealthResult {
        let state = self.lock();
        let mark = state.fold.log.as_ref().map(|log| LogMark {
            log: log.to_string_lossy().into_owned(),
            offset: i64::try_from(state.fold.checkpoint).unwrap_or(i64::MAX),
        });
        HealthResult {
            status: state.status,
            epoch: Epoch(state.epoch),
            uptime_ms: i64::try_from(self.inner.started.elapsed().as_millis()).unwrap_or(i64::MAX),
            // `events` rides with the mark, because they are one measurement read two ways: the
            // count and the coordinate it was reached at. One present and the other absent would
            // be a pair a reader has to reason about.
            events: mark.as_ref().map(|_| state.fold.events),
            // …and `lastEventTs` does NOT, because it has its own reason to be missing: a fold that
            // has folded nothing yet, or whose events so far carried no stamp the parser could
            // read, honestly has no log clock to report.
            last_event_ts: state.fold.last_ts,
            mark,
        }
    }

    /// Answer `module.snapshot` — one module's published state, from the fold that is running.
    ///
    /// THE ANSWER COMES FROM THE INGEST THREAD AND FROM NOWHERE ELSE. This method holds the world's
    /// lock only long enough to copy the way IN (see [`State::snapshots`]); the wait happens with
    /// the lock released, or the fold's own `report_progress` would deadlock against the reader
    /// waiting for it.
    ///
    /// THE DEADLINE IS A FAILURE MECHANISM, not a latency budget. In the shapes that exist the
    /// answer arrives within one read boundary of a scan or one nap of a tail; [`SNAPSHOT_PATIENCE`]
    /// exists so that a fold wedged on a pathological file turns into an `unavailable` reply rather
    /// than a connection that never answers — the same argument the ingest suite's own deadline
    /// makes.
    #[must_use]
    pub fn module_snapshot(&self, module: &str) -> SnapshotAnswer {
        // THE LOCK IS TAKEN AND RELEASED IN THESE THREE LINES, and they are three lines rather than
        // one so that nothing about drop order has to be reasoned about: the guard is a named
        // binding inside a block, and the block ends before anything below can block.
        let asks = {
            let state = self.lock();
            state.snapshots.clone()
        };
        let Some(asks) = asks else {
            return SnapshotAnswer::Unavailable(
                "no log is attached, so there is no fold to ask".to_owned(),
            );
        };
        let (answer, wait) = channel();
        let ask = ingest::SnapshotAsk {
            module: module.to_owned(),
            answer,
        };
        if asks.send(ask).is_err() {
            // The receiver is gone: the ingest ended between the copy above and this send. That is
            // the same outcome as never having had one, and it is stated differently because the
            // two are different things to read in a bug report.
            return SnapshotAnswer::Unavailable("the fold that was answering has ended".to_owned());
        }
        match wait.recv_timeout(SNAPSHOT_PATIENCE) {
            Ok(Some(snapshot)) => SnapshotAnswer::Snapshot(snapshot),
            Ok(None) => SnapshotAnswer::NotFound,
            Err(_) => SnapshotAnswer::Unavailable(format!(
                "the fold did not answer within {} ms",
                SNAPSHOT_PATIENCE.as_millis()
            )),
        }
    }

    /// What the fold has consumed: the log, THE MARK, and what was counted reaching it.
    ///
    /// The engine's own door onto the coordinate ruling 18 law 3 names. Not on the wire — see the
    /// schema gap in [`World::health`].
    #[must_use]
    pub fn mark(&self) -> Mark {
        let fold = self.lock().fold.clone();
        Mark {
            log: fold.log,
            checkpoint: fold.checkpoint,
            events: fold.events,
            last_ts: fold.last_ts,
        }
    }

    /// Answer `session.attach` — begin folding one log, PREEMPTING anything already folding.
    ///
    /// WHAT HAPPENS INSIDE THE LOCK: the epoch bumps, the generation bumps (which is what strips the
    /// in-flight ingest of its ownership, before this call returns and before anything new starts),
    /// the world is emptied of the previous fold's coordinates, the status becomes `starting`, and
    /// the bump is announced to every connection.
    ///
    /// WHAT HAPPENS OUTSIDE IT: the ingest thread starts. Deliberately after the lock is released —
    /// a thread spawn is a syscall and the epoch's critical section must stay the length of a few
    /// queue pushes.
    ///
    /// `accepted` IS ALWAYS TRUE, and now the field earns its place: an attach preempts any
    /// in-flight attach (last pick wins, never queued), so the only way to lose is to be superseded
    /// — and nothing can supersede an acceptance that completes inside the lock. The turn that LOSES
    /// is the older ingest, and it reports nothing to anybody, by law.
    ///
    /// NO `progress` RIDES THE ANNOUNCEMENT. At the instant of the bump the fold has not opened the
    /// file, so a percentage would be inventing a measurement. The first honest frame arrives from
    /// the ingest a moment later, carrying `pct` 0 and the size it actually measured.
    pub fn attach(&self, log_path: &str) -> AttachResult {
        let log = PathBuf::from(log_path);
        let generation;
        let epoch;
        {
            let mut state = self.lock();
            state.epoch += 1;
            epoch = Epoch(state.epoch);
            // BUMPED UNDER THE LOCK, so the atomic and the epoch can never disagree about which
            // turn owns the world.
            generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
            state.status = HealthResultStatus::Starting;
            state.fold = Fold {
                log: Some(log.clone()),
                ..Fold::default()
            };
            // THE OLD FOLD STOPS BEING ASKABLE AT THE BUMP, in the same critical section that
            // strips it of its ownership. Not when it notices, not when its thread ends: a reader
            // must never be answered by a generation the world has already replaced, and the
            // preempted ingest's own `report_*` calls already cannot write anything.
            state.snapshots = None;
            let announcement = EngineMessage::EpochMessage(EpochMessage {
                kind: EpochMessageKind::Epoch,
                epoch: Epoch(state.epoch),
                reason: EpochReason::Attach,
                progress: None,
            });
            broadcast(&mut state, &announcement);
        }

        (self.inner.ingest)(self, generation, log);

        AttachResult {
            epoch,
            accepted: true,
        }
    }

    /// Does this turn still own the world? The lock-free half of the generation law.
    #[must_use]
    pub fn owns(&self, generation: u64) -> bool {
        self.inner.generation.load(Ordering::SeqCst) == generation
    }

    /// THE INGEST OFFERS TO ANSWER QUESTIONS: install this turn's snapshot channel.
    ///
    /// A `report_*` method like every other statement an ingest makes, and for the same reason —
    /// ownership is re-asked INSIDE the lock, so a turn that has already lost cannot install a door
    /// onto a fold nobody wants. It is called once per attach, before the first byte is folded, so
    /// that `module.snapshot` during the historical scan is answerable rather than merely
    /// eventually answerable.
    pub fn serve_snapshots(&self, generation: u64, asks: Sender<ingest::SnapshotAsk>) -> bool {
        let mut state = self.lock();
        if !self.owns(generation) {
            return false;
        }
        state.snapshots = Some(asks);
        true
    }

    /// Move the health status, if this turn still owns the world.
    pub fn report_status(&self, generation: u64, status: HealthResultStatus) -> bool {
        let mut state = self.lock();
        if !self.owns(generation) {
            return false;
        }
        state.status = status;
        true
    }

    /// Announce one measurement of the fold to every connection.
    ///
    /// The frame is an `EpochMessage` carrying `progress` — the schema says in as many words that
    /// progress frames are not a fourth stream kind, they are this — so a client that acked
    /// `session.progress` and a client that acked nothing see the same thing, which is what
    /// connection-wide means.
    pub fn report_progress(&self, generation: u64, mark: FoldMark) -> bool {
        let mut state = self.lock();
        if !self.owns(generation) {
            return false;
        }
        state.fold.checkpoint = mark.checkpoint;
        state.fold.events = mark.events;
        state.fold.last_ts = mark.last_ts;
        let frame = EngineMessage::EpochMessage(EpochMessage {
            kind: EpochMessageKind::Epoch,
            epoch: Epoch(state.epoch),
            reason: EpochReason::Progress,
            progress: Some(FoldProgress {
                pct: mark.pct,
                events: mark.events,
            }),
        });
        broadcast(&mut state, &frame);
        true
    }

    /// THE FOLD LANDED: the historical scan is complete and the tail has the file.
    ///
    /// Every open subscription is RESET, on every connection, stamped with this generation — rule 1
    /// of the diff protocol (reset-then-diffs) at the one moment the whole window changed at once.
    /// The rows are empty until the fold registry arrives; a client that special-cased "no reset
    /// because there was nothing" would be a client that cannot tell an empty view from a view that
    /// never re-opened.
    ///
    /// EXACTLY ONE PER WINNING ATTACH. A preempted ingest never reaches here, and one that does can
    /// only pass through it once — the tail loop that follows has no way back.
    pub fn report_fold_landed(&self, generation: u64, mark: FoldMark) -> bool {
        let mut state = self.lock();
        if !self.owns(generation) {
            return false;
        }
        state.status = HealthResultStatus::Live;
        state.fold.checkpoint = mark.checkpoint;
        state.fold.events = mark.events;
        state.fold.last_ts = mark.last_ts;
        let landed = state.epoch;
        state.listeners.retain(|listener| {
            listener.subscriptions.iter().all(|subscription| {
                let reset = EngineMessage::ResetMessage(ResetMessage {
                    kind: ResetMessageKind::Reset,
                    id: RequestId(*subscription),
                    epoch: Epoch(landed),
                    total: 0,
                    rows: Vec::new(),
                });
                listener.outbox.send(reset).is_ok()
            })
        });
        true
    }

    /// THERE IS NO FOLD ANY MORE — the ingest could not start, could not read, or panicked.
    ///
    /// `idle` is the same word a never-attached process uses, and that is the honest one: it says
    /// nothing is being folded. The EPOCH IS UNTOUCHED, deliberately — a fold that died did not
    /// create a new generation, and a client that was told about generation N is still looking at
    /// generation N's (empty) world rather than at a world it has never heard of.
    pub fn report_idle(&self, generation: u64) -> bool {
        let mut state = self.lock();
        if !self.owns(generation) {
            return false;
        }
        state.status = HealthResultStatus::Idle;
        // AND NOTHING IS ASKABLE ANY MORE. The ingest's receiver is about to be dropped with its
        // thread; clearing the sender here makes the world say "no fold" rather than making every
        // reader discover it one failed send at a time.
        state.snapshots = None;
        true
    }

    /// Take the lock, surviving a poisoned one.
    ///
    /// A POISONED MUTEX MUST NOT END THE ENGINE. Poisoning means some thread panicked while holding
    /// this lock; the state it guards is an integer, a list of channel senders and a byte offset,
    /// none of which a panic can leave torn. Propagating the panic would turn one bad connection —
    /// or one bad fold — into a dead engine for every other renderer, which is precisely the blast
    /// radius this process boundary exists to shrink.
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

/// Push a connection-wide message to every open connection, dropping the ones that have gone.
///
/// A SEND THAT FAILS IS A CONNECTION THAT ENDED, not an error: the writer thread drops its receiver
/// when the socket closes, and the world notices here rather than by being told. `leave` remains
/// the tidy path; this is the honest fallback for every other way a connection can die.
fn broadcast(state: &mut State, message: &EngineMessage) {
    state
        .listeners
        .retain(|listener| listener.outbox.send(message.clone()).is_ok());
}

#[cfg(test)]
mod tests {
    use super::{FoldMark, World};
    use protocol::generated::{EngineMessage, EpochReason, HealthResultStatus};
    use std::sync::Arc;

    /// A path standing in for a log. NOTHING IN THIS MODULE OPENS IT: these tests drive the world
    /// with the ingest replaced by a no-op, so the epoch, the subscription and the generation laws
    /// are proven with no thread, no file and no timing in the room. The ingest's own behaviour is
    /// proven against real bytes in `ingest.rs`'s tests and over a real socket in `tests/ingest.rs`.
    const A_LOG: &str = "C:/nowhere/eqlog_Nobody_freeport.txt";

    /// A world whose attaches start nothing.
    fn world() -> World {
        World::with_ingest(Arc::new(|_world, _generation, _log| {}))
    }

    /// The generation the current turn holds. A real ingest is HANDED its own number by `attach`
    /// and never has to ask; a test that replaced the ingest has to.
    fn generation(world: &World) -> u64 {
        world
            .inner
            .generation
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    fn mark(events: i64, pct: f64) -> FoldMark {
        FoldMark {
            checkpoint: 4096,
            events,
            pct,
            last_ts: Some(1_787_181_707_000),
        }
    }

    #[test]
    fn a_fresh_world_is_idle_in_the_first_generation() {
        let world = world();
        let health = world.health();
        assert!(matches!(health.status, HealthResultStatus::Idle));
        assert_eq!(*health.epoch, 1);
        assert_eq!(world.mark().checkpoint, 0);
        assert!(world.mark().log.is_none());
    }

    #[test]
    fn an_attach_bumps_the_generation_and_tells_everyone() {
        let world = world();
        let one = world.join();
        let two = world.join();

        let result = world.attach(A_LOG);
        assert!(result.accepted);
        assert_eq!(*result.epoch, 2);

        for membership in [&one, &two] {
            let message = membership.inbox.recv().expect("an announcement");
            let EngineMessage::EpochMessage(epoch) = message else {
                panic!("a connection-wide announcement is an epoch message");
            };
            assert_eq!(*epoch.epoch, 2);
            assert!(matches!(epoch.reason, EpochReason::Attach));
            assert!(
                epoch.progress.is_none(),
                "at the bump the fold has not opened the file, so it claims no percentage"
            );
        }
    }

    #[test]
    fn a_connection_that_left_hears_nothing_further() {
        let world = world();
        let stayed = world.join();
        let left = world.join();
        world.leave(left.id);

        world.attach(A_LOG);

        assert!(stayed.inbox.recv().is_ok());
        assert!(left.inbox.try_recv().is_err());
    }

    #[test]
    fn the_generation_is_process_global_and_monotonic() {
        let world = world();
        let mirror = world.clone();
        assert_eq!(*world.attach(A_LOG).epoch, 2);
        assert_eq!(*mirror.attach(A_LOG).epoch, 3);
        assert_eq!(*world.health().epoch, 3);
        assert_eq!(*mirror.health().epoch, 3);
    }

    #[test]
    fn an_attach_strips_the_turn_before_it_of_every_way_to_speak() {
        let world = world();
        world.attach(A_LOG);
        let loser = generation(&world);
        world.attach(A_LOG);

        assert!(!world.owns(loser));
        assert!(!world.report_status(loser, HealthResultStatus::Live));
        assert!(!world.report_progress(loser, mark(10, 50.0)));
        assert!(!world.report_fold_landed(loser, mark(10, 100.0)));
        assert!(!world.report_idle(loser));
    }

    #[test]
    fn a_progress_frame_carries_the_measurement_to_every_connection() {
        let world = world();
        let listener = world.join();
        world.attach(A_LOG);
        let generation = generation(&world);
        // Drain the attach announcement.
        let _bump = listener.inbox.recv().expect("the bump");

        assert!(world.report_progress(generation, mark(1571, 62.4)));
        loop {
            let EngineMessage::EpochMessage(frame) = listener.inbox.recv().expect("a frame") else {
                panic!("progress rides an epoch message");
            };
            if matches!(frame.reason, EpochReason::Attach) {
                continue;
            }
            assert!(matches!(frame.reason, EpochReason::Progress));
            let progress = frame.progress.expect("a progress frame carries progress");
            assert!((progress.pct - 62.4).abs() < f64::EPSILON);
            assert_eq!(progress.events, 1571);
            break;
        }
        assert_eq!(world.mark().events, 1571);
        assert_eq!(world.mark().checkpoint, 4096);
    }

    #[test]
    fn a_landing_fold_resets_every_open_subscription_and_goes_live() {
        let world = world();
        let listener = world.join();
        let bystander = world.join();
        world.open_subscription(listener.id, 7);
        world.open_subscription(listener.id, 9);
        world.attach(A_LOG);
        let generation = generation(&world);

        assert!(world.report_fold_landed(generation, mark(3, 100.0)));
        assert!(matches!(world.health().status, HealthResultStatus::Live));

        let mut reset_ids = Vec::new();
        while let Ok(message) = listener.inbox.try_recv() {
            if let EngineMessage::ResetMessage(reset) = message {
                assert_eq!(*reset.epoch, 2, "a reset names the generation that landed");
                assert!(reset.rows.is_empty());
                assert_eq!(reset.total, 0);
                reset_ids.push(*reset.id);
            }
        }
        assert_eq!(reset_ids, vec![7, 9]);

        // A connection with no subscriptions is told about the epoch and nothing else.
        let mut bystander_resets = 0;
        while let Ok(message) = bystander.inbox.try_recv() {
            if matches!(message, EngineMessage::ResetMessage(_)) {
                bystander_resets += 1;
            }
        }
        assert_eq!(bystander_resets, 0);
    }

    #[test]
    fn a_subscription_belongs_to_its_own_connection() {
        let world = world();
        let mine = world.join();
        let theirs = world.join();
        world.open_subscription(mine.id, 7);

        assert!(!world.close_subscription(theirs.id, 7));
        assert!(world.close_subscription(mine.id, 7));
        assert!(!world.close_subscription(mine.id, 7));
    }

    #[test]
    fn an_ingest_that_ends_leaves_the_world_idle_with_its_generation_intact() {
        let world = world();
        world.attach(A_LOG);
        let generation = generation(&world);
        assert!(world.report_idle(generation));
        assert!(matches!(world.health().status, HealthResultStatus::Idle));
        assert_eq!(*world.health().epoch, 2, "a dead fold bumps nothing");
    }
}
