//! THE ALERT EVALUATOR, ENGINE-SIDE (JOS-482, owner ruling 22) — `src/main/modules/alerts.ts`'s
//! matcher half, ported for the one thing it does that a fold could never do before: FIRE.
//!
//! Until this file the alerts module was two maps and a comment saying why the other 900 lines
//! could not run (`alerts.rs`'s header): the def list was empty in every world the crate could
//! construct, and `Fold` delivers `live: false` from the first byte to the last. Ruling 22 removed
//! the first of those — `alerts.define` pushes the user's own definitions in — and the live tail
//! removes the second. So the matcher is here, and the app-side alert system reduces to
//! receive-fire-make-sound.
//!
//! ── WHAT A FIRE IS, AND WHY IT CARRIES WHAT IT CARRIES ─────────────────────────────────────────
//!
//! [`Fire`] is `FireMessage`'s payload, and it is FULLY RESOLVED HERE (the conCard principle): the
//! app must be able to make the identical noise from the frame alone, so `sound` is the key the
//! renderer's sound cache is already keyed by (`<packId>/<soundId>`) rather than a reference the
//! app would have to look a definition back up for. `at` is the LOG's clock, never the host's.
//!
//! ── WHAT IS PORTED, AND WHAT IS DELIBERATELY NOT ───────────────────────────────────────────────
//!
//! Ported, because each of them decides WHETHER a line makes a sound: `event` triggers with their
//! `where` matchers (literal or `/regex/`, case-insensitive), `raw` triggers, the `any`/`all`
//! composites, the `enabled` flag, the per-alert and per-TARGET cooldown clocks with their bounded
//! LRU map, the JOS-259/276 RANK FOLD on every key that names a spell, and the JOS-84 candidate
//! widening. Each is argued at its own function below against the TS it mirrors.
//!
//! NOT ported, and every one of them is named rather than discovered later:
//!
//! * **The JOS-216 EARLY-WARNING OFFSET.** A def carrying `earlyWarnSec` does not sound when its
//!   trigger matches over there — the match ARMS a warning that speaks N seconds before a timer
//!   row's estimated end, which needs the wall-clock heartbeat AND the buffs/buffTimers projection
//!   this crate does not wire into the alerts module. Such a def is therefore COMPILED OUT
//!   (`Rule::compile` answers `None` for it) rather than fired at the wrong instant: a missing
//!   sound is a gap somebody can see in this comment, and a sound made a minute early is a wrong
//!   answer wearing a right answer's clothes. It still appears in the module's published `defs`,
//!   because that list is the STORE's and not the evaluator's.
//! * **`app` triggers** (bossDefeat / questComplete). They are renderer-evaluated over there too —
//!   they depend on derived boss state that lives in the renderer — so they compile to a condition
//!   that never matches, exactly as `compileCondition` does.
//! * **Capture groups and the `{target}` auto token.** They decide what a firing SAYS, not whether
//!   it happens, and the four fields of a fire frame carry no room for them. When the audio cutover
//!   gives speech a home on the wire they arrive with it.
//! * **`matchedSpellName` / `firingSpell`.** Same reason: spell context is speech's input.
//!
//! ── ONE HONEST DIVERGENCE: WHOSE REGEX ENGINE ─────────────────────────────────────────────────
//!
//! An alert's `/regex/` spec is USER-AUTHORED and was authored against JavaScript's engine. Rust's
//! `regex` crate is a different engine with no lookaround and no backreferences, and its `.`
//! excludes one line terminator where JS's excludes four (the JS↔Rust divergence catalogue in
//! docs/plans/data-server.md). A pattern this crate cannot compile is handled EXACTLY as the TS
//! handles a pattern V8 cannot compile — a `where` matcher degrades to literal equality, a `raw`
//! trigger compiles to a pattern that can never match — so the failure mode is the one the app
//! already has a rule for. It is written down here because the SET of patterns that fall into it is
//! bigger on this side, and that is a fact about the cutover rather than about any one def.

use crate::event::Event;
use crate::jsmap::JsMap;
use eqlog::jsstr::write_js_number;
use eqlog::names::{id_key, spell_canon_key};
use regex::{Regex, RegexBuilder};
use serde_json::Value;

