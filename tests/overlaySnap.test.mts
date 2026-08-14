// ============================================================================
// overlaySnap.test.mts — the opt-in magnetism an overlay drag gets (JOS-217).
// ============================================================================
//
// The feature's whole risk is geometry: a magnet that pulls to the wrong edge, that pulls from
// across the desktop, or that pulls at all for a user who never asked for it. All three are pure
// questions, so all three are answered here — `src/shared/overlaySnap.ts` imports nothing, which
// is what lets this file describe a three-monitor desktop with several overlays on it in a few
// lines. The Electron half (src/main/overlaySnapDrag.ts) is one `will-move` listener over these
// functions and carries no arithmetic of its own.
//
// FIVE CLAIMS, and the first is the owner's ruling rather than a behaviour:
//
//   1. IT IS OFF. `DEFAULT_OVERLAY_SNAP.enabled` is false, an absent/garbage store value reads as
//      false, and a patch that names nothing keeps what was stored. Nobody's drag changes.
//   2. NOTHING IN RANGE ⇒ THE SAME RECTANGLE BACK, identically. That is the no-op path the drag
//      listener tests with a plain comparison, so it has to be exact.
//   3. WINDOWS OFFER FOUR STOPS PER AXIS — two abutments and two alignments — and the NEAREST one
//      wins.
//   4. A TARGET YOU ARE NOT BESIDE PULLS NOTHING. This is the difference between an assist and a
//      poltergeist, and it is the one rule a naive implementation leaves out.
//   5. SCREEN EDGES ARE THE WORK AREA, per display, and only the display you are on.
//
// Sizes are never touched anywhere in here: this is a MOVE.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OVERLAY_SNAP,
  SNAP_DISTANCE_PX,
  normalizeOverlaySnap,
  snapMovingBounds,
  type SnapRect,
  type SnapTargets
} from '../src/shared/overlaySnap'

/** A 1920x1080 primary whose work area stops 40px short of the bottom (a taskbar). */
const PRIMARY: SnapRect = { x: 0, y: 0, width: 1920, height: 1040 }
/** A second monitor to the right, no taskbar. */
const SECOND: SnapRect = { x: 1920, y: 0, width: 1920, height: 1080 }

const rect = (x: number, y: number, width = 300, height = 200): SnapRect => ({ x, y, width, height })

/** Targets with no screens at all — for the claims that are only about neighbouring windows. */
const windowsOnly = (...windows: SnapRect[]): SnapTargets => ({ windows, screens: [] })
/** Targets with no windows at all — for the claims that are only about screen edges. */
const screensOnly = (...screens: SnapRect[]): SnapTargets => ({ windows: [], screens })

// ---- 1. it is off, and it stays off ---------------------------------------------------------

test('THE PREFERENCE SHIPS OFF, and every unreadable value reads as off', () => {
  assert.equal(DEFAULT_OVERLAY_SNAP.enabled, false, 'the owner ruling, as a value a test can hold')

  // An absent key is the overwhelmingly common case: nobody has this key until they touch the
  // switch, and "absent" has to mean the behaviour every build before this one had.
  assert.deepEqual(normalizeOverlaySnap(undefined), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap(null), { enabled: false })
  // A hand-edited file, a downgrade, or a share import can leave anything here.
  assert.deepEqual(normalizeOverlaySnap('yes'), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap([true]), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap({ enabled: 'true' }), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap({ enabled: 1 }), { enabled: false })
  // And the one value that turns it on is a real boolean.
  assert.deepEqual(normalizeOverlaySnap({ enabled: true }), { enabled: true })
})

test('a patch keeps the fields it does not name — the merge the IPC setter relies on', () => {
  const stored = { enabled: true }
  // `setOverlaySnap` passes what is stored as the fallback; a patch mentioning nothing must not
  // silently switch the feature off under a user who was only ever writing some other field.
  assert.deepEqual(normalizeOverlaySnap({}, stored), { enabled: true })
  assert.deepEqual(normalizeOverlaySnap({ enabled: false }, stored), { enabled: false })
  // Junk in the patch is the same as an absent field: keep what is stored.
  assert.deepEqual(normalizeOverlaySnap({ enabled: 'off' }, stored), { enabled: true })
})

