//! `main/log/sessionDetector.ts`, ported — the SECOND derived event, and cluster 2c's to bring.
//!
//! WHY IT IS HERE NOW AND WAS NOT IN 2a. The 2a worker recorded a proof beside `epoch.rs`: no
//! module in that cluster reads `offlineGap`, so synthesizing it could not move one of their
//! snapshots. That proof does not survive this cluster. `modules/buffs.ts` folds the kind outright
//! (`onEvent`'s third branch): a gap PAUSES every beneficial buff by the length of the absence and
//! clears the pet bindings, so a fold that never emitted one would run every post-login buff's
//! clock through hours the character was not in the world, and `active[].startedTs` — a published
//! field — would be wrong for the rest of the log. `modules/buffTimers.ts` reads it too, to say
//! explicitly that it does nothing with it (its early return also keeps the derived restatement
//! out of `lastEventTs`, which is a real difference from ignoring the kind). The other four of
//! this cluster — alerts, consider, resist, eventFeed — never name it; they were read rather than
//! assumed.
//!
//! ── THE ANCHOR IS EVIDENCE, NOT A WINDOW (JOS-262) ─────────────────────────────────────────────
//!
//! The obvious rule — "the absence ran from the last event before the `Welcome to EverQuest
//! Legends!` line" — is wrong, and wrong SILENTLY. Every login prints a reconnect preamble first,
//! because the client is already on the chat servers while the character is still being placed in
//! the world: channel joins, adventure notices, and (measured) other players' kills seconds before
//! the Welcome. A last-event anchor read a 13h43m absence as six seconds.
//!
//! So `fromTs` is the newest event that could ONLY have been printed because THIS CHARACTER WAS IN
//! THE WORLD — {@link in_world_evidence}. Three groups: the FIRST-PERSON families, which the log
//! has no third-person grammar for at all; the NAMED families (a swing, a heal, a resist, a death),
//! which count only when they name you; and everything else, which is refused. Somebody else's kill
//! proves the CLIENT is connected; only a line about you proves your CHARACTER is in the world.
//!
//! THE COST IS STATED RATHER THAN PAPERED OVER: `fromTs` is a LOWER bound on the last instant the
//! character is known to be in the world, so a reported gap never under-states the absence and can
//! over-state it by the trailing run of lines that name nobody. The ordinary case is the camp
//! countdown (24 s, because the five `It will take about N more seconds…` ticks are deliberately
//! `unknown`); the worst measured case is an AFK park of 56 minutes. Nothing downstream may treat
//! the number as exact, and the buffs model's mining censor drops rather than adjusts any sample
//! that spans a gap for precisely this reason.

use crate::event::Event;
use eqlog::names::id_key;
use serde_json::json;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Minimum absence worth reporting. Below this a relog is a BLIP: the four sub-minute relogs in
/// the owner's log measure 30–34 s and are exactly the noise this suppresses.
pub const OFFLINE_GAP_MIN_MS: i64 = 60_000;

/// How close a non-aborted `campStart` must sit to `fromTs` for the logout to count as CAMPED. A
/// camp takes ~30 s, so 60 s is the comfortable read — and since the anchor change the two are
/// usually the SAME INSTANT and the window is not even exercised.
pub const CAMP_PAIRING_MS: i64 = 60_000;

/// `FIRST_PERSON_KINDS` — the families the log prints no third-person twin of, so the sentence can
/// only be about the tailed character. `petClaim` is a member because BOTH its shapes name you;
/// the ally form has been its own kind since JOS-250 and is deliberately absent.
fn first_person_kinds() -> &'static HashSet<&'static str> {
    static KINDS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    KINDS.get_or_init(|| {
        [
            "sessionStart",
            "zone",
            "loot",
            "coin",
            "itemReceived",
            "purchase",
            "offer",
            "trade",
            "level",
            "expGain",
            "aaGain",
            "aaSpend",
            "aaPotion",
            "aaActivate",
            "castBegin",
            "castFizzle",
            "castInterrupted",
            "castResumed",
            "buffFade",
            "buffWearOff",
            "illusionFade",
            "playerDeath",
            "healUnstated",
            "mitigation",
            "campStart",
            "campAbort",
            "outputFile",
            "selfWho",
            "skillUp",
            "specialAttack",
            "classUnlock",
            "itemActivate",
            "itemMerge",
            "itemMergeFailed",
            "consider",
            "stanceChange",
            "invocationChange",
            "petClaim",
        ]
        .into_iter()
        .collect()
    })
}

