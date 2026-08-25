//! `src/main/modules/alerts.ts` — the alert evaluator, folded for the two maps it keeps that have
//! NOTHING to do with firing.
//!
//! ── WHAT A FOLD OF THIS MODULE IS, AND WHAT IT IS NOT ──────────────────────────────────────────
//!
//! Over there this is a 900-line matcher: compiled `event`/`raw`/composite triggers, per-alert and
//! per-target cooldown clocks, capture groups, the `{target}` auto token, and the JOS-216
//! early-warning offset. NONE of it can run during a fold, and both reasons are structural rather
//! than incidental:
//!
//!   1. `onEvent` fires on LIVE events only — `if (!live) return`, the line above the loop — and
//!      the comment beside it is the law: "replay must never make a sound". `Fold` delivers
//!      `live: false` from the first byte to the last.
//!   2. THE DEF LIST IS EMPTY IN THIS WORLD. Alert defs are user preferences the settings store
//!      owns, and `foldArm.mts` injects none (`deps.alertDefs ?? []`), so `compiled` is empty and
//!      every loop over it is a no-op. That is what the goldens recorded: `defs: []` on all six
//!      slices, and `history: {}` beside it, because a history entry is written only by a fire.
//!
//! WHAT DOES FOLD, on replay events exactly as on live ones, is the pair of maps the file itself
//! flags as "recorded for REPLAY events too … so the map is complete the moment the renderer
//! hydrates". They are the whole of this port:
//!
//!   * `spellLastCast` — spell DISPLAY name (rank suffix INTACT: "Mesmerization III") → the newest
//!     ts you were seen to begin casting it. Rank-SENSITIVE on purpose and the one map in the alert
//!     system that stays so: it answers "which rank am I actually using", which is a question about
//!     ranks, and nothing downstream of it decides whether an alert fires. `castBegin` is the one
//!     event family that keeps the numeral — fizzle, interrupt and every wear-off line drop it.
//!   * `poisonSlowSeen` — the rogue slow-poison recency the "alert when a mob gets slowed?" offer
//!     is made from. Null until a slow has actually been observed: an offer is never made from an
//!     assumption about what class you are playing beside.
//!
//! ── THE TWO SEAMS THE WIRING INSTALLS, AND WHY NEITHER APPEARS BELOW ───────────────────────────
//!
//! `wiring.ts` line 228 hands this module a LAZY PULL — `setTimerRows(() => buildTimerRows(buffs
//! .snapshot().state, buffTimers.snapshot().state))` — which reaches across two modules registered
//! AFTER it and rebuilds the timer projection mid-fold. It is called from `onTick` and from
//! nowhere else, at most once per heartbeat and only while an early warning is actually armed; a
//! warning can only be armed by a LIVE MATCH against a compiled DEF. So the pull is not
//! reproduced here, and the reason it is safe not to is the same fact twice: no defs, no live.
//!
//! SINCE JOS-481 A LIVE ENGINE DOES TICK (`Fold::tick`, owner ruling 22), and this module still
//! implements no `on_tick` — which is now an argument rather than an absence. The early-warning
//! queue a tick would sweep is EMPTY BY CONSTRUCTION: `arm` is reachable only from the matcher, the
//! matcher runs only over `compiled`, and `compiled` is built from a def list this crate has no way
//! to receive. A tick here would sweep an empty queue and rebuild a projection nobody armed; the
//! `alerts.define` ticket (boundary verdict 3) turns both halves on together.
//! Reproducing the SHAPE would mean handing this module a shared, interior-mutable handle on two
//! modules the registry owns — a real structural cost, paid to reach code that provably cannot run.
//! Recorded as a judgment call rather than made silently.
//!
//! ── …AND SINCE JOS-482 THE MATCHER IS HERE AFTER ALL ──────────────────────────────────────────
//!
//! Both reasons above have been removed, one by each half of the cutover. `alerts.define` pushes
//! the user's own definitions in (boundary verdict 3: the store stays persistence truth, and the
//! engine never reads a settings file), and the LIVE TAIL delivers `live: true`. So `set_defs`
//! exists, the evaluator lives in `alerts_rules.rs`, and a live match leaves a [`Fire`] for the
//! ingest to put on the wire — owner ruling 22, which reduces the app-side alert system to
//! receive-fire-make-sound.
//!
//! **NOTHING ABOUT A HISTORICAL FOLD MOVED.** `on_event`'s live gate is where the TS keeps it, one
//! line above the loop, and the world this crate constructs by default still pushes no defs at all
//! — so the six-slice oracle sees the identical `defs: []` / `history: {}` it always has. The two
//! maps below are still the only thing a replay writes.
//!
//! The `setTimerRows` pull is still absent, and now for ONE reason rather than two: an alert that
//! carries an early-warning offset is compiled OUT (`alerts_rules.rs`'s header argues why an early
//! sound is worse than a missing one), so nothing here ever needs the timer projection.
//!
//! ── THE EVICTION IS THE ONLY PLACE MAP ORDER IS LOAD-BEARING ───────────────────────────────────
//!
//! `spellLastCast` is capped at 400 names and evicts the LEAST RECENTLY CAST, which is expressed as
//! "the first key in iteration order" — and it stays true only because every write DELETES the key
//! before re-inserting it, moving it to the tail. That is a JS `Map` insertion-order rule and it is
//! `JsMap`'s whole reason for existing. The published object's KEY order is not a claim (the bar is
//! deep equality), but WHICH KEY the cap threw away certainly is.

