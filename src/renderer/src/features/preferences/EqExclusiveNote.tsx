// EqExclusiveNote — "your game is in exclusive fullscreen, and that is why this stutters" (JOS-368).
//
// WHAT IT IS FOR. An always-on-top overlay over a game running in EXCLUSIVE fullscreen cannot
// share the screen with it: every z-order change is a display-mode switch, which the player sees
// as a black flash and about a second of frozen game. JOS-368 makes the app stop causing those it
// did not need to cause; this sentence is the other half, because the ones that remain are
// unavoidable and today nothing tells the person they are avoidable at all. They blame the game,
// or they blame us, and either way they never find the switch that fixes it.
//
// IT IS TEACHING, NOT A CAVEAT (the repo's tooltip-diet law draws exactly this line). The note
// helps someone use overlays successfully and names the setting that does it; it is not a
// footnote about how our numbers might be wrong. That is why it is allowed to be a sentence and
// why it is allowed to be dismissed forever.
//
// AND IT IS CALM. An inline Alert inside the section, not a toast and not a dialog: nothing here
// is urgent, nothing is broken, and a modal would be the app interrupting a person to talk about
// its own rendering. It appears where the overlay settings are, which is where someone who cares
// about it is already standing.
//
// WHEN IT APPEARS IS MAIN'S DECISION, not this component's. `eqWindowNotice.show` already folds
// the game's mode, whether any overlay is open, and whether this install dismissed it at this
// version (src/main/eqWindowMode.ts). Re-deriving any of that here would be a second opinion
// about when to speak, and it would drift.

import { type JSX, useCallback, useState } from 'react'
import { Alert, Typography } from '@mui/material'
import type { EqWindowNotice } from '@shared/eqWindowMode'
import { recordPref, usePrefsSeed } from './prefsHydration'

/**
 * The note's state, SEEDED from the pane's hydration snapshot (JOS-340).
 *
 * Same law as every switch in here and a sharper case for it: a note that pops in a frame after
 * the pane has painted is a sentence that arrives late, and a note that paints and then vanishes
 * is worse than one that never appeared. The starting value is already in hand, synchronously.
 *
 * The dismissal takes MAIN'S REPLY as authoritative and feeds it back into the snapshot, so a
 * user who dismisses this, clicks to another section and comes back does not meet it again.
 */
function useEqWindowNotice(): [EqWindowNotice, () => void] {
  const [notice, setNotice] = useState<EqWindowNotice>(usePrefsSeed().eqWindowNotice)

  const dismiss = useCallback(() => {
    // Optimistic locally, because closing a note must not lag an IPC round trip.
    setNotice((cur) => ({ ...cur, show: false }))
    void window.eq.dismissEqWindowNotice().then((stored) => {
      setNotice(stored)
      recordPref('eqWindowNotice', stored)
    })
  }, [])

  return [notice, dismiss]
}

export function EqExclusiveNote(): JSX.Element | null {
  const [notice, dismiss] = useEqWindowNotice()
  if (!notice.show) return null
  return (
    <Alert
      severity="info"
      variant="outlined"
      onClose={dismiss}
      data-testid="pref-eq-exclusive-note"
      sx={{ mb: 1 }}
    >
      <Typography variant="body2">
        EverQuest is set to exclusive fullscreen; overlays draw best in Windowed mode (Options
        &gt; Display, in the game).
      </Typography>
    </Alert>
  )
}
