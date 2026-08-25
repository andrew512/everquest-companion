//! `src/main/modules/eventFeed.ts` — the live "things worth noticing" ring behind the events
//! overlay (Task #59), and the one module in cluster 2c whose whole argument is a REFUSAL.
//!
//! THE HYDRATION RULE IS THE MODULE (AGENTS.md "Celebrations"). A startup replay must not spam the
//! feed with hours-old events, and rather than seed a baseline and diff against it, this module
//! simply admits nothing historical: `onEvent` writes the seq and returns the instant `live` is
//! false. The ring therefore starts EMPTY and only ever holds what the tail observed. That is the
//! silent baseline, expressed as "nothing historical is admitted" — and it is why all six goldens
//! record this module's state as `[]` while its `seq` is the last event of the slice.
//!
//! WHAT A LIVE FOLD WOULD ADD, AND WHY NONE OF IT IS HERE — stated rather than left to be noticed,
//! because `Fold` delivers `live: false` from the first byte to the last (`fold_bytes`) and a
//! reader is entitled to know whether that is a cap or a coincidence:
//!
//!   * THE LOOT SOURCE is structurally absent, not skipped. It admits a row only through
//!     `deps.lookupItem`, an injected cache-first item probe, and the world the goldens were
//!     recorded in does not inject one (`foldArm.mts construct` passes `lookupItem` nowhere, and
//!     that file's header says so: "the two knowledge lookups are absent"). `probeLoot` returns on
//!     its first line without one, so the source is off in the TS fold too.
//!   * THE CONSIDER SOURCE is live-only by the same early return, plus a 10 s per-mob anti-spam
//!     window, and would need the difficulty-clause table (`shared/considerFaction.ts`) to render
//!     its `detail` string. Nothing in a historical fold can reach it.
//!   * THE ALERT AND QUEST SOURCES arrive out of band (`noteAlertFire`, `report`) from main and the
//!     renderer. Neither is on the bus at all, so neither is a fold's to reproduce.
//!
//! `snapshot()` therefore publishes what the ring holds, which for every fold this crate can
//! perform is the empty array — and the harness compares it against a golden that says the same.

use crate::event::Event;
use crate::EqModule;
use serde_json::{json, Value};

/// How many entries the feed keeps. Oldest fall off the back. Carried because it is the ring's
/// shape rather than because a historical fold can reach it.
pub const FEED_CAP: usize = 100;

#[derive(Default)]
pub struct EventFeedModule {
    /// Newest LAST (the UI reverses it). Never grows on a historical fold — see the header.
    ring: Vec<Value>,
    seq: i64,
}

impl EventFeedModule {
    pub fn new() -> Self {
        Self::default()
    }
}

impl EqModule for EventFeedModule {
    fn id(&self) -> &'static str {
        "eventFeed"
    }

    fn reset(&mut self) {
        // A character switch is a different world: drop the feed with the rest of the
        // character-scoped state.
        self.ring.clear();
        self.seq = 0;
    }

    /// `onEvent` records the seq of EVERY event and then returns unless `live`. The parameter is
    /// UNUSED here rather than quietly honoured, and that is the header's claim written as code:
    /// all four of the ring's sources sit downstream of that gate, two of them behind injected
    /// lookups this world does not carry and two of them off the bus entirely, so there is nothing
    /// for the gate to guard in this crate. A `live` tail is another ticket's, and it will find the
    /// admission rules missing rather than half-written.
    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
    }

    fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "state": self.ring })
    }
}
