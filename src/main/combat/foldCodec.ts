// ============================================================================
// foldCodec.ts — THE ENGINE STATE ⇄ PLAIN DATA (JOS-208 phase 4).
// ============================================================================
//
// `foldAgg.ts` carries the counters; this carries the state machine — encounters, zone sessions and
// the `EngineState` that owns them. Together they are the whole of what `CombatEngine.serializeFold`
// writes and `deserializeFold` adopts.
//
// TWO THINGS ARE RECOMPUTED RATHER THAN STORED, and both are memoized DERIVATIONS whose inputs are
// already in the blob:
//
//   * `Encounter.summary` — `encSummary(enc, 'fight', 0)`, which is literally the call
//     `finalizeCurrent` makes, with the same `0` (a finalized fight's `active` is always false, so
//     `now` is unread). Recomputing rather than storing means the restored object carries the same
//     PRESENT-BUT-UNDEFINED `zone` key the cold one does, which is exactly the class of difference
//     the phase-2 matrix caught in `consider` — a shape a human reading the code cannot see.
//   * `ZoneSession.summary` — the same argument, from the session's own frozen aggregate and
//     `finalizedMs`.
//
// Storing either would put a second truth for one fact in the container, which is the rule the
// fold laws state about the world model's three indexes and about the buffs/buffTimers shared
// halves. One truth per fact, and derive the rest.

import { sumMap } from './aggregate'
import { aggIn, aggOut } from './foldAgg'
import { encSummary } from './lifecycle'
import type { Encounter, ZoneSession } from './encounter'
import type { EngineState } from './state'
import type { EncounterFold, EngineStateFold, ZoneSessionFold } from './foldTypes'

// ------------------------------------------------------------------------------------ encounters

function encounterOut(e: Encounter): EncounterFold {
  return {
    id: e.id,
    ...(e.zone === undefined ? {} : { zone: e.zone }),
    startTs: e.startTs,
    lastTs: e.lastTs,
    agg: aggOut(e.agg),
    engaged: [...e.engaged],
    engagedSeen: [...e.engagedSeen],
    activeMs: e.activeMs,
    ...(e.prevDamageTs === undefined ? {} : { prevDamageTs: e.prevDamageTs }),
    ccActiveUntil: [...e.ccActiveUntil],
    events: e.events.map((r) => ({ ...r, ...(r.modifiers ? { modifiers: [...r.modifiers] } : {}) })),
    eventsTotal: e.eventsTotal,
    stanceSpans: e.stanceSpans.map((s) => ({ ...s })),
    markers: e.markers.map((m) => ({ ...m })),
    ...(e.coatAtEngage === undefined ? {} : { coatAtEngage: { ...e.coatAtEngage } }),
    combatAtEngage: e.combatAtEngage.map((c) => ({ ...c })),
    ...(e.lastOutTarget === undefined ? {} : { lastOutTarget: e.lastOutTarget })
  }
}

/**
 * Rebuild one encounter. `finalized` decides whether the memoized summary is recomputed: the OPEN
 * encounter has none (it is rebuilt on every snapshot, because it is still moving), and a history
 * entry always has one.
 */
function encounterIn(f: EncounterFold, finalized: boolean): Encounter {
  const e: Encounter = {
    id: f.id,
    ...(f.zone === undefined ? {} : { zone: f.zone }),
    startTs: f.startTs,
    lastTs: f.lastTs,
    agg: aggIn(f.agg),
    engaged: new Set(f.engaged),
    engagedSeen: new Map(f.engagedSeen),
    activeMs: f.activeMs,
    ...(f.prevDamageTs === undefined ? {} : { prevDamageTs: f.prevDamageTs }),
    ccActiveUntil: new Map(f.ccActiveUntil),
    events: f.events.map((r) => ({ ...r, ...(r.modifiers ? { modifiers: [...r.modifiers] } : {}) })),
    eventsTotal: f.eventsTotal,
    stanceSpans: f.stanceSpans.map((s) => ({ ...s })),
    markers: f.markers.map((m) => ({ ...m })),
    ...(f.coatAtEngage === undefined ? {} : { coatAtEngage: { ...f.coatAtEngage } }),
    combatAtEngage: f.combatAtEngage.map((c) => ({ ...c })),
    ...(f.lastOutTarget === undefined ? {} : { lastOutTarget: f.lastOutTarget })
  }
  if (finalized) e.summary = encSummary(e, 'fight', 0)
  return e
}

// --------------------------------------------------------------------------------- zone sessions

function zoneSessionOut(z: ZoneSession): ZoneSessionFold {
  return {
    id: z.id,
    zone: z.zone,
    agg: aggOut(z.agg),
    startTs: z.startTs,
    lastTs: z.lastTs,
    finalizedMs: z.finalizedMs,
    activeMs: z.activeMs
  }
}

