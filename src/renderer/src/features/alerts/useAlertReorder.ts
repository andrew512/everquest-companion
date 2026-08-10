// useAlertReorder — the drag gesture behind the alerts list's own order (JOS-175).
//
// WHAT THE USER GETS: a grip at the left edge of every alert row. Drag a row onto another and it
// takes that row's place; the order is written through main and is the order the list is in the
// next time the app opens. Reorder ONLY — no folders, no groups (owner ruling, 2026-08-09).
//
// THE GRIP IS ALSO A BUTTON. Native HTML5 drag is pointer-only, and a list you can only reorder
// by dragging is a list some people cannot reorder at all — so the same grip takes ArrowUp /
// ArrowDown and nudges the row one place, which is the shape the e2e drives too (a keypress is a
// condition; a synthesized drag is a bet on the compositor). Both paths end in the same call.
//
// WHY NATIVE DRAG AND NOT A LIBRARY: this repo ships no drag-and-drop dependency, and the whole
// gesture is three handlers over a list that is already keyed by id. `dataTransfer` carries the
// id so a drop can be read even from a re-render, and `effectAllowed`/`dropEffect` are set on both
// ends because Chromium refuses the drop otherwise.
//
// THE ORDER MATH LIVES IN `@shared/alertOrder` — the same `moveId`/`nudgeId` main re-derives with,
// so the row you see land is the row that gets stored.

import { useCallback, useMemo, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { moveId, nudgeId } from '@shared/alertOrder'
import type { AlertDef } from '@shared/types'

/** What a row needs to be a drop target, and the grip needs to start a drag. */
export interface AlertReorder {
  /** The row being dragged right now, or null. Rows use it to dim themselves. */
  draggingId: string | null
  /** The row the pointer is currently over mid-drag, or null. Rows use it to show the landing. */
  overId: string | null
  /** Props for the row container (the drop target). */
  rowProps: (id: string) => {
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void
    onDragLeave: () => void
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
  const [overId, setOverId] = useState<string | null>(null)
  const ids = useMemo(() => alerts.map((a) => a.id), [alerts])

  const rowProps = useCallback(
    (id: string) => ({
      onDragOver: (e: ReactDragEvent<HTMLElement>): void => {
        // preventDefault is what MAKES an element a drop target in HTML5 drag — without it the
        // drop never fires and the whole gesture silently does nothing.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOverId((prev) => (prev === id ? prev : id))
      },
      onDragLeave: (): void => {
        setOverId((prev) => (prev === id ? null : prev))
      },
      onDrop: (e: ReactDragEvent<HTMLElement>): void => {
        e.preventDefault()
        // The id off the transfer first: it survives a re-render that dropped our state, and it is
        // the only reading that is true for a drag that started in this list.
        const moved = e.dataTransfer.getData(MIME) || draggingId
        setDraggingId(null)
        setOverId(null)
        if (!moved || moved === id || !ids.includes(moved)) return
        onReorder(moveId(ids, moved, id))
      }
    }),
    [draggingId, ids, onReorder]
  )

  const gripProps = useCallback(
    (id: string) => ({
      draggable: true as const,
      onDragStart: (e: ReactDragEvent<HTMLElement>): void => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(MIME, id)
        // Drag the ROW's image, not the little grip's: the grip is what you grab, the row is what
        // you are moving, and a 20px ghost says the wrong thing about which is which.
        const row = e.currentTarget.closest('[data-testid="alert-row"]')
        if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 16, row.clientHeight / 2)
        setDraggingId(id)
      },
      onDragEnd: (): void => {
        setDraggingId(null)
        setOverId(null)
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

  return { draggingId, overId, rowProps, gripProps }
}
