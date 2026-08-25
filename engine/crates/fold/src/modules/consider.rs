//! `src/main/modules/consider.ts` — "what have I been sizing up, and what does it drop" (Task #63).
//!
//! ONE ROW PER MOB. A mob conned five times during one pull is one row with `cons: 5`, not five
//! rows — the real log does that constantly (the biggest run is a goblin magician conned nine times
//! inside thirty seconds), and five identical lines answer the question worse than one. The row
//! carries the MOST RECENT con's facts and a re-con moves it to the front, which is why the ring is
//! a `Vec` with a move-to-end rather than a `JsMap`: `insert` on an existing key would keep its
//! position, and this module deliberately does the opposite.
//!
//! HISTORY vs LIVE — deliberately DIFFERENT from the event feed one file over. The feed admits
//! nothing historical because a feed is a stream of things that just happened. This ring is a
//! STATE ("the mobs you've been conning"), so the startup replay DOES fold into it and the card is
//! populated the moment the app opens. What replay does NOT do is fire hundreds of wiki lookups:
//! enrichment is live-only plus a bounded backfill on the first wall-clock tick, and `knowledge` is
//! therefore ABSENT from every row in every golden — never an empty record meaning "we checked"
//! (law 1).
//!
//! THE OWN-LOOT INDEX, which this module OWNS the lifetime of, is folded here and published
//! nowhere. `mobLookup`'s shared `MobLootIndex` is fed by every `loot` event — historical included,
//! since your loot history is exactly what makes it useful — and reset on epoch, so that one owner
//! keeps it in step with the ring instead of a second bus subscription that could reset out of
//! phase. `foldArm.mts` passes a REAL one (`ownLoot: new MobLootIndex()`), which is why the loot
//! branch below is a fold rather than a skip; what it accumulates reaches `snapshot()` through
//! nothing, so the goldens constrain the COUNTS not at all and the branch is ported for its
//! REFUSALS, which are the part that could move the ring's own lifetime:
//!   * A DESTROY IS NEVER A DROP (JOS-401). `You successfully destroyed 38 Bone Chips.` rides the
//!     loot lane and names no mob; this index answers "what has this MOB handed me", so the row has
//!     nothing to say to it. The refusal is stated where the decision is made rather than inferred
//!     from a guard two files away.
//!   * A `loot` event RETURNS, so it can never reach the consider fold below it.
//!
//! WHAT IS NOT PORTED, by name: the async `probe` (needs `deps.lookupMob`, which `foldArm.mts`
//! passes nowhere — the bench's header calls the two knowledge lookups absent outright), the
//! `onTick` backfill, and the JOS-383 con-card hook (installed by `pipeline.ts` only, and live-only
//! by construction).
//!
//! THE BACKFILL'S ABSENCE IS ABOUT THE LOOKUP, NOT ABOUT THE TICK, and JOS-481 is why that sentence
//! had to be rewritten: a live engine ticks now (`Fold::tick`, owner ruling 22). `onTick` over there
//! does one thing — call `probe` for the newest rows the replay left in the ring — and `probe` is
//! the very method this crate cannot have, because the wiki FETCH stays app-side in v1 (boundary
//! verdict 5: the engine ships without a network stack and learns of a miss through an event the app
//! answers). So there is nothing for a tick to drive here until the miss/answer pair exists, and
//! implementing an `on_tick` that called nothing would be noise.

use crate::event::Event;
use crate::EqModule;
use eqlog::jsstr::{js_trim, JS_S};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::OnceLock;

/// How many considered mobs the ring keeps. Oldest fall off the FRONT.
pub const CONSIDER_CAP: usize = 50;

/// `shared/mobKey.ts mobKey` — THE canonical identity key for a mob name.
///
/// `parseCommon.idKey`'s rule (trim + lowercase) plus two folds. The QUOTE FOLD is what lets one
/// mob be one key across three sources: the log writes ``Innoruuk`s Chosen`` with a backtick, the
/// wiki writes it with a typographic or a straight apostrophe. The COPY-NUMBER STRIP removes a
/// trailing ` (N)`, which is OURS and not the game's — `combat/world.ts label()` appends the spawn
/// generation when more than one instance of a name has been engaged, and a copy number is not part
/// of an identity. Only DIGITS are stripped: a parenthesized WORD is part of the name (the instance
/// tiers, "(Awakened)" and friends).
///
/// It does NOT strip the leading article, deliberately: "a giant rat" and "giant rat" are different
/// wiki pages and the log always prints the article, so keeping it is both honest and lossless.
pub fn mob_key(name: &str) -> String {
    static COPY: OnceLock<Regex> = OnceLock::new();
    static QUOTE: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    let copy = COPY.get_or_init(|| Regex::new(&format!(r"{s}*\([0-9]+\)$", s = JS_S)).unwrap());
    let quote = QUOTE.get_or_init(|| Regex::new(r"[`\u{2019}\u{00b4}]").unwrap());
    let spaces = SPACES.get_or_init(|| Regex::new(&format!(r"{s}+", s = JS_S)).unwrap());
    // The TS chain, in its own order: trim, strip the copy number, lowercase, fold the quotes,
    // collapse the whitespace runs. Lowercasing BEFORE the quote fold is free (no quote has a
    // case) and is kept in place so the two files read the same.
    let a = copy.replace(js_trim(name), "");
    let b = a.to_lowercase();
    let c = quote.replace_all(&b, "'");
    spaces.replace_all(&c, " ").into_owned()
}

