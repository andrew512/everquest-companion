// useLootHistory — the loot module's append-only snapshot, as one hook.
//
// The reducer is three words long and every reader had written its own copy (useRecentDrops,
// MobDropRow, useProgress). JOS-78 added two more readers, so it became a function: a delta
// carries `appended` and the snapshot is a concat, forever.

import type { LootDelta, LootEvent, LootSnap } from '@shared/types'
import { useModule } from '../../lib/useModule'

const applyLootDelta = (s: LootSnap, d: LootDelta): LootSnap => [...s, ...d.appended]

/** Stable empty array: a new `[]` each render would re-run every `useMemo` keyed on the history. */
const NO_LOOT: LootEvent[] = []

/** Every loot event this character has, oldest first. Empty until the snapshot lands. */
export function useLootHistory(): LootEvent[] {
  return useModule<LootSnap, LootDelta>('loot', applyLootDelta) ?? NO_LOOT
}
