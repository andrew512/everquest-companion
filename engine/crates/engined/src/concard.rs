//! ============================================================================
//! `world.conCard` — THE CON CARD, RESOLVED SERVER-SIDE (JOS-487, boundary verdict 2).
//! ============================================================================
//!
//! The census found the fold calling SYNCHRONOUSLY INTO ELECTRON: `considerModule.setConCardHook`
//! is installed by `pipeline.ts`, and every live `/con` runs `main/conCard.ts noteConsider` inside
//! the fold's own delivery — a knowledge lookup, a resist profile and an overlay send, on the
//! thread that is parsing the log. Verdict 2 inverts it: the engine emits a FULLY RESOLVED card and
//! main only opens the window.
//!
//! This file is the resolution. It takes the four facts the module saw (`fold::…::ConEvent`) and
//! produces the card `shared/conCard.ts ConCardPayload` describes, field for field.
//!
//! ── WHAT IS RESOLVED HERE, AND WHAT IS HONESTLY NOT ────────────────────────────────────────────
//!
//! **The header is whole**: the queue identity (`mobKey`), the display name (whitespace-collapsed
//! and capped — a rendering guarantee, not taste), the level the con line stated, the zone, the
//! rare infix, and the instant on the log's own clock.
//!
//! **The resist chips are the EMPTY five, and `spellData` is false.** That is not a stub and it is
//! not a placeholder: it is the branch `mobResistProfile` itself takes app-side when the client's
//! `spells_us.txt` has not been read —
//!
//! ```text
//! const axes = spells ? RESIST_AXES.map(axis => axisRow(...)) : RESIST_AXES.map(axis => ({ … n: 0 }))
//! return { …, spellDataAvailable: spells !== null }
//! ```
//!
//! — five empty axes and the flag down, which is exactly what the card draws today on the first
//! `/con` of a session before the table has finished loading. The engine cannot take the other
//! branch yet, and the reason is a NAMED GAP rather than an oversight: the client spell table's
//! parse is **boundary verdict 7** and the cutover ledger's item 6, still open, and without it
//! there is no axis for a spell, no resist adjust, and therefore no estimate to fit. Everything
//! downstream of it — the posterior, the interval, the benchmark, the band — is a second body of
//! work (`shared/resistModel.ts`, `resistFit.ts`, `resistFormula.ts`) that has not moved either.
//!
//! **So the con-card CUTOVER is blocked on the spell table, and this frame is not.** The shape is
//! final, the header is real, and the day the table lands engine-side the chips fill in with no
//! protocol change — which is the whole reason the chip type is on the wire in full rather than
//! left open. Until then the app's own card is still the one on screen: nothing in this ticket
//! moves the overlay.
//!
//! ── TWO OF THE APP'S THREE REFUSALS STAY WHERE THEY ARE, AND BOTH ABSENCES ARE ARGUED ──────────
//!
//! `main/conCard.ts` refuses a card in three cases. The third — **never for a historical line** —
//! is enforced structurally one layer down (`ConsiderModule::on_event` only pushes when `live`), so
//! a startup replay of a month of logs emits nothing.
//!
//! The **re-open suppression** ("never twice inside a minute of a CLOSE") is not here and should not
//! be. It is a fact about the PERSON, measured on the wall clock they live on — the app's own note
//! says so at length, because EQ stamps to the second and a log-clock comparison put the card
//! straight back up in the e2e — and its only input is a window event (`con:card-closed`) that
//! never reaches the fold. It stays with the window that owns it.
//!
//! The **player refusal** (`conCardIsPlayer`) is the one worth reading twice. It is
//! `isPlayerShapedName(name) && !knownMob(name)`: EQ gives players one capitalized word with no
//! space and gives mobs an article plus a noun phrase, and the committed mob catalog is what
//! rescues the proper-named NPCs that shape would otherwise condemn — Innoruuk, Blugurg, Sheldon.
//! This engine has the first half and not the second: the catalog moves with the KNOWLEDGE surface.
//! Applying the name-shape test alone would refuse a card for every proper-named NPC the app draws
//! one for today, which is a regression wearing a port's clothes, so this file applies NEITHER half
//! and says so. The consequence is bounded and stated: until the catalog is engine-side, the app's
//! own `looksLikePlayer` gate still stands between this frame and the overlay window, exactly where
//! it stands today.

use protocol::generated::{
    ConCardChip, ConCardMessage, ConCardMessageKind, ResistAxis, ResistEmpirical,
};

use fold::modules::consider::{mob_key, ConEvent};

/// How long a mob name this engine will put on a card.
///
/// `shared/conCard.ts MAX_NAME_CHARS`. A rendering guarantee rather than taste: a 40 kB mob name
/// cannot push a card off the screen. CHARACTERS, not bytes — `slice` over there counts UTF-16 code
/// units and this counts scalar values, which agree for every name EQ prints and would differ only
/// for astral characters the game has none of.
const MAX_NAME_CHARS: usize = 96;

/// THE FIVE AXES, in display order. `shared/resistTypes.ts RESIST_AXES`, and the order is part of
/// the contract: every surface shows all five in this order, because "we have not seen fire cast on
/// this" and "fire is fine" are different statements and a missing chip says neither.
const AXES: [ResistAxis; 5] = [
    ResistAxis::Magic,
    ResistAxis::Fire,
    ResistAxis::Cold,
    ResistAxis::Poison,
    ResistAxis::Disease,
];

