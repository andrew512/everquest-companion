//! ============================================================================
//! fold — THE MODULE FOLD, IN RUST (JOS-459 phase 2; cluster 2a is JOS-471).
//! ============================================================================
//!
//! `eqlog` turns bytes into the canonical event stream. This crate is what CONSUMES that stream:
//! the `EqModule` contract (`src/main/modules/types.ts`), a registry that preserves WIRING ORDER
//! (`src/main/modules/wiring.ts`), and one ported module per file under `modules/`.
//!
//! THE BAR IS DEEP EQUALITY, not byte identity — and the difference from phase 1 is a real one.
//! `goldenOracle.mts` records each module's published snapshot into `<slice>.snapshots.json` and
//! compares it with `firstDiff`, because "a snapshot is assembled on demand out of maps and view
//! builders, so key ORDER is not a claim the engine makes". What IS a claim is every ARRAY's order,
//! every number, and which keys exist at all — a field the TS wrote as `undefined` is ABSENT from
//! the golden, so a Rust module that writes `null` there has diverged.
//!
//! ── THE DELIVERY MODEL, and why it is three lines rather than a bus ─────────────────────────────
//!
//! Over there the bus delivers each PRIMARY event to every listener in registration order — the
//! twenty modules first, then the combat engine, then the epoch and offline-gap detectors — and any
//! DERIVED event a listener synthesized is QUEUED and drained afterwards, through the same loop
//! (`main/log/bus.ts`). `Fold` reproduces exactly that shape: dispatch, observe, drain. There is no
//! `LogBus` type here because with one producer of derived events and no re-entrancy there is
//! nothing for one to own; when 2c brings the buffs module (which derives `buffExpired` while
//! folding) the queue is already the field it needs.
//!
//! ── CACHE TRANSPARENCY (ruling 18) ─────────────────────────────────────────────────────────────
//!
//! NO MODULE HERE READS A WALL CLOCK, EVER. The one time-based rule in the cluster (spellSets'
//! settle window) advances off LOG TIMESTAMPS during a fold; `on_tick` exists on the trait for the
//! live tail and is never called by `Fold`. All state lives behind the registry door — there are no
//! statics, no lazily-populated caches keyed by anything but a fold's own inputs, and nothing
//! outlives a `Fold`. `eqlog`'s `OnceLock` regexes are compile-once CONSTANTS, not memoized answers.
//!
//! ── PHASE 3 IS NOT BUILT, BUT IT IS SHAPED ─────────────────────────────────────────────────────
//!
//! `flush_delta` is declared with a default of `None` and no module implements it. Deltas are the
//! transport ticket, not this one; declaring the method now is what makes "add deltas" an edit to
//! nine files rather than a change to the contract every later cluster will have been written
//! against.

pub mod combat;
pub mod epoch;
pub mod event;
pub mod jsfn;
pub mod jsmap;
pub mod modules;
pub mod session;

use event::Event;
use serde_json::{json, Value};
use std::collections::HashSet;

/// The extension contract — `src/main/modules/types.ts EqModule`.
pub trait EqModule {
    /// Stable id, matching the TS module's `id` exactly (it is the golden's join key).
    fn id(&self) -> &'static str;

    /// Called on character (re)load, before the historical replay begins.
    fn reset(&mut self);

    /// Fold one event. `live` gates nothing here — the registry gates the push (JOS-60).
    fn on_event(&mut self, ev: &Event, live: bool);

    /// Optional wall-clock heartbeat, ~1x/sec on the LIVE tail only. A historical fold never calls
    /// it, which is what lets every module here keep the cache-transparency promise above.
    fn on_tick(&mut self, _now_ms: i64) {}

    /// Full current state for hydration, plus the last seq folded in: `{ "seq": n, "state": … }`.
    fn snapshot(&self) -> Value;

    /// Everything since the last flush, or `None`. PHASE 3 — see the header. Nothing calls it yet
    /// and no module overrides it; it is here so the contract does not have to change later.
    fn flush_delta(&mut self) -> Option<Value> {
        None
    }

    /// THE GROUP-ROSTER PULL SEAM (JOS-477 / cluster 2b's `roster` module).
    ///
    /// `pipeline.ts` wires `combat.setRoster(modules.roster)` — the combat engine does not FOLD the
    /// roster, it ASKS the module for it, and it asks DURING the same delivery, after the module
    /// has already advanced for the line (`engine.ts:215`, and `state.ts rosterProvider`'s note
    /// about why a pull rather than a stored copy). Over here the registry has already dispatched
    /// by the time `Fold` hands the event to the engine, so the same guarantee holds for free.
    ///
    /// A DEFAULTED METHOD RATHER THAN A DOWNCAST, so that the one module which can answer it
    /// implements one method and every other module says nothing. Defaulted to `None`, which is
    /// exactly `EMPTY_ROSTER` / `EMPTY_ROSTER_VIEW` at the reading end — an engine constructed
    /// without the seam behaves as it did before the group model existed.
    fn as_roster(&self) -> Option<&dyn combat::RosterSource> {
        None
    }
}