use super::alerts_rules::{Fire, RuleSet};
use crate::event::Event;
use crate::jsmap::JsMap;
use crate::{Defines, EqModule};
use eqlog::jsstr::js_trim;
use serde::Serialize;
use serde_json::{json, Value};

/// `SPELL_CAST_CAP` — max distinct spell display names kept in the rank-recency map. A character's
/// own cast vocabulary is well under 300 in the reference log; the cap is a bound, not a policy.
const SPELL_CAST_CAP: usize = 400;

/// `PoisonSlowRecency` — the observation the slow-poison offer is made from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PoisonSlowRecency {
    last_at: i64,
    count: i64,
    last_target: String,
}

#[derive(Default)]
pub struct AlertsModule {
    seq: i64,
    /// RANK-PRESERVING cast recency. See the header on why the iteration order matters.
    spell_last_cast: JsMap<i64>,
    poison_slow_seen: Option<PoisonSlowRecency>,
    /// THE USER'S OWN DEFINITIONS AND THE CLOCKS THEY FIRE UNDER (JOS-482). Empty until
    /// `alerts.define` pushes a set, which is every world this crate constructs on its own.
    rules: RuleSet,
    /// Fires accumulated since the ingest last drained them — `pending`, one indirection out.
    pending: Vec<Fire>,
}

impl AlertsModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// `noteCast` — runs for replay events as well as live ones; the map describes the CHARACTER,
    /// not the session.
    fn note_cast(&mut self, ev: &Event) {
        if ev.kind() != "castBegin" {
            return;
        }
        let name = js_trim(ev.str("spell").unwrap_or_default());
        if name.is_empty() {
            return;
        }
        let ts = ev.ts();
        // An out-of-order line (a stamp that went backwards) does not move the recency, and it
        // does not move the key's position either — the TS returns before the delete.
        if self
            .spell_last_cast
            .get(name)
            .is_some_and(|&prev| prev >= ts)
        {
            return;
        }
        // Re-insert so the iteration order stays least-recent-first for the eviction below.
        self.spell_last_cast.remove(name);
        self.spell_last_cast.insert(name.to_string(), ts);
        if self.spell_last_cast.len() > SPELL_CAST_CAP {
            let oldest = self
                .spell_last_cast
                .iter()
                .next()
                .map(|(k, _)| k.to_string());
            if let Some(k) = oldest {
                self.spell_last_cast.remove(&k);
            }
        }
    }

    /// `notePoisonSlow`. `effect` is the unambiguous half of a poison proc: the two shared emotes
    /// are shared between strikes that AGREE on their effect, so 'slow' is exactly Weakening
    /// Strike's landing and nothing else.
    fn note_poison_slow(&mut self, ev: &Event) {
        if ev.kind() != "poisonProc" || ev.str("effect") != Some("slow") {
            return;
        }
        let ts = ev.ts();
        let target = ev.str("target").unwrap_or_default().to_string();
        let prev_last_at = self.poison_slow_seen.as_ref().map_or(0, |p| p.last_at);
        let last_target = if ts >= prev_last_at {
            target.clone()
        } else {
            self.poison_slow_seen
                .as_ref()
                .map_or(target.clone(), |p| p.last_target.clone())
        };
        self.poison_slow_seen = Some(PoisonSlowRecency {
            last_at: prev_last_at.max(ts),
            count: self.poison_slow_seen.as_ref().map_or(0, |p| p.count) + 1,
            last_target,
        });
    }
}

