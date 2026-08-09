// useQuestList — everything the Quests tab REMEMBERS and DERIVES, in one hook.
//
// PoskyView is a container: it owns the confetti burst, the inventory-reload toast, and the
// layout. The list state — which tab, which classes, the search box, the sort, the three
// hide-toggles, the page cap — plus the filter/sort/pin derivation it feeds all live here, so
// the view can stay a view. The state deliberately lives ABOVE the tab switch (in the hook the
// container calls, not inside the Quests tab's markup) so flipping to Ignored and back does not
// reset the filters you had set up.
//
// SIX of those choices outlive the hook entirely, in localStorage: the class filter, the sort
// order, the two hide-boxes ("hide completed", JOS-90; "hide turned in", JOS-145 — see
// useStoredFlag) and the island/boss facets (JOS-124). Living above the Quests/Ignored switch was
// never enough for them, because leaving the Sky tab for another VIEW unmounts this hook outright.

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { QuestProgress } from './useProgress'
import { useFavorites } from '../favorites/useFavorites'
import { useQuestFavorites, useQuestIgnored, type QuestFlagSet } from '../favorites/useQuestFlags'
import { DEFAULT_SORT, isSortKey, sortQuests, type SortKey } from './questSort'
import { facetOptions, filterByFacets, type FacetOptions } from './questFacets'
// The two readings of "done" this tab offers, and the argument for keeping them apart (JOS-131 for
// has-every-item-now, JOS-145 for has-ever-turned-in). Two lines of code, a page of reasoning, and
// a node test — so they live in their own pure module.
import { everTurnedIn, hasEveryItem } from './questCompletion'

export type { SortKey }

export type TabKey = 'quests' | 'ignored'

// How many Accordions to render before the "show more" cap kicks in.
const PAGE = 40

const SELECTED_CLASSES_KEY = 'eq.selectedClasses'
const SORT_KEY = 'eq.questSort'
const HIDE_COMPLETED_KEY = 'eq.posky.hideCompleted'
const HIDE_TURNED_IN_KEY = 'eq.posky.hideTurnedIn'
const ISLANDS_KEY = 'eq.posky.islands'
const BOSSES_KEY = 'eq.posky.bosses'

/** A stored list of picked names. Anything that is not an array of strings reads as no picks —
 *  a corrupt or hand-edited value degrades to the default rather than throwing the tab away. */
function loadNames(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * State that IS a stored preference: the load is the initialiser, the write is the effect, and
 * the caller cannot get one without the other. The class filter, the island facet and the boss
 * facet are the same promise three times (JOS-90's rule, JOS-124's two new keys), so they are
 * the same nine lines once.
 */
function useStoredNames(key: string): [string[], (v: string[]) => void] {
  const [value, setValue] = useState<string[]>(() => loadNames(key))
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}

/** The sort order, stored. An order retired from SORT_OPTIONS falls back to the default rather
 *  than sorting by nothing. */
function useStoredSort(): [SortKey, (v: SortKey) => void] {
  const [sort, setSort] = useState<SortKey>(() => {
    const v = localStorage.getItem(SORT_KEY)
    return isSortKey(v) ? v : DEFAULT_SORT
  })
  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])
  return [sort, setSort]
}

/**
 * "Hide completed" is a PLACE IN THE GRIND, not a momentary filter (JOS-90). Hiding the quests
 * you are done with is how a user says "show me what is left", and that answer is true until
 * they say otherwise — but the state lived in plain `useState`, and `App`'s `ViewContent` mounts
 * exactly ONE feature view at a time, so every trip to another tab unmounted the hook and handed
 * the list back with completed quests in it. Same storage as the class filter and the sort order
 * two lines up, so it survives the tab switch AND the restart by the same mechanism.
 *
 * '1'/'0' is the one-bit view-pref idiom (features/combat/useCombatPrefs.ts). An ABSENT key is
 * the DEFAULT (false — a fresh install shows everything), never `false` itself: a user who has
 * never touched the box has not un-ticked it.
 *
 * THE BOX AND THE PREF ARE ONE THING — which is the whole reason `revealQuest`'s un-tick (below)
 * persists too rather than being a hidden temporary override. A deep link that reveals a completed
 * quest genuinely leaves the box unticked on screen, and what the user is looking at is what they
 * get back next time; re-ticking it is the same one click that set it.
 *
 * NOT WHITELISTED for share bundles (shared/shareSchema.ts UI_PREF_SPECS), deliberately: a new
 * key is private by default, and where one player is in Sky is not a setting worth exporting.
 * The two JOS-124 facet keys inherit that decision, and so does JOS-145's.
 *
 * JOS-145's "hide turned in" is the SAME nine lines under `eq.posky.hideTurnedIn`, and a SEPARATE
 * key on purpose. One key holding two meanings would either silently change what an existing
 * user's tick does, or need a migration to invent a preference nobody expressed; two independent
 * bits let each box mean only itself, and the default for the new one is the same absent-means-
 * false a fresh install gets for the old one.
 */
