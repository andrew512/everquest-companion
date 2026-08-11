// ============================================================================
// foldAgg.ts — THE AGGREGATE'S HALF OF THE COMBAT CHECKPOINT (JOS-208 phase 4).
// ============================================================================
//
// One `Agg` is the biggest thing this fold builds, and there is one per open encounter, per
// finalized fight in an UNCAPPED history, per live zone and per finalized zone session. So this
// file is where the container's size actually comes from, and it is split out from `foldCodec.ts`
// for exactly that reason: the encounter/engine level reads as the state machine it is, and the
// accumulator level reads as the pile of counters it is.
//
// THE RULE THROUGHOUT: copy, symmetrically, field by field, in both directions. Never `{...src}`
// over a live accumulator (it would carry a Map straight into a blob), and never a helper that
// invents a default (a restored `min: 0` and an absent one are different published payloads, and
// `tests/foldPlainData.test.mts` re-serializes a fresh unit and compares, so an asymmetry dies
// there rather than in the fleet).

import {
  newCategory,
  newSource,
  Agg,
  ProcAccum,
  type CategoryStat,
  type ModifierTally,
  type RoundsAccum,
  type SkillStat,
  type SourceStat
} from './aggregate'
import { HealAccum, type HealSourceStat, type HealSpellStat, type MitAccum } from './healing'
import { RoundAccum } from './rounds'
import { WindowAccum, type ProcWindow } from './procWindows'
import type { LaneSides, SpellProcLane } from './procDetect'
import type {
  AggFold,
  CategoryStatFold,
  Entry,
  HealAccumFold,
  HealSourceStatFold,
  HealSpellStatFold,
  ProcAccumFold,
  ProcWindowFold,
  SourceStatFold,
  SpellProcLaneFold,
  WindowAccumFold
} from './foldTypes'
import type { DamageCategory } from '../../shared/combat'

/** A Map, as the tuple array this fold stores — order preserved, which is the whole point. */
function entries<K, V, W>(map: Map<K, V>, project: (v: V) => W): Entry<K, W>[] {
  const out: Entry<K, W>[] = []
  for (const [key, value] of map) out.push([key, project(value)])
  return out
}

/** …and back into a Map, in the stored order. */
function toMap<K, V, W>(list: readonly Entry<K, V>[], build: (v: V) => W): Map<K, W> {
  const map = new Map<K, W>()
  for (const [key, value] of list) map.set(key, build(value))
  return map
}

// ------------------------------------------------------------------------------- damage counters

const skillOut = (s: SkillStat): SkillStat => ({ ...s })

function categoryOut(c: CategoryStat): CategoryStatFold {
  return {
    category: c.category,
    total: c.total,
    hits: c.hits,
    crits: c.crits,
    max: c.max,
    resists: c.resists,
    bySkill: entries(c.bySkill, skillOut)
  }
}

function categoryIn(f: CategoryStatFold): CategoryStat {
  const c = newCategory(f.category)
  c.total = f.total
  c.hits = f.hits
  c.crits = f.crits
  c.max = f.max
  c.resists = f.resists
  c.bySkill = toMap(f.bySkill, skillOut)
  return c
}

/** `RoundsAccum.bucket` — skillLower → (whole second → hits in it). Two nested maps, two arrays. */
function roundsOut(r: RoundsAccum): Entry<string, Entry<number, number>[]>[] {
  return entries(r.bucket, (seconds) => entries(seconds, (n) => n))
}

function roundsIn(f: readonly Entry<string, Entry<number, number>[]>[]): RoundsAccum {
  return { bucket: toMap(f, (seconds) => toMap(seconds, (n) => n)) }
}

export function sourceOut(s: SourceStat): SourceStatFold {
  return {
    name: s.name,
    kind: s.kind,
    total: s.total,
    hits: s.hits,
    crits: s.crits,
    ambiguousHits: s.ambiguousHits,
    ambiguousTotal: s.ambiguousTotal,
    misses: s.misses,
    miss: { ...s.miss },
    resists: s.resists,
    bySkill: entries(s.bySkill, skillOut),
    byCategory: entries(s.byCategory, categoryOut),
    rounds: roundsOut(s.rounds),
    mods: entries(s.mods, (m: ModifierTally) => ({ ...m })),
    roundAcc: s.roundAcc.foldState()
  }
}

export function sourceIn(f: SourceStatFold): SourceStat {
  const s = newSource(f.name, f.kind)
  s.total = f.total
  s.hits = f.hits
  s.crits = f.crits
  s.ambiguousHits = f.ambiguousHits
  s.ambiguousTotal = f.ambiguousTotal
  s.misses = f.misses
  s.miss = { ...f.miss }
  s.resists = f.resists
  s.bySkill = toMap(f.bySkill, skillOut)
  s.byCategory = toMap<DamageCategory, CategoryStatFold, CategoryStat>(f.byCategory, categoryIn)
  s.rounds = roundsIn(f.rounds)
  s.mods = toMap(f.mods, (m) => ({ ...m }))
  const acc = new RoundAccum()
  acc.restoreFoldState(f.roundAcc)
  s.roundAcc = acc
  return s
}

// ------------------------------------------------------------------------------ healing counters

function healSpellOut(s: HealSpellStat): HealSpellStatFold {
  return {
    name: s.name,
    total: s.total,
    count: s.count,
    crits: s.crits,
    max: s.max,
    ...(s.min === undefined ? {} : { min: s.min }),
    overheal: s.overheal,
    fullOverheal: s.fullOverheal
  }
}

const healSpellIn = (f: HealSpellStatFold): HealSpellStat => healSpellOut(f)