/// `DEFAULT_COOLDOWN_MS` — what a def that names no cooldown gets.
const DEFAULT_COOLDOWN_MS: i64 = 2000;

/// `COOLDOWN_KEY_CAP` — max distinct cooldown clocks at once, across every alert. An alert-level
/// clock is one entry per alert, so this bound exists for the `cooldownScope:'target'` alerts,
/// which mint an entry per mob. Eviction is least-recently-FIRED, which is what makes the bound
/// safe rather than merely small: the entry discarded is the one closest to having expired anyway.
const COOLDOWN_KEY_CAP: usize = 500;

/// Max fires kept per alert in the recent-fires ring — `HISTORY_CAP`.
const HISTORY_CAP: usize = 20;

/// ONE ALERT FIRED. The payload of a `FireMessage`, built where the alert system's own vocabulary
/// is rather than in `engined`, so the protocol crate never learns what an alert is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fire {
    /// The `ts` of the event that matched — the LOG's clock.
    pub at: i64,
    /// The alert's label (`AlertDef.name`).
    pub rule: String,
    /// `<packId>/<soundId>` — the key the app plays.
    pub sound: String,
    /// The text that matched: the raw log line.
    pub message: String,
}

/// One fire, as the module's published `history` ring records it — `AlertFireRecord`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FireRecord {
    ts: i64,
    matched_text: String,
}

/// A compiled matcher value: a literal (compared case-insensitively) or the `/regex/` the spec was
/// written in.
enum Matcher {
    /// Already lowercased, so a compare is one `to_lowercase` on the field and no allocation here.
    Literal(String),
    Pattern(Box<Regex>),
}

/// One compiled `where` entry: the event field it names, its matcher, and the rank-folded key when
/// it is a LITERAL matcher on a key that NAMES A SPELL.
struct Field {
    key: String,
    matcher: Matcher,
    /// `spellLineKey(spec)` — set ONLY for a literal matcher on a spell-naming key, and only when
    /// the fold leaves something to compare. Absent everywhere else, which is what keeps `caster`,
    /// `target` and every `/regex/` spec byte-for-byte what they were.
    line_key: Option<String>,
}

/// A single PRIMITIVE condition, prepared for fast evaluation.
enum Condition {
    Event { kind: String, fields: Vec<Field> },
    Raw(Box<Regex>),
    /// An `app` primitive: renderer-evaluated, so it never matches here. `compileCondition`'s empty
    /// return, spelled as a variant so the reader does not have to infer it from an absence.
    Never,
}

/// Composite semantics, evaluated against the SINGLE incoming event.
enum Composite {
    Single,
    Any,
    All,
}

/// One compiled alert.
pub struct Rule {
    id: String,
    name: String,
    sound: String,
    cooldown_ms: i64,
    /// `cooldownScope === 'target'`. Anything else — including a value some other build wrote —
    /// reads as `alert`, which is the safe direction and the same narrowing `ipc/alerts.ts` does.
    per_target: bool,
    composite: Composite,
    conditions: Vec<Condition>,
}

/// WHICH (kind, key) PAIRS NAME A SPELL — the compile-time half of the rank fold (JOS-259/276).
/// `spell` folds on every kind that has one; `damage.skill` joins it because the typed-nuke and DoT
/// shapes put the SPELL NAME there. Whether the fold actually REACHES a given event is a second
/// question, asked per event by [`fold_reaches`].
fn folds_rank(kind: &str, key: &str) -> bool {
    key == "spell" || (kind == "damage" && key == "skill")
}

/// WHETHER THE RANK FOLD REACHES THIS EVENT — the runtime half, and it exists for exactly one
/// field. `damage` puts four vocabularies in `skill` and only two of them are spell names: `spell`
/// (the typed nuke) and `dot` (the tick). `melee` is a closed table of ten constants and `ds` is
/// the damage-shield element, which is free text off the line — so the gate is written on the
/// DTYPE rather than left to a measurement that a new element could invalidate.
fn fold_reaches(field: &Field, ev: &Event) -> bool {
    if field.key != "skill" {
        return true;
    }
    ev.kind() == "damage" && matches!(ev.str("dtype"), Some("spell" | "dot"))
}

