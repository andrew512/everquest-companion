// AlertTextOverlay — the 'alert' overlay kind (docs/plans/alert-text-overlays.md).
//
// A transparent lane that USUALLY RENDERS NOTHING. Main pushes one finished line per firing
// (`alertText:card`); this component stacks, times and drops them locally. It is a sibling of
// OverlayMeter / EventLogOverlay / ToastOverlay in the same overlay.html bundle (kind from
// `?kind=`), so it inherits their per-kind config, their persisted bounds and their lock
// semantics — and, being MUI-free like them, it stays cheap to paint over the game.
//
// ALL THE TIMING IS IN alertTextQueue.ts, as a pure reducer over an explicit `dtMs`. This file
// owns exactly one interval and one rule about the mouse.
//
// THE MOUSE RULE: LOCKED IS ALWAYS CLICK-THROUGH, lines on screen or not. This is the one place
// it differs from the celebration toast, which captures the mouse while a card is up so the card
// can be hovered and clicked. A combat alert must never eat the click you aimed at the mob
// underneath it — so this surface has no hover, no pin and no click target, and pass-through is
// unconditional while locked. It is also the answer BEFORE the config arrives, for the reason the
// toast gives: a transparent window that grabbed the mouse for a few frames at startup would
// swallow a click aimed at the game and nothing on screen would say why.
//
// SO IDLENESS IS SAID OUT LOUD. Because the mouse state no longer implies "drawing nothing", the
// opaque-overlay compatibility mode (JOS-40) learns it from its own signal instead — `setIdle`,
// which is the only reason this window reports anything at all when nobody is looking at it.
//
// INTERACTIVE MODE is how you move it (Preferences → Overlays → "Move it"): the lane shows its
// outline and a drag bar. It has to be, since locked it is empty and click-through and there is
// nothing to grab — the same bind the toast is in, answered the same way.

import { type JSX, useEffect, useReducer } from 'react'
import type { AlertTextCard as Card } from '@shared/alertDisplay'
import { alertStackJustify, alertTextGrowth } from '@shared/alertDisplay'
import AlertTextCard from './AlertTextCard'
import DragFrame from './DragFrame'
import { ScaledContent } from './overlayScale'
import { alertTextReduce, type AlertTextCardState } from './alertTextQueue'
import { useOverlayChrome } from './useOverlayChrome'

/** How often the queue's clocks advance. 100 ms is imperceptible against a multi-second hold and
 *  costs nothing: the reducer returns the SAME array when no line moved, so React re-renders only
 *  when something actually changed. */
const TICK_MS = 100

/**
 * Keep main in step: the mouse (always pass through while locked) and whether this window is
 * drawing anything (which is a different question — see the header).
 */
function useWindowSignals(ready: boolean, locked: boolean, hasCards: boolean): void {
  useEffect(() => {
    window.eqOverlay.setIgnoreMouse(!ready || locked)
  }, [ready, locked])
  useEffect(() => {
    // Unlocked means the drag frame is on screen, which IS something to draw — an opaque window
    // must not hide itself out from under the user who is positioning it.
    window.eqOverlay.setIdle(!ready || (locked && !hasCards))
  }, [ready, locked, hasCards])
}

export default function AlertTextOverlay(): JSX.Element {
  const chrome = useOverlayChrome()
  const [cards, dispatch] = useReducer(alertTextReduce, [] as AlertTextCardState[])

  // An alert overlay with nothing queued renders literally nothing — that empty, transparent,
  // click-through window IS the resting state, and it is why the window can stay open forever.
  useEffect(() => {
    return window.eqOverlay.onAlertText((card: Card) => dispatch({ type: 'show', card }))
  }, [])

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', dtMs: TICK_MS }), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useWindowSignals(chrome.ready, chrome.locked, cards.length > 0)
  const growth = alertTextGrowth(chrome.config?.alertText?.growth)

  return (
    <div
      data-testid="alert-text-overlay"
      /* 100%, NOT 100vw/100vh — a viewport unit inside the scaled lines is resolved against the
         window and then zoomed (overlayScale). */
      /* A flex COLUMN so the stack can be anchored to either edge — see `growth` below. The drag
         frame stays first either way; only the block of lines moves. */
      style={{
        width: '100%',
        height: '100%',
        padding: 6,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        ...chrome.dragRegion
      }}
    >
      {/* The drag frame is CHROME: unscaled, so "Done" stays inside the lane at a 2.0 text scale.
          It carries NO text-size stepper, unlike the toast's: a text alert's size is per-alert
          (`display.fontSize`, in the editor), and a second control that scaled all of them at
          once would be two answers to one question. */}
      {chrome.ready && !chrome.locked && (
        <DragFrame
          // Says BOTH things it can do, because this frame is the only chrome the lane ever shows:
          // locked it is empty and click-through, so an affordance the user cannot see is one they
          // will never find. Stretching is the point of the width (overlayLayout.overlaySizeLimits).
          caption="Drag me where alert text should appear, or stretch my edges"
          testId="alert-text-drag-frame"
          onDone={chrome.toggleLock}
          noDrag={chrome.noDrag}
        />
      )}
      {/* An empty lane while unlocked would leave nothing but the bar, so the user gets a sample
          of what will appear here — state, not instructions. */}
      {chrome.ready && !chrome.locked && cards.length === 0 && (
        <div style={{ textAlign: 'center', color: '#8b8f98', fontSize: 12 }}>
          Alert text appears here
        </div>
      )}
      {/* WHICH WAY THE LANE GROWS. The block is anchored to the top ('down', the shipped answer)
          or to the bottom ('up'), and that is the entire difference — arrival order is still
          render order, so the newest line is always the one nearest the growing edge. Read off
          this window's OWN config, which is what `chrome.config` is for.

          It takes the leftover height (`flex: 1`, `minHeight: 0` so it may also be SHORTER than
          its lines) and clips, so a lane holding more text than it is tall loses the line furthest
          from the growing edge rather than spilling over the drag bar. */}
      <div
        data-testid="alert-text-stack"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: alertStackJustify(growth),
          overflow: 'hidden'
        }}
      >
        <ScaledContent textScale={chrome.textScale}>
          {cards.map((c) => (
            <AlertTextCard
              key={c.card.id}
              card={c.card}
              exiting={c.exitingMs !== null}
              bgAlpha={chrome.bgAlpha}
            />
          ))}
        </ScaledContent>
      </div>
    </div>
  )
}
