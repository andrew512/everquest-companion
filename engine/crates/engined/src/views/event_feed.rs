//! `eventFeed.recent` — THE EVENTS OVERLAY'S RING (JOS-487).
//!
//! ── THIS SOURCE SERVES AN EMPTY WINDOW IN EVERY FOLD THIS BUILD CAN PERFORM, AND SAYS SO ───────
//!
//! It is registered anyway, and the argument that kept it out until now is worth restating because
//! this is the half of it that changed. `views::mod`'s header said a view over the event feed
//! "could only ever serve an empty window and no test could tell a working one from a broken one".
//! The first clause is still true — the ring admits nothing that did not arrive live through an
//! injected item probe, an injected consider table, or an out-of-band alert or quest push, and this
//! engine carries none of the four (`fold::modules::event_feed` argues all of them). The second
//! clause is what this file disproves: the PROJECTION is a pure function of a ring, so it is
//! exercised against a hand-built one below, and a broken cell fails a test whether or not any fold
//! can produce the entry it mangled.
//!
//! So the honest state is: the source is real, the cells are pinned, and the ring is empty until
//! the sources that feed it exist. A client that subscribes gets a valid, empty, correctly-shaped
//! window rather than `notFound` — which is the difference between "there is nothing here yet" and
//! "this engine has never heard of your surface", and those are different things for a renderer to
//! be told during a cutover.
//!
//! ── THE RING IS UNTYPED HERE, AND THAT IS THE MODULE'S SHAPE RATHER THAN A SHORTCUT ────────────
//!
//! `EventFeedModule` keeps `Vec<Value>` because its TS twin keeps a `FeedEvent[]` whose four kinds
//! carry four different optional blocks. This file reads what it needs out of each entry the way
//! `Event` reads what a module needs out of an event — one reader, at the place that knows what the
//! fields mean.
//!
//! ── TWO NESTED BLOCKS ARE FLATTENED, BECAUSE A `Cell` IS A SCALAR ──────────────────────────────
//!
//! `FeedEvent.reward` and `.con` are objects. They become prefixed cells (`rewardItem`,
//! `conFaction`, …) rather than JSON strings: a client that had to `JSON.parse` a cell would be
//! doing the munging ruling 4 forbids, and a nested cell is not a thing the diff protocol can
//! update — `UpdateOp` carries CHANGED CELLS, so a nested object would be re-sent whole every time
//! one number inside it moved.

use protocol::cell::Cell;
use protocol::generated::Cells;
use serde_json::Value;

use fold::modules::event_feed::EventFeedModule;

use super::{Field, Order, SourceDef, SourceRow};

/// The registry entry. See [`super::SourceDef`].
pub const RECENT: SourceDef = SourceDef {
    id: "eventFeed.recent",
    fields: &["at", "seq", "kind", "title"],
    // NEWEST FIRST — the overlay stores the ring oldest-last and reverses it to draw.
    default_sort: &[("at", Order::Desc), ("seq", Order::Desc)],
    tiebreak: ("seq", Order::Asc),
    default_limit: super::DEFAULT_LIMIT,
};

/// Build a row per feed entry, in the ring's own order.
///
/// THE KEY IS THE ENTRY'S OWN `id`, which the feed mints per entry precisely so that two identical
/// lines a second apart are two rows. Falling back to the position would be wrong for this ring in
/// a way it is not for the loot ledger: the feed drops from the FRONT at a hundred, so a position
/// names a different event after the hundred-and-first.
#[must_use]
pub fn rows(module: &EventFeedModule) -> Vec<SourceRow> {
    rows_of(module.ring())
}

/// The projection itself, over a ring rather than over a module.
///
/// SPLIT OUT SO IT CAN BE TESTED, and that split is this file's whole answer to the objection that
/// kept the source unregistered: no fold this build performs can put an entry in the module's ring,
/// so a test that went through the module could only ever assert emptiness. This one takes the ring
/// directly and pins every cell.
#[must_use]
pub fn rows_of(ring: &[Value]) -> Vec<SourceRow> {
    ring.iter()
        .enumerate()
        .map(|(index, entry)| {
            let seq = i64::try_from(index).unwrap_or(i64::MAX);
            let at = int(entry, "at").or_else(|| int(entry, "ts")).unwrap_or(0);
            SourceRow {
                key: text(entry, "id").unwrap_or_else(|| format!("feed:{index}")),
                cells: cells(entry, at),
                fields: vec![
                    ("at", Field::Int(at)),
                    ("seq", Field::Int(seq)),
                    ("kind", text_field(entry, "kind")),
                    ("title", text_field(entry, "title")),
                ],
            }
        })
        .collect()
}

