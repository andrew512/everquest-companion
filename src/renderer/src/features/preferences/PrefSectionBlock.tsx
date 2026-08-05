// PrefSectionBlock — one Preferences section as it is drawn, plus the ARRIVAL PULSE.
//
// Its own file for the reason PerfSetting's descriptor is: PreferencesView.tsx sits at the
// repo's 400-code-line factoring ceiling, and the answer to that is a split, not a threshold.
// This is a coherent piece to split off — everything about how a section LOOKS when you land on
// it, with PreferencesView keeping what the sections ARE and which one is showing.
//
// WHY THE PULSE EXISTS. A deep link ("Set up in Preferences" on an alert row, the telemetry
// notice's details link) opens this view already switched to the right section — correctly, and
// completely silently. The user clicked a sentence about voices in one tab and got a settings
// page in another, with nothing connecting the two ends; the section they were sent to looks
// exactly like the section they would have reached by hand. The pulse is that connection: the
// landed cards breathe an accent outline twice and settle. Long enough to be seen, short enough
// that it never becomes decoration, and one-shot state rather than a style (PreferencesView
// clears it on a timer).
//
// REDUCED MOTION KEEPS THE INFORMATION, NOT THE MOVEMENT. Under `prefers-reduced-motion: reduce`
// the animation is replaced by a plain static outline held for the same interval, so "which of
// these is the thing I clicked" still has an answer.

import { type JSX, useEffect, useState } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { PrefSection } from './PreferencesView'

/** The landing highlight. See the header for why it is two pulses and why reduced motion differs. */
const PULSE_SX = {
  '@keyframes eqcPrefsLand': {
    '0%': { boxShadow: '0 0 0 0 rgba(144,202,249,0)', borderColor: 'divider' },
    '25%': { boxShadow: '0 0 0 3px rgba(144,202,249,0.45)', borderColor: 'primary.main' },
    '100%': { boxShadow: '0 0 0 0 rgba(144,202,249,0)', borderColor: 'divider' }
  },
  animation: 'eqcPrefsLand 900ms ease-out 2',
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    borderColor: 'primary.main',
    boxShadow: '0 0 0 2px rgba(144,202,249,0.35)'
  }
} as const

/** How long the arrival highlight stays up. Two 900 ms pulses, then it is gone. */
const LAND_HIGHLIGHT_MS = 1800

/**
 * True for the first `LAND_HIGHLIGHT_MS` after arriving via section routing, then null forever.
 *
 * Keyed off `section` rather than off mount so it is honest in both directions: App re-keys the
 * view per deep link (so clicking the same link twice pulses twice), and a plain visit to
 * Preferences — `section` null — never pulses at all, because nothing sent the user anywhere in
 * particular and a highlight would be pointing at nothing.
 */
export function useLandedSection(section: string | null): string | null {
  const [landed, setLanded] = useState(section)
  useEffect(() => {
    if (section === null) return undefined
    setLanded(section)
    const timer = setTimeout(() => setLanded(null), LAND_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [section])
  return landed
}

/** One section header plus its settings cards. `landed` runs the arrival pulse above. */
export default function PrefSectionBlock({
  section,
  landed = false
}: {
  section: PrefSection
  landed?: boolean
}): JSX.Element {
  return (
    <Box data-testid={`prefs-section-${section.id}`} data-landed={landed ? 'true' : undefined}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', letterSpacing: 1, mb: 0.5 }}
      >
        {section.label}
      </Typography>
      <Stack spacing={1.5}>
        {section.items.map((i) => (
          <Paper key={i.id} variant="outlined" sx={{ p: 1.5, ...(landed ? PULSE_SX : {}) }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {i.label}
            </Typography>
            {i.content}
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
