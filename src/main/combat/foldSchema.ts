// ============================================================================
// foldSchema.ts — THE COMBAT ENGINE'S DECLARED SHAPE (JOS-208 phase 4).
// ============================================================================
//
// The ENCODING axis, for the twentieth unit. This is a DATA declaration of exactly what the engine
// stores (`foldTypes.ts` is the same statement as TypeScript types, for readers and the codec); the
// container's shape hash is derived from it, `validate()` runs it against the bytes a file handed
// us, and the same walk is the plain-data proof. One declaration, three jobs — see
// `foldCache/schema.ts`.
//
// EVERY CLOSED STRING SET IS AN `enum`, deliberately. A taxonomy category, a source kind, an edge
// evidence: each is a fixed union in `src/shared`, and declaring it as an enum means adding a
// member CHANGES THE SHAPE HASH and invalidates the fleet's caches — which is right, because a
// blob written by a build that knew four categories cannot be read by one that folds five. It also
// means a hand-edited container carrying `kind: "boss"` is refused at load rather than folded.
//
// THE FIELDS THAT ARE NOT HERE ARE THE POINT AS MUCH AS THE ONES THAT ARE. `validate` refuses any
// field the declaration does not name, so the exclusions in `foldTypes.ts`'s header — the injected
// roster pulls, the bench probe, the live-mode flags, the classification ring, the memoized
// summaries — cannot be re-added by accident: a serializer that started writing one would fail its
// own declaration on the very next `npm test`.

import { S, type FoldSchema } from '../foldCache/schema'

/** `[key, value]` — how every Map in this fold is declared. */
const entry = (key: FoldSchema, value: FoldSchema): FoldSchema => S.tuple(key, value)
const strEntry = (value: FoldSchema): FoldSchema => S.arr(entry(S.str, value))

const SOURCE_KIND = S.enum('you', 'pet', 'member', 'enemy')
const HEAL_SOURCE_KIND = S.enum('you', 'pet', 'other', 'enemy')
const DAMAGE_CATEGORY = S.enum('melee', 'slay', 'spell', 'dot', 'ds')
const STATE_KIND = S.enum('stance', 'invocation', 'coat', 'buff')
const EDGE_EVIDENCE = S.enum('observed', 'inferred', 'censored', 'open')
const MARKER_KIND = S.enum('stance', 'invocation', 'coat', 'slow')
const PET_KIND = S.enum('charmed', 'summoned')

/** `{ poison, sinceTs }` — a blade coat, as `shared/combat.ts` declares it. */
const COAT_SLOT = S.obj({ poison: S.str, sinceTs: S.num })

// ------------------------------------------------------------------------------ the world model

const INSTANCE = S.obj({
  instanceId: S.str,
  nameKey: S.str,
  display: S.str,
  charmed: S.bool,
  petKind: S.opt(PET_KIND),
  firstSeenTs: S.num,
  lastSeenTs: S.num,
  retired: S.bool,
  gen: S.num
})

const WORLD = S.obj({
  // Every spawn ever, per name key, oldest first. `activeByName` and `byId` are DERIVED from this
  // on the way in — see WorldFold's note on why storing them would be the same object three times.
  byName: strEntry(S.arr(INSTANCE)),
  gens: strEntry(S.num),
  petTankedBy: strEntry(S.arr(S.str))
})

// ------------------------------------------------------------------------------ the charm model

const CHARM = S.obj({
  arm: S.opt(
    S.obj({ kind: S.enum('charm', 'cc', 'petBuff'), spellKey: S.str, ts: S.num, until: S.num })
  ),
  provisional: strEntry(S.obj({ until: S.num, display: S.str })),
  confirmed: S.arr(S.str),
  observed: strEntry(S.num),
  seenCharmed: S.arr(S.str)
})

// --------------------------------------------------------------- state timeline + own-cast ledger

const STATE_TIMELINE = S.obj({
  spans: S.arr(
    S.obj({
      kind: STATE_KIND,
      key: S.str,
      name: S.str,
      startTs: S.num,
      endTs: S.opt(S.num),
      startEvidence: EDGE_EVIDENCE,
      endEvidence: EDGE_EVIDENCE,
      group: S.str
    })
  )
})

const CAST_RECORD = S.obj({ ts: S.num, claimTs: S.opt(S.num) })
const RECENT_CASTS = S.obj({
  casts: strEntry(CAST_RECORD),
  suspended: S.opt(S.obj({ key: S.str, rec: CAST_RECORD }))
})

