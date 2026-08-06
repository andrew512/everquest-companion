// IPC: the CHARACTER SHEET's door (JOS-45) — the armory grid and the gear sum.
//
// GATED. This whole handler is registered only when `UNRELEASED` says so (src/main/unreleased.ts):
// dev builds, or an explicit `EQ_UNRELEASED=1`. In a packaged build the channel simply does not
// exist and `window.eq.characterSheet()` rejects with Electron's own "No handler registered" —
// the same designed outcome the triage bridge has, and the renderer surface is stripped anyway.
//
// It lives in its own file rather than in `character.ts` because that domain is the ACTIVE
// CHARACTER (log tail, EQ dir, progress) and is registered unconditionally. A gate wants its own
// registration site, so "is this feature reachable" is one `if` in one place.
//
// WHY MAIN DOES THE JOIN. `items.json` is 8.6 MB and already inlined in this bundle (itemLookup.ts
// owns the import; ipc/planner.ts imports the same module so it is inlined exactly once). Shipping
// the corpus to the renderer to sum twenty-two items would be absurd, so main reads the dump,
// looks each worn item up, sums the blocks and answers with one small object — the same division
// of labour `planner:inventory` already uses.
//
// NOT CACHED, for the same reason `planner:inventory` is not: the dump is a file the player
// rewrites mid-session on purpose, and a cache would hand the renderer the answer from before
// they typed the command. No dump ⇒ `null`, which is the instructions card, never an error.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  sheetCells,
  sumGear,
  type CharacterSheet,
  type SheetCell,
  type SheetCellView,
  type SheetItemView
} from '../../shared/characterSheet'
import type { ItemStatBlock } from '../../shared/itemStats'
import { loadInventoryDump } from '../outputs'
import { getActiveCharacter } from '../session'
import { buildItemDbIndex, itemKey, type ItemDbEntry, type ItemDbFile } from '../itemsDb'
// The COMMITTED wiki item database — the same module itemLookup.ts imports, so the JSON is
// inlined into the main bundle exactly once.
import itemsJson from '../data/items.json'

let index: Map<string, ItemDbEntry> | null = null

/** The name→record index, built on first use and kept for the process's life (planner precedent). */
function itemIndex(): Map<string, ItemDbEntry> {
  index ??= buildItemDbIndex(itemsJson as unknown as ItemDbFile)
  return index
}

/** One cell's item, joined to the committed DB. A miss is RECORDED, never smoothed over (law 12). */
function joinCell(cell: SheetCell): SheetCellView {
  if (!cell.item) return { ...cell, item: null }
  const record = itemIndex().get(itemKey(cell.item.baseName))
  const item: SheetItemView = { ...cell.item, known: record !== undefined }
  if (record?.iconId !== undefined) item.iconId = record.iconId
  return { ...cell, item }
}

/** The stat block behind a joined cell: `undefined` for an empty cell or an unknown item. */
function blockOf(cell: SheetCellView): ItemStatBlock | undefined {
  if (!cell.item) return undefined
  return itemIndex().get(itemKey(cell.item.baseName))?.stats
}

export function registerCharacterSheetIpc(): void {
  ipcMain.handle(IPC.characterSheet, (): CharacterSheet | null => {
    const character = getActiveCharacter()
    const loaded = loadInventoryDump(character?.name, character?.server)
    if (!loaded) return null

    const { cells, unplaced } = sheetCells(loaded.dump)
    const joined = cells.map(joinCell)
    const joinedUnplaced = unplaced.map(joinCell)
    // Only the cells that hold something feed the sum — an empty slot is not an unknown item.
    const worn = [...joined, ...joinedUnplaced].filter((c) => c.item !== null)

    return {
      path: loaded.path,
      loadedAt: loaded.loadedAt,
      cells: joined,
      unplaced: joinedUnplaced,
      totals: sumGear(worn.map(blockOf))
    }
  })
}
