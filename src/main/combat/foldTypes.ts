// ============================================================================
// foldTypes.ts — THE COMBAT ENGINE'S FOLD STATE, AS PLAIN DATA (JOS-208 phase 4).
// ============================================================================
//
// The engine is the twentieth unit to join the FoldUnit seam, and it is the only one whose live
// state is a graph of CLASSES holding MAPS and SETS: `EngineState` owns a `WorldModel`, a
// `CharmModel`, a `StateTimeline`, `SpecialAttacks`, `RecentCasts`, an uncapped `history` of
// `Encounter`s, and every one of those carries an `Agg` whose accumulators are themselves classes
// (`HealAccum`, `ProcAccum`, `WindowAccum`, `RoundAccum`).
//
// This file is the SHAPE THAT CROSSES THE DISK: one plain interface per live class, with every
// Map rendered as an array of `[key, value]` tuples and every Set as an array. Nothing here is a
// class, a Map, a Set or a Date, which is what the grammar in `foldCache/schema.ts` can express and
// what a structured clone can mean without knowing which class was in scope when it was written.
//
// WHY TUPLE ARRAYS AND NOT `record`, everywhere, without exception. The grammar offers `record` for
// arbitrary-keyed plain objects, and the law beside it says a record's key order is an accident of
// the engine and must never carry meaning. In this fold it very often does:
//
//   * `WorldModel.byName` is spawn order per name, and `petInstances()` reports pets in the order
//     their names were first seen — which is the order the UI lists your pets in.
//   * `WindowAccum.windows` evicts `keys().next()` at `WINDOW_CAP`: the oldest INSERTED minute.
//   * `Agg.out` / `Agg.inc` / `HealAccum.friendly` feed `rankRows`, whose comparator breaks ties on
//     (total, count, name) and then falls back to `Array.sort`'s stability — i.e. to insertion order.
//
// Rather than audit each map for whether its order is load-bearing TODAY and re-audit it after every
// future edit, every map in the engine is a tuple array. The cost is a few bytes of framing; the
// property bought is that a restored engine iterates in exactly the order the cold fold did.
//
// WHAT IS DELIBERATELY ABSENT — each exclusion is stated at its field in `foldSchema.ts` and
// enforced by the schema refusing any field it does not name:
//
//   * the two ROSTER PULLS and the bench's fold PROBE — injected collaborators, re-installed by the
//     composition root on every launch (the store-derived rule);
//   * `recording` / `hydrating` / `recent` — the LIVE-MODE flags and the classification ring they
//     gate. They describe this PROCESS's phase, not the log, and a checkpoint is always written
//     from a live app (`recording: true`) while it is always read into one that is about to replay
//     a tail (`recording: false`). Restoring them would put the engine in live mode during the tail
//     replay and hand the user the previous session's 300 classified lines in a panel a cold start
//     shows empty. Excluded, so a restored engine begins exactly where a cold one does and
//     `setLive()` flips both at the same instant in both arms;
//   * the MEMOIZED SUMMARIES (`Encounter.summary`, `ZoneSession.summary`) — derived, and recomputed
//     on the way in by the very functions that produced them (`encSummary(e, 'fight', 0)`,
//     `zoneSessionSummary`). Storing a derivation would be a second truth for one fact, and
//     recomputing is also what guarantees the restored object has the same present-but-undefined
//     `zone` key the cold one has.

import type { CoatSlot, DamageCategory, MissBreakdown, SourceKind } from '../../shared/combat'
import type { EdgeEvidence, StateKind } from '../../shared/procAnalytics'
import type { PetKind } from './entityRules'

/** `[key, value]` — how every Map in this fold is written down. */
export type Entry<K, V> = [K, V]

// ------------------------------------------------------------------------------ the world model

export interface InstanceFold {
  instanceId: string
  nameKey: string
  display: string
  charmed: boolean
  petKind?: PetKind
  firstSeenTs: number
  lastSeenTs: number
  retired: boolean
  gen: number
}

/**
 * THE WORLD MODEL, WRITTEN ONCE (the JOS-140 rule the fold laws restate: one object, one copy).
 *
 * The live model holds the SAME `Instance` objects in three indexes — `byName` (every spawn),
 * `activeByName` (the unretired ones) and `byId`. Only `byName` is stored; the other two are
 * rebuilt from it on the way in, which is both smaller and impossible to drift: `activeByName` IS
 * `byName` filtered by `!retired` with order preserved (retirement splices, it never reorders), and
 * the two maps take a key in the same statement of `spawn()`, so their key order is identical.
 */
