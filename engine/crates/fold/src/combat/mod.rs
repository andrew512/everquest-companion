//! ============================================================================
//! combat — THE COMBAT ENGINE, IN RUST (JOS-459 phase 2d; the ticket is JOS-477).
//! ============================================================================
//!
//! `src/main/combat/` is ~33 files and 12,400 lines: a formal state machine over the log stream
//! (`engine.ts` as the facade over `state.ts` + `ingest.ts`, with routing / rounds / healing /
//! procDetect / world / charmModel / taxonomy / stateTimeline / mergeSessions beside it). This module
//! is its port, and as of JOS-477's final landing it is WHOLE for everything the snapshot publishes:
//! `combat` and `scopes` agree with the golden on every leaf of all six slices.
//!
//! ── A SUBMODULE OF `fold`, NOT A CRATE OF ITS OWN, AND THE ARGUMENT FOR IT ─────────────────────
//!
//! The ticket left the call open. Three things decide it, and all three point the same way:
//!
//!   1. THE BUS ORDER IS A DISPATCH FACT, NOT A LAYERING ONE. The engine is a subscriber that sits
//!      AFTER the twenty modules and BEFORE the epoch/offline-gap detectors (`pipeline.ts:311,326`,
//!      `foldArm.mts construct()`). `Fold::on_primary` is the loop that owns that order. A separate
//!      crate would have to be driven BY `fold` — so `fold` would depend on it — while the roster
//!      PULL (below) makes it depend on `fold` in turn. That is a cycle, and the only ways out are
//!      a third crate holding `Event` and the `EqModule` trait, or a callback the caller wires by
//!      hand. Both are structure bought to keep two files apart.
//!   2. THE ROSTER SEAM IS A PULL ACROSS THE SAME BOUNDARY. `engine.ts:215` installs a closure onto
//!      cluster 2b's `roster` MODULE, and the engine reads it DURING dispatch. Here that is
//!      `EqModule::as_roster` — a defaulted trait method on the registry's own contract. Split
//!      across crates it becomes a public trait in a shared crate plus two impls, for one method.
//!   3. IT REUSES THIS CRATE'S PORTS WHOLESALE — `Event`, `JsMap` (JS `Map` iteration order, which
//!      every published array here depends on), `jsfn`, and `eqlog::names`/`jsstr`. The README's
//!      rule is "reach for the existing ports before writing a helper"; a crate boundary is a
//!      standing invitation to write the second spelling.
//!
//! So: one file per TS module under `combat/`, exactly the recipe `modules/` follows.
//!
//! ── WHAT IS PORTED, AND THE FOUR THINGS THAT DELIBERATELY ARE NOT ─────────────────────────────
//!
//! PORTED: the construction, the log-clock snapshot contract, the world model, the whole attribution
//! ladder, the encounter and zone-stay lifecycles, every accumulator on the `Agg` (damage, healing,
//! rounds, modifiers, the proc ledger and the minute-window ledger), the active-state timeline, the
//! blade coats, the cast-less proc detector, all six view builders, the per-fight timeline, and the
//! PER-SCOPE WALK the acceptance oracle is built on.
//!
//! NOT PORTED, and each absence is a PROOF rather than a gap — every one is unreachable under the
//! construction `foldArm.mts` actually makes, and the goldens agree:
//!
//!   * THE CLASSIFICATION RING (`st.recent`). Written only while `recording`, which `setLive()` sets
//!     and the recorder never calls. `recent` is `[]` in all six goldens.
//!   * THE PET NUDGE. Armed only by `if (!st.hydrating && …)`, and a historical fold never leaves
//!     hydration, so `view(now)` answers `undefined` in every state it can reach and the key is
//!     dropped. No golden carries `combat.petNudge`.
//!   * THE SESSION MARK and its `unsplit()` (`mergeSessions.ts`). A mark is REFUSED while hydrating
//!     and is stored nowhere, so `closedBy` is `zone` on every zone session in every golden. That
//!     refusal is what makes replay determinism structural rather than careful.
//!   * FIGHT SEARCH (`fightSearch.ts`) and the fold PROBE (`foldProbe.ts`). Neither is on the
//!     snapshot path at all: one answers a search box, the other is the bench's own instrumentation.
//!
//! NOTHING HERE IS STUBBED WITH A PLAUSIBLE VALUE, which is what let the ledger measure the gap
//! honestly while it existed: every number this module published was a number it had actually folded.
//!
//! ── CACHE TRANSPARENCY (ruling 18) ────────────────────────────────────────────────────────────
//!
//! NO WALL CLOCK, EVER. `snapshot(now, …)` takes `now` as a PARAMETER and the recorder passes the
//! slice's LAST EVENT TS — never `Date.now()`. That is `goldenOracle.mts`'s rule and it is not a
//! recording convenience: the hydrating gate, the deferred encounter closure, the charm sweep and
//! the ally-bind expiry all evaluate against it, so a fold that read the host clock would answer a
//! different question every day it ran.