// ------------------------------------------------------------------------------- the aggregates

const SKILL_STAT = S.obj({
  name: S.str,
  total: S.num,
  hits: S.num,
  crits: S.num,
  max: S.num,
  min: S.num,
  misses: S.num,
  resists: S.num,
  lands: S.num
})

const CATEGORY_STAT = S.obj({
  category: DAMAGE_CATEGORY,
  total: S.num,
  hits: S.num,
  crits: S.num,
  max: S.num,
  resists: S.num,
  bySkill: strEntry(SKILL_STAT)
})

const ROUND_ACCUM = S.obj({
  lanes: strEntry(
    S.obj({
      verb: S.str,
      skill: S.str,
      buckets: S.arr(S.num),
      rounds: S.num,
      multiRounds: S.num,
      fannedRounds: S.num
    })
  ),
  openSecond: S.num,
  pending: strEntry(S.obj({ verb: S.str, skill: S.str, seq: S.arr(S.num) })),
  excluded: S.obj({ frenzy: S.num, riposte: S.num, flurry: S.num, rampage: S.num })
})

const SOURCE_STAT = S.obj({
  name: S.str,
  kind: SOURCE_KIND,
  total: S.num,
  hits: S.num,
  crits: S.num,
  ambiguousHits: S.num,
  ambiguousTotal: S.num,
  misses: S.num,
  miss: S.obj({
    miss: S.num,
    dodge: S.num,
    parry: S.num,
    riposte: S.num,
    block: S.num,
    absorb: S.num
  }),
  resists: S.num,
  bySkill: strEntry(SKILL_STAT),
  byCategory: S.arr(entry(DAMAGE_CATEGORY, CATEGORY_STAT)),
  // skillLower → (whole second → hits). The inner map is a tuple array like every other, so the
  // second is a NUMBER key rather than a `record`'s stringified one.
  rounds: strEntry(S.arr(entry(S.num, S.num))),
  mods: strEntry(S.obj({ name: S.str, count: S.num, avoided: S.num })),
  roundAcc: ROUND_ACCUM
})

const HEAL_SPELL_STAT = S.obj({
  name: S.str,
  total: S.num,
  count: S.num,
  crits: S.num,
  max: S.num,
  // ABSENT, not zero: `newSource`/`newSpell` never set it, and `min: 0` would read as "the smallest
  // heal restored nothing". The published view drops the key too, so the fold's shape and the wire's
  // agree by construction.
  min: S.opt(S.num),
  overheal: S.num,
  fullOverheal: S.num
})

const HEAL_SOURCE_STAT = S.obj({
  name: S.str,
  kind: HEAL_SOURCE_KIND,
  total: S.num,
  count: S.num,
  crits: S.num,
  max: S.num,
  min: S.opt(S.num),
  overheal: S.num,
  fullOverheal: S.num,
  bySpell: strEntry(HEAL_SPELL_STAT)
})

const HEAL_ACCUM = S.obj({
  friendly: strEntry(HEAL_SOURCE_STAT),
  hostile: strEntry(HEAL_SOURCE_STAT),
  mit: S.obj({
    runeTotal: S.num,
    runeCount: S.num,
    runeMax: S.num,
    runeMin: S.opt(S.num),
    absorbedSwings: S.num,
    absorbedDamageShields: S.num
  }),
  unstated: strEntry(S.num)
})

const LANE_SIDES = S.obj({ damage: S.num, heal: S.num })

const PROC_ACCUM = S.obj({
  strikes: strEntry(S.obj({ name: S.str, count: S.num, ambiguous: S.bool })),
  slowLands: S.num,
  firstSlowTs: S.num,
  poisonDamage: strEntry(S.obj({ name: S.str, count: S.num, total: S.num })),
  dispels: strEntry(S.obj({ name: S.str, count: S.num })),
  coats: S.arr(S.obj({ poison: S.str, ts: S.num })),
  stanceSwitches: S.num,
  invocationSwitches: S.num,
  swings: S.num,
  swingsByState: strEntry(S.num),
  activeMsByState: strEntry(S.num),
  spellProcs: strEntry(
    S.obj({
      name: S.str,
      hits: LANE_SIDES,
      damage: S.num,
      heal: S.num,
      byState: strEntry(LANE_SIDES)
    })
  )
})

