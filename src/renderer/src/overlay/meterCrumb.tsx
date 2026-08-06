// THE METER'S CRUMB ROW — the one line above an overlay meter's bars, on every meter kind.
//
// It carries TWO things, and it is the only place either of them lives (owner ruling, 2026-08-05
// — JOS-35):
//
//   THE WAY OUT. A back chevron whenever there is a level to go back TO — damage-fight,
//   damage-overall, heal-fight and heal-overall alike. It used to be four hand-rolled crumbs with
//   four different opinions: healBars offered Back unconditionally at level 2, while meterBars
//   withheld it whenever the drilled subject happened to be the level the meter had opened on
//   (`canLeave`, added in 9d5df44) — which, with the pet preference on, was ALWAYS. Two of the
//   four kinds could not be zoomed out at all. One component, one rule, no per-kind opinions.
//
//   THE FIGHT TIMER. It moved DOWN here out of the header, which now states the subject and the
//   rate and nothing else — a 380px-wide header holding a live dot, a kind tag, a scope chip, a
//   name, a chevron, a clock, a rate and two icon buttons had no room left for the one thing it
//   is for (the fight's NAME). The clock is the same `SegmentView.durationSec` it always was,
//   printed by the same `fmtDur`; it just sits on a line with room for it.
//
// LOCKED MODE passes `onBack: null` — the same row renders, with no chevron, no pointer and no
// hit target, because a click-through window may not offer an affordance it cannot deliver.
//
// MUI-FREE ON PURPOSE: the overlay is its own renderer entry (overlay.html) with no theme and no
// component library. Plain React + inline styles, like every file in this bundle.

import type { JSX, ReactNode } from 'react'

export function MeterCrumb({
  name,
  dur,
  onBack,
  children
}: {
  /** the drilled subject, or null at level 1 — there is no subject and nowhere to go back to. */
  name: string | null
  /** the selected segment's length, already formatted (`3:33`). */
  dur: string
  /** null ⇒ locked, or already at the outermost level: the row renders inert. */
  onBack: (() => void) | null
  children: ReactNode
}): JSX.Element {
  return (
    <div>
      <div
        data-testid="overlay-crumb"
        onClick={onBack ?? undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: onBack ? 'pointer' : 'default',
          fontSize: 11,
          color: 'rgba(255,255,255,0.7)',
          marginBottom: 3
        }}
      >
        {name !== null && (
          <>
            <span style={{ fontSize: 13 }} title={onBack ? 'Back' : undefined}>
              {onBack ? '‹' : '·'}
            </span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          </>
        )}
        {/* Hard right, and the last thing on the line, so the subject keeps the width it needs
            and the clock always sits in the same place whichever level you are on. */}
        <span
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            color: 'rgba(255,255,255,0.5)',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {dur}
        </span>
      </div>
      {children}
    </div>
  )
}
