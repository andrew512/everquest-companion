//! ============================================================================
//! THE FOLD, PLUGGED IN (JOS-459 phase 3 first light, JOS-478).
//! ============================================================================
//!
//! `ingest` decides who is folding; `fold` decides what a fold IS. This file is the whole of what
//! joins them: one `impl EventSink for` a fold, and one factory that builds the twenty-module
//! registry out of what an attach knows. It lives in THIS crate because the orphan rule requires it
//! — neither trait nor type is ours to put anywhere else — and it is deliberately the only place
//! either crate's construction is spelled.
//!
//! ── WHAT AN ATTACH BUILDS, AND WHERE EACH INPUT COMES FROM ─────────────────────────────────────
//!
//! `fold::ClusterDeps` is "everything the registry needs from outside the log". Five of its eight
//! fields are facts about COMMITTED DATA and are derived here from the parser's own catalog; the
//! remaining three are APP KNOWLEDGE and are empty on purpose. That split is boundary verdict 3 —
//! the engine never reads a settings file — and it is stated per field below rather than left to be
//! inferred from a `Default::default()`.
//!
//! **THE THREE EMPTY ONES ARE THE NEXT TICKET'S `*.define` COMMANDS.** `respawn_prefs` (the watch
//! list), `self_name` (`roster.setSelfName`, which `session.ts` pushes in app-side), and the
//! `character` ref's app-supplied half all arrive as commands when the app connects. Until then
//! this engine is built exactly as `tests/bench/foldArm.mts construct()` builds the bench world —
//! which is not a coincidence and not a shortcut: the bench world is the one the six-slice
//! equivalence oracle recorded its goldens under, so an engine that matched anything else would be
//! provably right about a world nobody has measured. Alert definitions, buff trust, combo
//! corrections and roster edits are the same story one level up: their modules are registered and
//! folding, and what they are missing is the app's pushed state, not their own logic.
//!
//! **THE CHARACTER REF IS DERIVED, NOT PUSHED**, and that one is not app knowledge: `{ name,
//! server, logPath }` comes off the log's FILE NAME, which is the same fact the parser already
//! derives its character from. Two ways of stating one identity is a way for them to disagree.
//!
//! ── THE CONSTRUCTION CLOCK IS THE ATTACH INSTANT, and that is production-faithful ──────────────
//!
//! `respawn` seeds an ordering clock from `WorldOpts.constructionNowMs` at `reset()`. The golden
//! recorder PINS that to the slice's last timestamped line, and `fold`'s README is emphatic about
//! why — a golden recorded under `Date.now()` would stop re-checking tomorrow. That pin is a
//! property of the ORACLE, not of the product: production TypeScript constructs its world with
//! `Date.now()` and always has, so a live engine seeding from the wall clock at attach is doing
//! exactly what the app does at launch. `ingest::SinkInputs::attached_at_ms` is that instant, read
//! once, on the ingest thread, and it is the only wall clock any of this reaches — every
//! time-based rule inside the fold advances off LOG timestamps (ruling 18 law 1).
//!
//! ── THE COMBAT ENGINE IS NOT REGISTERED HERE, AND THAT IS A DECISION ───────────────────────────
//!
//! `fold::Fold::with_combat` subscribes the combat engine behind the registry, and this file does
//! not call it. Two reasons, and the second is the load-bearing one. It is not a MODULE —
//! `WIRING_ORDER` does not name it, `Registry::snapshot_of` cannot answer for it, and
//! `module.snapshot` is a registry op — so wiring it in would fold a great deal of state that this
//! ticket's only data-bearing op cannot serve. And its surfaces are VIEWS (`.combat.selected`,
//! `.combat.timeline`, the scopes walk), which arrive with `view.subscribe`'s source registry; the
//! ticket that builds those turns it on with one builder call and nothing else here moves. The
//! coupling is one-way and checked: `Fold::observe` hands the engine the registry's roster, and no
//! module reads the engine, so a fold without it publishes exactly what a fold with it publishes.