function healSourceOut(s: HealSourceStat): HealSourceStatFold {
  return { ...healSpellOut(s), kind: s.kind, bySpell: entries(s.bySpell, healSpellOut) }
}

function healSourceIn(f: HealSourceStatFold): HealSourceStat {
  return { ...healSpellIn(f), kind: f.kind, bySpell: toMap(f.bySpell, healSpellIn) }
}

function mitOut(m: MitAccum): HealAccumFold['mit'] {
  return {
    runeTotal: m.runeTotal,
    runeCount: m.runeCount,
    runeMax: m.runeMax,
    ...(m.runeMin === undefined ? {} : { runeMin: m.runeMin }),
    absorbedSwings: m.absorbedSwings,
    absorbedDamageShields: m.absorbedDamageShields
  }
}

function healOut(h: HealAccum): HealAccumFold {
  return {
    friendly: entries(h.friendly, healSourceOut),
    hostile: entries(h.hostile, healSourceOut),
    mit: mitOut(h.mit),
    unstated: entries(h.unstated, (n) => n)
  }
}

function healIn(f: HealAccumFold): HealAccum {
  const h = new HealAccum()
  h.friendly = toMap(f.friendly, healSourceIn)
  h.hostile = toMap(f.hostile, healSourceIn)
  h.mit = mitOut(f.mit)
  h.unstated = toMap(f.unstated, (n) => n)
  return h
}

// ----------------------------------------------------------------------- proc + window ledgers

const sides = (s: LaneSides): LaneSides => ({ damage: s.damage, heal: s.heal })

function spellProcOut(l: SpellProcLane): SpellProcLaneFold {
  return {
    name: l.name,
    hits: sides(l.hits),
    damage: l.damage,
    heal: l.heal,
    byState: entries(l.byState, sides)
  }
}

function spellProcIn(f: SpellProcLaneFold): SpellProcLane {
  return {
    name: f.name,
    hits: sides(f.hits),
    damage: f.damage,
    heal: f.heal,
    byState: toMap(f.byState, sides)
  }
}

function procsOut(p: ProcAccum): ProcAccumFold {
  return {
    strikes: entries(p.strikes, (s) => ({ ...s })),
    slowLands: p.slowLands,
    firstSlowTs: p.firstSlowTs,
    poisonDamage: entries(p.poisonDamage, (s) => ({ ...s })),
    dispels: entries(p.dispels, (s) => ({ ...s })),
    coats: p.coats.map((c) => ({ ...c })),
    stanceSwitches: p.stanceSwitches,
    invocationSwitches: p.invocationSwitches,
    swings: p.swings,
    swingsByState: entries(p.swingsByState, (n) => n),
    activeMsByState: entries(p.activeMsByState, (n) => n),
    spellProcs: entries(p.spellProcs, spellProcOut)
  }
}

function procsIn(f: ProcAccumFold): ProcAccum {
  const p = new ProcAccum()
  p.strikes = toMap(f.strikes, (s) => ({ ...s }))
  p.slowLands = f.slowLands
  p.firstSlowTs = f.firstSlowTs
  p.poisonDamage = toMap(f.poisonDamage, (s) => ({ ...s }))
  p.dispels = toMap(f.dispels, (s) => ({ ...s }))
  p.coats = f.coats.map((c) => ({ ...c }))
  p.stanceSwitches = f.stanceSwitches
  p.invocationSwitches = f.invocationSwitches
  p.swings = f.swings
  p.swingsByState = toMap(f.swingsByState, (n) => n)
  p.activeMsByState = toMap(f.activeMsByState, (n) => n)
  p.spellProcs = toMap(f.spellProcs, spellProcIn)
  return p
}

function windowOut(w: ProcWindow): ProcWindowFold {
  return {
    minute: w.minute,
    activeMs: w.activeMs,
    swings: w.swings,
    outDamage: w.outDamage,
    procDamage: w.procDamage,
    transitions: w.transitions,
    transitionGroups: [...w.transitionGroups],
    stateKeys: [...w.stateKeys]
  }
}

function windowIn(f: ProcWindowFold): ProcWindow {
  return {
    minute: f.minute,
    activeMs: f.activeMs,
    swings: f.swings,
    outDamage: f.outDamage,
    procDamage: f.procDamage,
    transitions: f.transitions,
    transitionGroups: new Set(f.transitionGroups),
    stateKeys: new Set(f.stateKeys)
  }
}

function windowsOut(w: WindowAccum): WindowAccumFold {
  return { windows: entries(w.windows, windowOut) }
}

function windowsIn(f: WindowAccumFold): WindowAccum {
  const w = new WindowAccum()
  w.windows = toMap(f.windows, windowIn)
  return w
}

// -------------------------------------------------------------------------------- the aggregate

export function aggOut(a: Agg): AggFold {
  return {
    out: entries(a.out, sourceOut),
    inc: entries(a.inc, sourceOut),
    targets: entries(a.targets, (t) => ({ ...t })),
    enemyHeal: entries(a.enemyHeal, (t) => ({ ...t })),
    incHeal: entries(a.incHeal, (t) => ({ ...t })),
    heal: healOut(a.heal),
    procs: procsOut(a.procs),
    windows: windowsOut(a.windows)
  }
}

export function aggIn(f: AggFold): Agg {
  const a = new Agg()
  a.out = toMap(f.out, sourceIn)
  a.inc = toMap(f.inc, sourceIn)
  a.targets = toMap(f.targets, (t) => ({ ...t }))
  a.enemyHeal = toMap(f.enemyHeal, (t) => ({ ...t }))
  a.incHeal = toMap(f.incHeal, (t) => ({ ...t }))
  a.heal = healIn(f.heal)
  a.procs = procsIn(f.procs)
  a.windows = windowsIn(f.windows)
  return a
}