function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => localStorage.getItem(key) === '1')
  useEffect(() => {
    localStorage.setItem(key, value ? '1' : '0')
  }, [key, value])
  return [value, setValue]
}

/**
 * The Quests/Ignored split. Ignored quests are gone from the main list, its filters, its facet
 * options and its counts — they exist only under the Ignored tab, where the same button
 * un-ignores them.
 */
function useVisibleQuests(
  quests: QuestProgress[],
  ignoredKeys: ReadonlySet<string>
): [QuestProgress[], QuestProgress[]] {
  return useMemo(() => {
    const shown: QuestProgress[] = []
    const hidden: QuestProgress[] = []
    for (const q of quests) (ignoredKeys.has(q.key.toLowerCase()) ? hidden : shown).push(q)
    hidden.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name))
    return [shown, hidden]
  }, [quests, ignoredKeys])
}

function questHasFavorite(q: QuestProgress, isFavorite: (name: string) => boolean): boolean {
  return q.items.some((it) => isFavorite(it.name))
}


interface QuestSelection {
  quests: QuestProgress[]
  selectedClasses: string[]
  /** the picked islands ("Island 3"), and the picked bosses by catalog name (JOS-124) */
  islands: string[]
  bosses: string[]
  query: string
  sort: SortKey
  hideCompleted: boolean
  hideTurnedIn: boolean
  hideNoItems: boolean
  favoritesOnly: boolean
  isFavorite: (name: string) => boolean
  isQuestFavorite: (questKey: string) => boolean
}

/** Filter → sort → pin, in that order. Pure, so the useMemo below is the only caller state. */
function selectQuests(sel: QuestSelection): QuestProgress[] {
  const { isFavorite, isQuestFavorite } = sel
  const q = sel.query.trim().toLowerCase()
  let list: readonly QuestProgress[] = sel.quests
  if (sel.selectedClasses.length) list = list.filter((x) => sel.selectedClasses.includes(x.className))
  // The island/boss facets, both dimensions in one pass (questFacets.ts owns the semantics).
  list = filterByFacets(list, sel)
  // The two readings of "done", as two independent narrowings applied one after the other, which
  // is what makes them AND (JOS-131 for has-every-item-now, JOS-145 for has-ever-turned-in).
  // Neither reads the other's state, so ticking one can never change what the other does.
  if (sel.hideCompleted) list = list.filter((x) => !hasEveryItem(x))
  if (sel.hideTurnedIn) list = list.filter((x) => !everTurnedIn(x))
  if (sel.hideNoItems) list = list.filter((x) => x.needCount > 0)
  // "Favorites only" = the quest itself is starred OR it needs a starred item.
  if (sel.favoritesOnly)
    list = list.filter((x) => isQuestFavorite(x.key) || questHasFavorite(x, isFavorite))
  if (q) {
    list = list.filter(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        // `?? false` only so the expression is a boolean; a quest with no reward matched
        // nothing here before either.
        (x.reward?.toLowerCase().includes(q) ?? false) ||
        x.items.some((i) => i.name.toLowerCase().includes(q))
    )
  }
  const sorted = sortQuests(list, sel.sort)
  // Pin to the top (stable sort, so ties keep the sort above). A quest the user
  // STARRED outright outranks one that merely contains a favorited item — the star is
  // an explicit "I'm working on this", so it pins even once turned in; the item-level
  // pin stays what it always was (only while the quest still needs something, which since
  // JOS-131 is `hasEveryItem` rather than the turn-in flag).
  const rank = (x: QuestProgress): number =>
    isQuestFavorite(x.key) ? 2 : !hasEveryItem(x) && questHasFavorite(x, isFavorite) ? 1 : 0
  sorted.sort((a, b) => rank(b) - rank(a))
  return sorted
}

