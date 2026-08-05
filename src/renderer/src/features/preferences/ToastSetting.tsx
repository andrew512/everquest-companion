// ToastSetting — Preferences → Overlays → "Celebration toasts"
// (docs/plans/celebration-toasts.md §3).
//
// Three controls over one window: is it on, what does it sound like, and where does it sit.
//
// ON/OFF IS THE WINDOW'S OPEN-STATE. There is no second `enabled` flag: the toast overlay is a
// sixth overlay kind, so "on" means its window is open, persisted and restored exactly like
// every other overlay's. Two switches for one state is how they drift.
//
// SILENT IS THE DEFAULT, and the caption says why rather than leaving the user to wonder: the
// boss-kill and quest-complete alerts already speak on these exact events, so a toast line on
// top of them would be two voices over one kill. Picking one here is opting IN to a second.
//
// STATE, NEVER PROCESS (the repo's UI law): every caption says what is true now, not how the
// window is implemented. Nothing here mentions click-through, IPC or `setIgnoreMouseEvents`.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { FormControlLabel, MenuItem, Select, Stack, Switch, Typography } from '@mui/material'
import type { AlertSoundRef, SoundPack } from '@shared/types'
import { DEFAULT_TOAST_CONFIG, type ToastOverlayConfig } from '@shared/toast'
import { fallbackPack } from '../alerts/SoundPicker'

/** The Select's value for "no sound at all". Empty string would collide with an unset Select. */
const SILENT = '__silent__'

interface ToastState {
  open: boolean
  locked: boolean
  cfg: ToastOverlayConfig
}

/** Hydrate the toast's window state + config from main, and write patches back through it. */
function useToastState(): [ToastState, (patch: Partial<ToastState>) => void] {
  const [state, setState] = useState<ToastState>({ open: false, locked: true, cfg: DEFAULT_TOAST_CONFIG })

  useEffect(() => {
    let alive = true
    const hydrate = (): void => {
      void Promise.all([window.eq.getOverlayState(), window.eq.getToastConfig()]).then(([open, cfg]) => {
        if (alive) setState({ open: open.toast, locked: cfg.locked, cfg: cfg.toast ?? DEFAULT_TOAST_CONFIG })
      })
    }
    hydrate()
    // Re-read on focus (the alert player's precedent): the toast's own frame carries a Done
    // button, so the lock can change in the OTHER window while this panel is on screen. Coming
    // back to the app is exactly when a stale switch would be seen.
    window.addEventListener('focus', hydrate)
    // An overlay can also close itself (the app quitting, its own window controls), so the
    // switch listens rather than trusting the value it hydrated with.
    const off = window.eq.onOverlayState((s) => {
      if (s.kind === 'toast') setState((cur) => ({ ...cur, open: s.open }))
    })
    return () => {
      alive = false
      window.removeEventListener('focus', hydrate)
      off()
    }
  }, [])

  const update = useCallback((patch: Partial<ToastState>) => {
    setState((cur) => ({ ...cur, ...patch }))
  }, [])
  return [state, update]
}

/**
 * The pack → line picker, plus the explicit Silent choice.
 *
 * Same shape as the alert editor's SoundPicker (and the same `fallbackPack` rule: an unset or
 * uninstalled pack lands on the SHIPPED default, never on whatever sorts first) — with one
 * extra option the alert editor has no use for. An alert always makes a sound; a toast is
 * allowed to make none, and "Silent" is that state said out loud rather than implied by an
 * empty field.
 */
function ToastSoundPicker({
  packs,
  sound,
  onChange
}: {
  packs: SoundPack[]
  sound: AlertSoundRef | null
  onChange: (s: AlertSoundRef | null) => void
}): JSX.Element {
  const pack = packs.find((p) => p.id === sound?.packId) ?? fallbackPack(packs)
  const soundIds = pack ? Object.keys(pack.sounds) : []
  return (
    <Stack direction="row" spacing={1}>
      <Select
        size="small"
        data-testid="pref-toast-pack"
        value={pack?.id ?? ''}
        onChange={(e) => {
          // Switching packs picks that pack's first line rather than going silent: the user
          // reached for a different voice, not for no voice.
          const next = packs.find((p) => p.id === e.target.value)
          const first = next ? Object.keys(next.sounds)[0] : ''
          onChange(next && first ? { packId: next.id, soundId: first } : null)
        }}
        sx={{ minWidth: 140 }}
      >
        {packs.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
            {p.source === 'user' ? ' (user)' : ''}
          </MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        data-testid="pref-toast-sound"
        value={sound ? sound.soundId : SILENT}
        onChange={(e) =>
          onChange(
            e.target.value === SILENT || !pack ? null : { packId: pack.id, soundId: e.target.value }
          )
        }
        sx={{ minWidth: 260 }}
      >
        <MenuItem value={SILENT}>Silent</MenuItem>
        {soundIds.map((sid) => (
          <MenuItem key={sid} value={sid}>
            {pack?.sounds[sid]?.label ?? sid}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  )
}

export function ToastSetting(): JSX.Element {
  const [state, update] = useToastState()
  const [packs, setPacks] = useState<SoundPack[]>([])
  useEffect(() => {
    void window.eq.listSoundPacks().then(setPacks)
  }, [])

  const patchCfg = (patch: Partial<ToastOverlayConfig>): void => {
    const cfg = { ...state.cfg, ...patch }
    update({ cfg })
    void window.eq.setToastConfig({ toast: cfg }).then((stored) => {
      update({ cfg: stored.toast ?? DEFAULT_TOAST_CONFIG })
    })
  }

  const setLocked = (locked: boolean): void => {
    update({ locked })
    window.eq.setToastLocked(locked)
  }

  return (
    <Stack spacing={2} data-testid="pref-toast">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-toast-enabled"
              checked={state.open}
              onChange={() => void window.eq.toggleOverlay('toast')}
            />
          }
          label={<Typography variant="body2">Celebrate boss kills and Sky quests on screen</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {state.open
            ? 'A card slides in at the top of the screen when you drop a raid target or finish a Plane of Sky quest, then fades. Point at it to keep it up; a quest’s reward card opens the Plane of Sky tab.'
            : 'Off. Boss kills and quest completions still show up in the app and in your alerts — nothing appears over the game.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <Typography variant="body2">Sound</Typography>
        <ToastSoundPicker packs={packs} sound={state.cfg.sound} onChange={(sound) => patchCfg({ sound })} />
        <Typography variant="caption" color="text.secondary">
          {state.cfg.sound
            ? 'Plays with the card, on top of whatever your alerts already say for these events.'
            : 'Silent. Your “Raid target defeated” and “Quest complete” alerts already speak for these — pick a line here only if you want a second one.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-toast-move"
              disabled={!state.open}
              checked={!state.locked}
              onChange={(e) => setLocked(!e.target.checked)}
            />
          }
          label={<Typography variant="body2">Move it</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {state.locked
            ? 'The strip sits where you left it and clicks pass straight through to the game.'
            : 'The strip is showing its outline — drag it anywhere, then turn this off (or press Done on the frame).'}
        </Typography>
      </Stack>
    </Stack>
  )
}
