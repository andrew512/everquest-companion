//! The engine's AGGREGATION primitives — `src/main/combat/aggregate.ts`.
//!
//! Everything here is pure accumulation over a SEGMENT (an encounter or a zone session): per-source
//! / per-category / per-skill damage stats, the accuracy and resist counters, the target ledger and
//! the healing annotations. No engine state, no world model, no time — the state machine that
//! decides WHICH aggregate a line belongs to is `routing.rs`'s job, not this file's.
//!
//! ── WHAT IS PORTED HERE TODAY, AND WHAT IS NOT (JOS-477, honest scope) ─────────────────────────
//!
//! PORTED: `out` / `inc` / `targets` / `enemy_heal` / `inc_heal`, the per-skill and per-category
//! breakdowns, the accuracy and resist counters, and the two reducers every segment summary and
//! zone-session summary is built out of.
//!
//! NOT PORTED: the melee-ROUND grouper (`rounds.ts`), the minute-WINDOW ledger (`procWindows.ts`),
//! the meter-grade HEALING ledger (`healing.ts`) and the modifier tallies. Every one of those is
//! read ONLY by a view builder (`roundViews` / `procViews` / `healing`), and the view builders are
//! the last stage of this port — so a field here that nothing writes and nothing reads would be a
//! shape claiming a capability the fold does not have. They are ABSENT rather than zero-filled, and
//! the ledger COUNTS the gap rather than papering over it.
//!
//! THE PROC LEDGER IS NOT DECLARED AT ALL. Its one snapshot-visible consumer is the rolling
//! time-to-slow sample, and that sample's gate is a BLADE COAT at engage — which is unported, so no
//! pull can qualify and nothing would ever read the field. A `first_slow_ts` nothing writes and
//! nothing reads would be exactly the shape this header refuses.
//!
//! ── THE ORDER OF `out` IS PUBLISHED, AND SO IS `inc`'s ─────────────────────────────────────────
//!
//! `sourceViews.ts` turns both into ARRAYS, and array order is a claim the comparator checks — so
//! these are `JsMap`s (insertion-ordered, JS `Map` semantics) and never `HashMap`s. `targets`'s
//! order is published twice over: `encounter_name` reads its values and sorts by amount, and a sort
//! in JS is STABLE, so two targets that absorbed exactly the same damage are named in the order they
//! were first struck.

use crate::jsmap::JsMap;

/// The engine's internal damage record. Sourced from the canonical `damage` event, but with a
/// non-null attacker — caster-less other-player DoTs carry `attacker: null` and are dropped by the
/// caller before this is built.
#[derive(Debug, Clone)]
pub struct DamageEvent {
    pub ts: i64,
    pub attacker: String,
    pub target: String,
    pub amount: i64,
    pub dtype: String,
    pub dclass: Option<String>,
    pub skill: String,
    pub crit: bool,
    /// Taxonomy category. Derived from dtype+modifiers when the event omits it, so aggregation
    /// always has an axis.
    pub category: String,
    /// Parsed paren-modifier tokens, e.g. `["Riposte", "Critical"]`.
    pub modifiers: Vec<String>,
    /// The un-conjugated melee verb (`strike`, `kick`), on melee/slay lines only. The join key
    /// between a swing and the active special attack.
    pub verb: Option<String>,
}

/// The identity of a meter ROW. Bundled because the three always travel together — the outgoing
/// routing paths resolve them once and hand the same triple to every `Agg` method.
#[derive(Debug, Clone)]
pub struct SourceRef {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
}

/// `shared/combat.ts SourceKind`. Spelled as an enum rather than a string because exactly one
/// transition between two of them is legal (`Other` → `Member`, see `reid`) and an enum is what
/// makes "every other kind is a constant for a given row id" checkable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    You,
    Pet,
    Member,
    Other,
    AllyPet,
    Enemy,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::You => "you",
            SourceKind::Pet => "pet",
            SourceKind::Member => "member",
            SourceKind::Other => "other",
            SourceKind::AllyPet => "allyPet",
            SourceKind::Enemy => "enemy",
        }
    }
}

/// `shared/logEvents.ts MissType` — the six avoided-swing outcomes, in the order `MISS_KEYS` lists
/// them (which is the order the breakdown is serialized in).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissType {
    Miss,
    Dodge,
    Parry,
    Riposte,
    Block,
    Absorb,
}