pub mod aggregate;
pub mod ally;
pub mod charm;
pub mod collate;
pub mod encounter;
pub mod healing;
pub mod ingest;
pub mod lifecycle;
pub mod others;
pub mod poisons;
pub mod procbuffs;
pub mod procdetect;
pub mod procrouting;
pub mod procviews;
pub mod procwindows;
pub mod roster;
pub mod rounds;
pub mod routing;
pub mod spellfacts;
pub mod state;
pub mod statetimeline;
pub mod timeline;
pub mod views;
pub mod world;

pub use encounter::ZoneSessionClose;
pub use roster::{RosterMember, RosterSnap, RosterSource};

use crate::event::Event;
use encounter::{ACTIVE_MS, SLOW_SAMPLE_CAP};
use serde::Serialize;
use serde_json::{json, Value};
use state::EngineState;

/// `shared/combat.ts SnapshotOpts`. The golden's full-fat call is
/// `{ maxSegments: 100_000, timeline: true, showUnparsed: true }` and the per-scope walk's is
/// `{ selectedId, maxSegments: 1 }`.
#[derive(Debug, Clone, Default)]
pub struct SnapshotOpts {
    pub selected_id: Option<String>,
    /// Include lines the engine could not classify (damage-shaped but unmatched). Reads the
    /// classification ring, which a historical fold never writes — see `state.rs` fact 2.
    pub show_unparsed: bool,
    /// Cap on how many finalized-fight summaries to serialize, newest-first. The current encounter
    /// and the zone summary are ALWAYS included regardless of the cap. A selected finalized fight
    /// OUTSIDE the cap is still fully resolvable through `selected`, which searches history
    /// directly — the cap is a payload bound, never a retention one.
    pub max_segments: usize,
    /// Include the SELECTED encounter's event timeline. Off by default: the timeline payload is
    /// heavier than the bar view, so it is only fetched when the view is in Timeline mode.
    pub timeline: bool,
}

impl SnapshotOpts {
    /// The recorder's full-fat options.
    pub fn full() -> Self {
        SnapshotOpts {
            selected_id: None,
            show_unparsed: true,
            max_segments: 100_000,
            timeline: true,
        }
    }

    /// The per-scope walk's options — one segment, one resolved selection, no timeline.
    pub fn scope(id: &str) -> Self {
        SnapshotOpts {
            selected_id: Some(id.to_string()),
            show_unparsed: false,
            max_segments: 1,
            timeline: false,
        }
    }
}

/// The rolling time-to-slow rollup. Statistics are computed over the LANDED samples ONLY and the
/// nulls are surfaced as `noLand` so the reader sees both halves. With no landed samples every
/// statistic is ABSENT rather than 0 — "0 ms to slow" would be a lie about a thing that never
/// happened (law 5).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SlowRollup {
    pulls: usize,
    landed: usize,
    no_land: usize,
    window: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    median_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_ms: Option<i64>,
}

/// The live stance/invocation pair, as the snapshot carries it. Every field is ABSENT rather than
/// null when never observed this session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StanceState {
    #[serde(skip_serializing_if = "Option::is_none")]
    stance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stance_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invocation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invocation_ts: Option<i64>,
}

/// THE PUBLIC FACE: one engine owning one `EngineState`, plus snapshot assembly.
pub struct CombatEngine {
    st: EngineState,
    /// Whose log this is, held so `reset()` can re-inject it the way every construction path does
    /// (`reset()` then `setPlayerName`).
    player_name: Option<String>,
}

impl Default for CombatEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CombatEngine {
    pub fn new() -> Self {
        CombatEngine {
            st: EngineState::new(),
            player_name: None,
        }
    }

    /// Inject the player's own character name. `goldenOracle.mts characterOf` derives it from the
    /// SLICE FILENAME (`eqlog_<Name>_<server>.<slice>.txt`) rather than hardcoding it, so the
    /// corpus and the harness cannot drift apart silently; `parity` reads it the same way through
    /// `eqlog::character_of`.
    pub fn set_player_name(&mut self, name: &str) {
        self.player_name = Some(name.to_string());
        self.st.set_player_name(name);
    }

