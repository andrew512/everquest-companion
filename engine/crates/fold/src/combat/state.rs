//! The combat engine's MUTABLE STATE — `src/main/combat/state.ts`.
//!
//! Extracted over there so the routing / lifecycle / view modules could be plain functions over one
//! explicit state object instead of methods on a 1,400-line class, and kept that shape here for the
//! same reason. `CombatEngine` (mod.rs) owns exactly one of these and is a thin facade over it.
//!
//! ── THREE FACTS ABOUT A HISTORICAL FOLD THAT DELETE MOST OF THIS FILE'S LIVE HALF ──────────────
//!
//! These are not simplifications taken for convenience; they are properties of the run the goldens
//! were recorded under (`foldArm.mts construct()` + `goldenOracle.mts buildSnapshots`), and each one
//! is checkable against the recorded artifact rather than asserted:
//!
//!   1. `hydrating` IS TRUE FOR THE WHOLE FOLD, on all six slices (verified in every
//!      `<slice>.snapshots.json`: `combat.hydrating === true`). `setLive()` is what clears it and
//!      the golden recorder never calls it — there is no live tail behind a recorded slice. So the
//!      whole snapshot-time sweep block (`sweepCharm`, `sweepAlly`, `petNudge.sweep`, `evalClosure`
//!      at `now`) is SKIPPED by the gate at `engine.ts:377`, and `now` is used for nothing but the
//!      `inCombat` freshness test and the summaries' `active` flag. This is JOS-208 phase 4's rule:
//!      a replay is not a moment in time.
//!   2. `recording` IS FALSE FOR THE WHOLE FOLD, for the same reason (`setLive()` sets both). So
//!      `st.log(…)` — the classification ring — is a no-op from the first byte to the last, and
//!      `recent` is `[]` in every one of the six goldens. The ring is therefore not ported at all:
//!      porting a buffer that provably never receives a line would be inventing a code path.
//!   3. NO SESSION MARK CAN ENTER. `sessionMark` refuses while hydrating, and a mark is a user
//!      action stored nowhere — so `closedBy` is `'zone'` on every zone session in every golden,
//!      and `unsplit()` has no boundary to remove.
//!
//! ── AND THREE SEAMS THE GOLDEN'S CONSTRUCTION DOES NOT INSTALL ─────────────────────────────────
//!
//! The ticket names five construction calls; `foldArm.mts construct()` — which is what actually
//! recorded the goldens — makes THREE of them: `setRoster(modules.roster)`, `reset()`,
//! `setPlayerName(character.name)`. It does NOT call `setCombo`, `setDerivedEmitter` or
//! `setHeldClickies`. That is not an oversight to be corrected here: the golden IS the bar, and
//! wiring a seam the recorder left unwired would make this fold fold something the TS did not.
//! Each absence is a documented behaviour rather than a gap — `comboProvider` returning null means
//! the class-swap coat clear never fires, an unwired `emitDerived` makes every emit site a no-op
//! (the buffs module's own precedent), and an empty held-clicky set makes `castlessKind` the
//! identity function so not one lane name moves.

use crate::combat::aggregate::Agg;
use crate::combat::encounter::{ZoneSession, ZoneSessionClose};
use crate::combat::roster::{RosterSnap, RosterSource};
use eqlog::names::id_key;

/// One half of the combat-modifier pair — the last stance (or invocation) the player committed to,
/// with the ts of that commit. SESSION-scoped: a stance is not tied to a zone, so it survives every
/// zone line and the epoch boundary alike, and only `reset()` clears it.
#[derive(Debug, Clone)]
pub struct Modifier {
    pub name: String,
    pub ts: i64,
}

/// Everything the engine folds into. Field-for-field with `state.ts` for what is ported; see the
/// module header for what a historical fold makes unreachable and why it is therefore absent.
pub struct EngineState {
    /// The player's own proper name key (e.g. `"primitive"`). INJECTED by `setPlayerName` from the
    /// slice filename, which is the authoritative source and wins over any heal-line-learned name.
    pub player_key: Option<String>,
    /// True once `setPlayerName` injected the name, so heal-based learning cannot overwrite it.
    pub player_key_injected: bool,
    /// Canonical name keys of entities known to be PLAYERS. Seeded with the tailed character.
    pub known_players: std::collections::HashSet<String>,

    pub zone: Option<String>,
    pub seq: u64,
    pub history_len: usize,
    pub zone_agg: Agg,
    pub zone_finalized_ms: i64,
    pub zone_active_ms: i64,
    /// First/last attributed-damage ts in the LIVE zone session (0 = none yet).
    pub zone_start_ts: i64,
    pub zone_last_ts: i64,
    /// Capped finalized-zone-session history. Newest last; the live `zone_agg` is NOT in here.
    pub zone_history: Vec<ZoneSession>,
    pub zone_seq: u64,

