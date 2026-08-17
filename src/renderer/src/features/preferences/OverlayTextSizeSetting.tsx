// OverlayTextSizeSetting — Preferences → Text size → the OVERLAYS' size (JOS-405).
//
// WHY THIS CARD EXISTS AT ALL. Every overlay window has carried an A− / A+ since 2026-08-05, and
// two 1.4.0 reports still said "the text is so small! and text size options dont effect it". They
// were not wrong about anything except where to look: the meters' stepper is in a footer that a
// PINNED overlay does not draw, and the three strips' is in a drag frame reached from a "Move it"
// button. A player who pinned their meters on day one has never seen the control. So the size
// moves to where they went looking for it — beside the window's own Text size — and the control
// on the overlay stays exactly where it is, writing the same value.
//
// THREE CONTROLS, AND THE MIDDLE ONE CHANGES WHAT THE OTHER TWO MEAN:
//
//   Overlay text size          the ONE size, and what every overlay uses unless told otherwise.
//   Independent sizes          off by default — the 2026-08-05 rule, now a default rather than a
//                              law (shared/overlayTextScale.ts carries the argument).
//   Per-overlay sizes          all twelve, ALWAYS RENDERED. While synced each row is disabled and
//                              shows the SHARED value, because a row states what is true now.
//
// THE ROWS SHOW WHAT IS IN FORCE, NEVER WHAT IS REMEMBERED. That is the one design decision in
// here worth defending: while synced, every window genuinely draws at the shared size, and a row
// that printed a remembered 150% next to a meter drawing 100% would be a lie told twelve times.
// The remembered values are not lost — nothing writes them while synced — they are simply not
// what is happening, and the switch is one click away from making them true again.
//
// STATE, NEVER PROCESS, AND THE CAVEAT DIET (AGENTS.md): each caption is one sentence about what
// the overlays DO. Nothing here mentions routing, broadcasts, or which process stores the number.
//
// ONE BORDER: PreferencesView already wraps each item in an outlined Paper, so these render bare
// Stacks.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { Box, FormControlLabel, IconButton, Stack, Switch, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import {
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  clampTextScale,
  effectiveOverlayTextScale,
  type OverlayTextSizePrefs
} from '@shared/overlayTextScale'
import { OVERLAY_KIND_LABEL, OVERLAY_LABEL_ORDER, OVERLAY_STRIP_KINDS } from '@shared/overlayLabels'
import type { OverlayKind } from '@shared/types'
// THE app's Tooltip, never MUI's (owner rule 2026-08-04, pinned by tests/tooltipCursor.test.mts):
// anything wearing a tooltip shows the hand, and a DISABLED anchor keeps `not-allowed` — which is
// exactly the state every row below is in while the overlays share one size.
import { Tooltip } from '../../lib/Tooltip'
import { recordPref, usePrefsSeed } from './prefsHydration'

/** The percentage, which is the vocabulary the window's own ladder already taught this pane. */
const pct = (scale: number): string => `${String(Math.round(scale * 100))}%`

/**
 * The prefs blob, SEEDED from the pane's hydration snapshot (JOS-340) and kept current by main's
 * PUSH as well as by this card's own writes.
 *
 * The push is not decoration here, and this value needs it more than any other in the pane: the
 * shared size has THIRTEEN controls — twelve windows' A− / A+ and this stepper — so a Preferences
 * pane left open while somebody scales their fight meter would otherwise print a stale
 * percentage. Same arrangement as `closeToTray`, which has three.
 */
function useOverlayTextSize(): [OverlayTextSizePrefs, (patch: Partial<OverlayTextSizePrefs>) => void] {
  const [prefs, setPrefs] = useState<OverlayTextSizePrefs>(usePrefsSeed().overlayTextSize)

  useEffect(() => {
    return window.eq.onOverlayTextSize((p) => {
      setPrefs(p)
      recordPref('overlayTextSize', p)
    })
  }, [])

  const update = useCallback((patch: Partial<OverlayTextSizePrefs>) => {
    setPrefs((cur) => ({ ...cur, ...patch }))
    void window.eq.setOverlayTextSize(patch).then((stored) => {
      setPrefs(stored)
      recordPref('overlayTextSize', stored)
    })
  }, [])

  return [prefs, update]
}

/**
 * A− / A+ with the percentage between them. ONE component for the shared control and for all
 * twelve rows, so a row can never step differently from the thing above it.
 *
 * The ends disable at the shared floor and ceiling (`TEXT_SCALE_MIN` / `MAX`), the same two numbers
 * the overlay windows' own stepper stops at — this is the same control in a different frame, not a
 * second opinion about how big an overlay may be.
 */
function ScaleStepper({
  scale,
  onStep,
  disabled,
  name,
  testid
}: {
  scale: number
  onStep: (next: number) => void
  disabled: boolean
  /** What this stepper is FOR, spoken: "the overlays", or one window's name. */
  name: string
  testid: string
}): JSX.Element {
  const step = (dir: 1 | -1): void => onStep(clampTextScale(scale + dir * TEXT_SCALE_STEP))
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} data-testid={testid}>
      <IconButton
        size="small"
        aria-label={`Smaller text for ${name}`}
        data-testid={`${testid}-minus`}
        disabled={disabled || scale <= TEXT_SCALE_MIN}
        onClick={() => { step(-1) }}
      >
        <RemoveIcon fontSize="inherit" />
      </IconButton>
      <Typography
        variant="body2"
        data-testid={`${testid}-value`}
        // A fixed width so twelve rows' percentages line up and none of them jumps as it changes.
        sx={{ minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.5 : 1 }}
      >
        {pct(scale)}
      </Typography>
      <IconButton
        size="small"
        aria-label={`Larger text for ${name}`}
        data-testid={`${testid}-plus`}
        disabled={disabled || scale >= TEXT_SCALE_MAX}
        onClick={() => { step(1) }}
      >
        <AddIcon fontSize="inherit" />
      </IconButton>
    </Stack>
  )
}