    pub fn reset(&mut self) {
        self.st.reset();
        if let Some(name) = self.player_name.clone() {
            self.st.set_player_name(&name);
        }
    }

    /// Fold one canonical event. `live` drives the classification ring, which a historical fold
    /// never writes (`state.rs` fact 2) — so it is accepted, named, and has nothing to gate here.
    ///
    /// The ROSTER is refreshed first and once, which `state.rs RosterFacts` argues is exactly the
    /// per-decision live pull rather than an approximation of it: the roster module is registered
    /// before the engine, so it has already advanced for this line, and nothing on this dispatch
    /// path can write it.
    pub fn on_event(&mut self, ev: &Event, _live: bool, roster: Option<&dyn RosterSource>) {
        self.st.refresh_roster(roster);
        ingest::ingest_event(&mut self.st, ev);
    }

    /// The snapshot, at the log's own instant.
    ///
    /// `now` IS NEVER A WALL CLOCK. Encounters can close purely from elapsed time, so a snapshot
    /// may be the first observation after that threshold and the deferred closure is evaluated
    /// here — …BUT NOT WHILE THE HISTORICAL FOLD IS STILL RUNNING. A REPLAY IS NOT A MOMENT IN
    /// TIME: every line in a months-old log is weeks behind the host clock, and a poll landing
    /// between two replay slices used to finalize whatever fight was open and hand the rest of it
    /// to a fresh encounter — MEASURED, one 53,577-damage fight splitting into 43,504 + 10,073
    /// under load. `hydrating` is exactly the right question, it is true for the whole of a
    /// recorded slice, and the sweep block below is therefore never entered by this fold.
    pub fn snapshot(
        &self,
        now: i64,
        opts: &SnapshotOpts,
        roster: Option<&dyn RosterSource>,
    ) -> Value {
        let st = &self.st;
        if !st.hydrating {
            // sweepCharm(now) · sweepAlly(now) · petNudge.sweep(now) · evalClosure(st, now).
            // Unreachable in a historical fold, and unported with the models they sweep.
        }

        // The finalized fight summaries, newest-first and capped, then the whole-stay row the
        // caller appends. The current encounter is always included regardless of the cap.
        let mut segments = lifecycle::collect_segments(st, now, opts.max_segments);
        segments.push(lifecycle::zone_summary(st));

        // `inCombat` — the ONE thing `now` decides in a historical fold besides a summary's
        // `active` flag: whether the open fight's last damage is inside the freshness window.
        let in_combat = st
            .current
            .as_ref()
            .is_some_and(|e| now - e.last_ts < ACTIVE_MS);

        let selected_id = resolve_selected_id(st, opts);
        let selected = match views::build_selected(st, &selected_id, now) {
            Some(v) => serde_json::to_value(v).unwrap_or(Value::Null),
            // NULL, not an empty shell: with no fights at all the selection resolves to nothing, and
            // the UI shows a quiet "no fights yet".
            None => Value::Null,
        };

        // `recent` — the classification ring, empty for the whole of a historical fold.
        let _ = opts.show_unparsed;
        let recent: Vec<Value> = Vec::new();

        let mut out = json!({
            "selectedId": selected_id,
            "selected": selected,
            "segments": segments,
            "inCombat": in_combat,
            "recent": recent,
            "stance": stance_state(st),
            "poison": { "coat": coat_state(st), "slow": slow_rollup(st) },
            "zoneSessions": lifecycle::zone_session_summaries(st),
            "hydrating": st.hydrating,
            "roster": st.roster_snap(roster),
        });
        // ABSENT IS NOT NULL. `zone` is undefined until the first `You have entered X.` line,
        // `currentTarget` whenever no fight is open or the open one has landed no outgoing hit, and
        // `timeline` whenever the selection resolves to no timeline-carrying segment. All three are
        // dropped by `JSON.stringify` over there and must be dropped here.
        if let Some(zone) = &st.zone {
            out["zone"] = json!(zone);
        }
        if let Some(target) = current_target(st) {
            out["currentTarget"] = json!(target);
        }
        // `timeline: opts.timeline ? buildTimeline(...) : undefined` — so the key is ABSENT when the
        // caller did not ask, and present-and-NULL when it asked and the selection resolved to no
        // timeline-carrying segment (the zone scope, or a fight whose ring the history cap evicted).
        // `JSON.stringify` drops the first and keeps the second, and so does this.
        if opts.timeline {
            out["timeline"] = timeline::build_timeline(st, &selected_id, now)
                .and_then(|t| serde_json::to_value(t).ok())
                .unwrap_or(Value::Null);
        }
        out
    }

