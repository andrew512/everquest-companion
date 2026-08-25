//! THE INGEST SWITCH — one canonical event in, one state transition out (`combat/ingest.ts`), plus
//! the three lines that bind one of YOUR pets (`petClaims.ts`) and the four the ally model reads
//! (`allyRouting.ts`).
//!
//! Over there the switch is split along the five event FAMILIES it already grouped its cases into,
//! and the split is kept here so a reader can see at a glance which family a kind belongs to and
//! which families are not ported yet:
//!
//!   ingest_world    epoch · zone · charm · petClaim · allyPetLeader · petSay · uncharm · cc · death
//!   ingest_combat   damage · heal · healUnstated · mitigation · miss · resist
//!   ingest_cast     castBegin · castFizzle · castInterrupted · otherCastBegin · castResumed
//!   ingest_choice   stanceChange · invocationChange · specialAttack
//!   ingest_modifier poisonCoat · poisonDry · poisonProc · buffApply · buffWearOff · aaActivate ·
//!                   playerDeath
//!
//! The families are disjoint on `kind`, so the chain is exactly the old switch: each tries its own
//! cases and reports whether it consumed the event.
//!
//! ── WHAT IS NOT PORTED HERE, AND WHAT EACH ABSENCE COSTS ──────────────────────────────────────
//!
//! `ingest_modifier` is the BLADE-COAT and PROC-ANNOTATION family, and every one of its cases is
//! unported except the one that binds a pet (`buffApply` → `bind_pet_buff_landing`). What it costs
//! is stated rather than implied: no coat is ever on at engage, so no pull qualifies for the rolling
//! time-to-slow sample and `poison.slow` reads all-zero — which is what five of the six goldens carry
//! and is a genuine divergence on the sixth.
//!
//! THE CAST-LESS PROC LANE SPLIT (JOS-167) IS ALSO ABSENT. `damageOrigin` decides, BEFORE a line is
//! routed, whether one of your spell effects had a cast behind it, and renames the meter LANE when
//! it did not. It moves no total and engages nothing — it changes what a row is CALLED — so the
//! segments and zone sessions this fold publishes today are unaffected, and it becomes load-bearing
//! at the view-builder stage where per-lane rows are serialized. `recentCasts` is its ledger and is
//! unported with it.
//!
//! `healUnstated` and `mitigation` reach ONLY the meter-grade healing ledger, which is unported —
//! and neither ever opens, joins or extends an encounter or moves the damage timeline (world-model
//! law 8), so consuming them as no-ops is exactly what the TS does minus one accumulator.

use crate::combat::aggregate::{DamageEvent, MissType};
use crate::combat::ally::{AllyCastLine, AllyLeaderLine};
use crate::combat::charm::CharmVerdict;
use crate::combat::encounter::{ZoneSessionClose, CC_HOLD_MS};
use crate::combat::lifecycle::{ensure_encounter, eval_closure, finalize_current};
use crate::combat::routing::{self, HealLine, MissLine, ResistLine};
use crate::combat::state::{EngineState, Modifier};
use crate::event::Event;
use eqlog::names::id_key;

/// Fold one canonical event into the state machine.
pub fn ingest_event(st: &mut EngineState, ev: &Event) {
    // Charm binds age out on the LOG clock, so the demotion is driven from the event stream and
    // from the snapshot — whichever observes the deadline first. Guarded on an emptiness read, so
    // the ordinary line costs nothing.
    st.sweep_charm(ev.ts());
    // The ally binds age out on the same log clock: a charm cannot outlive its own spell, so the
    // hold is a certainty rather than a heuristic and needs no evidence to fire.
    st.sweep_ally(ev.ts());
    // …and `sweepCoatClass` goes here, which is unported with the coats. Deliberately NOT in the
    // snapshot beside the two above — those are display timers, that one MUTATES the fold, and a
    // fold that advanced because the UI polled would make a replay disagree with the live tail.
    if ingest_world(st, ev) {
        return;
    }
    if ingest_combat(st, ev) {
        return;
    }
    if ingest_cast(st, ev) {
        return;
    }
    ingest_choice(st, ev);
}

// ── WORLD ─────────────────────────────────────────────────────────────────────────────────────