const WINDOW_ACCUM = S.obj({
  // Keyed by the MINUTE (`floor(ts / WINDOW_MS)`), and ordered: `WINDOW_CAP` evicts
  // `keys().next()`, i.e. the oldest INSERTED window, so this array's order is load-bearing.
  windows: S.arr(
    entry(
      S.num,
      S.obj({
        minute: S.num,
        activeMs: S.num,
        swings: S.num,
        outDamage: S.num,
        procDamage: S.num,
        transitions: S.num,
        transitionGroups: S.arr(S.str),
        stateKeys: S.arr(S.str)
      })
    )
  )
})

const AGG = S.obj({
  out: strEntry(SOURCE_STAT),
  inc: strEntry(SOURCE_STAT),
  targets: strEntry(S.obj({ name: S.str, amount: S.num })),
  enemyHeal: strEntry(S.obj({ name: S.str, amount: S.num })),
  incHeal: strEntry(S.obj({ name: S.str, amount: S.num, count: S.num })),
  heal: HEAL_ACCUM,
  procs: PROC_ACCUM,
  windows: WINDOW_ACCUM
})

// ------------------------------------------------------------------- encounters + zone sessions

const ENCOUNTER = S.obj({
  id: S.str,
  zone: S.opt(S.str),
  startTs: S.num,
  lastTs: S.num,
  agg: AGG,
  engaged: S.arr(S.str),
  engagedSeen: strEntry(S.num),
  activeMs: S.num,
  prevDamageTs: S.opt(S.num),
  ccActiveUntil: strEntry(S.num),
  events: S.arr(
    S.obj({
      ts: S.num,
      lane: S.str,
      category: DAMAGE_CATEGORY,
      amount: S.num,
      crit: S.bool,
      modifiers: S.opt(S.arr(S.str)),
      kind: SOURCE_KIND,
      outcome: S.opt(S.enum('hit', 'miss', 'resist')),
      detail: S.opt(S.str),
      target: S.opt(S.str)
    })
  ),
  eventsTotal: S.num,
  stanceSpans: S.arr(
    S.obj({ group: S.enum('stance', 'invocation'), name: S.str, start: S.num, end: S.opt(S.num) })
  ),
  markers: S.arr(S.obj({ ts: S.num, kind: MARKER_KIND, label: S.str, detail: S.opt(S.str) })),
  coatAtEngage: S.opt(COAT_SLOT),
  combatAtEngage: S.arr(COAT_SLOT),
  lastOutTarget: S.opt(S.str)
})

const ZONE_SESSION = S.obj({
  id: S.str,
  zone: S.str,
  agg: AGG,
  startTs: S.num,
  lastTs: S.num,
  finalizedMs: S.num,
  activeMs: S.num
})

// ------------------------------------------------------------------------------- the whole state

/**
 * THE COMBAT ENGINE'S DECLARATION. Its hash is the `combat` row of a container header.
 *
 * Read the absences with the presences: no `recording`, no `hydrating`, no `recent`, no
 * `rosterProvider`/`rosterSnapProvider`, no `probe`, and no memoized summary anywhere — every one
 * argued in `foldTypes.ts`'s header, and every one now unforgeable, because `validate` refuses a
 * field this object does not name.
 */
export const COMBAT_FOLD_SCHEMA: FoldSchema = S.obj({
  petNames: S.arr(S.str),
  world: WORLD,
  charm: CHARM,
  knownPlayers: S.arr(S.str),
  everPet: S.arr(S.str),
  everStruck: S.arr(S.str),
  playerKey: S.opt(S.str),
  playerKeyInjected: S.bool,
  zone: S.opt(S.str),
  seq: S.num,
  current: S.opt(ENCOUNTER),
  history: S.arr(ENCOUNTER),
  zoneAgg: AGG,
  zoneFinalizedMs: S.num,
  zoneActiveMs: S.num,
  zoneStartTs: S.num,
  zoneLastTs: S.num,
  zoneHistory: S.arr(ZONE_SESSION),
  zoneSeq: S.num,
  lastActivityTs: S.num,
  stance: S.opt(S.obj({ name: S.str, ts: S.num })),
  invocation: S.opt(S.obj({ name: S.str, ts: S.num })),
  coatUtility: S.opt(COAT_SLOT),
  coatCombat: S.arr(COAT_SLOT),
  // `nullable`, not `optional`: a null sample is a qualifying pull that never slowed — a real
  // observation, counted as `noLand` and never averaged in as a zero (law 5).
  slowSamples: S.arr(S.nullable(S.num)),
  stateTimeline: STATE_TIMELINE,
  recentCasts: RECENT_CASTS,
  quickBuffTs: S.num,
  specials: strEntry(S.str)
})