    /// THE FIGHT-SEARCH CORPUS (JOS-485) — `engine.ts searchFights`'s own, and nothing else.
    ///
    /// The open fight as `kind: "current"`, then every finalized encounter NEWEST-FIRST and
    /// UNCAPPED, which is `collect_segments` at the cap `snapshot()` never passes: over there
    /// `history` is uncapped (only the per-encounter timeline rings and the zone list are capped),
    /// so "search goes back for all time" needs no storage that does not already exist. It is a
    /// separate door rather than a read of `snapshot()` because a search must not pay for a
    /// selection, a zone list, a stance and a roster it throws away — and because the whole-stay
    /// `kind: "zone"` row that `snapshot()` appends is not a fight and must not be findable as one.
    ///
    /// READ-ONLY, like every other reader here: no closure evaluation, no memoization, nothing
    /// mutated. Typing in a search box must never be able to finalize a fight.
    pub fn fight_summaries(&self, now: i64) -> Vec<Value> {
        lifecycle::collect_segments(&self.st, now, usize::MAX)
            .into_iter()
            .filter_map(|s| serde_json::to_value(s).ok())
            .collect()
    }

    /// THE PER-SCOPE WALK, exactly as `goldenOracle.mts walkScopes` performs it: every ZONE SESSION
    /// and every FINALIZED FIGHT resolved through the same `snapshot({selectedId})` door the UI
    /// uses, so a change that moved a number the UI shows cannot hide behind an internal field that
    /// did not move.
    ///
    /// UNCAPPED. `engineOracle.mts` caps its walk at 25 fights because a human diffs that file by
    /// eye; this one is diffed by a program, and a cap is a HOLE in an acceptance oracle — a Rust
    /// engine could be wrong about fight 26 and pass.
    ///
    /// ZONE SESSIONS COME FROM `base.zoneSessions` AND FIGHTS FROM `base.segments` WITH `kind ==
    /// 'zone'` SKIPPED, in that order, because that is the order the golden's array is in and array
    /// order is a claim the comparator checks.
    pub fn walk_scopes(&self, now: i64, roster: Option<&dyn RosterSource>) -> Vec<Value> {
        let base = self.snapshot(now, &SnapshotOpts::full(), roster);
        let mut out = Vec::new();
        for zs in base["zoneSessions"].as_array().into_iter().flatten() {
            let id = zs["id"].as_str().unwrap_or_default().to_string();
            let sel = self.snapshot(now, &SnapshotOpts::scope(&id), roster);
            out.push(json!({ "kind": "zoneSession", "id": id, "selected": sel["selected"] }));
        }
        for seg in base["segments"].as_array().into_iter().flatten() {
            if seg["kind"] == "zone" {
                continue;
            }
            let id = seg["id"].as_str().unwrap_or_default().to_string();
            let sel = self.snapshot(now, &SnapshotOpts::scope(&id), roster);
            out.push(json!({ "kind": "fight", "id": id, "selected": sel["selected"] }));
        }
        out
    }
}

/// DEFAULT SELECTION = the FIGHT scope's head row: the open fight if there is one, else the most
/// recent finalized fight. It must never wander into the zone aggregate — a meter that swapped to
/// zone-overall between pulls is exactly what the owner rejected. Overall is reached by ASKING for a
/// zone-session id (`zone` / `zs<n>`), never by default. With no fights at all it resolves to
/// nothing and the selection is empty, which is the honest answer.
///
/// AN EXPLICIT REQUEST IS VALIDATED AGAINST ALL ENCOUNTERS, not just the capped segment window — a
/// selected finalized fight OUTSIDE the cap is still fully resolvable, because the cap is a PAYLOAD
/// bound and never a retention one.
fn resolve_selected_id(st: &EngineState, opts: &SnapshotOpts) -> String {
    let default_id = st
        .current
        .as_ref()
        .map(|e| e.id.clone())
        .or_else(|| st.history.last().map(|e| e.id.clone()))
        .unwrap_or_default();
    let Some(want) = opts.selected_id.as_deref().filter(|s| !s.is_empty()) else {
        return default_id;
    };
    let selectable = want == "zone"
        || st.current.as_ref().is_some_and(|e| e.id == want)
        || st.history.iter().any(|h| h.id == want)
        || st.zone_history.iter().any(|z| z.id == want);
    if selectable {
        want.to_string()
    } else {
        default_id
    }
}

