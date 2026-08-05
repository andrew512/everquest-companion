// IPC: the EXALTATION PLANNER's door (docs/plans/exaltation-planner.md §4.1, §6).
//
// Two reads over the committed item corpus and one per-character read/write pair. Nothing here
// touches the network, and nothing rejects: the corpus is compiled into this bundle.
//
// LAZY + MEMOIZED. `items.json` is already an ES import in `itemLookup.ts` (electron-vite inlines
// it), so importing the same module here costs no extra bytes — but WALKING it does, so the index
// is built on the first call and kept for the life of the process. An install that never opens
// the Planner never pays for it; one that opens it twice pays once. Same shape as itemLookup's
// module-scope index, just deferred.
//
// The renderer is UNTRUSTED, here as everywhere: the search query must be a string, and a set
// list is re-validated field by field against the closed slot/socket/class allowlists
// (../planner/validate.ts) before a byte of it reaches the store.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { buildPlannerIndex, searchPlannerItems, type PlannerIndex } from '../planner/effectIndex'
import { sanitizeExaltPlans } from '../planner/validate'
import { activeCharId } from '../session'
import { getExaltPlans, setExaltPlans } from '../store'
import type { ItemDbFile } from '../itemsDb'
// The COMMITTED wiki item database — the same module itemLookup.ts imports, so the JSON is
// inlined into the main bundle exactly once.
import itemsJson from '../data/items.json'

let index: PlannerIndex | null = null

/** The donor + item indices, built on first use. */
function plannerIndex(): PlannerIndex {
  index ??= buildPlannerIndex(itemsJson as unknown as ItemDbFile)
  return index
}

export function registerPlannerIpc(): void {
  // Every effect the corpus states, one row per (item, effect). The renderer fetches this once
  // and keeps it — it is derived from committed bytes and cannot change while the app runs.
  ipcMain.handle(IPC.plannerDonors, () => plannerIndex().donors)

  // Host picking: substring over item names, capped. A non-string query is not an error the UI
  // should have to render — it is simply no hits.
  ipcMain.handle(IPC.plannerSearchItems, (_e, query: unknown) =>
    typeof query === 'string' ? searchPlannerItems(plannerIndex().items, query) : []
  )

  // The active character's sets. Both directions run through the same validator (see store.ts).
  ipcMain.handle(IPC.plannerGetPlans, () => getExaltPlans(activeCharId()))
  // Validated AT THE HANDLER (and again in the store, where it is also the READ path's
  // normalizer — sanitizing is a fixed point, so the second pass costs nothing and the store can
  // never be reached by an unvalidated route).
  ipcMain.handle(IPC.plannerSetPlans, (_e, plans: unknown) => {
    setExaltPlans(activeCharId(), sanitizeExaltPlans(plans))
  })
}
