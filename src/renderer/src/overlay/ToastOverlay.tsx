// ToastOverlay — the 'toast' overlay kind (docs/plans/celebration-toasts.md).
//
// A transparent strip at the top of the screen that USUALLY RENDERS NOTHING. Main pushes one
// finished payload per celebration (`toast:card`); this component queues, times and dismisses
// it locally. It is a sibling of OverlayMeter / EventLogOverlay in the same overlay.html bundle
// (kind from `?kind=`), so it inherits their per-kind config, their persisted bounds and their
// lock semantics — and, being MUI-free like them, it stays cheap to paint over the game.
//
// ALL THE TIMING IS IN toastQueue.ts, as a pure reducer over an explicit `dtMs`. This file owns
// exactly one interval and one rule about the mouse.
//
// THE MOUSE RULE (T2): the window is PERSISTENT while enabled and fully click-through when the
// queue is empty — an invisible strip must never eat a click meant for the game. The moment a
// card is on screen the renderer asks main to flip `setIgnoreMouseEvents(false)` so hover-pin
// and the reward click work, and it flips back the moment the last card leaves. Only while
// LOCKED: an unlocked (interactive) toast is being positioned, and must keep the pointer.
//
// INTERACTIVE MODE is how you move it. Locked, there is nothing to grab — by design, since the
// window is empty most of the time. Unlocked (Preferences → Overlays → "Move the toast"), the
// strip shows its outline and a drag bar, so "configurable position later" is the mechanism
// every other overlay already has rather than a new one.

import { type JSX, useEffect, useReducer } from 'react'
import type { ToastPayload } from '@shared/toast'
import { ToastCard } from './ToastCard'
import { toastReduce, type ToastCardState } from './toastQueue'
import { useOverlayChrome } from './useOverlayChrome'

/** How often the queue's clocks advance. 100 ms is imperceptible against a 6 s hold and costs
 *  nothing: the reducer returns the SAME array when no card moved, so React re-renders only
 *  when something actually changed. */
const TICK_MS = 100

const GOLD = '#d9b25f'

/** The positioning frame, shown only while the overlay is unlocked. */
function DragFrame({ onDone, noDrag }: { onDone: () => void; noDrag: React.CSSProperties }): JSX.Element {
  return (
    <div
      data-testid="toast-drag-frame"
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
      <span>Drag me where celebrations should appear</span>
      <button
        type="button"
        onClick={onDone}
        style={{
          ...noDrag,
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

/**
 * Keep main's click-through state in step with the queue.
 *
 * PASS-THROUGH IS THE SAFE ANSWER, so it is also the answer BEFORE the persisted config
 * arrives: a transparent strip across the top of the screen that captured the mouse for even a
 * few frames at startup would eat a click aimed at the game, and the user would have no idea
 * what did it. Once the config is known: unlocked (being positioned) keeps the mouse
 * unconditionally; locked captures it only while a card is actually on screen.
 */
function useMouseCapture(ready: boolean, locked: boolean, hasCards: boolean): void {
  useEffect(() => {
    const ignore = !ready ? true : locked ? !hasCards : false
    window.eqOverlay.setIgnoreMouse(ignore)
  }, [ready, locked, hasCards])
}

export default function ToastOverlay(): JSX.Element {
  const chrome = useOverlayChrome()
  const [cards, dispatch] = useReducer(toastReduce, [] as ToastCardState[])

  // A toast overlay with nothing queued renders literally nothing — that empty, transparent,
  // click-through window IS the resting state, and it is why the window can stay open forever.
  useEffect(() => {
    return window.eqOverlay.onToast((payload: ToastPayload) => dispatch({ type: 'show', payload }))
  }, [])

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', dtMs: TICK_MS }), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useMouseCapture(chrome.ready, chrome.locked, cards.length > 0)

  return (
    <div
      data-testid="toast-overlay"
      style={{ width: '100vw', height: '100vh', padding: 6, boxSizing: 'border-box', ...chrome.dragRegion }}
    >
      {chrome.ready && !chrome.locked && <DragFrame onDone={chrome.toggleLock} noDrag={chrome.noDrag} />}
      {cards.map((c) => (
        <ToastCard
          key={c.payload.id}
          payload={c.payload}
          exiting={c.exitingMs !== null}
          bgAlpha={chrome.bgAlpha}
          onHover={(over) => dispatch({ type: 'hover', id: c.payload.id, over })}
        />
      ))}
    </div>
  )
}
