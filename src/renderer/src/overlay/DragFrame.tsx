// DragFrame — the positioning chrome a NOTIFIER overlay shows while it is unlocked.
//
// WHY A NOTIFIER NEEDS ONE AT ALL. A meter has a header you can grab and a footer to hang knobs
// off. A notifier (the celebration strip, an alert text lane — shared/alertOverlays.ts) renders
// NOTHING most of the time and is click-through when locked, so there is no moment at which it
// has anything on screen to drag. Unlocking is the whole answer: the window shows its outline and
// this bar, you put it where you want it, you press Done.
//
// Extracted from ToastOverlay.tsx when alert text overlays became the second kind that needs it.
// The toast's version is unchanged in every pixel — it simply passes its caption, its testid and
// its TextScaleStepper as the middle slot.
//
// THE FRAME IS UNSCALED, deliberately: the caller renders it outside its `ScaledContent`, so
// "Done" stays inside the window at a 2.0 text scale. The one route to positioning must not be
// the thing the scale pushes off screen.

import type { CSSProperties, JSX, ReactNode } from 'react'

const GOLD = '#d9b25f'

export default function DragFrame({
  caption,
  testId,
  onDone,
  noDrag,
  children
}: {
  /** What this window is for, in the user's terms ("Drag me where …"). */
  caption: string
  testId: string
  onDone: () => void
  /** `-webkit-app-region: no-drag`, so the controls are clickable inside a draggable window. */
  noDrag: CSSProperties
  /** Optional extra control between the caption and Done (the toast's text-size stepper). */
  children?: ReactNode
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 8,
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px dashed ${GOLD}`,
        background: 'rgba(15,17,21,0.65)',
        color: GOLD,
        fontSize: 11
      }}
    >
      {/* The PROSE is the give on a narrow strip; the controls beside it are the whole point of
          the frame and stay whole at every width. */}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {caption}
      </span>
      {children}
      <button
        type="button"
        onClick={onDone}
        style={{
          ...noDrag,
          flexShrink: 0,
          border: `1px solid ${GOLD}`,
          borderRadius: 4,
          background: 'transparent',
          color: GOLD,
          fontSize: 11,
          padding: '2px 8px',
          cursor: 'pointer'
        }}
      >
        Done
      </button>
    </div>
  )
}
