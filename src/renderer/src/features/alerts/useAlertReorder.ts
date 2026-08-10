// useAlertReorder — the drag gesture behind the alerts list's own order (JOS-175, JOS-177).
//
// WHAT THE USER GETS: a grip at the left edge of every alert row. Drag a row and a line follows the
// pointer, showing the gap the row will land in — above the row you are over, below it, or between
// two rows when you are between them. Let go and it lands there. The order is written through main
// and is the order the list is in the next time the app opens. Reorder ONLY — no folders, no
// groups (owner ruling, 2026-08-09).
//
// THE DROP TARGET IS THE WHOLE LIST, NOT EACH ROW (JOS-177 — this is the fix, and the reason the
// gesture changed shape). In native HTML5 drag, `dragover` means "no" unless a handler CANCELS it,
// and a cancelled-nowhere dragover paints the do-not-proceed cursor. JOS-175 put the handler on
// every ROW, so the 8px between two rows, the container padding, and the strip beside the add
// button all said no — and dragging down a list flickered the cursor once per gap. One handler on
// the container has no holes: it cancels everything for as long as OUR drag is live, and the
// landing slot is computed from the pointer's y against the row midpoints (`dropTarget.ts`)
// instead of being read off whichever element happened to be under the pointer.
//
// …AND ONLY FOR OUR DRAG. `preventDefault` on an arbitrary dragover is also how a window agrees to
// accept a FILE dropped on it, so the cancel is gated on a mark this list's own dragstart put on
// the transfer (plus the live `draggingId`, which is the same answer from inside React). A photo
// dragged out of Explorer still gets the browser's refusal, which is the honest one.
//
// THE GRIP IS ALSO A BUTTON. Native HTML5 drag is pointer-only, and a list you can only reorder
// by dragging is a list some people cannot reorder at all — so the same grip takes ArrowUp /
// ArrowDown and nudges the row one place, which is the shape the e2e drives too (a keypress is a
// condition; a synthesized drag is a bet on the compositor). Both paths end in the same call.
//
// WHY NATIVE DRAG AND NOT A LIBRARY: this repo ships no drag-and-drop dependency, and the whole
// gesture is a handful of handlers over a list that is already keyed by id. `dataTransfer` carries
// the id so a drop can be read even from a re-render, and `effectAllowed`/`dropEffect` are set on
// both ends because Chromium refuses the drop otherwise.
//
// NOTHING MOVES UNTIL THE DROP. The line is absolutely positioned, so it takes no space and the
// rows never shift under the pointer — a list that re-flowed mid-drag would move the very
// midpoints this hook just measured and the reading would oscillate.
//
// THE ORDER MATH LIVES IN `@shared/alertOrder` — the same `moveIdToIndex`/`nudgeId` main
// re-derives with, so the row you see land is the row that gets stored.