use std::collections::HashSet;

use crate::ingest::{Event, EventSink, ModuleSnapshot, SinkFactory, SinkInputs, SinkReport};
use crate::views;

/// The factory `main.rs` hands the world: every attach folds the whole registry.
#[must_use]
pub fn folding_sinks() -> SinkFactory {
    std::sync::Arc::new(|inputs| Box::new(FoldSink::new(inputs)))
}

/// One attach's fold, and the counters the ingest reports off it.
pub struct FoldSink {
    fold: fold::Fold,
    /// THE PARSER'S OWN CLOCK, kept because a VIEW has to render an instant (JOS-480).
    ///
    /// The one thing a view source needs that the fold does not: `loot.ledger`'s `at` cell is the
    /// wall clock the log's timestamps were read in, and reading it through a second clock built
    /// from the same zone would be a second answer waiting to disagree — the same argument the
    /// spell DB's single copy makes one level up. It is the ZONE that is load-bearing here, never a
    /// wall-clock READ: nothing in this file asks what time it is now.
    clock: eqlog::Clock,
}

impl FoldSink {
    /// Build the registry this attach folds into. See the module header for every input.
    #[must_use]
    pub fn new(inputs: &SinkInputs<'_>) -> Self {
        let launch_ms = fold::epoch::launch_ms(inputs.clock);
        Self {
            fold: fold::Fold::new(registry_for(inputs, launch_ms), launch_ms),
            clock: eqlog::Clock::new(inputs.clock.tz()),
        }
    }
}

/// `ClusterDeps`, assembled — the one place either crate's construction is spelled.
fn registry_for(inputs: &SinkInputs<'_>, launch_ms: i64) -> fold::Registry {
    fold::registered(fold::ClusterDeps {
        // ── committed data, read off the parser's OWN catalog ──────────────────────────────────
        // The SAME database the parser is emitting `candidates` out of, never a second load: two
        // loads is two answers waiting to disagree after an overlay change (`Parser::spell_db`
        // says so at the accessor).
        known_spell: inputs
            .db
            .map(|db| db.keys().map(str::to_string).collect::<HashSet<String>>())
            .unwrap_or_default(),
        spell_classes: inputs
            .db
            .map(fold::modules::combo::evidence::spell_class_index)
            .unwrap_or_default(),
        facts: inputs
            .db
            .map(fold::spell_facts::SpellFacts::project)
            .unwrap_or_default(),
        // ── facts about THIS run ───────────────────────────────────────────────────────────────
        launch_ms,
        construction_now_ms: inputs.attached_at_ms,
        // The identity the log's own file name states. `server_of` answering `None` is the honest
        // outcome for a name that carries no server, and it becomes an empty string exactly as the
        // golden recorder's does.
        character: inputs.character.map(|name| {
            serde_json::json!({
                "name": name,
                "server": server_of(inputs.log).unwrap_or_default(),
                "logPath": inputs.log.to_string_lossy(),
            })
        }),
        // ── app knowledge: EMPTY AT CONSTRUCTION, and then PUSHED (JOS-482) ─────────────────────
        //
        // The `*.define` commands land immediately after this factory returns — `ingest::run`
        // applies every held define before the first byte is folded — so a world the app has
        // spoken to differs from this one by exactly those five pushes and by nothing else.
        // Alerts, buff trust, respawn watches, combo corrections and roster edits all arrive that
        // way, through the modules' own `Defines` seam rather than through this struct, because a
        // define also has to be answerable MID-FOLD and a construction parameter cannot be.
        //
        // `self_name` is the one that has not moved: `roster.setSelfName` is `session.ts`'s line
        // and it is not one of the five families the cutover ledger names. It stays `None` here,
        // which is what the bench world and all six goldens recorded.
        self_name: None,
        respawn_prefs: fold::modules::respawn::RespawnPrefs::default(),
    })
}