impl MissType {
    pub fn parse(s: &str) -> Option<MissType> {
        Some(match s {
            "miss" => MissType::Miss,
            "dodge" => MissType::Dodge,
            "parry" => MissType::Parry,
            "riposte" => MissType::Riposte,
            "block" => MissType::Block,
            "absorb" => MissType::Absorb,
            _ => return None,
        })
    }

    fn slot(self) -> usize {
        self as usize
    }
}

/// ONE AVOIDED SWING as the aggregate folds it. `skill` stays `Melee` for every miss — that is the
/// shipped accuracy lane and it does not move — while `verb` / `lane_skill` / `modifiers` / `target`
/// are the additive, amount-free inputs to the round grouper and the modifier tallies.
#[derive(Debug, Clone)]
pub struct MissFold {
    pub mtype: MissType,
    /// The lane the miss counts against — `Melee` for every avoided swing, as shipped.
    pub skill: String,
    /// Un-conjugated verb off the miss line, when it named one.
    pub verb: Option<String>,
    /// The ROUND lane's display name for that verb (special-attack renamed) — never the aggregation
    /// lane above, which stays `Melee`.
    pub lane_skill: Option<String>,
    pub modifiers: Vec<String>,
    pub target: String,
    pub ts: i64,
}

#[derive(Debug, Clone, Default)]
pub struct SkillStat {
    pub name: String,
    pub total: i64,
    pub hits: i64,
    pub crits: i64,
    pub max: i64,
    /// Smallest LANDED amount on this lane; 0 = "no landed hit yet" (see `accrue_min`).
    pub min: i64,
    pub misses: i64,
    pub resists: i64,
}

fn new_skill(name: &str) -> SkillStat {
    SkillStat {
        name: name.to_string(),
        ..SkillStat::default()
    }
}

/// Fold a LANDED amount into a per-skill running minimum. 0 is the "nothing landed yet" sentinel:
/// `route()` drops `amount <= 0`, so every value reaching here is > 0 and a lane that only ever
/// missed or resisted keeps min 0 — never a fabricated "min 3 → min 0" from a whiff.
fn accrue_min(prev: i64, amount: i64) -> i64 {
    if prev == 0 {
        amount
    } else {
        prev.min(amount)
    }
}

/// Per-category rollup within a source (drill-down level 2). Holds the category total plus its own
/// per-skill breakdown (level 3).
#[derive(Debug, Clone, Default)]
pub struct CategoryStat {
    pub category: String,
    pub total: i64,
    pub hits: i64,
    pub crits: i64,
    pub max: i64,
    pub resists: i64,
    pub by_skill: JsMap<SkillStat>,
}

#[derive(Debug, Clone)]
pub struct SourceStat {
    pub name: String,
    pub kind: SourceKind,
    pub total: i64,
    pub hits: i64,
    pub crits: i64,
    pub ambiguous_hits: i64,
    pub ambiguous_total: i64,
    /// Avoided swings by this source, all outcomes.
    pub misses: i64,
    /// The six-slot breakdown, indexed by `MissType`.
    pub miss: [i64; 6],
    pub resists: i64,
    pub by_skill: JsMap<SkillStat>,
    pub by_category: JsMap<CategoryStat>,
}

pub fn new_source(name: &str, kind: SourceKind) -> SourceStat {
    SourceStat {
        name: name.to_string(),
        kind,
        total: 0,
        hits: 0,
        crits: 0,
        ambiguous_hits: 0,
        ambiguous_total: 0,
        misses: 0,
        miss: [0; 6],
        resists: 0,
        by_skill: JsMap::new(),
        by_category: JsMap::new(),
    }
}

/// A damage total booked against a named entity — the `targets`, `enemy_heal` and `inc_heal` shape.
#[derive(Debug, Clone)]
pub struct NamedTotal {
    pub name: String,
    pub amount: i64,
    /// Only `inc_heal` counts; the other two carry 0 and never publish it.
    pub count: i64,
}

/// The per-segment aggregate. Keyed by INSTANCE id (or `you` / `pet:<instanceId>` /
/// `member:<key>` / `allypet:<charmer>:<pet>`); `name` holds the display spelling, refreshed on every
/// arrival because the log's latest spelling wins (world-model law 2).
#[derive(Debug, Default)]
pub struct Agg {
    pub out: JsMap<SourceStat>,
    pub inc: JsMap<SourceStat>,
    pub targets: JsMap<NamedTotal>,
    /// Healing received by hostile instances engaged here (instanceId → total).
    pub enemy_heal: JsMap<NamedTotal>,
    /// Healing received by You / your pets: healerKey → { name, total, count }.
    pub inc_heal: JsMap<NamedTotal>,
}

