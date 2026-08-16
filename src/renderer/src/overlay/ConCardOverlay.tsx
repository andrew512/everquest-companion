// ConCardOverlay — the 'conCard' overlay kind (JOS-383, shared/conCard.ts).
//
// A transparent strip near the top of the screen that USUALLY RENDERS NOTHING. Main sends one
// finished card per `/con` (`con:card`); this component holds it, times it and lets it go. It is a
// sibling of ToastOverlay and AlertBannerOverlay in the same overlay.html bundle (kind from
// `?kind=`), so it inherits the per-kind config, the persisted bounds and the lock semantics every
// overlay has — and, being MUI-free like them, it stays cheap to paint over the game.
//
// THE QUEUE IS THE SHARED ONE (cardQueue.ts), AT A CAP OF EXACTLY ONE. That cap is not a limit, it
// is the design: "every con REPLACES the card's content" is precisely what a one-deep queue does —
// a new arrival evicts the one on screen, and a re-con of the SAME mob refreshes the card already
// there instead of stacking a duplicate (the payload id is the mob key).
//
// THE AUTO-HIDE IS THE ONE KNOB, AND ZERO MEANS NEVER. `autoHideMs: 0` becomes an infinite hold, so
// the card sits there until the next con replaces it or the user closes it. Infinity lives HERE and
// never on the wire: the reducer subtracts it every tick and the card simply never expires.
//
// CLOSING IS TWO THINGS AT ONCE. Locally the card is dismissed; remotely main is told, because main
// owns the rule this window cannot see — a re-con of the same creature inside a minute must not put
// it back up (`CON_CARD_REOPEN_SUPPRESS_MS`). An auto-hide is NOT a close and says nothing: the
// card leaving by itself is not the user saying they have read it.
//
// INTERACTIVE MODE IS HOW YOU MOVE IT, exactly as it is for the other two strips: locked there is
// nothing to grab, and unlocked the window shows a drag frame carrying the text-size stepper.

import { type JSX, useEffect, useReducer, useRef } from 'react'
import { DEFAULT_CON_CARD_CONFIG, type ConCardOverlayConfig, type ConCardPayload } from '@shared/conCard'
import type { OverlayConfig } from '@shared/types'
import { ConCard } from './ConCard'
import { ScaledContent } from './overlayScale'
import { cardReduce, useCardTick, useQueueMouseCapture, useUnpinOnPointerExit } from './cardQueue'
import type { CardAction, CardState } from './cardQueue'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayChrome, type OverlayChrome } from './useOverlayChrome'

const GOLD = '#d9b25f'

/** One card at a time, by design — see the header. */
const CAP = 1

type ConAction = CardAction<ConCardPayload>
type ConState = CardState<ConCardPayload>[]

/** This kind's knob, always complete: main normalizes it, and an unhydrated window uses the same
 *  default main would have filled in. */
function conCardConfig(config: OverlayConfig | null): ConCardOverlayConfig {
  return config?.conCard ?? DEFAULT_CON_CARD_CONFIG
}

/** The hold one card gets. Zero on the config is the owner's "never", which is an infinite hold. */
export function holdFor(cfg: ConCardOverlayConfig): number {
  return cfg.autoHideMs > 0 ? cfg.autoHideMs : Number.POSITIVE_INFINITY
}

/**
 * The positioning frame, shown only while the overlay is unlocked — the banner's DragFrame with
 * this window's own words, and for the same reason: this kind renders nothing between cons, so the
 * frame is the only chrome it ever shows and the text size has nowhere else to live.
 */
function DragFrame({
  onDone,
  textScale,
  patch,
  noDrag
}: {
  onDone: () => void
  textScale: number
  patch: OverlayChrome['patch']
  noDrag: React.CSSProperties
}): JSX.Element {
  return (
    <div
      data-testid="con-card-drag-frame"
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
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Drag me where mob cards should appear
      </span>
      <TextScaleStepper textScale={textScale} patch={patch} noDrag={noDrag} />
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

/**
 * Subscribe to the cards main pushes.
 *
 * THE HOLD IS READ AT ARRIVAL, through a ref, so a user who changes the auto-hide in Preferences
 * sees it apply to the very next `/con` without this effect re-subscribing (and therefore without
 * dropping a card in the gap) — the banner's arrangement, for the same reason.
 */
function useCardFeed(cfg: ConCardOverlayConfig, dispatch: (a: ConAction) => void): void {
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  useEffect(() => {
    return window.eqOverlay.onConCard((payload: ConCardPayload) => {
      dispatch({ type: 'show', payload, holdMs: holdFor(cfgRef.current), cap: CAP })
    })
  }, [dispatch])
}

export default function ConCardOverlay(): JSX.Element {
  const chrome = useOverlayChrome()
  const [cards, dispatch] = useReducer(cardReduce<ConCardPayload>, [] as ConState)
  const cfg = conCardConfig(chrome.config)
  useCardFeed(cfg, dispatch)
  useCardTick(cards.length > 0, () => dispatch({ type: 'tick', dtMs: 100 }))
  useQueueMouseCapture(chrome.ready, chrome.locked, cards.length > 0)
  // A pointer that left without saying so must not leave a card pinned forever (JOS-381) — and a
  // card with an INFINITE hold is exactly the case that would never recover from it.
  useUnpinOnPointerExit(cards, dispatch)

  return (
    <div
      data-testid="con-card-overlay"
      /* 100%, NOT 100vw/100vh — a viewport unit inside the scaled card is resolved against the
         window and then zoomed (overlayScale). */
      style={{ width: '100%', height: '100%', padding: 6, boxSizing: 'border-box', ...chrome.dragRegion }}
    >
      {/* The drag frame is CHROME: unscaled, so "Done" and A- / A+ stay inside the window at 2.0. */}
      {chrome.ready && !chrome.locked && (
        <DragFrame
          onDone={chrome.toggleLock}
          textScale={chrome.textScale}
          patch={chrome.patch}
          noDrag={chrome.noDrag}
        />
      )}
      <ScaledContent textScale={chrome.textScale}>
        {cards.map((c) => (
          <ConCard
            key={c.payload.id}
            payload={c.payload}
            exiting={c.exitingMs !== null}
            bgAlpha={chrome.bgAlpha}
            onHover={(over) => dispatch({ type: 'hover', id: c.payload.id, over })}
            onDismiss={() => {
              dispatch({ type: 'dismiss', id: c.payload.id })
              // Main owns the minute-long suppression; this is the only place it can learn that
              // the user closed THIS mob's card rather than the card simply timing out.
              window.eqOverlay.closeConCard(c.payload.id)
            }}
          />
        ))}
      </ScaledContent>
    </div>
  )
}