/// Stringify ONE event field for matching — JS's own `String()` coercion, reproduced rather than
/// improved on, because the coerced text is exactly what every existing alert def is matched
/// against: an array joins with ',' (a nullish element contributing ''), and an object element
/// renders as the literal '[object Object]'.
fn field_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            let mut out = String::new();
            write_js_number(&mut out, n.as_f64().unwrap_or_default());
            out
        }
        // Only reachable as an array ELEMENT — `join` renders nullish as ''. A top-level null is
        // refused before this is called (`field_matches`), exactly as `raw == null` refuses it.
        Value::Null => String::new(),
        Value::Array(a) => a.iter().map(field_text).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// THE SPELL NAMES ONE EVENT CAN HONESTLY ANSWER TO (JOS-84) — every name in the event's
/// `candidates` list, string elements and `{name}` objects alike, or empty when it carries none.
///
/// EQ's landing sentences are shared across a whole spell family (`<mob> slows down.` is five
/// different spells), so the parser puts a BEST-EFFORT pick in `spell` and the truth in
/// `candidates`. A `where.spell` matcher tests the whole set, or an enchanter's Shiftless Deeds
/// alert is compared against the string "Forlorn Deeds" and can never fire.
fn candidate_names(ev: &Event) -> Vec<String> {
    let Some(Value::Array(list)) = ev.get("candidates") else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|c| match c {
            Value::String(s) => Some(s.clone()),
            Value::Object(o) => o.get("name")?.as_str().map(str::to_owned),
            _ => None,
        })
        .collect()
}

/// Compile one matcher spec. A value wrapped in slashes is a case-insensitive regex; anything else
/// is a case-insensitive exact match. An INVALID regex falls back to literal equality so a bad def
/// degrades gracefully instead of matching nothing by accident — `compileFieldMatch`'s own rule,
/// and the one the divergence in this file's header lands on.
fn compile_field(key: &str, spec: &str, kind: &str) -> Field {
    if let Some(body) = pattern_body(spec) {
        if let Ok(re) = build_regex(body) {
            return Field {
                key: key.to_owned(),
                matcher: Matcher::Pattern(Box::new(re)),
                line_key: None,
            };
        }
    }
    let line_key = if folds_rank(kind, key) {
        let folded = spell_canon_key(spec);
        // A spec that is nothing but a roman numeral folds to '' and is left alone rather than
        // turned into a wildcard.
        (!folded.is_empty()).then_some(folded)
    } else {
        None
    };
    Field {
        key: key.to_owned(),
        matcher: Matcher::Literal(spec.to_lowercase()),
        line_key,
    }
}

/// The body of a `/…/` spec, or `None` for a literal.
fn pattern_body(spec: &str) -> Option<&str> {
    (spec.len() >= 2 && spec.starts_with('/') && spec.ends_with('/')).then(|| &spec[1..spec.len() - 1])
}

/// Every alert regex is case-insensitive and carries no `g` flag, so a match is stateless.
fn build_regex(body: &str) -> Result<Regex, regex::Error> {
    RegexBuilder::new(body).case_insensitive(true).build()
}

/// WHETHER A COMPILED MATCHER ACCEPTS ONE PIECE OF TEXT — exact equality or the pattern, plus the
/// RANK FOLD for a literal spell matcher.
///
/// THE RULE (JOS-259, owner ruling 2026-08-12): a spell alert fires for ALL RANKS of the spell. EQ
/// Legends re-tiers the classic spells as roman-numeral ranks of one base name and only SOME of the
/// lines a spell prints carry the suffix, so a def pinned to one spelling was an alert half the
/// spell's own lines could never satisfy. It WIDENS ONLY, AND ONLY FOR LITERALS: a `/regex/` spec
/// is user-authored pattern and asked a narrower question on purpose.
fn accepts(field: &Field, text: &str, folds: bool) -> bool {
    let hit = match &field.matcher {
        Matcher::Literal(lower) => text.to_lowercase() == *lower,
        Matcher::Pattern(re) => re.is_match(text),
    };
    if hit {
        return true;
    }
    folds
        && field
            .line_key
            .as_ref()
            .is_some_and(|k| spell_canon_key(text) == *k)
}