impl Agg {
    pub fn new() -> Self {
        Agg::default()
    }

    /// Sum of a source map's totals — `sumMap`. The DPS numerator for a segment.
    pub fn sum(map: &JsMap<SourceStat>) -> i64 {
        map.values().map(|s| s.total).sum()
    }

    /// Sum of a heal map's amounts — `sumHeal`.
    pub fn sum_heal(map: &JsMap<NamedTotal>) -> i64 {
        map.values().map(|t| t.amount).sum()
    }

    /// True when this aggregate recorded nothing at all. THE DROP RULE both `finalize_current` and
    /// `finalize_zone_session` are gated on: a CC application or a lone miss can open an encounter
    /// that never accrues attributed damage — a mez lands and somebody else kills the mob — and a
    /// 0-damage shell must not pollute the history or the zone-session picker.
    ///
    /// IT IS `out.size === 0 && inc.size === 0`, NOT A TOTAL. A miss creates a source row with no
    /// damage on it, and such an encounter is deliberately KEPT: the hit-rate is real even when the
    /// damage is zero.
    pub fn is_empty(&self) -> bool {
        self.out.is_empty() && self.inc.is_empty()
    }

    /// RE-STATE a row's identity from the ref that just arrived. The display name has always been
    /// refreshed this way (world-model law 2).
    ///
    /// THE KIND MOVES TOO, and ONE transition is allowed: `Other` → `Member`. A combatant recorded
    /// before your group learned their name is `Other`; the moment the roster admits them the SAME
    /// row starts arriving as `Member` and the bar re-labels itself without splitting.
    ///
    /// IT IS ONE-WAY ON PURPOSE: the roster's admission set is cleared by a self-leave, so a
    /// free-running assignment would let the last line of a session decide what a fight two minutes
    /// earlier was. What this fight's damage WAS does not change when the group ends.
    fn reid(s: &mut SourceStat, r: &SourceRef) {
        if s.name != r.name {
            s.name = r.name.clone();
        }
        if s.kind == SourceKind::Other && r.kind == SourceKind::Member {
            s.kind = SourceKind::Member;
        }
    }

    fn out_row(&mut self, r: &SourceRef) -> &mut SourceStat {
        if !self.out.contains_key(&r.id) {
            self.out.insert(r.id.clone(), new_source(&r.name, r.kind));
        }
        let s = self.out.get_mut(&r.id).expect("just inserted");
        Agg::reid(s, r);
        s
    }

    fn inc_row(&mut self, id: &str, name: &str) -> &mut SourceStat {
        if !self.inc.contains_key(id) {
            self.inc
                .insert(id.to_string(), new_source(name, SourceKind::Enemy));
        }
        self.inc.get_mut(id).expect("just inserted")
    }

    /// DROP a recorded row. The one caller is `retract_other`: a name a stronger model has just
    /// claimed as a pet must not keep a second bar beside the pet's own. Safe by construction — an
    /// `Other` row is additive (it enters no you/pet total and no target/engaged set), so removing it
    /// can move nothing that existed before it did.
    pub fn drop_out(&mut self, id: &str) -> bool {
        self.out.remove(id)
    }

    pub fn add_out(&mut self, r: &SourceRef, ev: &DamageEvent, ambiguous: bool) {
        add_to_source(self.out_row(r), ev, ambiguous);
    }

    pub fn add_inc(&mut self, id: &str, name: &str, ev: &DamageEvent) {
        add_to_source(self.inc_row(id, name), ev, false);
    }

    pub fn add_out_miss(&mut self, r: &SourceRef, m: &MissFold) {
        add_miss_to_source(self.out_row(r), m);
    }

    pub fn add_inc_miss(&mut self, id: &str, name: &str, m: &MissFold) {
        add_miss_to_source(self.inc_row(id, name), m);
    }

    pub fn add_out_resist(&mut self, r: &SourceRef, spell: &str, category: &str) {
        add_resist_to_source(self.out_row(r), spell, category);
    }

    pub fn add_inc_resist(&mut self, id: &str, name: &str, spell: &str, category: &str) {
        add_resist_to_source(self.inc_row(id, name), spell, category);
    }

