//! `Event` — one canonical `LogEvent`, as the fold reads it.
//!
//! IT IS A PARSED `serde_json::Value`, AND THAT IS A PHASE-2a DECISION WITH A REASON. `eqlog`
//! deliberately has no typed event enum: its whole bar is byte identity with `JSON.stringify(ev)`,
//! and what that writes is the object's INSERTION order — a property of the code PATH, not of the
//! kind (see `eqlog/src/event.rs`). Growing a typed struct per kind beside it would be a second
//! declaration of the same shapes, free to drift from the writer that the phase-1 bar actually
//! pins. So the fold reads the writer's own output.
//!
//! WHAT IT COSTS AND WHY THAT IS ACCEPTABLE HERE: one `serde_json` parse per event. This crate's
//! job in phase 2a is to prove the fold's SEMANTICS against the TS modules over six slices; the
//! engine's in-process seam (parser struct straight into the fold, no JSON in the middle) is a
//! later ticket's, and every module below reads fields through the accessors here rather than
//! through a `Value` directly, so replacing this type is a change to ONE file.
//!
//! ABSENT IS NOT NULL AND NEITHER IS ZERO. `str`/`int` answer `None` for a key the writer omitted
//! AND for one it wrote as `null` — the TS modules read both as `undefined` in every place any of
//! them looks, and collapsing the two here keeps the reading sites from each having to say so.

use serde_json::Value;

/// One event on the bus: a primary event from the parser, or a DERIVED one the fold synthesized.
#[derive(Debug, Clone)]
pub struct Event {
    v: Value,
}

impl Event {
    /// Parse one NDJSON line from `eqlog::scan`. `None` when the line is not a JSON object, which
    /// the scanner cannot produce and which therefore only a corrupt input can reach.
    pub fn from_json(line: &str) -> Option<Event> {
        let v: Value = serde_json::from_str(line).ok()?;
        v.is_object().then_some(Event { v })
    }

    /// Wrap a value the fold built itself — the `epoch` event and nothing else today.
    pub fn from_value(v: Value) -> Event {
        Event { v }
    }

    pub fn kind(&self) -> &str {
        self.str("kind").unwrap_or("")
    }

    /// The sequence number of the event. Every module writes it to its own `seq` field on EVERY
    /// event it is handed, derived ones included — that is the TS's first statement in `onEvent`.
    pub fn seq(&self) -> i64 {
        self.int("seq").unwrap_or(0)
    }

    pub fn ts(&self) -> i64 {
        self.int("ts").unwrap_or(0)
    }

    pub fn raw(&self) -> &str {
        self.str("raw").unwrap_or("")
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.v.get(key)?.as_str()
    }

    pub fn int(&self, key: &str) -> Option<i64> {
        self.v.get(key)?.as_i64()
    }

    pub fn bool(&self, key: &str) -> bool {
        self.v.get(key).and_then(Value::as_bool).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_omitted_key_and_an_explicit_null_read_the_same() {
        let ev = Event::from_json(r#"{"kind":"loot","seq":3,"ts":7,"raw":"x","source":null}"#)
            .expect("object");
        assert_eq!(ev.kind(), "loot");
        assert_eq!(ev.seq(), 3);
        assert_eq!(ev.ts(), 7);
        assert_eq!(ev.str("source"), None);
        assert_eq!(ev.str("item"), None);
        assert!(!ev.bool("created"));
    }
}
