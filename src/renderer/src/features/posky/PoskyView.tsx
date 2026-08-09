import { type JSX, useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Snackbar, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { CountSource } from '@shared/types'
import { useProgress, type QuestProgress } from './useProgress'
// The `/outputfile` freshness line (JOS-44), wired to the registry: this tab's have/need chips
// read the same dump the Exaltations tab does, so they get the same one-line treatment — the
// command, one clause of why, and the FILE's own age (or "not yet run").
import OutputKindLine from '../../components/OutputKindLine'
import type { SharedItemsMap } from './sharedItems'
import { QuestIgnoreButton } from '../favorites/QuestFlagButtons'
import { QuestAccordion } from './QuestAccordion'
import { TurnInBadge } from './TurnInControls'
import QuestFilterBar from './QuestFilterBar'
import { useQuestList, type QuestListState, type TabKey } from './useQuestList'
import type { MobTarget } from '../mobs/mobTarget'
import Confetti from '../../lib/Confetti'

// The Ignored tab: every quest the user hid, in one flat compact list (no accordions —
// there is nothing to work on here), each row carrying the same button that put it here,
// now reading "Stop ignoring". Un-ignoring drops the row instantly and the quest
// reappears under Quests with its favorite state untouched.
function IgnoredList({
  quests,
  onUnignore
}: {
  quests: QuestProgress[]
  onUnignore: (questKey: string) => void
}): JSX.Element {
  if (quests.length === 0) {
    return (
      <Typography color="text.secondary">
        No ignored quests - hide one with the eye icon on its row and it lands here.
      </Typography>
    )
  }
  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {quests.length} quest{quests.length === 1 ? '' : 's'} hidden from the list, filters and counts.
      </Typography>
      <Stack spacing={0.5}>
        {quests.map((q) => (
          <Stack
            key={q.key}
            direction="row"
            spacing={2}
            alignItems="center"
            sx={{ px: 1, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <QuestIgnoreButton ignored onToggle={() => onUnignore(q.key)} />
            <Chip label={q.className} size="small" color="secondary" variant="outlined" sx={{ minWidth: 92 }} />
            <Typography variant="subtitle2" sx={{ minWidth: 220 }}>
              {q.name}
            </Typography>
            {q.reward && (
              <Typography variant="caption" color="primary.main">
                → {q.reward}
              </Typography>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <TurnInBadge count={q.turnIns} />
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

// The one-line status under the filters. It states which of three situations you are in —
// there is no Sky data at all, there is data but you ignored every quest, or here are the
// counts — and which SOURCE the "have" numbers came from.
//
// HOW OLD that source is moved out of here in JOS-44: it is the `/outputfile` registry's line
// (OutputKindLine, right above), which reads the file's own mtime rather than the store's record
// of the last reload — so a dump this app has never loaded still dates itself honestly, and a
// character who has never run the command reads "not yet run" instead of nothing at all.
function CountsLine({
  questCount,
  totalQuests,
  filteredCount,
  countSource
}: {
  questCount: number
  totalQuests: number
  filteredCount: number
  countSource: CountSource
}): JSX.Element {
  if (questCount === 0) {
    return (
      <Alert severity="info">
        No Plane of Sky data available.
      </Alert>
    )
  }
  if (totalQuests === 0) {
    // Data exists, it is all ignored — say so, and point at the tab that undoes it.
    return (
      <Typography color="text.secondary">
        Every quest is ignored - the Ignored tab can bring them back.
      </Typography>
    )
  }
  return (
    // The stable handle for the filter specs: this line is where a narrowing filter becomes
    // VISIBLE, so it is what an e2e reads to prove a facet pick actually removed rows.
    <Typography variant="body2" color="text.secondary" data-testid="posky-counts">
      {filteredCount} of {totalQuests} quests · counting from{' '}
      {countSource === 'log'
        ? 'looted log'
        : countSource === 'inventory'
          ? 'inventory export plus loot since'
          : 'inventory export if any, else the looted log'}
    </Typography>
  )
}

/** The quest a deep link asked us to open, and the nonce that re-delivers the same ask twice. */
interface QuestAnchor {
  key: string
  nonce: number
}

/**
 * Everything it takes to draw a list of quest rows. One interface because the Quests tab and the
 * Ready tab draw the SAME row (JOS-147's requirement) — the only thing that differs between them
 * is which quests go in, so `quests` is a parameter and the rest is shared verbatim.
 */
interface QuestListProps {
  /** the rows to draw, already filtered and ordered by the caller */
  quests: QuestProgress[]
  list: QuestListState
  sharedItems: SharedItemsMap
  ambiguousNames: Set<string>
  /** the anchored quest, or null. Its accordion mounts EXPANDED and scrolls itself into view. */
  anchor: QuestAnchor | null
  recordTurnIn: (key: string) => Promise<void>
  undoTurnIn: (key: string) => Promise<void>
  onOpenMob: (t: MobTarget) => void
  onOpenLoot?: (item: string) => void
}

// The scrolling body: one accordion per quest up to the page cap, then the "show more" button.
function QuestList({
  quests,
  list,
  sharedItems,
  ambiguousNames,
  anchor,
  recordTurnIn,
  undoTurnIn,
  onOpenMob,
  onOpenLoot
}: QuestListProps): JSX.Element {
  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
      {quests.slice(0, list.visibleCount).map((q) => (
        <QuestAccordion
          // The NONCE rides the key for the anchored quest alone: the accordion is uncontrolled
          // (each one opens and closes independently, and lifting that into one "which is open"
          // state would silently make the list single-open), so a remount is what lets a SECOND
          // link to the same quest re-open and re-scroll it.
          key={anchor?.key === q.key ? `${q.key}#${String(anchor.nonce)}` : q.key}
          anchored={anchor?.key === q.key}
          q={q}
          shared={sharedItems.get(q.key) ?? []}
          ambiguousNames={ambiguousNames}
          favorited={list.questFavorites.has(q.key)}
          onToggleFavorite={() => list.questFavorites.toggle(q.key)}
          onToggleIgnore={() => list.questIgnored.toggle(q.key)}
          isFavorite={list.isFavorite}
          toggleFavorite={list.toggleFavorite}
          onRecordTurnIn={() => void recordTurnIn(q.key)}
          onUndoTurnIn={() => void undoTurnIn(q.key)}
          onSelectQuest={(name) => list.setQuery(name)}
          onOpenMob={onOpenMob}
          onOpenLoot={onOpenLoot}
        />
      ))}
      {quests.length > list.visibleCount && (
        <Box sx={{ textAlign: 'center', py: 1.5 }}>
          <Button variant="outlined" size="small" onClick={list.showMore}>
            Show more ({quests.length - list.visibleCount} more)
          </Button>
        </Box>
      )}
    </Box>
  )
}

/**
 * The Ready tab (JOS-147): what you can hand in RIGHT NOW, in the order you would walk it if the
 * data said where the givers stood (it does not - see questCompletion.readyQuests).
 *
 * Same rows as the main list, deliberately: this is the same quest, so it gets the same star, the
 * same ignore button, the same item chips and the same expandable panel with the turn-in counter
 * in it. A second, thinner row rendering would be a second thing to keep in step with the first.
 *
 * The set itself is `list.ready`, which no filter and neither hide-box can reach. The tab draws no
 * filter bar for the same reason the Ignored tab draws none: there is nothing to narrow here, the
 * list IS the answer.
 */
function ReadyList(props: QuestListProps): JSX.Element {
  const n = props.quests.length
  return (
    <Box
      data-testid="posky-ready"
      sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {n === 0 ? (
        <Typography color="text.secondary">
          Nothing is ready to turn in - a quest lands here the moment you are holding every item it
          needs, and leaves when you hand them over.
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} data-testid="posky-ready-count">
            {n} quest{n === 1 ? '' : 's'} you are holding every item for.
          </Typography>
          <QuestList {...props} />
        </>
      )}
    </Box>
  )
}

/**
 * The three tabs, in the order the work happens: what you are farming, what you can hand in, what
 * you told the app to forget. Each of the last two carries its own count, because the number IS
 * the reason to look.
 */
function PoskyTabs({ list }: { list: QuestListState }): JSX.Element {
  return (
    <Tabs
      value={list.tab}
      onChange={(_e, v: TabKey) => list.setTab(v)}
      sx={{ minHeight: 36, mb: -1, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
    >
      <Tab value="quests" label="Quests" data-testid="posky-tab-quests" />
      {/* "Ready" - the shortest true name for it, and the same word the row's own chip already
          uses ("Ready to turn in"). Anything longer would be a sentence on a tab. */}
      <Tab
        value="ready"
        label={list.ready.length ? `Ready (${list.ready.length})` : 'Ready'}
        data-testid="posky-tab-ready"
      />
      <Tab
        value="ignored"
        label={list.ignored.length ? `Ignored (${list.ignored.length})` : 'Ignored'}
        data-testid="posky-tab-ignored"
      />
    </Tabs>
  )
}

/**
 * Resolve a deep link's quest KEY against the loaded quests and reveal it.
 *
 * TWO STEPS, because the ask can land before the data does: the toast fires the instant a turn-in
 * is observed, and this tab's dataset + progress arrive asynchronously. So the request is HELD
 * (`pending`) until a quest with that key exists, then the filters are reset around it and the
 * anchor is published for the list to expand + scroll. A key that never resolves simply never
 * anchors — the tab still opened, which is the honest partial answer.
 */
function useQuestAnchor(
  quests: QuestProgress[],
  list: QuestListState,
  focus: { quest: string | null; nonce: number; onConsumed?: () => void }
): QuestAnchor | null {
  const [pending, setPending] = useState<QuestAnchor | null>(null)
  const [anchor, setAnchor] = useState<QuestAnchor | null>(null)
  const { quest, nonce, onConsumed } = focus

  useEffect(() => {
    if (!quest) return
    setPending({ key: quest, nonce })
    onConsumed?.()
    // The NONCE is the trigger, by the standing contract: the same quest asked for twice must
    // arrive twice, and the payload is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  useEffect(() => {
    if (!pending) return
    const match = quests.find((q) => q.key.toLowerCase() === pending.key.toLowerCase())
    if (!match) return
    list.revealQuest(match.name)
    setAnchor({ key: match.key, nonce: pending.nonce })
    setPending(null)
    // `list` is rebuilt every render (it is a hook result, not a value); depending on it would
    // re-run this on every keystroke. The quests and the pending ask are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, quests])

  return anchor
}

export default function PoskyView({
  onOpenMob,
  onOpenLoot,
  focusQuest = null,
  focusNonce = 0,
  onFocusConsumed
}: {
  onOpenMob: (t: MobTarget) => void
  /** an item name → the Loot tab's drill-down (App's `openLoot`); optional so the pane stands alone */
  onOpenLoot?: (item: string) => void
  /** a celebration toast's per-quest anchor: the canonical `Class::Name` key, or null for the tab */
  focusQuest?: string | null
  /** bumps per link (appRouting's nonce contract) so the same quest can be asked for twice */
  focusNonce?: number
  onFocusConsumed?: () => void
}): JSX.Element {
  // A quest completing via a LIVE turn-in bursts confetti over this view (mirrors
  // BossView's onKill confetti, Task #46). useProgress gates out the historical
  // baseline, so this only fires for a real turn-in observed while the app is open.
  const [burst, setBurst] = useState<number | null>(null)
  const onQuestComplete = useCallback(() => {
    setBurst((n) => (n ?? 0) + 1)
  }, [])

  const {
    quests,
    classes,
    countSource,
    setCountSource,
    reloadInventory,
    recordTurnIn,
    undoTurnIn,
    sharedItems,
    ambiguousQuestNames
  } = useProgress({ onQuestComplete })
  const list = useQuestList(quests)
  const anchor = useQuestAnchor(quests, list, {
    quest: focusQuest,
    nonce: focusNonce,
    onConsumed: onFocusConsumed
  })
  const [toast, setToast] = useState<string | null>(null)

  const onReload = async (): Promise<void> => setToast(await reloadInventory())

  // Counts describe the list you are looking at, so ignored quests are not in them.
  const totalQuests = list.visible.length

  // Everything a quest ROW needs except which quests to draw. Both tabs that draw rows pass the
  // identical bundle, which is what "same row rendering" means in code rather than in prose.
  const rows: Omit<QuestListProps, 'quests'> = {
    list,
    sharedItems,
    ambiguousNames: ambiguousQuestNames,
    anchor,
    recordTurnIn,
    undoTurnIn,
    onOpenMob,
    onOpenLoot
  }

  return (
    <Stack spacing={2} sx={{ height: '100%', position: 'relative' }}>
      {burst != null && <Confetti key={burst} onDone={() => setBurst(null)} />}
      <PoskyTabs list={list} />
      {list.tab === 'ignored' ? (
        <IgnoredList quests={list.ignored} onUnignore={list.questIgnored.toggle} />
      ) : list.tab === 'ready' ? (
        <ReadyList quests={list.ready} {...rows} />
      ) : (
        <>
          <QuestFilterBar
            list={list}
            classes={classes}
            countSource={countSource}
            onCountSource={setCountSource}
            onReload={onReload}
          />
          {/* Only when the dump actually feeds the numbers: counting from the looted log alone
              means this tab does not read the export at all, and a freshness line about a file
              nothing on screen depends on is the caveat this diet exists to refuse. */}
          {countSource !== 'log' && (
            <OutputKindLine kind="inventory" testId="posky-inventory-fresh" />
          )}
          <CountsLine
            questCount={quests.length}
            totalQuests={totalQuests}
            filteredCount={list.filtered.length}
            countSource={countSource}
          />
          <QuestList quests={list.filtered} {...rows} />
        </>
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  )
}
