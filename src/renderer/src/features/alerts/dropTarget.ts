// dropTarget — where a dragged alert would land, as arithmetic (JOS-177).
//
// WHY THIS FILE EXISTS AT ALL. JOS-175 made every ROW a drop target and nothing else, and native
// HTML5 drag punishes exactly that: `dragover` sets `dropEffect` to `none` — the do-not-proceed
// cursor — for every element that does not CANCEL the event. The rows cancelled it; the 8px the
// list puts between two rows, the container's own padding and the strip beside the "Add from
// suggestion…" button did not. So a pointer crossing the list alternated cancel / no-cancel at
// gap frequency and the cursor flickered the whole way down. The fix is to accept the drag at the
// CONTAINER, which has no holes in it — and once the container is the target, "which row was I
// over" stops being a readable answer and has to be computed. That is this file.
//
// A SLOT IS A GAP, NOT A ROW. The reading is an insertion index in 0…rows.length: 0 is above the
// first row, `rows.length` is below the last, and `i` is between rows `i-1` and `i`. Counting
// midpoints is what makes it feel right — you are past a row once you are past its middle — and it
// is also what makes it TOTAL: a pointer anywhere in the container, gap or padding or row, yields
// an index, so there is no coordinate where the gesture has nothing to say.
//
// PURE NUMBERS, NO DOM. The hook measures (`getBoundingClientRect`) and this file decides, so the
// decision is node-testable without a renderer — `tests/alertReorder.test.mts` drives it directly.
// Relative imports only (repo law for node-tested modules); it happens to need none.

/** One row's vertical extent, in whatever coordinate space the caller measured in. */
export interface RowBox {
  readonly top: number
  readonly bottom: number
}

/**
 * The slot the pointer at `y` is asking for: how many rows it is already PAST.
 *
 * Counted rather than searched, so it stays correct for a row of zero height (a row mid-collapse)
 * and cannot fall off either end — the answer is always in 0…boxes.length.
 */
export function insertionIndexAt(boxes: readonly RowBox[], y: number): number {
  let index = 0
  for (const box of boxes) if (y >= (box.top + box.bottom) / 2) index += 1
  return index
}

/**
 * Where to draw the line for `index`, in the same space `boxes` were measured in.
 *
 * The two ends sit ON the outer edges of the list rather than floating past them (a line drawn in
 * the margin above the first row reads as belonging to whatever is above the list); every interior
 * slot sits in the middle of the gap it names. The caller centres the line on this y.
 */
export function insertionLineY(boxes: readonly RowBox[], index: number): number {
  if (boxes.length === 0) return 0
  const slot = Math.max(0, Math.min(Math.trunc(index), boxes.length))
  if (slot === 0) return boxes[0].top
  if (slot === boxes.length) return boxes[boxes.length - 1].bottom
  return (boxes[slot - 1].bottom + boxes[slot].top) / 2
}

/**
 * Would dropping the row at `fromIndex` into `slot` change the order?
 *
 * The slot just above a row and the slot just below it are both "where it already is", which is
 * why a drag that wanders and comes home writes nothing. `fromIndex` < 0 means the dragged row is
 * not in this list (a stale id, a drag from somewhere else) and nothing may move.
 */
export function dropChangesOrder(fromIndex: number, slot: number): boolean {
  if (fromIndex < 0) return false
  return slot !== fromIndex && slot !== fromIndex + 1
}
