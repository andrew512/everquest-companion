// AlertOverlaySetting — Preferences → Overlays → "Alert text"
// (docs/plans/alert-text-overlays.md §10).
//
// The controls over one window: is it on, where does it sit, and what it does with the lines it
// is given (the look an alert inherits, and which way the stack grows). The near-twin of ToastSetting,
// and for the same structural reason rather than by copy-paste habit: this is a NOTIFIER, so it
// is empty and click-through at rest and has no chrome of its own to grab. Unlocking it here is
// the ONLY route to positioning it. (What each alert draws — the text, the font, the size, the
// colour, how long it holds — is per alert and lives in the Alerts tab, because two alerts
// pointed at this window are allowed to look nothing alike.)
//
// ON/OFF IS THE WINDOW'S OPEN-STATE. There is no second `enabled` flag: the alert overlay is an
// overlay kind, so "on" means its window is open, persisted and restored exactly like every
// other overlay's. Two switches for one state is how they drift.
//
// STATE, NEVER PROCESS (the repo's UI law): every caption says what is true now. Nothing here
// mentions click-through, IPC or `setIgnoreMouseEvents`.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { Box, FormControlLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import type { AlertFont } from '@shared/alertTypes'
import {
  ALERT_FONTS,
  ALERT_FONT_LABELS,
  ALERT_FONT_STACKS,
  ALERT_TEXT_GROWTHS,
  DEFAULT_ALERT_TEXT,
  MAX_ALERT_DISPLAY_MS,
  MAX_ALERT_FONT_PX,
  MIN_ALERT_DISPLAY_MS,
  MIN_ALERT_FONT_PX,
  alertDisplayColor,
  type AlertTextDefaults,
  type AlertTextGrowth
} from '@shared/alertDisplay'
import { DEFAULT_ALERT_OVERLAY } from '@shared/alertOverlays'

/**
 * What each direction is called, in terms of the WINDOW the user just dragged into place: the
 * lane's edge is the fixed thing, and the stack extends away from it.
 */
const GROWTH_LABELS: Record<AlertTextGrowth, string> = {
  down: 'Down from the top',
  up: 'Up from the bottom'
}
/** The facts this panel shows. `defaults` is the LOOK this lane gives an alert that has no opinion. */
interface AlertOverlayState {
  open: boolean
  locked: boolean
  defaults: AlertTextDefaults
}

/** Hydrate the alert overlay's open-state, lock and defaults from main. */
function useAlertOverlayState(): [AlertOverlayState, (patch: Partial<AlertOverlayState>) => void] {
  const [state, setState] = useState<AlertOverlayState>({
    open: false,
    locked: true,
    defaults: { ...DEFAULT_ALERT_TEXT }
  })

  useEffect(() => {
    let alive = true
    const hydrate = (): void => {
      void Promise.all([
        window.eq.getOverlayState(),
        window.eq.getAlertOverlayConfig(DEFAULT_ALERT_OVERLAY)
      ]).then(([open, cfg]) => {
        if (alive) {
          setState({
            open: open[DEFAULT_ALERT_OVERLAY],
            locked: cfg.locked,
            defaults: cfg.alertText ?? { ...DEFAULT_ALERT_TEXT }
          })
        }
      })
    }
    hydrate()
    // Re-read on focus (the toast panel's precedent): the overlay's own frame carries a Done
    // button, so the lock can change in the OTHER window while this panel is on screen. Coming
    // back to the app is exactly when a stale switch would be seen.
    window.addEventListener('focus', hydrate)
    // An overlay can also close itself (the app quitting, its own window controls), so the
    // switch listens rather than trusting the value it hydrated with.
    const off = window.eq.onOverlayState((s) => {
      if (s.kind === DEFAULT_ALERT_OVERLAY) setState((cur) => ({ ...cur, open: s.open }))
    })
    return () => {
      alive = false
      window.removeEventListener('focus', hydrate)
      off()
    }
  }, [])

  const update = useCallback((patch: Partial<AlertOverlayState>) => {
    setState((cur) => ({ ...cur, ...patch }))
  }, [])
  return [state, update]
}

/**
 * THE LANE'S OWN LOOK — what an alert gets when it does not say otherwise.
 *
 * It lives HERE rather than on each alert because it is a property of the surface: a user who
 * wants their alerts big and yellow says it once, and every alert that never disagreed follows —
 * including the ones they wrote months ago. Any single alert can still override any of the four
 * in the Alerts tab, which is where a per-alert exception belongs.
 *
 * WRITES ARE LOCAL-FIRST, then persisted: the control must not lag a round trip behind the
 * pointer, and main returns the clamped value so a number typed past the ends comes back to
 * whatever was actually stored.
 */
