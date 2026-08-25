//! `src/main/modules/loot.ts` — the self-loot history: a `LootEvent` tagged with the zone it
//! happened in, append-only.
//!
//! IT CARRIES THE DESTROY UNCHANGED (JOS-401): `disposition: 'destroyed'` rides the same row shape
//! as every other disposition, which is the whole reason a destroy was given a disposition instead
//! of an event kind. This module takes NO position on what any of them mean.
//!
//! EVERY OPTIONAL FIELD IS OMITTED WHEN ABSENT, never written as `null` — `JSON.stringify` drops a
//! key whose value is `undefined`, and the golden was recorded through it, so a row with no
//! `source` has no `source` key at all. `zone` is the module's OWN state (the last zone line seen)
//! and is absent for every row folded before the scan reached one.

use crate::event::Event;
use crate::EqModule;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct LootRow {
    ts: i64,
    item: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    zone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disposition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created: Option<String>,
}

#[derive(Default)]
pub struct LootModule {
    loot: Vec<LootRow>,
    zone: Option<String>,
    seq: i64,
}

impl LootModule {
    pub fn new() -> Self {
        Self::default()
    }
}

impl EqModule for LootModule {
    fn id(&self) -> &'static str {
        "loot"
    }

    fn reset(&mut self) {
        self.loot.clear();
        self.zone = None;
        self.seq = 0;
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth (Task #49): loot before the boundary is a dead same-name
            // character's. `zone` is KEPT — it is world state, not character-scoped.
            "epoch" => self.loot.clear(),
            "zone" => self.zone = ev.str("zone").map(str::to_string),
            "loot" => self.loot.push(LootRow {
                ts: ev.ts(),
                item: ev.str("item").unwrap_or_default().to_string(),
                source: ev.str("source").map(str::to_string),
                zone: self.zone.clone(),
                disposition: ev.str("disposition").map(str::to_string),
                count: ev.int("count"),
                created: ev.str("created").map(str::to_string),
            }),
            _ => {}
        }
    }

    fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "state": self.loot })
    }
}