/// REGISTRATION ORDER = BUS DELIVERY ORDER, and it is load-bearing — `src/main/modules/wiring.ts`
/// `ordered`, verbatim, all twenty.
///
/// It is spelled here IN FULL rather than as "the ones we have ported", so that the set this crate
/// does not implement yet is a fact the code states rather than a gap a reader has to notice. The
/// parity harness reads `missing()` off it and prints every absent module BY NAME (the no-silent-
/// caps law): a comparator that quietly compared nine modules and said GREEN would be claiming
/// coverage it does not have.
pub const WIRING_ORDER: &[&str] = &[
    "combo",
    "roster",
    "loot",
    "turnins",
    "classUnlocks",
    "kills",
    "respawn",
    "progression",
    "leveling",
    "character",
    "outputFiles",
    "spellSets",
    "itemTiers",
    "observedSpellRanks",
    "alerts",
    "buffs",
    "buffTimers",
    "consider",
    "resist",
    "eventFeed",
];

/// The registered modules, in delivery order, and the dispatch loop over them.
#[derive(Default)]
pub struct Registry {
    mods: Vec<Box<dyn EqModule>>,
}

impl Registry {
    pub fn new() -> Self {
        Registry { mods: Vec::new() }
    }

    /// Register in delivery order. It is the CALLER's job to register in `WIRING_ORDER` — see
    /// `cluster_2a`, which is the one caller that matters and which asserts it.
    pub fn register(&mut self, m: Box<dyn EqModule>) {
        self.mods.push(m);
    }

    pub fn reset(&mut self) {
        for m in &mut self.mods {
            m.reset();
        }
    }

    /// Deliver one event to every module, in order.
    pub fn dispatch(&mut self, ev: &Event, live: bool) {
        for m in &mut self.mods {
            m.on_event(ev, live);
        }
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.mods.iter().map(|m| m.id()).collect()
    }

    /// The registered module that answers the roster pull, or `None` when none does (2b has not
    /// landed, or this build registered a cluster without it). One linear scan over at most twenty
    /// modules, made once per delivery — the TS's `rosterProvider` closure costs a call too.
    pub fn roster(&self) -> Option<&dyn combat::RosterSource> {
        self.mods.iter().find_map(|m| m.as_roster())
    }

    /// Every id `WIRING_ORDER` names that nothing registered — the harness's SKIPPED list.
    pub fn missing(&self) -> Vec<&'static str> {
        let have: HashSet<&str> = self.ids().into_iter().collect();
        WIRING_ORDER
            .iter()
            .copied()
            .filter(|id| !have.contains(id))
            .collect()
    }

    /// `{ "modules": [ { "id": …, "snapshot": { "seq": …, "state": … } }, … ] }` — the same shape
    /// the golden's `modules` array carries, in delivery order, so the comparator joins on `id`
    /// and compares `snapshot` whole.
    pub fn snapshots(&self) -> Value {
        json!({
            "modules": self.mods.iter().map(|m| json!({
                "id": m.id(),
                "snapshot": m.snapshot(),
            })).collect::<Vec<_>>(),
            "skipped": self.missing(),
        })
    }
}

/// The registry plus the derived-event producers that sit beside it on the bus.
pub struct Fold {
    pub registry: Registry,
    /// THE POST-REGISTRY SUBSCRIBER (JOS-477). `pipeline.ts:311,326` and `foldArm.mts construct()`
    /// both subscribe the combat engine to the bus AFTER `registry.attach(bus)` and BEFORE the
    /// epoch/offline-gap detectors, and that position is load-bearing in two directions: the
    /// twenty modules have all folded the line before the engine sees it (which is what makes the
    /// roster PULL answer for the same line), and the engine's own work happens before any derived
    /// event the detectors synthesize off it.
    ///
    /// AN `Option` FIELD RATHER THAN A LISTENER VECTOR, because the engine is not only dispatched
    /// to — it is READ BACK, exactly as `foldArm.mts`'s `World { bus, combat, registry }` hands the
    /// engine out so its snapshots can be taken. A `Vec<Box<dyn …>>` would deliver the events and
    /// then have nothing to hand the recorder. `None` on every 2a/2b/2c call site, and `None` means
    /// the fold behaves precisely as it did before this field existed.
    pub combat: Option<combat::CombatEngine>,
    epoch: epoch::EpochDetector,
    /// The OFFLINE-GAP detector (JOS-475). `index.ts` subscribes it after the epoch detector and it
    /// hands its gap back through the same `emitDerived`, so it is queued in that order here too.
    /// Cluster 2b needs it: `progression` publishes every gap's contents verbatim in three columns
    /// and `roster` marks members stale across one — see `session.rs` for the argument and the
    /// counts. `buffExpired` is still 2c's.
    sessions: session::SessionDetector,
    /// The bus's derived queue. Two producers today; 2c adds `buffExpired` beside them.
    derived: Vec<Event>,
    events: u64,
    last_ts: i64,
}

impl Fold {
    pub fn new(registry: Registry, launch_ms: i64) -> Self {
        let mut f = Fold {
            registry,
            combat: None,
            epoch: epoch::EpochDetector::new(launch_ms),
            sessions: session::SessionDetector::new(),
            derived: Vec::new(),
            events: 0,
            last_ts: 0,
        };
        f.reset();
        f
    }