    /// See the module header, fact 1. True from construction until `setLive()`, which a historical
    /// fold never calls — so it is true for the whole of every recorded slice, and the snapshot
    /// carries it so the UI renders a loading state instead of a churning fake-live meter.
    pub hydrating: bool,
    /// See the module header, fact 2. False for the whole of a historical fold, which is what makes
    /// the classification ring a no-op and `recent` empty in all six goldens.
    pub recording: bool,

    pub stance: Option<Modifier>,
    pub invocation: Option<Modifier>,

    /// ROLLING TIME-TO-SLOW samples, newest last, capped at `SLOW_SAMPLE_CAP`. One entry per
    /// FINALIZED pull that opened with a slow-capable coat on: the ms to the first slow landing, or
    /// `None` when the pull ended without one. The `None`s are the whole reason this is a list of
    /// samples rather than a running mean — they are COUNTED (`noLand`) and never averaged in as
    /// zero, because "0 ms to slow" would be a lie about a thing that never happened.
    pub slow_samples: Vec<Option<i64>>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineState {
    pub fn new() -> Self {
        EngineState {
            player_key: None,
            player_key_injected: false,
            known_players: std::collections::HashSet::new(),
            zone: None,
            seq: 0,
            history_len: 0,
            zone_agg: Agg::new(),
            zone_finalized_ms: 0,
            zone_active_ms: 0,
            zone_start_ts: 0,
            zone_last_ts: 0,
            zone_history: Vec::new(),
            zone_seq: 0,
            hydrating: true,
            recording: false,
            stance: None,
            invocation: None,
            slow_samples: Vec::new(),
        }
    }

    /// `reset()` — a reset always precedes a fresh full-log scan (startup or a character switch),
    /// so we are hydrating again until that scan hands off to a tail that, in this fold, never
    /// comes.
    pub fn reset(&mut self) {
        let injected = self.player_key.clone().filter(|_| self.player_key_injected);
        *self = EngineState::new();
        // `setPlayerName` is called AFTER `reset()` by every construction path (`foldArm.mts`
        // construct(), `pipeline.ts`), so this only ever matters for a reset that arrives later —
        // and there the name is still this character's. Re-seeding rather than dropping it keeps
        // the two orderings from meaning different things.
        if let Some(name) = injected {
            self.player_key = Some(name.clone());
            self.player_key_injected = true;
            self.known_players.insert(name);
        }
    }

    /// Inject the player's own character name. Keyed canonically so it matches the `idKey()` the
    /// heal path uses. Wins over any heal-line-learned name.
    pub fn set_player_name(&mut self, name: &str) {
        let key = id_key(name);
        self.known_players.insert(key.clone());
        self.player_key = Some(key);
        self.player_key_injected = true;
    }

    /// The roster as the SNAPSHOT serializes it. A pull, never a stored copy: the roster module has
    /// already folded the same bus event by the time the engine is handed it, and a user edit made
    /// between two log lines must reach the very next one. With no roster module registered this is
    /// `EMPTY_ROSTER`, which is precisely what `rosterSnapProvider`'s default returns.
    pub fn roster_snap(&self, roster: Option<&dyn RosterSource>) -> RosterSnap {
        roster.map_or_else(RosterSnap::empty, RosterSource::snap)
    }

    /// Freeze the LIVE zone aggregate into the capped history, called on a zone change (and on the
    /// epoch boundary) BEFORE the aggregate is reset, so the just-left zone's overall meter stays
    /// selectable. Drops a stay that saw no attributed damage — nothing to show.
    pub fn finalize_zone_session(&mut self, closed_by: ZoneSessionClose) {
        if self.zone_agg.is_empty() {
            return;
        }
        self.zone_seq += 1;
        let id = format!("zs{}", self.zone_seq);
        let zone = self.zone.clone().unwrap_or_else(|| "Session".to_string());
        let agg = std::mem::replace(&mut self.zone_agg, Agg::new());
        self.zone_history.push(ZoneSession {
            id,
            zone,
            agg,
            closed_by,
            start_ts: self.zone_start_ts,
            last_ts: self.zone_last_ts,
            finalized_ms: self.zone_finalized_ms,
            active_ms: self.zone_active_ms,
        });
        if self.zone_history.len() > crate::combat::encounter::ZONE_HISTORY_CAP {
            self.zone_history.remove(0);
        }
    }

    /// MINT FRESH ZONE ACCUMULATORS — the second half of every stay boundary, its own function
    /// because there are two callers and one of them must not be allowed to drift: the zone line
    /// and the session mark. THE MARK IS THIS AND NOTHING ELSE; everything the zone case does
    /// besides this pair is a statement about the ROOM changing.
    pub fn reset_zone_accumulators(&mut self) {
        self.zone_agg = Agg::new();
        self.zone_finalized_ms = 0;
        self.zone_active_ms = 0;
        self.zone_start_ts = 0;
        self.zone_last_ts = 0;
    }
}
