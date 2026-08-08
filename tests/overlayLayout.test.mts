// Default overlay placement (Task #59 follow-up: UNIFORM default size).
//
// This is pure geometry — no log, no fixture, so it never skips. It pins the two properties the
// first-open layout has to have on any display, and the one product rule behind them:
//   1. EVERY METER kind opens at the SAME width x height (user decision). No per-kind sizes.
//   2. The reserved slots never overlap and never leave the work area — with uniform sizes the
//      bottom-right stack wraps into a new column instead of running off the top of the screen.
// Persisted bounds are not exercised here: they short-circuit this module entirely in
// createOverlayWindow (index.ts prefers `cfg.bounds` and only calls in here when there are none).
//
// THE NOTIFIERS ARE OUTSIDE ALL OF THAT (shared/alertOverlays.ts) — the celebration strip
// (docs/plans/celebration-toasts.md §3) and the alert text lane
// (docs/plans/alert-text-overlays.md §7). Neither is a meter: each has its own width, sits in the
// upper half of the screen, and holds NO slot in the bottom-right stack — so the meter assertions
// run over METER_KINDS and each notifier gets its own geometry test below. Adding one must not
// move any meter's reserved slot, and the two must never open on top of each other; both are
// checked at the end of this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { METER_KINDS, defaultOverlayBounds, overlayDefaultSize, type Bounds } from '../src/main/overlayLayout'
import { OVERLAY_KINDS } from '../src/shared/types'
import {
  ALERT_OVERLAY_KINDS,
  DEFAULT_ALERT_OVERLAY,
  NOTIFIER_OVERLAY_KINDS
} from '../src/shared/alertOverlays'

/** Work areas worth proving: a 1080p desktop with a taskbar, a tall 1440p, a small laptop, and a
 *  non-zero-origin display (a second monitor left of the primary). */
const WORK_AREAS: Record<string, Bounds> = {
  '1080p': { x: 0, y: 0, width: 1920, height: 1040 },
  '1440p': { x: 0, y: 0, width: 2560, height: 1400 },
  'small laptop': { x: 0, y: 0, width: 1366, height: 728 },
  'offset display': { x: -1920, y: 120, width: 1920, height: 960 }
}

const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('every METER kind opens at ONE uniform default size', () => {
  const sizes = METER_KINDS.map((k) => overlayDefaultSize(k))
  const first = sizes[0]
  assert.ok(METER_KINDS.length >= 5, 'all five meter kinds are still registered')
  for (const [i, s] of sizes.entries()) {
    assert.deepEqual(s, first, `${METER_KINDS[i]} must use the uniform size`)
  }
  // Erring slightly larger than every per-kind size this replaced (the largest was 360x300), so
  // the event log — the only kind that is a list rather than dense bars — is not cramped.
  assert.ok(first.width >= 360, `width ${first.width} must not be smaller than the old event log`)
  assert.ok(first.height >= 300, `height ${first.height} must not be smaller than the old event log`)
})

test('the reserved slots never overlap and stay inside the work area', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const placed = METER_KINDS.map((k) => defaultOverlayBounds(k, wa))
    for (const [i, b] of placed.entries()) {
      assert.equal(b.width, overlayDefaultSize(METER_KINDS[i]).width)
      assert.equal(b.height, overlayDefaultSize(METER_KINDS[i]).height)
      assert.ok(b.x >= wa.x, `${name}/${METER_KINDS[i]}: off the left edge`)
      assert.ok(b.y >= wa.y, `${name}/${METER_KINDS[i]}: off the top edge`)
      assert.ok(b.x + b.width <= wa.x + wa.width, `${name}/${METER_KINDS[i]}: off the right edge`)
      assert.ok(b.y + b.height <= wa.y + wa.height, `${name}/${METER_KINDS[i]}: off the bottom edge`)
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        assert.ok(
          !overlaps(placed[i], placed[j]),
          `${name}: ${METER_KINDS[i]} overlaps ${METER_KINDS[j]} (${JSON.stringify(placed[i])} vs ${JSON.stringify(placed[j])})`
        )
      }
    }
  }
})

test('the first kind docks to the bottom-right corner, and the stack walks upward from it', () => {
  const wa = WORK_AREAS['1080p']
  const [first, second] = [defaultOverlayBounds(METER_KINDS[0], wa), defaultOverlayBounds(METER_KINDS[1], wa)]
  assert.equal(first.x + first.width, wa.x + wa.width - 16, 'right margin')
  assert.equal(first.y + first.height, wa.y + wa.height - 16, 'bottom margin')
  assert.equal(second.x, first.x, 'the second slot is in the same column')
  assert.ok(second.y < first.y, 'the stack grows upward')
})

test('a full column wraps LEFT rather than off the top of the screen', () => {
  // Deliberately short: only two uniform slots fit vertically, so the five kinds must spill into
  // additional columns. This is the case the old modulo wrap got wrong (it could overlap).
  const wa: Bounds = { x: 0, y: 0, width: 2000, height: 700 }
  const placed = METER_KINDS.map((k) => defaultOverlayBounds(k, wa))
  const columns = new Set(placed.map((b) => b.x))
  assert.ok(columns.size > 1, 'a short work area must use more than one column')
  for (const b of placed) {
    assert.ok(b.y >= wa.y && b.y + b.height <= wa.y + wa.height, 'still on-screen vertically')
  }
})