function DefaultsRow({
  defaults,
  onChange
}: {
  defaults: AlertTextDefaults
  onChange: (next: AlertTextDefaults) => void
}): JSX.Element {
  const patch = (p: Partial<AlertTextDefaults>): void => onChange({ ...defaults, ...p })
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
      <Box sx={{ minWidth: 140, flexGrow: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Font
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="pref-alert-overlay-font"
          value={defaults.font}
          onChange={(e) => patch({ font: e.target.value as AlertFont })}
        >
          {ALERT_FONTS.map((f) => (
            <MenuItem key={f} value={f} sx={{ fontFamily: ALERT_FONT_STACKS[f] }}>
              {ALERT_FONT_LABELS[f]}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <TextField
        size="small"
        type="number"
        label="Size"
        data-testid="pref-alert-overlay-size"
        value={defaults.fontSize}
        onChange={(e) => patch({ fontSize: Math.round(Number(e.target.value) || 0) })}
        slotProps={{ htmlInput: { min: MIN_ALERT_FONT_PX, max: MAX_ALERT_FONT_PX } }}
        sx={{ width: 100 }}
      />
      <Box>
        <Typography variant="caption" color="text.secondary" display="block">
          Colour
        </Typography>
        <input
          type="color"
          data-testid="pref-alert-overlay-color"
          value={alertDisplayColor(defaults.color)}
          onChange={(e) => patch({ color: e.target.value })}
          style={{ width: 56, height: 38, padding: 2, background: 'transparent', border: 0, cursor: 'pointer' }}
        />
      </Box>
      <TextField
        size="small"
        type="number"
        label="Seconds on screen"
        data-testid="pref-alert-overlay-seconds"
        value={defaults.durationMs / 1000}
        onChange={(e) => patch({ durationMs: Math.round((Number(e.target.value) || 0) * 1000) })}
        slotProps={{
          htmlInput: { min: MIN_ALERT_DISPLAY_MS / 1000, max: MAX_ALERT_DISPLAY_MS / 1000, step: 0.5 }
        }}
        sx={{ width: 160 }}
      />
      {/* NOT a default, unlike the four beside it: no alert can override which way its lane
          stacks, because two of them disagreeing is how lines end up drawn over each other. It
          sits here because it is a property of this window, which is what this panel is about. */}
      <Box sx={{ minWidth: 190 }}>
        <Typography variant="caption" color="text.secondary">
          Text grows
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="pref-alert-overlay-growth"
          value={defaults.growth}
          onChange={(e) => patch({ growth: e.target.value as AlertTextGrowth })}
        >
          {ALERT_TEXT_GROWTHS.map((g) => (
            <MenuItem key={g} value={g}>
              {GROWTH_LABELS[g]}
            </MenuItem>
          ))}
        </Select>
      </Box>
    </Stack>
  )
}

export function AlertOverlaySetting(): JSX.Element {
  const [state, update] = useAlertOverlayState()

  const setLocked = (locked: boolean): void => {
    update({ locked })
    window.eq.setAlertOverlayLocked(DEFAULT_ALERT_OVERLAY, locked)
  }

  const setDefaults = (defaults: AlertTextDefaults): void => {
    update({ defaults })
    void window.eq.setAlertOverlayDefaults(DEFAULT_ALERT_OVERLAY, defaults).then((cfg) => {
      // Main clamps; adopt what was actually stored so a number typed past the ends settles
      // visibly rather than being silently disagreed with.
      if (cfg.alertText) update({ defaults: cfg.alertText })
    })
  }

  return (
    <Stack spacing={2} data-testid="pref-alert-overlay">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-alert-overlay-enabled"
              checked={state.open}
              onChange={() => void window.eq.toggleOverlay(DEFAULT_ALERT_OVERLAY)}
            />
          }
          label={<Typography variant="body2">Show alert text over the game</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {state.open
            ? 'Alerts set to “Show it on screen” put their line here and it fades on its own. Several at once stack rather than replacing each other. Clicks always pass straight through to the game.'
            : 'Off. Alerts still fire and still make whatever sound they make - nothing appears over the game.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-alert-overlay-move"
              disabled={!state.open}
              checked={!state.locked}
              onChange={(e) => setLocked(!e.target.checked)}
            />
          }
          label={<Typography variant="body2">Move it</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {state.locked
            ? 'The lane sits where you left it and clicks pass straight through to the game.'
            : 'The lane is showing its outline - drag it anywhere. Turn this off (or press Done) when it sits where you want it.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <Typography variant="body2">How alert text looks here</Typography>
        <Typography variant="caption" color="text.secondary">
          Every alert that shows text here uses this. Any single alert can pick its own font, size,
          colour or seconds in the Alerts tab.
        </Typography>
        <Box sx={{ pt: 0.5 }}>
          <DefaultsRow defaults={state.defaults} onChange={setDefaults} />
        </Box>
      </Stack>
    </Stack>
  )
}