    pub fn add_enemy_heal(&mut self, id: &str, name: &str, amount: i64) {
        bump(&mut self.enemy_heal, id, name, amount, false);
    }

    pub fn add_inc_heal(&mut self, healer_key: &str, name: &str, amount: i64) {
        bump(&mut self.inc_heal, healer_key, name, amount, true);
    }

    pub fn bump_target(&mut self, id: &str, name: &str, amount: i64) {
        bump(&mut self.targets, id, name, amount, false);
    }
}

fn bump(map: &mut JsMap<NamedTotal>, id: &str, name: &str, amount: i64, counted: bool) {
    if !map.contains_key(id) {
        map.insert(
            id.to_string(),
            NamedTotal {
                name: name.to_string(),
                amount: 0,
                count: 0,
            },
        );
    }
    let t = map.get_mut(id).expect("just inserted");
    t.amount += amount;
    if counted {
        t.count += 1;
    }
}

fn add_to_source(src: &mut SourceStat, ev: &DamageEvent, ambiguous: bool) {
    src.total += ev.amount;
    src.hits += 1;
    if ev.crit {
        src.crits += 1;
    }
    if ambiguous {
        src.ambiguous_hits += 1;
        src.ambiguous_total += ev.amount;
    }
    {
        let s = lane(&mut src.by_skill, &ev.skill);
        s.total += ev.amount;
        s.hits += 1;
        if ev.crit {
            s.crits += 1;
        }
        s.max = s.max.max(ev.amount);
        s.min = accrue_min(s.min, ev.amount);
    }
    add_to_category(src, ev);
}

/// Category rollup (drill-down level 2/3): the same skill breakdown, partitioned by taxonomy
/// category so a source can be opened into melee/slay/spell/dot/ds.
fn add_to_category(src: &mut SourceStat, ev: &DamageEvent) {
    if !src.by_category.contains_key(&ev.category) {
        src.by_category.insert(
            ev.category.clone(),
            CategoryStat {
                category: ev.category.clone(),
                ..CategoryStat::default()
            },
        );
    }
    let c = src
        .by_category
        .get_mut(&ev.category)
        .expect("just inserted");
    c.total += ev.amount;
    c.hits += 1;
    if ev.crit {
        c.crits += 1;
    }
    c.max = c.max.max(ev.amount);
    let cs = lane(&mut c.by_skill, &ev.skill);
    cs.total += ev.amount;
    cs.hits += 1;
    if ev.crit {
        cs.crits += 1;
    }
    cs.max = cs.max.max(ev.amount);
    cs.min = accrue_min(cs.min, ev.amount);
}

/// Fold a miss (avoided swing) into a source's accuracy stats. The lane is created lazily, which is
/// what makes an encounter of nothing but whiffs a real encounter rather than an empty one.
fn add_miss_to_source(src: &mut SourceStat, m: &MissFold) {
    src.misses += 1;
    src.miss[m.mtype.slot()] += 1;
    lane(&mut src.by_skill, &m.skill).misses += 1;
}

/// Fold a spell RESIST into a source's stats — the caster-side analogue of a miss. It attaches to
/// the resisted spell's lane in the given taxonomy category. It carries no damage, so only the
/// resist COUNTERS move and the source's damage total is byte-for-byte unchanged (the tripwire). The
/// lane is created lazily, so a spell that was ALWAYS resisted still shows a row (0 hits / N resists
/// → 0% land).
fn add_resist_to_source(src: &mut SourceStat, spell: &str, category: &str) {
    src.resists += 1;
    lane(&mut src.by_skill, spell).resists += 1;
    if !src.by_category.contains_key(category) {
        src.by_category.insert(
            category.to_string(),
            CategoryStat {
                category: category.to_string(),
                ..CategoryStat::default()
            },
        );
    }
    let c = src.by_category.get_mut(category).expect("just inserted");
    c.resists += 1;
    lane(&mut c.by_skill, spell).resists += 1;
}