    /// Subscribe the combat engine behind the registry (see the field). Builder-shaped so the
    /// existing `Fold::new` call sites do not move — the parallel-worker fence.
    pub fn with_combat(mut self, engine: combat::CombatEngine) -> Self {
        // ONLY the engine it just installed. `Fold::new` has already reset the world, and a SECOND
        // `registry.reset()` is a call no composition root makes — `foldArm.mts construct` resets
        // the registry once and the engine once.
        //
        // MEASURED, JOS-475: it was invisible while every module's `reset()` was idempotent, and it
        // is not once a module's REVISION COUNTER is published as its `seq`. Cluster 2b has three
        // (combo, character, respawn — the JOS-87 rule), and the double reset put every one of them
        // exactly ONE ahead of the golden on all six slices. Resetting only the new field is both
        // the fix and what the builder was always describing.
        self.combat = Some(engine);
        if let Some(c) = &mut self.combat {
            c.reset();
        }
        self
    }

    pub fn reset(&mut self) {
        self.registry.reset();
        if let Some(c) = &mut self.combat {
            c.reset();
        }
        self.epoch.reset();
        self.sessions.reset();
        self.derived.clear();
        self.events = 0;
        self.last_ts = 0;
    }

    /// How many PRIMARY events were folded — `ScanResult.seq`.
    pub fn events(&self) -> u64 {
        self.events
    }

    /// THE HIGHEST TIMESTAMP ANY EVENT CARRIED — `goldenOracle.mts`'s `lastTs`, which is the
    /// instant the combat snapshot is taken at. Accumulated with `max` rather than "the last one",
    /// exactly as the recorder's bus listener does (`if (ev.ts > lastTs) lastTs = ev.ts`): the
    /// stream is not guaranteed monotonic across a log rollover, and the snapshot's `now` must not
    /// be able to travel backwards because one line did.
    pub fn last_ts(&self) -> i64 {
        self.last_ts
    }

    /// One primary event: dispatch to the modules, let the detectors observe it, then drain
    /// whatever they queued through the SAME dispatch loop. That is `LogBus.emit` exactly.
    pub fn on_primary(&mut self, ev: &Event, live: bool) {
        self.events += 1;
        self.last_ts = self.last_ts.max(ev.ts());
        self.registry.dispatch(ev, live);
        // …then the engine, which is the next subscriber on the bus (see the `combat` field). The
        // two field borrows are disjoint, which is what lets the engine pull the roster out of the
        // registry that has just finished folding this same line.
        if let Some(c) = &mut self.combat {
            c.on_event(ev, live, self.registry.roster());
        }
        if let Some(derived) = self.epoch.observe(ev) {
            self.derived.push(derived);
        }
        if let Some(gap) = self.sessions.observe(ev) {
            self.derived.push(gap);
        }
        // Shift-until-empty, so anything a derived event queues in turn is delivered too.
        let mut i = 0;
        while i < self.derived.len() {
            let d = self.derived[i].clone();
            i += 1;
            self.registry.dispatch(&d, live);
            // A DERIVED EVENT REACHES THE ENGINE TOO. `LogBus.emit` drains through the same
            // listener loop, and the engine is one of those listeners — `epoch` is a kind
            // `ingest.ts:182` handles by name (it drops the fight, the zone and the world), so
            // delivering it to the modules alone would leave the engine holding a dead
            // character's encounter.
            if let Some(c) = &mut self.combat {
                c.on_event(&d, live, self.registry.roster());
            }
        }
        self.derived.clear();
    }

    /// Fold a complete log through `eqlog::scan`. Historical, so `live` is false from the first
    /// byte to the last — exactly what a startup replay is.
    ///
    /// STREAMED, never collected. A slice folds to hundreds of thousands of events and holding
    /// them as parsed values at once costs more than the machine has — `goldenOracle.mts`'s rule
    /// about its own artifacts, and it applies just as hard to the fold's input.
    pub fn fold_bytes(&mut self, parser: &eqlog::Parser, bytes: &[u8]) {
        eqlog::scan::scan_bytes(parser, bytes, |line| {
            if let Some(ev) = Event::from_json(line) {
                self.on_primary(&ev, false);
            }
        });
    }
}

