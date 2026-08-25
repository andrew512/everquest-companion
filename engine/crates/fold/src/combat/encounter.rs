//! The engine's ENCOUNTER / ZONE-SESSION record types, the tuning constants that govern
//! segmentation, and the encounter NAMING rule — `src/main/combat/encounter.ts`. Pure data shapes
//! and numbers; nothing here reads or mutates engine state.
//!
//! ── WHY THE NUMBERS ARE WHAT THEY ARE ─────────────────────────────────────────────────────────
//!
//! Closure is decided on TWO INDEPENDENT AXES, and conflating them was the multi-mob-pull split bug:
//!
//!   TIMING (damage only) — `LINGER_MS` is measured against the encounter's last ATTRIBUTED DAMAGE.
//!     Once every engaged hostile is gone, wait this long with no new damage before finalizing AT
//!     THE LAST DAMAGE TS: the linger absorbs the trailing DoT tick and the cleanup swing. Nothing
//!     else may touch this clock — firstHit/lastHit/DPS/activeMs are damage-derived.
//!   PRESENCE (any evidence) — whether an engaged instance is still IN the fight, refreshed by any
//!     observation of it: landed damage, misses in either direction, resists, CC, heals it gives or
//!     receives. Presence never OPENS or EXTENDS an encounter; it only vetoes closing one.
//!
//! `PRESENCE_GONE_MS` is deliberately 4x `LINGER_MS` because real fights go quiet for many seconds
//! at a time — miss/dodge/parry streaks land nothing, a mob's cast phase produces no swings, a
//! player stun stops YOUR damage — and a genuinely fled mob still closes at `FALLBACK_IDLE_MS`,
//! three times sooner than waiting the presence window out would take.
//!
//! `CC_HOLD_MS` exceeds `FALLBACK_IDLE_MS` on purpose so an ACTIVELY refreshed mez holds a fight
//! open, and the hold vetoes ONLY the death-close, never closure as such: it answers "is this
//! engaged instance still alive?", and "has anything at all happened?" is a different question. One
//! unrefreshed hold used to defeat every path and pin a fight open for two silent minutes.
//!
//! `ZONE_HISTORY_CAP` is 24 and the number is BORROWED rather than chosen: a session mark mints an
//! entry here too, and the marks are bounded by `shared/sessionSegments.MAX_SESSION_MARKS = 24`. Two
//! rings holding two halves of the same click at two different depths would let the loot picker
//! offer a session the meter had already dropped.

use crate::combat::aggregate::Agg;
use crate::jsmap::JsMap;
use std::collections::HashSet;

/// Why a zone session stopped accruing. `Zone` — you walked through a zone line (or the epoch
/// boundary did it for you). `Mark` — the user pressed "New session".
///
/// IT IS THE MERGE-BACK ELIGIBILITY TEST, which is why it lives on the record rather than being
/// inferred: a split the USER made is reversible (two halves of one uninterrupted stay in one room)
/// and a boundary the WORLD made is not. A historical fold never produces `Mark` — a mark is refused
/// while hydrating, which is what makes replay determinism structural — so this fold only ever
/// writes `Zone`. The variant is spelled anyway because the serialized `closedBy` reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoneSessionClose {
    Zone,
    Mark,
}

impl ZoneSessionClose {
    pub fn as_str(self) -> &'static str {
        match self {
            ZoneSessionClose::Zone => "zone",
            ZoneSessionClose::Mark => "mark",
        }
    }
}

/// A finalized ZONE SESSION. When the player zones, the live zone aggregate is FROZEN into one of
/// these (kept in a capped ring) rather than discarded, so a past zone's overall meter is still
/// selectable.
#[derive(Debug)]
pub struct ZoneSession {
    pub id: String,
    pub zone: String,
    pub agg: Agg,
    pub closed_by: ZoneSessionClose,
    /// First/last attributed-damage ts. 0 means the session saw none — and those are dropped.
    pub start_ts: i64,
    pub last_ts: i64,
    /// Sum of finalized-encounter wall durations (ms) — the DPS denominator.
    pub finalized_ms: i64,
    /// Sum of finalized-encounter `active_ms`.
    pub active_ms: i64,
}

/// One in-progress or finalized FIGHT.
#[derive(Debug)]
pub struct Encounter {
    pub id: String,
    /// The zone this fight happened in, stamped at open from the engine's `zone`. ABSENT — never
    /// null — for a session that started mid-zone.
    pub zone: Option<String>,
    pub start_ts: i64,
    pub last_ts: i64,
    pub agg: Agg,
    /// Instance ids engaged as HOSTILES. The ONE thing that can veto closure.
    pub engaged: HashSet<String>,
    /// instanceId → ts we last saw ANY evidence this instance is still in the fight. THE PRESENCE
    /// AXIS, deliberately distinct from the damage timeline: landed damage refreshes it, but so do
    /// misses in either direction, resists, CC and heals involving the instance — a mob that whiffs
    /// for eight seconds, or spends them casting, is emphatically still here. It drives ONLY the
    /// "gone" staleness in `eval_closure`; it never feeds firstHit/lastHit/DPS/activeMs.
    pub engaged_seen: JsMap<i64>,
    /// Active-combat time accumulator (ms): on each attributed damage hit we add
    /// `min(ts - prev_damage_ts, ACTIVE_MS)`. The first hit adds 0.
    pub active_ms: i64,
    /// ts of the previous attributed damage hit, for the `active_ms` delta.
    pub prev_damage_ts: Option<i64>,
    /// instanceId → epoch-ms until which this engaged instance is CC-held. While any engaged
    /// instance is alive (CC'd instances count as alive) the encounter stays OPEN regardless of
    /// damage gaps — the mez-and-wait case.
    pub cc_active_until: JsMap<i64>,
    /// Display name of the MOST RECENT outgoing-damage target, for the LIVE encounter name: while a
    /// fight is open its name tracks whatever you are currently swinging at. On FINALIZE the name
    /// switches to the largest target. `None` until the first outgoing hit lands.
    pub last_out_target: Option<String>,
    /// The finalized fight's memoized summary, computed once at finalize because the aggregate is
    /// immutable thereafter. Recomputing it for every history entry on every snapshot was the
    /// dominant snapshot cost.
    pub summary: Option<crate::combat::lifecycle::SegmentSummary>,
}

