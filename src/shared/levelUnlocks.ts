// LEVEL UNLOCKS — "what's new at this level", as a wire shape and a pure join
// (docs/plans/levelup-whats-new.md § 1–2, wave O2).
//
// TWO SOURCES, ALREADY COMMITTED, NEITHER OF THEM SCRAPED HERE:
//   * spells.json's `classes` field states, per spell, WHICH CLASS gets it AT WHICH LEVEL —
//     parsed by shared/spellLevels.ts (2,001 pairs over the committed DB, measured wave O1).
//   * classes.json's `skillUnlocks` / `discUnlocks` state the same for skills, disciplines and
//     the three structure-derived innates (450 + 33 rows, measured wave O1).
// Main folds both into `LevelUnlockData` (src/main/data/levelUnlocks.ts) because both JSONs are
// bundled into the MAIN process; this file holds the shape they cross the wire in and every
// derivation the renderer performs on them, so `npm test` pins the arithmetic with no Electron.
//
// LAW 10 IS THE WHOLE DESIGN OF `comboClassesAt`. A level-up is a timestamped record and the
// class combo is a set of FUZZY, RETROACTIVELY REVISABLE intervals, so "which classes did that
// ding unlock things for" is a TIME JOIN at read (`comboAt`), never a stamped field. A ding
// toasted an hour ago re-counts correctly the moment a `/who` line or a user correction re-labels
// that span — there is nothing to reconcile because nothing was stamped.
//
// AND LAW 1: an unresolved loadout is never guessed. A slot holding {CLR,PAL} contributes BOTH
// classes to the count and the whole answer is labeled `ambiguous`; a slot with no evidence at
// all (all 16 candidates) contributes NOTHING — unioning sixteen classes would produce a number
// that is not about this character at all.
//
// Pure, dependency-free, RELATIVE value imports (the mobSearch.ts precedent).

import { CLASS_ABBRS, resolvedClasses, type ClassAbbr, type ComboInterval } from './classCombo'
import { comboAt } from './comboIndex'

/** What kind of thing unlocked. `skill`/`disc`/`innate` are classes.json's own words. */
export type UnlockKind = 'spell' | 'skill' | 'disc' | 'innate'

/** One spell, with every (class, level) statement the DB makes about it and its card fields. */
export interface UnlockSpell {
  name: string
  /** the (class, level) pairs `shared/spellLevels.ts` read out of the wiki's bullet list */
  at: { cls: ClassAbbr; level: number }[]
  /** cast time in ms, when the page states one */
  castTimeMs?: number
  mana?: number
  /** target_type verbatim ("Single Friendly (or Self)") */
  targetType?: string
  /** spell_type verbatim ("Beneficial" / "Detrimental") */
  spellType?: string
  /** parsed duration in ms; absent for instants and unparseable formulas */
  durationMs?: number
}

/** One skill / discipline / innate, as classes.json states it for ONE class. */
export interface UnlockSkill {
  name: string
  level: number
  kind: 'skill' | 'disc' | 'innate'
  /**
   * A source that DISPUTES this row, quoted verbatim from classes.json's `disputed[]`.
   *
   * The central Disciplines page strikes the whole non-Rogue discipline table through and says
   * only Rogue poison disciplines are on Legends, while each class page still states its own
   * levels. Both claims are the wiki's; the row is kept and LABELED rather than silently
   * dropped or silently shown (law 1).
   */
  dispute?: string
}

/** The whole unlock dataset, as it crosses the wire once per renderer session. */
export interface LevelUnlockData {
  /** every spell the DB places for at least one class at a stated level */
  spells: UnlockSpell[]
  /** skills + discs + innates, keyed by /who class code */
  skills: Partial<Record<ClassAbbr, UnlockSkill[]>>
  /** classes.json's scrape stamp — provenance for the panel's "from the wiki DB" chip */
  scrapedAt?: string
}

export const EMPTY_UNLOCK_DATA: LevelUnlockData = { spells: [], skills: {} }

// ---- the combo join (law 10) ----------------------------------------------------------