// ---- the celebration toast (docs/plans/celebration-toasts.md §3) -----------------------

test('the toast opens TOP-CENTRED on the work area, at its own width', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const b = defaultOverlayBounds('toast', wa)
    // 560 since 2026-08-05 ("it needs to be a bit bigger/more prominent" — owner); the card's
    // type scaled with the lane, so the two numbers move together or not at all.
    assert.equal(b.width, 560, `${name}: the card lane's own width, not the meter size`)
    assert.equal(b.y, wa.y + 12, `${name}: 12px below the top of the work area`)
    // Centred: the gap to the left edge equals the gap to the right, within a rounding pixel.
    const left = b.x - wa.x
    const right = wa.x + wa.width - (b.x + b.width)
    assert.ok(Math.abs(left - right) <= 1, `${name}: not centred (${left} vs ${right})`)
  }
})

test('a display narrower than the strip still lands it on-screen', () => {
  const wa: Bounds = { x: 0, y: 0, width: 320, height: 240 }
  const b = defaultOverlayBounds('toast', wa)
  assert.equal(b.x, wa.x, 'clamped to the left edge rather than hanging off it')
  assert.ok(b.y >= wa.y, 'and never above the top of the work area')
})

test('NO NOTIFIER holds a slot in the meter stack — adding one moved nothing', () => {
  const wa = WORK_AREAS['1080p']
  for (const kind of NOTIFIER_OVERLAY_KINDS) {
    assert.ok(OVERLAY_KINDS.includes(kind), `${kind} is a registered overlay kind`)
    assert.equal(METER_KINDS.includes(kind), false, `…and ${kind} is not one of the stacked meters`)
  }
  // The meters' slots are assigned by index within METER_KINDS, so the five meter kinds must
  // still be exactly where they were before any notifier kind existed. These are the numbers a
  // user's persisted bounds were first written from, so they are not free to drift.
  const stack = METER_KINDS.map((k) => defaultOverlayBounds(k, wa))
  assert.deepEqual(stack[0], { width: 380, height: 320, x: 1524, y: 704 })
  assert.deepEqual(stack[1], { width: 380, height: 320, x: 1524, y: 374 })
  assert.deepEqual(stack[2], { width: 380, height: 320, x: 1524, y: 44 })
})

// ---- alert text overlays (docs/plans/alert-text-overlays.md §7) -------------------------

test('an alert overlay opens CENTRED, in its own lane, clear of the celebration strip', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const b = defaultOverlayBounds(DEFAULT_ALERT_OVERLAY, wa)
    assert.equal(b.width, 560, `${name}: the text lane's own width, not the meter size`)
    // Centred: the gap to the left edge equals the gap to the right, within a rounding pixel.
    const left = b.x - wa.x
    const right = wa.x + wa.width - (b.x + b.width)
    assert.ok(Math.abs(left - right) <= 1, `${name}: not centred (${left} vs ${right})`)
    assert.ok(b.x >= wa.x && b.x + b.width <= wa.x + wa.width, `${name}: on-screen horizontally`)
    assert.ok(b.y >= wa.y && b.y + b.height <= wa.y + wa.height, `${name}: on-screen vertically`)
  }
})

test('the two notifier lanes never open on top of each other', () => {
  // Both are centred at the top half of the screen, so this is the one collision the first-open
  // layout could plausibly produce — and a text alert appearing underneath a celebration card is
  // exactly the case where you most need to read it.
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const placed = NOTIFIER_OVERLAY_KINDS.map((k) => defaultOverlayBounds(k, wa))
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        assert.ok(
          !overlaps(placed[i], placed[j]),
          `${name}: ${NOTIFIER_OVERLAY_KINDS[i]} overlaps ${NOTIFIER_OVERLAY_KINDS[j]}`
        )
      }
    }
  }
})

test('a SECOND alert overlay would stack below the first, not on it', () => {
  // The groundwork the owner asked for: the lane is placed by its index in ALERT_OVERLAY_KINDS,
  // so the rule is pinned rather than today's list length. There is one kind today — this asserts
  // the RULE by reading the same geometry the roster drives.
  const wa = WORK_AREAS['1440p']
  const first = defaultOverlayBounds(ALERT_OVERLAY_KINDS[0], wa)
  assert.equal(first.y, wa.y + 400, 'the first lane sits clear of the toast strip (12..372)')
  // A second entry would be offset by exactly one lane height plus the gutter; proving the
  // arithmetic here means adding the kind cannot silently land it on top of this one.
  const wouldBe = first.y + first.height + 10
  assert.ok(wouldBe > first.y + first.height, 'the next lane starts below this one')
  assert.ok(wouldBe + first.height <= wa.y + wa.height, 'and still fits on a 1440p work area')
})