// ---- 2. nothing in range ---------------------------------------------------------------------

test('with nothing near, the drag is handed back UNCHANGED — the same object', () => {
  const moving = rect(500, 500)
  const targets = windowsOnly(rect(50, 50))
  const out = snapMovingBounds(moving, targets)
  assert.equal(out, moving, 'the no-snap path allocates nothing and compares equal by identity')
})

test('no targets at all is a no-op, and so is a zero snap distance', () => {
  const moving = rect(100, 100)
  assert.equal(snapMovingBounds(moving, { windows: [], screens: [] }), moving)
  // A neighbour whose left edge is 2px away would normally pull; distance 0 refuses.
  assert.equal(snapMovingBounds(moving, windowsOnly(rect(102, 100)), 0), moving)
})

// ---- 3. the four stops a neighbouring window offers -------------------------------------------

test('ABUTMENT: a window dragged just short of a neighbour lands edge to edge', () => {
  // Neighbour occupies x 600..900. The dragged window's RIGHT edge is at 595 — 5px short.
  const neighbour = rect(600, 100)
  const out = snapMovingBounds(rect(295, 100), windowsOnly(neighbour))
  assert.equal(out.x, 300, 'right edge (300+300) sits exactly on the neighbour’s left edge')
  assert.equal(out.y, 100, 'and the other axis is untouched by an x-only correction')
  assert.equal(out.width, 300)
  assert.equal(out.height, 200, 'a MOVE never resizes')
})

test('ABUTMENT the other way: dragged just past a neighbour’s right edge', () => {
  const neighbour = rect(600, 100) // 600..900
  const out = snapMovingBounds(rect(904, 100), windowsOnly(neighbour))
  assert.equal(out.x, 900, 'left edge lands on the neighbour’s right edge')
})

test('ALIGNMENT: near-equal left edges go flush — the answer to "I can see the difference"', () => {
  // Stacked BELOW the neighbour (which occupies y 100..300), so the two are beside each other on
  // the y axis by the abutment rule, and 3px off on x.
  const neighbour = rect(600, 100)
  const out = snapMovingBounds(rect(603, 300), windowsOnly(neighbour))
  assert.equal(out.x, 600, 'left edges agree to the pixel')
  assert.equal(out.y, 300, 'the vertical abutment was already exact, so nothing moved there')
})

test('ALIGNMENT: right edges go flush too, even when the widths differ', () => {
  const neighbour = rect(600, 100, 300) // right edge 900
  // A narrower window under it whose right edge is at 896.
  const out = snapMovingBounds(rect(696, 300, 200), windowsOnly(neighbour))
  assert.equal(out.x, 700, 'right edge (700+200) meets the neighbour’s 900')
  assert.equal(out.width, 200, 'and the width is NOT matched to the neighbour — that is not this feature')
})

test('BOTH AXES snap independently in one move', () => {
  // Neighbour at 600..900 x 100..300. The dragged window is 4px short of abutting its left edge
  // and 3px off aligning its top edge.
  const out = snapMovingBounds(rect(296, 103), windowsOnly(rect(600, 100)))
  assert.deepEqual(out, { x: 300, y: 100, width: 300, height: 200 })
})

test('the NEAREST stop wins when two neighbours both reach', () => {
  // One neighbour would pull the left edge to 500 (6px away), another to 497 (3px away).
  const near = rect(497, 100)
  const far = rect(500, 100)
  const out = snapMovingBounds(rect(494, 100), { windows: [far, near], screens: [] })
  assert.equal(out.x, 497, 'the 3px pull beats the 6px one regardless of list order')
})

