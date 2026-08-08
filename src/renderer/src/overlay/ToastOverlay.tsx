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
import DragFrame from './DragFrame'
import { ScaledContent } from './overlayScale'
import { toastReduce, type ToastCardState } from './toastQueue'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayChrome } from './useOverlayChrome'

/** How often the queue's clocks advance. 100 ms is imperceptible against a 6 s hold and costs
 *  nothing: the reducer returns the SAME array when no card moved, so React re-renders only
 *  when something actually changed. */
const TICK_MS = 100

/**
 * Keep main's click-through state in step with the queue, and tell it when this window is drawing
 * nothing.
 *
 * PASS-THROUGH IS THE SAFE ANSWER, so it is also the answer BEFORE the persisted config
 * arrives: a transparent strip across the top of the screen that captured the mouse for even a
 * few frames at startup would eat a click aimed at the game, and the user would have no idea
 * what did it. Once the config is known: unlocked (being positioned) keeps the mouse
 * unconditionally; locked captures it only while a card is actually on screen.
 *
 * THE IDLE SIGNAL IS THE SAME EXPRESSION, and it is sent separately on purpose. Main used to
 * INFER "drawing nothing" from the ignore-mouse call, because for this window the two happen to
 * coincide. They do not coincide for an alert text overlay, which stays click-through whether or
 * not it is drawing — so idleness is now stated rather than deduced (JOS-40's opaque-window
 * hide reads it). This window's behaviour is unchanged: same condition, said out loud.
 */
function useMouseCapture(ready: boolean, locked: boolean, hasCards: boolean): void {
  useEffect(() => {
    const idle = !ready ? true : locked ? !hasCards : false
    window.eqOverlay.setIgnoreMouse(idle)
    window.eqOverlay.setIdle(idle)
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
      /* 100%, NOT 100vw/100vh — a viewport unit inside the scaled cards is resolved against the
         window and then zoomed (overlayScale). */
      style={{ width: '100%', height: '100%', padding: 6, boxSizing: 'border-box', ...chrome.dragRegion }}
    >
      {/* The drag frame is CHROME: unscaled, so "Done" and A− / A+ stay inside the strip at 2.0
          — the one route to both knobs must not be the thing the scale pushes off screen. */}
      {chrome.ready && !chrome.locked && (
        <DragFrame
          caption="Drag me where celebrations should appear"
          testId="toast-drag-frame"
          onDone={chrome.toggleLock}
          noDrag={chrome.noDrag}
        >
          {/* The TEXT SIZE lives here for the same reason the drag handle does: this frame is the
              only chrome the toast ever shows, so Preferences → Overlays → "Move it" is the whole
              route to both knobs. Move it, size it, Done. */}
          <TextScaleStepper textScale={chrome.textScale} patch={chrome.patch} noDrag={chrome.noDrag} />
        </DragFrame>
      )}
      {/* The cards ARE the content — no scroll pane, because this kind renders nothing most of
          the time and a strip that could scroll would be a window, which is what it is not. */}
      <ScaledContent textScale={chrome.textScale}>
        {cards.map((c) => (
          <ToastCard
            key={c.payload.id}
            payload={c.payload}
            exiting={c.exitingMs !== null}
            bgAlpha={chrome.bgAlpha}
            onHover={(over) => dispatch({ type: 'hover', id: c.payload.id, over })}
          />
        ))}
      </ScaledContent>
    </div>
  )
}
