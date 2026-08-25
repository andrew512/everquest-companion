//! The engine's AGGREGATION primitives — `src/main/combat/aggregate.ts`.
//!
//! Everything here is pure accumulation over a SEGMENT (an encounter or a zone session):
//! per-source / per-category / per-skill damage stats, the accuracy and resist counters, the
//! melee-rounds heuristic, the proc ledger, and the `Agg` that binds them together with the
//! healing ledger. No engine state, no world model, no time — the state machine that decides WHICH
//! aggregate a line belongs to is `routing.rs`'s job, not this file's.
//!
//! ── WHAT IS PORTED HERE TODAY, AND WHAT IS NOT (JOS-477, honest scope) ─────────────────────────
//!
//! The SHAPE below is the sums half: `out` / `inc` / `targets` / `enemyHeal`, and the three
//! reducers (`sumMap`, `sumHeal`) that every segment summary and zone-session summary is built out
//! of. That is exactly what the ported half of the engine can currently fill, and the fields it
//! does not fill are ABSENT rather than stubbed — an accumulator with a `bySkill` map nothing ever
//! writes would be a shape claiming a capability the fold does not have, and the whole point of
//! the ledger in `rustParity.mts` is that the gap is COUNTED rather than papered over.
//!
//! THE ORDER OF `out` IS PUBLISHED and so is `inc`'s. `sourceViews.ts` turns both into ARRAYS, and
//! array order is a claim the comparator checks — so these are `JsMap`s (insertion-ordered, JS
//! `Map` semantics) and never `HashMap`s. `targets`'s order is published twice over: `encounterName`
//! reads `[...e.agg.targets.values()]` and sorts it by amount, and a sort in JS is STABLE, so two
//! targets that absorbed exactly the same damage are named in the order they were first struck.

use crate::jsmap::JsMap;

/// One row of the meter: a source (you, a pet, a group-mate, an enemy) and what it did.
///
/// ONLY `name` / `kind` / `total` TODAY — see the module header. `hits`, the miss breakdown, the
/// per-skill and per-category maps and the round/modifier/proc accumulators are the unported half
/// and are not declared here, because a field that is never written is not a port.
#[derive(Debug, Clone)]
pub struct SourceStat {
    pub name: String,
    pub kind: &'static str,
    pub total: i64,
}

/// A damage total booked against a named entity — the `targets` and `enemyHeal` row shape.
#[derive(Debug, Clone)]
pub struct NamedTotal {
    pub name: String,
    pub amount: i64,
}

/// The per-segment aggregate. Keyed by INSTANCE id (or `you` / `pet:<instanceId>`); `name` holds
/// the display spelling, refreshed on every arrival because the log's latest spelling wins
/// (world-model law 2).
#[derive(Debug, Default)]
pub struct Agg {
    pub out: JsMap<SourceStat>,
    pub inc: JsMap<SourceStat>,
    pub targets: JsMap<NamedTotal>,
    /// Healing received by hostile instances engaged here (instanceId -> total).
    pub enemy_heal: JsMap<NamedTotal>,
}

impl Agg {
    pub fn new() -> Self {
        Agg::default()
    }

    /// Sum of a source map's totals — `sumMap`. The DPS numerator for a segment, and the one
    /// number every summary in `lifecycle.rs` is built around.
    pub fn sum(map: &JsMap<SourceStat>) -> i64 {
        map.values().map(|s| s.total).sum()
    }

    /// Sum of a heal map's amounts — `sumHeal`.
    pub fn sum_heal(map: &JsMap<NamedTotal>) -> i64 {
        map.values().map(|t| t.amount).sum()
    }

    /// True when this aggregate recorded nothing at all. The DROP RULE both `finalizeCurrent` and
    /// `finalizeZoneSession` are gated on: a CC application or a lone miss can open an encounter
    /// that never accrues attributed damage — a mez lands and somebody else kills the mob — and a
    /// 0-damage shell must not pollute the history or the zone-session picker.
    pub fn is_empty(&self) -> bool {
        self.out.is_empty() && self.inc.is_empty()
    }
}
