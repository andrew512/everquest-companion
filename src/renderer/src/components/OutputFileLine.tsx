// components/OutputFileLine.tsx — ONE LINE THAT SAYS WHERE A SURFACE'S DATA CAME FROM AND HOW TO
// REFRESH IT (JOS-42 refinement 5).
//
// THE PROBLEM IT SOLVES. Several surfaces in this app are fed by a file the PLAYER writes with an
// `/outputfile <kind>` command — the Exaltations tab's worn hosts today, and whatever JOS-44's
// export-command work adopts next. Those surfaces have a failure mode that looks exactly like
// success: the data renders, it is simply OLD, because the dump is a snapshot from whenever the
// command was last typed. Nothing on screen said so. A player who swapped gear an hour ago saw
// last week's loadout presented with total confidence.
//
// SO THE LINE STATES THREE THINGS AND STOPS: the command to type, ONE clause of why it is worth
// typing, and how old the file is. That last one is the whole point — it is read from the file's
// own mtime, so it is WHEN THE PLAYER DUMPED, never when the app read it.
//
// IT IS NOT A CAVEAT, and the tooltip-and-caveat diet is why it looks like this. It does not
// apologise for the data, footnote where a number came from, or explain how the parser works; it
// is a control surface for an action the player takes in game, with the freshness as ambient
// state (the `formatAge` idiom the update chip established). One row, `nowrap`, the why-clause the
// only group allowed to ellipsize.
//
// SHARED BY CONSTRUCTION rather than by refactor-later: it takes the command and the clause as
// props and knows nothing about inventories, so a second `/outputfile` surface adopts it by
// importing it (JOS-44's sequencing note — whichever of us landed second was to use the other's).

import { type JSX, useEffect, useState } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { formatAge, formatDateTime } from '../lib/formatDate'

/** How often the age re-renders. Coarse, matching `formatAge`'s own resolution (UpdateChip). */
const AGE_TICK_MS = 60_000

export interface OutputFileLineProps {
  /** the command as the player must type it, verbatim — e.g. `/outputfile inventory` */
  command: string
  /** ONE clause saying why it is worth typing. No caveats, no methodology. */
  why: string
  /**
   * The dump file's mtime, ISO. Absent means no file exists yet, and the line then states the
   * command WITHOUT claiming an age — "never" is not a timestamp, and a surface with no dump is
   * usually already showing its own instructions.
   */
  updatedAt?: string
  testId?: string
}

/** ISO → epoch millis, or undefined when the string is absent or unparseable (never `0`). */
function millis(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const t = Date.parse(iso)
  return Number.isNaN(t) ? undefined : t
}

export default function OutputFileLine({ command, why, updatedAt, testId }: OutputFileLineProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => {
      clearInterval(t)
    }
  }, [])

  const at = millis(updatedAt)
  const age = at === undefined ? '' : formatAge(at, now)
  return (
    <Paper variant="outlined" data-testid={testId} sx={{ px: 1.25, py: 0.75, mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}
          data-testid={testId === undefined ? undefined : `${testId}-command`}
        >
          {command}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
          {why}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 8 }} />
        {age !== '' && (
          // The exact clock time is one hover away; the ambient text stays coarse (formatDate's
          // own contract). This is the ONE place a tooltip is warranted here — it states the
          // precise value of the number beside it, which is what makes the coarse one safe.
          <Typography
            variant="caption"
            color="text.disabled"
            title={at === undefined ? undefined : formatDateTime(at)}
            data-testid={testId === undefined ? undefined : `${testId}-age`}
            sx={{ flexShrink: 0 }}
          >
            updated {age}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}