/// Whether ONE compiled `where` field accepts `ev`.
///
/// An ABSENT field is an immediate no-match, exactly as before — that is what keeps a
/// `where:{spell:…}` written against a family with no `spell` field from being admitted. The
/// candidate widening applies to the `spell` key and to nothing else.
fn field_matches(ev: &Event, field: &Field) -> bool {
    let Some(raw) = ev.get(&field.key) else {
        return false;
    };
    let folds = fold_reaches(field, ev);
    if accepts(field, &field_text(raw), folds) {
        return true;
    }
    field.key == "spell" && candidate_names(ev).iter().any(|n| accepts(field, n, folds))
}

/// Compile one PRIMITIVE trigger object into a matcher condition.
fn compile_condition(t: &Value) -> Condition {
    match t.get("type").and_then(Value::as_str) {
        Some("event") => {
            let kind = t
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let fields = t
                .get("where")
                .and_then(Value::as_object)
                .map(|w| {
                    w.iter()
                        .filter_map(|(key, spec)| {
                            Some(compile_field(key, spec.as_str()?, &kind))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Condition::Event { kind, fields }
        }
        Some("raw") => {
            let body = t.get("regex").and_then(Value::as_str).unwrap_or_default();
            // A bad regex should never match and never throw. `$.^` is the TS's own unmatchable
            // pattern; `(?!)` would be the idiomatic Rust one and this crate has no lookaround.
            let re = build_regex(body).or_else(|_| build_regex("$.^"));
            match re {
                Ok(re) => Condition::Raw(Box::new(re)),
                Err(_) => Condition::Never,
            }
        }
        // 'app' triggers are renderer-evaluated, and so is anything this build cannot read.
        _ => Condition::Never,
    }
}

impl Rule {
    /// Compile one stored `AlertDef`, or `None` when this build must not fire it. Two answers of
    /// `None` and they mean different things: a def that is switched off, and a def whose fire the
    /// APP MOVES (`earlyWarnSec` — see the module header, which argues why an early sound is worse
    /// than a missing one).
    pub fn compile(def: &Value) -> Option<Rule> {
        if !def.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
            return None;
        }
        if early_warn_sec(def).is_some() {
            return None;
        }
        let trigger = def.get("trigger")?;
        let (composite, conditions) = match trigger.get("conditions").and_then(Value::as_array) {
            Some(list) => {
                let composite = match trigger.get("type").and_then(Value::as_str) {
                    Some("all") => Composite::All,
                    _ => Composite::Any,
                };
                (composite, list.iter().map(compile_condition).collect())
            }
            None => (Composite::Single, vec![compile_condition(trigger)]),
        };
        let sound = def.get("sound")?;
        Some(Rule {
            id: def.get("id").and_then(Value::as_str)?.to_owned(),
            name: def
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            sound: format!(
                "{}/{}",
                sound.get("packId").and_then(Value::as_str).unwrap_or_default(),
                sound.get("soundId").and_then(Value::as_str).unwrap_or_default()
            ),
            cooldown_ms: def
                .get("cooldownMs")
                .and_then(Value::as_i64)
                .unwrap_or(DEFAULT_COOLDOWN_MS),
            per_target: def.get("cooldownScope").and_then(Value::as_str) == Some("target"),
            composite,
            conditions,
        })
    }

    /// The matched TEXT if this alert's trigger matches `ev`, else `None`.
    ///
    /// 'all' → every condition must match this ONE event (no cross-event windows, by design); an
    /// empty condition list cannot be satisfied meaningfully and is treated as no-match rather than
    /// as a firehose. 'any' / 'single' → the first matching condition.
    fn matches(&self, ev: &Event) -> Option<String> {
        let hit = match self.composite {
            Composite::All => {
                !self.conditions.is_empty()
                    && self.conditions.iter().all(|c| condition_matches(c, ev))
            }
            Composite::Any | Composite::Single => {
                self.conditions.iter().any(|c| condition_matches(c, ev))
            }
        };
        hit.then(|| ev.raw().to_owned())
    }

    /// The cooldown clock this firing belongs to.
    ///
    /// 'alert' (and absent) → the alert's own id. 'target' → `<id>\0<idKey(target)>`, so the first
    /// match on a mob always fires and only re-lands on THAT mob are rate-limited. A family that
    /// names no target DEGRADES to the alert-level clock rather than minting a bogus one — a
    /// quieter alert, never a missing cooldown. `idKey` is the repo-wide canonicalization, so
    /// "King Tranix" and "king tranix" cannot hold two clocks between them.
    ///
    /// RANK-BLIND BY CONSTRUCTION: no spell name enters this key, so one def firing on rank I and
    /// rank III of its own spell shares ONE clock.
    fn cooldown_key(&self, ev: &Event) -> String {
        if !self.per_target {
            return self.id.clone();
        }
        let Some(target) = ev.str("target") else {
            return self.id.clone();
        };
        let key = id_key(target);
        if key.is_empty() {
            self.id.clone()
        } else {
            format!("{}\u{0}{key}", self.id)
        }
    }
}

/// `normalizeEarlyWarnSec` in the one reading this crate needs: is this def's fire MOVED?
///
/// The app's normalizer bounds the value; here the only question is whether one was asked for at
/// all, so an out-of-range number reads as absent exactly as it does over there.
fn early_warn_sec(def: &Value) -> Option<i64> {
    let sec = def.get("earlyWarnSec")?.as_f64()?;
    let rounded = sec.round();
    #[allow(clippy::cast_possible_truncation)]
    (1.0..=600.0).contains(&rounded).then_some(rounded as i64)
}

fn condition_matches(cond: &Condition, ev: &Event) -> bool {
    match cond {
        Condition::Event { kind, fields } => {
            ev.kind() == kind && fields.iter().all(|f| field_matches(ev, f))
        }
        // A raw condition tests `ev.raw` — the exact line, and the only text it ever sees.
        Condition::Raw(re) => re.is_match(ev.raw()),
        Condition::Never => false,
    }
}

/// THE COMPILED RULE SET AND ITS CLOCKS — everything `alerts.define` installs, plus what firing
/// leaves behind.
#[derive(Default)]
pub struct RuleSet {
    /// The definitions VERBATIM, as the store holds them. Published as the module's `defs` — that
    /// list is the store's contract and carries the defs this evaluator compiled OUT as well as the
    /// ones it kept.
    defs: Vec<Value>,
    rules: Vec<Rule>,
    /// Cooldown clock → last fire timestamp. `def.id` for an alert-scoped clock and
    /// `def.id\0<targetKey>` for a per-target one; one map holds both because a NUL can appear in
    /// no alert id and in no mob name. Bounded by [`COOLDOWN_KEY_CAP`], least-recently-fired first,
    /// which the delete-then-insert in [`RuleSet::note_fire`] is what keeps true.
    last_fire: JsMap<i64>,
    /// Per-alert ring of recent fires, newest last — the module's published `history`.
    history: JsMap<Vec<FireRecord>>,
}

impl RuleSet {
    /// FULL-SET REPLACE (the command law). Everything about the previous set goes except the
    /// clocks and the history: a cooldown is a statement about a sound that was already made, and
    /// the fires ledger is user-facing history — neither is invalidated by the user editing a
    /// different alert. That is also what the TS does, whose `setDefs` touches `compiled` alone.
    pub fn set_defs(&mut self, defs: Vec<Value>) {
        self.rules = defs.iter().filter_map(Rule::compile).collect();
        self.defs = defs;
    }

    /// The definitions the store pushed, for `snapshot()`.
    pub fn defs(&self) -> &[Value] {
        &self.defs
    }

    /// The recent-fires ring as a plain object for the snapshot.
    pub fn history(&self) -> Value {
        let mut out = serde_json::Map::new();
        for (id, records) in self.history.iter() {
            out.insert(
                id.to_owned(),
                serde_json::to_value(records).unwrap_or(Value::Null),
            );
        }
        Value::Object(out)
    }

    /// A CHARACTER SWITCH. The defs stay — they are user prefs, not log state, and the app does not
    /// re-push them for a rebirth — while the per-character firing bookkeeping goes.
    pub fn reset(&mut self) {
        self.last_fire.clear();
    }

    /// EVALUATE ONE LIVE EVENT. The caller has already established that it is live; this function
    /// is never reached for a historical one, which is the boundary law ("replay must never make a
    /// sound") kept where the TS keeps it — one gate, above the loop.
    pub fn fire(&mut self, ev: &Event) -> Vec<Fire> {
        let mut out = Vec::new();
        // Collected before the clocks are written because a rule borrow cannot outlive one.
        let mut hits: Vec<(usize, String, String)> = Vec::new();
        for (i, rule) in self.rules.iter().enumerate() {
            if let Some(text) = rule.matches(ev) {
                hits.push((i, rule.cooldown_key(ev), text));
            }
        }
        for (i, key, text) in hits {
            let rule = &self.rules[i];
            if self.on_cooldown(&key, rule.cooldown_ms, ev.ts()) {
                continue;
            }
            let fire = Fire {
                at: ev.ts(),
                rule: rule.name.clone(),
                sound: rule.sound.clone(),
                message: text.clone(),
            };
            let id = rule.id.clone();
            self.note_fire(&key, ev.ts());
            self.record(&id, ev.ts(), text);
            out.push(fire);
        }
        out
    }

    /// Whether clock `key` is still inside `cooldown_ms` at `ts`.
    fn on_cooldown(&self, key: &str, cooldown_ms: i64, ts: i64) -> bool {
        self.last_fire
            .get(key)
            .is_some_and(|&last| ts - last < cooldown_ms)
    }

    /// Stamp a fire on clock `key`, keeping the map bounded and its iteration order
    /// least-recently-fired first (remove-then-insert re-inserts at the tail).
    fn note_fire(&mut self, key: &str, ts: i64) {
        self.last_fire.remove(key);
        self.last_fire.insert(key.to_owned(), ts);
        if self.last_fire.len() > COOLDOWN_KEY_CAP {
            let oldest = self.last_fire.keys().next().map(str::to_owned);
            if let Some(k) = oldest {
                self.last_fire.remove(&k);
            }
        }
    }

    /// Append a fire to an alert's ring buffer, capping at [`HISTORY_CAP`] (newest last).
    fn record(&mut self, id: &str, ts: i64, matched_text: String) {
        let record = FireRecord { ts, matched_text };
        if let Some(ring) = self.history.get_mut(id) {
            ring.push(record);
            if ring.len() > HISTORY_CAP {
                ring.drain(..ring.len() - HISTORY_CAP);
            }
            return;
        }
        self.history.insert(id.to_owned(), vec![record]);
    }
}

#[cfg(test)]
mod tests {
    use super::{Fire, RuleSet};
    use crate::event::Event;
    use serde_json::{json, Value};

    fn ev(line: &str) -> Event {
        Event::from_json(line).expect("a JSON object")
    }

    fn def(trigger: Value) -> Value {
        json!({
            "id": "a1",
            "name": "Charm break",
            "enabled": true,
            "sound": { "packId": "classic", "soundId": "ding" },
            "trigger": trigger
        })
    }

    fn set(defs: Vec<Value>) -> RuleSet {
        let mut rules = RuleSet::default();
        rules.set_defs(defs);
        rules
    }

    #[test]
    fn an_event_trigger_fires_and_the_frame_is_fully_resolved() {
        let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
        let fires = rules.fire(&ev(
            r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"Your charm spell has worn off.","mob":"a rat"}"#,
        ));
        assert_eq!(
            fires,
            vec![Fire {
                at: 1000,
                rule: "Charm break".to_owned(),
                sound: "classic/ding".to_owned(),
                message: "Your charm spell has worn off.".to_owned(),
            }]
        );
    }

    #[test]
    fn a_disabled_alert_compiles_to_nothing() {
        let mut off = def(json!({"type":"event","kind":"uncharm"}));
        off["enabled"] = json!(false);
        let mut rules = set(vec![off]);
        assert!(rules
            .fire(&ev(r#"{"kind":"uncharm","seq":1,"ts":1,"raw":"x"}"#))
            .is_empty());
        // …and the store's list still carries it: `defs` is the store's contract, not the
        // evaluator's.
        assert_eq!(rules.defs().len(), 1);
    }

    #[test]
    fn a_def_whose_fire_the_app_moves_is_not_fired_here() {
        // JOS-216's early warning. Compiled OUT rather than fired at the wrong instant.
        let mut early = def(json!({"type":"event","kind":"uncharm"}));
        early["earlyWarnSec"] = json!(10);
        let mut rules = set(vec![early]);
        assert!(rules
            .fire(&ev(r#"{"kind":"uncharm","seq":1,"ts":1,"raw":"x"}"#))
            .is_empty());
    }

    #[test]
    fn a_where_matcher_narrows_and_an_absent_field_never_matches() {
        let mut rules = set(vec![def(
            json!({"type":"event","kind":"death","where":{"name":"a fire giant"}}),
        )]);
        assert!(rules
            .fire(&ev(
                r#"{"kind":"death","seq":1,"ts":1,"raw":"d","name":"A Fire Giant"}"#
            ))
            .len()
            == 1);
        assert!(rules
            .fire(&ev(r#"{"kind":"death","seq":2,"ts":9000,"raw":"d","name":"a rat"}"#))
            .is_empty());
        assert!(rules
            .fire(&ev(r#"{"kind":"death","seq":3,"ts":18000,"raw":"d"}"#))
            .is_empty());
    }

    #[test]
    fn a_literal_spell_matcher_is_rank_blind_and_a_regex_one_is_not() {
        let mut literal = set(vec![def(
            json!({"type":"event","kind":"castBegin","where":{"spell":"Elemental Maelstrom"}}),
        )]);
        assert_eq!(
            literal
                .fire(&ev(
                    r#"{"kind":"castBegin","seq":1,"ts":1,"raw":"c","spell":"Elemental Maelstrom III"}"#
                ))
                .len(),
            1
        );
        let mut pattern = set(vec![def(
            json!({"type":"event","kind":"castBegin","where":{"spell":"/^Elemental Maelstrom$/"}}),
        )]);
        assert!(pattern
            .fire(&ev(
                r#"{"kind":"castBegin","seq":1,"ts":1,"raw":"c","spell":"Elemental Maelstrom III"}"#
            ))
            .is_empty());
    }

    #[test]
    fn the_rank_fold_reaches_a_damage_skill_only_for_the_two_spell_dtypes() {
        let d = def(json!({"type":"event","kind":"damage","where":{"skill":"Harm Touch"}}));
        let mut rules = set(vec![d]);
        assert_eq!(
            rules
                .fire(&ev(
                    r#"{"kind":"damage","seq":1,"ts":1,"raw":"d","dtype":"spell","skill":"Harm Touch III"}"#
                ))
                .len(),
            1
        );
        // A melee skill can carry no rank, and the gate is written on the dtype rather than on a
        // measurement: a `ds` element the game adds tomorrow cannot quietly start folding.
        assert!(rules
            .fire(&ev(
                r#"{"kind":"damage","seq":2,"ts":9000,"raw":"d","dtype":"ds","skill":"Harm Touch III"}"#
            ))
            .is_empty());
    }

    #[test]
    fn a_spell_matcher_tests_the_whole_candidate_family() {
        let mut rules = set(vec![def(
            json!({"type":"event","kind":"buffApply","where":{"spell":"Shiftless Deeds"}}),
        )]);
        // The parser's best-effort pick is another member of the family; the truth is in
        // `candidates`, and an alert on any one of them is an alert on the family (JOS-84).
        let fires = rules.fire(&ev(
            r#"{"kind":"buffApply","seq":1,"ts":1,"raw":"a mob slows down.","spell":"Forlorn Deeds","candidates":[{"name":"Forlorn Deeds"},{"name":"Shiftless Deeds"}]}"#,
        ));
        assert_eq!(fires.len(), 1);
    }

    #[test]
    fn a_raw_trigger_reads_the_line_and_a_composite_reads_one_event() {
        let mut raw = set(vec![def(json!({"type":"raw","regex":"you have been slain"}))]);
        assert_eq!(
            raw.fire(&ev(
                r#"{"kind":"unknown","seq":1,"ts":1,"raw":"You have been slain by a rat!"}"#
            ))
            .len(),
            1
        );
        let mut all = set(vec![def(json!({
            "type": "all",
            "conditions": [
                {"type":"event","kind":"damage","where":{"dtype":"spell"}},
                {"type":"event","kind":"damage","where":{"target":"Primitive"}}
            ]
        }))]);
        assert_eq!(
            all.fire(&ev(
                r#"{"kind":"damage","seq":1,"ts":1,"raw":"d","dtype":"spell","target":"Primitive"}"#
            ))
            .len(),
            1
        );
        assert!(all
            .fire(&ev(
                r#"{"kind":"damage","seq":2,"ts":9000,"raw":"d","dtype":"melee","target":"Primitive"}"#
            ))
            .is_empty());
    }

    #[test]
    fn the_cooldown_is_per_alert_unless_the_def_asks_for_per_target() {
        let mut plain = set(vec![def(json!({"type":"event","kind":"death"}))]);
        let a = r#"{"kind":"death","seq":1,"ts":1000,"raw":"d","target":"a rat"}"#;
        let b = r#"{"kind":"death","seq":2,"ts":1500,"raw":"d","target":"a fire giant"}"#;
        assert_eq!(plain.fire(&ev(a)).len(), 1);
        assert!(plain.fire(&ev(b)).is_empty(), "one clock silences both");

        let mut scoped = def(json!({"type":"event","kind":"death"}));
        scoped["cooldownScope"] = json!("target");
        let mut per_target = set(vec![scoped]);
        assert_eq!(per_target.fire(&ev(a)).len(), 1);
        assert_eq!(
            per_target.fire(&ev(b)).len(),
            1,
            "the first match on a new mob always fires"
        );
        assert!(
            per_target.fire(&ev(a)).is_empty(),
            "and only re-lands on THAT mob are quiet"
        );
    }

    #[test]
    fn a_fire_is_recorded_in_the_alerts_own_ring() {
        let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
        rules.fire(&ev(r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"broke!"}"#));
        assert_eq!(
            rules.history(),
            json!({ "a1": [{ "ts": 1000, "matchedText": "broke!" }] })
        );
    }

    #[test]
    fn a_full_set_replace_forgets_the_previous_set() {
        let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
        let mut other = def(json!({"type":"event","kind":"death"}));
        other["id"] = json!("a2");
        rules.set_defs(vec![other]);
        assert_eq!(rules.defs().len(), 1);
        assert!(rules
            .fire(&ev(r#"{"kind":"uncharm","seq":1,"ts":1,"raw":"x"}"#))
            .is_empty());
        assert_eq!(
            rules
                .fire(&ev(r#"{"kind":"death","seq":2,"ts":2,"raw":"d"}"#))
                .len(),
            1
        );
    }

    #[test]
    fn an_app_trigger_never_fires_here() {
        let mut rules = set(vec![def(json!({"type":"app","signal":"bossDefeat"}))]);
        assert!(rules
            .fire(&ev(r#"{"kind":"death","seq":1,"ts":1,"raw":"d"}"#))
            .is_empty());
    }

    #[test]
    fn a_regex_this_engine_cannot_compile_degrades_the_way_the_app_does() {
        // A `where` matcher falls back to LITERAL equality on the spec, slashes and all…
        let mut field = set(vec![def(
            json!({"type":"event","kind":"death","where":{"name":"/(?<=a )rat/"}}),
        )]);
        assert!(field
            .fire(&ev(r#"{"kind":"death","seq":1,"ts":1,"raw":"d","name":"a rat"}"#))
            .is_empty());
        // …and a `raw` trigger compiles to a pattern nothing can satisfy.
        let mut raw = set(vec![def(json!({"type":"raw","regex":"(?<=a )rat"}))]);
        assert!(raw
            .fire(&ev(r#"{"kind":"unknown","seq":1,"ts":1,"raw":"a rat"}"#))
            .is_empty());
    }
}