fn ingest_world(st: &mut EngineState, ev: &Event) -> bool {
    match ev.kind() {
        // CHARACTER REBIRTH — a same-name character was wiped and recreated. The DPS meter is
        // session-scoped (the live encounter history and the zone aggregate, already reset on every
        // zone line), so we deliberately KEEP it: a rebirth is not a reason to lose the current
        // session's fights. What goes is the beta character's WORLD state — the open fight is
        // finalized and the pet/charm/ally sets are cleared as a cheap safety. A zone line after the
        // rebirth login would clear them anyway; doing it here makes the boundary explicit and
        // independent of that ordering.
        //
        // …and the SPECIAL-ATTACK LANES retire with them: "you will now use Dragon Punch" was said to
        // the PREVIOUS character. The lanes fall back to the parser's generic names until this
        // character's own state line says otherwise, never a carried-over guess.
        "epoch" => {
            finalize_current(st);
            st.pet_names.clear();
            st.world.reset();
            st.charm.reset();
            st.ally.reset();
            st.specials.reset();
            true
        }
        "zone" => {
            finalize_current(st);
            // Freeze the just-left stay's aggregate into the capped history BEFORE resetting, so its
            // overall meter stays selectable. A stay with no attributed damage is dropped, matching
            // the empty-encounter drop rule.
            st.finalize_zone_session(ZoneSessionClose::Zone);
            st.zone = ev.str("zone").map(str::to_string);
            // The accumulator half of the boundary — shared with the session mark. Everything BELOW
            // this line is the part a mark deliberately omits, because it is a statement about the
            // ROOM changing and a mark makes no such statement.
            st.reset_zone_accumulators();
            // Charm cannot survive a zone transition and hostile mobs do not follow, so both are
            // retired. SUMMONED class pets DO persist (real-log verified), so the survivors are
            // exactly what the fast pet-name index is rebuilt from — which keeps a summoned pet
            // fully attributable after zoning while dropping stale charmed and hostile names.
            let survivors = st.world.zone(ev.ts());
            st.drain_retirements();
            let keys: Vec<String> = survivors.into_iter().map(|s| s.name_key).collect();
            st.pet_names = keys.iter().cloned().collect();
            st.charm.zone(&keys);
            // Somebody else's charm cannot survive a zone either, and neither can a cast in flight.
            // The friendly SET survives — it is about people, not about the room.
            st.ally.zone();
            true
        }
        "charm" => {
            ingest_charm(st, ev);
            true
        }
        "petClaim" => {
            // …INCLUDING THE ONE THIS ENGINE ITSELF DERIVES. `via: 'petBuff'` never comes off a line:
            // it is `bind_pet_buff_landing` handed to the bus, and the bus delivers it straight back
            // here. Re-binding would be harmless — every route is idempotent — but the refusal is
            // what makes the seam PROVABLY loop-free rather than incidentally so, and it lives beside
            // the emitter so the two can never be moved apart. This fold installs no emitter (the
            // golden's construction does not), so the kind cannot arrive; the guard is stated because
            // its absence is a property of the construction and not of the rule.
            if ev.str("via") != Some("petBuff") {
                if let Some(name) = ev.str("name").map(str::to_string) {
                    bind_pet_claim(st, &name, ev.ts());
                }
            }
            true
        }
        "allyPetLeader" => {
            // The speaker just named somebody its leader, which settles what it IS whether or not
            // the ally model goes on to bind it.
            if let Some(pet) = ev.str("pet") {
                st.retract_other(&id_key(pet));
            }
            ingest_ally_pet_leader(st, ev);
            true
        }
        "petSay" => {
            // A `says` line is BROADCAST and proves nothing about whose pet the speaker is — that is
            // JOS-49's ruling and it stands. What it DOES prove is that the speaker is SOMEBODY's
            // pet, which is exactly the fact the record-everything ladder cannot get any other way:
            // EQ spells a summoned pet's name with the same grammar it gives people, so without this
            // the strangers' pets in a raid keep rows of their own. Measured on the owner's whole
            // log: it settles 8 names no other rung reaches.
            if let Some(name) = ev.str("name") {
                st.retract_other(&id_key(name));
            }
            true
        }
        "uncharm" => {
            // `Your <charm spell> spell has worn off of <mob>` — only the CASTER sees this, so it is
            // also retroactive proof the bind was ours. Corroborate FIRST (a bind that ends this way
            // was real even if the pet never spoke or swung), then release.
            if let Some(mob) = ev.str("mob").map(str::to_string) {
                let key = id_key(&mob);
                st.charm.note_pet_evidence(&key);
                st.world.uncharm(&mob, ev.ts());
                st.drain_retirements();
                st.pet_names.remove(&key);
                st.charm.release(&key);
            }
            true
        }
        "cc" => {
            ingest_cc(st, ev);
            true
        }
        "death" => {
            ingest_death(st, ev);
            true
        }
        _ => false,
    }
}

