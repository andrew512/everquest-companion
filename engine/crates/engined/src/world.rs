//! THE ONE DOOR. Every piece of state this process holds lives behind [`World`], and every reader —
//! including the engine's own — asks for it by calling a method.
//!
//! WHY A SKELETON THAT HOLDS ALMOST NOTHING IS SHAPED THIS WAY. Owner ruling 18 (docs/plans/
//! data-server.md, "Cache transparency"): the destination is an engine that parses any given log
//! byte once, ever, with a cache under the store seam so transparent that even the engine's own
//! internal callers cannot tell cached from computed. Nothing is cached now and nothing may be —
//! but the interface laws that keep that door open are cheapest to obey while there is nothing
//! behind it, and impossible to retrofit once twenty modules have reached into each other's fields.
//! The four that bind this file:
//!
//! * **Reads go through one door** (law 2). There is no `pub` field here and no way to borrow the
//!   state. A caller asks [`World::health`] a question and gets an answer; whether that answer was
//!   computed just now or lifted from a checkpoint is not a distinction the caller can make.
//! * **State is addressed explicitly** (law 3). Nothing here means "current" implicitly. The
//!   epoch is the world's generation and it is stated on every answer that depends on it. When the
//!   tailer lands, the coordinate this state is keyed by becomes (log identity, byte offset) — and
//!   `attach` is where that coordinate will be recorded. It records NOTHING today, because a
//!   skeleton with no tailer that remembered a path would be state nobody reads, and state nobody
//!   reads is state that rots.
//! * **Determinism is cacheability** (law 1). The one clock read in this file is `uptimeMs`, and
//!   it is a property of the PROCESS rather than of the world: it is derived from the start
//!   instant, never from anything the fold will one day compute. No world state may ever be a
//!   function of the wall clock.
//! * **A cache invalidates by version, never by patching** (law 5). Which is the same statement as
//!   the epoch: a new generation is a new world, and the only way to move between generations is to
//!   take the fresh reset. There is no incremental repair here and there never will be.
//!
//! THE EPOCH AND ITS ANNOUNCEMENT ARE ONE CRITICAL SECTION. `attach` bumps the generation and
//! pushes the [`EpochMessage`] to every connection while still holding the lock, so no two attaches
//! can interleave their announcements and no connection can ever be told about generation N+1
//! before generation N. That is not a performance decision — the lock is held for the length of a
//! few `Sender::send` calls into unbounded queues — it is the ordering the client's drop-and-reset
//! rule depends on.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use protocol::generated::{
    AttachResult, EngineMessage, Epoch, EpochMessage, EpochMessageKind, EpochReason, HealthResult,
    HealthResultStatus,
};

/// The generation a fresh process starts in.
///
/// One, not zero: there is always a world, even when it is an empty one, and an epoch of zero would
/// read as "no world yet" to anybody skimming a log. A launch is generation 1 and the first attach
/// makes it 2.
const FIRST_EPOCH: i64 = 1;

/// A handle on the process's whole state. Cheap to clone; every clone is the same world.
#[derive(Clone)]
pub struct World {
    inner: Arc<Inner>,
}

struct Inner {
    /// When this process started. See the header: process metadata, never world state.
    started: Instant,
    state: Mutex<State>,
}

struct State {
    epoch: i64,
    /// Every open connection's outbox. Connection-wide messages — today only [`EpochMessage`] — are
    /// pushed here under the same lock that owns the epoch.
    listeners: Vec<Listener>,
    /// The next listener id. Monotonic, never reused, so a stale id can never name a live
    /// connection.
    next_listener: u64,
}