export interface WorldFold {
  byName: Entry<string, InstanceFold[]>[]
  gens: Entry<string, number>[]
  petTankedBy: Entry<string, string[]>[]
}

// ------------------------------------------------------------------------------ the charm model

export interface CharmArmFold {
  kind: 'charm' | 'cc' | 'petBuff'
  spellKey: string
  ts: number
  until: number
}

export interface CharmFold {
  /** The single pending own cast; absent when nothing is armed. */
  arm?: CharmArmFold
  provisional: Entry<string, { until: number; display: string }>[]
  confirmed: string[]
  observed: Entry<string, number>[]
  seenCharmed: string[]
}

// ------------------------------------------------------------------------- the state timeline

/**
 * ONE SPAN. The live class also keeps two DERIVED indexes — `open` (group → the one open span) and
 * `active` (`<kind>:<key>` of every open span) — and neither is stored: a span is open exactly when
 * its `endEvidence` is `'open'`, which is what `finish()` overwrites, so both rebuild exactly.
 */
export interface SpanFold {
  kind: StateKind
  key: string
  name: string
  startTs: number
  endTs?: number
  startEvidence: EdgeEvidence
  endEvidence: EdgeEvidence
  group: string
}

export interface StateTimelineFold {
  spans: SpanFold[]
}

// --------------------------------------------------------------------------- the own-cast ledger

export interface CastRecordFold {
  ts: number
  claimTs?: number
}

export interface RecentCastsFold {
  casts: Entry<string, CastRecordFold>[]
  /** The record `forget()` most recently dropped, held for a `resume()`. */
  suspended?: { key: string; rec: CastRecordFold }
}

// ------------------------------------------------------------------------------- the aggregates

export interface SkillStatFold {
  name: string
  total: number
  hits: number
  crits: number
  max: number
  min: number
  misses: number
  resists: number
  lands: number
}

export interface CategoryStatFold {
  category: DamageCategory
  total: number
  hits: number
  crits: number
  max: number
  resists: number
  bySkill: Entry<string, SkillStatFold>[]
}

export interface RoundLaneTallyFold {
  verb: string
  skill: string
  buckets: number[]
  rounds: number
  multiRounds: number
  fannedRounds: number
}

export interface PendingLaneFold {
  verb: string
  skill: string
  seq: number[]
}

export interface RoundAccumFold {
  lanes: Entry<string, RoundLaneTallyFold>[]
  /** The second currently open, or -1 when nothing is pending. */
  openSecond: number
  pending: Entry<string, PendingLaneFold>[]
  excluded: { frenzy: number; riposte: number; flurry: number; rampage: number }
}

export interface SourceStatFold {
  name: string
  kind: SourceKind
  total: number
  hits: number
  crits: number
  ambiguousHits: number
  ambiguousTotal: number
  misses: number
  miss: MissBreakdown
  resists: number
  bySkill: Entry<string, SkillStatFold>[]
  byCategory: Entry<DamageCategory, CategoryStatFold>[]
  /** `RoundsAccum.bucket`: skillLower → (whole second → hits in it). */
  rounds: Entry<string, Entry<number, number>[]>[]
  mods: Entry<string, { name: string; count: number; avoided: number }>[]
  roundAcc: RoundAccumFold
}

export interface HealSpellStatFold {
  name: string
  total: number
  count: number
  crits: number
  max: number
  min?: number
  overheal: number
  fullOverheal: number
}

export interface HealSourceStatFold extends HealSpellStatFold {
  kind: 'you' | 'pet' | 'other' | 'enemy'
  bySpell: Entry<string, HealSpellStatFold>[]
}

export interface MitAccumFold {
  runeTotal: number
  runeCount: number
  runeMax: number
  runeMin?: number
  absorbedSwings: number
  absorbedDamageShields: number
}

export interface HealAccumFold {
  friendly: Entry<string, HealSourceStatFold>[]
  hostile: Entry<string, HealSourceStatFold>[]
  mit: MitAccumFold
  unstated: Entry<string, number>[]
}

