// ResizeGrip — the corner handle a NOTIFIER overlay shows while it is unlocked.
//
// WHY A HANDLE EXISTS WHEN THE OS ALREADY RESIZES WINDOWS. A meter has a header to grab, so its
// body is not a drag region and its edges are free for the OS resize border. A notifier has no
// chrome at all (DragFrame.tsx says why), so its WHOLE surface is `-webkit-app-region: drag` — and
// what is left of the resize border is a few pixels at the very edge of a window that is
// transparent and mostly empty. That is a target nobody finds, on the one kind whose size is the
// setting that matters: how much text fits, and how many lines you can see at once.
//
// IT DRIVES THE WINDOW, NOT A LAYOUT. Each move asks main for an absolute size measured from where
// the drag started, so a size that gets clamped (the kind's minimum) and then dragged back out
// tracks the pointer again exactly — an incremental delta would have lost what it clipped. Main is
// the only one that resizes anything, and it re-checks the numbers (ipc/windowControls.ts).
//
// THE ANCHOR IS THE TOP-LEFT CORNER, which is why this handle is at the bottom-right: the corner
// you placed the window by must not move because you made it bigger.

import { type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent, useRef } from 'react'

const GOLD = '#d9b25f'
/** Big enough to hit without aiming, small enough not to sit on top of a line of alert text. */
const SIZE = 18

/** Where the drag began: the pointer on screen, and the window it was pulling. */
interface Grab {
  x: number
  y: number
  width: number
  height: number
}

export default function ResizeGrip({
  noDrag,
  onResize,
  testId
}: {
  /** `-webkit-app-region: no-drag`: without it this corner would MOVE the window, not size it. */
  noDrag: CSSProperties
  onResize: (size: { width: number; height: number }) => void
  testId: string
}): JSX.Element {
  const grab = useRef<Grab | null>(null)

  const begin = (e: ReactPointerEvent<HTMLDivElement>): void => {
    grab.current = { x: e.screenX, y: e.screenY, width: window.innerWidth, height: window.innerHeight }
    // Keeps the moves coming when the pointer runs ahead of the corner it is dragging, which on a
    // fast pull is most of them. Not every environment grants it, and the drag still works from
    // the moves that do land inside the window, so a refusal is not worth failing the gesture for.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture available — the moves inside the window still drive it */
    }
  }

  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = grab.current
    if (!g) return
    onResize({ width: g.width + (e.screenX - g.x), height: g.height + (e.screenY - g.y) })
  }

  const end = (e: ReactPointerEvent<HTMLDivElement>): void => {
    grab.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* nothing was captured */
    }
  }

  return (
    <div
      data-testid={testId}
      title="Drag to resize"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        ...noDrag,
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: SIZE,
        height: SIZE,
        cursor: 'nwse-resize',
        // Two strokes reading as a corner, the way every resize grip has since Aqua. Drawn rather
        // than imported: the overlay bundle carries no icon set and this is two gradients.
        background: `linear-gradient(135deg, transparent 45%, ${GOLD} 45%, ${GOLD} 55%, transparent 55%),
                     linear-gradient(135deg, transparent 70%, ${GOLD} 70%, ${GOLD} 80%, transparent 80%)`,
        borderBottomRightRadius: 6
      }}
    />
  )
}
