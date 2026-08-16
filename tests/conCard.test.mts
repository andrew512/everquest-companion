// THE CON CARD's rules, as a person meets them (JOS-383, shared/conCard.ts).
//
// This repo has no jsdom, so the split is the one every card feature uses: the DERIVATIONS are pure
// and are pinned here, and the wiring across three windows and a store is the e2e's subject
// (tests/e2e/con-card.e2e.mts). Everything below runs with no Electron.
//
// The claims are grouped the way the ticket states them: the kind and where it opens, the two
// refusals (a player, and a re-con after a close), the five chips, the drop lines, and the one
// knob.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CON_CARD_MAX_DROPS,
  CON_CARD_NEVER_HIDES,
  CON_CARD_REOPEN_SUPPRESS_MS,
  DEFAULT_CON_CARD_AUTO_HIDE_MS,
  DEFAULT_CON_CARD_CONFIG,
  cappedName,
  conCardChips,
  conCardHoldMs,
  conCardIsPlayer,
  conCardSuppressed,
  normalizeConCardConfig
} from '../src/shared/conCard'
import { conCardDropLines } from '../src/renderer/src/overlay/conCardRows'
import { OVERLAY_KINDS } from '../src/shared/types'
import { METER_KINDS, defaultOverlayBounds, overlayDefaultSize } from '../src/main/overlayLayout'
import { RESIST_AXES, type MobResistProfile, type ResistEstimate } from '../src/shared/resistTypes'
import type { ConCardPayload } from '../src/shared/conCard'

// ---- the kind ---------------------------------------------------------------------------

test('the con card is an overlay kind, appended after every meter, and holds no meter slot', () => {
  assert.ok(OVERLAY_KINDS.includes('conCard'), 'the kind exists')
  assert.equal(OVERLAY_KINDS[OVERLAY_KINDS.length - 1], 'conCard', 'APPENDED - see shared/types.ts')
  assert.ok(!METER_KINDS.includes('conCard'), 'a strip is not a meter and must not consume a dock slot')
})

test('it opens TOP CENTRE, and never on top of the celebration strip', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const b = defaultOverlayBounds('conCard', area)
  const size = overlayDefaultSize('conCard', area)
  assert.deepEqual({ width: b.width, height: b.height }, size, 'the bounds carry the kind’s own size')
  assert.equal(b.x, Math.round((area.width - b.width) / 2), 'horizontally centred')
  // "Top centre", with ONE thing above it. BOTH strips ship ON, so a fresh install must not stack
  // a con card and a celebration card in the same pixels — the card clears the toast's band and
  // still opens in the upper 40% of the screen, and a persisted position always wins afterwards.
  const toast = defaultOverlayBounds('toast', area)
  assert.ok(b.y >= toast.y + toast.height, `below the toast (${String(b.y)} vs ${String(toast.y + toast.height)})`)
  assert.ok(b.y < area.height * 0.4, `still near the top (got ${String(b.y)})`)
  assert.ok(b.y + b.height <= area.y + area.height, 'and fully on the screen')
})

// ---- the two refusals -------------------------------------------------------------------

test('NEVER FOR A PLAYER, and the con ladder is not what answers that', () => {
  // The catalog stub stands in for the committed mob catalog: these four names are the real
  // fixture lines (tests/fixtures/w22-w24), and the two SHAPES are identical on the same rung.
  const catalog = new Set(['blugurg', 'sheldon'])
  const knownMob = (n: string): boolean => catalog.has(n.toLowerCase())

  assert.equal(conCardIsPlayer('Lasershark', knownMob), true, 'one capitalized word the catalog never heard of')
  assert.equal(conCardIsPlayer('Faker', knownMob), true)
  assert.equal(conCardIsPlayer('Blugurg', knownMob), false, 'a proper-named NPC the catalog knows')
  assert.equal(conCardIsPlayer('Sheldon', knownMob), false)
  // The article and the space are the mob markers, and neither needs the catalog at all.
  assert.equal(conCardIsPlayer('A lava guardian', knownMob), false)
  assert.equal(conCardIsPlayer('a lava guardian', knownMob), false)
  assert.equal(conCardIsPlayer('Guard V`Lex', knownMob), false, 'a space is a mob marker')
  assert.equal(conCardIsPlayer('Karam Dragonforge', knownMob), false)
})