impl EqModule for AlertsModule {
    fn id(&self) -> &'static str {
        "alerts"
    }

    /// Defs persist across character switches (they are user prefs, not log state); only the
    /// per-character bookkeeping resets. The cast-recency map IS character state — a different
    /// character casts different ranks — so it goes with it, and the replay that follows
    /// repopulates it.
    fn reset(&mut self) {
        self.seq = 0;
        self.spell_last_cast.clear();
        self.poison_slow_seen = None;
        // Only the per-character firing bookkeeping — the DEFS survive, exactly as the TS's do:
        // they are user preferences, not log state, and the app does not re-push them for a
        // rebirth. `RuleSet::reset` says which half goes.
        self.rules.reset();
        self.pending.clear();
    }

    /// NOTE WHAT IS NOT HERE: no `epoch` branch. The TS has none either, and it is a deliberate
    /// difference from every character-scoped module in cluster 2a — a rebirth behind the same
    /// name still casts the same spells, and the fires ledger is user-facing history. So this
    /// module's maps span the launch boundary, which the goldens pin on the two slices that cross
    /// it.
    fn on_event(&mut self, ev: &Event, live: bool) {
        self.seq = ev.seq();
        self.note_cast(ev);
        self.note_poison_slow(ev);
        // `if (!live) return`, above the matcher loop — THE BOUNDARY LAW, in the one place the TS
        // keeps it: replay must never make a sound. A historical fold therefore reaches no rule,
        // spends no cooldown and writes no history, which is what keeps the six-slice oracle
        // looking at the module it always looked at.
        if !live {
            return;
        }
        self.pending.append(&mut self.rules.fire(ev));
    }

    /// THE DIRTY BIT (JOS-487) — the same cursor `snapshot` publishes, without building the
    /// state to read it. See `EqModule::published_seq`.
    fn published_seq(&self) -> Option<i64> {
        Some(self.seq)
    }

    fn snapshot(&self) -> Value {
        let mut state = json!({
            // The user's alert definitions, which arrive from the settings store (`alerts.define`)
            // and never from the log. Empty in every world constructed without a push.
            "defs": self.rules.defs(),
            // Per-alert ring of recent fires. Written by a FIRE and by nothing else, so it is empty
            // through any historical fold.
            "history": self.rules.history(),
            "spellLastCast": self.spell_last_cast,
        });
        // Omitted rather than null: an absent key is the honest encoding of "no slow has ever been
        // observed for this character".
        if let Some(p) = &self.poison_slow_seen {
            state["poisonSlowSeen"] = serde_json::to_value(p).expect("a plain record");
        }
        json!({ "seq": self.seq, "state": state })
    }

    fn as_defines(&mut self) -> Option<&mut dyn Defines> {
        Some(self)
    }

    fn take_fires(&mut self) -> Vec<Fire> {
        std::mem::take(&mut self.pending)
    }
}

impl Defines for AlertsModule {
    fn family(&self) -> &'static str {
        "alerts"
    }

    /// `alertsModule.setDefs(list)` — the whole rule set, replaced. The payload is the `defs` ARRAY
    /// rather than the request's params object, because the family's knowledge IS the list; a
    /// payload that is not one leaves the previous set standing.
    fn define(&mut self, payload: &Value) {
        let Some(list) = payload.as_array() else {
            return;
        };
        self.rules.set_defs(list.clone());
    }
}