/// The SERVER out of a log's file name — the second half of what `character_of` reads.
///
/// TWO SHAPES, the same two `ingest::character_of` accepts: the product's `eqlog_<Name>_<server>
/// .txt` and the oracle corpus's `eqlog_<Name>_<server>.<slice>.txt`, which `eqlog::server_of`
/// already implements. The last underscore separates the character from the server, because a
/// character name may hold one and a server may not — stated the same way in both readers on
/// purpose.
fn server_of(log: &std::path::Path) -> Option<String> {
    let name = log.file_name()?.to_string_lossy().into_owned();
    if let Some(server) = eqlog::server_of(&name) {
        return Some(server);
    }
    let stem = name.get(..name.len().checked_sub(4)?)?;
    if !name[stem.len()..].eq_ignore_ascii_case(".txt") {
        return None;
    }
    let rest = stem.strip_prefix("eqlog_").or_else(|| {
        stem.get(..6)
            .filter(|head| head.eq_ignore_ascii_case("eqlog_"))
            .and_then(|_| stem.get(6..))
    })?;
    let split = rest.rfind('_')?;
    let server = &rest[split + 1..];
    if rest[..split].is_empty() || server.is_empty() {
        return None;
    }
    Some(server.to_owned())
}

impl EventSink for FoldSink {
    /// One event. `Event::from_json` is the FOLD's own door — a line it declines is a line no
    /// module wanted, and the ingest's own count already recorded that the parser produced it.
    fn event(&mut self, event: &Event<'_>) {
        if let Some(ev) = fold::event::Event::from_json(event.json) {
            self.fold.on_primary(&ev, event.live);
        }
    }

    /// THE LIVE HEARTBEAT, straight through (owner ruling 22, JOS-481). One line, because the whole
    /// of the decision is `fold`'s: which modules have an `on_tick`, what each does with the number,
    /// and — the load-bearing half — that the historical path never calls it.
    ///
    /// WHY THE ENGINE HAD TO GROW ONE. The app has aged its own fold on a wall clock since JOS-149,
    /// so an engine that only ever advanced off log timestamps was serving a world that was correct
    /// about the bytes and stale about the hour. MEASURED by the in-app parity probe on a staged
    /// fixture whose buffs are long expired by wall time: twelve actives engine-side against three
    /// app-side, with the two folds agreeing exactly on everything the log had said (JOS-479).
    fn tick(&mut self, now_ms: i64) {
        self.fold.tick(now_ms);
    }

    /// What the fold can say about itself. `last_ts` is `max(ev.ts)` — the LOG's own clock,
    /// accumulated the way the golden recorder's bus listener accumulates it, so a log that rolls
    /// over cannot walk it backwards.
    fn report(&self) -> SinkReport {
        SinkReport {
            events: i64::try_from(self.fold.events()).unwrap_or(i64::MAX),
            last_ts: Some(self.fold.last_ts()),
            ..SinkReport::default()
        }
    }

    /// One module's published state, straight off the registry.
    ///
    /// `snapshot()` over there returns `{ "seq": …, "state": … }` and this splits the pair rather
    /// than re-deriving either half: the module's `seq` is its own (four of them publish a private
    /// revision counter instead of an event seq — JOS-87), and reading it off anything but the
    /// module's own answer would be a second opinion about a number the module owns.
    fn snapshot(&self, module: &str) -> Option<ModuleSnapshot> {
        let published = self.fold.registry.snapshot_of(module)?;
        Some(ModuleSnapshot {
            seq: published.get("seq").and_then(serde_json::Value::as_i64)?,
            state: published.get("state").cloned()?,
        })
    }

