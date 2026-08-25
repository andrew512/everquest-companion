//! The ported modules. One file per `src/main/modules/*.ts`, named after it, and each carrying its
//! TS twin's header argument rather than a pointer to it — a reader of this crate has to be able
//! to tell whether a quirk is deliberate without opening the other tree.
//!
//! CLUSTER 2a (JOS-471) is the NINE simple appenders; CLUSTER 2b (JOS-475) is the five STATEFUL
//! ones; CLUSTER 2c (JOS-476) is the hard five plus the feed. That is all twenty of
//! `WIRING_ORDER` — and what a build has not registered is still reported as SKIPPED, by name, on
//! every parity run, because the report is about what was COMPARED and never about what exists.
//!
//! `combo` is the one entry with a DIRECTORY beside it, and that is its TS twin's factoring rather
//! than a new one: `combo.ts` is a shell over four pure siblings (`comboEvidence`, `comboScore`,
//! `comboLevels`, `comboIntervals`), and the file this crate names `combo.rs` is the same shell
//! over the same four. `resist` is the second, for the same reason. One EqModule per file still
//! holds — there is exactly one `EqModule` impl in each subtree.
//!
//! The `buff*` files are a THIRD shape and deliberately not a directory: `buffs.ts` has ten
//! collaborators beside it in the same folder over there, so this crate keeps the same flat layout
//! and the two trees read alike. `buffs.rs` holds one `EqModule` and `buff_timers.rs` the other;
//! the two SHARE their cast anchors and their learner, which is the whole of JOS-140.

pub mod alerts;
pub mod buff_anchors;
pub mod buff_landing;
pub mod buff_rounds;
pub mod buff_timers;
pub mod buffs;
pub mod buffs_entities;
pub mod buffs_instance_rules;
pub mod buffs_instances;
pub mod buffs_mining;
pub mod buffs_session;
pub mod buffs_shapes;
pub mod buffs_stats;
pub mod buffs_view;
pub mod character;
pub mod class_unlocks;
pub mod combo;
pub mod consider;
pub mod event_feed;
pub mod item_tiers;
pub mod kills;
pub mod leveling;
pub mod loot;
pub mod observed_spell_ranks;
pub mod output_files;
pub mod progression;
pub mod resist;
pub mod respawn;
pub mod roster;
pub mod spell_sets;
pub mod turnins;