export interface QuestListState {
  tab: TabKey
  setTab: (t: TabKey) => void
  /** quests NOT ignored — the list, its filters and its counts all describe this set */
  visible: QuestProgress[]
  /** the ignored ones, class-then-name sorted, for the Ignored tab */
  ignored: QuestProgress[]
  /** `visible` after the filters, the sort and the favorite pinning */
  filtered: QuestProgress[]
  selectedClasses: string[]
  setSelectedClasses: (v: string[]) => void
  /** the picked islands, e.g. ["Island 7"]. Empty is no island filter (JOS-124). */
  islands: string[]
  setIslands: (v: string[]) => void
  /** the picked bosses, by the catalog's own spelling of the name. Empty is no boss filter. */
  bosses: string[]
  setBosses: (v: string[]) => void
  /** what the two facet pickers can offer, derived from the quests on the tab */
  facets: FacetOptions
  query: string
  setQuery: (v: string) => void
  sort: SortKey
  setSort: (v: SortKey) => void
  hideCompleted: boolean
  setHideCompleted: (v: boolean) => void
  /** "Hide quests I have turned in" — has-EVER-turned-in, the other reading (JOS-145). Stored. */
  hideTurnedIn: boolean
  setHideTurnedIn: (v: boolean) => void
  hideNoItems: boolean
  setHideNoItems: (v: boolean) => void
  favoritesOnly: boolean
  setFavoritesOnly: (v: boolean) => void
  visibleCount: number
  showMore: () => void
  isFavorite: (name: string) => boolean
  toggleFavorite: (name: string) => void
  questFavorites: QuestFlagSet
  questIgnored: QuestFlagSet
  /**
   * "Show me THIS quest" — the deep link's half of the per-quest anchor
   * (docs/plans/celebration-toasts.md T6): switch to the Quests tab and clear every filter that
   * could be hiding it, then let PoskyView expand and scroll to it.
   *
   * It has to reset the filters, not merely search: the quest a celebration toast links to has
   * just been handed in, and "hide completed", "hide turned in", a class filter, an island/boss
   * facet or "favorites only" would each leave the user staring at a list the link promised
   * something in. JOS-145's box is the sharpest case of it — the toast fires ON the turn-in that
   * makes the quest match, so the link would hide its own subject every single time — which is
   * why the reset is a list of every filter and not a judgement about which ones matter.
   * The search box is set to the quest's name so the reset is visible and undoable rather than
   * mysterious.
   */
  revealQuest: (name: string) => void
}

export function useQuestList(quests: QuestProgress[]): QuestListState {
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavorites()
  // Quest-level flags (renderer-local localStorage, keyed by the canonical `Class::Name`
  // quest key) — the star the user could not find, and a permanent ignore.
  const questFavorites = useQuestFavorites()
  const questIgnored = useQuestIgnored()
  const [tab, setTab] = useState<TabKey>('quests')
  const [selectedClasses, setSelectedClasses] = useStoredNames(SELECTED_CLASSES_KEY)
  const [islands, setIslands] = useStoredNames(ISLANDS_KEY)
  const [bosses, setBosses] = useStoredNames(BOSSES_KEY)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useStoredSort()
  const [hideCompleted, setHideCompleted] = useStoredFlag(HIDE_COMPLETED_KEY)
  const [hideTurnedIn, setHideTurnedIn] = useStoredFlag(HIDE_TURNED_IN_KEY)
  const [hideNoItems, setHideNoItems] = useState(true)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  // Accordions are variable-height so we cap+paginate rather than window them; a
  // keystroke never re-renders more than PAGE quests at once.
  const [visibleCount, setVisibleCount] = useState(PAGE)

  const [visible, ignored] = useVisibleQuests(quests, questIgnored.keys)

  // What the two facet pickers can offer. Derived from the VISIBLE quests, so an ignored quest
  // takes its island and its boss out of the pickers along with itself.
  const facets = useMemo(() => facetOptions(visible), [visible])

  // Typing echoes immediately; the (accordion-rebuilding) filter consumes a deferred
  // copy so a keystroke never blocks on re-rendering dozens of Accordions (Task #41).
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(
    () =>
      selectQuests({
        quests: visible,
        selectedClasses,
        islands,
        bosses,
        query: deferredQuery,
        sort,
        hideCompleted,
        hideTurnedIn,
        hideNoItems,
        favoritesOnly,
        isFavorite,
        isQuestFavorite: (questKey) => questFavorites.has(questKey)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      visible,
      selectedClasses,
      islands,
      bosses,
      deferredQuery,
      sort,
      hideCompleted,
      hideTurnedIn,
      hideNoItems,
      favoritesOnly,
      favorites,
      questFavorites.keys
    ]
  )

  // Reset the page cap whenever the filtered set changes (a new search shows from top).
  useEffect(() => {
    setVisibleCount(PAGE)
  }, [filtered])

  return {
    tab,
    setTab,
    visible,
    ignored,
    filtered,
    selectedClasses,
    setSelectedClasses,
    islands,
    setIslands,
    bosses,
    setBosses,
    facets,
    query,
    setQuery,
    sort,
    setSort,
    hideCompleted,
    setHideCompleted,
    hideTurnedIn,
    setHideTurnedIn,
    hideNoItems,
    setHideNoItems,
    favoritesOnly,
    setFavoritesOnly,
    visibleCount,
    showMore: () => {
      setVisibleCount((n) => n + PAGE)
    },
    isFavorite,
    toggleFavorite,
    questFavorites,
    questIgnored,
    revealQuest: (name: string) => {
      setTab('quests')
      setQuery(name)
      setSelectedClasses([])
      setIslands([])
      setBosses([])
      setHideCompleted(false)
      setHideTurnedIn(false)
      setHideNoItems(false)
      setFavoritesOnly(false)
      setVisibleCount(PAGE)
    }
  }
}