/// `<mob> has been charmed.` — THE OWNERSHIP GATE. The line is a BROADCAST and names no caster, so it
/// binds ONLY when it resolved one of the owner's own charm casts. A foreign charm is remembered as
/// an observation — nothing else — so it stays available to the petClaim PROMOTE path and never
/// enters the attribution set.
fn ingest_charm(st: &mut EngineState, ev: &Event) {
    let Some(mob) = ev.str("mob").map(str::to_string) else {
        return;
    };
    let key = id_key(&mob);
    // WHOEVER'S CHARM IT IS, THE THING IS A MOB. Stated before the ownership branch because it is
    // true of both arms: a name a charm broadcast has ever spoken is not a combatant the
    // record-everything ladder may keep its own row for.
    st.retract_other(&key);
    if st.charm.charm_broadcast(&key, &mob, ev.ts()) == CharmVerdict::Foreign {
        // A charm broadcast that resolved none of YOUR casts, offered to the ally model before it is
        // dropped. THE WORLD MODEL IS DELIBERATELY NOT TOLD: `world.charm()` marks an instance as a
        // pet of YOURS — it exempts the instance from staleness, keeps it out of hostile presence and
        // puts it in the pet set. An ally's pet is none of those things to us; it is a mob that
        // happens to be fighting for somebody else, and it may very well be a mob we are killing.
        st.ally.broadcast(&key, &mob, ev.ts());
        return;
    }
    // YOUR charm wins outright over any ally bind of the same mob. It can happen — you charm what
    // somebody else's charm just broke off — and two models both calling one entity a pet is exactly
    // the duplicated-ownership shape law 4 is a scar from.
    st.ally.release(&key);
    st.world.charm(&mob, ev.ts());
    st.drain_retirements();
    st.note_pet(&key);
}

/// A pet identified you as its owner, so the named entity is your pet. THREE lines produce this ONE
/// transition and this function deliberately does not care which — a second retirement path is what
/// law 4 is a scar from.
///
/// Ownership-DEFINITIVE and pet-only, which is why it also PROMOTES: a name we saw charmed but
/// declined to bind (no own cast behind the broadcast) is bound HERE, and bound as CHARMED rather
/// than summoned. Otherwise it binds a SUMMONED pet, idempotently — a charmed mob sends the tell too,
/// and `world.claim()` leaves an already-charmed instance's kind alone, so a charmed pet is never
/// reclassified as summoned.
fn bind_pet_claim(st: &mut EngineState, name: &str, ts: i64) {
    let key = id_key(name);
    // Anything that names itself YOURS stops being anybody else's. All three claim routes are
    // ownership-definitive and first-person; an ally bind rests on a broadcast, which is weaker by
    // construction, so this direction of the override needs no tie-break.
    st.ally.release(&key);
    let promote = st.world.pet_instance(name).is_none() && st.charm.claim_is_charmed(&key, ts);
    if promote {
        st.world.charm(name, ts);
    } else {
        st.world.claim(name, ts);
    }
    st.drain_retirements();
    st.note_pet(&key);
    // The claim is also the corroboration a provisional charm bind was waiting for.
    st.charm.note_pet_evidence(&key);
    // SINGLE-PET SUCCESSION: claiming a NEW summoned pet retires the previous one inside the world
    // model, and the name index has to follow it out or routing would go on admitting the retired
    // pet's swings as yours. The world model decides; the index and the charm model are told.
    for gone in st.sync_pet_names() {
        st.charm.release(&gone);
    }
}