function zoneSessionIn(f: ZoneSessionFold): ZoneSession {
  const agg = aggIn(f.agg)
  const total = sumMap(agg.out)
  // The same arithmetic `finalizeZoneSession` did at the freeze, over the same two numbers — both
  // of which are in the blob, so this cannot drift from what it is a memo of.
  const durSec = Math.max(1, f.finalizedMs / 1000)
  return {
    id: f.id,
    zone: f.zone,
    agg,
    startTs: f.startTs,
    lastTs: f.lastTs,
    finalizedMs: f.finalizedMs,
    activeMs: f.activeMs,
    summary: {
      id: f.id,
      zone: f.zone,
      startTs: f.startTs,
      endTs: f.lastTs,
      total,
      dps: total / durSec,
      live: false
    }
  }
}

// ------------------------------------------------------------------------------ the engine state

/** The engine's complete event-derived fold state, as plain data. */
export function engineStateOut(st: EngineState): EngineStateFold {
  return {
    petNames: [...st.petNames],
    world: st.world.foldState(),
    charm: st.charm.foldState(),
    knownPlayers: [...st.knownPlayers],
    everPet: [...st.everPet],
    everStruck: [...st.everStruck],
    ...(st.playerKey === undefined ? {} : { playerKey: st.playerKey }),
    playerKeyInjected: st.playerKeyInjected,
    ...(st.zone === undefined ? {} : { zone: st.zone }),
    seq: st.seq,
    ...(st.current === null ? {} : { current: encounterOut(st.current) }),
    history: st.history.map(encounterOut),
    zoneAgg: aggOut(st.zoneAgg),
    zoneFinalizedMs: st.zoneFinalizedMs,
    zoneActiveMs: st.zoneActiveMs,
    zoneStartTs: st.zoneStartTs,
    zoneLastTs: st.zoneLastTs,
    zoneHistory: st.zoneHistory.map(zoneSessionOut),
    zoneSeq: st.zoneSeq,
    lastActivityTs: st.lastActivityTs,
    ...(st.stance === undefined ? {} : { stance: { ...st.stance } }),
    ...(st.invocation === undefined ? {} : { invocation: { ...st.invocation } }),
    ...(st.coatUtility === undefined ? {} : { coatUtility: { ...st.coatUtility } }),
    coatCombat: st.coatCombat.map((c) => ({ ...c })),
    slowSamples: [...st.slowSamples],
    stateTimeline: st.stateTimeline.foldState(),
    recentCasts: st.recentCasts.foldState(),
    quickBuffTs: st.quickBuffTs,
    specials: st.specials.entries()
  }
}

/**
 * Adopt a previously folded state, IN PLACE.
 *
 * In place, and not by replacing the collaborators, because two of them are WIRED: `st.world` was
 * given its `onRetire` listener in `EngineState`'s constructor (JOS-176 — a retired instance may
 * not keep vetoing a fight's close), and `st.probe` / the two roster pulls are installed by the
 * composition root. A restore that swapped in fresh objects would silently drop all three.
 *
 * The caller has already validated `f` against `COMBAT_FOLD_SCHEMA` and has already `reset()` the
 * state, so every field this does not touch — `recording`, `hydrating`, `recent` — is at exactly
 * the value a cold start would have.
 */
export function engineStateIn(st: EngineState, f: EngineStateFold): void {
  for (const k of f.petNames) st.petNames.add(k)
  st.world.restoreFoldState(f.world)
  st.charm.restoreFoldState(f.charm)
  for (const k of f.knownPlayers) st.knownPlayers.add(k)
  for (const k of f.everPet) st.everPet.add(k)
  for (const k of f.everStruck) st.everStruck.add(k)
  st.playerKey = f.playerKey
  st.playerKeyInjected = f.playerKeyInjected
  st.zone = f.zone
  st.seq = f.seq
  st.current = f.current === undefined ? null : encounterIn(f.current, false)
  st.history = f.history.map((e) => encounterIn(e, true))
  st.zoneAgg = aggIn(f.zoneAgg)
  st.zoneFinalizedMs = f.zoneFinalizedMs
  st.zoneActiveMs = f.zoneActiveMs
  st.zoneStartTs = f.zoneStartTs
  st.zoneLastTs = f.zoneLastTs
  st.zoneHistory = f.zoneHistory.map(zoneSessionIn)
  st.zoneSeq = f.zoneSeq
  st.lastActivityTs = f.lastActivityTs
  st.stance = f.stance ? { ...f.stance } : undefined
  st.invocation = f.invocation ? { ...f.invocation } : undefined
  st.coatUtility = f.coatUtility ? { ...f.coatUtility } : undefined
  st.coatCombat = f.coatCombat.map((c) => ({ ...c }))
  st.slowSamples = [...f.slowSamples]
  st.stateTimeline.restoreFoldState(f.stateTimeline)
  st.recentCasts.restoreFoldState(f.recentCasts)
  st.quickBuffTs = f.quickBuffTs
  st.specials.restoreFoldState(f.specials)
}