impl Encounter {
    pub fn new(id: String, zone: Option<String>, ts: i64) -> Encounter {
        Encounter {
            id,
            zone,
            start_ts: ts,
            last_ts: ts,
            agg: Agg::new(),
            engaged: HashSet::new(),
            engaged_seen: JsMap::new(),
            active_ms: 0,
            prev_damage_ts: None,
            cc_active_until: JsMap::new(),
            last_out_target: None,
            summary: None,
        }
    }
}

// ── The segmentation constants, verbatim from encounter.ts ────────────────────────────────────
pub const LINGER_MS: i64 = 5_000;
pub const PRESENCE_GONE_MS: i64 = 20_000;
pub const FALLBACK_IDLE_MS: i64 = 60_000;
pub const CC_HOLD_MS: i64 = 120_000;
/// Per-hit active-time cap AND the "in combat" freshness window.
pub const ACTIVE_MS: i64 = 3_000;
pub const ZONE_HISTORY_CAP: usize = 24;
/// How many recent QUALIFYING pulls (a slow-capable coat on at engage) the rolling time-to-slow ring
/// keeps. Small on purpose: it answers "how is my poison doing right now", not "average my whole
/// evening's loadouts together".
pub const SLOW_SAMPLE_CAP: usize = 25;

/// THE NAME OF AN ENCOUNTER. Two modes:
///
///   `live = false` (FINALIZED, or any non-current view) — named after the LARGEST target, the mob
///     that absorbed the most damage. The log has no HP, so "most damage absorbed" is a LABELED
///     proxy for "the thing we were killing" (world-model law 6).
///   `live = true` (the CURRENT open fight) — named after whatever you are presently swinging at, so
///     a live pull is labeled by the mob in front of you rather than retroactively by whichever twin
///     ended up taking the most damage.
///
/// Both keep the `+N` suffix counting the OTHER distinct engaged targets.
///
/// THE SORT IS STABLE, and that is load-bearing rather than incidental: `Array.prototype.sort` is
/// stable in every engine this ships on, so two targets that absorbed exactly the same damage are
/// named in the order they were FIRST STRUCK. `sort_by` is Rust's stable sort, which is the same
/// guarantee; `sort_unstable_by` would silently pick a different winner on a tie.
pub fn encounter_name(e: &Encounter, live: bool) -> String {
    let targets: Vec<&crate::combat::aggregate::NamedTotal> = e.agg.targets.values().collect();
    if targets.is_empty() {
        return "Combat".to_string();
    }
    let others = targets.len() - 1;
    let suffix = if others > 0 {
        format!(" +{others}")
    } else {
        String::new()
    };
    if live {
        if let Some(name) = &e.last_out_target {
            return format!("{name}{suffix}");
        }
    }
    let mut ranked = targets;
    ranked.sort_by_key(|t| std::cmp::Reverse(t.amount));
    format!("{}{}", ranked[0].name, suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc_with(targets: &[(&str, i64)]) -> Encounter {
        let mut e = Encounter::new("e1".into(), None, 0);
        for (name, amount) in targets {
            e.agg.bump_target(name, name, *amount);
        }
        e
    }

    /// A fight with no target at all is `Combat` — the honest answer when nothing was struck.
    #[test]
    fn a_fight_that_struck_nothing_is_called_combat() {
        assert_eq!(
            encounter_name(&Encounter::new("e1".into(), None, 0), false),
            "Combat"
        );
    }

    /// FINALIZED names after the largest target and counts the others.
    #[test]
    fn a_finalized_fight_is_named_after_the_largest_target() {
        let e = enc_with(&[("a bat", 100), ("a spite golem", 500), ("a rat", 20)]);
        assert_eq!(encounter_name(&e, false), "a spite golem +2");
    }

    /// A TIE keeps the order the targets were FIRST STRUCK in — the stable-sort property.
    #[test]
    fn a_tie_is_broken_by_which_target_was_struck_first() {
        let e = enc_with(&[("a bat", 100), ("a spite golem", 100)]);
        assert_eq!(encounter_name(&e, false), "a bat +1");
        let e = enc_with(&[("a spite golem", 100), ("a bat", 100)]);
        assert_eq!(encounter_name(&e, false), "a spite golem +1");
    }

    /// LIVE names after whatever you are presently swinging at, and falls back to the largest target
    /// when nothing outgoing has landed yet.
    #[test]
    fn a_live_fight_is_named_after_the_current_target() {
        let mut e = enc_with(&[("a bat", 100), ("a spite golem", 500)]);
        assert_eq!(encounter_name(&e, true), "a spite golem +1");
        e.last_out_target = Some("a bat".into());
        assert_eq!(encounter_name(&e, true), "a bat +1");
        // …and the finalized name is unmoved by it.
        assert_eq!(encounter_name(&e, false), "a spite golem +1");
    }
}