test('the pull reaches exactly SNAP_DISTANCE_PX and not one pixel further', () => {
  const neighbour = rect(600, 100)
  const at = snapMovingBounds(rect(300 - SNAP_DISTANCE_PX, 100), windowsOnly(neighbour))
  assert.equal(at.x, 300, 'a gap of exactly the snap distance still lands flush')
  const beyond = rect(300 - SNAP_DISTANCE_PX - 1, 100)
  assert.equal(snapMovingBounds(beyond, windowsOnly(neighbour)), beyond, 'one further is free')
})

// ---- 4. only a window you are BESIDE pulls ----------------------------------------------------

test('a neighbour across the desktop pulls NOTHING, however well its edges line up', () => {
  // Same left edge, 3px off — but 600px apart vertically. Without the cross-axis gate this would
  // jump, and the magnet would feel like a poltergeist.
  const moving = rect(603, 900)
  assert.equal(snapMovingBounds(moving, windowsOnly(rect(600, 100))), moving)
})

test('…and "beside" includes ABOUT to abut: the gate is the snap distance, not strict overlap', () => {
  // Neighbour occupies y 100..300. The dragged window's top edge is 6px below its bottom edge, so
  // the two spans do NOT overlap — they are within the snap distance of doing so, which is exactly
  // the moment a user is stacking one under the other and wants the left edges to agree.
  const out = snapMovingBounds(rect(604, 306), windowsOnly(rect(600, 100)))
  assert.equal(out.x, 600, 'the x alignment is offered')
  assert.equal(out.y, 300, 'and the y abutment closes the 6px seam in the same move')
})

// ---- 5. screen edges ---------------------------------------------------------------------------

test('SCREEN EDGES are the work area — a snapped window sits BESIDE the taskbar, not under it', () => {
  // PRIMARY's work area ends at y=1040; the full screen is 1080 tall. A window dragged to 843 has
  // its bottom edge at 1043 — 3px past the work area's floor.
  const out = snapMovingBounds(rect(500, 843), screensOnly(PRIMARY))
  assert.equal(out.y, 840, 'bottom edge (840+200) rests on the work area floor, 40px above the screen')
})

test('the left and top edges pull the same way', () => {
  assert.equal(snapMovingBounds(rect(5, 500), screensOnly(PRIMARY)).x, 0)
  assert.equal(snapMovingBounds(rect(500, 6), screensOnly(PRIMARY)).y, 0)
  // …and the right edge, which is the one whose arithmetic involves the window's own width.
  assert.equal(snapMovingBounds(rect(1616, 500), screensOnly(PRIMARY)).x, 1620, 'right edge to 1920')
})

test('only the display you are ON gets to pull you', () => {
  // A window sitting entirely on the SECOND monitor, 4px past its left edge. The primary's own
  // edges are 2000px away and its rectangle does not contain this window at all, so the only stop
  // in play is the seam between the two displays.
  const onSecond = rect(1924, 500)
  assert.equal(snapMovingBounds(onSecond, screensOnly(PRIMARY, SECOND)).x, 1920, 'the seam, not x=0')

  // And a window that STRADDLES the seam is still answered by an edge it is touching. Its right
  // edge (2216) is nowhere near the primary's 1920, so the primary offers nothing reachable; the
  // second monitor's left edge is 4px away and wins. The claim is that the answer always comes
  // from a display the window is actually on — never from one it has never been near.
  assert.equal(snapMovingBounds(rect(1916, 500), screensOnly(PRIMARY, SECOND)).x, 1920)
})

test('a window on no display at all is left where it is', () => {
  const moving = rect(5000, 5000)
  assert.equal(snapMovingBounds(moving, screensOnly(PRIMARY, SECOND)), moving)
})

// ---- rounding ----------------------------------------------------------------------------------

test('a fractional work area still produces whole-pixel bounds', () => {
  // A scaled display can carry a fractional edge; a window positioned at 1919.6 is a window whose
  // next getBounds() disagrees with what we asked for.
  const scaled: SnapRect = { x: 0, y: 0, width: 1919.6, height: 1079.4 }
  const out = snapMovingBounds(rect(1616, 500), screensOnly(scaled))
  assert.equal(out.x, 1620, 'rounded, not carried through as a fraction')
  assert.equal(Number.isInteger(out.x), true)
})