/// `<PetName> says, 'My leader is <Player>.'` about SOMEBODY ELSE — the strongest ally bind, and the
/// only one that reaches a stranger's SUMMONED pet.
fn ingest_ally_pet_leader(st: &mut EngineState, ev: &Event) {
    let (Some(pet), Some(owner)) = (ev.str("pet"), ev.str("owner")) else {
        return;
    };
    let (pet, owner) = (pet.to_string(), owner.to_string());
    let owner_key = id_key(&owner);
    let pet_key = id_key(&pet);
    if !st.ally_caster_allowed(&owner_key) {
        return;
    }
    // Your own pet is yours, whatever a broadcast says about it. `says` is forgeable, and the cost of
    // getting this wrong is deleting a real pet's damage — so the refusal is absolute and stated here
    // rather than left to the ordering.
    if st.pet_names.contains(&pet_key) || st.ever_pet.contains(&pet_key) {
        return;
    }
    let ever_charmed = st.charm.ever_charmed(&pet_key);
    st.ally.bind_by_leader(&AllyLeaderLine {
        pet_key: &pet_key,
        pet: &pet,
        owner: &owner,
        owner_key: &owner_key,
        ts: ev.ts(),
        ever_charmed,
    });
}

/// Crowd control (mez/root, not charm). Evaluate any pending closure at this ts FIRST (a CC on a
/// fresh pull must not attach to a stale fight), then mark the CC'd instance engaged and CC-held so
/// the encounter stays OPEN across the mez-and-wait gap. A CC'd instance counts as "alive" for
/// closure.
///
/// OWNERSHIP GATE: `<mob> has been mesmerized.` is a BROADCAST with no caster, so an APPLICATION only
/// counts when it resolved one of the owner's own CC casts. A foreign mez is fully INERT — it does
/// not engage the mob, it does not open a hold, and it does not touch `last_activity_ts`; a
/// stranger's crowd control is an observation about the room, not an event in our fight. The REFRESH
/// shape is exempt by construction: it is derived from `Your <spell> spell has worn off of <mob>`,
/// which only the caster sees and which names us as that caster.
fn ingest_cc(st: &mut EngineState, ev: &Event) {
    let refresh = ev.bool("refresh");
    if !refresh && !st.charm.cc_broadcast(ev.ts()) {
        return;
    }
    let Some(mob) = ev.str("mob").map(str::to_string) else {
        return;
    };
    eval_closure(st, ev.ts());
    let inst = st.resolve(&mob, ev.ts(), false);
    if inst.instance_id == "you" {
        return;
    }
    ensure_encounter(st, ev.ts());
    let enc = st.current.as_mut().expect("just ensured");
    enc.engaged.insert(inst.instance_id.clone());
    enc.engaged_seen.insert(inst.instance_id.clone(), ev.ts());
    enc.cc_active_until
        .insert(inst.instance_id, ev.ts() + CC_HOLD_MS);
    st.last_activity_ts = ev.ts();
}

fn ingest_death(st: &mut EngineState, ev: &Event) {
    let Some(name) = ev.str("name").map(str::to_string) else {
        return;
    };
    let key = id_key(&name);
    // A DEAD PET IS NOT A PET. Unconditional and BY NAME, unlike the world model's careful
    // pet-vs-twin disambiguation below: an ally bind is name-keyed to begin with, so if the log says
    // something of that name died, the honest reading is that the bind is over. Erring toward ending
    // it is the safe direction — the failure it prevents is crediting a stranger with a corpse's
    // damage, and the failure it risks is losing a few seconds of a survivor's.
    st.ally.release(&key);
    let killer_key = if ev.bool("bySelf") {
        Some("you".to_string())
    } else {
        ev.str("killer").map(id_key)
    };
    st.world.death(&name, ev.ts(), killer_key.as_deref());
    // The retired instance stays in `engaged` — so an in-fight heal on the corpse still counts —
    // because closure consults `is_retired`, not set membership. Its CC hold is cleared by the world
    // model's own retirement announcement, which is what makes DEATH and STALENESS agree; this used
    // to be a delete right here, and staleness was the path that did not clean up after itself.
    st.drain_retirements();
    // Keep the fast pet-name set in lockstep: drop the name only when NO pet instance of it remains.
    if st.world.pet_instance(&name).is_none() {
        st.pet_names.remove(&key);
        st.charm.release(&key);
    }
}