/// `isYou` — the canonical key the log writes for the tailed character in every name position.
fn is_you(name: Option<&str>) -> bool {
    name.is_some_and(|n| id_key(n) == "you")
}

/// `combatNamesYou` — the families that exist for everyone, so the event's own fields decide.
fn combat_names_you(ev: &Event) -> bool {
    match ev.kind() {
        "damage" | "miss" => is_you(ev.str("attacker")) || is_you(ev.str("target")),
        "heal" => is_you(ev.str("healer")) || is_you(ev.str("target")),
        // The incoming form (`You resist <mob>'s <Spell>!`) names you as the resister.
        "resist" => ev.bool("incoming") || is_you(ev.str("caster")) || is_you(ev.str("target")),
        // `You have slain <X>!`. The other two shapes are somebody else's kill (or nobody's).
        "death" => ev.bool("bySelf"),
        _ => false,
    }
}

/// `selfFormOf` — families with a SELF form and a broadcast form; only the self form is about you.
fn self_form_of(ev: &Event) -> bool {
    match ev.kind() {
        // A `msg_cast_on_you` match. A NAMED target is the third-person broadcast, which every
        // player in earshot receives — including one who is not in the world yet.
        "buffApply" => ev.str("target") == Some("self"),
        "spellEmote" => ev.str("subject") == Some("self"),
        // `You have joined the group.` / `You have left the group.` — `name` is absent for exactly
        // the two self shapes.
        "group" => matches!(ev.str("change"), Some("selfJoin") | Some("selfLeave")),
        _ => false,
    }
}

/// `inWorldEvidence` — can this line ONLY have been printed because the character was standing in
/// the world? The refusals cost precision, never correctness: a refused line leaves the anchor
/// where the previous accepted one put it, and the anchor is documented as a lower bound.
pub fn in_world_evidence(ev: &Event) -> bool {
    first_person_kinds().contains(ev.kind()) || combat_names_you(ev) || self_form_of(ev)
}

/// Stateful, single-character. Feed it every event in stream order — primary AND derived, which is
/// what the bus does (it is a plain subscriber registered after the modules), and which is why the
/// three derived kinds are refused by name below rather than left to arithmetic.
#[derive(Default)]
pub struct SessionDetector {
    /// THE ANCHOR: the newest instant the character is KNOWN to have been in the world, or 0
    /// before the first such line.
    evidence_ts: i64,
    /// ts of the most recent `campStart` that has not been abandoned, or 0.
    camp_ts: i64,
}