/// EVERYTHING THE CLUSTER NEEDS FROM OUTSIDE ITSELF — `wiring.ts ModuleWiringDeps`, minus the
/// seams no ported module has yet.
///
/// It is a STRUCT rather than a parameter list because it is the thing later clusters grow: 2c and
/// 2d each bring modules with their own construction inputs, and a struct means they add a FIELD
/// and a registration line instead of re-threading every call site.
///
/// Every field is a fact about the RUN rather than about the log's bytes, which is what makes it a
/// parameter at all — and each of them is derived by the caller exactly as `foldArm.mts` /
/// `goldenOracle.mts` derive it, because the goldens were recorded under those derivations.
#[derive(Default)]
pub struct ClusterDeps {
    /// `wiring.ts` `knownSpell: (key) => spellDb.byKey.has(key)`, passed as the key SET rather than
    /// as a closure so nothing in this crate borrows the parser.
    pub known_spell: HashSet<String>,
    /// `spellClasses.ts`'s canon-key → class-set index, built once off the same DB (evidence.rs).
    pub spell_classes: modules::combo::evidence::SpellClassIndex,
    /// `epochDetector.ts LAUNCH_MS`, resolved through the fold's own zone.
    pub launch_ms: i64,
    /// `WorldOpts.constructionNowMs` — the PINNED construction clock the respawn module seeds its
    /// ordering clock from. See `modules/respawn.rs`'s header for why it cannot be a wall clock.
    pub construction_now_ms: i64,
    /// The `CharacterRef` `index.ts` pushes in with `setCharacter`, derived from the log's filename.
    pub character: Option<Value>,
    /// `roster.setSelfName` — `session.ts`'s line. THE BENCH DOES NOT CALL IT, so the parity runner
    /// passes `None` and the recorded goldens are what that produces (roster.rs's header).
    pub self_name: Option<String>,
    /// `deps.respawnPrefs` — the shipped default is an EMPTY watch list and that is what every
    /// non-Electron caller passes.
    pub respawn_prefs: modules::respawn::RespawnPrefs,
}

