// RESIST MINING — the vocabulary (JOS-382, docs/plans/resist-mining.md).
//
// Pure: no Electron, no node, no React. Everything in this file is either a shape the ledger
// writes to disk or a small total function over one of those shapes, so main, the renderer, the
// baseline generator and the unit tests all read the same definitions.
//
// THE ONE DESIGN RULE THIS FILE ENCODES: THE LEDGER STORES OBSERVATIONS, NOT CONCLUSIONS.
// A row says "this spell was cast on this mob under these conditions and here is what the log
// printed". It does NOT say what the mob's resist stat is, and it does not even carry the
// spell's resist axis or resist adjust — those live in the client's own `spells_us.txt` and are
// joined in at ESTIMATE time (resistModel.ts). That is deliberate: a game patch that retunes a
// spell's `resistAdj` then costs a re-ESTIMATE (free, on demand) instead of a re-FOLD of every
// log the user has ever tailed. It is also what lets the shipped baseline be a table-independent
// artifact: the committed JSON is bytes the log printed, nothing derived from a file we are not
// allowed to redistribute.
//
// WHY THE ROW KEY LOOKS LIKE THAT. `rc = R[axis] + levelMod + resistAdj - debuff`, so two
// observations may be pooled only when every term except `R` matches. levelMod is a function of
// (casterLevel, mobLevel); resistAdj is a function of the spell; debuff is a function of which
// resist debuffs were up. Hence the key
// (mobKey, spellKey, family, casterKind, casterLevel, mobLevel, debuffs) — each row is one
// binomial cell with a known offset, and the estimator never has to guess which conditions a
// count was gathered under.
//
// WHY ONLY FIVE AXES. `spells_us.txt` field 29 also spells 6 = chromatic, 7 = prismatic,
// 8 = physical and 9 = corruption. Chromatic resolves against the target's LOWEST resist and
// prismatic against its AVERAGE, so neither observation is attributable to any single axis —
// filing one under a named axis would be inventing a fact the game did not state (world-model
// law 6). Physical and corruption have no row on the card and no Torven baseline to shrink
// toward. All four are dropped rather than mis-filed; `axisFromResistType` returns null for
// them, and the estimator skips any row whose spell has no axis.

/** The five axes the game prints, the app shows, and the estimator models. */
export type ResistAxis = 'magic' | 'fire' | 'cold' | 'poison' | 'disease'

/** Display order. Always all five, always this order, on every surface. */
export const RESIST_AXES: readonly ResistAxis[] = ['magic', 'fire', 'cold', 'poison', 'disease']

/**
 * NO ACRONYMS, EVER (owner ruling, 2026-08-16). The axis WORD is the only label this app is
 * allowed to print for an axis; `MR`/`FR`/`CR` appear nowhere in the UI. The word and the axis
 * colour always travel together — see `RESIST_AXIS_COLORS` in the renderer theme.
 */
export const RESIST_AXIS_WORDS: Record<ResistAxis, string> = {
  magic: 'magic',
  fire: 'fire',
  cold: 'cold',
  poison: 'poison',
  disease: 'disease',
}

/** `spells_us.txt` field 29 -> axis, or null for the four kinds this app refuses to model. */
export function axisFromResistType(resistType: number): ResistAxis | null {
  switch (resistType) {
    case 1:
      return 'magic'
    case 2:
      return 'fire'
    case 3:
      return 'cold'
    case 4:
      return 'poison'
    case 5:
      return 'disease'
    default:
      return null
  }
}

/** Which evidence family a row belongs to. Songs are separable in exactly one place: here. */
export type ResistFamily = 'cast' | 'song'

/**
 * Who cast the spell this row counts.
 *
 *   self  the tailed character. The only caster whose level is always known.
 *   pc    another player. Filed, never estimated from — nothing states a stranger's level.
 *   npc   a charmed pet or any other NPC caster, landing or being resisted on ANOTHER NPC
 *         (JOS-385). Its caster level comes from the mob catalog (a `/con` this session wins) and
 *         is null when nothing states one, which drops the row out of the fit exactly as a `pc`
 *         row's null level does.
 *
 * `npc` USED TO BE REFUSED OUTRIGHT (JOS-382, owner: "an NPC's spell rolls against a different
 * table"). The owner revisited that on 2026-08-16: the rows are folded like any other observation
 * and a SWITCH decides whether the estimator weighs them (`shared/resistPrefs.ts`), because
 * whether pet tuning skews a mob's number is a measurable question and not one a fold should
 * answer by throwing the measurement away.
 */
export type ResistCasterKind = 'self' | 'pc' | 'npc'

/** Every caster kind, in the order the evidence lines print them. */
export const RESIST_CASTER_KINDS: readonly ResistCasterKind[] = ['self', 'pc', 'npc']

/** Where a row came from. Absent means the user's own log (the ledger's default). */
export type ResistSource = 'baseline' | 'user'

