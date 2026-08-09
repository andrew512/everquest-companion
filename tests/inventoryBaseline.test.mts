// ============================================================================
// JOS-128 — the outputfile is a BASELINE, and the log accumulates from it.
// ============================================================================
//
// THE REPORT (v0.14.0): a user deleted an item in game, hit Reload Inventory, and the
// Companion still said they had it. Their theory was that reload ADDS onto previous counts.
// It does not: `setInventory` replaces the persisted map wholesale, and re-reading the dump
// is idempotent. The real mechanism is that nothing ever RESET. The log-derived count is
// "everything this character has ever looted", it can only go up, and the count source that
// consults both took `max(log, dump)` per item — so the all-time log outvoted the dump that
// no longer listed the item, forever, no matter how many times you reloaded.
//
// OWNER DESIGN (2026-08-09): a dump load is the BASELINE. It resets the model to what the
// dump says, and log-derived loot accumulates from the dump's generation instant forward.
//
// WHAT THIS FILE PINS, in the order the feature is built:
//   1. the parser claims `Outputfile Complete: <file>` and nothing near it;
//   2. the outputFiles module folds those receipts, newest per file;
//   3. the baseline resolves to the LOG's receipt when there is one, the file's mtime when
//      there is not, floored to the second;
//   4. THE ORDERING — loot before the baseline is the dump's business and is ignored, loot
//      after it accumulates — including the reported scenario end to end;
//   5. which storages a baseline actually covered (the JOS-132 spike's finding).
//
// EVERY LOG LINE HERE IS VERBATIM from the owner's real 116 MB log (both `Outputfile
// Complete:` lines and the `usage:` line are quoted exactly as they appear), and the dump is
// the committed `tests/fixtures/Primitive_freeport-Inventory.txt`. The loot LEDGER is
// synthetic, because a ledger is a list of (ts, item) pairs and the thing under test is the
// ordering rule, not the parse — every real-line parse this feature depends on is pinned
// above it.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { OutputFilesModule } from '../src/main/modules/outputFiles'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import {
  floorToSecond,
  isSinceBaseline,
  resolveInventoryBaseline,
  storagesCoveredBy
} from '../src/shared/outputs/baseline'
import { heldCountsFromDump } from '../src/shared/outputs/inventory'
import { computeHeldCounts } from '../src/renderer/src/features/posky/heldCounts'
import { reconcile } from '../src/renderer/src/features/inventory/reconcile'
import type { CountSource, LootEvent } from '../src/shared/types'

// ---------------------------------------------------------------------------
// 1. The line
// ---------------------------------------------------------------------------

/** Both receipts, verbatim — the only two lines of this shape in the owner's whole log. */
const RECEIPT_AUG_01 = '[Sat Aug 01 13:33:38 2026] Outputfile Complete: Primitive_freeport-Inventory.txt'
const RECEIPT_AUG_06 = '[Thu Aug 06 15:39:12 2026] Outputfile Complete: Primitive_freeport-Inventory.txt'
/** The line the game prints for a MALFORMED command, verbatim. It wrote no file. */
const USAGE_LINE =
  '[Sat Aug 01 13:33:38 2026] usage: /outputfile [achievements | faction | guild | guildbank | guildhall | inventory | missingspells | raid | realestate | recipes [argument] | spellbook ] [optional filename]'

test('the export receipt parses, with the file name the game printed', () => {
  const ev = parseEvent(RECEIPT_AUG_06, 1)
  assert.equal(ev?.kind, 'outputFile')
  assert.equal(ev.kind === 'outputFile' ? ev.file : null, 'Primitive_freeport-Inventory.txt')
  // EQ's own clock, the same parse every loot row's ts goes through.
  assert.equal(ev.ts, new Date(2026, 7, 6, 15, 39, 12).getTime())
})

test('the usage line is not a receipt, and a chat line quoting one cannot become one', () => {
  assert.notEqual(parseEvent(USAGE_LINE, 1)?.kind, 'outputFile')
  // The classifier is anchored at the start of the MESSAGE, so a speaker's name is in the way.
  const chat =
    "[Thu Aug 06 15:39:12 2026] Someone tells you, 'Outputfile Complete: Primitive_freeport-Inventory.txt'"
  assert.notEqual(parseEvent(chat, 1)?.kind, 'outputFile')
})

// ---------------------------------------------------------------------------
// 2. The module that remembers them
// ---------------------------------------------------------------------------

function foldReceipts(lines: readonly string[]): OutputFilesModule {
  const mod = new OutputFilesModule()
  lines.forEach((line, i) => {
    const ev = parseEvent(line, i + 1)
    if (ev) mod.onEvent(ev, false)
  })
  return mod
}