fn lane<'a>(map: &'a mut JsMap<SkillStat>, name: &str) -> &'a mut SkillStat {
    if !map.contains_key(name) {
        map.insert(name.to_string(), new_skill(name));
    }
    map.get_mut(name).expect("just inserted")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(skill: &str, amount: i64, crit: bool) -> DamageEvent {
        DamageEvent {
            ts: 0,
            attacker: "You".into(),
            target: "a bat".into(),
            amount,
            dtype: "melee".into(),
            dclass: None,
            skill: skill.into(),
            crit,
            category: "melee".into(),
            modifiers: Vec::new(),
            verb: None,
        }
    }

    fn you() -> SourceRef {
        SourceRef {
            id: "you".into(),
            name: "You".into(),
            kind: SourceKind::You,
        }
    }

    /// The per-lane MINIMUM uses 0 as "nothing landed yet", so a lane that only whiffed keeps 0 and
    /// never reports a fabricated minimum.
    #[test]
    fn the_lane_minimum_treats_zero_as_no_landed_hit_yet() {
        let mut a = Agg::new();
        a.add_out(&you(), &hit("Melee", 30, false), false);
        a.add_out(&you(), &hit("Melee", 12, false), false);
        let s = a.out.get("you").expect("row");
        assert_eq!(s.by_skill.get("Melee").expect("lane").min, 12);
        assert_eq!(s.by_skill.get("Melee").expect("lane").max, 30);
    }

    /// A MISS CREATES A ROW, which is exactly why the drop rule reads map SIZE and not a total: an
    /// encounter of nothing but whiffs has a real hit-rate and must not be discarded.
    #[test]
    fn an_encounter_of_pure_misses_is_not_empty() {
        let mut a = Agg::new();
        assert!(a.is_empty());
        a.add_out_miss(
            &you(),
            &MissFold {
                mtype: MissType::Dodge,
                skill: "Melee".into(),
                verb: None,
                lane_skill: None,
                modifiers: Vec::new(),
                target: "a bat".into(),
                ts: 0,
            },
        );
        assert!(!a.is_empty());
        assert_eq!(Agg::sum(&a.out), 0);
        let s = a.out.get("you").expect("row");
        assert_eq!(s.misses, 1);
        assert_eq!(s.miss[MissType::Dodge as usize], 1);
    }

    /// A RESIST MOVES NO DAMAGE TOTAL — the tripwire — and still opens the lane it was resisted on.
    #[test]
    fn a_resist_opens_a_lane_and_moves_no_total() {
        let mut a = Agg::new();
        a.add_out(&you(), &hit("Melee", 30, false), false);
        a.add_out_resist(&you(), "Cajoling Whispers", "spell");
        let s = a.out.get("you").expect("row");
        assert_eq!(s.total, 30);
        assert_eq!(s.resists, 1);
        assert_eq!(s.by_skill.get("Cajoling Whispers").expect("lane").hits, 0);
        assert_eq!(
            s.by_skill.get("Cajoling Whispers").expect("lane").resists,
            1
        );
    }

    /// The ONE legal kind transition is `Other` → `Member`, and it is one-way.
    #[test]
    fn a_recorded_row_upgrades_to_member_and_never_back() {
        let mut a = Agg::new();
        let other = SourceRef {
            id: "member:dranix".into(),
            name: "Dranix".into(),
            kind: SourceKind::Other,
        };
        let member = SourceRef {
            kind: SourceKind::Member,
            ..other.clone()
        };
        a.add_out(&other, &hit("Melee", 10, false), false);
        assert_eq!(
            a.out.get("member:dranix").expect("row").kind,
            SourceKind::Other
        );
        a.add_out(&member, &hit("Melee", 10, false), false);
        assert_eq!(
            a.out.get("member:dranix").expect("row").kind,
            SourceKind::Member
        );
        a.add_out(&other, &hit("Melee", 10, false), false);
        assert_eq!(
            a.out.get("member:dranix").expect("row").kind,
            SourceKind::Member
        );
        // …and the whole time it is ONE row, one id, one total.
        assert_eq!(a.out.len(), 1);
        assert_eq!(Agg::sum(&a.out), 30);
    }

    /// `inc_heal` is the one named-total map that COUNTS as well as sums.
    #[test]
    fn only_the_incoming_heal_ledger_counts_its_lines() {
        let mut a = Agg::new();
        a.add_inc_heal("dranix", "Dranix", 100);
        a.add_inc_heal("dranix", "Dranix", 50);
        a.add_enemy_heal("a bat#1", "a bat", 20);
        assert_eq!(a.inc_heal.get("dranix").expect("row").count, 2);
        assert_eq!(a.inc_heal.get("dranix").expect("row").amount, 150);
        assert_eq!(a.enemy_heal.get("a bat#1").expect("row").count, 0);
        assert_eq!(Agg::sum_heal(&a.enemy_heal), 20);
    }
}
