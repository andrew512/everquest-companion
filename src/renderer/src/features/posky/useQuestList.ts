// useQuestList — everything the Quests tab REMEMBERS and DERIVES, in one hook.
//
// PoskyView is a container: it owns the confetti burst, the inventory-reload toast, and the
// layout. The list state — which tab, which classes, the search box, the sort, the three
// hide-toggles, the page cap — plus the filter/sort/pin derivation it feeds all live here, so
// the view can stay a view. The state deliberately lives ABOVE the tab switch (in the hook the
// container calls, not inside the Quests tab's markup) so flipping to Ignored and back does not
// reset the filters you had set up.

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { QuestProgress } from './useProgress'
import { useFavorites } from '../favorites/useFavorites'
import { useQuestFavorites, useQuestIgnored, type QuestFlagSet } from '../favorites/useQuestFlags'
import { DEFAULT_SORT, isSortKey, sortQuests, type SortKey } from './questSort'

export type { SortKey }

export type TabKey = 'quests' | 'ignored'

// How many Accordions to render before the "show more" cap kicks in.
const PAGE = 40

const SELECTED_CLASSES_KEY = 'eq.selectedClasses'
const SORT_KEY = 'eq.questSort'

function loadSelectedClasses(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SELECTED_CLASSES_KEY) ?? '[]')
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

// An order retired from SORT_OPTIONS falls back to the default rather than sorting by nothing.
function loadSort(): SortKey {
  const v = localStorage.getItem(SORT_KEY)
  return isSortKey(v) ? v : DEFAULT_SORT
}

function questHasFavorite(q: QuestProgress, isFavorite: (name: string) => boolean): boolean {
  return q.items.some((it) => isFavorite(it.name))
}

interface QuestSelection {
  quests: QuestProgress[]
  selectedClasses: string[]
  query: string
  sort: SortKey
  hideCompleted: boolean
  hideNoItems: boolean
  favoritesOnly: boolean
  isFavorite: (name: string) => boolean
  isQuestFavorite: (questKey: string) => boolean
}

/** Filter → sort → pin, in that order. Pure, so the useMemo below is the only caller state. */
function selectQuests(sel: QuestSelection): QuestProgress[] {
  const { isFavorite, isQuestFavorite } = sel
  const q = sel.query.trim().toLowerCase()
  let list = sel.quests
  if (sel.selectedClasses.length) list = list.filter((x) => sel.selectedClasses.includes(x.className))
  if (sel.hideCompleted) list = list.filter((x) => !x.completed)
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
  // pin stays what it always was (only while the quest still needs something).
  const rank = (x: QuestProgress): number =>
    isQuestFavorite(x.key) ? 2 : !x.completed && questHasFavorite(x, isFavorite) ? 1 : 0
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
  query: string
  setQuery: (v: string) => void
  sort: SortKey
  setSort: (v: SortKey) => void
  hideCompleted: boolean
  setHideCompleted: (v: boolean) => void
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
   * It has to reset the filters, not merely search: a Sky quest completes by TURN-IN, so the
   * quest a celebration toast links to is by definition a completed one — and "hide completed",
   * a class filter or "favorites only" would each leave the user staring at a list the link
   * promised something in. The search box is set to the quest's name so the reset is visible and
   * undoable rather than mysterious.
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
  const [selectedClasses, setSelectedClasses] = useState<string[]>(loadSelectedClasses)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>(loadSort)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [hideNoItems, setHideNoItems] = useState(true)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  // Accordions are variable-height so we cap+paginate rather than window them; a
  // keystroke never re-renders more than PAGE quests at once.
  const [visibleCount, setVisibleCount] = useState(PAGE)

  // Ignored quests are gone from the main list, its filters and its counts — they exist
  // only under the Ignored tab, where the same button un-ignores them.
  const ignoredKeys = questIgnored.keys
  const [visible, ignored] = useMemo(() => {
    const shown: QuestProgress[] = []
    const hidden: QuestProgress[] = []
    for (const q of quests) (ignoredKeys.has(q.key.toLowerCase()) ? hidden : shown).push(q)
    hidden.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name))
    return [shown, hidden]
  }, [quests, ignoredKeys])

  // Remember the class filter and the sort order across restarts.
  useEffect(() => {
    localStorage.setItem(SELECTED_CLASSES_KEY, JSON.stringify(selectedClasses))
  }, [selectedClasses])

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  // Typing echoes immediately; the (accordion-rebuilding) filter consumes a deferred
  // copy so a keystroke never blocks on re-rendering dozens of Accordions (Task #41).
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(
    () =>
      selectQuests({
        quests: visible,
        selectedClasses,
        query: deferredQuery,
        sort,
        hideCompleted,
        hideNoItems,
        favoritesOnly,
        isFavorite,
        isQuestFavorite: (questKey) => questFavorites.has(questKey)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      visible,
      selectedClasses,
      deferredQuery,
      sort,
      hideCompleted,
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
    query,
    setQuery,
    sort,
    setSort,
    hideCompleted,
    setHideCompleted,
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
      setHideCompleted(false)
      setHideNoItems(false)
      setFavoritesOnly(false)
      setVisibleCount(PAGE)
    }
  }
}