/** The classes a count should be computed over, and whether that set is a guess. */
export interface ComboClasses {
  /** slots holding exactly one candidate — the classes we KNOW are in the loadout */
  resolved: ClassAbbr[]
  /** extra candidates from partially-known slots ({CLR,PAL}); never a fully-unknown slot */
  candidates: ClassAbbr[]
  /** true when ANY slot is unresolved — every count over this set is an upper bound */
  ambiguous: boolean
}

export const EMPTY_COMBO_CLASSES: ComboClasses = { resolved: [], candidates: [], ambiguous: true }

/** resolved ∪ candidates, deduped and sorted — the set a count is actually taken over. */
export function comboClassSet(c: ComboClasses): ClassAbbr[] {
  return [...new Set([...c.resolved, ...c.candidates])].sort((a, b) => a.localeCompare(b))
}

/**
 * One interval's classes, split into what it KNOWS and what it merely narrows.
 *
 * A slot listing every class in the game is UNKNOWN, not ambiguous-in-a-useful-way: it states no
 * evidence, so it contributes no candidates and only sets the flag. A null interval is
 * `EMPTY_COMBO_CLASSES` (ambiguous, empty) rather than an empty loadout — the difference between
 * "you gained nothing" and "we do not know yet".
 */
export function comboClassesOf(interval: ComboInterval | null): ComboClasses {
  if (!interval) return EMPTY_COMBO_CLASSES
  const resolved = resolvedClasses(interval)
  const candidates: ClassAbbr[] = []
  let ambiguous = false
  for (const slot of interval.slots) {
    if (slot.candidates.length === 1) continue
    ambiguous = true
    if (slot.candidates.length >= CLASS_ABBRS.length) continue
    candidates.push(...slot.candidates)
  }
  return {
    resolved: [...new Set(resolved)].sort((a, b) => a.localeCompare(b)),
    candidates: [...new Set(candidates)].filter((c) => !resolved.includes(c)).sort((a, b) => a.localeCompare(b)),
    ambiguous
  }
}

/**
 * The loadout as of `ts`, joined at read (law 10) — the form the level-up toast uses, because a
 * ding is a timestamped record and the intervals covering it are revisable forever.
 */
export function comboClassesAt(intervals: readonly ComboInterval[], ts: number): ComboClasses {
  return comboClassesOf(comboAt(intervals, ts))
}

// ---- the level join -------------------------------------------------------------------

/** One thing that unlocks at a level, folded across the classes that unlock it there. */
export interface UnlockRow {
  kind: UnlockKind
  name: string
  /** the classes IN THE QUERIED SET that gain this at this level, sorted */
  classes: ClassAbbr[]
  level: number
  /** the disputing source, quoted verbatim (disc rows only) */
  dispute?: string
  /** the spell's card fields, for the hover — absent on skill rows */
  spell?: UnlockSpell
}

/** Everything a level gives a loadout, split the way the panel draws it. */
export interface LevelUnlocks {
  level: number
  spells: UnlockRow[]
  /** skills, disciplines and innates in one list — the panel chips the kind */
  skills: UnlockRow[]
  /** the set the join ran over (may be empty) */
  classes: ClassAbbr[]
  /** true when the loadout was not fully resolved: the lists are an UPPER BOUND */
  ambiguous: boolean
}

/** A class set with nothing in it answers honestly rather than scanning the whole game. */
function emptyUnlocks(level: number, ambiguous: boolean): LevelUnlocks {
  return { level, spells: [], skills: [], classes: [], ambiguous }
}

/**
 * Every spell the queried classes gain at `level`, folded BY NAME.
 *
 * By name, not per DB row, for two reasons the committed data shows: a spell can be stated for
 * several classes in the loadout at the same level (one row, two chips), and the wiki genuinely
 * carries duplicate pages for a few spells (`Imbue Emerald` appears twice at CLR 29). Counting a
 * name twice would inflate the toast's headline over a wiki bookkeeping artefact; the first
 * record's fields win, because they are the same spell.
 */
