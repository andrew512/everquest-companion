// ============================================================================
// overlaySnap — the OPT-IN magnetism an overlay drag gets, and the geometry behind it (JOS-217).
// ============================================================================
//
// THE ASK, AND WHY IT IS A PREFERENCE. Three separate reports wanted floating overlays that line
// up: a grid cluster (GD1ABN, TG3S1K), then "matching sizes, snapping seems a little finicky, my
// OCD can see the small difference" (J29XCN), then a fourth asking for the same against the main
// window. One of those same reports is a complaint that an EARLIER snap-back FOUGHT the user, and
// that is the whole design constraint: a window that refuses to go where you put it is worse than
// one that lands two pixels off. So the owner's ruling (2026-08-14) is that this ships as a
// PREFERENCE THAT IS OFF BY DEFAULT — with it off, an overlay drag is byte-identical to what it
// has always been, because the only code that runs is one boolean read.
//
// PURE ON PURPOSE, and shared on purpose. The geometry imports nothing — not Electron, not the
// store — so tests/overlaySnap.test.mts can describe a three-monitor desktop with four overlays on
// it in a few lines (the `displayFit.ts` split, applied to the question one layer up: displayFit
// asks "does this rectangle still fit on a screen", this asks "what would the user like it to line
// up with"). It is in `shared/` rather than `main/` because the PREFERENCE half is read by the
// renderer's Preferences card, and because `SNAP_DISTANCE_PX` is quoted in that card's caption —
// the sentence a user reads and the distance the window actually snaps at must be one number.
//
// WHAT IT SNAPS TO, and it is a short list on purpose:
//
//   * OTHER WINDOWS this app owns — the other open overlays, and the main Companion window. Four
//     positions per axis: the two ABUTMENTS (your right edge on their left edge, and the mirror)
//     and the two ALIGNMENTS (left edges flush, right edges flush). Abutment is how a column of
//     meters gets stacked with no seam; alignment is what answers the OCD report, because two
//     windows whose left edges agree to the pixel is exactly what "I can see the small difference"
//     is about.
//   * SCREEN EDGES — each display's WORK AREA, so a snapped overlay lands beside the taskbar
//     rather than under it. Two positions per axis.
//
// AND WHAT IT DOES NOT DO, stated so the absences read as decisions rather than omissions:
//   * NO GRID. The design comment's advanced Off/8px/16px sub-option is not in the owner's build
//     ruling; the prefs blob is a BLOB rather than a bare boolean so that adding one later is a
//     field, not a migration.
//   * NO RESIZE / SIZE MATCHING. The ruling is "while dragging". Equal-size magnetism is a
//     `will-resize` feature and it is a second ticket's worth of judgement about which dimension
//     the user is expressing.
//   * NO CENTRE LINES. A centre snap is invisible until it fires, and a magnet you cannot predict
//     is the fighting behaviour this feature was told not to reproduce.
//
// A WINDOW ONLY SNAPS TO SOMETHING IT IS NEXT TO. Every candidate is gated on the OTHER axis: a
// left-edge alignment is offered only when the two windows overlap vertically, or come within the
// snap distance of doing so (which is exactly the stacked case — abutting windows have zero
// overlap). Without that gate, dragging near the top of the screen would jump to the left edge of
// a meter parked at the bottom of it, and the magnet would feel like a poltergeist.

/**
 * How near an edge has to be before it pulls, in DIP.
 *
 * 8, and small deliberately. This is a distance the user has to cross with the mouse to ESCAPE
 * once it has stuck, so every pixel of it is a pixel of "the window will not go where I am putting
 * it". 8 is enough that a hand-aimed drag lands flush and not enough to be felt as resistance —
 * and it is the number the Preferences caption quotes, so the two can never drift apart.
 */
export const SNAP_DISTANCE_PX = 8

/**
 * The stored preference. ONE FIELD TODAY, and a blob rather than a bare boolean anyway (unlike
 * `uiScale`, which is one number and stored as one): the design this implements already names a
 * second field — an optional snap-to-grid step — and a blob is how that arrives as a defaulted
 * field instead of a schema migration.
 */
export interface OverlaySnapPrefs {
  /** Magnetize overlay drags to the other windows and the screen edges. Default OFF. */
  enabled: boolean
}

/**
 * OFF. This is the ruling, not a taste: the feature must be invisible until somebody asks for it,
 * so an absent key, a hand-edited file and a fresh install all mean "drag behaves exactly as it
 * did before this shipped".
 */
export const DEFAULT_OVERLAY_SNAP: OverlaySnapPrefs = { enabled: false }

/**
 * The prefs, defaulted field by field — the repo's store discipline (read through the normalizer,
 * write through the SAME one), so a store file, a renderer patch and a future migration cannot end
 * up with three ideas of what this setting is.
 *
 * `fallback` is what makes ONE function serve both callers. Reading the store passes the shipped
 * default; applying a PATCH passes what is currently stored, so a patch that names no field keeps
 * every field — which is the merge semantics the other prefs blobs spell out by hand.
 */
