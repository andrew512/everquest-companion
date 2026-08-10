// ALERT ORDER — the list's own sequence, as data (JOS-175).
//
// THE ORDER IS THE ARRAY, AND IT ALWAYS WAS. `getAlerts()` has always answered with the stored
// array and `AlertList` has always rendered it in that order, so drag-to-reorder needs no rank
// field, no sort key and no migration: it needs a way to WRITE a different array. That is the
// whole feature, and it is why nothing here touches `AlertDef`. A store written by any build that
// shipped before this one already states an order; this file only lets the user restate it.
//
// SCOPE (owner ruling, 2026-08-09): reorder only. No folders, no grouping — the list is one list.
//
// MAIN IS THE AUTHORITY. The renderer sends the id sequence it just rendered, and
// `applyAlertOrder` re-derives the list from MAIN's own copy: ids main does not have are ignored,
// duplicates collapse to their first mention, and defs the sequence never names are KEPT (appended
// in their existing relative order) rather than dropped. A reorder can therefore never delete an
// alert — the worst a stale or hostile sequence can do is move one — which matters because this
// runs on the same door as every other renderer-supplied value (the `sounds:getData` packId rule).
//
// The unnamed tail is appended rather than left at its old index on purpose: the renderer always
// sends the WHOLE list it can see, so a def missing from the sequence is one that arrived after
// the drag began (a share import, another window's save). Putting it at the bottom is a stated,
// reproducible answer; interleaving it back by index would be a guess about where the user would
// have dropped it.

/** The least an entry must be for this file to order it. */
interface Identified {
  readonly id: string
}

/**
 * Re-order `list` to follow `orderedIds`, keeping every entry.
 *
 * Total by construction: unknown ids are skipped, repeats are ignored, and anything the sequence
 * omits keeps its relative order at the end. `applyAlertOrder(list, list.map(a => a.id))` is the
 * identity, which is what makes a no-op drag a no-op write.
 */
export function applyAlertOrder<T extends Identified>(
  list: readonly T[],
  orderedIds: readonly string[]
): T[] {
  const byId = new Map<string, T>()
  for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item)
  const out: T[] = []
  const placed = new Set<string>()
  for (const id of orderedIds) {
    const item = byId.get(id)
    if (item === undefined || placed.has(id)) continue
    placed.add(id)
    out.push(item)
  }
  for (const item of list) if (!placed.has(item.id)) out.push(item)
  return out
}

/**
 * The id sequence produced by dropping `movedId` onto `targetId` — `movedId` takes the target's
 * place and everything between them shifts by one, which is what a sortable list does in either
 * direction.
 *
 * Returns `ids` unchanged (a copy) when either id is absent or they are the same, so a drop on
 * itself and a drop on nothing are both no-ops rather than errors.
 */
export function moveId(ids: readonly string[], movedId: string, targetId: string): string[] {
  const from = ids.indexOf(movedId)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, movedId)
  return next
}

/**
 * The id sequence produced by nudging `movedId` one place up (`delta` -1) or down (+1) — the
 * keyboard half of the same gesture, so the list can be reordered without a pointer at all.
 * A nudge off either end is a no-op.
 */
export function nudgeId(ids: readonly string[], movedId: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(movedId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  return moveId(ids, movedId, ids[to])
}

/** Is `orderedIds` a different sequence from the one `list` already has? */
export function orderChanged(
  list: readonly Identified[],
  orderedIds: readonly string[]
): boolean {
  if (list.length !== orderedIds.length) return true
  return list.some((item, i) => item.id !== orderedIds[i])
}
