// GraphicsSetting — Preferences → Graphics (JOS-40).
//
// TWO SWITCHES FOR ONE SITUATION: the app, or its floating overlays, are drawing wrong on this
// machine's graphics driver. A player on a brand-new card reported the overlays producing
// black-screen artifacting; it cannot be reproduced here and they left no contact, so what ships
// is a way for anyone to fix it themselves. They are in ONE section because they are one story —
// try the cheap one, and if that is not it, try the other.
//
// STATE, NEVER PROCESS (the repo's UI law) AND THE CAVEAT DIET (AGENTS.md): each label is one
// plain sentence, and the sentence says WHEN it applies, because "I flipped it and nothing
// happened" is the only way either of these switches can be misread. Nothing here explains
// compositing, drivers or the GPU process — the user asked for a picture that works.
//
// ONE BORDER: PreferencesView already wraps each item in an outlined Paper, so this renders bare
// Stacks.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import MonitorIcon from '@mui/icons-material/Monitor'
import { DEFAULT_GRAPHICS_PREFS, type GraphicsPrefs } from '@shared/graphicsPrefs'
import type { PrefSection } from './PreferencesView'

/**
 * The blob, hydrated once from main and written back on every change — the OverlayAutoHide /
 * VoiceSetting pattern exactly. The local write is optimistic (a switch must not lag an IPC round
 * trip) and main's reply is authoritative, being what was actually stored.
 */
function useGraphicsPrefs(): [GraphicsPrefs, (patch: Partial<GraphicsPrefs>) => void] {
  const [prefs, setPrefs] = useState<GraphicsPrefs>(DEFAULT_GRAPHICS_PREFS)

  useEffect(() => {
    let alive = true
    void window.eq.getGraphicsPrefs().then((stored) => {
      if (alive) setPrefs(stored)
    })
    return () => {
      alive = false
    }
  }, [])

  const update = useCallback((patch: Partial<GraphicsPrefs>) => {
    setPrefs((cur) => ({ ...cur, ...patch }))
    void window.eq.setGraphicsPrefs(patch).then(setPrefs)
  }, [])

  return [prefs, update]
}

/**
 * The section descriptor, living with its card like `perfSection` does — PreferencesView is at
 * the 400-code-line factoring ceiling, and the words someone types to find this setting belong
 * beside the setting. The keywords carry the SYMPTOM vocabulary ("black", "flicker", "artifact",
 * "nvidia") as well as the mechanism, because a user in this situation searches for what they
 * are seeing, not for what it is called.
 */
export function graphicsSection(): PrefSection {
  return {
    id: 'graphics',
    label: 'Graphics',
    icon: <MonitorIcon fontSize="small" />,
    items: [
      {
        id: 'graphics-compat',
        label: 'Graphics compatibility',
        keywords:
          'graphics gpu video card driver nvidia amd intel rtx software rendering render acceleration hardware black blank screen flicker flickering artifact artifacting glitch corrupt transparent transparency opaque solid overlay overlays meter meters compatibility safe mode wine linux proton',
        content: <GraphicsSetting />
      }
    ]
  }
}

export function GraphicsSetting(): JSX.Element {
  const [prefs, update] = useGraphicsPrefs()
  return (
    <Stack spacing={2} data-testid="pref-graphics">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-graphics-safe-mode"
              checked={prefs.safeMode}
              onChange={(e) => update({ safeMode: e.target.checked })}
            />
          }
          label={
            <Typography variant="body2">
              Draw without the graphics card, starting next launch
            </Typography>
          }
        />
        <Typography variant="caption" color="text.secondary">
          {prefs.safeMode
            ? 'On from the next launch. Try this first if the app itself flickers, goes black, or will not paint.'
            : 'Off. The app draws with your graphics card, which is what you want unless it is misbehaving.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-graphics-opaque-overlays"
              checked={prefs.opaqueOverlays}
              onChange={(e) => update({ opaqueOverlays: e.target.checked })}
            />
          }
          label={
            <Typography variant="body2">
              Give floating overlays a solid background, from the next time you open one
            </Typography>
          }
        />
        <Typography variant="caption" color="text.secondary">
          {prefs.opaqueOverlays
            ? 'On for overlays you open from now on. Same meters, same colours, no see-through — reopen an overlay to apply it.'
            : 'Off. Overlays float see-through over the game. Turn this on if they go black or leave marks on screen.'}
        </Typography>
      </Stack>
    </Stack>
  )
}