impl SessionDetector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.evidence_ts = 0;
        self.camp_ts = 0;
    }

    /// The `OfflineGapEvent` to emit at a `sessionStart` whose implied absence exceeds
    /// {@link OFFLINE_GAP_MIN_MS}, else `None`.
    ///
    /// The derived events of other producers are ignored: an `offlineGap` is our own output (a
    /// feedback loop), and an `epoch` / `buffExpired` is a synthesized restatement of a primary
    /// event whose timestamp has already been recorded.
    pub fn observe(&mut self, ev: &Event) -> Option<Event> {
        if matches!(ev.kind(), "offlineGap" | "epoch" | "buffExpired") {
            return None;
        }
        // An unparseable timestamp (0) can neither anchor a gap nor advance the anchor.
        if ev.ts() <= 0 {
            return None;
        }
        match ev.kind() {
            "campStart" => self.camp_ts = ev.ts(),
            // The game states the cancellation outright (law 1) — an abandoned camp is not a logout.
            "campAbort" => self.camp_ts = 0,
            _ => {}
        }
        // The gap is built BEFORE the Welcome advances the anchor — it is measured against the
        // previous session, and it is also the login that ends the absence.
        let gap = if ev.kind() == "sessionStart" {
            self.build_gap(ev)
        } else {
            None
        };
        if in_world_evidence(ev) {
            self.evidence_ts = ev.ts();
        }
        gap
    }

    /// `buildGap`. `None` when the log has shown no in-world evidence yet — the first login in a
    /// freshly-started log has no observed "before", and inventing one out of the preamble is the
    /// mistake this file exists to avoid.
    fn build_gap(&self, ev: &Event) -> Option<Event> {
        let from_ts = self.evidence_ts;
        let to_ts = ev.ts();
        if from_ts <= 0 || to_ts - from_ts <= OFFLINE_GAP_MIN_MS {
            return None;
        }
        let camped = self.camp_ts > 0 && (from_ts - self.camp_ts).abs() <= CAMP_PAIRING_MS;
        Some(Event::from_value(json!({
            "kind": "offlineGap",
            "seq": ev.seq(),
            "ts": to_ts,
            "raw": ev.raw(),
            "fromTs": from_ts,
            "toTs": to_ts,
            "camped": camped,
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(json_line: &str) -> Event {
        Event::from_json(json_line).expect("a JSON object")
    }

    /// The preamble is refused, so a login's gap is measured from the last line about YOU — the
    /// whole of JOS-262, in the shape the module header's own log excerpt states it.
    #[test]
    fn the_reconnect_preamble_cannot_anchor_a_gap() {
        let mut d = SessionDetector::new();
        d.observe(&ev(
            r#"{"kind":"campStart","seq":0,"ts":1000,"raw":"camp"}"#,
        ));
        // Somebody else's kill: the client is connected, the character is not in the world.
        assert!(d
            .observe(&ev(
                r#"{"kind":"death","seq":1,"ts":900000,"raw":"d","name":"a seahorse","bySelf":false,"killer":"Dyson"}"#
            ))
            .is_none());
        // …and an `unknown` channel line says nothing at all.
        assert!(d
            .observe(&ev(r#"{"kind":"unknown","seq":2,"ts":900500,"raw":"x"}"#))
            .is_none());
        let gap = d
            .observe(&ev(
                r#"{"kind":"sessionStart","seq":3,"ts":901000,"raw":"Welcome"}"#,
            ))
            .expect("a gap");
        assert_eq!(gap.kind(), "offlineGap");
        assert_eq!(gap.int("fromTs"), Some(1000));
        assert_eq!(gap.int("toTs"), Some(901000));
        // The campStart is the anchor itself, so the pairing window is not even exercised.
        assert!(gap.bool("camped"));
    }

    /// A blip is not an absence, and the FIRST login of a log has no observed "before".
    #[test]
    fn a_short_relog_and_a_first_login_emit_nothing() {
        let mut d = SessionDetector::new();
        assert!(d
            .observe(&ev(
                r#"{"kind":"sessionStart","seq":0,"ts":50000,"raw":"Welcome"}"#
            ))
            .is_none());
        // …and that Welcome IS evidence, so the next one is measured against it.
        assert!(d
            .observe(&ev(
                r#"{"kind":"sessionStart","seq":1,"ts":110000,"raw":"Welcome"}"#
            ))
            .is_none());
        assert!(d
            .observe(&ev(
                r#"{"kind":"sessionStart","seq":2,"ts":170001,"raw":"Welcome"}"#
            ))
            .is_some());
    }

    /// An abandoned camp is not a logout, and our own derived kinds are refused by name.
    #[test]
    fn an_aborted_camp_is_not_a_logout_and_derived_kinds_are_refused() {
        let mut d = SessionDetector::new();
        d.observe(&ev(r#"{"kind":"campStart","seq":0,"ts":1000,"raw":"c"}"#));
        d.observe(&ev(r#"{"kind":"campAbort","seq":1,"ts":2000,"raw":"a"}"#));
        // A derived restatement of an in-world line may not advance the anchor.
        d.observe(&ev(
            r#"{"kind":"buffExpired","seq":2,"ts":500000,"raw":"x","spell":"Valor","target":"self"}"#,
        ));
        let gap = d
            .observe(&ev(
                r#"{"kind":"sessionStart","seq":3,"ts":900000,"raw":"Welcome"}"#,
            ))
            .expect("a gap");
        assert!(!gap.bool("camped"));
        assert_eq!(gap.int("fromTs"), Some(2000));
    }
}