function spellRows(data: LevelUnlockData, want: ReadonlySet<string>, level: number): UnlockRow[] {
  const byName = new Map<string, UnlockRow>()
  for (const spell of data.spells) {
    const classes = spell.at.filter((p) => p.level === level && want.has(p.cls)).map((p) => p.cls)
    if (classes.length === 0) continue
    const key = spell.name.toLowerCase()
    const row = byName.get(key)
    if (!row) {
      byName.set(key, { kind: 'spell', name: spell.name, classes: [...new Set(classes)], level, spell })
      continue
    }
    for (const cls of classes) if (!row.classes.includes(cls)) row.classes.push(cls)
  }
  for (const row of byName.values()) row.classes.sort((a, b) => a.localeCompare(b))
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Merge one class's skill row into the (name, kind) fold — a second class only adds a chip. */
function addSkillRow(byKey: Map<string, UnlockRow>, cls: ClassAbbr, s: UnlockSkill): void {
  const key = `${s.kind}:${s.name.toLowerCase()}`
  const row = byKey.get(key)
  if (row) {
    if (!row.classes.includes(cls)) row.classes.push(cls)
    return
  }
  const next: UnlockRow = { kind: s.kind, name: s.name, classes: [cls], level: s.level }
  if (s.dispute) next.dispute = s.dispute
  byKey.set(key, next)
}

/**
 * Every skill/disc/innate the queried classes gain at `level`, folded by (name, kind) so a skill
 * two classes in the loadout both get at 10 is ONE row wearing two chips.
 */
function skillRows(data: LevelUnlockData, classes: readonly ClassAbbr[], level: number): UnlockRow[] {
  const byKey = new Map<string, UnlockRow>()
  for (const cls of classes) {
    for (const s of (data.skills[cls] ?? []).filter((r) => r.level === level)) addSkillRow(byKey, cls, s)
  }
  for (const row of byKey.values()) row.classes.sort((a, b) => a.localeCompare(b))
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * WHAT THIS LEVEL GIVES THESE CLASSES. Pure — the panel and the toast subtitle both read it, so
 * the number in the toast and the rows in the panel can never disagree.
 *
 * BER/MNK/WAR have ZERO Template:Spellpage spells (measured, wave O1): an empty `spells` list for
 * a skills-only loadout is the honest answer, never an error state.
 */
export function unlocksAtLevel(
  data: LevelUnlockData,
  combo: ComboClasses,
  level: number
): LevelUnlocks {
  const classes = comboClassSet(combo)
  if (classes.length === 0 || !Number.isFinite(level)) return emptyUnlocks(level, combo.ambiguous)
  const want = new Set<string>(classes)
  return {
    level,
    spells: spellRows(data, want, level),
    skills: skillRows(data, classes, level),
    classes,
    ambiguous: combo.ambiguous
  }
}

/** The two headline numbers: distinct spells, distinct skill-ish things. */
export function unlockCounts(u: LevelUnlocks): { spells: number; skills: number } {
  return { spells: u.spells.length, skills: u.skills.length }
}

/**
 * The level-up toast's subtitle: "3 new spells · 2 new skills".
 *
 * Zero unlocks ⇒ undefined, and the toast celebrates the level alone (the design's explicit
 * case: a level that gives you nothing is still a level). An unresolved loadout appends the
 * `~ambiguous` label the UI convention reserves for exactly this — the counts are an upper
 * bound over the candidate classes, and saying so is cheaper than being wrong.
 */
export function levelUpSubtitle(u: LevelUnlocks): string | undefined {
  const { spells, skills } = unlockCounts(u)
  const parts: string[] = []
  if (spells > 0) parts.push(`${String(spells)} new spell${spells === 1 ? '' : 's'}`)
  if (skills > 0) parts.push(`${String(skills)} new skill${skills === 1 ? '' : 's'}`)
  if (parts.length === 0) return undefined
  if (u.ambiguous) parts.push('~ambiguous loadout')
  return parts.join(' · ')
}

/** The levels this dataset has anything at all to say about, ascending. Drives the stepper. */
export function unlockLevels(data: LevelUnlockData, classes: readonly ClassAbbr[]): number[] {
  const want = new Set<string>(classes)
  const levels = new Set<number>()
  for (const spell of data.spells) {
    for (const p of spell.at.filter((x) => want.has(x.cls))) levels.add(p.level)
  }
  for (const cls of classes) for (const s of data.skills[cls] ?? []) levels.add(s.level)
  return [...levels].sort((a, b) => a - b)
}
