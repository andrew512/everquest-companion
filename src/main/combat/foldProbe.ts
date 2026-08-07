// ============================================================================
// foldProbe.ts — the combat engine's OWN attribution seam (JOS-59).
// ============================================================================
//
// JOS-55 gave the startup fold a per-CONSUMER table and JOS-58 spent its first finding; what
// that left on top was one opaque row — `combat engine 2.86 us/event, 37.4% of the fold`. This
// is the seam that opens it, and it is deliberately built the same way
// `ModuleRegistry.attach(bus, timer)` is:
//
//   A PARAMETER, NOT AN ENVIRONMENT VARIABLE. `CombatEngine.attachFoldProbe(probe)` is called by
//   `tests/bench/foldArm.mts` and by nothing else in the tree. A knob that installs a per-event
//   profiler on a real user's startup is a knob a support answer will eventually recommend
//   (replaySlicer.ts's argument, and the registry's); a seam in a signature is visible to the
//   bench and to nobody else.
//
//   ZERO COST OFF. Every call site is `const p = st.probe; if (p) …` — one monomorphic field
//   read and one branch on a path that is already doing map lookups and string work. There is no
//   timer, no clock read and no allocation on a normal boot. Whether even that branch is
//   measurable is not an argument to have: `attribution.mts` brackets the timed fold with two
//   UNTIMED ones and prints the difference, and this seam rides inside that same bracket.
//
// WHY enter/leave AND A STACK, rather than the registry's flat `note(index, ms)`. The engine's
// work NESTS — `route()` resolves a world instance, then folds an aggregate, then pushes a ring
// entry, and `foldDamageAnalytics` re-enters `classify` underneath all of it. A flat "charge
// everything since the last mark" scheme would attribute a callee's time to its caller or the
// reverse depending on where the marks happened to fall. The probe implementation keeps a stack
// and charges EXCLUSIVE time to whichever section is innermost, so the rows are disjoint and sum
// to the engine's own row in the JOS-55 table.
//
// WHAT THE SECTIONS MEAN, and what is deliberately NOT one:
//   dispatch   the ingest switch itself and everything no section below claims — including the
//              charm/CC ownership model, the special-attack lanes and the state timeline, which
//              are cheap enough (they never showed above the noise) that giving each a row would
//              invite reading a 0.3% number as a finding.
//   classify   the attribution verdict (routing.ts `classify`), wherever it is asked.
//   world      the entity-instance model (world.ts) — resolve/label/presence/retirement.
//   aggregate  Agg accumulation: the damage/miss/resist/heal counters and the two round models.
//   rings      the per-encounter timeline + marker rings and the classification ring.
//   lifecycle  closure evaluation, encounter opening, finalization.
//   analytics  the proc / minute-window ledgers folded beside the meter (ingest.ts's fold*).

/** The section names, in table order. Index = the section id passed to `enter`. */
export const ENGINE_SECTIONS = [
  'dispatch',
  'classify',
  'world',
  'aggregate',
  'rings',
  'lifecycle',
  'analytics'
] as const

export type EngineSectionName = (typeof ENGINE_SECTIONS)[number]

export const SEC_DISPATCH = 0
export const SEC_CLASSIFY = 1
export const SEC_WORLD = 2
export const SEC_AGGREGATE = 3
export const SEC_RINGS = 4
export const SEC_LIFECYCLE = 5
export const SEC_ANALYTICS = 6

/**
 * The instrument. Implemented by the bench (`tests/bench/foldArm.mts`) and by nothing else.
 *
 * `enter`/`leave` must be balanced on every path — which is why every call site in the engine
 * brackets a single statement or a straight-line block, never a region with an early return in
 * the middle. The one exception is the top-level `ingestEvent`, whose whole body is a separate
 * function precisely so the bracket can be unconditional.
 */
export interface EngineFoldProbe {
  /** Charge from here to the matching `leave()` to `section` (exclusive of nested sections). */
  enter(section: number): void
  /** Close the innermost open section and resume charging its parent. */
  leave(): void
}