/// `cappedName` — whitespace-collapsed, trimmed, capped.
#[must_use]
pub fn capped_name(name: &str) -> String {
    let collapsed = name.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_NAME_CHARS).collect()
}

/// The empty chip for one axis — `shared/conCard.ts blankChip`, verbatim.
///
/// EVERY NUMBER IS A REAL ZERO and the three optional members are absent: nothing has been observed
/// on this axis, so there is no band, no benchmark and no fit. A chip that carried a tag off zero
/// observations would be the model inventing an answer.
fn blank_chip(axis: ResistAxis) -> ConCardChip {
    ConCardChip {
        axis,
        tag: None,
        benchmark: None,
        pinned: false,
        empirical: ResistEmpirical {
            total: 0,
            resisted: 0,
        },
        npc_only: false,
        n: 0,
        n_total: 0,
        fit: None,
    }
}

/// The five chips this engine can honestly state. See the module header for why they are the empty
/// ones and for what has to land before they are not.
#[must_use]
pub fn chips() -> Vec<ConCardChip> {
    AXES.into_iter().map(blank_chip).collect()
}

/// Build the card one live `/con` deserves, or `None` when the line names nothing.
///
/// THE ONE REFUSAL THIS FILE MAKES is an empty mob key, which is `noteConsider`'s own first guard
/// (`if (!key) return false`): a con line whose creature name folds to nothing has no queue
/// identity, so there is no card to refresh and no card to open.
#[must_use]
pub fn card(ev: &ConEvent) -> Option<ConCardMessage> {
    let id = mob_key(&ev.mob);
    if id.is_empty() {
        return None;
    }
    Some(ConCardMessage {
        kind: ConCardMessageKind::ConCard,
        at: ev.ts,
        id,
        name: capped_name(&ev.mob),
        level: ev.level,
        zone: ev.zone.clone(),
        // ABSENT RATHER THAN FALSE, which is the app payload's own shape: `if (ev.rare)
        // payload.rare = true`, and `JSON.stringify` drops the key otherwise.
        rare: ev.rare.then_some(true),
        chips: chips(),
        spell_data: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{capped_name, card, chips, MAX_NAME_CHARS};
    use fold::modules::consider::ConEvent;
    use protocol::generated::ResistAxis;

    fn con(mob: &str) -> ConEvent {
        ConEvent {
            ts: 1_787_181_707_000,
            mob: mob.to_owned(),
            level: Some(52),
            rare: false,
            zone: Some("Nagafen's Lair".to_owned()),
        }
    }

    #[test]
    fn the_card_carries_the_header_the_overlay_draws() {
        let card = card(&con("a fire giant warlord")).expect("a card");
        assert_eq!(card.id, "a fire giant warlord");
        assert_eq!(card.name, "a fire giant warlord");
        assert_eq!(card.level, Some(52));
        assert_eq!(card.zone.as_deref(), Some("Nagafen's Lair"));
        assert_eq!(card.rare, None, "absent rather than false");
        assert_eq!(card.at, 1_787_181_707_000);
    }

    #[test]
    fn the_rare_infix_is_present_only_when_it_was_on_the_line() {
        let mut ev = con("a lava guardian");
        ev.rare = true;
        assert_eq!(card(&ev).expect("a card").rare, Some(true));
    }

    #[test]
    fn the_queue_identity_is_the_mob_key_so_a_recon_refreshes_one_card() {
        // THE THREE FOLDS `mobKey` MAKES, each of which is what stops one creature becoming two
        // cards: the quote fold, the copy-number strip, and the case fold.
        let a = card(&con("Innoruuk`s Chosen")).expect("a card");
        let b = card(&con("innoruuk's chosen (2)")).expect("a card");
        assert_eq!(a.id, b.id);
        // …and the DISPLAY name is untouched by any of it.
        assert_eq!(a.name, "Innoruuk`s Chosen");
    }

    #[test]
    fn a_line_that_names_nothing_gets_no_card() {
        assert!(card(&con("")).is_none());
        assert!(card(&con("   ")).is_none());
    }

    #[test]
    fn a_hostile_name_cannot_push_the_card_off_the_screen() {
        let long = "a ".to_owned() + &"giant ".repeat(400);
        let card = card(&con(&long)).expect("a card");
        assert_eq!(card.name.chars().count(), MAX_NAME_CHARS);
        // …and the whitespace collapse happens BEFORE the cap, so a name padded with runs of
        // spaces does not spend its budget on them.
        assert_eq!(capped_name("  a   fire   giant  "), "a fire giant");
    }

    #[test]
    fn the_chips_are_the_five_empty_ones_in_display_order() {
        let chips = chips();
        assert_eq!(
            chips.iter().map(|c| c.axis).collect::<Vec<_>>(),
            [
                ResistAxis::Magic,
                ResistAxis::Fire,
                ResistAxis::Cold,
                ResistAxis::Poison,
                ResistAxis::Disease
            ]
        );
        for chip in &chips {
            // THE EMPTY CELL, not a fabricated one: no band, no benchmark, no fit, and every count
            // a real zero. See the module header for what has to land before this changes.
            assert!(chip.tag.is_none());
            assert!(chip.benchmark.is_none());
            assert!(chip.fit.is_none());
            assert_eq!(chip.n, 0);
            assert_eq!(chip.n_total, 0);
            assert!(!chip.pinned);
            assert!(!chip.npc_only);
        }
        // …and the flag that tells the card WHY, which is the whole reason five empty chips are not
        // five lies.
        assert!(
            !card(&con("a fire giant warlord"))
                .expect("a card")
                .spell_data
        );
    }
}