export function normalizeOverlaySnap(
  value: unknown,
  fallback: OverlaySnapPrefs = DEFAULT_OVERLAY_SNAP
): OverlaySnapPrefs {
  const v = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return { enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled }
}

// ------------------------------------------------------------------ the geometry

/** A screen-coordinate rectangle — what `BrowserWindow.getBounds()` and `Display.workArea` share. */
export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

/** Everything a dragged overlay may line up with. Two lists because they offer different
 *  positions: a window can be abutted OR aligned, a screen edge can only be sat against. */
export interface SnapTargets {
  /** The other windows this app owns and can see — other open overlays, and the main window. */
  windows: readonly SnapRect[]
  /** Each display's WORK AREA (not its full bounds — a snapped window sits beside the taskbar). */
  screens: readonly SnapRect[]
}

/** Which dimension a pass is working in. The whole algorithm is one axis run twice. */
type Axis = 'x' | 'y'

/** A rectangle's extent on one axis: the near edge (left/top) and the far edge (right/bottom). */
interface Span {
  near: number
  far: number
}

function span(r: SnapRect, axis: Axis): Span {
  if (axis === 'x') return { near: r.x, far: r.x + r.width }
  return { near: r.y, far: r.y + r.height }
}

const crossAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')

/** Do two spans overlap, or come within `gap` of touching? The "is it next to me" gate. */
function within(a: Span, b: Span, gap: number): boolean {
  return a.near <= b.far + gap && b.near <= a.far + gap
}

/**
 * The four near-edge positions that line `size` up with another WINDOW's span:
 * abut after it, abut before it, align near edges, align far edges.
 */
function windowStops(t: Span, size: number): number[] {
  return [t.far, t.near - size, t.near, t.far - size]
}

/** The two near-edge positions that sit `size` against a SCREEN's span. */
function screenStops(s: Span, size: number): number[] {
  return [s.near, s.far - size]
}

/**
 * Every near-edge position this drag could legitimately land on for `axis`, in PRIORITY ORDER —
 * windows before screens, and within a window abutment before alignment. The order only decides
 * ties (see `stopOnAxis`); the filtering is where the judgement is.
 */
function stopsOnAxis(moving: SnapRect, targets: SnapTargets, axis: Axis, distance: number): number[] {
  const m = span(moving, axis)
  const cross = span(moving, crossAxis(axis))
  const size = m.far - m.near
  const out: number[] = []
  for (const t of targets.windows) {
    // Only a window you are BESIDE gets to pull you (see the file header).
    if (!within(cross, span(t, crossAxis(axis)), distance)) continue
    out.push(...windowStops(span(t, axis), size))
  }
  for (const s of targets.screens) {
    // Only the display the window is actually ON — otherwise a second monitor's left edge would
    // reach across the desktop for a window that has never been near it.
    if (!within(cross, span(s, crossAxis(axis)), 0) || !within(m, span(s, axis), 0)) continue
    out.push(...screenStops(span(s, axis), size))
  }
  return out
}

/**
 * The position `moving` should take on `axis`, or null when nothing is near enough.
 *
 * NEAREST WINS, and a tie goes to the candidate offered FIRST. Ties are rare (they need two
 * targets the same distance away in opposite directions) and the rule exists only so the answer is
 * a function of the inputs rather than of iteration order.
 */
function stopOnAxis(moving: SnapRect, targets: SnapTargets, axis: Axis, distance: number): number | null {
  const from = span(moving, axis).near
  let best: number | null = null
  let bestGap = Infinity
  for (const value of stopsOnAxis(moving, targets, axis, distance)) {
    const gap = Math.abs(value - from)
    if (gap > distance || gap >= bestGap) continue
    best = value
    bestGap = gap
  }
  return best
}

/**
 * Where a window being dragged to `moving` should actually go.
 *
 * SIZE IS NEVER TOUCHED — this is a MOVE, and a magnet that resized the thing you were dragging
 * would be a different feature (and a nasty surprise). The two axes are decided INDEPENDENTLY, so
 * a window can snap flush to the screen's left edge while its top edge is still wherever the mouse
 * put it; a joint decision would mean the nearer axis silently vetoing the other one.
 *
 * Returns the input rectangle UNCHANGED (the same object) when nothing is in range, so the caller's
 * "did anything move" test is a plain comparison and the no-snap path allocates nothing.
 */
export function snapMovingBounds(
  moving: SnapRect,
  targets: SnapTargets,
  distance: number = SNAP_DISTANCE_PX
): SnapRect {
  if (distance <= 0) return moving
  const x = stopOnAxis(moving, targets, 'x', distance)
  const y = stopOnAxis(moving, targets, 'y', distance)
  if (x === null && y === null) return moving
  // Whole pixels: a work area on a scaled display can carry a fractional edge, and a window
  // positioned at 1919.6 is a window whose next `getBounds()` disagrees with what we asked for.
  return { ...moving, x: Math.round(x ?? moving.x), y: Math.round(y ?? moving.y) }
}