    /// THE VIEW LAYER'S DOOR (JOS-480). One `match` on the source, and each arm reads its module
    /// through that module's own pull seam — never through `snapshot()`, which would serialize the
    /// whole thing to draw fifty rows of it.
    ///
    /// A SOURCE WHOSE MODULE IS NOT REGISTERED ANSWERS `None`, and the view layer serves an empty
    /// window rather than refusing: the descriptor was valid, this fold simply has nothing behind
    /// it. That is the same distinction `module.snapshot` draws between `notFound` and
    /// `unavailable`, one level down.
    fn source_rows(&self, source: &'static views::SourceDef) -> Option<Vec<views::SourceRow>> {
        match source.id {
            id if id == views::loot::LEDGER.id => {
                Some(views::loot::rows(self.fold.registry.loot()?, &self.clock))
            }
            _ => None,
        }
    }

    /// THE APP-KNOWLEDGE DOOR (JOS-482). One call through to the registry, which owns the mapping
    /// from a family to the module that answers for it — the same shape `snapshot` has, one
    /// direction reversed.
    fn define(&mut self, family: &str, payload: &serde_json::Value) -> bool {
        self.fold.registry.define(family, payload)
    }

    /// The alert fires the registry made while folding the last drain, converted from the FOLD's
    /// shape into the INGEST's at this seam — which is the whole reason both types exist. Neither
    /// `ingest.rs` nor `world.rs` ever learns what an alert is.
    fn take_fires(&mut self) -> Vec<crate::ingest::Fire> {
        self.fold
            .registry
            .take_fires()
            .into_iter()
            .map(|f| crate::ingest::Fire {
                at: f.at,
                rule: f.rule,
                sound: f.sound,
                message: f.message,
            })
            .collect()
    }

    fn source_revision(&self, source: &'static views::SourceDef) -> Option<u64> {
        match source.id {
            id if id == views::loot::LEDGER.id => Some(self.fold.registry.loot()?.revision()),
            _ => None,
        }
    }
}

/// A `Clock` the sink factory can be handed in a test that has no parser. Not used in production —
/// the ingest hands over the parser's own.
#[cfg(test)]
fn test_clock() -> eqlog::Clock {
    eqlog::Clock::new(eqlog::host_timezone())
}

#[cfg(test)]
mod tests {
    use super::{folding_sinks, server_of, FoldSink};
    use crate::ingest::{Event, EventSink, SinkInputs};
    use std::path::Path;

    /// One event the `kills` module counts: a death you landed. Written as the parser writes it —
    /// `death` is the kind, `bySelf` is the counted filter, `name` is what the map is keyed by.
    ///
    /// THE `seq` IS IN THE JSON, and that is the thing worth knowing here: `ingest::Event::seq` is
    /// the INGEST's counter, and a module's published `seq` comes off the event's own field, which
    /// the parser stamped. The two agree on a real scan by construction; a test that hardcoded one
    /// and varied the other would be pinning a number nothing produces.
    fn death(seq: i64) -> String {
        format!(
            r#"{{"kind":"death","name":"a sand giant","bySelf":true,"seq":{seq},"ts":1787181707000,"raw":"a sand giant has been slain by Primitive!"}}"#
        )
    }

    fn inputs<'a>(log: &'a Path, clock: &'a eqlog::Clock) -> SinkInputs<'a> {
        SinkInputs {
            log,
            character: Some("Primitive"),
            db: None,
            clock,
            attached_at_ms: 1_787_181_707_000,
        }
    }

    #[test]
    fn the_server_comes_off_the_products_own_file_name() {
        assert_eq!(
            server_of(Path::new("C:/EQ/Logs/eqlog_Primitive_freeport.txt")).as_deref(),
            Some("freeport")
        );
        // The oracle corpus's slice form goes through eqlog's own rule.
        assert_eq!(
            server_of(Path::new("eqlog_Primitive_freeport.patch-week.txt")).as_deref(),
            Some("freeport")
        );
        // A character name may hold an underscore; the SERVER may not, so the last one splits.
        assert_eq!(
            server_of(Path::new("eqlog_Two_Names_freeport.txt")).as_deref(),
            Some("freeport")
        );
        assert!(server_of(Path::new("notalog.txt")).is_none());
        assert!(server_of(Path::new("eqlog_Primitive_.txt")).is_none());
    }