/// The mob in front of you (world-model law 6, LIVE half). ABSENT when no encounter is open or when
/// the open encounter has not yet landed an outgoing hit — never a guess, and never the largest
/// target, which is the FINALIZED naming rule and would relabel a live pull retroactively.
///
/// READ-ONLY, and deliberately does NOT evaluate closure: the snapshot has already done that before
/// it asks, so a fight that just closed on elapsed time reports nothing.
fn current_target(st: &EngineState) -> Option<Value> {
    let e = st.current.as_ref()?;
    let name = e.last_out_target.as_ref()?;
    Some(json!({
        "name": name,
        "others": e.agg.targets.len().saturating_sub(1),
        "lastTs": e.last_ts,
    }))
}

/// The live blade-coat pair, copied out so a consumer cannot mutate engine state.
///
/// EVERY consumer must render ALL of them. The header pill showed only the UTILITY slot until
/// 2026-08-04, which meant a rogue running the usual asp + siphoning + stunning with no utility poison
/// on saw NOTHING at all in the passive readout.
fn coat_state(st: &EngineState) -> Value {
    let mut out = json!({ "combat": st.coat_combat });
    if let Some(u) = &st.coat_utility {
        out["utility"] = json!(u);
    }
    out
}

fn stance_state(st: &EngineState) -> StanceState {
    StanceState {
        stance: st.stance.as_ref().map(|m| m.name.clone()),
        stance_ts: st.stance.as_ref().map(|m| m.ts),
        invocation: st.invocation.as_ref().map(|m| m.name.clone()),
        invocation_ts: st.invocation.as_ref().map(|m| m.ts),
    }
}

/// `engine.ts slowRollup`. The median of an even-length sample is the ROUNDED mean of the two
/// middle values, and the mean is rounded too — `Math.round`, which is round-half-UP and not
/// Rust's round-half-away-from-zero. Every sample here is a non-negative duration, so the two agree
/// on this input; the distinction is written down because a negative would split them.
fn slow_rollup(st: &EngineState) -> SlowRollup {
    let mut landed: Vec<i64> = st.slow_samples.iter().flatten().copied().collect();
    landed.sort_unstable();
    let pulls = st.slow_samples.len();
    let mut out = SlowRollup {
        pulls,
        landed: landed.len(),
        no_land: pulls - landed.len(),
        window: SLOW_SAMPLE_CAP,
        avg_ms: None,
        median_ms: None,
        min_ms: None,
        max_ms: None,
    };
    if landed.is_empty() {
        return out;
    }
    let sum: i64 = landed.iter().sum();
    let mid = landed.len() >> 1;
    out.avg_ms = Some(js_round(sum as f64 / landed.len() as f64));
    out.median_ms = Some(if landed.len() % 2 == 1 {
        landed[mid]
    } else {
        js_round((landed[mid - 1] + landed[mid]) as f64 / 2.0)
    });
    out.min_ms = Some(landed[0]);
    out.max_ms = Some(landed[landed.len() - 1]);
    out
}

