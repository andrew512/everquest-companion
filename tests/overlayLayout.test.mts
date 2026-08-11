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
//
// JOS-119 ADDED THE SEVENTH METER KIND ('debuffs') and with it the case rule 2 could no longer
// satisfy at a fixed size: seven 380x320 slots do not fit a 1366x728 work area under ANY column
// arrangement (three columns and two rows is six). So the uniform size is now a function of the
// display — it shrinks, all kinds together, until the reserved grid fits — and rule 1 is stated
// PER WORK AREA. `uniform on this display` is the property; `always 380x320` never was one that
// could survive a seventh window, and the alternative was two windows opening on top of each
// other, which is the thing this file exists to forbid. A NOTIFIER never joins that grid, so
// however many alert lanes arrive they cannot crowd it and they do not shrink with it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  METER_KINDS,
  defaultOverlayBounds,
  overlayDefaultSize,
  overlaySizeLimits,
  type Bounds
} from '../src/main/overlayLayout'
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
  assert.ok(METER_KINDS.length >= 7, 'every meter kind is still registered')
  for (const [i, s] of sizes.entries()) {
    assert.deepEqual(s, first, `${METER_KINDS[i]} must use the uniform size`)
  }
  // Erring slightly larger than every per-kind size this replaced (the largest was 360x300), so
  // the event log — the only kind that is a list rather than dense bars — is not cramped.
  assert.ok(first.width >= 360, `width ${first.width} must not be smaller than the old event log`)
  assert.ok(first.height >= 300, `height ${first.height} must not be smaller than the old event log`)
})

test('…and the size stays uniform ON EVERY DISPLAY, even where it had to shrink', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const sizes = METER_KINDS.map((k) => overlayDefaultSize(k, wa))
    for (const [i, s] of sizes.entries()) {
      assert.deepEqual(s, sizes[0], `${name}/${METER_KINDS[i]}: not the same size as its siblings`)
    }
    // Never LARGER than the shipped size — the ladder only ever goes down.
    assert.ok(sizes[0].width <= 380 && sizes[0].height <= 320, `${name}: ${JSON.stringify(sizes[0])}`)
  }
})

test('a display big enough for the whole stack is untouched at the shipped size', () => {
  // 1080p and up seat all seven reserved slots at 380x320, so nobody with an ordinary monitor
  // sees a smaller first-open window because a kind was added.
  for (const name of ['1080p', '1440p', 'offset display']) {
    const s = overlayDefaultSize('fight', WORK_AREAS[name])
    assert.deepEqual(s, { width: 380, height: 320 }, `${name} should not have needed to shrink`)
  }
})

test('a small laptop SHRINKS the stack rather than stacking two windows on one spot', () => {
  // The exact case shared/types.ts used to warn about. Seven 380x320 slots cannot be laid out on
  // a 1366x728 work area; the answer is a smaller uniform slot, never an overlap (proven by the
  // no-overlap test below, which runs over this work area too).
  const wa = WORK_AREAS['small laptop']
  const s = overlayDefaultSize('fight', wa)
  assert.ok(s.width < 380, `expected a shrunk slot on a small laptop, got ${JSON.stringify(s)}`)
  // …and still a readable window, not a postage stamp.
  assert.ok(s.width >= 260 && s.height >= 220, `shrunk too far: ${JSON.stringify(s)}`)
})