    #[test]
    fn a_fresh_sink_folds_all_twenty_modules_and_skips_none() {
        // THE NO-SILENT-CAPS LAW, engine-side. `Registry::missing()` is what the parity harness
        // prints as SKIP; an engine that served a registry with holes in it would be answering
        // `notFound` for a module that exists.
        let clock = super::test_clock();
        let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
        let sink = FoldSink::new(&inputs(log, &clock));
        assert_eq!(sink.fold.registry.ids().len(), fold::WIRING_ORDER.len());
        assert!(
            sink.fold.registry.missing().is_empty(),
            "{:?}",
            sink.fold.registry.missing()
        );
        for id in fold::WIRING_ORDER {
            assert!(sink.snapshot(id).is_some(), "{id} answered nothing");
        }
    }

    #[test]
    fn a_name_the_registry_does_not_carry_answers_nothing() {
        // …and `loot.ledger` is the trap worth pinning: it is a VIEW source name, and a caller that
        // confuses the two must be told so rather than handed an empty state.
        let clock = super::test_clock();
        let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
        let sink = FoldSink::new(&inputs(log, &clock));
        assert!(sink.snapshot("loot.ledger").is_none());
        assert!(sink.snapshot("").is_none());
        assert!(sink.snapshot("combat").is_none(), "combat is not a module");
    }

    /// Feed one death, stamped with `seq`.
    fn kill(sink: &mut dyn EventSink, seq: i64) {
        sink.event(&Event {
            json: &death(seq),
            seq,
            live: false,
        });
    }

    /// How many kills the `kills` module has recorded.
    fn counted(sink: &dyn EventSink) -> usize {
        sink.snapshot("kills").expect("kills is registered").state["mobs"]
            .as_object()
            .map_or(0, serde_json::Map::len)
    }

    #[test]
    fn the_snapshot_advances_with_the_fold_and_reads_between_events() {
        // THE POINT OF THE SEAM, in miniature: a snapshot taken between two events is the state
        // after the first and no part of the second.
        //
        // TWO DEATHS, AND THE FIRST ONE IS SUPPOSED TO VANISH. A live engine resolves the launch
        // anchor through the parser's own clock, so the first event past 2026-07-28 fires the
        // `epoch` boundary — character rebirth — and `kills` CLEARS on it. That is not an artifact
        // of this test: it is what a real attach does, and pinning it here is how a later change to
        // the anchor announces itself as a behaviour change instead of a mystery.
        let clock = super::test_clock();
        let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
        let mut sink = FoldSink::new(&inputs(log, &clock));
        assert_eq!(counted(&sink), 0);

        kill(&mut sink, 0);
        assert_eq!(counted(&sink), 0, "the epoch boundary cleared the map");
        kill(&mut sink, 1);
        assert_eq!(counted(&sink), 1, "and the next one is the new world's");

        let after = sink.snapshot("kills").expect("kills is registered");
        assert_eq!(after.seq, 1, "the module's own seq is the event it folded");
        assert_eq!(sink.report().events, 2);
    }

    #[test]
    fn the_factory_builds_a_fresh_registry_per_attach() {
        // A NEW SINK PER ATTACH is the ingest's structural guarantee that two folds never reach one
        // set of modules (JOS-457's defect, made impossible). This is the half of it that lives
        // here: the factory constructs, it never hands back something it is holding.
        let clock = super::test_clock();
        let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
        let factory = folding_sinks();
        let mut first = factory(&inputs(log, &clock));
        kill(&mut *first, 0);
        kill(&mut *first, 1);
        let second = factory(&inputs(log, &clock));
        assert_eq!(first.report().events, 2);
        assert_eq!(second.report().events, 0);
        assert_eq!(counted(&*first), 1);
        assert_eq!(counted(&*second), 0);
    }
}
