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

    /// THE DERIVED EVENTS THIS MODULE SYNTHESIZED WHILE FOLDING THE EVENT IT WAS JUST HANDED, in
    /// emission order — `bus.emitDerived` (JOS-471 cluster 2c).
    ///
    /// A HAND-BACK RATHER THAN A CALLBACK, and the difference is ownership rather than taste. Over
    /// there `wiring.ts` injects `emitDerived: (ev, live) => bus.emitDerived(ev, live)` into the
    /// buffs module, so the module holds a reference to the queue and pushes into it mid-fold. A
    /// module here cannot hold a mutable reference to a queue the registry is iterating; so it
    /// buffers its own emissions and the registry takes them the instant `on_event` returns. The
    /// resulting ORDER is identical, and that is the only thing the fold can observe: within one
    /// module, emission order; across modules, registration order; and the whole batch delivered
    /// after the primary event has reached every module, which is exactly `LogBus.emit`'s drain.
    ///
    /// One producer today (`buffs`, `buffExpired`). Defaulted empty for the other nineteen.
    fn take_derived(&mut self) -> Vec<Event> {
        Vec::new()
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
    /// `registered`, which is the one caller that matters and which asserts it.
    pub fn register(&mut self, m: Box<dyn EqModule>) {
        self.mods.push(m);
    }

    pub fn reset(&mut self) {
        for m in &mut self.mods {
            m.reset();
        }
    }

    /// Deliver one event to every module, in order, appending whatever any of them SYNTHESIZED
    /// while folding it to the caller's derived queue (see `EqModule::take_derived`). The queue is
    /// the caller's because it is the bus's: `Fold` owns it and drains it, and a module that emits
    /// while a drain is running appends to the very queue being drained — which is what
    /// `LogBus.drain`'s shift-until-empty does.
    pub fn dispatch(&mut self, ev: &Event, live: bool, derived: &mut Vec<Event>) {
        for m in &mut self.mods {
            m.on_event(ev, live);
            let mut out = m.take_derived();
            if !out.is_empty() {
                derived.append(&mut out);
            }
        }
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.mods.iter().map(|m| m.id()).collect()
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
    epoch: epoch::EpochDetector,
    sessions: session::SessionDetector,
    /// The bus's derived queue. THREE producers, exactly as over there: the registry's own modules
    /// (`buffs`, whose `buffExpired` cluster 2c brought), the epoch detector and the offline-gap
    /// detector.
    derived: Vec<Event>,
    events: u64,
}

impl Fold {
    pub fn new(registry: Registry, launch_ms: i64) -> Self {
        let mut f = Fold {
            registry,
            epoch: epoch::EpochDetector::new(launch_ms),
            sessions: session::SessionDetector::new(),
            derived: Vec::new(),
            events: 0,
        };
        f.reset();
        f
    }

    pub fn reset(&mut self) {
        self.registry.reset();
        self.epoch.reset();
        self.sessions.reset();
        self.derived.clear();
        self.events = 0;
    }

    /// How many PRIMARY events were folded — `ScanResult.seq`.
    pub fn events(&self) -> u64 {
        self.events
    }

    /// One primary event: dispatch to the modules, let the two detectors observe it, then drain
    /// whatever anybody queued through the SAME dispatch loop. That is `LogBus.emit` exactly.
    ///
    /// THE ORDER OF THE THREE PRODUCERS IS THE SUBSCRIPTION ORDER, and it decides the queue's
    /// order: the twenty modules first (so a `buffExpired` precedes both detectors' output for the
    /// same primary event), then the epoch detector, then the offline-gap detector — which is how
    /// `foldArm.mts construct` subscribes them, and therefore how the golden was recorded.
    pub fn on_primary(&mut self, ev: &Event, live: bool) {
        self.events += 1;
        self.observe(ev, live);
        // Shift-until-empty, so anything a derived event queues IN TURN is delivered too — and it
        // can: `buffs` folds an `epoch` by clearing its live state, and a censored instance is
        // still an instance that may announce its own end.
        let mut i = 0;
        while i < self.derived.len() {
            let d = self.derived[i].clone();
            i += 1;
            self.observe(&d, live);
        }
        self.derived.clear();
    }

    /// One delivery: every module, then every detector. Used for a primary event and for each
    /// event of the drain alike, because the bus makes no distinction between them — the detectors
    /// are ordinary subscribers and they refuse the derived kinds BY NAME rather than by position
    /// (`epochDetector.observe`'s first line, `sessionDetector.observe`'s).
    fn observe(&mut self, ev: &Event, live: bool) {
        self.registry.dispatch(ev, live, &mut self.derived);
        if let Some(d) = self.epoch.observe(ev) {
            self.derived.push(d);
        }
        if let Some(d) = self.sessions.observe(ev) {
            self.derived.push(d);
        }
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

/// EVERY PORTED MODULE, registered in `WIRING_ORDER`'s relative order.
///
/// It was `cluster_2a` while nine modules were all there was; the name moved with the second
/// cluster because a registry that names one ticket is a registry a reader has to date. What has
/// NOT changed is the law it enforces — the caller registers in wiring order, the test below says
/// so, and `missing()` names everything still absent.
///
/// `known_spell` is `wiring.ts`'s `knownSpell: (key) => spellDb.byKey.has(key)`, passed in as the
/// key set rather than as a closure so nothing in this crate borrows the parser.
pub fn registered(known_spell: HashSet<String>) -> Registry {
    let mut r = Registry::new();
    r.register(Box::new(modules::loot::LootModule::new()));
    r.register(Box::new(modules::turnins::TurnInsModule::new()));
    r.register(Box::new(modules::class_unlocks::ClassUnlocksModule::new()));
    r.register(Box::new(modules::kills::KillsModule::new()));
    r.register(Box::new(modules::leveling::LevelingModule::new()));
    r.register(Box::new(modules::output_files::OutputFilesModule::new()));
    r.register(Box::new(modules::spell_sets::SpellSetsModule::new()));
    r.register(Box::new(modules::item_tiers::ItemTiersModule::new()));
    r.register(Box::new(
        modules::observed_spell_ranks::ObservedSpellRanksModule::new(known_spell),
    ));
    r.register(Box::new(modules::alerts::AlertsModule::new()));
    r.register(Box::new(modules::consider::ConsiderModule::new()));
    r.register(Box::new(modules::event_feed::EventFeedModule::new()));
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold_lines(lines: &[&str]) -> Value {
        let mut fold = Fold::new(registered(HashSet::new()), i64::MAX);
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
        let r = registered(HashSet::new());
        let ids = r.ids();
        let mut at = 0usize;
        for id in &ids {
            let found = WIRING_ORDER[at..]
                .iter()
                .position(|w| w == id)
                .unwrap_or_else(|| panic!("{id} is out of wiring order"));
            at += found + 1;
        }
        assert_eq!(r.missing().len(), WIRING_ORDER.len() - ids.len());
        // The 2b set is still absent BY NAME, which is what the SKIP line prints.
        assert!(r.missing().contains(&"respawn"));
        assert!(!r.missing().contains(&"loot"));
        assert!(!r.missing().contains(&"alerts"));
        assert!(!r.missing().contains(&"eventFeed"));
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
        let mut fold = Fold::new(registered(known), i64::MAX);
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
        let mut fold = Fold::new(registered(HashSet::new()), 1000);
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

    /// Every module reports the seq of the LAST event it was handed, derived events included.
    #[test]
    fn the_published_seq_is_the_last_event_folded() {
        let snaps = fold_lines(&[
            r#"{"kind":"unknown","seq":0,"ts":1,"raw":"x"}"#,
            r#"{"kind":"unknown","seq":41,"ts":2,"raw":"x"}"#,
        ]);
        for m in snaps["modules"].as_array().expect("modules") {
            assert_eq!(m["snapshot"]["seq"], 41, "{}", m["id"]);
        }
    }

    // ── CLUSTER 2c (JOS-476) ──────────────────────────────────────────────────────────────────

    /// The cast-recency map keeps the RANK, refuses a stamp that went backwards, and survives the
    /// launch boundary — alerts is the one character-facing module with no `epoch` branch.
    #[test]
    fn the_cast_recency_map_is_rank_sensitive_and_outlives_the_epoch() {
        let mut fold = Fold::new(registered(HashSet::new()), 1000);
        for line in [
            r#"{"kind":"castBegin","seq":0,"ts":500,"raw":"c","spell":"Mesmerization III"}"#,
            r#"{"kind":"castBegin","seq":1,"ts":400,"raw":"c","spell":"Mesmerization III"}"#,
            r#"{"kind":"castBegin","seq":2,"ts":600,"raw":"c","spell":"Mesmerization"}"#,
            r#"{"kind":"loot","seq":3,"ts":1500,"raw":"l","item":"Live Sword"}"#,
        ] {
            fold.on_primary(&Event::from_json(line).expect("object"), false);
        }
        let state = state_of(&fold.registry.snapshots(), "alerts");
        // Two ranks are two names, the older stamp did not win, and the epoch at ts 1500 did not
        // take the map with it.
        assert_eq!(state["spellLastCast"]["Mesmerization III"], 500);
        assert_eq!(state["spellLastCast"]["Mesmerization"], 600);
        assert_eq!(state["defs"], json!([]));
        assert_eq!(state["history"], json!({}));
        assert!(state.get("poisonSlowSeen").is_none(), "{state}");
    }

    /// A slow proc mints the recency record, and a LATER one moves the target while an out-of-order
    /// one only counts.
    #[test]
    fn the_slow_poison_record_counts_every_proc_and_names_the_newest_target() {
        let snaps = fold_lines(&[
            r#"{"kind":"poisonProc","seq":0,"ts":100,"raw":"p","effect":"slow","target":"a spectre","strike":"Weakening Strike"}"#,
            r#"{"kind":"poisonProc","seq":1,"ts":50,"raw":"p","effect":"slow","target":"a ghoul","strike":"Weakening Strike"}"#,
            r#"{"kind":"poisonProc","seq":2,"ts":90,"raw":"p","effect":"damage","target":"a rat","strike":"Blinding Strike"}"#,
        ]);
        assert_eq!(
            state_of(&snaps, "alerts")["poisonSlowSeen"],
            json!({ "lastAt": 100, "count": 2, "lastTarget": "a spectre" })
        );
    }

    /// One row per mob, newest LAST, and a re-con moves the row rather than keeping its place —
    /// the one thing that makes this ring not a `JsMap`.
    #[test]
    fn a_re_con_moves_the_mobs_one_row_to_the_end_and_bumps_its_count() {
        let snaps = fold_lines(&[
            r#"{"kind":"zone","seq":0,"ts":1,"raw":"z","zone":"Permafrost Keep"}"#,
            r#"{"kind":"consider","seq":1,"ts":10,"raw":"c","mob":"A goblin priest","rare":false,"level":20,"faction":"indifferent","difficulty":"You could probably win this fight."}"#,
            r#"{"kind":"consider","seq":2,"ts":20,"raw":"c","mob":"Voidling","rare":false,"faction":"indifferent","difficulty":"???"}"#,
            r#"{"kind":"consider","seq":3,"ts":30,"raw":"c","mob":"a goblin priest","rare":true,"level":21,"faction":"scowls","difficulty":"???"}"#,
        ]);
        let rows = state_of(&snaps, "consider");
        assert_eq!(rows.as_array().expect("rows").len(), 2);
        // Voidling is now FIRST because the re-con moved the goblin to the end.
        assert_eq!(rows[0]["id"], "voidling");
        // …and the row that moved carries the newest con's facts under the LOWERCASE spelling,
        // which `adoptDisplay` prefers over the sentence-cased first sighting.
        assert_eq!(rows[1]["mob"], "a goblin priest");
        assert_eq!(rows[1]["cons"], 2);
        assert_eq!(rows[1]["level"], 21);
        assert_eq!(rows[1]["zone"], "Permafrost Keep");
        // A con with no level states none rather than claiming zero.
        assert!(rows[0].get("level").is_none(), "{rows}");
        assert!(rows[0].get("knowledge").is_none(), "{rows}");
    }

    /// The feed admits NOTHING historical, and its seq is still every event's — the hydration rule,
    /// and the reason all six goldens record `[]` beside a live seq.
    #[test]
    fn the_event_feed_stays_empty_through_a_historical_fold() {
        let snaps = fold_lines(&[
            r#"{"kind":"consider","seq":0,"ts":10,"raw":"c","mob":"a rat","rare":false,"faction":"indifferent","difficulty":"???"}"#,
            r#"{"kind":"loot","seq":7,"ts":20,"raw":"l","item":"Bone Chips","source":"a rat"}"#,
        ]);
        assert_eq!(state_of(&snaps, "eventFeed"), json!([]));
    }

    /// EVERY primary event reaches the offline-gap detector, which is the wiring half of the
    /// second derived event this cluster brings. The rule it applies is proven in `session.rs`;
    /// what this pins is that `Fold` feeds it at all, and that the anchor a fold hands it is the
    /// line about YOU rather than the reconnect preamble's chat noise.
    #[test]
    fn the_fold_feeds_every_primary_event_to_the_offline_gap_detector() {
        let mut fold = Fold::new(registered(HashSet::new()), i64::MAX);
        for line in [
            r#"{"kind":"loot","seq":0,"ts":1000,"raw":"l","item":"Bone Chips"}"#,
            r#"{"kind":"unknown","seq":1,"ts":500000,"raw":"Channels: 1=General1(400)"}"#,
        ] {
            fold.on_primary(&Event::from_json(line).expect("object"), false);
        }
        let welcome = Event::from_json(
            r#"{"kind":"sessionStart","seq":2,"ts":900000,"raw":"Welcome to EverQuest Legends!"}"#,
        )
        .expect("object");
        let gap = fold.sessions.observe(&welcome).expect("a gap");
        assert_eq!(gap.kind(), "offlineGap");
        assert_eq!(gap.int("fromTs"), Some(1000));
        assert_eq!(gap.int("toTs"), Some(900000));
    }
}
