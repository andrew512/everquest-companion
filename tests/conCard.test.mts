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
import {
  CON_CARD_NOTABLE_TAGS,
  conCardDropLines,
  conCardTotalN,
  notableChips
} from '../src/renderer/src/overlay/conCardRows'
import { fitChanged, overlayFitRequest } from '../src/renderer/src/overlay/overlayFit'
import { resistTag } from '../src/shared/resistModel'
import { OVERLAY_KINDS } from '../src/shared/types'
import {
  FIT_HEIGHT_KINDS,
  METER_KINDS,
  OVERLAY_MIN_SIZE,
  defaultOverlayBounds,
  fitsHeightToContent,
  fittedOverlayHeight,
  overlayDefaultSize
} from '../src/main/overlayLayout'
import { RESIST_AXES, type MobResistProfile, type ResistEstimate, type ResistTag } from '../src/shared/resistTypes'
import type { ConCardChip, ConCardPayload } from '../src/shared/conCard'

// ---- the kind ---------------------------------------------------------------------------

test('the con card is an overlay kind, appended after every meter, and holds no meter slot', () => {
  assert.ok(OVERLAY_KINDS.includes('conCard'), 'the kind exists')
  assert.equal(OVERLAY_KINDS[OVERLAY_KINDS.length - 1], 'conCard', 'APPENDED - see shared/types.ts')
  assert.ok(!METER_KINDS.includes('conCard'), 'a strip is not a meter and must not consume a dock slot')
})

test('it opens TOP CENTRE, in the celebration strip’s own band (owner ruling, 2026-08-16)', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const b = defaultOverlayBounds('conCard', area)
  const size = overlayDefaultSize('conCard', area)
  assert.deepEqual({ width: b.width, height: b.height }, size, 'the bounds carry the kind’s own size')
  assert.equal(b.x, Math.round((area.width - b.width) / 2), 'horizontally centred')
  // THE TOP, not 384 px down it. The card used to clear the celebration band so two kinds that both
  // ship ON could never share pixels; the owner overruled that on 2026-08-16 because a card that
  // far down is over the character. Both strips are transient and both close, so they share a band.
  const toast = defaultOverlayBounds('toast', area)
  assert.equal(b.y, toast.y, `the same top edge as the celebration strip (got ${String(b.y)})`)
  assert.ok(b.y + b.height <= area.y + area.height, 'and fully on the screen')
})

test('a display too short to seat the strip at its gap still opens it on screen', () => {
  // The clamp every strip kind shares — the top edge gives way, and never above the work area.
  const shallow = { x: 0, y: 40, width: 800, height: 225 }
  const b = defaultOverlayBounds('conCard', shallow)
  assert.ok(b.y >= shallow.y, `never above the work area (got ${String(b.y)})`)
  assert.equal(b.y + b.height, shallow.y + shallow.height, 'as low as it fits, and no lower')
})

// ---- the window fits the card (JOS-386) --------------------------------------------------

test('the con card is the kind whose HEIGHT is the content’s, and the meters are not', () => {
  assert.deepEqual(FIT_HEIGHT_KINDS, ['conCard'])
  assert.equal(fitsHeightToContent('conCard'), true)
  for (const kind of ['toast', 'alertBanner', 'fight', 'events'] as const) {
    assert.equal(fitsHeightToContent(kind), false, `${kind} owns its own height`)
  }
})

test('a fitted height is the request, clamped to the floor and to the room BELOW THE TOP EDGE', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  // The ordinary case: a card asks for what it drew and gets exactly that.
  assert.equal(fittedOverlayHeight(214, 12, area), 214)
  assert.equal(fittedOverlayHeight(214.4, 12, area), 214, 'rounded, because a window is whole pixels')
  assert.equal(fittedOverlayHeight(215.5, 12, area), 216)
  // THE FLOOR is the one every kind shares — and Electron would clamp `setBounds` against the
  // window's own minHeight anyway, so main must not believe a number the window cannot wear.
  assert.equal(fittedOverlayHeight(20, 12, area), OVERLAY_MIN_SIZE.height)
  assert.equal(fittedOverlayHeight(Number.NaN, 12, area), OVERLAY_MIN_SIZE.height, 'a nonsense request')
  // THE CEILING IS THE ROOM UNDER THE TOP EDGE, and the position never gives: a card dragged near
  // the bottom of the screen SHRINKS rather than sliding back up the screen under the user.
  assert.equal(fittedOverlayHeight(600, 900, area), 140, '1040 - 900')
  assert.equal(fittedOverlayHeight(600, 1035, area), OVERLAY_MIN_SIZE.height, 'and never past the floor')
  // A work area that does not start at zero (a second monitor, a taskbar) measures the same way.
  const second = { x: 2560, y: 100, width: 1920, height: 1000 }
  assert.equal(fittedOverlayHeight(400, 800, second), 300, '100 + 1000 - 800')
  assert.equal(fittedOverlayHeight(400, 112, second), 400, 'a card near the top is untouched')
  // A top edge somehow off the bottom of the work area answers with the floor, never a negative.
  assert.equal(fittedOverlayHeight(400, 5000, area), OVERLAY_MIN_SIZE.height)
})