// ── COMBAT ────────────────────────────────────────────────────────────────────────────────────

fn ingest_combat(st: &mut EngineState, ev: &Event) -> bool {
    match ev.kind() {
        "damage" => {
            ingest_damage(st, ev);
            true
        }
        "heal" => {
            routing::route_heal(
                st,
                &HealLine {
                    ts: ev.ts(),
                    target: ev.str("target").unwrap_or_default().to_string(),
                    healer: ev.str("healer").map(str::to_string),
                    amount: ev.int("amount").unwrap_or(0),
                },
            );
            true
        }
        // A heal with no amount cannot enter the proc model and reaches only the healing ledger's own
        // count-lane, which is unported. It never opens, joins or extends an encounter and never
        // moves the damage timeline (law 8), so there is nothing else for it to do here.
        "healUnstated" => true,
        // Damage PREVENTED, not hit points restored, so it never touches a DAMAGE total. It does
        // reach the HEALING total as a rune/absorbed row — unported — and, like miss and resist, it
        // never opens, joins or extends an encounter.
        "mitigation" => true,
        "miss" => {
            let Some(mtype) = ev.str("mtype").and_then(MissType::parse) else {
                return true;
            };
            routing::route_miss(
                st,
                &MissLine {
                    ts: ev.ts(),
                    attacker: ev.str("attacker").unwrap_or_default().to_string(),
                    target: ev.str("target").unwrap_or_default().to_string(),
                    mtype,
                    verb: ev.str("verb").map(str::to_string),
                    // A miss line names no skill, so the round lane's floor is the parser's own
                    // `meleeSkill(verb)` answer, reached through the parser's own port so the two
                    // ends cannot answer differently.
                    verb_skill: ev
                        .str("verb")
                        .map(|v| eqlog::parse::combat::melee_skill(v).to_string()),
                    modifiers: ev
                        .arr_str("modifiers")
                        .iter()
                        .map(|s| s.to_string())
                        .collect(),
                },
            );
            true
        }
        "resist" => {
            let caster = ev.str("caster").unwrap_or_default().to_string();
            let spell = ev.str("spell").unwrap_or_default().to_string();
            let incoming = ev.bool("incoming");
            // `<mob> resisted your <Charm>!` is the third way an armed cast fails to land. Only OUR
            // OWN outgoing resist counts; an incoming one — we shrugged off a mob's spell — says
            // nothing about what we were casting.
            if !incoming && id_key(&caster) == "you" {
                st.charm.note_cast_failed(&spell, ev.ts());
            }
            routing::route_resist(
                st,
                &ResistLine {
                    ts: ev.ts(),
                    caster,
                    target: ev.str("target").unwrap_or_default().to_string(),
                    spell,
                    incoming,
                },
            );
            true
        }
        _ => false,
    }
}

/// One canonical `damage` line: close any pending encounter at this ts BEFORE routing, so attributed
/// damage after a closure starts a fresh encounter rather than reviving the old one.
fn ingest_damage(st: &mut EngineState, ev: &Event) {
    // Caster-less other-player DoTs (`attacker: null`) are not our fight.
    let Some(attacker) = ev.str("attacker").map(str::to_string) else {
        return;
    };
    eval_closure(st, ev.ts());
    let dmg = to_damage_event(st, ev, attacker);
    routing::route(st, &dmg);
}