fn cells(entry: &Value, at: i64) -> Cells {
    let mut cells = std::collections::BTreeMap::new();
    cells.insert("at".to_owned(), Cell::int(at));
    cells.insert("kind".to_owned(), cell(entry, "kind"));
    cells.insert("title".to_owned(), cell(entry, "title"));
    cells.insert("detail".to_owned(), cell(entry, "detail"));
    cells.insert("page".to_owned(), cell(entry, "page"));
    cells.insert("rewardItem".to_owned(), nested(entry, "reward", "item"));
    cells.insert("rewardPage".to_owned(), nested(entry, "reward", "page"));
    cells.insert("rewardStats".to_owned(), nested(entry, "reward", "stats"));
    cells.insert("conFaction".to_owned(), nested(entry, "con", "faction"));
    cells.insert(
        "conDifficulty".to_owned(),
        nested(entry, "con", "difficulty"),
    );
    cells.insert(
        "conLevel".to_owned(),
        entry
            .get("con")
            .and_then(|c| c.get("level"))
            .and_then(Value::as_i64)
            .map_or_else(Cell::null, Cell::int),
    );
    cells.insert(
        "conRare".to_owned(),
        // ABSENT AND FALSE ARE THE SAME ANSWER HERE, and only here: `rare` is a flag the parser
        // writes only when the infix was on the line, so "no con block at all" and "a con block
        // with no rare flag" both mean this creature is not rare. A cell of `null` would make a
        // renderer branch on a distinction that carries no information.
        Cell::flag(
            entry
                .get("con")
                .and_then(|c| c.get("rare"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ),
    );
    Cells(cells)
}

fn cell(entry: &Value, key: &str) -> Cell {
    text(entry, key).map_or_else(Cell::null, Cell::text)
}

fn nested(entry: &Value, block: &str, key: &str) -> Cell {
    entry
        .get(block)
        .and_then(|b| b.get(key))
        .and_then(Value::as_str)
        .map_or_else(Cell::null, Cell::text)
}

fn text(entry: &Value, key: &str) -> Option<String> {
    entry.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn int(entry: &Value, key: &str) -> Option<i64> {
    entry.get(key).and_then(Value::as_i64)
}

fn text_field(entry: &Value, key: &str) -> Field {
    text(entry, key).map_or(Field::Missing, Field::Text)
}

#[cfg(test)]
mod tests {
    use super::{rows, RECENT};
    use crate::views::{cut, validate, SourceRow};
    use protocol::generated::ViewDescriptor;
    use protocol::Cell;

    /// The projection over a hand-built ring — see the module header for why this is the test that
    /// makes the source honest rather than a placeholder.
    fn projected(ring: &[serde_json::Value]) -> Vec<SourceRow> {
        super::rows_of(ring)
    }

    fn a_quest() -> serde_json::Value {
        serde_json::json!({
            "id": "q1",
            "kind": "quest",
            "ts": 1_787_181_707_000_i64,
            "title": "Coldain Ring 3",
            "detail": "Handed in to Corflunk",
            "page": "Coldain_Ring_War",
            "reward": { "item": "Ring of Dain", "stats": "AC 10", "page": "Ring_of_Dain" }
        })
    }

    fn a_con() -> serde_json::Value {
        serde_json::json!({
            "id": "c1",
            "kind": "con",
            "ts": 1_787_181_767_000_i64,
            "title": "a fire giant warlord",
            "con": { "faction": "threateningly", "level": 52, "rare": true, "difficulty": "even" }
        })
    }

    #[test]
    fn the_nested_blocks_are_flattened_into_scalars() {
        let built = projected(&[a_quest(), a_con()]);
        assert_eq!(built[0].key, "q1");
        assert_eq!(built[0].cells["rewardItem"], Cell::text("Ring of Dain"));
        assert_eq!(built[0].cells["rewardStats"], Cell::text("AC 10"));
        // An entry with no reward block says null for each of its cells rather than dropping them:
        // a diff needs a cell to be able to become null.
        assert_eq!(built[1].cells["rewardItem"], Cell::null());
        assert_eq!(built[1].cells["conFaction"], Cell::text("threateningly"));
        assert_eq!(built[1].cells["conLevel"], Cell::int(52));
        assert_eq!(built[1].cells["conRare"], Cell::flag(true));
        // …and the quest, which has no con block at all, is not rare rather than unknown.
        assert_eq!(built[0].cells["conRare"], Cell::flag(false));
    }

    #[test]
    fn the_default_window_is_newest_first() {
        let built = projected(&[a_quest(), a_con()]);
        let view = validate(&ViewDescriptor {
            source: RECENT.id.to_owned(),
            filter: None,
            sort: Vec::new(),
            window: None,
        })
        .expect("a view");
        let (window, total) = cut(&view, &built);
        assert_eq!(total, 2);
        assert_eq!(
            window.iter().map(|r| r.key.0.as_str()).collect::<Vec<_>>(),
            ["c1", "q1"]
        );
    }

    #[test]
    fn a_real_fold_serves_an_empty_window_and_that_is_the_honest_answer() {
        // THE CLAIM THE HEADER MAKES, PINNED. Not "we forgot to fill it" — a fold with the whole
        // registry and a zone, a loot and a consider line in it still leaves this ring empty,
        // because every one of the feed's four sources is behind something this engine has not got.
        let mut f = fold::Fold::new(fold::registered(fold::ClusterDeps::default()), i64::MAX);
        for line in [
            r#"{"kind":"zone","seq":0,"ts":1787181707000,"raw":"z","zone":"Nagafen's Lair"}"#,
            r#"{"kind":"loot","seq":1,"ts":1787181707000,"raw":"l","item":"Cloak of Flames","source":"a fire giant warlord"}"#,
            r#"{"kind":"consider","seq":2,"ts":1787181717000,"raw":"c","mob":"a fire giant warlord","level":52,"faction":"threateningly","difficulty":"even"}"#,
        ] {
            f.on_primary(
                &fold::event::Event::from_json(line).expect("an event"),
                true,
            );
        }
        let module = f.registry.event_feed().expect("the eventFeed module");
        assert!(rows(module).is_empty());
    }
}
