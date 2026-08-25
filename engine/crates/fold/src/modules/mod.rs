//! The ported modules. One file per `src/main/modules/*.ts`, named after it, and each carrying its
//! TS twin's header argument rather than a pointer to it — a reader of this crate has to be able
//! to tell whether a quirk is deliberate without opening the other tree.
//!
//! CLUSTER 2a (JOS-471) is the NINE simple appenders. The rest of `WIRING_ORDER` is 2b/2c/2d and is
//! reported as SKIPPED, by name, until it lands — see `../README.md`.

pub mod class_unlocks;
pub mod item_tiers;
pub mod kills;
pub mod leveling;
pub mod loot;
pub mod observed_spell_ranks;
pub mod output_files;
pub mod spell_sets;
pub mod turnins;
