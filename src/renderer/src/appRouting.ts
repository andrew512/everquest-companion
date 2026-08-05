// appRouting — the app's DEEP-LINK routers, lifted out of App.tsx (2026-08-04).
//
// They lived beside the component until the loot link pushed that file over the measured
// 400-code-line ceiling, and this is the seam the ceiling was pointing at: App.tsx is a
// COMPOSITION (title bar, nav, content, toasts, dialogs), while these two hooks are the app's
// navigation MODEL — pure state and openers, no JSX, no MUI. Splitting them changed no
// behaviour: every rule below is the one that was written next to the component, verbatim.

import { useCallback, useEffect, useState } from 'react'
import type { View } from './appViews'
import type { CombatFocus } from './features/combat/combatFocus'
import type { MobTarget } from './features/mobs/mobTarget'

/**
 * App-wide DEEP-LINK routing: one detail surface per subject, so the thing that ROUTES to it
 * is app-level. Mobs (Task #64) has three callers — a Raid Targets roster card, the Overview
 * mob card, and the `app:focusView` deep link from the events overlay's con rows; Combat has
 * Overview's DPS card linking down to the fight it is already showing; Loot has the Overview's
 * recent-drops rows, each opening the item it names.
 *
 * The NONCE is the load-bearing part: the destination view keys its effect on it and stays
 * MOUNTED across a link, so asking for the same subject twice arrives twice instead of looking
 * broken. `clear*` is called the moment the payload is applied, so a stale one can't re-fire
 * when you next return to that tab.
 */
export interface AppRouting {
  mobTarget: MobTarget | null
  mobNonce: number
  openMob: (t: MobTarget) => void
  clearMob: () => void
  combatFocus: CombatFocus | null
  combatNonce: number
  openCombat: (f: CombatFocus) => void
  clearCombatFocus: () => void
  /** The item the Loot tab should open its detail pane on, or null for the plain ledger. */
  lootItem: string | null
  lootNonce: number
  /**
   * Bare ⇒ the Loot tab's ledger (the drops card's "All loot" link). With an item ⇒ the DEEP
   * link: the loot view lands on that item's detail pane, breadcrumb and all. ONE opener for
   * both because they are one destination differing only in whether a payload rode along —
   * splitting them would put two names on the same tab switch.
   */
  openLoot: (item?: string) => void
  clearLootFocus: () => void
  /** The Sky quest the PoS tab should expand + scroll to, as a `Class::Name` key, or null. */
  questKey: string | null
  questNonce: number
  /**
   * Bare ⇒ the Plane of Sky tab. With a key ⇒ the DEEP link: the tab reveals that quest (its
   * filters are reset around it), expands its accordion and scrolls it into view. The celebration
   * toast's reward card is the caller (docs/plans/celebration-toasts.md T6, completed here — wave
   * L shipped the tab-level half and flagged the per-quest anchor as the follow-up).
   */
  openQuest: (quest?: string) => void
  clearQuestFocus: () => void
  /** The level the "New at this level" panel should open on, or null for the character's own. */
  levelFocus: number | null
  levelNonce: number
  /**
   * Bare ⇒ the Leveling tab as it stands (Overview's leveling card). With a level ⇒ the level-up
   * toast's deep link: the same tab, with the panel anchored at the level that just dinged
   * (docs/plans/levelup-whats-new.md §2). ONE opener, like `openLoot`: one destination differing
   * only in whether a payload rode along.
   */
  openLeveling: (level?: number) => void
  clearLevelFocus: () => void
}

export function useAppRouting(setView: (v: View) => void): AppRouting {
  const [mobTarget, setMobTarget] = useState<MobTarget | null>(null)
  const [mobNonce, setMobNonce] = useState(0)
  const [combatFocus, setCombatFocus] = useState<CombatFocus | null>(null)
  const [combatNonce, setCombatNonce] = useState(0)
  const [lootItem, setLootItem] = useState<string | null>(null)
  const [lootNonce, setLootNonce] = useState(0)
  const [questKey, setQuestKey] = useState<string | null>(null)
  const [questNonce, setQuestNonce] = useState(0)
  const [levelFocus, setLevelFocus] = useState<number | null>(null)
  const [levelNonce, setLevelNonce] = useState(0)
  // The openers are memoized because one of them is a DEPENDENCY of the mount-only effect that
  // installs the cross-window `app:focusView` listener — a fresh identity each render would
  // tear down and re-register that subscription on every render.
  const openMob = useCallback(
    (t: MobTarget) => {
      setMobTarget(t)
      setMobNonce((n) => n + 1)
      setView('mobs')
    },
    [setView]
  )
  const openCombat = useCallback(
    (f: CombatFocus) => {
      setCombatFocus(f)
      setCombatNonce((n) => n + 1)
      setView('combat')
    },
    [setView]
  )
  const openLoot = useCallback(
    (item?: string) => {
      setLootItem(item ?? null)
      setLootNonce((n) => n + 1)
      setView('loot')
    },
    [setView]
  )
  // Both cross-window deep links (a toast card's click) memoize for the same reason `openMob`
  // does: `applyDeepLink` runs inside the mount-only `app:focusView` subscription effect.
  const openQuest = useCallback(
    (quest?: string) => {
      setQuestKey(quest ?? null)
      setQuestNonce((n) => n + 1)
      setView('posky')
    },
    [setView]
  )
  const openLeveling = useCallback(
    (level?: number) => {
      setLevelFocus(level ?? null)
      setLevelNonce((n) => n + 1)
      setView('leveling')
    },
    [setView]
  )
  return {
    mobTarget,
    mobNonce,
    openMob,
    clearMob: () => setMobTarget(null),
    questKey,
    questNonce,
    openQuest,
    clearQuestFocus: () => setQuestKey(null),
    levelFocus,
    levelNonce,
    openLeveling,
    clearLevelFocus: () => setLevelFocus(null),
    combatFocus,
    combatNonce,
    openCombat,
    clearCombatFocus: () => setCombatFocus(null),
    lootItem,
    lootNonce,
    openLoot,
    clearLootFocus: () => setLootItem(null)
  }
}

/**
 * A deep link INTO a Preferences section. No nonce: PreferencesView is KEYED on the section, so
 * asking for one always lands there — even from Preferences itself. The request is dropped the
 * moment the user leaves the view, so a later plain visit opens on the usual section rather
 * than wherever the last link pointed.
 *
 * Two callers today: the first-run telemetry notice's "Details" link (plan T1, section
 * 'analytics'), and the Alerts tab's route to its spoken-alert settings (section 'voice').
 */
export interface PrefsRouting {
  section: string | null
  openSection: (id: string) => void
}

export function usePrefsRouting(view: View, setView: (v: View) => void): PrefsRouting {
  const [section, setSection] = useState<string | null>(null)
  useEffect(() => {
    if (view !== 'preferences') setSection(null)
  }, [view])
  const openSection = useCallback(
    (id: string) => {
      setSection(id)
      setView('preferences')
    },
    [setView]
  )
  return { section, openSection }
}
