import { type JSX, useEffect, useState } from 'react'
import { Box, Button, CssBaseline, Snackbar, Alert, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import ShieldMoonIcon from '@mui/icons-material/ShieldMoon'
import EmojiEventsIcon2 from '@mui/icons-material/EmojiEvents'
import type { AppFocus, CharacterRef } from '@shared/types'
import TitleBar from './components/TitleBar'
import NavDrawer from './components/NavDrawer'
import { VIEW_KEY, loadView, type View } from './appViews'
// The app's navigation MODEL — the deep-link routers and their nonce contract. See appRouting.ts.
import { useAppRouting, usePrefsRouting, type AppRouting, type PrefsRouting } from './appRouting'
import PoskyView from './features/posky/PoskyView'
import LootView from './features/loot/LootView'
import LevelingView from './features/leveling/LevelingView'
import PlannerView from './features/planner/PlannerView'
import BossView from './features/bosses/BossView'
import MobsView from './features/mobs/MobsView'
import MapsView from './features/maps/MapsView'
import CombatView from './features/combat/CombatView'
import OverviewView from './features/overview/OverviewView'
import AlertsView from './features/alerts/AlertsView'
import BuffsView from './features/buffs/BuffsView'
import PreferencesView from './features/preferences/PreferencesView'
import FeedbackDialog from './features/feedback/FeedbackDialog'
// DEV-ONLY. `devTriage` holds the single `DEV_TOOLS ? lazy(() => import(…)) : null`; in a build
// without the flag its only use below is dead code, so rollup drops the import and the entire
// triage feature with it. See devTriage.tsx / devFlags.ts.
import DevTriageView from './devTriage'
import { DEV_TOOLS } from './devFlags'
import { useFeedbackDialog, type FeedbackPrefill } from './features/feedback/useFeedback'
// Usage analytics (docs/plans/usage-analytics.md). The notice is mounted unconditionally and
// renders nothing once it has been answered; `useViewDwell` reports how long each tab was on
// screen. Both are local: the renderer only ever records into main's ring, and main decides —
// behind the consent gates — whether anything is ever sent.
import { TelemetryNotice } from './features/preferences/TelemetryNotice'
import { useViewDwell } from './lib/telemetry'
import AlertPlayer, { fireAppSignal } from './features/alerts/player'
import { getBossData } from './data'
import { useBossKills } from './features/bosses/useBossKills'
import type { TargetStatus } from './features/bosses/bossStatus'
import { useProgress } from './features/posky/useProgress'
import { skyQuestPage } from '@shared/wiki'
import { tierStyle } from './lib/tierChip'

const bossData = getBossData()

/**
 * Fresh-machine empty state: no eqlog_*.txt were found in the (auto-detected or
 * overridden) EQ folder. Quiet + actionable — points the user at Preferences > Game
 * to set the install folder, rather than showing empty/erroring feature views.
 */
function NoLogsEmptyState({ onOpenPreferences }: { onOpenPreferences: () => void }): JSX.Element {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1.5,
        color: 'text.secondary'
      }}
    >
      <TravelExploreIcon sx={{ fontSize: 48, opacity: 0.6 }} />
      <Typography variant="h6" color="text.primary">
        No EverQuest logs found yet
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 440 }}>
        We looked for your EverQuest Legends install automatically but didn&apos;t find any
        character logs. Make sure logging is on in-game (type <code>/log on</code>), or point us
        at your install folder.
      </Typography>
      <Button
        variant="contained"
        startIcon={<SettingsIcon />}
        onClick={onOpenPreferences}
        sx={{ mt: 1 }}
      >
        Open preferences
      </Button>
    </Box>
  )
}

