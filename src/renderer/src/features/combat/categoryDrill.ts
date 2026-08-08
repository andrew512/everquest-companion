// THE LEVEL-3 DRILL: one damage TYPE of one source, and everything that is true about it.
//
// WHY IT EXISTS (JOS-105, owner): "the multi-attack panel crowds out the normal combat panel.
// Kill the separate panel; integrate its stats into the single drill-down. Drill into melee ->
// slash vs crush, double attack, triple attack, crit rate. Every damage type gets the same
// treatment - stats live INSIDE the drill, not beside it in a second panel."
//
// So the multi-attack readout is no longer a PANEL that rides beside the drill (the JOS-37
// arrangement, `MultiAttackPanel.tsx` — deleted with this module's arrival). It is a section of
// the drill's third level, and the level is reached the same way every other level is reached:
// by clicking the thing you want to know about. One mechanic, three levels:
//
//   level 1  the ranked source list          (petRows.meterSources)
//   level 2  ONE source's flat lane list     (petRows.nestedRows)
//   level 3  ONE category of that source     (here)
//
// Nothing here reads or derives a damage AMOUNT that the engine did not already state: the rows
// are the engine's own `CategoryView.skills`, the rates are its own `critPct`/`resistPct`, and
// the multi-attack section is `multiAttackRows` over the engine's own round counters. Law 8: the
// surface moved, the numbers did not.
//
// PURE TS, RELATIVE VALUE IMPORTS. Like procRows/multiAttackRows/dashboardData this module is
// exercised by node tests that run without the renderer's `@shared` alias, and it is imported by
// the MUI-free overlay bundle. No JSX, no MUI, and no VALUE import of `@shared/combat` — the
// category's display LABEL is deliberately not resolved here, because each surface already owns
// its own label map (the app reads `CATEGORY_LABEL`, the overlay carries its copy).

import type { DamageCategory, RoundLaneView, SourceRoundsView, SourceView } from '@shared/combat'
import { flurryText, multiAttackRows, type MultiAttackRow } from './multiAttackRows'
import type { SkillRow } from './dashboardData'

/** ONE category of ONE source — the whole of what level 3 shows. */
export interface CategoryDrillView {
  category: DamageCategory
  /** the category's damage total, straight off the engine's rollup. */
  total: number
  hits: number
  crits: number
  critPct: number
  /** spell resists inside this category (0 for melee/slay/ds). */
  resists: number
  resistPct: number
  /** largest single hit in this category. */
  max: number
  /**
   * The category's own lanes, ranked by damage desc with bar widths re-based on the CATEGORY's
   * biggest lane. This is the "slash vs crush" half of the ask.
   *
   * Deliberately NOT slay-grouped: `dashboardData.groupSlay` collapses the per-weapon slay rows
   * into one aggregate for the FLAT level-2 list, and drilling the Slay Undead row is precisely
   * the request to see that aggregate come apart again.
   */
  rows: SkillRow[]
  /** the multi-attack reading for the attack lanes that belong to this category (JOS-37's rows). */
  attack: MultiAttackRow[]
  /** `flurry x12 - 2.1% of rounds`, on the ONE category that owns the source's rounds; else null. */
  flurry: string | null
}

/**
 * SKILL NAME → the category the engine booked it under, first-wins in the engine's own category
 * order (`SourceView.categories` is ordered by CATEGORY_ORDER).
 *
 * First-wins matters for exactly one real collision: a Slay Undead proc rides a weapon swing, so
 * the engine names its `slay` row after the WEAPON skill ("Bash", "Backstab"). Melee comes first,
 * so the attack lane called "Bash" is filed under the swing that opened the round rather than
 * under the proc that happened to fire on it — which is what a round IS.
 */
function categoryByName(source: SourceView): Map<string, DamageCategory> {
  const index = new Map<string, DamageCategory>()
  for (const c of source.categories) {
    for (const s of c.skills) {
      const key = s.name.toLowerCase()
      if (!index.has(key)) index.set(key, c.category)
    }
  }
  return index
}

/**
 * Where a lane goes when its label matches no skill row of the source.
 *
 * That is the NORMAL case for a plain weapon verb, not an edge: the parser answers "Melee" for
 * slash / crush / pierce / hit alike, so `roundViews.roundLaneLabel` titles those lanes after the
 * VERB ("Slash") and no skill row is called that. An attack round is a weapon swing, so melee is
 * where it belongs — unless this source has no melee category at all, in which case slay (the
 * only other category a swing can land in) takes it.
 */