test('the outputFiles module keeps the NEWEST write of each dump', () => {
  const mod = foldReceipts([RECEIPT_AUG_01, RECEIPT_AUG_06])
  assert.equal(
    mod.writtenAt('Primitive_freeport-Inventory.txt'),
    new Date(2026, 7, 6, 15, 39, 12).getTime()
  )
  // A superseded export must never answer for the file now on disk.
  assert.notEqual(mod.writtenAt('Primitive_freeport-Inventory.txt'), new Date(2026, 7, 1, 13, 33, 38).getTime())
  assert.equal(mod.writtenAt('SomeoneElse_freeport-Inventory.txt'), null)
})

test('the lookup takes a full path, and is case-insensitive like the filesystem', () => {
  const mod = foldReceipts([RECEIPT_AUG_06])
  const full = 'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends\\Primitive_freeport-Inventory.txt'
  assert.equal(mod.writtenAt(full), new Date(2026, 7, 6, 15, 39, 12).getTime())
  assert.equal(mod.writtenAt('primitive_FREEPORT-inventory.TXT'), new Date(2026, 7, 6, 15, 39, 12).getTime())
})

test('a character switch clears the receipts, so one log never answers for another', () => {
  const mod = foldReceipts([RECEIPT_AUG_06])
  mod.reset()
  assert.equal(mod.writtenAt('Primitive_freeport-Inventory.txt'), null)
})

// ---------------------------------------------------------------------------
// 3. Which source answers "when was this generated"
// ---------------------------------------------------------------------------

const DUMP_PATH = 'C:\\EQ\\Primitive_freeport-Inventory.txt'
/** The real dump's real mtime on the owner's machine: 767 ms after the log receipt. */
const REAL_MTIME_ISO = new Date(new Date(2026, 7, 6, 15, 39, 12).getTime() + 767).toISOString()

test('the LOG receipt wins over mtime, and both floor to the second', () => {
  const mod = foldReceipts([RECEIPT_AUG_06])
  const b = resolveInventoryBaseline(DUMP_PATH, REAL_MTIME_ISO, (f) => mod.writtenAt(f))
  assert.deepEqual(b, { ts: new Date(2026, 7, 6, 15, 39, 12).getTime(), source: 'log' })
})

test('with no receipt for this file, mtime answers and says so', () => {
  const b = resolveInventoryBaseline(DUMP_PATH, REAL_MTIME_ISO, () => null)
  // Floored: the 767 ms of mtime precision EQ log timestamps do not have is dropped, so both
  // sources land on the same instant for the same dump (measured, owner machine 2026-08-09).
  assert.deepEqual(b, { ts: new Date(2026, 7, 6, 15, 39, 12).getTime(), source: 'mtime' })
})

test('an unparseable mtime with no receipt yields no baseline, rather than a guessed one', () => {
  assert.equal(resolveInventoryBaseline(DUMP_PATH, 'not a date', () => null), null)
})

// ---------------------------------------------------------------------------
// 4. THE ORDERING — baseline, then accumulate
// ---------------------------------------------------------------------------

const BASELINE = floorToSecond(new Date(2026, 7, 6, 15, 39, 12).getTime())

function loot(item: string, ts: number, count = 1): LootEvent {
  return { ts, item, source: 'a mob', count }
}

test('the second the dump was written belongs to the DUMP, not to the accumulation', () => {
  // Second resolution is all EQ gives us. An item looted in the same second is already in the
  // dump, so counting it again would re-create the over-count this ticket exists to remove.
  assert.equal(isSinceBaseline(BASELINE - 1000, BASELINE), false, 'a second earlier: the dump has it')
  assert.equal(isSinceBaseline(BASELINE, BASELINE), false, 'the same second: the dump has it')
  assert.equal(isSinceBaseline(BASELINE + 999, BASELINE), false, 'still the same second')
  assert.equal(isSinceBaseline(BASELINE + 1000, BASELINE), true, 'the next second accumulates')
})

test('nothing accumulates when there is no baseline at all', () => {
  assert.equal(isSinceBaseline(BASELINE + 60_000, undefined), false)
})

test('the fold since the baseline drops earlier loot and keeps later loot', () => {
  const ledger: LootEvent[] = [
    loot('Sphinx Claw', BASELINE - 3600_000),
    loot('Bone Chips', BASELINE + 10_000, 2),
    loot('Sphinx Claw', BASELINE + 20_000)
  ]
  assert.deepEqual(computeHeldCounts(ledger), { 'sphinx claw': 2, 'bone chips': 2 })
  assert.deepEqual(computeHeldCounts(ledger, BASELINE), { 'bone chips': 2, 'sphinx claw': 1 })
})

/** The reconcile the views run, with no quests consuming anything. */
function netFor(
  ledger: LootEvent[],
  inv: Record<string, number>,
  countSource: CountSource,
  baselineTs?: number
): Record<string, number> {
  return reconcile({
    log: computeHeldCounts(ledger),
    inv,
    ...(baselineTs === undefined ? {} : { logSince: computeHeldCounts(ledger, baselineTs) }),
    lootNames: {},
    countSource,
    turnIns: {},
    quests: []
  }).net
}

