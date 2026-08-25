//! THE INGEST SWITCH — one canonical event in, one state transition out (`combat/ingest.ts`).
//!
//! Over there the switch is split along the five event FAMILIES it already grouped its cases into,
//! and the split is kept here so a reader can see at a glance which family a kind belongs to and
//! which families are not ported yet:
//!
//!   ingestWorld    epoch · zone · charm · petClaim · allyPetLeader · petSay · uncharm · cc · death
//!   ingestCombat   damage · heal · healUnstated · mitigation · miss · resist
//!   ingestCast     castBegin · castFizzle · castInterrupted · otherCastBegin · castResumed
//!   ingestChoice   stanceChange · invocationChange · specialAttack
//!   ingestModifier poisonCoat · poisonDry · poisonProc · buffApply · buffWearOff · aaActivate ·
//!                  playerDeath
//!
//! The families are disjoint on `kind`, so the chain is exactly the old switch: each tries its own
//! cases and reports whether it consumed the event. Any other kind is ignored.
//!
//! ── WHAT THIS FILE PORTS TODAY (JOS-477, stated rather than implied) ──────────────────────────
//!
//! `epoch`, `zone`, `stanceChange`, `invocationChange` — the SEGMENTATION AND STANDING-CHOICE
//! skeleton. Everything else falls through the `_ =>` arm and is a no-op.
//!
//! That is a genuine subset rather than a placeholder: those four are the cases that decide the
//! `zone`, `stance`, `zoneSessions` and `hydrating` fields of the snapshot, and they are complete
//! for what they touch. The unported cases are the ones that need the WORLD MODEL (`world.ts`'s
//! `nameKey#gen` instance identity and its retirement clock) and the ATTRIBUTION LADDER
//! (`routing.ts` classify, `charmModel.ts`, `allyCharms.ts`, `otherCombatants.ts`), which are the
//! next build ticket's subject. Nothing here fabricates an entry for them: an unrouted damage line
//! moves no total, opens no encounter and books nothing, which is why the ledger's counts for
//! `.combat.segments` and `.combat.selected` are honest measurements of what is missing rather than
//! noise from a half-written accumulator.

use crate::combat::state::{EngineState, Modifier};
use crate::combat::ZoneSessionClose;
use crate::event::Event;

/// Fold one canonical event into the state machine.
pub fn ingest_event(st: &mut EngineState, ev: &Event) {
    if ingest_world(st, ev) {
        return;
    }
    ingest_choice(st, ev);
}

/// epoch / zone / charm / petClaim / uncharm / cc / death. Returns true if consumed.
fn ingest_world(st: &mut EngineState, ev: &Event) -> bool {
    match ev.kind() {
        // CHARACTER REBIRTH — a same-name character was wiped and recreated. The DPS meter is
        // session-scoped (the live encounter history and the zone aggregate, already reset on every
        // zone line), so we deliberately KEEP it: a rebirth is not a reason to lose the current
        // session's fights. What goes is the beta character's world state — the open fight is
        // finalized and the pet/charm/ally sets are cleared as a cheap safety. A zone line after
        // the rebirth login would clear them anyway; doing it here makes the boundary explicit and
        // independent of that ordering.
        //
        // THE COATS GO TOO, through the same shared door the death rule uses. This case used to
        // censor the coat SPANS and leave the SLOTS standing — the identical slot-versus-span
        // disagreement, rebuilt one boundary over. A rebirth is a different character; nothing was
        // on these blades.
        "epoch" => {
            // finalizeCurrent: nothing is open until routing is ported, so this is the whole of it.
            true
        }
        "zone" => {
            // Freeze the just-left stay's aggregate into the capped history BEFORE resetting, so
            // its overall meter stays selectable. A stay with no attributed damage is dropped,
            // matching the empty-encounter drop rule.
            st.finalize_zone_session(ZoneSessionClose::Zone);
            st.zone = ev.str("zone").map(str::to_string);
            // The accumulator half of the boundary — shared with the session mark. Everything the
            // zone case does BEYOND this pair (retiring the world's mobs, breaking charm, retiring
            // pets, zoning the ally model) is a statement about having LEFT the room, and is the
            // part a mark deliberately omits. Unported here with the world model.
            st.reset_zone_accumulators();
            true
        }
        _ => false,
    }
}

/// THE CHARACTER'S STANDING CHOICES — stance, invocation, and the active special attack.
///
/// Its own family rather than three more cases beside the annotations, because the three answer the
/// same question and none of them is an event in a fight: they are what the character has DECIDED
/// to do, persisting across pulls and zones until the game prints a different decision.
fn ingest_choice(st: &mut EngineState, ev: &Event) {
    match ev.kind() {
        "stanceChange" => {
            if let Some(name) = ev.str("stance") {
                apply_stance(&mut st.stance, name, ev.ts());
            }
        }
        "invocationChange" => {
            if let Some(name) = ev.str("invocation") {
                apply_stance(&mut st.invocation, name, ev.ts());
            }
        }
        _ => {}
    }
}

/// `procRouting.ts applyStance`, the half of it that writes the session-scoped pair.
///
/// THE NO-OP RE-ASSERT RETURNS EARLY, and that is load-bearing rather than an optimisation: the
/// nine stances (and the nine invocations) are mutually exclusive, so a commit ENDS the previous
/// span — the game prints no "your stance ends" line, ever — and without this guard a re-assert of
/// the stance you are already in would accrue a zero-width span and move `stanceTs` to a moment
/// nothing happened at. The goldens pin the consequence: `stanceTs` and `invocationTs` are the ts
/// of the last CHANGE, not of the last line that mentioned one.
///
/// The rest of `applyStance` — the session state timeline's exclusivity commit, the open
/// encounter's `stanceSpans` bookkeeping, the timeline marker and the two `procs` switch counters —
/// belongs to the encounter and is unported with it.
fn apply_stance(slot: &mut Option<Modifier>, name: &str, ts: i64) {
    if slot.as_ref().is_some_and(|m| m.name == name) {
        return;
    }
    *slot = Some(Modifier {
        name: name.to_string(),
        ts,
    });
}