/**
 * The views the router reaches with at most ONE callback — split out of `ViewContent` purely as
 * factoring: the switch is one branch per view, so every view added to the app costs the
 * enclosing function a point of cyclomatic complexity, and the deep-linked views (the ones
 * carrying a nonce'd payload) are the half worth reading. Behaviour is identical: the `key`
 * still lives on each view, so a character rebuild still remounts them.
 *
 * Loot rides here rather than beside Mobs and Combat because its payload is a plain string with
 * no defaults to compose — but it IS a deep link, and it obeys the same nonce contract they do.
 */
function PlainView({
  view,
  viewKey,
  routing,
  onOpenVoicePrefs
}: {
  view: View
  viewKey: string
  routing: AppRouting
  /** CONTRACT with the alerts wave: AlertsView's optional "take me to the voice settings" hook.
   *  Spread rather than named so this tree compiles whether or not that prop exists yet. */
  onOpenVoicePrefs: () => void
}): JSX.Element {
  return (
    <>
      {/* The Loot tab stays MOUNTED across a deep link (no `key` churn on item change) —
          remounting per character rebuild only, exactly like Mobs and Combat. */}
      {view === 'loot' && (
        <LootView
          key={viewKey}
          focusItem={routing.lootItem}
          focusNonce={routing.lootNonce}
          onFocusConsumed={routing.clearLootFocus}
        />
      )}
      {/* Maps remounts per character rebuild like the rest: the zone it auto-opens comes from
          the character module, which re-hydrates under the new character anyway. */}
      {view === 'maps' && <MapsView key={viewKey} />}
      {view === 'leveling' && <LevelingView key={viewKey} />}
      {/* The Planner's SETS need no props: they are character-scoped in the store, so the
          remount `key` is the whole character contract. The one prop it takes is the app's own
          router — every donor name in the pane links OUT to that item's Loot drill-down. */}
      {view === 'planner' && <PlannerView key={viewKey} onOpenLoot={routing.openLoot} />}
      {view === 'buffs' && <BuffsView key={viewKey} />}
      {view === 'alerts' && <AlertsView key={viewKey} {...{ onOpenVoicePrefs }} />}
    </>
  )
}

/** Which feature view is on screen. Preferences renders even with zero characters — it's how
 *  a user fixes the install path, so the fresh-machine empty state must never hide it. */
function ViewContent({
  view,
  hasCharacters,
  viewKey,
  routing,
  onOpenPreferences,
  onOpenLeveling,
  onSendFeedback,
  prefs
}: {
  view: View
  hasCharacters: boolean
  viewKey: string
  routing: AppRouting
  onOpenPreferences: () => void
  /** Preferences' Feedback section opens the app-level dialog, preselecting a type. */
  onSendFeedback: (prefill?: FeedbackPrefill) => void
  /** Overview's leveling card → the Leveling tab. A PLAIN tab switch, so it rides here rather
   *  than in `AppRouting`: that hook is for DEEP links, and its nonce machinery exists to
   *  re-deliver a PAYLOAD. This destination carries none. */
  onOpenLeveling: () => void
  /** Which Preferences section a deep link asked for, and the way to retire that request. */
  prefs: PrefsRouting
}): JSX.Element {
  if (view === 'preferences') {
    return (
      <PreferencesView key={prefs.section ?? 'prefs'} onSendFeedback={onSendFeedback} section={prefs.section} />
    )
  }
  // DEV-ONLY, and ABOVE the no-characters gate on purpose: the triage tab reads the cloud
  // backlog, not the game log, so a machine with no EverQuest install must still reach it.
  if (DEV_TOOLS && view === 'triage') return <DevTriageView />
  if (!hasCharacters) return <NoLogsEmptyState onOpenPreferences={onOpenPreferences} />
  return (
    <>
      <PlainView
        view={view}
        viewKey={viewKey}
        routing={routing}
        onOpenVoicePrefs={() => prefs.openSection('voice')}
      />
      {/* The Mobs tab stays MOUNTED across a deep link (no `key` churn on target
          change) — remounting per character rebuild only, like every other view. */}
      {view === 'mobs' && (
        <MobsView
          key={viewKey}
          target={routing.mobTarget}
          targetNonce={routing.mobNonce}
          onTargetConsumed={routing.clearMob}
        />
      )}
      {view === 'bosses' && <BossView key={viewKey} onOpenMob={routing.openMob} />}
      {/* Sky quest items name the mob that drops them, so the tracker links out to the Mobs
          tab exactly the way the boss roster does — and, since 2026-08-04, out to the LOOT
          drill-down for the item itself (owner: clicking a Sky item you are hovering should
          take you to its item page). It keeps its remount `key`: both deep links run the other
          way (out of posky), so there is no payload to preserve across one. */}
      {view === 'posky' && (
        <PoskyView key={viewKey} onOpenMob={routing.openMob} onOpenLoot={routing.openLoot} />
      )}
      {view === 'overview' && (
        <OverviewView
          key={viewKey}
          onOpenCombat={routing.openCombat}
          onOpenMob={routing.openMob}
          onOpenLoot={routing.openLoot}
          onOpenLeveling={onOpenLeveling}
        />
      )}
      {/* Like Mobs, the Combat tab stays MOUNTED across a deep link — the focus arrives
          through the nonce, not through a remount. */}
      {view === 'combat' && (
        <CombatView
          key={viewKey}
          focus={routing.combatFocus}
          focusNonce={routing.combatNonce}
          onFocusConsumed={routing.clearCombatFocus}
        />
      )}
    </>
  )
}