/// The engine's internal damage record, with the lane NAMED.
///
/// EQ Legends' upgraded specials print no verb of their own (a Dragon Punch lands as `You strike …`),
/// so the parser can only ever answer the generic skill for them. `name_special_lane` applies the
/// log's OWN statement of which special is live in that verb's lane. It is a pure RENAME of `skill`:
/// the amount, the type, the category and the attribution are untouched, so every damage total stays
/// byte-identical (law 8's tripwire). Gated on the attacker being YOU, because the state line is
/// first-person-only and a mob's `strikes` must stay generic melee.
fn to_damage_event(st: &EngineState, ev: &Event, attacker: String) -> DamageEvent {
    let verb = ev.str("verb").map(str::to_string);
    let mut skill = ev.str("skill").unwrap_or_default().to_string();
    if id_key(&attacker) == "you" {
        if let Some(lane) = st.specials.lane_skill(verb.as_deref()) {
            skill = lane.to_string();
        }
    }
    let modifiers: Vec<String> = ev
        .arr_str("modifiers")
        .iter()
        .map(|s| s.to_string())
        .collect();
    let dtype = ev.str("dtype").unwrap_or_default().to_string();
    DamageEvent {
        ts: ev.ts(),
        attacker,
        target: ev.str("target").unwrap_or_default().to_string(),
        amount: ev.int("amount").unwrap_or(0),
        // Prefer the parse-time category; derive as a fallback so any path that omits it still
        // aggregates under the right axis.
        category: ev
            .str("category")
            .map(str::to_string)
            .unwrap_or_else(|| eqlog::taxonomy::damage_category(&dtype, &modifiers).to_string()),
        dtype,
        dclass: ev.str("dclass").map(str::to_string),
        skill,
        crit: ev.bool("crit"),
        modifiers,
        verb,
    }
}

// ── CAST ──────────────────────────────────────────────────────────────────────────────────────

/// THE OWN-CAST LIFECYCLE. Its own family because BOTH of the engine's ownership inferences run off
/// it and they must see the same lines: the cast-less PROC detector (unported — see the module
/// header) and the CHARM/CC/pet-buff ownership model, whose only honest owner signal is the
/// exclusivity of `You begin casting <Spell>.`
fn ingest_cast(st: &mut EngineState, ev: &Event) -> bool {
    match ev.kind() {
        "castBegin" => {
            if let Some(spell) = ev.str("spell") {
                st.charm.note_cast_begin(spell, ev.ts());
            }
            // …and the pet-summon NUDGE is the third reader of the same exclusivity — LIVE ONLY, and
            // a historical fold is never live (state.rs fact 1), so its arm can never be set. That is
            // why the whole model is absent rather than skipped.
            true
        }
        "castFizzle" | "castInterrupted" => {
            // A cast that resolved to nothing explains no landing, and nothing it might have
            // "resolved" is ours.
            if let Some(spell) = ev.str("spell") {
                st.charm.note_cast_failed(spell, ev.ts());
            }
            true
        }
        "otherCastBegin" => {
            // THE LINE COMBAT NEVER INGESTED — the only sentence in this log that says who ELSE is
            // casting what, and therefore the only thing that can name the owner of a caster-less
            // `<mob> has been charmed.` broadcast.
            let (Some(caster), Some(spell)) = (ev.str("caster"), ev.str("spell")) else {
                return true;
            };
            let caster_key = id_key(caster);
            let allowed = st.ally_caster_allowed(&caster_key);
            st.ally.note_cast(&AllyCastLine {
                caster,
                caster_key: &caster_key,
                spell,
                ts: ev.ts(),
                allowed,
            });
            true
        }
        // `You regain your concentration and continue your casting.` — the interrupted cast is back
        // on. It gives the cast-less proc detector its claim back and DELIBERATELY does not re-arm
        // the charm/CC model: that model's own evidence rules are a separate question and were not
        // measured here. With the proc detector unported this consumes the line and does nothing.
        "castResumed" => true,
        _ => false,
    }
}

// ── CHOICE ────────────────────────────────────────────────────────────────────────────────────

/// THE CHARACTER'S STANDING CHOICES — stance, invocation, and the active special attack.
///
/// Its own family rather than three more cases beside the annotations, because the three answer the
/// same question and none of them is an event in a fight: they are what the character has DECIDED to
/// do, persisting across pulls and zones until the game prints a different decision.
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
        "specialAttack" => {
            // `You will now use Dragon Punch instead of Eagle Strike while attacking.` — the ONE line
            // that names the special behind an otherwise anonymous `You strike …`. It opens nothing,
            // closes nothing, and moves no total; it changes what a later swing is CALLED.
            if let Some(skill) = ev.str("skill") {
                st.specials.note(skill);
            }
        }
        // `buffApply` is `ingest_modifier`'s, and one of its four disjoint curated gates is ported:
        // the one that BINDS A PET (JOS-188). The other three — the dispel ledger, the proc-buff
        // span and the self-landing proc count — are proc analytics and are unported.
        "buffApply" => bind_pet_buff_landing(st, ev),
        _ => {}
    }
}

