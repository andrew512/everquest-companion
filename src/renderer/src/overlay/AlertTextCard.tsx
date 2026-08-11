// AlertTextCard — ONE line of alert text, drawn the way its alert asked
// (docs/plans/alert-text-overlays.md).
//
// Everything about how it looks arrived in the payload: main resolved and clamped the font, the
// size and the colour, so this component decides nothing and looks nothing up. That is the same
// contract ToastCard has, and for the same reason — the overlay bundle is MUI-free and fetches
// nothing.
//
// LEGIBILITY COMES FROM THE SHADOW, NOT FROM A PANEL. This kind's `bgAlpha` defaults to 0: a
// text alert is a line over the game, not a box on top of it, and dimming the fight to read a
// four-word warning is the wrong trade. The double shadow (a tight dark drop plus a soft halo) is
// what keeps light text on light game art readable without one. A user who does want a panel
// still has the alpha in their store, so it is honoured rather than hard-coded away.
//
// THE MOTION IS COMPOSITOR-ONLY — opacity and transform, never layout — because this paints over
// a running game (ToastCard's rule, unchanged).

import { type CSSProperties, type JSX, useEffect, useState } from 'react'
import type { AlertTextCard as Card } from '@shared/alertDisplay'
import { alertFontStack } from '@shared/alertDisplay'
import { ALERT_TEXT_EXIT_MS } from './alertTextQueue'

/** Slide-in distance. Small: a line that travels far reads as decoration, not as an alert. */
const ENTER_SHIFT_PX = 6
const ENTER_MS = 160

function motionStyle(entering: boolean, exiting: boolean): CSSProperties {
  return {
    opacity: entering || exiting ? 0 : 1,
    transform: entering ? `translateY(-${String(ENTER_SHIFT_PX)}px)` : 'translateY(0)',
    transition: `opacity ${String(exiting ? ALERT_TEXT_EXIT_MS : ENTER_MS)}ms ease, transform ${String(ENTER_MS)}ms ease`
  }
}

export default function AlertTextCard({
  card,
  exiting,
  bgAlpha
}: {
  card: Card
  exiting: boolean
  /** The overlay's panel alpha. 0 (this kind's default) means no panel at all. */
  bgAlpha: number
}): JSX.Element {
  // True for exactly one frame, so the browser has a FROM state to animate out of. Without it the
  // line simply appears at its final opacity and the enter transition never runs.
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      data-testid="alert-text-card"
      style={{
        fontFamily: alertFontStack(card.font),
        fontSize: card.fontSize,
        color: card.color,
        fontWeight: 700,
        lineHeight: 1.25,
        textAlign: 'center',
        // A long line WRAPS rather than being clipped: the text was already capped upstream, and
        // half a warning is worse than two lines of one.
        overflowWrap: 'anywhere',
        textShadow: '0 1px 2px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85)',
        ...(bgAlpha > 0
          ? { background: `rgba(15,17,21,${String(bgAlpha)})`, borderRadius: 6, padding: '2px 8px' }
          : {}),
        marginBottom: 4,
        ...motionStyle(entering, exiting)
      }}
    >
      {card.text}
    </div>
  )
}