/** The two app-wide celebration toasts — they fire on ANY tab, so they live at app level. */
function CelebrationToasts({
  defeatToast,
  questToast,
  onDismissDefeat,
  onDismissQuest
}: {
  defeatToast: TargetStatus | null
  questToast: string | null
  onDismissDefeat: () => void
  onDismissQuest: () => void
}): JSX.Element {
  return (
    <>
      <Snackbar
        open={!!defeatToast}
        autoHideDuration={6000}
        onClose={onDismissDefeat}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="success"
          variant="filled"
          icon={<EmojiEventsIcon2 fontSize="inherit" />}
          onClose={onDismissDefeat}
          sx={{ alignItems: 'center' }}
        >
          Raid target defeated: {defeatToast?.target.name}!
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!questToast}
        autoHideDuration={6000}
        onClose={onDismissQuest}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="success"
          variant="filled"
          icon={<ShieldMoonIcon fontSize="inherit" />}
          onClose={onDismissQuest}
          sx={{ alignItems: 'center' }}
        >
          Quest complete: {questToast}
        </Alert>
      </Snackbar>
    </>
  )
}

/**
 * The two ALWAYS-MOUNTED celebration watches, so both fire on any tab.
 *
 * Boss kills: useBossKills gates out the historical baseline. This is the SINGLE
 * always-mounted detector, so it's the one place we fire the 'bossDefeat' app signal for
 * the alerts extension. ONE callback carries both halves — the snackbar and the sound fire
 * on ANY roster kill, repeats included, matching the confetti the Boss tab bursts.
 *
 * It used to be two (Task #24): the sound rode a narrower `onNewDefeat` — first kill at a new
 * instance tier — so the app cheered a repeat kill on screen and said nothing. Retired by the
 * owner 2026-08-04: "every time is worth celebrating." The alert's own cooldown is the rate
 * limit now, and fireAppSignal applies it, so even if the Boss tab's own detector fires in
 * the same instant it can't double-play.
 *
 * Sky turn-ins: useProgress seeds a silent baseline on the first hydrated snapshot, so
 * historical completions on load never fire — only a live turn-in transition does
 * (Task #46). This is the SINGLE always-mounted place we fire the 'questComplete' app
 * signal (sound) + the app-wide snackbar; PoskyView's own useProgress additionally bursts
 * confetti when that tab is open, and the shared cooldown stops a double-play. It is also
 * the ONE place a quest completion is reported into the live event feed (Task #59) — only
 * the renderer can match turn-ins against the posky dataset, so main can't detect this
 * itself. The report carries the QUEST link (the class's Plane of Sky Tests wiki page —
 * there are no per-quest pages) and, when the dataset names one, the reward item for the
 * event overlay's hover card. A quest with no known reward reports none: no fabricated
 * item (law 1).
 */
