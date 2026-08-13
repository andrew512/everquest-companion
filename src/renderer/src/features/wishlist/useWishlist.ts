// wishlist/useWishlist.ts — the wish list in the renderer: load it, edit it, persist it (JOS-326).
//
// ONE STORAGE TIER, UNLIKE THE TWO PLANNER DOCUMENTS BEFORE IT. `usePlans.ts` and `useGearSets.ts`
// each split their state in two — the document in the electron-store, "which one is selected" in
// `localStorage` — because both were LISTS of documents with a selection. A wish list is ONE
// document per character with nothing to select, so there is no machine-class half at all.
//
// WRITES ARE IMMEDIATE, AND THAT IS A DIFFERENCE FROM BOTH PRECEDENTS RATHER THAN AN OVERSIGHT.
// Those two debounce whole-array saves at 500 ms because their edits include TYPING — a rename is
// one keystroke per character, and writing the array per keystroke would be a round trip per
// letter. Every edit here is a discrete click: add one wish, remove one wish, clear the done
// strip. There is nothing to coalesce, so debouncing would buy nothing and cost the two things it
// costs: a flush-on-unmount to remember, and a window in which the store disagrees with the screen.
//
// …AND THAT CLOSES THE TAB-SWITCH RACE FOR FREE. Exaltations and Wish list are sibling tabs of one
// area and App renders exactly one view, so leaving one unmounts it and entering the other mounts
// a fresh load. With a debounce, the unmount flush and the next mount's read are two invokes in
// flight at once; with an immediate write the write was already sent when the click happened, and
// `ipcRenderer.invoke` is ordered, so the load cannot read a stale document.
//
// NO MODULE-SCOPE CACHE, DELIBERATELY — the `plannerData.ts` corpus cache is NOT the precedent
// here. That cache is legal because its input is committed bytes that cannot change while the app
// runs. A wish list is CHARACTER-SCOPED: App keys every view on the character rebuild counter, so
// a character switch remounts this hook, and a per-mount load is exactly what makes that remount
// mean something. A module cache would serve the previous character's wishes.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_WISHLIST,
  addWish,
  applySeed,
  clearDone,
  removeWish,
  type WishEntry,
  type WishList
} from '@shared/planner/wishlist'

export interface WishlistApi {
  list: WishList
  /** false until the first load settles — a data-availability flag, not an error */
  ready: boolean
  /** add one wish; already-wished items are a no-op (the model dedupes by `itemKey`) */
  add: (entry: WishEntry) => void
  remove: (itemKey: string) => void
  /** dismiss a batch of fulfilled wishes from the done strip, persistently */
  dismiss: (itemKeys: readonly string[]) => void
  /**
   * Run the one-time exaltation-plan seed. Safe to call repeatedly and from a render effect: the
   * flag lives in the document, so a list that has already been seeded comes back identical and
   * nothing is written.
   */
  seed: (seeds: readonly WishEntry[]) => void
}

/**
 * The character's wish list. Mount ONCE per view — two mounts would each hold their own copy of
 * the document and the second write would clobber the first's edits (`usePlans`' rule, same
 * failure, and here it would lose a whole line rather than a keystroke).
 */
export function useWishlist(): WishlistApi {
  const [list, setList] = useState<WishList>(EMPTY_WISHLIST)
  const [ready, setReady] = useState(false)
  // THE DOCUMENT, OUTSIDE REACT'S SCHEDULING. Two things need it: an edit computes the next
  // document from it rather than from inside a state updater (StrictMode double-invokes those, and
  // an IPC write is not a thing to do twice), and the load consults it to see whether a click has
  // already superseded the read that was in flight.
  const latest = useRef<WishList>(EMPTY_WISHLIST)
  const edited = useRef(false)

  useEffect(() => {
    let alive = true
    void window.eq
      .getWishlist()
      .then((loaded) => {
        if (!alive || edited.current) return
        latest.current = loaded
        setList(loaded)
      })
      .catch(() => {
        /* main never rejects; an unreadable store yields an empty wish list, not a crash */
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * ONE WRITE PATH. Every edit is a pure fold over the current document (shared/planner/wishlist.ts
   * owns all four), and a fold that changed nothing returns the SAME OBJECT — so an add of a wish
   * that is already there neither re-renders nor writes.
   */
  const apply = useCallback((edit: (prev: WishList) => WishList) => {
    edited.current = true
    const next = edit(latest.current)
    if (next === latest.current) return
    latest.current = next
    setList(next)
    void window.eq.setWishlist(next)
  }, [])

  const add = useCallback((entry: WishEntry) => {
    apply((prev) => addWish(prev, entry))
  }, [apply])

  const remove = useCallback((itemKey: string) => {
    apply((prev) => removeWish(prev, itemKey))
  }, [apply])

  const dismiss = useCallback((itemKeys: readonly string[]) => {
    apply((prev) => clearDone(prev, itemKeys))
  }, [apply])

  const seed = useCallback((seeds: readonly WishEntry[]) => {
    apply((prev) => applySeed(prev, seeds))
  }, [apply])

  return { list, ready, add, remove, dismiss, seed }
}
