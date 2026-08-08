// useAlertOverlayDefaults — what each alert overlay will give a line that does not override it.
//
// The editor needs this for ONE reason: to show the user what they are inheriting. A size field
// that reads 28 when the overlay says 48 is a lie, and "leave it blank for the default" is a
// worse answer than showing the default and letting them change it. So every style control in
// DisplayBlock renders the EFFECTIVE value — the alert's override if it has one, this otherwise.
//
// IT IS NOT THE SOURCE OF TRUTH, and nothing here is ever sent back on a firing. The store is,
// main reads it at fire time (main/alertOverlay.ts), and this is a display copy that can be a
// beat stale without consequence — the worst case is a preview that catches up on the next focus.
// Re-read on window focus for exactly that reason: the defaults are edited in Preferences, in
// this same window but a different tab, and coming back to the Alerts tab is when a stale number
// would be seen.

import { useEffect, useState } from 'react'
import { DEFAULT_ALERT_TEXT, type AlertTextDefaults } from '@shared/alertDisplay'
import { ALERT_OVERLAY_KINDS, type AlertOverlayKind } from '@shared/alertOverlays'

export type AlertOverlayDefaults = Record<AlertOverlayKind, AlertTextDefaults>

/** Every overlay at the shipped constants — what the editor renders before the read lands. */
function shipped(): AlertOverlayDefaults {
  return Object.fromEntries(
    ALERT_OVERLAY_KINDS.map((k) => [k, { ...DEFAULT_ALERT_TEXT }])
  ) as AlertOverlayDefaults
}

/** The per-overlay defaults, hydrated from main and refreshed when the window regains focus. */
export function useAlertOverlayDefaults(): AlertOverlayDefaults {
  const [defaults, setDefaults] = useState<AlertOverlayDefaults>(shipped)

  useEffect(() => {
    let alive = true
    const hydrate = (): void => {
      void Promise.all(ALERT_OVERLAY_KINDS.map((k) => window.eq.getAlertOverlayConfig(k))).then((configs) => {
        if (!alive) return
        const next = shipped()
        // A config from a build that predates the blob simply keeps the shipped constants, which
        // is the same answer main's own reader gives.
        ALERT_OVERLAY_KINDS.forEach((k, i) => {
          const stored = configs[i].alertText
          if (stored) next[k] = stored
        })
        setDefaults(next)
      })
    }
    hydrate()
    window.addEventListener('focus', hydrate)
    return () => {
      alive = false
      window.removeEventListener('focus', hydrate)
    }
  }, [])

  return defaults
}