function useAppCelebrations(
  onDefeat: (s: TargetStatus) => void,
  onQuestComplete: (name: string) => void
): void {
  useBossKills(bossData.targets, {
    onKill: (s) => {
      onDefeat(s)
      fireAppSignal('bossDefeat', s.target.name)
      window.eq.showToast({
        id: `boss:${s.target.name}:${String(s.lastTs)}`,
        kind: 'bossKill',
        title: `${s.target.name} defeated`,
        subtitle: [tierStyle(s.bestTier).long, s.target.zone].filter(Boolean).join(' · ')
      })
    }
  })

  useProgress({
    onQuestComplete: (q) => {
      onQuestComplete(q.name)
      fireAppSignal('questComplete', q.name)
      // The celebration toast (docs/plans/celebration-toasts.md T4) rides the SAME detector as
      // the sound and the snackbar — one live-only gate, three surfaces. The reward is sent by
      // NAME; main resolves the item card, because the overlay fetches nothing.
      window.eq.showToast({
        id: `quest:${q.className}::${q.name}`,
        kind: 'skyQuestComplete',
        title: `Quest complete: ${q.name}`,
        subtitle: q.giver ? `${q.className} · turned in to ${q.giver}` : q.className,
        itemName: q.reward,
        focus: { view: 'posky' }
      })
      window.eq.reportFeedEvent({
        kind: 'quest',
        ts: Date.now(),
        title: q.name,
        detail: q.giver ? `turned in to ${q.giver}` : q.className,
        page: skyQuestPage(q.className),
        reward: q.reward ? { item: q.reward, page: q.rewardPage, stats: q.rewardStats } : undefined
      })
    }
  })
}

/**
 * A DEEP LINK from another window landed (Task #64) — main has already raised + focused us.
 * Two destinations today: the Mobs tab, optionally drilled into a specific mob (a click on the
 * events overlay's con rows), and the Plane of Sky tab (a click on a celebration toast's reward
 * card, docs/plans/celebration-toasts.md T6). The per-quest ANCHOR inside PoS is not wired yet:
 * the tab is the destination, and the payload names no quest.
 *
 * A module-level function rather than an inline closure because App is at its factoring ceiling
 * and this is the branchy part of that effect, not the subscription bookkeeping around it.
 */
function applyDeepLink(
  focus: AppFocus | null,
  setView: (v: View) => void,
  openMob: (t: { mob: string }) => void
): void {
  if (focus?.view === 'posky') {
    setView('posky')
    return
  }
  if (focus?.view !== 'mobs') return
  if (focus.mob) openMob({ mob: focus.mob })
  else setView('mobs')
}

