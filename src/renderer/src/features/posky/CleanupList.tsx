// posky/CleanupList.tsx — THE FIFTH SKY TAB (JOS-389): what you could destroy, and what it costs.
//
// The model is `cleanup.ts` and every sentence on a row comes out of it, so this file is layout,
// two controls and the local state that lets a destruction be taken back. What it draws:
//
//   THE CAVEAT, ALWAYS. An `Alert severity="warning"` that cannot be dismissed. That is a
//   deliberate exception to the tooltip-and-caveat diet (AGENTS.md) rather than a lapse: the diet
//   is about defensive source-caveating on screens that state facts, and this screen states
//   ADVICE — the owner asked for the warning in his own words and asked for it to stay up, on the
//   argument that a player who deletes the wrong thing cannot undo it in the game.
//
//   ONE ROW PER ITEM, biggest stack first: the name, how many, where the dump says they are, and
//   then the other half of the decision — every turn-in the item feeds, how many times it has
//   been run, what it pays, and whether the bags are good for another run.
//
//   "I DESTROYED THESE", which is the only way a destruction ever reaches this app. The log adds
//   and never subtracts (report P1EY74, and `reconcile.ts` argues why a dump cannot subtract
//   either), so the button writes a hand-stated count of 0 through the SAME mechanism the quest
//   row's pencil uses (`ItemOverrides.tsx` → `useProgress.setItemOverride`) — one override
//   ledger, per character, that every Sky surface already reads. The row then leaves the list and
//   the quest rows read 0 for that item, and an `Undo` stays beside it until the tab is left.
//
//   THE SOURCE CONTROL AND A REFRESH. `InventorySource` is mounted verbatim from the filter bar,
//   so a stale or absent dump says so here in exactly the words the other tabs use (JOS-268 /
//   JOS-294) — this screen is the one where counting from the wrong witness costs an item. The
//   Sky tab has had no reload affordance since JOS-268 (the app follows the file by itself), so
//   this one is the ticket's own ask: a player about to destroy something wants to be able to
//   re-read the file they just wrote, without taking it on faith that a watcher fired.
//
// NO POPPER except the item card (JOS-143 / JOS-181). The item names mount `SkyItemCard`, which
// is the one wrapper that always passes `clickThrough`; everything else that has something to say
// says it in a native `title`, which has no hit area at all. `tests/tooltipCursor.test.mts` holds
// this file to that.

import { type JSX, useCallback, useMemo, useState } from 'react'
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material'
import type { CountSource } from '@shared/types'
import { InventorySource } from './QuestFilterBar'
import { SkyItemCard } from './SkyItemCard'
import { useCharacterSheet } from '../character/useCharacterSheet'
import { observedTierOf, useItemTiers } from '../../lib/ObservedItemWindow'
import type { SetItemCount } from './ItemOverrides'
import type { QuestProgress } from './useProgress'
import {
  CLEANUP_CAVEAT,
  cleanupRowsFor,
  decisionLine,
  dumpLocationsFrom,
  locationsLine,
  rewardTierLine,
  setsLine,
  timesLine,
  turnInHeading,
  type CleanupRow,
  type CleanupTurnIn,
  type DumpLocations
} from './cleanup'

/** Nothing anywhere claims to know where an item is. Module-scope so it is identity-stable. */
export const NO_DUMP_LOCATIONS: DumpLocations = {}

export interface CleanupListProps {
  quests: QuestProgress[]
  /** the hand-stated count control, the same bundle the quest rows get (JOS-186) */
  setItemCount: SetItemCount
  countSource: CountSource
  onCountSource: (s: CountSource) => void
  inventoryLoadedAt: number | null
  /** re-read the `/outputfile inventory` dump; resolves with what to say about it */
  reloadInventory: () => Promise<string>
}

/** One quest this item feeds, and the case for keeping the item instead of destroying it. */
function TurnInLine({ t, tier }: { t: CleanupTurnIn; tier: number | undefined }): JSX.Element {
  const sets = setsLine(t)
  const owned = rewardTierLine(t.reward, tier)
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      data-testid="posky-cleanup-turnin"
      data-sets={t.sets}
      sx={{ pl: 1.5 }}
    >
      {turnInHeading(t)} · {timesLine(t)}
      {t.reward ? ` · reward: ${t.reward}` : ''}
      {owned ? ` · ${owned}` : ''}
      {' · '}
      <Box component="span" sx={{ color: t.sets >= 1 ? 'warning.main' : 'text.secondary' }}>
        {decisionLine(t)}
        {sets ? `, ${sets}` : ''}
      </Box>
    </Typography>
  )
}

/**
 * One item: the name, the count, where it sits, the button that says it is gone, and the quests
 * it would feed if it is not.
 */