/**
 * ONE POOLED BINOMIAL CELL. `dmg` is a histogram of the damage numbers the log printed for this
 * spell under these conditions — the estimator derives "full damage vs silently partial" from
 * the histogram's own shape, so the ledger never has to decide it. Past
 * `MAX_DISTINCT_DAMAGE_VALUES` distinct values the row gives up on the histogram, sets
 * `variable` and only counts lands: a spell whose damage genuinely varies (procs, `… Strike`
 * lines) carries no partial information anyway, and an unbounded map is a disk-size bug.
 */
export interface ResistRow {
  mobKey: string
  zone?: string
  spellKey: string
  family: ResistFamily
  casterKind: ResistCasterKind
  /** Self: the session level. Another player: their `/who` level if known. Else null. */
  casterLevel: number | null
  /** `/con` beats the catalog (a range folds to its midpoint) beats null. */
  mobLevel: number | null
  /** Catalog range, kept beside the midpoint so the UI can say how sure the level is. */
  mobLevelLo?: number
  mobLevelHi?: number
  /** Sorted, '|'-joined canonical spell keys of the resist debuffs up at that moment. */
  debuffs: string
  resist: number
  land: number
  /** damage value -> count. Keys are the decimal number as written. */
  dmg: Record<string, number>
  variable?: boolean
  firstTs: number
  lastTs: number
  /** Set only when the row is read out of the shipped baseline. */
  source?: ResistSource
}

/** Past this many distinct damage values a row stops keeping the histogram (see ResistRow). */
export const MAX_DISTINCT_DAMAGE_VALUES = 32

/**
 * Per-source buckets, exactly like the message overlay (JOS-231): a re-fold REPLACES a source's
 * bucket and never adds to it, so folding the same log twice is a no-op by construction.
 * `key` is a character id, or `BASELINE_SOURCE_KEY` for the shipped file.
 */
export interface ResistLedger {
  schema: 1
  sources: { key: string; rows: ResistRow[] }[]
  /** Baseline only: when it was mined, and against which `spells_us.txt`. */
  frozenAt?: string
  spellsUsMtime?: number
}

export const BASELINE_SOURCE_KEY = 'baseline'

/** A resist-debuff slot, as read off `spells_us.txt` field 172. */
export interface ResistDebuffSlot {
  /** 'all' is effect 111, which moves every axis at once. */
  axis: ResistAxis | 'all'
  /** Magnitude at base, always positive here; the sign is the debuff's own business. */
  base: number
  /** Formula code: 100 flat, 101 base + level/2, 102 base + level, capped at `max`. */
  calc: number
  max: number
}

/**
 * What the estimator needs to know about a spell, derived from the CLIENT'S `spells_us.txt` at
 * runtime. Never committed to this repo — see `src/main/resist/spellTable.ts`.
 */
export interface SpellResistInfo {
  axis: ResistAxis | null
  resistAdj: number
  castMs: number
  targetType: number
  /** Slot-1-through-N effect 0 (hitpoints), when the spell has one. Drives fixed-vs-variable. */
  hpSlot?: { base: number; max: number; calc: number }
  /** Present only on resist debuffs (tash/malo). */
  debuffSlots?: ResistDebuffSlot[]
  /**
   * A hard level cap the game enforces independently of `rc` (mez "up to L55", charm "up to
   * L37"). A resist above the cap says nothing about the mob's resist stat and is filed nowhere.
   */
  levelCap?: number
  /**
   * The bard is the only class that can use it, so every line it prints is a SONG PULSE rather
   * than a cast. The log cannot tell us this — `You begin singing` and `You begin casting` parse
   * to the same event — so the class table is the only place the answer exists.
   */
  song?: boolean
}

export type SpellResistTable = Record<string, SpellResistInfo>

/** Per-spell evidence, the drilldown line: "Chaos Flux: 155 casts, 17 resisted, 61 partial". */
export interface ResistSpellEvidence {
  spellKey: string
  family: ResistFamily
  casts: number
  resisted: number
  partial: number
  full: number
  land: number
  fromBaseline: number
  fromYou: number
  /** The spell's resist adjust, from the client table. Negative helps the caster. */
  resistAdj: number
  /**
   * COULD THIS SPELL HAVE BEEN RESISTED AT ALL? (JOS-385.) False for the -150/-200/-250 procs and
   * the lures: their casts are counted and shown, sorted last, and labelled — they say almost
   * nothing about the mob, and a list they headed was telling the reader the opposite.
   */
  informative: boolean
  /**
   * THE EVIDENCE-SYMMETRY VERDICT. Every observation of this spell across the whole ledger is a
   * RESIST: no landing, no damage number, nothing. That is never a mob that resists 100% of
   * everything — it is a spell whose landings this app cannot see, and treating it as evidence
   * drives R to the top of the grid. The rows stay in the drilldown, labelled, and out of the fit.
   */
  landingsNotObservable?: boolean
}

/** One side of the baseline/you split, or the merged answer. */
export interface ResistFit {
  R: number
  lo: number
  hi: number
  n: number
}