test('a re-con inside a minute of a CLOSE does not nag, and a minute later it does', () => {
  const closed = 1_000_000
  assert.equal(conCardSuppressed(closed, closed + 1), true)
  assert.equal(conCardSuppressed(closed, closed + CON_CARD_REOPEN_SUPPRESS_MS - 1), true)
  assert.equal(conCardSuppressed(closed, closed + CON_CARD_REOPEN_SUPPRESS_MS), false, 'the window ends')
  assert.equal(conCardSuppressed(undefined, closed), false, 'a mob nobody closed is never suppressed')
  // A log line stamped BEFORE the close (a clock that went backwards) suppresses nothing - the
  // rule is about the minute after a close, and nothing else.
  assert.equal(conCardSuppressed(closed, closed - 10), false)
  assert.equal(CON_CARD_REOPEN_SUPPRESS_MS, 60_000, 'the owner’s number')
})

// ---- the chips --------------------------------------------------------------------------

function est(spec: Partial<ResistEstimate> = {}): ResistEstimate {
  return {
    R: 126, lo: 110, hi: 144, n: 600, fromBaseline: 480, fromYou: 120,
    droppedNoLevel: 0, droppedUnobservable: 0,
    byFamily: { cast: { n: 600, resist: 40, land: 560 }, song: { n: 0, resist: 0, land: 0 } },
    perSpell: [], baselineWeight: 0, userOnly: false, baselineFit: null, userFit: null,
    differsFromShipped: false, nearlyImmune: false,
    ...spec
  }
}

function profile(spec: Partial<MobResistProfile> = {}): MobResistProfile {
  return {
    mobKey: 'a lava guardian',
    displayName: 'A lava guardian',
    level: null,
    spellDataAvailable: true,
    baselineFrozenAt: null,
    axes: [
      { axis: 'magic', estimate: est({ n: 600 }), tag: 'very resistant', n: 600 },
      { axis: 'fire', estimate: est({ R: 180, lo: 40, hi: 200, n: 3 }), tag: 'very resistant', n: 3 },
      { axis: 'cold', estimate: null, tag: null, n: 0 },
      { axis: 'poison', estimate: est({ R: 5, lo: 0, hi: 20, n: 40 }), tag: 'weak', n: 40 },
      { axis: 'disease', estimate: null, tag: null, n: 0 }
    ],
    ...spec
  }
}

test('five chips, always, in one order, whatever the profile hands over', () => {
  const chips = conCardChips(profile())
  assert.deepEqual(chips.map((c) => c.axis), [...RESIST_AXES], 'the order the eye learns')
  // A profile missing an axis entirely (an older payload, a future shape) still draws five.
  const short = conCardChips(profile({ axes: [{ axis: 'fire', estimate: est(), tag: 'resistant', n: 9 }] }))
  assert.equal(short.length, 5)
  assert.deepEqual(short.map((c) => c.axis), [...RESIST_AXES])
  assert.equal(short[2].tag, null, 'an axis with no row is an EMPTY chip, never a missing one')
})

test('ALWAYS SHOW THE RESULT: a three-observation chip carries its answer (owner, 2026-08-16)', () => {
  const chips = conCardChips(profile())
  const fire = chips[RESIST_AXES.indexOf('fire')]
  assert.equal(fire.tag, 'very resistant', 'the tag is shown at n=3, not withheld')
  assert.deepEqual(fire.fit, { R: 180, lo: 40, hi: 200 }, 'and so is the number, with its interval')
  assert.equal(fire.n, 3, 'and the count that qualifies it')
  // The wide interval IS the honest display of a thin cell - that is the ruling's own argument.
  const width = fire.fit === null ? 0 : fire.fit.hi - fire.fit.lo
  assert.ok(width > 100, `a thin cell reports a wide interval (got ${String(width)})`)
  // Only the empty cell has nothing.
  const cold = chips[RESIST_AXES.indexOf('cold')]
  assert.equal(cold.tag, null)
  assert.equal(cold.fit, null)
  assert.equal(cold.n, 0)
})

// ---- the drops --------------------------------------------------------------------------

function payload(spec: Partial<ConCardPayload> = {}): ConCardPayload {
  return { id: 'a lava guardian', ts: 1, name: 'A lava guardian', chips: [], spellData: true, ...spec }
}

