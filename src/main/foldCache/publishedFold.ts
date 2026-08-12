// ============================================================================
// publishedFold.ts — WHAT "THE ENGINE'S PUBLISHED SNAPSHOT" MEANS, in one place (JOS-208 phase 4).
// ============================================================================
//
// Every registry module has exactly one published payload — `registry.snapshot(id)` — so there was
// never a question to answer about them. The `CombatEngine` has a payload with OPTIONS: `snapshot`
// takes a `SnapshotOpts` and the renderer asks for different shapes at different moments (the
// meter polls without a timeline; the dashboard's drill asks for one).
//
// The three rungs of the proof stack all have to compare THE SAME shape, or they are three
// different claims: the differential matrix, the golden fingerprints and the fleet's shadow
// verifier. So the shape is named here and imported by all of them.
//
// WHY `timeline: true` RATHER THAN THE BARE DEFAULT. The timeline is the only published field that
// reads an encounter's per-event RING (`Encounter.events`, capped at TIMELINE_CAP, dropped at
// finalize past TIMELINE_HISTORY_CAP) and its `eventsTotal` truncation counter. Compare only the
// default payload and a checkpoint could lose every ring in the file without a single test going
// red — the aggregates would still add up and the head row would still name the right mob, and the
// user would open a fight from before the restore to find its timeline empty. Asking for the
// timeline costs one downsample of one encounter per comparison and covers the whole ring path.
//
// It is a SUPERSET of the default: same `selectedId` resolution, same segments, same roster, plus
// `timeline`. Nothing the meter reads is left out by asking for more.

import type { CombatEngine } from '../combat/engine'
import type { CombatSnapshot, SnapshotOpts } from '../../shared/combat'

/** The options every arm of the proof stack asks the engine with. */
export const COMBAT_COMPARE_OPTS: SnapshotOpts = { timeline: true }

/**
 * The engine's published payload at `nowMs`.
 *
 * `nowMs` is not decoration and not a formality: `snapshot` sweeps uncorroborated charm binds and
 * evaluates deferred encounter closure before it serializes anything, so two folds asked at two
 * different instants can legitimately differ by a fight that closed in between. Every caller pins
 * ONE instant across both arms — which is the go-live sweep with the clock held still, exactly as
 * `registry.tick` is pinned beside it.
 */
export function combatPublished(engine: CombatEngine, nowMs: number): CombatSnapshot {
  return engine.snapshot(nowMs, COMBAT_COMPARE_OPTS)
}
