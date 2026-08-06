// overlayScale — WHERE THE TEXT SIZE IS APPLIED, and the only place it is.
//
// An overlay window is two layers with different jobs, and the scale belongs to exactly one:
//
//   CONTROL CHROME (header + selector, footer, the toast's drag frame) lays out at scale 1
//   against the REAL window width. It is what you reach for when a window is wrong — the lock,
//   the alpha slider, A− / A+ itself — so it can never be the thing that grows out of the
//   window. Scaling it is what the first cut of this feature did (a CSS zoom on #overlay-root),
//   and at 2.0 on a narrow overlay the footer walked off the right edge with A− on it.
//
//   CONTENT (the bars, the feed rows, the toast cards) is the reading matter the scale is FOR,
//   and it is the only thing zoomed.
//
// CSS `zoom`, not `transform: scale()`: zoom participates in layout, so an auto-width child
// resolves its width against the pane divided by the zoom and fills it at every scale — the rows
// REFLOW instead of a magnified bitmap hanging off the pane's edge. Height it cannot fix, which
// is what the scroll pane below is for: at 2.0 you get fewer rows on screen, not fewer rows.
//
// MUI-FREE like the rest of this bundle.

import type { JSX } from 'react'

/** The zoomed box. Nothing inside it may size itself in viewport units — a `vw`/`vh` resolves
 *  against the WINDOW and is then multiplied by the zoom, i.e. past the pane it lives in. */
export function ScaledContent({
  textScale,
  children
}: {
  textScale: number
  children: React.ReactNode
}): JSX.Element {
  return <div style={{ zoom: textScale }}>{children}</div>
}

/**
 * The scrolling content pane the three list-shaped kinds put their rows in: it takes the room the
 * chrome leaves (`flexGrow` + `minHeight: 0`, so a flex child actually shrinks) and scrolls what
 * does not fit — every row the meter has, at whatever size it is being read at.
 *
 * `overflowX: hidden` because the rows ellipsize rather than run wide, and a horizontal bar here
 * would eat a row's worth of height to say nothing.
 *
 * SCROLLING IS AN UNLOCKED-MODE AFFAIR by construction: a locked overlay is click-through, so
 * nothing reaches its scroller. That is the same trade the drill-down already makes — locked
 * shows you what is pinned, unlocked is where you go digging.
 */
export function OverlayContent({
  textScale,
  testId,
  children
}: {
  textScale: number
  testId?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 6px' }}
    >
      <ScaledContent textScale={textScale}>{children}</ScaledContent>
    </div>
  )
}

/**
 * The text scale in force at `el` — i.e. the zoom the components above set on the content pane.
 *
 * WHY A MEASURE-THEN-PLACE LAYER NEEDS IT. `getBoundingClientRect()` reports VISUAL pixels (the
 * zoom is already in them), while a pixel written back into `top`/`left` inside the zoomed
 * subtree is multiplied by that same zoom on the way to the screen. Divide once, at the boundary
 * between the two spaces, and the feed's hover card lands on the row it belongs to at every
 * scale; skip it and at 1.5 it lands half a window off.
 *
 * ONE caller today (hoverCardLayer): it is the only `position: fixed` layer rendered INSIDE the
 * content pane. The selector popup hangs off the header, which is chrome and therefore unscaled,
 * so it measures and places in one space and converts nothing.
 *
 * Read from the ELEMENT rather than from the config: this is the value the engine actually
 * applied, so a layer that is somehow outside the zoomed subtree measures 1 and is left alone.
 */
export function overlayCssZoom(el: Element | null | undefined): number {
  const z = el?.currentCSSZoom ?? 1
  return z > 0 ? z : 1
}