export default function App(): JSX.Element {
  const [view, setView] = useState<View>(loadView)
  const [character, setCharacter] = useState<CharacterRef | null>(null)
  const [characters, setCharacters] = useState<CharacterRef[]>([])
  const [live, setLive] = useState(false)
  // App-wide "raid target defeated" toast — fires on any tab.
  const [defeatToast, setDefeatToast] = useState<TargetStatus | null>(null)
  // App-wide "quest complete" toast — fires on any tab the instant a Sky turn-in
  // auto-completes a quest.
  const [questToast, setQuestToast] = useState<string | null>(null)

  const [rebuild, setRebuild] = useState(0)
  // The feedback dialog's open-state + seed (Task #65). Also picks up a crash parked by the
  // ErrorBoundary's "Report this", which reloads the window to get here.
  const feedback = useFeedbackDialog()

  const routing = useAppRouting(setView)
  const prefsRouting = usePrefsRouting(view, setView)
  const { openMob } = routing

  useAppCelebrations(setDefeatToast, setQuestToast)

  // Remember the selected tab across launches (renderer-only).
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  // How long each tab was on screen, reported ON SWITCH (plan §2). `View` and the schema's
  // `viewDwell` enum are the same set by construction — a tab the schema does not list could
  // not be reported at all.
  useViewDwell(view)

  useEffect(() => {
    void window.eq.getCharacter().then(setCharacter)
    void window.eq.listCharacters().then(setCharacters)
    // Any live module delta means the tail is producing events — light the dot.
    const offDelta = window.eq.onModuleDelta(() => setLive(true))
    // FIX 3: main pushes onCharacter once state is fully rebuilt (startup + switch).
    // Sync the character and bump a rebuild counter so views reliably remount and
    // re-fetch their snapshots against the freshly-rebuilt state.
    const offChar = window.eq.onCharacter((c) => {
      setCharacter(c)
      setLive(false)
      setRebuild((n) => n + 1)
    })
    // The EQ install dir changed (Settings override applied/cleared): re-list the
    // characters so the TitleBar selector reflects the new folder. Main separately
    // pushes onCharacter if the active tail moved.
    const offEqConfig = window.eq.onEqConfigChanged(() => {
      void window.eq.listCharacters().then(setCharacters)
    })
    const offFocus = window.eq.onFocusView((focus) => applyDeepLink(focus, setView, openMob))
    return () => {
      offDelta()
      offChar()
      offEqConfig()
      offFocus()
    }
  }, [openMob])

  const onSelectCharacter = async (logPath: string): Promise<void> => {
    const res = await window.eq.setCharacter(logPath)
    if (res.ok && res.character) {
      setCharacter(res.character)
      setLive(false)
    }
  }

  const viewKey = `${character?.logPath ?? 'none'}#${rebuild}`

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <CssBaseline />

      {/* The single frameless title bar: brand + live dot + character selector +
          window min/max/close buttons. Replaces the OS chrome AND the old AppBar. */}
      <TitleBar
        live={live}
        character={character}
        characters={characters}
        onSelectCharacter={(logPath) => void onSelectCharacter(logPath)}
        onOpenPreferences={() => setView('preferences')}
      />

      {/* Everything below the bar: nav drawer + main content, side by side. */}
      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <NavDrawer view={view} onSelect={setView} onSendFeedback={() => feedback.openFeedback()} />

        <Box
          component="main"
          sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
            <ViewContent
              view={view}
              hasCharacters={characters.length > 0}
              viewKey={viewKey}
              routing={routing}
              prefs={prefsRouting}
              onOpenPreferences={() => setView('preferences')}
              onOpenLeveling={() => setView('leveling')}
              onSendFeedback={feedback.openFeedback}
            />
          </Box>
        </Box>
      </Box>

      {/* Always-mounted: plays fired alert sounds regardless of the active tab. */}
      <AlertPlayer />

      <CelebrationToasts
        defeatToast={defeatToast}
        questToast={questToast}
        onDismissDefeat={() => setDefeatToast(null)}
        onDismissQuest={() => setQuestToast(null)}
      />

      {/* Feedback is a DIALOG, not a view (appViews.ts is untouched), so it is hosted here and
          opened from the nav footer, from Preferences, and by the ErrorBoundary's "Report this"
          (which reloads and lands a prefilled bug — see useFeedbackDialog). */}
      <FeedbackDialog open={feedback.open} onClose={feedback.close} prefill={feedback.prefill} />

      {/* The first-run usage-analytics notice (plan T1) — a slim bottom bar, not a modal.
          Renders nothing once answered — which is every launch after the first — and is the
          ONLY thing that sets `noticeShown`, the flag main's network gate requires. Nothing
          may be transmitted before it has shown. */}
      <TelemetryNotice onOpenDetails={() => prefsRouting.openSection('analytics')} />
    </Box>
  )
}