import { useCallback, useMemo, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { moveIdToIndex, nudgeId } from '@shared/alertOrder'
import type { AlertDef } from '@shared/types'
import { dropChangesOrder, insertionIndexAt, insertionLineY, type RowBox } from './dropTarget'

/** Where the dragged row would land: the slot, and the y to draw the line at. */
export interface DropMark {
  /** Insertion slot in 0…alerts.length — 0 is above the first row (see dropTarget.ts). */
  readonly index: number
  /** Distance from the top of the list container's content, in px. */
  readonly y: number
}

/** What the list container needs to be the drop target, and the grip needs to start a drag. */
export interface AlertReorder {
  /** The row being dragged right now, or null. Rows use it to dim themselves. */
  draggingId: string | null
  /** Where the line goes, or null when no drag is over this list. */
  mark: DropMark | null
  /** Props for the scrolling list container — the ONE drop target (see the header). */
  containerProps: {
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => void
    onDrop: (e: ReactDragEvent<HTMLElement>) => void
  }
  /** Props for the grip itself (the drag source + the keyboard control). */
  gripProps: (id: string) => {
    draggable: true
    onDragStart: (e: ReactDragEvent<HTMLElement>) => void
    onDragEnd: () => void
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
  }
}

const MIME = 'text/plain'
/** Set on the transfer so a dragover can tell OUR row from a file the OS is offering. */
const MARK_MIME = 'application/x-eq-alert-reorder'

/** Every rendered row's box, top to bottom, in client coordinates. */
function rowBoxes(container: HTMLElement): RowBox[] {
  return [...container.querySelectorAll('[data-alert-id]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
}

/** The slot the pointer is asking for, and the line's y inside the container's scrolled content. */
function readMark(container: HTMLElement, clientY: number): DropMark | null {
  const boxes = rowBoxes(container)
  if (boxes.length === 0) return null
  const index = insertionIndexAt(boxes, clientY)
  const box = container.getBoundingClientRect()
  return { index, y: insertionLineY(boxes, index) - box.top + container.scrollTop }
}

/** Is this dragover one of ours? Either React still knows, or the transfer says so. */
function isOurDrag(e: ReactDragEvent<HTMLElement>, draggingId: string | null): boolean {
  return draggingId !== null || e.dataTransfer.types.includes(MARK_MIME)
}

/**
 * Drag/keyboard reordering for a list of alerts.
 *
 * `onReorder` receives the WHOLE id sequence, never a pair of indices: main re-derives its list
 * from that sequence, so a stale index cannot move the wrong def.
 */
export function useAlertReorder(
  alerts: readonly AlertDef[],
  onReorder: (orderedIds: string[]) => void
): AlertReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [mark, setMark] = useState<DropMark | null>(null)
  const ids = useMemo(() => alerts.map((a) => a.id), [alerts])

  const onDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (!isOurDrag(e, draggingId)) return
      // preventDefault is what MAKES this a drop target in HTML5 drag — without it the drop never
      // fires AND the cursor says no. It is called for EVERY point in the container, gaps and
      // padding included; that unbroken coverage is the whole of JOS-177.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const next = readMark(e.currentTarget, e.clientY)
      // dragover fires continuously; keeping the previous object when the reading is unchanged is
      // what stops every pointer twitch from re-rendering the whole list.
      setMark((prev) =>
        next !== null && prev?.index === next.index && prev.y === next.y ? prev : next
      )
    },
    [draggingId]
  )

  const onDragLeave = useCallback((e: ReactDragEvent<HTMLElement>): void => {
    // dragleave BUBBLES, so crossing from a row into the gap below it arrives here too — hiding the
    // line on that would restore the flicker in a different colour. Only a pointer genuinely out of
    // the container clears it; the drag itself ends at dragend either way.
    const related = e.relatedTarget
    if (related instanceof Node && e.currentTarget.contains(related)) return
    const r = e.currentTarget.getBoundingClientRect()
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (!inside) setMark(null)
  }, [])

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>): void => {
      if (!isOurDrag(e, draggingId)) return
      e.preventDefault()
      // The id off the transfer first: it survives a re-render that dropped our state, and it is
      // the only reading that is true for a drag that started in this list.
      const moved = e.dataTransfer.getData(MIME) || draggingId
      // The slot is re-read from THIS event rather than trusted from state — the drop is the
      // gesture's only authoritative coordinate, and the line the user is looking at was drawn
      // from the same arithmetic on the same geometry.
      const next = readMark(e.currentTarget, e.clientY)
      setDraggingId(null)
      setMark(null)
      if (!moved || next === null || !ids.includes(moved)) return
      if (!dropChangesOrder(ids.indexOf(moved), next.index)) return
      onReorder(moveIdToIndex(ids, moved, next.index))
    },
    [draggingId, ids, onReorder]
  )

  const containerProps = useMemo(
    () => ({ onDragOver, onDragLeave, onDrop }),
    [onDragOver, onDragLeave, onDrop]
  )

  const gripProps = useCallback(
    (id: string) => ({
      draggable: true as const,
      onDragStart: (e: ReactDragEvent<HTMLElement>): void => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(MIME, id)
        e.dataTransfer.setData(MARK_MIME, id)
        // Drag the ROW's image, not the little grip's: the grip is what you grab, the row is what
        // you are moving, and a 20px ghost says the wrong thing about which is which.
        const row = e.currentTarget.closest('[data-testid="alert-row"]')
        if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 16, row.clientHeight / 2)
        setDraggingId(id)
      },
      onDragEnd: (): void => {
        setDraggingId(null)
        setMark(null)
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLElement>): void => {
        const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        if (delta === 0 || e.altKey || e.ctrlKey || e.metaKey) return
        // The arrows would otherwise scroll the list out from under the row being moved.
        e.preventDefault()
        const next = nudgeId(ids, id, delta)
        if (next[ids.indexOf(id)] !== id) onReorder(next)
      }
    }),
    [ids, onReorder]
  )

  return { draggingId, mark, containerProps, gripProps }
}
