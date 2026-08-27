//! WHICH MODULES ANNOUNCE, AND ON WHAT (JOS-509) — the under-announce proof, per module.
//!
//! The ticket's own hazard: over-announcing on a real subset is honest, under-announcing loses UI
//! updates and is the one failure direction not allowed. A test that only checked the silence half
//! would be satisfied by a module that never announces at all, so every module migrated here gets
//! BOTH claims — one representative mutating event per arm family MOVES its cursor, and a line that
//! is none of its business does not.
//!
//! THE INSTRUMENT IS `Registry::published_seqs`, which is exactly what `Serving::changed_modules`
//! reads on the serve beat (`engined::ingest`). So what this file asserts is not a proxy for the
//! dirty bit — it is the dirty bit, asked one event at a time instead of ten times a second.
//!
//! THE INPUT IS JSON EVENTS rather than log lines, `fold`'s own test vocabulary: a claim about what
//! ONE arm does needs an event whose every field is known. The engined suite makes the same claim
//! from the other end, over a real socket with real EQ lines — `tests/live_surfaces.rs`.

use fold::event::Event;
use fold::{registered, ClusterDeps, Fold};
use std::collections::BTreeMap;

/// A fold, one event at a time, reporting who announced.
struct Probe {
    fold: Fold,
    seen: BTreeMap<&'static str, i64>,
}

impl Probe {
    fn new() -> Self {
        // `launch_ms` at i64::MAX is the fold suite's own construction: no line is after the launch
        // anchor, so the epoch detector synthesizes nothing and every announce in this file is the
        // work of the event named beside it.
        let mut p = Probe {
            fold: Fold::new(registered(ClusterDeps::default()), i64::MAX),
            seen: BTreeMap::new(),
        };
        // The construction's own cursors are not this file's subject — take them once so the first
        // asserted line reports only itself.
        p.moved();
        p
    }

    /// Fold one event and answer with the ids whose announce cursor moved — `changed_modules`.
    fn fold(&mut self, line: &str) -> Vec<&'static str> {
        let ev = Event::from_json(line).expect("a JSON event");
        self.fold.on_primary(&ev, true);
        self.moved()
    }

    /// The wall-clock heartbeat, for the modules whose published state ages without a line.
    #[allow(dead_code, reason = "used by the modules migrated in later commits")]
    fn tick(&mut self, now_ms: i64) -> Vec<&'static str> {
        self.fold.tick(now_ms);
        self.moved()
    }

    fn moved(&mut self) -> Vec<&'static str> {
        let mut out = Vec::new();
        for (id, seq) in self.fold.registry.published_seqs() {
            if self.seen.insert(id, seq) != Some(seq) {
                out.push(id);
            }
        }
        out.sort_unstable();
        out
    }
}

/// Every module this ticket migrated, so a claim about "nothing else moved" is a claim about a
/// NAMED set rather than about whatever happened to be registered.
const MIGRATED: [&str; 15] = [
    "alerts",
    "buffs",
    "classUnlocks",
    "consider",
    "eventFeed",
    "itemTiers",
    "kills",
    "leveling",
    "loot",
    "observedSpellRanks",
    "outputFiles",
    "progression",
    "roster",
    "spellSets",
    "turnins",
];

/// Assert exactly which of the migrated modules announced. Modules OUTSIDE `MIGRATED` are ignored:
/// the four JOS-87 revision modules and `resist` are not this ticket's subject, and a test that
/// pinned them would fail for a reason that has nothing to do with what it is checking.
#[track_caller]
fn announced(moved: &[&'static str], want: &[&str]) {
    let mut got: Vec<&str> = moved
        .iter()
        .copied()
        .filter(|id| MIGRATED.contains(id))
        .collect();
    got.sort_unstable();
    let mut want: Vec<&str> = want.to_vec();
    want.sort_unstable();
    assert_eq!(got, want);
}

// ── the lines ───────────────────────────────────────────────────────────────────────────────────

/// A PURE MELEE ROUND — the busiest thing a log does and the thing every module was announcing on.
/// None of the fifteen has anything to say about it except the ones that watch combat.
const MELEE_HIT: &str = r#"{"kind":"damage","seq":10,"ts":10000,"raw":"h","source":"Primitive","target":"a fire giant","amount":42,"dtype":"melee","skill":"slash"}"#;
const MELEE_MISS: &str = r#"{"kind":"miss","seq":11,"ts":10500,"raw":"m","source":"a fire giant","target":"Primitive","skill":"kick"}"#;

/// WHAT STILL SHOUTS AT A MELEE ROUND — the ticket's own ratchet, and it only shrinks.
///
/// Every name here is a module still stamping `self.seq = ev.seq()` at the top of `on_event` and
/// publishing it, so it announces on a line it has nothing to say about. A module's migration
/// commit DELETES its name from this list, and the list is what makes each of those commits prove
/// something rather than assert it: the melee round is folded, and whoever is left is named.
///
/// `eventFeed` IS NOT AN OFFENDER AND STAYS. It is a live ring of the last N events and a melee hit
/// really does change what it publishes — the honest answer for that module is that it moved.
const STILL_LOUD: [&str; 14] = [
    "alerts",
    "buffs",
    "classUnlocks",
    "consider",
    "eventFeed",
    "itemTiers",
    "kills",
    "leveling",
    "observedSpellRanks",
    "outputFiles",
    "progression",
    "roster",
    "spellSets",
    "turnins",
];

#[test]
fn a_melee_round_moves_nothing_that_does_not_watch_combat() {
    let mut p = Probe::new();
    let first = p.fold(MELEE_HIT);
    announced(&first, &STILL_LOUD);
    let second = p.fold(MELEE_MISS);
    announced(&second, &STILL_LOUD);
}

#[test]
fn loot_announces_on_the_line_that_moves_its_ledger_and_on_nothing_else() {
    let mut p = Probe::new();
    // A ZONE LINE IS THE MODULE'S OWN BOOKKEEPING. It decides what label the NEXT row carries and
    // changes not one byte of the published ledger.
    let zoned = p.fold(
        r#"{"kind":"zone","seq":1,"ts":1000,"raw":"z","zone":"Nagafen's Lair"}"#,
    );
    assert!(!zoned.contains(&"loot"), "a zone line is not a ledger change");
    // The row.
    let looted = p.fold(
        r#"{"kind":"loot","seq":2,"ts":2000,"raw":"l","item":"Bone Chips","source":"a corpse"}"#,
    );
    assert!(looted.contains(&"loot"));
    // …and a line that is nobody's loot leaves it exactly where it was.
    let after = p.fold(MELEE_HIT);
    assert!(!after.contains(&"loot"));
    // THE EPOCH ARM IS A CHANGE. Clearing the ledger is the change a panel most needs to hear
    // about, and a module that announced only on growth would leave a dead character's rows up.
    let reborn = p.fold(r#"{"kind":"epoch","seq":3,"ts":3000,"raw":"e"}"#);
    assert!(reborn.contains(&"loot"));
}