export interface LaneSidesFold {
  damage: number
  heal: number
}

export interface SpellProcLaneFold {
  name: string
  hits: LaneSidesFold
  damage: number
  heal: number
  byState: Entry<string, LaneSidesFold>[]
}

export interface ProcAccumFold {
  strikes: Entry<string, { name: string; count: number; ambiguous: boolean }>[]
  slowLands: number
  firstSlowTs: number
  poisonDamage: Entry<string, { name: string; count: number; total: number }>[]
  dispels: Entry<string, { name: string; count: number }>[]
  coats: { poison: string; ts: number }[]
  stanceSwitches: number
  invocationSwitches: number
  swings: number
  swingsByState: Entry<string, number>[]
  activeMsByState: Entry<string, number>[]
  spellProcs: Entry<string, SpellProcLaneFold>[]
}

export interface ProcWindowFold {
  minute: number
  activeMs: number
  swings: number
  outDamage: number
  procDamage: number
  transitions: number
  transitionGroups: string[]
  stateKeys: string[]
}

export interface WindowAccumFold {
  windows: Entry<number, ProcWindowFold>[]
}

export interface AggFold {
  out: Entry<string, SourceStatFold>[]
  inc: Entry<string, SourceStatFold>[]
  targets: Entry<string, { name: string; amount: number }>[]
  enemyHeal: Entry<string, { name: string; amount: number }>[]
  incHeal: Entry<string, { name: string; amount: number; count: number }>[]
  heal: HealAccumFold
  procs: ProcAccumFold
  windows: WindowAccumFold
}

// ------------------------------------------------------------------- encounters + zone sessions

export interface TimelineRawFold {
  ts: number
  lane: string
  category: DamageCategory
  amount: number
  crit: boolean
  modifiers?: string[]
  kind: SourceKind
  outcome?: 'hit' | 'miss' | 'resist'
  detail?: string
  target?: string
}

export interface MarkerRawFold {
  ts: number
  kind: 'stance' | 'invocation' | 'coat' | 'slow'
  label: string
  detail?: string
}

export interface StanceRawFold {
  group: 'stance' | 'invocation'
  name: string
  start: number
  end?: number
}

export interface EncounterFold {
  id: string
  zone?: string
  startTs: number
  lastTs: number
  agg: AggFold
  engaged: string[]
  engagedSeen: Entry<string, number>[]
  activeMs: number
  prevDamageTs?: number
  ccActiveUntil: Entry<string, number>[]
  events: TimelineRawFold[]
  eventsTotal: number
  stanceSpans: StanceRawFold[]
  markers: MarkerRawFold[]
  coatAtEngage?: CoatSlot
  combatAtEngage: CoatSlot[]
  lastOutTarget?: string
}

export interface ZoneSessionFold {
  id: string
  zone: string
  agg: AggFold
  startTs: number
  lastTs: number
  finalizedMs: number
  activeMs: number
}

// ------------------------------------------------------------------------------- the whole state

export interface EngineStateFold {
  petNames: string[]
  world: WorldFold
  charm: CharmFold
  knownPlayers: string[]
  everPet: string[]
  everStruck: string[]
  playerKey?: string
  playerKeyInjected: boolean
  zone?: string
  seq: number
  /** The in-progress encounter; absent when no fight is open (`current === null`). */
  current?: EncounterFold
  history: EncounterFold[]
  zoneAgg: AggFold
  zoneFinalizedMs: number
  zoneActiveMs: number
  zoneStartTs: number
  zoneLastTs: number
  zoneHistory: ZoneSessionFold[]
  zoneSeq: number
  lastActivityTs: number
  stance?: { name: string; ts: number }
  invocation?: { name: string; ts: number }
  coatUtility?: CoatSlot
  coatCombat: CoatSlot[]
  /**
   * `null` is a VALUE here, not an absence: a qualifying pull that never landed a slow (law 5 —
   * counted as a miss, never averaged in as a zero). It is the grammar's `nullable`, and it is
   * inside an ARRAY, which is the one place `optional` cannot say anything at all.
   */
  slowSamples: (number | null)[]
  stateTimeline: StateTimelineFold
  recentCasts: RecentCastsFold
  quickBuffTs: number
  /** `SpecialAttacks.active`: verb lane → the special the log last said was live there. */
  specials: Entry<string, string>[]
}