test('THE REPORT: an item deleted in game is gone after a reload', () => {
  // Looted long before the dump, then destroyed in game. The regenerated dump does not list
  // it; a Wind Rune looted after the dump does not exist in the dump either, and must survive.
  const ledger = [loot('Sphinx Claw', BASELINE - 86_400_000), loot('Wind Rune', BASELINE + 30_000)]
  const dumpSaysOnly = { 'shield of the stalwart seas': 1 }

  for (const source of ['inventory', 'both'] as const) {
    const net = netFor(ledger, dumpSaysOnly, source, BASELINE)
    assert.equal(net['sphinx claw'] ?? 0, 0, `${source}: the deleted item is gone`)
    assert.equal(net['wind rune'], 1, `${source}: loot since the dump still counts`)
    assert.equal(net['shield of the stalwart seas'], 1, `${source}: the dump is the baseline`)
  }
})

test('...and that is exactly what the pre-JOS-128 behavior could not do', () => {
  // The same inputs with NO baseline: 'both' falls back to max(log, dump) and re-asserts the
  // deleted item on every reload. Pinned as the regression, not as a supported mode.
  const ledger = [loot('Sphinx Claw', BASELINE - 86_400_000)]
  assert.equal(netFor(ledger, {}, 'both')['sphinx claw'], 1)
  assert.equal(netFor(ledger, {}, 'both', BASELINE)['sphinx claw'] ?? 0, 0)
})

test("'log' is untouched: ever-looted is what it says, and it never consults a dump", () => {
  const ledger = [loot('Sphinx Claw', BASELINE - 86_400_000), loot('Wind Rune', BASELINE + 30_000)]
  const net = netFor(ledger, { 'shield of the stalwart seas': 1 }, 'log', BASELINE)
  assert.equal(net['sphinx claw'], 1)
  assert.equal(net['wind rune'], 1)
  assert.equal(net['shield of the stalwart seas'] ?? 0, 0)
})

test('the accumulation ADDS to the dump rather than maxing against it', () => {
  // Three held at dump time, two more looted since: five. A maximum would have said three.
  const ledger = [loot('Bone Chips', BASELINE + 5_000, 2)]
  assert.equal(netFor(ledger, { 'bone chips': 3 }, 'inventory', BASELINE)['bone chips'], 5)
})

// ---------------------------------------------------------------------------
// 5. What the baseline COVERED (JOS-132 spike: absence is unknown, not empty)
// ---------------------------------------------------------------------------

const REAL_DUMP = readFileSync(
  join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'),
  'utf8'
)

test('the committed dump evidences all six storages', () => {
  const covered = storagesCoveredBy(parseInventoryDump(REAL_DUMP))
  assert.deepEqual(covered, ['equip', 'general', 'bank', 'sharedBank', 'personalDepot', 'keyRing'])
  // Coverage and counts describe ONE file: the same parse feeds both.
  assert.ok(Object.keys(heldCountsFromDump(parseInventoryDump(REAL_DUMP))).length > 50)
})

test('A STORAGE MISSING FROM A DUMP IS UNKNOWN, NOT EMPTY', () => {
  // The spike's finding, and it is MEASURED here rather than argued: two captures of the SAME
  // character's inventory disagree about whether the depot exists at all. The committed
  // fixture carries one `Personal-Depot` row; the owner's current on-disk dump (Thu Aug 06
  // 15:39:12 2026, the receipt above) carries ZERO, with the same parser reading both. Nothing
  // in either file says which is a real "no depot" and which is a window that was not open.
  //
  // Only the fixture can be asserted (the live dump is not committed), so the second half of
  // the pair is a REAL reporter dump that omits far more: jos66's is equipment and keyring
  // only, with no general, bank, shared bank or depot anywhere. Counting its silence as zeros
  // would say a Bard with a full bank owns nothing.
  const reporter = parseInventoryDump(
    readFileSync(join(import.meta.dirname, 'fixtures', 'jos66-sky-keyring-Inventory.txt'), 'utf8')
  )
  const covered = storagesCoveredBy(reporter)
  assert.equal(covered.includes('bank'), false)
  assert.equal(covered.includes('general'), false)
  assert.equal(covered.includes('personalDepot'), false)
  assert.ok(covered.includes('keyRing'))
})

test('an empty ROW still evidences its storage; an item is not required', () => {
  const dump = parseInventoryDump(
    ['Location\tName\tID\tCount\tSlots', 'Bank1\tEmpty\t0\t0\t0'].join('\n')
  )
  assert.deepEqual(storagesCoveredBy(dump), ['bank'])
})

test('a KeyRing header alone evidences the keyring, even with no rows under it', () => {
  const dump = parseInventoryDump(['KeyRing\tName\tID\t'].join('\n'))
  assert.deepEqual(storagesCoveredBy(dump), ['keyRing'])
})
