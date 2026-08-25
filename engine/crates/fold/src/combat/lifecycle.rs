//! ENCOUNTER + ZONE-SESSION LIFECYCLE and the summary projections it produces —
//! `src/main/combat/lifecycle.ts`.
//!
//! This is the segmentation half of world-model law 7/8: what opens a fight, what closes one and on
//! what evidence, and what a finalized fight or zone session freezes into. The routing modules
//! decide WHERE a line lands; this decides WHEN a segment begins and ends.
//!
//! ── THE `Math.max(1, …)` IN EVERY DENOMINATOR IS NOT DEFENSIVE, IT IS THE DEFINITION ──────────
//!
//! `durationSec` is `Math.max(1, (lastTs - startTs) / 1000)` and `activeDps` divides by
//! `Math.max(1, activeSec)`. A one-line fight — one hit, one death — has a span of zero, and both
//! the wall DPS and the active DPS of such a fight are defined to be its total rather than an
//! infinity. The floor is therefore VISIBLE in the goldens: `patch-week`'s live zone summary reads
//! `durationSec: 1, total: 8574, dps: 8574`, which is the floor doing exactly this. A port that
//! guarded against division by zero some other way would produce a different number there.
//!
//! `activeSec` is `Math.min(dur, activeMs / 1000)` — the capped-gap active time can never exceed
//! the wall span, because a fight cannot be active for longer than it lasted.

use crate::combat::aggregate::Agg;
use crate::combat::state::EngineState;
use serde::Serialize;

/// One row of the snapshot's `segments` array — `shared/combat.ts SegmentSummary`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentSummary {
    pub id: String,
    pub kind: &'static str,
    pub name: String,
    /// The zone this segment happened in (raw display name). ABSENT — never null — when no
    /// `You have entered X.` line had been seen yet, which is a session that started mid-zone and
    /// is a question the log genuinely cannot answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    pub duration_sec: f64,
    pub total: i64,
    pub dps: f64,
    /// Active combat time (capped-gap sum) in seconds; never greater than `durationSec`.
    pub active_sec: f64,
    /// `total / activeSec` — active-time DPS.
    pub active_dps: f64,
    pub start_ts: i64,
    pub active: bool,
    /// Healing received by hostile instances during this segment (an annotation, not a total).
    pub enemy_heal_total: i64,
}

/// One row of the snapshot's `zoneSessions` array — `shared/combat.ts ZoneSessionSummary`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneSessionSummary {
    /// `zone` for the live session, else `zs<n>` for a finalized one.
    pub id: String,
    pub zone: String,
    /// ABSENT on the live entry, which has not ended at all — the `undefined`-is-omitted rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_by: Option<&'static str>,
    /// Epoch ms of the first attributed damage in this stay (0 if none / live-unstarted).
    pub start_ts: i64,
    /// Epoch ms of the last attributed damage; 0 for the still-live session.
    pub end_ts: i64,
    pub total: i64,
    pub dps: f64,
    pub live: bool,
}

/// The live zone stay's wall span in seconds, floored at 1 (see the module header).
pub fn zone_duration_sec(st: &EngineState) -> f64 {
    // The open encounter's span rides on top of the finalized total — the live half of the stay is
    // as real as the finalized halves. Zero while nothing is open, which is the whole of a fold
    // whose routing half is not ported yet.
    let cur = 0_i64;
    f64::max(1.0, (st.zone_finalized_ms + cur) as f64 / 1000.0)
}

/// The live zone stay's active seconds — finalized encounters' `activeMs` plus the open one's.
pub fn zone_active_sec(st: &EngineState) -> f64 {
    let cur = 0_i64;
    (st.zone_active_ms + cur) as f64 / 1000.0
}

/// The whole-stay row that `snapshot()` appends to `segments` after the fights.
pub fn zone_summary(st: &EngineState) -> SegmentSummary {
    let total = Agg::sum(&st.zone_agg.out);
    let dur = zone_duration_sec(st);
    let active_sec = f64::min(dur, zone_active_sec(st));
    SegmentSummary {
        id: "zone".to_string(),
        kind: "zone",
        name: format!("{} - overall", st.zone.as_deref().unwrap_or("Session")),
        zone: st.zone.clone(),
        duration_sec: dur,
        total,
        dps: total as f64 / dur,
        active_sec,
        active_dps: total as f64 / f64::max(1.0, active_sec),
        start_ts: 0,
        active: false,
        enemy_heal_total: Agg::sum_heal(&st.zone_agg.enemy_heal),
    }
}

/// The zone-session list for the snapshot: the LIVE session first (id `zone`), then the finalized
/// history NEWEST-FIRST. The live entry's timing and total are computed fresh; the finalized ones
/// reuse what was frozen at finalize, because their aggregates are immutable.
pub fn zone_session_summaries(st: &EngineState) -> Vec<ZoneSessionSummary> {
    let live_total = Agg::sum(&st.zone_agg.out);
    let live_dur = zone_duration_sec(st);
    let mut out = vec![ZoneSessionSummary {
        id: "zone".to_string(),
        zone: st.zone.clone().unwrap_or_else(|| "Session".to_string()),
        closed_by: None,
        start_ts: st.zone_start_ts,
        end_ts: 0,
        total: live_total,
        dps: live_total as f64 / live_dur,
        live: true,
    }];
    for s in st.zone_history.iter().rev() {
        let total = Agg::sum(&s.agg.out);
        let dur_sec = f64::max(1.0, s.finalized_ms as f64 / 1000.0);
        out.push(ZoneSessionSummary {
            id: s.id.clone(),
            zone: s.zone.clone(),
            closed_by: Some(s.closed_by.as_str()),
            start_ts: s.start_ts,
            end_ts: s.last_ts,
            total,
            dps: total as f64 / dur_sec,
            live: false,
        });
    }
    out
}
