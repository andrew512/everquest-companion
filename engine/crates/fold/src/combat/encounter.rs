//! The engine's ENCOUNTER / ZONE-SESSION record types and the tuning constants that govern
//! segmentation — `src/main/combat/encounter.ts`. Pure data shapes and numbers; nothing here
//! reads or mutates engine state.
//!
//! ── WHY THE NUMBERS ARE WHAT THEY ARE (the TS header's argument, in full) ───────────────────────
//!
//! Closure is decided on TWO INDEPENDENT AXES, and conflating them was the multi-mob-pull split
//! bug the TS calls Task #55:
//!
//!   TIMING (damage only) — `LINGER_MS` is measured against the encounter's last ATTRIBUTED
//!     DAMAGE. Once every engaged hostile is gone, wait this long with no new damage before
//!     finalizing AT THE LAST DAMAGE TS: the linger absorbs the trailing DoT tick and the cleanup
//!     swing. Nothing else may touch this clock — firstHit/lastHit/DPS/activeMs are damage-derived.
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
//! engaged instance still alive?", and "has anything at all happened?" is a different question.
//! One unrefreshed hold used to defeat every path and pin a fight open for two silent minutes.
//!
//! `ZONE_HISTORY_CAP` is 24 and the number is BORROWED rather than chosen: a session mark mints an
//! entry here too, and the marks are bounded by `shared/sessionSegments.MAX_SESSION_MARKS = 24`.
//! Two rings holding two halves of the same click at two different depths would let the loot picker
//! offer a session the meter had already dropped.

use crate::combat::aggregate::Agg;

/// Why a zone session stopped accruing. `'zone'` — you walked through a zone line (or the epoch
/// boundary did it for you). `'mark'` — the user pressed "New session".
///
/// IT IS THE MERGE-BACK ELIGIBILITY TEST, which is why it lives on the record rather than being
/// inferred: a split the USER made is reversible (two halves of one uninterrupted stay in one
/// room) and a boundary the WORLD made is not. A historical fold never produces `Mark` — a mark is
/// refused while hydrating (`engine.ts sessionMark`), which is what makes replay determinism
/// structural — so this fold only ever writes `Zone`. The variant is spelled anyway because
/// `zoneSessionWord` and the serialized `closedBy` both read it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZoneSessionClose {
    Zone,
    Mark,
}

impl ZoneSessionClose {
    /// The serialized spelling — `'zone'` / `'mark'`.
    pub fn as_str(self) -> &'static str {
        match self {
            ZoneSessionClose::Zone => "zone",
            ZoneSessionClose::Mark => "mark",
        }
    }
}

/// A finalized ZONE SESSION. When the player zones, the live `zoneAgg` is FROZEN into one of these
/// (kept in a capped ring) rather than discarded, so a past zone's overall meter is still
/// selectable. Holds the frozen aggregate, the timing, the accumulated durations, and a summary
/// memoized at finalize — the aggregate is immutable thereafter, so recomputing it would be work
/// that can only produce the same answer.
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
    /// Sum of finalized-encounter `activeMs`.
    pub active_ms: i64,
}

// ── The segmentation constants, verbatim from encounter.ts ────────────────────────────────────
pub const LINGER_MS: i64 = 5_000;
pub const PRESENCE_GONE_MS: i64 = 20_000;
pub const FALLBACK_IDLE_MS: i64 = 60_000;
pub const CC_HOLD_MS: i64 = 120_000;
/// Per-hit active-time cap AND the "in combat" freshness window.
pub const ACTIVE_MS: i64 = 3_000;
pub const ZONE_HISTORY_CAP: usize = 24;
/// How many recent QUALIFYING pulls (a slow-capable coat on at engage) the rolling time-to-slow
/// ring keeps. Small on purpose: it answers "how is my poison doing right now", not "average my
/// whole evening's loadouts together".
pub const SLOW_SAMPLE_CAP: usize = 25;