test('the wiki table leads, YOUR corroboration ranks it, and your extras come last and say so', () => {
  const { lines, more } = conCardDropLines(
    payload({
      dropsWiki: [
        { item: 'Molten Cloak', rarity: 'Rare' },
        { item: 'Lava Rock' },
        { item: 'Cinder Bracer' }
      ],
      dropsSeen: [
        { item: 'Lava Rock', count: 6, lastTs: 20 },
        { item: 'Molten Cloak', count: 1, lastTs: 30 },
        { item: 'Charred Tooth', count: 2, lastTs: 10 }
      ],
      kills: 24
    }),
    CON_CARD_MAX_DROPS
  )
  assert.deepEqual(lines.map((l) => l.item), ['Lava Rock', 'Molten Cloak', 'Cinder Bracer', 'Charred Tooth'])
  assert.equal(more, 0)
  assert.equal(lines[0].seen, 6, 'most-looted first, inside the page’s own list')
  assert.equal(lines[0].perKill, 6 / 24, 'the perceived rate, over YOUR recorded kills')
  assert.equal(lines[2].seen, undefined, 'a listed drop you have never had says nothing about counts')
  assert.equal(lines[2].perKill, null, 'and never a zero rate (JOS-78)')
  assert.equal(lines[3].yoursOnly, true, 'the item only your history knows is marked')
  assert.equal(lines[1].rarity, 'Rare', 'the page’s verbatim rarity survives')
})

test('a `+N` family is ONE line with the folded count - the mob page’s own fold', () => {
  const { lines } = conCardDropLines(
    payload({
      dropsWiki: [{ item: 'Sphinx Claw' }],
      dropsSeen: [
        { item: 'Sphinx Claw', count: 1, lastTs: 1 },
        { item: 'Sphinx Claw +1', count: 1, lastTs: 2 },
        { item: 'Sphinx Claw +2', count: 1, lastTs: 3 }
      ],
      kills: 10
    }),
    CON_CARD_MAX_DROPS
  )
  assert.equal(lines.length, 1, 'three loots of one item are one line')
  assert.equal(lines[0].seen, 3, 'and the count is their sum, not any one of them')
  assert.equal(lines[0].perKill, 0.3)
})

test('past the cap the card COUNTS what it is not showing rather than truncating in silence', () => {
  const wiki = Array.from({ length: 9 }, (_, i) => ({ item: `Item ${String(i)}` }))
  const { lines, more } = conCardDropLines(payload({ dropsWiki: wiki }), CON_CARD_MAX_DROPS)
  assert.equal(lines.length, CON_CARD_MAX_DROPS)
  assert.equal(more, 4)
})

test('no knowledge yet is not the same as no drops - the card is handed neither list', () => {
  const { lines, more } = conCardDropLines(payload(), CON_CARD_MAX_DROPS)
  assert.deepEqual(lines, [])
  assert.equal(more, 0)
})

// ---- the one knob -----------------------------------------------------------------------

test('the auto-hide clamps, defaults to twenty seconds, and ZERO survives as "never"', () => {
  assert.deepEqual(normalizeConCardConfig(undefined), DEFAULT_CON_CARD_CONFIG)
  assert.equal(DEFAULT_CON_CARD_CONFIG.autoHideMs, DEFAULT_CON_CARD_AUTO_HIDE_MS)
  assert.equal(DEFAULT_CON_CARD_AUTO_HIDE_MS, 20_000, 'the owner’s default')
  assert.equal(normalizeConCardConfig({ autoHideMs: 999_999 }).autoHideMs, 120_000, 'capped')
  assert.equal(normalizeConCardConfig({ autoHideMs: 1 }).autoHideMs, 3_000, 'floored')
  // The one value that is NOT clamped up: it is an answer, not a small duration.
  assert.equal(normalizeConCardConfig({ autoHideMs: 0 }).autoHideMs, CON_CARD_NEVER_HIDES)
  assert.equal(normalizeConCardConfig({ autoHideMs: -5 }).autoHideMs, CON_CARD_NEVER_HIDES)
  // A hand-edited key is dropped rather than honoured.
  assert.deepEqual(normalizeConCardConfig({ autoHideMs: 20_000, sound: 'ding' }), { autoHideMs: 20_000 })
})

test('"never" reaches the queue as an infinite hold, and never as a number on the wire', () => {
  assert.equal(conCardHoldMs({ autoHideMs: 20_000 }), 20_000)
  assert.equal(conCardHoldMs({ autoHideMs: CON_CARD_NEVER_HIDES }), Number.POSITIVE_INFINITY)
  // JSON cannot carry it, which is exactly why the conversion lives on the reading side.
  assert.equal(JSON.parse(JSON.stringify({ h: Number.POSITIVE_INFINITY })).h, null)
})

test('a mob name is capped and whitespace-folded before it can push a card off the screen', () => {
  assert.equal(cappedName('  A  lava   guardian '), 'A lava guardian')
  assert.equal(cappedName('x'.repeat(400)).length, 96)
})
