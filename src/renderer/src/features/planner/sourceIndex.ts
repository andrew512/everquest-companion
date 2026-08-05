// planner/sourceIndex.ts — "where does this donor drop?", answered locally (design §4.2).
//
// The planner's whole point is "here is where to go and what to camp", and the answer is already
// on this machine: `data/eqlegends/mobs.json` is bundled into the renderer for the Mobs tab
// (mobSearch.ts), and every mob page states its `|known_loot`. Inverting that list gives a
// item → mobs index for free — no IPC, no network, works offline.
//
// LAZY, NEVER AT MODULE LOAD — the mobSearch precedent. The Planner tab may never be opened this
// session, and the catalog is immutable, so the index is built on first use and lives for the
// window's lifetime. MEASURED over the committed catalog (2026-08-04, node, warm): 7,872 pages,
// 4,410 of them with a loot list, 32,822 item→mob links folding onto 5,357 distinct item keys.
//
// THE KEY IS THE DONOR'S KEY. Main serves `PlannerDonor.key = itemKey(name)`
// (src/main/itemsDb.ts) — `+N` stripped, case folded — and a join that used any other spelling
// would silently find nothing for the ~1,900 catalog drop names that carry an upgrade suffix.
// The renderer cannot import main, so the rule is re-applied here from its SHARED half
// (`itemBaseName`), which is the same function main's `itemKey` calls.
//
// It says only what the catalog says (law 1): a mob, its page, the level text VERBATIM (a range
// as often as a number) and its zones. No rarity — the compact catalog carries item names only —
// and no invented drop rate.

import type { MobEntry } from '@shared/types'
// RELATIVE value import (house law, the mobSearch.ts precedent): the `@shared` alias exists only
// inside the vite build, and `tests/plannerSourceIndex.test.mts` imports this module directly
// under the node runner. Type-only imports are erased, so they keep the alias.
import { itemBaseName } from '../../../../shared/itemStats'
import mobsJson from '../../data/eqlegends/mobs.json'

/** One place a donor item is known to come from. Exactly what the mob page stated, nothing more. */
export interface PlannerSource {
  /** the mob's in-game name, as the page writes it ("the froglok shin lord") */
  mob: string
  /** wiki page title — present whenever the catalog row has one (it always does today) */
  mobPage?: string
  /** level EXACTLY as stated: a RANGE ("36-40") as often as a number ("30") */
  levelText?: string
  /** home zone(s) from the page; `[]` when it stated none ("Various" is a real value, not a gap) */
  zones: string[]
}

export type SourceIndex = ReadonlyMap<string, PlannerSource[]>

interface MobCatalog {
  scrapedAt: string
  source: string
  mobs: MobEntry[]
}

const catalog = mobsJson as unknown as MobCatalog

/**
 * The donor-row key for an item NAME — main's `itemsDb.ts itemKey`, re-applied renderer-side.
 * Kept as one exported function so the join has exactly one spelling to be wrong about.
 */
export function sourceItemKey(name: string): string {
  return itemBaseName(name).toLowerCase()
}

/**
 * The PURE builder: catalog rows → `itemKey → sources`. Exported separately from the lazy
 * singleton below so the node test can hand it the real catalog and assert the floors.
 *
 * Sources keep the CATALOG'S OWN ORDER (the wiki's enumeration) rather than being sorted: there
 * is no rarity or drop-rate signal here to rank by, and inventing one (alphabetical, level) would
 * dress an arbitrary pick up as "the best camp". A mob is listed ONCE per key even when its page
 * lists both "Ghoulbane" and "Ghoulbane +1" — those are one item (law 2).
 */
export function buildSourceIndex(mobs: readonly MobEntry[]): Map<string, PlannerSource[]> {
  const index = new Map<string, PlannerSource[]>()
  for (const mob of mobs) {
    if (!mob.drops?.length) continue
    const source: PlannerSource = { mob: mob.name, zones: mob.zones ?? [] }
    if (mob.page) source.mobPage = mob.page
    if (mob.level) source.levelText = mob.level
    for (const drop of mob.drops) {
      const key = sourceItemKey(drop)
      if (key === '') continue
      const list = index.get(key)
      if (!list) index.set(key, [source])
      else if (!list.some((s) => s.mobPage === source.mobPage && s.mob === source.mob)) list.push(source)
    }
  }
  return index
}

/** Built on first use, never at module load. The catalog is immutable, so one build is enough. */
let INDEX: Map<string, PlannerSource[]> | null = null

export function sourceIndex(): SourceIndex {
  INDEX ??= buildSourceIndex(catalog.mobs ?? [])
  return INDEX
}

/**
 * Every known drop source for a donor key, or `[]` — which is an HONEST answer, not a gap: quest
 * rewards and player-crafted items legitimately drop from nobody, and the donor row carries those
 * flags itself. The UI says "no known source" only when the flags are absent too.
 */
export function sourcesFor(key: string): readonly PlannerSource[] {
  return sourceIndex().get(key) ?? []
}