/**
 * THE SHARED SIZE, plus the switch that decides whether it is the one in force.
 *
 * They are one card rather than two because the switch is what the stepper above it MEANS: read
 * apart, "Overlay text size" and "Independent sizes per overlay" are two settings that appear to
 * contradict each other.
 */
export function OverlayTextSizeSetting(): JSX.Element {
  const [prefs, update] = useOverlayTextSize()

  return (
    <Stack spacing={1.25}>
      <Stack spacing={0.5}>
        <ScaleStepper
          scale={prefs.shared}
          onStep={(shared) => { update({ shared }) }}
          disabled={false}
          name="the overlays"
          testid="pref-overlay-text-size"
        />
        <Typography variant="caption" color="text.secondary" data-testid="pref-overlay-text-size-note">
          {prefs.independent
            ? 'Each overlay is using its own size right now, listed below. Turn independent sizes off and they all come back to this one.'
            : 'Every floating overlay draws its text at this size - the meters, the timers, and the cards that appear over your game.'}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-overlay-text-independent"
              checked={prefs.independent}
              onChange={(e) => { update({ independent: e.target.checked }) }}
            />
          }
          label={<Typography variant="body2">Independent sizes per overlay</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {prefs.independent
            ? 'On. Each overlay keeps its own size, and its A- / A+ changes only that overlay.'
            : 'Off. One size for all of them, and any overlay’s A- / A+ moves it for every one.'}
        </Typography>
      </Stack>
    </Stack>
  )
}

/** What a disabled row's hover says. One sentence: what is true, and what would change it. */
const SYNCED_TOOLTIP =
  'All overlays share one text size. Turn on Independent sizes per overlay to set this one by itself.'

/**
 * One overlay's row. The label, and a stepper that is EITHER this kind's own value (independent)
 * or the shared value, disabled and explained (synced).
 *
 * THE TOOLTIP NEEDS THE SPAN. MUI attaches its listeners to the child, and a disabled button fires
 * no pointer events at all — so a Tooltip on one is a tooltip that never shows. The wrapping span
 * is the repo's existing answer (UpgradeOffers.tsx), and it is applied to the whole stepper rather
 * than to each button so hovering the percentage explains it too.
 */
function OverlayRow({
  kind,
  scale,
  synced,
  onStep
}: {
  kind: OverlayKind
  scale: number
  synced: boolean
  onStep: (next: number) => void
}): JSX.Element {
  const stepper = (
    <ScaleStepper
      scale={scale}
      onStep={onStep}
      disabled={synced}
      name={OVERLAY_KIND_LABEL[kind]}
      testid={`pref-overlay-text-size-${kind}`}
    />
  )
  return (
    <Stack direction="row" alignItems="center" spacing={1} data-testid={`pref-overlay-text-row-${kind}`}>
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, opacity: synced ? 0.7 : 1 }}>
        {OVERLAY_KIND_LABEL[kind]}
      </Typography>
      {synced ? (
        <Tooltip title={SYNCED_TOOLTIP}>
          <span>{stepper}</span>
        </Tooltip>
      ) : (
        stepper
      )}
    </Stack>
  )
}

/**
 * THE TWELVE, ALWAYS RENDERED.
 *
 * A list that appeared when the switch went on would make the switch a navigation step: you would
 * have to turn something on to find out what it offers. It is here, in force or not, and the rows
 * say which by being live or explained.
 *
 * GROUPED AS THE APP NAMES THEM (shared/overlayLabels.ts): the nine windows you open from the
 * Overlay menu, in that menu's order, then the three strips that appear by themselves. A row for a
 * closed window still edits its stored value — it applies the next time that window opens, which
 * is the same promise every other per-window setting in this app makes.
 */
export function PerOverlayTextSizeSetting(): JSX.Element {
  const [prefs] = useOverlayTextSize()
  const [scales, setScales] = useState<Record<OverlayKind, number>>(usePrefsSeed().overlayTextScales)

  // A press made on a WINDOW's own A− / A+ while this list is open (independent mode). Without it
  // the row beside that window would go on stating the size it used to draw at.
  useEffect(() => {
    return window.eq.onOverlayTextScales((m) => {
      setScales(m)
      recordPref('overlayTextScales', m)
    })
  }, [])

  const setKind = useCallback((kind: OverlayKind, textScale: number) => {
    setScales((cur) => ({ ...cur, [kind]: textScale }))
    void window.eq.setOverlayTextScale(kind, textScale).then((cfg) => {
      const stored = clampTextScale(cfg.textScale)
      setScales((cur) => {
        const next = { ...cur, [kind]: stored }
        recordPref('overlayTextScales', next)
        return next
      })
    })
  }, [])

  return (
    <Stack spacing={0.75}>
      {OVERLAY_LABEL_ORDER.map((kind) => (
        <Box key={kind}>
          {kind === OVERLAY_STRIP_KINDS[0] && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1, pb: 0.5 }}>
              These appear by themselves when something happens.
            </Typography>
          )}
          <OverlayRow
            kind={kind}
            // IN FORCE, never remembered: synced rows all read the shared value, which is what
            // every one of those windows is genuinely drawing at.
            scale={effectiveOverlayTextScale(prefs, scales[kind])}
            synced={!prefs.independent}
            onStep={(next) => { setKind(kind, next) }}
          />
        </Box>
      ))}
    </Stack>
  )
}
