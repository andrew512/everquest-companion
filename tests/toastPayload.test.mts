// The celebration toast's PAYLOAD contract (docs/plans/celebration-toasts.md §2).
//
// `toast:show` is a renderer→main channel, so its argument is re-validated at the handler like
// every other renderer-supplied string in this app — never trusted because today's only caller
// is the app's own detectors. What is pinned here is what that validator PROMISES the rest of
// the pipeline: a closed kind, a closed focus view, capped text, no stray properties, and a
// null (not a throw, not a half-built object) when the request cannot be honoured.
//
// Plus the item card's pre-formatting, which is the other half of "the overlay fetches
// nothing": the exact lines a Sky reward prints are decided HERE, in main, and pinned here.
//
// Pure — no Electron, no fixtures, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOAST_CONFIG,
  TOAST_MAX_DURATION_MS,
  TOAST_MAX_LINES,
  TOAST_MAX_TEXT,
  normalizeToastConfig,
  toastItemCard,
  validateToastRequest
} from '../src/shared/toast'
import { parseStatsBlock } from '../src/shared/itemStats'
import type { ItemKnowledge } from '../src/shared/types'

const boss = {
  id: 'boss:Lord Nagafen:1',
  kind: 'bossKill',
  title: 'Lord Nagafen defeated',
  subtitle: 'D2 · Adaptive · Nagafen’s Lair'
}

test('a well-formed boss request survives verbatim', () => {
  const out = validateToastRequest(boss)
  assert.deepEqual(out, boss)
})

test('a request with no id, no title or an unknown kind is REFUSED (null, never partial)', () => {
  assert.equal(validateToastRequest({ ...boss, id: '' }), null)
  assert.equal(validateToastRequest({ ...boss, title: '   ' }), null)
  assert.equal(validateToastRequest({ ...boss, kind: 'lootDrop' }), null)
  assert.equal(validateToastRequest({ ...boss, kind: 42 }), null)
  assert.equal(validateToastRequest(null), null)
  assert.equal(validateToastRequest('boss killed'), null)
  assert.equal(validateToastRequest([boss]), null)
})

test('unknown properties are STRIPPED, not passed through to a window that draws them', () => {
  const out = validateToastRequest({
    ...boss,
    html: '<img src=x onerror=alert(1)>',
    item: { name: 'forged', lines: ['fake'] },
    focus: { view: 'mobs', mob: 'Lord Nagafen' }
  })
  assert.ok(out)
  assert.deepEqual(Object.keys(out).sort(), ['focus', 'id', 'kind', 'subtitle', 'title'])
  // `item` in particular: the CARD is main's to resolve (T5). A renderer-supplied one would be
  // an unvalidated block of text rendered in an always-on-top window.
  assert.equal('item' in out, false)
})

test('text is capped, so no payload can push the card off the screen', () => {
  const out = validateToastRequest({ ...boss, title: 'x'.repeat(5000), subtitle: 'y'.repeat(5000) })
  assert.ok(out)
  assert.equal(out.title.length, TOAST_MAX_TEXT)
  assert.equal(out.subtitle?.length, TOAST_MAX_TEXT)
})

test('focus is a CLOSED union — an unlisted view is dropped, not forwarded', () => {
  assert.equal(validateToastRequest({ ...boss, focus: { view: 'triage' } })?.focus, undefined)
  assert.equal(validateToastRequest({ ...boss, focus: 'posky' })?.focus, undefined)
  assert.deepEqual(validateToastRequest({ ...boss, focus: { view: 'posky' } })?.focus, { view: 'posky' })
  assert.deepEqual(validateToastRequest({ ...boss, focus: { view: 'mobs', mob: 'a bat' } })?.focus, {
    view: 'mobs',
    mob: 'a bat'
  })
})

test('duration is clamped into a sane window (and a bad one falls back to the config’s)', () => {
  assert.equal(validateToastRequest({ ...boss, durationMs: 9_000_000 })?.durationMs, TOAST_MAX_DURATION_MS)
  assert.equal(validateToastRequest({ ...boss, durationMs: 1 })?.durationMs, 1000)
  assert.equal(validateToastRequest({ ...boss, durationMs: -5 })?.durationMs, undefined)
  assert.equal(validateToastRequest({ ...boss, durationMs: 'long' })?.durationMs, undefined)
})

