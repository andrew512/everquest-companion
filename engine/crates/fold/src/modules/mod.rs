//! The ported modules. One file per `src/main/modules/*.ts`, named after it, and each carrying its
//! TS twin's header argument rather than a pointer to it — a reader of this crate has to be able
//! to tell whether a quirk is deliberate without opening the other tree.
//!
//! CLUSTER 2a (JOS-471) is the NINE simple appenders; CLUSTER 2b (JOS-475) is the five STATEFUL
//! ones. The rest of `WIRING_ORDER` is 2c/2d and is reported as SKIPPED, by name, until it lands —
//! see `../README.md`.
//!
//! `combo` is the one entry with a DIRECTORY beside it, and that is its TS twin's factoring rather
//! than a new one: `combo.ts` is a shell over four pure siblings (`comboEvidence`, `comboScore`,
//! `comboLevels`, `comboIntervals`), and the file this crate names `combo.rs` is the same shell
//! over the same four. One EqModule per file still holds — there is exactly one `EqModule` impl in
//! that subtree.

pub mod character;
pub mod class_unlocks;
pub mod combo;
pub mod item_tiers;
pub mod kills;
pub mod leveling;
pub mod loot;
pub mod observed_spell_ranks;
pub mod output_files;
pub mod progression;
pub mod respawn;
pub mod roster;
pub mod spell_sets;
pub mod turnins;