test('the reserved slots never overlap and stay inside the work area', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const placed = METER_KINDS.map((k) => defaultOverlayBounds(k, wa))
    for (const [i, b] of placed.entries()) {
      assert.equal(b.width, overlayDefaultSize(METER_KINDS[i], wa).width)
      assert.equal(b.height, overlayDefaultSize(METER_KINDS[i], wa).height)
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

/**
 * NO OVERLAY EVER OPENS OVER THE WHOLE SCREEN (JOS-83).
 *
 * A new user reported the celebration overlay as having "covered the entire screen" on their first
 * install. Nothing in this module has ever placed a window that could — the toast is a 560x360
 * strip and the meters are 380x320 — but the claim is cheap to make structurally impossible, and a
 * first-open window is the ONE geometry a user cannot have chosen for themselves. So every kind's
 * default bounds are pinned as a small fraction of any display it could land on.
 *
 * This says nothing about a window that PAINTS wrong (a driver that cannot composite a transparent
 * window shows the strip as a black rectangle — the JOS-40 report, and shared/graphicsPrefs.ts is
 * the answer to it). It pins the size, which is the half that lives here.
 */
test('a first-open overlay is a small window on any display — never a screen-filling one', () => {
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    for (const kind of OVERLAY_KINDS) {
      const b = defaultOverlayBounds(kind, wa)
      assert.ok(b.width < wa.width, `${name}/${kind}: as wide as the whole work area`)
      assert.ok(b.height < wa.height, `${name}/${kind}: as tall as the whole work area`)
      const share = (b.width * b.height) / (wa.width * wa.height)
      assert.ok(share < 0.25, `${name}/${kind}: covers ${(share * 100).toFixed(1)}% of the display`)
      assert.ok(b.x >= wa.x && b.y >= wa.y, `${name}/${kind}: starts off-screen`)
      assert.ok(
        b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height,
        `${name}/${kind}: runs past the work area`
      )
    }
  }
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

test('an alert lane may be STRETCHED without limit; a meter has a largest useful size', () => {
  // The lane draws one centred line per firing, so its width is just how much of a substituted
  // line fits before it wraps — a banner across the top of an ultrawide is the feature working.
  // 720 was the METERS' ceiling, applied to every kind because the toast was the only exception
  // anyone had needed, and it is what stopped the lane being dragged wider (owner, 2026-08-11).
  for (const kind of ALERT_OVERLAY_KINDS) {
    const limits = overlaySizeLimits(kind)
    assert.equal(limits.maxWidth, undefined, `${kind}: still capped in width`)
    assert.equal(limits.maxHeight, undefined, `${kind}: still capped in height`)
    // …and small enough at the other end to park a short banner in a corner.
    assert.ok(limits.minWidth <= 200 && limits.minHeight <= 90, `${kind}: ${JSON.stringify(limits)}`)
  }
  // Every OTHER kind keeps the panel ceiling — this is a carve-out, not a removal.
  for (const kind of OVERLAY_KINDS.filter((k) => !(ALERT_OVERLAY_KINDS as readonly string[]).includes(k))) {
    const limits = overlaySizeLimits(kind)
    assert.equal(limits.maxWidth, 720, `${kind}: lost its width cap`)
    assert.equal(limits.maxHeight, 820, `${kind}: lost its height cap`)
  }
})

test('every kind can still be resized DOWN to its own minimum, and opens at least that big', () => {
  // A first-open window smaller than its own minimum would be resized by the OS the moment it
  // appeared, which is a window that does not open where the layout says it does.
  for (const kind of OVERLAY_KINDS) {
    const limits = overlaySizeLimits(kind)
    const size = overlayDefaultSize(kind, WORK_AREAS['small laptop'])
    assert.ok(size.width >= limits.minWidth, `${kind}: opens narrower than its minimum`)
    assert.ok(size.height >= limits.minHeight, `${kind}: opens shorter than its minimum`)
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

// ---- the two timer windows (JOS-119) ----------------------------------------------------

/**
 * TWO WINDOWS, PLACED SEPARATELY — the ticket, as geometry.
 *
 * The owner asked for buffs and debuffs to be windows he can move independently. The half of that
 * this file owns is the FIRST open: they must not arrive on top of one another, and neither may be
 * the screen-filling window JOS-83's report described. Everything after the first open is the
 * store's job — each kind persists its own bounds under `overlays.<kind>` — which
 * tests/e2e/buffs-overlay.e2e.mts drives against the real app.
 */
test('buffs and debuffs are two distinct stacked kinds with two distinct slots', () => {
  assert.ok(METER_KINDS.includes('buffs') && METER_KINDS.includes('debuffs'), 'both timer kinds stack')
  for (const [name, wa] of Object.entries(WORK_AREAS)) {
    const b = defaultOverlayBounds('buffs', wa)
    const d = defaultOverlayBounds('debuffs', wa)
    assert.ok(b.x !== d.x || b.y !== d.y, `${name}: the two timer windows open at the same spot`)
    assert.ok(!overlaps(b, d), `${name}: ${JSON.stringify(b)} overlaps ${JSON.stringify(d)}`)
    for (const [label, box] of [['buffs', b] as const, ['debuffs', d] as const]) {
      const share = (box.width * box.height) / (wa.width * wa.height)
      assert.ok(share < 0.25, `${name}/${label}: covers ${(share * 100).toFixed(1)}% of the display`)
    }
  }
})