/// THE UPGRADED PET (JOS-188) — `You begin casting Burnout.` … `<Name> goes berserk.`
///
/// The reported defect: a magician upgraded a level-10 water elemental to a level-14 one and the new
/// pet never appeared in the meter. Nothing was broken. The single-pet succession law never RAN,
/// because succession is triggered by the successor's own claim and an upgraded summon produces none:
/// the two binding lines the app had both require the player to TALK to the pet, and the reporter's
/// 30-minute slice holds 2,446 lines, two pets and ZERO tells.
///
/// THE THIRD BINDING SIGNAL, and the first that costs the player nothing. 40 spells in the DB are
/// `targetType: Pet` and the game will not let one land on anything but your own pet;
/// `You begin casting <Spell>.` is printed for the player and NOBODY else. So the pair — own cast,
/// then a landing that resolves it — names your pet as surely as the tell does, and it fires when a
/// summoner buffs the pet they just summoned rather than when they first order it.
///
/// MEASURED on the owner's whole log: 19 binds, 14 distinct names, every one of the 14 also bound by
/// a `… Master.'` tell — no name bound by this rule alone, no bind contradicting one — and in all 14
/// this arrives FIRST, by 81 s to 2,528 s, covering 1,865 hits / 27,088 points the meter used to
/// throw away.
///
/// THE MESSAGE IS NOT THE GATE — THE ARMED OWN CAST IS. `goes berserk.` resolves to Burnout / Fury /
/// Rage / Voice of the Berserker and only Burnout is a pet spell, so the candidate list must contain
/// the spell we are mid-cast of.
///
/// AND THE RUNG HAS A SILENT PRECONDITION: THE DB MUST BE ABLE TO NAME THE SPELL (JOS-349). A
/// candidate list comes from the cast-on-other SUFFIX table, so a `targetType: Pet` spell whose
/// scraped third-person message carries some OTHER subject token is in no table and can never be a
/// candidate for its OWN landing. Six pet-only spells are still in that state. If a report says a pet
/// stopped being attributed, CHECK THE CANDIDATE LIST FIRST — there is no time limit on a summoned
/// pet and no rule here that drops one, so an absent bind is almost always a bind that never happened.
fn bind_pet_buff_landing(st: &mut EngineState, ev: &Event) {
    let target = ev.str("target").unwrap_or_default().to_string();
    // The parser emits `target: 'self'` for the msgCastOnYou form; only a NAMED landing can bind.
    if target == "self" || target.is_empty() {
        return;
    }
    let names = ev.candidate_names("candidates");
    if !st.charm.pet_buff_landing(&names, ev.ts()) {
        return;
    }
    // A landing on YOURSELF is a self-buff the DB mislabels, never a pet — the third-person form can
    // still name you when another player's buff lands on you in the same second.
    if id_key(&target) == st.player_key.clone().unwrap_or_default() {
        return;
    }
    bind_pet_claim(st, &target, ev.ts());
}

/// `procRouting.ts applyStance`, the half of it that writes the session-scoped pair.
///
/// THE NO-OP RE-ASSERT RETURNS EARLY, and that is load-bearing rather than an optimisation: the nine
/// stances (and the nine invocations) are mutually exclusive, so a commit ENDS the previous span —
/// the game prints no "your stance ends" line, ever — and without this guard a re-assert of the
/// stance you are already in would accrue a zero-width span and move `stanceTs` to a moment nothing
/// happened at. The goldens pin the consequence: `stanceTs` and `invocationTs` are the ts of the last
/// CHANGE, not of the last line that mentioned one.
///
/// The rest of `applyStance` — the session state timeline's exclusivity commit, the open encounter's
/// span bookkeeping, the timeline marker and the two proc switch counters — belongs to the timeline
/// and the proc ledger, and is unported with them.
fn apply_stance(slot: &mut Option<Modifier>, name: &str, ts: i64) {
    if slot.as_ref().is_some_and(|m| m.name == name) {
        return;
    }
    *slot = Some(Modifier {
        name: name.to_string(),
        ts,
    });
}