/// CLUSTERS 2a + 2b, registered in `WIRING_ORDER`'s relative order.
///
/// The name says which clusters are IN it rather than which are missing, and `Registry::missing()`
/// says the rest — a reader of one line then knows both halves.
pub fn cluster_2a_2b(deps: ClusterDeps) -> Registry {
    let ClusterDeps {
        known_spell,
        spell_classes,
        launch_ms,
        construction_now_ms,
        character,
        self_name,
        respawn_prefs,
    } = deps;
    let mut r = Registry::new();
    // combo goes FIRST (design § 5.1): within one bus delivery every later module — and the combat
    // engine, which folds the same event afterwards — then sees an already-advanced combo state.
    r.register(Box::new(modules::combo::ComboModule::new(
        spell_classes,
        launch_ms,
    )));
    // roster goes SECOND for the same reason: the engine's admission gate pulls the roster through
    // a seam installed before it ever folds a line, so the roster must already be advanced.
    r.register(Box::new(modules::roster::RosterModule::new(
        self_name.as_deref(),
    )));
    r.register(Box::new(modules::loot::LootModule::new()));
    r.register(Box::new(modules::turnins::TurnInsModule::new()));
    r.register(Box::new(modules::class_unlocks::ClassUnlocksModule::new()));
    r.register(Box::new(modules::kills::KillsModule::new()));
    // Beside `kills` because it folds the SAME death line — and AFTER it, so anything reading both
    // within one delivery sees the kill counted before the clock that kill started.
    r.register(Box::new(modules::respawn::RespawnModule::new(
        construction_now_ms,
        respawn_prefs,
    )));
    r.register(Box::new(modules::progression::ProgressionModule::new()));
    r.register(Box::new(modules::leveling::LevelingModule::new()));
    r.register(Box::new(modules::character::CharacterModule::new(
        character,
    )));
    r.register(Box::new(modules::output_files::OutputFilesModule::new()));
    r.register(Box::new(modules::spell_sets::SpellSetsModule::new()));
    r.register(Box::new(modules::item_tiers::ItemTiersModule::new()));
    r.register(Box::new(
        modules::observed_spell_ranks::ObservedSpellRanksModule::new(known_spell),
    ));
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold_lines(lines: &[&str]) -> Value {
        let mut fold = Fold::new(cluster_2a_2b(ClusterDeps::default()), i64::MAX);
        for line in lines {
            let ev = Event::from_json(line).expect("a JSON object");
            fold.on_primary(&ev, false);
        }
        fold.registry.snapshots()
    }

    fn state_of(snaps: &Value, id: &str) -> Value {
        snaps["modules"]
            .as_array()
            .expect("modules")
            .iter()
            .find(|m| m["id"] == id)
            .expect("the module")["snapshot"]["state"]
            .clone()
    }

    /// The registered cluster is a SUBSEQUENCE of the wiring order, and everything else is named.
    #[test]
    fn registration_follows_the_wiring_order_and_names_what_is_absent() {
        let r = cluster_2a_2b(ClusterDeps::default());
        let ids = r.ids();
        let mut at = 0usize;
        for id in &ids {
            let found = WIRING_ORDER[at..]
                .iter()
                .position(|w| w == id)
                .unwrap_or_else(|| panic!("{id} is out of wiring order"));
            at += found + 1;
        }
        assert_eq!(ids.len(), 14);
        assert_eq!(r.missing().len(), WIRING_ORDER.len() - 14);
        // 2c and 2d, still owed and still named by the report.
        assert!(r.missing().contains(&"buffs"));
        assert!(r.missing().contains(&"consider"));
        assert!(!r.missing().contains(&"loot"));
        assert!(!r.missing().contains(&"respawn"));
        // combo and roster are the two whose POSITION is load-bearing rather than free.
        assert_eq!(ids[0], "combo");
        assert_eq!(ids[1], "roster");
    }

    /// A loot row is tagged with the zone the module was standing in, and an absent optional field
    /// is OMITTED rather than written as null — the golden was recorded through `JSON.stringify`.
    #[test]
    fn a_loot_row_carries_the_zone_and_omits_what_the_line_did_not_say() {
        let snaps = fold_lines(&[
            r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Innothule Swamp"}"#,
            r#"{"kind":"loot","seq":1,"ts":11,"raw":"l","item":"Bone Chips","source":"corpse"}"#,
        ]);
        let rows = state_of(&snaps, "loot");
        assert_eq!(rows[0]["zone"], "Innothule Swamp");
        assert_eq!(rows[0]["item"], "Bone Chips");
        assert!(rows[0].get("count").is_none(), "{rows}");
        assert!(rows[0].get("created").is_none(), "{rows}");
    }

    /// The credit join claims BACKWARD, consumes the line, and every death consumes — including
    /// one this module does not count.
    #[test]
    fn one_experience_line_credits_at_most_one_kill() {
        let snaps = fold_lines(&[
            r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena 4 (Refined)"}"#,
            r#"{"kind":"expGain","seq":1,"ts":1000,"raw":"e","party":false}"#,
            r#"{"kind":"death","seq":2,"ts":1000,"raw":"d","name":"a stone spider","bySelf":true}"#,
            r#"{"kind":"death","seq":3,"ts":1200,"raw":"d","name":"a stone spider","bySelf":true}"#,
        ]);
        let mobs = state_of(&snaps, "kills")["mobs"].clone();
        let run = &mobs["a stone spider"]["tiers"]["4"];
        assert_eq!(run["count"], 2);
        assert_eq!(run["credited"], 1);
        assert_eq!(run["lastCreditedTs"], 1000);
        assert_eq!(mobs["a stone spider"]["bestTier"], 4);
    }

    /// A kill folded before any zone line states nothing about where it happened, and is not
    /// permitted to claim d0.
    #[test]
    fn a_kill_with_no_zone_line_behind_it_is_tier_unknown() {
        let snaps = fold_lines(&[
            r#"{"kind":"death","seq":0,"ts":5,"raw":"d","name":"A Froglok","bySelf":false,"killer":"Dranix"}"#,
            r#"{"kind":"death","seq":1,"ts":6,"raw":"d","name":"a froglok","bySelf":false,"killer":"You"}"#,
        ]);
        let mobs = state_of(&snaps, "kills")["mobs"].clone();
        // The two casings fold into ONE entry under the canonical key; the `slain by You` twin is
        // not counted, so the count is 1 and the display is the FIRST spelling seen.
        assert_eq!(mobs["a froglok"]["count"], 1);
        assert_eq!(mobs["a froglok"]["display"], "A Froglok");
        assert_eq!(mobs["a froglok"]["bestTier"], jsfn::TIER_UNKNOWN);
    }

    /// A load opens a window; the burst settles ten quiet seconds later and the definition is
    /// stamped with the SETTLE time, not the load line's.
    #[test]
    fn a_spell_set_load_settles_ten_quiet_seconds_after_its_burst() {
        let snaps = fold_lines(&[
            r#"{"kind":"spellSet","seq":0,"ts":0,"raw":"s","set":"dam","action":"loaded"}"#,
            r#"{"kind":"spellMemorize","seq":1,"ts":1000,"raw":"m","spell":"Clarity II","done":true}"#,
            r#"{"kind":"spellMemorize","seq":2,"ts":2000,"raw":"m","spell":"Malosi","done":true}"#,
            // Not a gem line, but it is still proof that time passed.
            r#"{"kind":"unknown","seq":3,"ts":12000,"raw":"x"}"#,
        ]);
        let state = state_of(&snaps, "spellSets");
        assert_eq!(state["memorized"], json!(["Clarity II", "Malosi"]));
        assert_eq!(state["sets"]["dam"]["observedAt"], 12000);
        assert_eq!(state["sets"]["dam"]["source"], "loaded");
        assert_eq!(
            state["sets"]["dam"]["spells"],
            json!(["Clarity II", "Malosi"])
        );
    }

    /// A forget removes the gem and leaves the rest of the bar in order.
    #[test]
    fn a_forget_closes_the_gap_in_the_memorized_order() {
        let snaps = fold_lines(&[
            r#"{"kind":"spellMemorize","seq":0,"ts":0,"raw":"m","spell":"Clarity","done":true}"#,
            r#"{"kind":"spellMemorize","seq":1,"ts":1,"raw":"m","spell":"Malosi","done":true}"#,
            r#"{"kind":"spellMemorize","seq":2,"ts":2,"raw":"m","spell":"Odium","done":true}"#,
            r#"{"kind":"spellForget","seq":3,"ts":3,"raw":"f","spell":"malosi"}"#,
        ]);
        assert_eq!(
            state_of(&snaps, "spellSets")["memorized"],
            json!(["Clarity", "Odium"])
        );
    }

    /// `tier` is the HIGHEST ever observed; `lastTier` is the raw sequence's most recent.
    #[test]
    fn an_item_tier_climbs_to_its_maximum_and_remembers_the_latest() {
        let snaps = fold_lines(&[
            r#"{"kind":"itemMerge","seq":0,"ts":1,"raw":"m","item":"Whitened Treant Fists +4","tier":4}"#,
            r#"{"kind":"itemMerge","seq":1,"ts":2,"raw":"m","item":"Whitened Treant Fists +3","tier":3}"#,
        ]);
        let row = &state_of(&snaps, "itemTiers")["whitened treant fists"];
        assert_eq!(row["tier"], 4);
        assert_eq!(row["lastTier"], 3);
        assert_eq!(row["merges"], 2);
        assert_eq!(row["name"], "Whitened Treant Fists");
    }

    /// An ordinary loot of a ` +N` drop is NOT evidence; a 'combined' one is, through `created`.
    #[test]
    fn only_a_combined_loot_mints_an_item_tier() {
        let snaps = fold_lines(&[
            r#"{"kind":"loot","seq":0,"ts":1,"raw":"l","item":"Kitchen Toolbelt +4"}"#,
            r#"{"kind":"loot","seq":1,"ts":2,"raw":"l","item":"Silver Earring","disposition":"combined","created":"Silver Earring +1"}"#,
        ]);
        let rows = state_of(&snaps, "itemTiers");
        assert!(rows.get("kitchen toolbelt").is_none(), "{rows}");
        assert_eq!(rows["silver earring"]["tier"], 1);
    }

    /// The cast lane needs no catalog; the merge lane needs one, and an unsuffixed name is never
    /// evidence at all.
    #[test]
    fn the_two_rank_witnesses_are_kept_apart() {
        let mut known = HashSet::new();
        known.insert("shiftless deeds".to_string());
        let mut fold = Fold::new(
            cluster_2a_2b(ClusterDeps {
                known_spell: known,
                ..Default::default()
            }),
            i64::MAX,
        );
        for line in [
            r#"{"kind":"castBegin","seq":0,"ts":1,"raw":"c","spell":"Lay on Hands IX"}"#,
            r#"{"kind":"castBegin","seq":1,"ts":2,"raw":"c","spell":"Clarity"}"#,
            r#"{"kind":"itemMerge","seq":2,"ts":3,"raw":"m","item":"Shiftless Deeds III"}"#,
            r#"{"kind":"itemMerge","seq":3,"ts":4,"raw":"m","item":"Gold Plated Koshigatana II"}"#,
            r#"{"kind":"resist","seq":4,"ts":5,"raw":"r","caster":"you","target":"a mob","spell":"Shiftless Deeds IV","incoming":false}"#,
            r#"{"kind":"resist","seq":5,"ts":6,"raw":"r","caster":"Dranix","target":"a mob","spell":"Shiftless Deeds VI","incoming":false}"#,
        ] {
            fold.on_primary(&Event::from_json(line).expect("object"), false);
        }
        let rows = state_of(&fold.registry.snapshots(), "observedSpellRanks");
        // A rank the log has only ever CAST is still known, catalog or no catalog.
        assert_eq!(rows["lay on hands"]["castRank"], 9);
        assert!(rows["lay on hands"].get("mergedRank").is_none());
        // An unsuffixed cast mints nothing — rank 1 is the default state, not an observation.
        assert!(rows.get("clarity").is_none(), "{rows}");
        // The merge lane is gated on the catalog…
        assert!(rows.get("gold plated koshigatana").is_none(), "{rows}");
        // …and the union takes the highest of the two halves, from YOUR cast only.
        assert_eq!(rows["shiftless deeds"]["mergedRank"], 3);
        assert_eq!(rows["shiftless deeds"]["castRank"], 4);
        assert_eq!(rows["shiftless deeds"]["rank"], 4);
        assert_eq!(rows["shiftless deeds"]["merges"], 1);
        assert_eq!(rows["shiftless deeds"]["name"], "Shiftless Deeds");
    }

    /// The epoch event is DERIVED, drains after the primary event, and drops every
    /// character-scoped module's state — while `outputFiles` deliberately keeps its receipts.
    #[test]
    fn the_launch_boundary_drops_the_dead_characters_state() {
        let mut fold = Fold::new(cluster_2a_2b(ClusterDeps::default()), 1000);
        for line in [
            r#"{"kind":"loot","seq":0,"ts":500,"raw":"l","item":"Beta Sword"}"#,
            r#"{"kind":"outputFile","seq":1,"ts":600,"raw":"o","file":"Inventory.txt"}"#,
            r#"{"kind":"level","seq":2,"ts":700,"raw":"v","level":26}"#,
            r#"{"kind":"loot","seq":3,"ts":1500,"raw":"l","item":"Live Sword"}"#,
        ] {
            fold.on_primary(&Event::from_json(line).expect("object"), false);
        }
        let snaps = fold.registry.snapshots();
        // The pre-launch loot went with the epoch; the post-launch row is the only survivor. Note
        // the boundary event fires ON the ts:1500 loot line and is drained AFTER it, so that row
        // is cleared too — which is exactly what the TS does.
        assert_eq!(state_of(&snaps, "loot"), json!([]));
        assert_eq!(state_of(&snaps, "leveling")["levels"], json!([]));
        // …and the dump receipt outlives the epoch on purpose: the FILE outlives it too.
        assert_eq!(state_of(&snaps, "outputFiles")["inventory.txt"], 600);
    }

    /// A trade only closes the offer group that names the same NPC — but it always drops it.
    #[test]
    fn a_turn_in_pairs_offers_with_the_trade_that_names_the_same_npc() {
        let snaps = fold_lines(&[
            r#"{"kind":"offer","seq":0,"ts":1,"raw":"o","item":"Bone Chips","npc":"Kizdean Gix"}"#,
            r#"{"kind":"offer","seq":1,"ts":2,"raw":"o","item":"Bone Chips","npc":"Kizdean Gix"}"#,
            r#"{"kind":"trade","seq":2,"ts":3,"raw":"t","npc":"Someone Else"}"#,
            r#"{"kind":"offer","seq":3,"ts":4,"raw":"o","item":"Wind Rune","npc":"Kizdean Gix"}"#,
            r#"{"kind":"trade","seq":4,"ts":5,"raw":"t","npc":"Kizdean Gix"}"#,
        ]);
        let rows = state_of(&snaps, "turnins");
        assert_eq!(rows.as_array().expect("rows").len(), 1);
        assert_eq!(rows[0]["items"], json!(["Wind Rune"]));
        assert_eq!(rows[0]["ts"], 5);
    }

    /// First sighting wins, case-folded — and the newest export wins for a dump.
    #[test]
    fn class_unlocks_dedupe_and_output_files_keep_only_the_newest() {
        let snaps = fold_lines(&[
            r#"{"kind":"classUnlock","seq":0,"ts":1,"raw":"c","className":"Shadow Knight"}"#,
            r#"{"kind":"classUnlock","seq":1,"ts":2,"raw":"c","className":"shadow knight"}"#,
            r#"{"kind":"outputFile","seq":2,"ts":10,"raw":"o","file":"Inventory.txt"}"#,
            r#"{"kind":"outputFile","seq":3,"ts":5,"raw":"o","file":"C:\\EQ\\inventory.txt"}"#,
        ]);
        assert_eq!(
            state_of(&snaps, "classUnlocks"),
            json!([{ "ts": 1, "className": "Shadow Knight" }])
        );
        assert_eq!(
            state_of(&snaps, "outputFiles"),
            json!({ "inventory.txt": 10 })
        );
    }

    /// A module whose state moves ONLY on events reports the seq of the LAST event it was handed,
    /// derived events included — and THREE of them deliberately do not (JOS-87).
    ///
    /// `combo`, `character` and `respawn` each have a SECOND INPUT that advances no log seq (a user
    /// correction, `setCharacter`, a watch edit), so each reports a private revision counter
    /// instead. `useModule` dedupes with `d.seq <= knownSeq`, so publishing the event seq there
    /// would let the renderer drop the very push that carries the out-of-band change. The
    /// distinction is a CONTRACT, not an accident, so the test names both sides.
    #[test]
    fn the_published_seq_is_the_last_event_folded_except_where_a_revision_is_owed() {
        const OWN_REVISION: [&str; 3] = ["combo", "character", "respawn"];
        let snaps = fold_lines(&[
            r#"{"kind":"unknown","seq":0,"ts":1,"raw":"x"}"#,
            r#"{"kind":"unknown","seq":41,"ts":2,"raw":"x"}"#,
        ]);
        for m in snaps["modules"].as_array().expect("modules") {
            let id = m["id"].as_str().expect("an id");
            if OWN_REVISION.contains(&id) {
                // Two unknown events move none of the three, so each is still at what its
                // CONSTRUCTION spent: one `reset()` apiece, plus `character`'s `setCharacter` —
                // which the composition root always makes, ref or no ref.
                let want = if id == "character" { 2 } else { 1 };
                assert_eq!(m["snapshot"]["seq"], want, "{id}");
                continue;
            }
            assert_eq!(m["snapshot"]["seq"], 41, "{id}");
        }
    }

    /// A login after a long silence synthesizes an `offlineGap`, and `progression` publishes the
    /// instants it carries — the columns are a record of what the log said, and the absence is a
    /// thing the log said (JOS-475: the producer this cluster had to bring with it).
    #[test]
    fn a_login_after_an_absence_writes_an_offline_interval() {
        let snaps = fold_lines(&[
            r#"{"kind":"expGain","seq":0,"ts":1000,"raw":"e","party":false}"#,
            r#"{"kind":"campStart","seq":1,"ts":2000,"raw":"c"}"#,
            r#"{"kind":"sessionStart","seq":2,"ts":900000,"raw":"w"}"#,
        ]);
        let p = state_of(&snaps, "progression");
        assert_eq!(p["offlineStart"], json!([2000]));
        assert_eq!(p["offlineEnd"], json!([900000]));
        assert_eq!(p["offlineCamped"], json!([1]));
    }

    /// The credited/witnessed split, the backward experience join, and the ring row that carries
    /// what the kill paid — all off one four-line window.
    #[test]
    fn a_kill_claims_the_experience_line_before_it_and_a_strangers_does_not_pay_you() {
        let snaps = fold_lines(&[
            r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
            r#"{"kind":"expGain","seq":1,"ts":1000,"raw":"e","party":false,"pct":2}"#,
            r#"{"kind":"death","seq":2,"ts":1000,"raw":"d","name":"a stone spider","bySelf":true}"#,
            r#"{"kind":"death","seq":3,"ts":2000,"raw":"d","name":"a bat","bySelf":false,"killer":"Dranix"}"#,
        ]);
        let p = state_of(&snaps, "progression");
        assert_eq!(p["killTs"], json!([1000]));
        assert_eq!(p["killZone"], json!([0]));
        assert_eq!(p["witnessTs"], json!([2000]));
        assert_eq!(p["recentKills"][0]["name"], "a stone spider");
        assert_eq!(p["recentKills"][0]["zone"], "Najena");
        // `expPct` is the one true f64 in the stream, so it is compared as a NUMBER: serde writes
        // `2.0` where `JSON.stringify` writes `2`, and both parse to the same double — which is
        // exactly what the phase-2 comparator does with them (it diffs two PARSED values).
        assert_eq!(p["recentKills"][0]["expPct"].as_f64(), Some(2.0));
        assert_eq!(p["recentKills"][0]["expFlag"], 0);
    }

    /// A group line names a member and an offline gap marks them STALE rather than removing them —
    /// hiding a real member is the worse error, and is the bug the feature exists to fix.
    #[test]
    fn an_offline_gap_dims_a_member_and_never_drops_one() {
        let snaps = fold_lines(&[
            r#"{"kind":"group","seq":0,"ts":1000,"raw":"g","change":"join","name":"Dranix"}"#,
            r#"{"kind":"expGain","seq":1,"ts":2000,"raw":"e","party":true}"#,
            r#"{"kind":"sessionStart","seq":2,"ts":900000,"raw":"w"}"#,
        ]);
        let r = state_of(&snaps, "roster");
        assert_eq!(r["members"][0]["name"], "Dranix");
        assert_eq!(r["members"][0]["source"], "joined");
        assert_eq!(r["members"][0]["stale"], true);
        assert_eq!(r["seen"], true);
        assert_eq!(r["lastSignalTs"], 1000);
    }

    /// A `/who` row states the level at its own instant and OUTRANKS a ding in the same second; the
    /// epoch drops the wiped character's zone and level and KEEPS the ref.
    ///
    /// Note the zone line that triggers the boundary: the derived event drains AFTER it, so that
    /// zone goes with the dead character too, and the first zone the surviving character has is the
    /// next line. Same shape as the 2a loot case, and the same reason.
    #[test]
    fn the_level_fact_takes_the_latest_statement_and_who_breaks_the_tie() {
        let mut fold = Fold::new(
            cluster_2a_2b(ClusterDeps {
                character: Some(json!({ "name": "Primitive", "server": "freeport" })),
                ..Default::default()
            }),
            1000,
        );
        for line in [
            r#"{"kind":"zone","seq":0,"ts":500,"raw":"z","zone":"Beta Zone"}"#,
            r#"{"kind":"level","seq":1,"ts":600,"raw":"v","level":26}"#,
            r#"{"kind":"zone","seq":2,"ts":1500,"raw":"z","zone":"Beta Zone"}"#,
            r#"{"kind":"zone","seq":3,"ts":1550,"raw":"z","zone":"Najena"}"#,
            r#"{"kind":"level","seq":4,"ts":1600,"raw":"v","level":30}"#,
            r#"{"kind":"selfWho","seq":5,"ts":1600,"raw":"w","level":31,"classes":["PAL","MNK","ENC"]}"#,
        ] {
            fold.on_primary(&Event::from_json(line).expect("object"), false);
        }
        let state = state_of(&fold.registry.snapshots(), "character");
        assert_eq!(state["character"]["name"], "Primitive");
        assert_eq!(state["zone"], "Najena");
        assert_eq!(
            state["level"],
            json!({ "level": 31, "ts": 1600, "source": "who" })
        );
    }

    /// A watch list nobody filled in clocks NOTHING — the opt-in ruling — while the recent-kills
    /// candidate list still offers every mob the fold has seen die.
    #[test]
    fn an_empty_watch_list_publishes_candidates_and_no_rows() {
        let snaps = fold_lines(&[
            r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
            r#"{"kind":"death","seq":1,"ts":1000,"raw":"d","name":"a stone spider","bySelf":true}"#,
        ]);
        let state = state_of(&snaps, "respawn");
        assert_eq!(state["v"], 4);
        assert_eq!(state["zone"], "Najena");
        assert_eq!(state["rows"], json!([]));
        assert_eq!(state["prefs"], json!({ "watches": [] }));
        assert_eq!(state["recent"][0]["key"], "a stone spider");
        assert_eq!(state["recent"][0]["watched"], false);
        assert_eq!(state["recent"][0]["kills"], 1);
    }
}