/// `Math.round` — ROUND HALF UP, which is not `f64::round` (round half away from zero). They differ
/// only for negatives; this is spelled out so a later reader does not "simplify" it.
fn js_round(v: f64) -> i64 {
    (v + 0.5).floor() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(lines: &[&str]) -> CombatEngine {
        let mut e = CombatEngine::new();
        e.set_player_name("Primitive");
        for line in lines {
            let ev = Event::from_json(line).expect("a JSON object");
            e.on_event(&ev, false, None);
        }
        e
    }

    /// A historical fold never leaves hydration, and the whole snapshot-time sweep block hangs off
    /// that one flag — `state.rs` fact 1, which every one of the six goldens agrees with.
    #[test]
    fn a_historical_fold_stays_hydrating_and_records_no_lines() {
        let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Innothule Swamp"}"#]);
        let snap = e.snapshot(10, &SnapshotOpts::full(), None);
        assert_eq!(snap["hydrating"], json!(true));
        assert_eq!(snap["recent"], json!([]));
    }

    /// `zone` is ABSENT — never null — until the first `You have entered X.` line, because a
    /// session that starts mid-zone genuinely cannot say where it is.
    #[test]
    fn the_zone_is_absent_until_a_zone_line_names_one() {
        let e = fold(&[r#"{"kind":"unknown","seq":0,"ts":1,"raw":"x"}"#]);
        let snap = e.snapshot(1, &SnapshotOpts::full(), None);
        assert!(snap.get("zone").is_none(), "{snap}");
        assert_eq!(snap["zoneSessions"][0]["zone"], json!("Session"));

        let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
        let snap = e.snapshot(10, &SnapshotOpts::full(), None);
        assert_eq!(snap["zone"], json!("Najena"));
        assert_eq!(snap["segments"][0]["name"], json!("Najena - overall"));
    }

    /// A RE-ASSERT OF THE STANCE YOU ARE ALREADY IN MOVES NOTHING. `stanceTs` is the ts of the last
    /// CHANGE, not of the last line that mentioned one.
    #[test]
    fn re_asserting_the_same_stance_does_not_move_its_timestamp() {
        let e = fold(&[
            r#"{"kind":"stanceChange","seq":0,"ts":1000,"raw":"s","stance":"offensive"}"#,
            r#"{"kind":"stanceChange","seq":1,"ts":2000,"raw":"s","stance":"offensive"}"#,
            r#"{"kind":"invocationChange","seq":2,"ts":3000,"raw":"i","invocation":"inversion"}"#,
            r#"{"kind":"stanceChange","seq":3,"ts":4000,"raw":"s","stance":"defensive"}"#,
        ]);
        let snap = e.snapshot(4000, &SnapshotOpts::full(), None);
        assert_eq!(
            snap["stance"],
            json!({
                "stance": "defensive", "stanceTs": 4000,
                "invocation": "inversion", "invocationTs": 3000
            })
        );
    }

    /// The stance pair is SESSION-scoped: it survives a zone line, because a stance is not tied to
    /// a room. Only `reset()` clears it.
    #[test]
    fn the_standing_choices_survive_a_zone_line() {
        let e = fold(&[
            r#"{"kind":"stanceChange","seq":0,"ts":1000,"raw":"s","stance":"offensive"}"#,
            r#"{"kind":"zone","seq":1,"ts":2000,"raw":"z","zone":"The Plane of Sky"}"#,
        ]);
        let snap = e.snapshot(2000, &SnapshotOpts::full(), None);
        assert_eq!(snap["stance"]["stance"], json!("offensive"));
        assert_eq!(snap["stance"]["stanceTs"], json!(1000));
    }

    /// The live stay's floor: a stay with no finalized encounter behind it has a span of ONE
    /// SECOND, not zero — `Math.max(1, …)` is the definition, not a guard.
    #[test]
    fn an_unstarted_stay_reports_a_one_second_span() {
        let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
        let snap = e.snapshot(10, &SnapshotOpts::full(), None);
        assert_eq!(snap["segments"][0]["durationSec"], json!(1.0));
        assert_eq!(snap["segments"][0]["dps"], json!(0.0));
        assert_eq!(snap["zoneSessions"].as_array().expect("live").len(), 1);
        assert_eq!(snap["zoneSessions"][0]["live"], json!(true));
        // ABSENT on the live entry, which has not ended at all.
        assert!(snap["zoneSessions"][0].get("closedBy").is_none());
    }

    /// With no landed sample every statistic is ABSENT rather than 0.
    #[test]
    fn a_slow_rollup_with_no_samples_states_no_statistics() {
        let e = fold(&[]);
        let snap = e.snapshot(0, &SnapshotOpts::full(), None);
        assert_eq!(
            snap["poison"]["slow"],
            json!({ "pulls": 0, "landed": 0, "noLand": 0, "window": 25 })
        );
    }

    /// The walk visits every zone session and every finalized fight, zone sessions first, and the
    /// whole-stay `kind: 'zone'` segment is SKIPPED on the fight pass (it is already the first
    /// zone-session entry).
    #[test]
    fn the_scope_walk_covers_the_zone_sessions_and_skips_the_zone_segment() {
        let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
        let scopes = e.walk_scopes(10, None);
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0]["kind"], json!("zoneSession"));
        assert_eq!(scopes[0]["id"], json!("zone"));
    }

    /// `EMPTY_ROSTER` is what an engine with no roster module registered publishes — and it is what
    /// five of the six recorded goldens carry verbatim.
    #[test]
    fn an_unwired_roster_seam_publishes_the_empty_roster() {
        let e = fold(&[]);
        let snap = e.snapshot(0, &SnapshotOpts::full(), None);
        assert_eq!(
            snap["roster"],
            json!({ "members": [], "seen": false, "lastSignalTs": 0 })
        );
    }
}