function CleanupItemRow({
  row,
  tierOf,
  onDestroy
}: {
  row: CleanupRow
  tierOf: (reward: string | undefined) => number | undefined
  onDestroy: (row: CleanupRow) => void
}): JSX.Element {
  return (
    <Box data-testid="posky-cleanup-row" data-item={row.name} data-count={row.quantity} sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <SkyItemCard name={row.name}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
            {row.name}
          </Typography>
        </SkyItemCard>
        <Typography variant="body2" data-testid="posky-cleanup-qty">
          x{row.quantity}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="posky-cleanup-where">
          {locationsLine(row.locations)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          variant="outlined"
          color="warning"
          data-testid="posky-cleanup-destroy"
          title="Record that you now hold none of these"
          onClick={() => onDestroy(row)}
        >
          I destroyed these
        </Button>
      </Stack>
      {row.turnIns.map((t) => (
        <TurnInLine key={t.questKey} t={t} tier={tierOf(t.reward)} />
      ))}
      <Divider sx={{ mt: 1 }} />
    </Box>
  )
}

/** What you have just said is gone, and the way back — on screen until you leave the tab. */
function DestroyedStrip({
  rows,
  onUndo
}: {
  rows: readonly { key: string; name: string }[]
  onUndo: (name: string) => void
}): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <Box data-testid="posky-cleanup-destroyed" sx={{ mt: 2, opacity: 0.7 }}>
      <Typography variant="body2" color="text.secondary">
        Recorded as destroyed. The Sky tab counts none of these until a fresh dump or new loot says
        otherwise.
      </Typography>
      {rows.map((r) => (
        <Stack key={r.key} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
          <Typography variant="body2" sx={{ textDecoration: 'line-through' }} data-item={r.name}>
            {r.name}
          </Typography>
          <Button
            size="small"
            data-testid="posky-cleanup-undo"
            title="Take that statement back"
            onClick={() => onUndo(r.name)}
          >
            Undo
          </Button>
        </Stack>
      ))}
    </Box>
  )
}

/** The count source, the freshness line it owns, and the one button this tab adds. */
function CleanupToolbar({
  countSource,
  onCountSource,
  inventoryLoadedAt,
  reloadInventory
}: Omit<CleanupListProps, 'quests' | 'setItemCount'>): JSX.Element {
  const [said, setSaid] = useState<string | null>(null)
  const refresh = useCallback(() => {
    void reloadInventory().then(setSaid)
  }, [reloadInventory])
  return (
    <Stack direction="row" spacing={2} alignItems="center" useFlexGap sx={{ mb: 2.5 }}>
      <Button
        size="small"
        variant="outlined"
        data-testid="posky-cleanup-refresh"
        title="Read the inventory export again"
        onClick={refresh}
      >
        Refresh from inventory
      </Button>
      {said !== null && (
        <Typography variant="caption" color="text.secondary" data-testid="posky-cleanup-refreshed">
          {said}
        </Typography>
      )}
      <Box sx={{ flexGrow: 1 }} />
      <InventorySource
        countSource={countSource}
        onCountSource={onCountSource}
        inventoryLoadedAt={inventoryLoadedAt}
      />
    </Stack>
  )
}

/**
 * THE TAB.
 *
 * The dump's locations are read HERE rather than in `PoskyView` on purpose: they decide nothing
 * about which rows exist (that is the turn-in rule and the held counts alone), so the tab's COUNT
 * can be derived without asking main for the sheet, and a player who never opens Cleanup never
 * pays for the read. `useCharacterSheet` re-asks on every `inventory:autoReloaded`, so the places
 * follow the file exactly like the freshness line above them does.
 */
export default function CleanupList({
  quests,
  setItemCount,
  countSource,
  onCountSource,
  inventoryLoadedAt,
  reloadInventory
}: CleanupListProps): JSX.Element {
  const { sheet } = useCharacterSheet()
  const tiers = useItemTiers()
  const [destroyed, setDestroyed] = useState<{ key: string; name: string }[]>([])

  const locations = useMemo(() => dumpLocationsFrom(sheet?.carry.rows), [sheet])
  const rows = useMemo(() => cleanupRowsFor(quests, locations), [quests, locations])
  const tierOf = useCallback(
    (reward: string | undefined) => (reward ? observedTierOf(tiers, reward) : undefined),
    [tiers]
  )

  const onDestroy = useCallback(
    (row: CleanupRow) => {
      setItemCount(row.name, 0)
      setDestroyed((list) =>
        list.some((r) => r.key === row.key) ? list : [...list, { key: row.key, name: row.name }]
      )
    },
    [setItemCount]
  )
  const onUndo = useCallback(
    (name: string) => {
      setItemCount(name, null)
      setDestroyed((list) => list.filter((r) => r.name !== name))
    },
    [setItemCount]
  )

  return (
    <Box
      data-testid="posky-cleanup"
      sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Alert severity="warning" data-testid="posky-cleanup-caveat" sx={{ mb: 2 }}>
        {CLEANUP_CAVEAT}
      </Alert>
      <CleanupToolbar
        countSource={countSource}
        onCountSource={onCountSource}
        inventoryLoadedAt={inventoryLoadedAt}
        reloadInventory={reloadInventory}
      />
      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <Typography color="text.secondary" data-testid="posky-cleanup-empty">
            Nothing here to destroy - every Sky item you are holding is still wanted by a quest you
            have not turned in.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" data-testid="posky-cleanup-count">
              {rows.length} item{rows.length === 1 ? '' : 's'} no un-turned-in quest still needs.
            </Typography>
            {rows.map((row) => (
              <CleanupItemRow key={row.key} row={row} tierOf={tierOf} onDestroy={onDestroy} />
            ))}
          </>
        )}
        <DestroyedStrip rows={destroyed} onUndo={onUndo} />
      </Box>
    </Box>
  )
}
