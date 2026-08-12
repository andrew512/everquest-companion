// AlertLanePreview — what an alert text lane shows while you are POSITIONING it
// (docs/plans/alert-text-overlays.md §5).
//
// THE PROBLEM THIS SOLVES. The lane is transparent, empty at rest and click-through, so the only
// moment its size can be decided is while it is unlocked — and until now that moment showed a drag
// bar and one line of grey helper text. That answers "where is it", which was never the hard
// question. The hard question is HOW MUCH FITS: how wide before a raid call wraps, how tall before
// the fourth stacked alert is off the bottom.
//
// SO THE PREVIEW IS THE REAL THING. The samples are drawn by the SAME component that draws a real
// alert (AlertTextCard), in the lane's own font, size and colour, inside the same stack that
// anchors to the same edge. Nothing here is a mock-up of the surface — it IS the surface, holding
// lines that have not happened yet. One of them is long enough to wrap, because a preview made
// only of short phrases is how someone sizes a lane that cannot hold what they actually wrote.
//
// AND THE SIZE IS SAID OUT LOUD, in the drag bar, in the window's own pixels: a transparent
// rectangle over a game gives the eye nothing to measure against, and "1240 × 480" is the number
// somebody matching a lane to a UI element they already have is looking for.

import { type JSX, useEffect, useState } from 'react'
import type { AlertTextDefaults } from '@shared/alertDisplay'
import { alertPreviewCards } from '@shared/alertDisplay'
import AlertTextCard from './AlertTextCard'

/** The window's own content box, in CSS pixels, kept current as it is dragged bigger. */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    // The first paint can land before the window has been given its persisted bounds, so read once
    // more on mount rather than trusting the value the state was initialised with.
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** The live dimensions, for the drag bar. STATE, not instructions — it says what the lane IS. */
export function LaneSizeReadout(): JSX.Element {
  const { width, height } = useWindowSize()
  return (
    <span
      data-testid="alert-text-size"
      style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', opacity: 0.9 }}
    >
      {width} × {height}
    </span>
  )
}

/**
 * The sample lines themselves. `bgAlpha` is passed through so a user who gave this lane a panel
 * sees the panel while they size it — the preview must not be prettier than the real thing.
 */
export function LaneSamples({
  defaults,
  bgAlpha
}: {
  defaults: AlertTextDefaults
  bgAlpha: number
}): JSX.Element {
  return (
    <>
      {alertPreviewCards(defaults).map((card) => (
        <AlertTextCard key={card.id} card={card} exiting={false} bgAlpha={bgAlpha} testId="alert-text-sample" />
      ))}
    </>
  )
}