function laneFallback(source: SourceView): DamageCategory {
  const cats = new Set(source.categories.map((c) => c.category))
  if (cats.has('melee')) return 'melee'
  return cats.has('slay') ? 'slay' : 'melee'
}

/** The category ONE attack lane's rounds belong to. */
export function laneCategory(source: SourceView, lane: RoundLaneView): DamageCategory {
  return categoryByName(source).get(lane.label.toLowerCase()) ?? laneFallback(source)
}

/** Every lane of `r`, split by the category its label resolves to. */
function lanesByCategory(source: SourceView, r: SourceRoundsView): Map<DamageCategory, RoundLaneView[]> {
  const index = categoryByName(source)
  const fallback = laneFallback(source)
  const out = new Map<DamageCategory, RoundLaneView[]>()
  for (const lane of r.lanes) {
    const cat = index.get(lane.label.toLowerCase()) ?? fallback
    const list = out.get(cat)
    if (list) list.push(lane)
    else out.set(cat, [lane])
  }
  return out
}

/**
 * WHICH CATEGORY THE FLURRY LINE BELONGS TO — the one holding the most attack rounds.
 *
 * Flurry is counted from the `(Flurry)` annotation and the log never says which verb a flurried
 * swing belonged to (multiAttackRows.ts says so, law 6), so it cannot be split per lane and must
 * not be printed once per category drill — that would state the same 12 flurries three times.
 * It rides the category that actually swung, and stays silent everywhere else.
 */
function flurryHome(byCat: Map<DamageCategory, RoundLaneView[]>): DamageCategory | null {
  let best: DamageCategory | null = null
  let bestRounds = 0
  for (const [cat, lanes] of byCat) {
    const rounds = lanes.reduce((n, l) => n + l.rounds, 0)
    if (rounds > bestRounds) {
      best = cat
      bestRounds = rounds
    }
  }
  return best
}

/**
 * The category's own lanes as bar rows: the engine's skills, ranked, with `pct` re-based on the
 * biggest lane IN THIS CATEGORY. The engine's own `pct` is already category-relative, but it is
 * re-derived rather than trusted so a future rollup change cannot silently draw a top bar that
 * stops short.
 */
function categoryRows(source: SourceView, category: DamageCategory): SkillRow[] {
  const cat = source.categories.find((c) => c.category === category)
  if (!cat) return []
  const rows = [...cat.skills].sort(
    (a, b) => b.total - a.total || b.hits - a.hits || a.name.localeCompare(b.name)
  )
  const max = Math.max(1, ...rows.map((r) => r.total))
  return rows.map((s) => ({ ...s, category, pct: (s.total / max) * 100 }))
}

/**
 * ONE source's category drill, or null when the source has nothing of that type — a stale level-3
 * drill therefore degrades to its PARENT (level 2, the source's lane list), which is the same
 * "degrade to the level above" rule a stale entity id already gets from `petRows.meterPanel`.
 *
 * A category with lanes but no rounds still renders: `attack` simply comes back empty and the
 * drill is the lanes plus the crit/resist reading. A caster's Direct spells drill is exactly that,
 * and it is what "every damage type gets the same treatment" means — the same drill, stating the
 * stats that exist rather than a table of zeroes for the ones that do not.
 */
export function categoryDrill(source: SourceView, category: DamageCategory): CategoryDrillView | null {
  const cat = source.categories.find((c) => c.category === category)
  if (!cat) return null
  const r = source.roundStats
  const byCat = r ? lanesByCategory(source, r) : new Map<DamageCategory, RoundLaneView[]>()
  const lanes = byCat.get(category) ?? []
  // Re-shaped through the SAME `multiAttackRows` the deleted panel used, over a narrowed view, so
  // the bar widths inside the drill are relative to this category's own biggest lane.
  const attack = r && lanes.length > 0 ? multiAttackRows({ ...r, lanes }) : []
  return {
    category,
    total: cat.total,
    hits: cat.hits,
    crits: cat.crits,
    critPct: cat.critPct,
    resists: cat.resists,
    resistPct: cat.resistPct,
    max: cat.max,
    rows: categoryRows(source, category),
    attack,
    flurry: r && flurryHome(byCat) === category ? flurryText(r) : null
  }
}