export interface ResistEstimate extends ResistFit {
  /**
   * OBSERVATIONS THAT COULD HAVE GONE EITHER WAY (JOS-385). `n` counts everything the fit saw;
   * this counts only the casts of spells that could actually have been resisted
   * (`isInformativeSpell`). The two differ by an order of magnitude on any cell a proc dominates —
   * the owner's thunder spirit princess read `n=83` off 8 — so it is `nInformative` that decides
   * whether the low-samples caveat is owed, and both numbers are printed.
   */
  nInformative: number
  /** Observations that entered the likelihood, split by where they came from. */
  fromBaseline: number
  fromYou: number
  /** Observations dropped because no level was known for both sides of `levelMod`. */
  droppedNoLevel: number
  /** Observations held out because their spell's landings are not observable (resistModel.ts). */
  droppedUnobservable: number
  byFamily: Record<ResistFamily, { n: number; resist: number; land: number }>
  /**
   * The same tally, split by WHO CAST IT (JOS-385). Counted for every kind whether or not it
   * entered the number, so the card can print `npc casters: 98 (not included)` — a family the user
   * has switched off is still a thing the log saw, and hiding it would make the switch look like a
   * filter on the ledger rather than on the fit.
   */
  byCaster: Record<ResistCasterKind, { n: number; resist: number; land: number }>
  /** Whether npc-caster rows were weighed in this estimate — `resists.includeNpcCasters`. */
  npcIncluded: boolean
  perSpell: ResistSpellEvidence[]
  /** The weight one baseline observation carried: K / (K + nUser), 0 once nUser >= 50. */
  baselineWeight: number
  /** True once the user's own log stands alone and the baseline is only a reference marker. */
  userOnly: boolean
  /** Separate well-populated fits, when both sides have any data at all. */
  baselineFit: ResistFit | null
  userFit: ResistFit | null
  /** THE PATCH DETECTOR: both sides n >= 30 and their 95% intervals do not overlap. */
  differsFromShipped: boolean
  /** rc >= 200 at an even-level, unadjusted cast: nothing all-or-nothing can land. */
  nearlyImmune: boolean
}

/** The plain-language tag beside the number. Thresholds and their argument: resistModel.ts. */
export type ResistTag = 'weak' | 'normal' | 'resistant' | 'very resistant' | 'nearly immune'

/** One axis row on the card. `tag` is null ONLY at n = 0, which draws as "no data". */
export interface MobResistAxis {
  axis: ResistAxis
  estimate: ResistEstimate | null
  tag: ResistTag | null
  n: number
  /** The half of `n` that could have gone either way — see `ResistEstimate.nInformative`. */
  nInformative: number
}

export interface MobResistProfile {
  mobKey: string
  displayName: string
  level: { lo: number; hi: number; from: 'con' | 'catalog' } | null
  axes: MobResistAxis[]
  /** False when the client's `spells_us.txt` could not be read; the card says so. */
  spellDataAvailable: boolean
  /**
   * WHY it could not be read, as a finished sentence, or null when it could (JOS-385). Two states,
   * because they are two different problems with two different fixes and the first cut blamed the
   * install for both: the file is NOT THERE at the resolved root (say the path, so the user can
   * see which folder the app is looking in), or it is there and did not load (say so, and point at
   * the error log). Built in `main/resist/profile.ts` — see that file for why the sentence travels
   * with the profile rather than being rebuilt per surface.
   */
  spellDataNote: string | null
  /** When the shipped baseline was mined, for the "shipped data" wording. */
  baselineFrozenAt: string | null
}

/**
 * ALWAYS SHOW THE ANSWER (owner ruling, 2026-08-16, superseding JOS-382's floor).
 *
 * The first cut refused to draw a number under five observations and printed "not enough data
 * (n=2)" in its place. The owner overruled that: a cell with ANY observation gets the tag, the R,
 * the interval and the count exactly as a well-populated one does — the prior keeps the estimate
 * sane, the interval comes out wide, and a WIDE INTERVAL IS THE HONEST DISPLAY of a thin cell. What
 * a thin cell gets in addition is a quieter CAVEAT beside the tag, not a substitute for it.
 *
 * Only n = 0 has nothing to say, and it says "no data".
 *
 * THE SHIPPED BASELINE'S OWN FLOOR IS UNCHANGED and is a different rule entirely: the freeze script
 * drops rows under five observations (`MIN_ROW_OBSERVATIONS`, scripts/gen-resist-baseline.ts) to
 * keep the committed file small. That is about bytes on disk; this is about what a person is shown.
 *
 * AND IT IS COUNTED IN INFORMATIVE OBSERVATIONS (JOS-385). The owner's thunder spirit princess read
 * `resistant` with no caveat off `n=83`, of which 75 were casts of -150/-200/-250 procs that could
 * not have been resisted whatever the mob's magic resistance is. Eight observations is a thin cell
 * wearing a fat number, which is the exact thing this threshold exists to catch.
 */
export const LOW_SAMPLE_BELOW = 10

/**
 * The drilldown behind ONE axis row: the estimate, and the rows it was computed from. Lives here
 * rather than beside the main-process builder because the preload names it, and a preload that
 * reaches into `src/main` drags the whole main-process type graph into the renderer's program.
 */
export interface MobResistCell {
  mobKey: string
  axis: ResistAxis
  estimate: ResistEstimate
  rows: ResistRow[]
}
