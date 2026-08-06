import { type JSX, useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Snackbar, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { CountSource } from '@shared/types'
import { useProgress, type QuestProgress, type UseProgress } from './useProgress'
import { formatDateTime } from '../../lib/formatDate'
import type { SharedItemsMap } from './sharedItems'
import { QuestIgnoreButton } from '../favorites/QuestFlagButtons'
import { QuestAccordion } from './QuestAccordion'
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
        No ignored quests — hide one with the eye icon on its row and it lands here.
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
            {q.completed && <Chip size="small" color="success" variant="outlined" label="Turned in" />}
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

// The one-line status under the filters. It states which of three situations you are in —
// there is no Sky data at all, there is data but you ignored every quest, or here are the
// counts — and where the "have" numbers came from.
function CountsLine({
  questCount,
  totalQuests,
  filteredCount,
  countSource,
  inventoryInfo
}: {
  questCount: number
  totalQuests: number
  filteredCount: number
  countSource: CountSource
  inventoryInfo: UseProgress['inventoryInfo']
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
        Every quest is ignored — the Ignored tab can bring them back.
      </Typography>
    )
  }
  return (
    <Typography variant="body2" color="text.secondary">
      {filteredCount} of {totalQuests} quests · counting from{' '}
      {countSource === 'log' ? 'looted log' : countSource === 'inventory' ? 'inventory export' : 'log + inventory'}
      {countSource !== 'log' &&
        (inventoryInfo
          ? ` · inventory loaded ${formatDateTime(new Date(inventoryInfo.loadedAt).getTime())}`
          : ' · no inventory loaded yet')}
    </Typography>
  )
}

/** The quest a deep link asked us to open, and the nonce that re-delivers the same ask twice. */
interface QuestAnchor {
  key: string
  nonce: number
}

// The scrolling body: one accordion per quest up to the page cap, then the "show more" button.
function QuestList({
  list,
  sharedItems,
  ambiguousNames,
  anchor,
  setQuestComplete,
  onOpenMob,
  onOpenLoot
}: {
  list: QuestListState
  sharedItems: SharedItemsMap
  ambiguousNames: Set<string>
  /** the anchored quest, or null. Its accordion mounts EXPANDED and scrolls itself into view. */
  anchor: QuestAnchor | null
  setQuestComplete: (key: string, complete: boolean) => Promise<void>
  onOpenMob: (t: MobTarget) => void
  onOpenLoot?: (item: string) => void
}): JSX.Element {
  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
      {list.filtered.slice(0, list.visibleCount).map((q) => (
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
          onSetComplete={(complete) => void setQuestComplete(q.key, complete)}
          onSelectQuest={(name) => list.setQuery(name)}
          onOpenMob={onOpenMob}
          onOpenLoot={onOpenLoot}
        />
      ))}
      {list.filtered.length > list.visibleCount && (
        <Box sx={{ textAlign: 'center', py: 1.5 }}>
          <Button variant="outlined" size="small" onClick={list.showMore}>
            Show more ({list.filtered.length - list.visibleCount} more)
          </Button>
        </Box>
      )}
    </Box>
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
    setQuestComplete,
    inventoryInfo,
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

  return (
    <Stack spacing={2} sx={{ height: '100%', position: 'relative' }}>
      {burst != null && <Confetti key={burst} onDone={() => setBurst(null)} />}
      <Tabs
        value={list.tab}
        onChange={(_e, v: TabKey) => list.setTab(v)}
        sx={{ minHeight: 36, mb: -1, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
      >
        <Tab value="quests" label="Quests" />
        <Tab value="ignored" label={list.ignored.length ? `Ignored (${list.ignored.length})` : 'Ignored'} />
      </Tabs>
      {list.tab === 'ignored' ? (
        <IgnoredList quests={list.ignored} onUnignore={list.questIgnored.toggle} />
      ) : (
        <>
          <QuestFilterBar
            list={list}
            classes={classes}
            countSource={countSource}
            onCountSource={setCountSource}
            onReload={onReload}
          />
          <CountsLine
            questCount={quests.length}
            totalQuests={totalQuests}
            filteredCount={list.filtered.length}
            countSource={countSource}
            inventoryInfo={inventoryInfo}
          />
          <QuestList
            list={list}
            sharedItems={sharedItems}
            ambiguousNames={ambiguousQuestNames}
            anchor={anchor}
            setQuestComplete={setQuestComplete}
            onOpenMob={onOpenMob}
            onOpenLoot={onOpenLoot}
          />
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
