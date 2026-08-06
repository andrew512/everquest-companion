// EXALTATION PLANNER — what you are WEARING, joined into the planner's slots (V7).
//
// The Inventory tab fills each cell's host from the character's own `/outputfile inventory` dump,
// and the join between the two vocabularies is a HAND-AUTHORED TABLE (law 12: cross-source
// renames are knowledge, never fuzzy) — `Fingers` vs `FINGER`, `Any Slot` with no wiki counterpart
// at all. A fuzzy matcher here would put a ring on a finger by luck and a two-hander somewhere
// embarrassing by the same luck, so the table is pinned three ways: it is TOTAL over the client's
// closed token set, it maps onto real planner slots only, and it produces the right answer on the
// real 295-line dump.
//
// Same fixture the outputs engine uses (`tests/fixtures/Primitive_freeport-Inventory.txt`, the dev
// character's real dump, committed verbatim). Pure: no Electron, no fs beyond that read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EQUIP_LOCATIONS, walkEntries } from '../src/shared/outputs/inventory'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { SLOT_OF_LOCATION, equippedHosts } from '../src/shared/planner/inventorySlots'
import { EQUIP_SLOTS } from '../src/shared/planner/types'

const REAL_DUMP = readFileSync(
  join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'),
  'utf8'
)
const dump = parseInventoryDump(REAL_DUMP)
const hosts = equippedHosts(dump)

test('the join is TOTAL over the client tokens, and lands only on real planner slots', () => {
  const slots = new Set<string>(EQUIP_SLOTS)
  for (const token of EQUIP_LOCATIONS) {
    assert.ok(token in SLOT_OF_LOCATION, `no decision recorded for the client token ${token}`)
    const slot = SLOT_OF_LOCATION[token]
    if (slot !== null) assert.ok(slots.has(slot), `${token} maps to ${slot}, which is not a planner slot`)
  }
  // The two deliberate nulls, stated so a future edit has to argue with them: `Any Slot` is a real
  // place to wear something that the wiki vocabulary does not have, and `Held` does not say which
  // hand. Neither may be guessed into a slot.
  assert.equal(SLOT_OF_LOCATION['Any Slot'], null)
  assert.equal(SLOT_OF_LOCATION.Held, null)
  assert.equal(SLOT_OF_LOCATION.Fingers, 'FINGER', 'the plural is the whole reason this table exists')
})

test('the real dump yields one host per slot, top-level and non-empty only', () => {
  console.log('planner equipped hosts', hosts.map((h) => `${h.slot}=${h.name}`).join(', '))
  assert.ok(hosts.length > 0, 'the fixture is a real dump — something must be equipped')

  const seen = new Set<string>()
  for (const h of hosts) {
    assert.ok(!seen.has(h.slot), `${h.slot} appears twice — the planner plans one socket set per slot`)
    seen.add(h.slot)
    assert.ok(h.name.length > 0)
    assert.ok(!h.name.endsWith('(Exaltation)'), 'a socketed exaltation is not the item being worn')
    assert.ok(!/ \+\d+$/.test(h.name), 'the merge tier is split off into `tier`, never left in the name')
  }
})

test('duplicated slots take the FIRST row — the file never says which ear is which', () => {
  // Ear / Wrist / Fingers each appear twice at top level in the real dump. There is no left/right
  // column, so the rule is file order, and it must be the FIRST one.
  const firstEar = [...walkEntries(dump.items)].find(
    (e) => e.path.length === 0 && e.place.raw === 'Ear' && !e.empty
  )
  assert.ok(firstEar, 'the fixture is expected to carry an equipped Ear row')
  assert.equal(hosts.find((h) => h.slot === 'EAR')?.name, firstEar.parsedName.base)
})

test('bag contents and exaltation sockets are never mistaken for equipment', () => {
  // Both are `-Slot<n>` children; only top-level rows are worn. A regression here would put a
  // socketed effect (or a stack of bandages) forward as the host item of a slot.
  const children = [...walkEntries(dump.items)].filter((e) => e.path.length > 0 && !e.empty)
  assert.ok(children.length > 0, 'the fixture is expected to carry bag contents and sockets')
  assert.ok(hosts.length < children.length, 'the hosts must be the small top-level set, not the walk')
})

test('the tier rides beside the name: `+N` is stated or it is unknown, never 0', () => {
  for (const h of hosts) {
    if (h.tier === undefined) continue
    assert.ok(Number.isInteger(h.tier) && h.tier > 0, `${h.name} has a nonsense tier ${String(h.tier)}`)
  }
})