test('the renderer asks for what it MEASURED plus the window’s own padding, and rounds UP', () => {
  // The measured box is the card and the drag frame; the root's inset is on both sides of it.
  assert.equal(overlayFitRequest(200, 6), 212)
  // CEILED, never rounded: a layout height that rounds DOWN is a window one pixel short of its own
  // content, which on a card with a border shows up as a clipped edge.
  assert.equal(overlayFitRequest(200.1, 6), 213)
  assert.equal(overlayFitRequest(199.9, 6), 212)
  // An unmeasurable or empty box asks for nothing at all rather than for a tiny window.
  assert.equal(overlayFitRequest(0, 6), 0)
  assert.equal(overlayFitRequest(-4, 6), 0)
  assert.equal(overlayFitRequest(Number.NaN, 6), 0)
})

test('a measurement is only SENT when the window could actually express the difference', () => {
  // A layout height is a float and a window height is an integer, so without a threshold a card
  // that never changed would send on every render.
  assert.equal(fitChanged(null, 212), true, 'the first measurement always goes')
  assert.equal(fitChanged(212, 212), false)
  assert.equal(fitChanged(212, 213), false, 'one pixel is not a change a window can express')
  assert.equal(fitChanged(212, 214), true)
  assert.equal(fitChanged(212, 190), true, 'shrinking counts exactly as much as growing')
  // Nothing measured is never a request, whatever was last sent.
  assert.equal(fitChanged(212, 0), false)
  assert.equal(fitChanged(null, 0), false)
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

test('THE CARD KEEPS ONLY WHAT IT RESISTS (owner ruling, 2026-08-16)', () => {
  // The payload still carries five - the MOB PAGE draws all five and reads the same profile. The
  // narrowing is the card's, and it happens here.
  const chips = conCardChips(profile())
  const kept = notableChips(chips)
  assert.deepEqual(kept.map((c) => c.axis), ['magic', 'fire'], 'the two resistant axes, in axis order')
  // `weak` and `normal` are the answer you would have assumed; they leave.
  assert.ok(!kept.some((c) => c.axis === 'poison'), 'a weak axis is dropped')
  // And an axis with nothing behind it leaves too — no `no data` chips on this surface.
  assert.ok(!kept.some((c) => c.axis === 'cold' || c.axis === 'disease'), 'an empty axis is dropped')
  // A LOW-SAMPLE RESISTANT AXIS SURVIVES. `fire` is n=3, and JOS-382's ruling is untouched: the
  // card shows the answer with its wide interval and the quieter caveat, it does not withhold it.
  const fire = kept.find((c) => c.axis === 'fire')
  assert.equal(fire?.n, 3)
  assert.deepEqual(fire?.fit, { R: 180, lo: 40, hi: 200 })
})

test('every tag at or above the estimator’s own `resistant` cut is kept, and nothing below it', () => {
  // The cut is `resistTag()`'s boundary rather than a number invented on the card.
  assert.deepEqual([...CON_CARD_NOTABLE_TAGS], ['resistant', 'very resistant', 'nearly immune'])
  assert.equal(resistTag(45), 'resistant', 'the estimator draws the line in the same place')
  assert.equal(resistTag(44), 'normal')
  const chip = (tag: ResistTag | null, n = 20): ConCardChip => ({
    axis: 'magic',
    tag,
    n,
    fit: tag === null ? null : { R: 60, lo: 40, hi: 80 }
  })
  const kept = notableChips([chip('weak'), chip('normal'), chip('resistant'), chip('very resistant'), chip('nearly immune')])
  assert.deepEqual(kept.map((c) => c.tag), ['resistant', 'very resistant', 'nearly immune'])
  // A tag with no observations behind it cannot happen from `conCardChips`, and is refused anyway.
  assert.deepEqual(notableChips([chip('resistant', 0)]), [], 'n = 0 is never notable')
  assert.deepEqual(notableChips([chip(null)]), [])
})

test('the card’s empty state can tell "we looked" from "we have never seen one"', () => {
  const chips = conCardChips(profile())
  assert.equal(conCardTotalN(chips), 643, '600 + 3 + 40, the whole profile’s evidence')
  const nothing = conCardChips(profile({ axes: [] }))
  assert.deepEqual(notableChips(nothing), [], 'no chips at all')
  assert.equal(conCardTotalN(nothing), 0, 'and the count says so, which is a different sentence')
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