/// `adoptDisplay` — pick the display name to keep for a mob seen under two casings.
///
/// THE SAME RULE as `combat/world.ts adoptDisplay`: a lowercase-initial spelling is the mob's true
/// name ("a zol ghoul knight") and a sentence-start capital is an artifact of the line it appeared
/// in — and a consider line ALWAYS sentence-cases the leading article. So a lowercase spelling
/// wins, and otherwise the first one seen is kept.
fn adopt_display(current: Option<&str>, incoming: &str) -> String {
    let Some(current) = current else {
        return incoming.to_string();
    };
    if current == incoming {
        return current.to_string();
    }
    // `/^[a-z]/` — ASCII, as JS spells it.
    let lower_initial = |s: &str| s.starts_with(|c: char| c.is_ascii_lowercase());
    if lower_initial(incoming) || !lower_initial(current) {
        incoming.to_string()
    } else {
        current.to_string()
    }
}

/// `ConsiderRow`. Every optional field is `skip_serializing_if` because the golden was recorded
/// through `JSON.stringify`, which DROPS an `undefined` — a row conned before any zone line
/// carries no `zone` at all, and `knowledge` is absent from all six goldens.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsiderRow {
    id: String,
    mob: String,
    ts: i64,
    rare: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<i64>,
    faction: String,
    difficulty: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    zone: Option<String>,
    cons: i64,
}

#[derive(Default)]
pub struct ConsiderModule {
    /// Newest LAST (the UI reverses it), one entry per mob key. A linear scan is `indexOf`'s own
    /// cost and the ring is capped at fifty.
    ring: Vec<ConsiderRow>,
    zone: Option<String>,
    seq: i64,
    /// The shared own-loot index's ACCUMULATION, kept because this module owns its lifetime. It is
    /// published nowhere — see the header.
    own_loot: OwnLootIndex,
}

/// `mobLookupParse.ts MobLootIndex`, reduced to the half a fold can exercise: the note and the
/// reset. What it accumulates is read over IPC by the mob hover card and by the drop-rate surfaces,
/// neither of which is a snapshot, so the shape below is the accounting rather than the record —
/// enough to keep the refusals honest and to make the lifetime claim (one owner, reset on epoch)
/// mean something in this crate too.
#[derive(Default)]
struct OwnLootIndex {
    /// mob key → item name → (count, newest ts). Insertion order is not published.
    by_mob: std::collections::HashMap<String, std::collections::HashMap<String, (i64, i64)>>,
}

impl OwnLootIndex {
    fn reset(&mut self) {
        self.by_mob.clear();
    }

    /// `note(item, source, ts, count)` — a row with NO SOURCE is refused, which is what makes every
    /// drop-rate surface built on this index structurally immune to the destroy line.
    fn note(&mut self, item: &str, source: Option<&str>, ts: i64, count: i64) {
        let Some(source) = source else { return };
        let entry = self
            .by_mob
            .entry(mob_key(source))
            .or_default()
            .entry(item.to_string())
            .or_insert((0, 0));
        entry.0 += count;
        entry.1 = entry.1.max(ts);
    }
}

impl ConsiderModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold ONE `consider` line into the ring: upsert the mob's single row (moving it to the front
    /// and bumping `cons`), then evict past the cap.
    fn fold_consider(&mut self, ev: &Event) {
        let mob = ev.str("mob").unwrap_or_default();
        let id = mob_key(mob);
        if id.is_empty() {
            return;
        }
        let prev = self.ring.iter().position(|r| r.id == id);
        let (display, cons) = match prev {
            Some(i) => (
                adopt_display(Some(&self.ring[i].mob), mob),
                self.ring[i].cons + 1,
            ),
            None => (adopt_display(None, mob), 1),
        };
        let row = ConsiderRow {
            id,
            mob: display,
            ts: ev.ts(),
            rare: ev.bool("rare"),
            level: ev.int("level"),
            faction: ev.str("faction").unwrap_or_default().to_string(),
            difficulty: ev.str("difficulty").unwrap_or_default().to_string(),
            zone: self.zone.clone(),
            cons,
        };
        if let Some(i) = prev {
            self.ring.remove(i);
        }
        self.ring.push(row);
        while self.ring.len() > CONSIDER_CAP {
            self.ring.remove(0);
        }
    }
}

impl EqModule for ConsiderModule {
    fn id(&self) -> &'static str {
        "consider"
    }

    fn reset(&mut self) {
        self.ring.clear();
        self.zone = None;
        self.seq = 0;
        self.own_loot.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth (Task #49): everything before the boundary belongs to a dead
            // same-name character — including the loot history the own-loot index is built from,
            // which would otherwise credit this character with drops it never saw. Note the ZONE
            // is NOT cleared: the character is standing where they were standing.
            "epoch" => {
                self.ring.clear();
                self.own_loot.reset();
            }
            "zone" => self.zone = ev.str("zone").map(str::to_string),
            "loot" => {
                // A destroy names no mob and is not a drop — see the header.
                if ev.str("disposition") == Some("destroyed") {
                    return;
                }
                // Stacked loots add their COUNT, not 1.
                self.own_loot.note(
                    ev.str("item").unwrap_or_default(),
                    ev.str("source"),
                    ev.ts(),
                    ev.int("count").unwrap_or(1),
                );
            }
            "consider" => self.fold_consider(ev),
            _ => {}
        }
    }

    fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "state": self.ring })
    }
}