test('a Sky request carries the reward by NAME — main resolves the card', () => {
  const out = validateToastRequest({
    id: 'quest:Paladin::Test of Sacrifice',
    kind: 'skyQuestComplete',
    title: 'Quest complete: Test of Sacrifice',
    itemName: 'Shining Metallic Robes',
    focus: { view: 'posky' }
  })
  assert.equal(out?.itemName, 'Shining Metallic Robes')
})

// ---- the embedded item card -----------------------------------------------------------

/** A real-shaped stat block (the sample set in shared/itemStats.ts's header). */
const RING = `Djarn's Amethyst Ring
---------------------
MAGIC ITEM  LORE ITEM
Slot: FINGER
AGI: +9  HP: +80
WT: 0.1  Size: TINY
Class: ALL
Race: ALL`

function knowledge(over: Partial<ItemKnowledge> = {}): ItemKnowledge {
  return {
    name: "Djarn's Amethyst Ring",
    lore: true,
    quest: false,
    questUses: [],
    cached: true,
    statsBlock: RING,
    stats: parseStatsBlock(RING),
    iconId: 1234,
    ...over
  }
}

test('the reward card is pre-formatted: flags+slot, then the numbers, capped', () => {
  const card = toastItemCard(knowledge())
  assert.equal(card.name, "Djarn's Amethyst Ring")
  assert.equal(card.iconId, 1234)
  assert.ok(card.lines.length > 0 && card.lines.length <= TOAST_MAX_LINES)
  assert.match(card.lines[0], /Magic Item|MAGIC ITEM/i)
  assert.match(card.lines[0], /Slot: FINGER/)
  assert.ok(
    card.lines.some((l) => l.includes('AGI') && l.includes('HP')),
    `the attribute line is missing: ${JSON.stringify(card.lines)}`
  )
})

test('LORE wins the name colour hint; a plain item asks for none', () => {
  assert.equal(toastItemCard(knowledge()).colorFlag, 'lore')
  assert.equal(toastItemCard(knowledge({ lore: false })).colorFlag, 'magic')
  const plain = knowledge({ lore: false, statsBlock: undefined, stats: undefined })
  assert.equal(toastItemCard(plain).colorFlag, undefined)
})

test('an item we know nothing about still draws — as its NAME, with no invented lines', () => {
  const card = toastItemCard({
    name: 'Some Unknown Thing',
    lore: false,
    quest: false,
    questUses: [],
    cached: false,
    notFound: true
  })
  assert.equal(card.name, 'Some Unknown Thing')
  assert.deepEqual(card.lines, [])
  assert.equal(card.iconId, undefined)
})

// ---- the persisted config -------------------------------------------------------------

test('the toast config is TIMING ONLY — a card has no voice of its own', () => {
  // Owner, 2026-08-05: "remove the sound controls from preferences, they are already covered by
  // Alerts module." The config shipped with {sound, volume, durationMs} and a Silent default,
  // which made the picker a way to hear the same boss kill twice. One knob is left.
  assert.deepEqual(DEFAULT_TOAST_CONFIG, { durationMs: 6000 })
})

test('a stored config is normalized: the duration is clamped, retired keys are dropped', () => {
  assert.equal(normalizeToastConfig({ durationMs: 10 ** 9 }).durationMs, TOAST_MAX_DURATION_MS)
  assert.equal(normalizeToastConfig({ durationMs: 1 }).durationMs, 1000)
  assert.deepEqual(normalizeToastConfig(undefined), DEFAULT_TOAST_CONFIG)

  // A store written by the first toast build still carries `sound`/`volume`. Normalizing DROPS
  // them rather than migrating them: nothing reads them, every reader defaults, and the next
  // write of this blob is what removes them from disk.
  const stored = normalizeToastConfig({
    sound: { packId: 'alan-rickman', soundId: 'boss' },
    volume: 0.4,
    durationMs: 7000
  })
  assert.deepEqual(stored, { durationMs: 7000 })
})