struct Listener {
    id: ListenerId,
    outbox: Sender<EngineMessage>,
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
    /// A fresh world. A respawn is a launch (owner ruling 10), so this is the only way one is ever
    /// made and there is no state to restore.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                started: Instant::now(),
                state: Mutex::new(State {
                    epoch: FIRST_EPOCH,
                    listeners: Vec::new(),
                    next_listener: 0,
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
        });
        Membership { id, outbox, inbox }
    }

    /// Deregister a connection. Idempotent: leaving twice is not an error, because a connection can
    /// end in more than one way and the tidy-up path must not care which.
    pub fn leave(&self, id: ListenerId) {
        self.lock().listeners.retain(|l| l.id != id);
    }

    /// The world's generation, right now.
    ///
    /// A CAVEAT THE NEXT PHASE MUST CLOSE. A caller that reads this and then builds a message from
    /// it is racing an attach on another connection: the bump can land between the read and the
    /// push, so a subscription's opening reset could name a generation that has already been
    /// superseded. Phase 0 gets away with it because its resets carry no rows and there is no fold
    /// to send a fresh one — but when views arrive, creating a subscription and stamping its reset
    /// must happen inside this lock, exactly as the bump and its announcement already do.
    #[must_use]
    pub fn epoch(&self) -> Epoch {
        Epoch(self.lock().epoch)
    }

    /// Answer `session.health`.
    ///
    /// THE STATUS IS ALWAYS `idle` IN PHASE 0, and that is a statement rather than a stub: the
    /// other four — `starting`, `attaching`, `folding`, `live` — describe a fold, and there is no
    /// fold in this crate to be in the middle of. An engine that reported `live` here would be
    /// lying to a loading screen.
    #[must_use]
    pub fn health(&self) -> HealthResult {
        let epoch = Epoch(self.lock().epoch);
        HealthResult {
            status: HealthResultStatus::Idle,
            epoch,
            uptime_ms: i64::try_from(self.inner.started.elapsed().as_millis()).unwrap_or(i64::MAX),
        }
    }

    /// Answer `session.attach` — A STUB, AND HERE IS EXACTLY WHAT IT DOES AND DOES NOT DO.
    ///
    /// DOES: bump the generation, announce the bump to every open connection as an
    /// [`EpochMessage`] with reason `attach`, and report the new epoch to the caller as accepted.
    ///
    /// DOES NOT: open a file, read a byte, start a tail, or fold anything. The request's `logPath`
    /// is not even looked at — see the header on why nothing records it yet.
    ///
    /// `accepted` IS ALWAYS TRUE HERE, and the reason it is a field at all matters for phase 1: an
    /// attach PREEMPTS any in-flight attach (last pick wins, never queued — JOS-457's generation
    /// ownership promoted to protocol law), so the caller whose attach lost reports `false` and the
    /// epoch names the winner. Nothing can lose to anything in a stub that completes inside the
    /// lock, so every attach here wins.
    ///
    /// NO `progress` RIDES THE ANNOUNCEMENT. The schema says [`protocol::generated::FoldProgress`]
    /// is present while a fold is running and on the bump that starts one; this bump starts no
    /// fold, so claiming a percentage would be inventing a measurement.
    pub fn attach(&self) -> AttachResult {
        let mut state = self.lock();
        state.epoch += 1;
        let epoch = Epoch(state.epoch);
        let announcement = EngineMessage::EpochMessage(EpochMessage {
            kind: EpochMessageKind::Epoch,
            epoch: Epoch(state.epoch),
            reason: EpochReason::Attach,
            progress: None,
        });
        broadcast(&mut state, &announcement);
        AttachResult {
            epoch,
            accepted: true,
        }
    }

    /// Take the lock, surviving a poisoned one.
    ///
    /// A POISONED MUTEX MUST NOT END THE ENGINE. Poisoning means some connection thread panicked
    /// while holding this lock; the state it guards is an integer and a list of channel senders,
    /// neither of which a panic can leave torn. Propagating the panic would turn one bad connection
    /// into a dead engine for every other renderer, which is precisely the blast radius this
    /// process boundary exists to shrink.
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
    use super::World;
    use protocol::generated::{EngineMessage, EpochReason, HealthResultStatus};

    #[test]
    fn a_fresh_world_is_idle_in_the_first_generation() {
        let world = World::new();
        let health = world.health();
        assert!(matches!(health.status, HealthResultStatus::Idle));
        assert_eq!(*health.epoch, 1);
    }

    #[test]
    fn an_attach_bumps_the_generation_and_tells_everyone() {
        let world = World::new();
        let one = world.join();
        let two = world.join();

        let result = world.attach();
        assert!(result.accepted);
        assert_eq!(*result.epoch, 2);

        for membership in [&one, &two] {
            let message = membership.inbox.try_recv().expect("an announcement");
            let EngineMessage::EpochMessage(epoch) = message else {
                panic!("a connection-wide announcement is an epoch message");
            };
            assert_eq!(*epoch.epoch, 2);
            assert!(matches!(epoch.reason, EpochReason::Attach));
            assert!(
                epoch.progress.is_none(),
                "a bump that starts no fold claims no progress"
            );
        }
    }

    #[test]
    fn a_connection_that_left_hears_nothing_further() {
        let world = World::new();
        let stayed = world.join();
        let left = world.join();
        world.leave(left.id);

        world.attach();

        assert!(stayed.inbox.try_recv().is_ok());
        assert!(left.inbox.try_recv().is_err());
    }

    #[test]
    fn the_generation_is_process_global_and_monotonic() {
        let world = World::new();
        let mirror = world.clone();
        assert_eq!(*world.attach().epoch, 2);
        assert_eq!(*mirror.attach().epoch, 3);
        assert_eq!(*world.epoch(), 3);
        assert_eq!(*mirror.health().epoch, 3);
    }
}
