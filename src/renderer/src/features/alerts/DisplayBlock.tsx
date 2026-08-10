// DisplayBlock — the alert editor's SHOW-ON-SCREEN half (docs/plans/alert-text-overlays.md §9):
// what an alert draws over the game when it fires, and how it looks.
//
// The SpeechBlock arrangement, deliberately: the state and the def translation live in
// ./displayForm, and this file is the rendering. AlertDialog composes the two.
//
// THE SWITCH IS THE BLOCK'S PRESENCE. There is no `enabled` field on AlertDisplay: an alert draws
// because it HAS a display block, so turning the switch off writes no key at all. One state, one
// switch — the rule the toast overlay's open-state follows.
//
// EVERY STYLE CONTROL SHOWS THE EFFECTIVE VALUE, INHERITED OR NOT. The overlay carries its own
// font/size/colour/seconds (Preferences → Overlays), so a control that showed a blank, or showed
// the shipped constant while the overlay said something else, would be describing an alert that
// does not exist. Instead each control renders what this alert will ACTUALLY look like, labelled
// "from the overlay" until you touch it — and a touched control gets a "use the overlay's" link
// back. Touching a control is what creates the override; there is no separate override switch,
// because a switch you must find before the control does anything is a control that looks broken.
//
// THE PREVIEW IS THE POINT. Font, size and colour are choices nobody can make from a dropdown
// label, so the preview renders in the actual font at the actual size in the actual colour, over
// the same dark ground the overlay draws on, resolved through the SAME `displayTextFor` the
// firing path runs. What you see in the dialog is what appears over the game.
//
// WHAT IS DELIBERATELY NOT HERE: where the overlay SITS, whether it is on, and its defaults.
// Those belong to the window rather than to any one alert (Preferences → Overlays).

import { type JSX, type ReactNode } from 'react'
import {
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import type { AlertFont } from '@shared/types'
import {
  ALERT_FONTS,
  ALERT_FONT_LABELS,
  ALERT_FONT_STACKS,
  MAX_ALERT_DISPLAY_MS,
  MAX_ALERT_FONT_PX,
  MAX_DISPLAY_CHARS,
  MIN_ALERT_DISPLAY_MS,
  MIN_ALERT_FONT_PX,
  alertDisplayColor,
  displayTextFor,
  type AlertTextDefaults
} from '@shared/alertDisplay'
import {
  ALERT_OVERLAY_KINDS,
  ALERT_OVERLAY_LABELS,
  type AlertOverlayKind
} from '@shared/alertOverlays'
import { tokensIn } from '@shared/alertCaptures'
import { displayFieldsFor, type DisplayForm } from './displayForm'

export { displayFieldsFor, showsText, useDisplayForm, type DisplayForm } from './displayForm'

/**
 * The line this alert will draw, through the same pure resolver the firing path uses.
 *
 * TOKENS PREVIEW UNRESOLVED, deliberately (JOS-103's rule, and the same one the Voice section's
 * preview follows). There is no firing yet, so there is no captured value, and substituting a
 * made-up sample would put words in the alert's mouth that no log line said (world-model law 1).
 * An unresolved `{token}` renders literally here for the same reason it does at fire time.
 */
export function previewDisplayFor(name: string, f: DisplayForm): string | null {
  const fields = displayFieldsFor({ ...f, on: true })
  return displayTextFor({ name, ...fields })
}

/**
 * WHAT `{tokens}` THIS ALERT MAY WRITE on screen, and which ones its pattern does not declare.
 *
 * The same list the Voice section prints, for the same reason (control 4 of the threat model in
 * shared/alertCaptures.ts): the values a shared def can ever draw are a finite, printable set, so
 * you can see what it will say without reading its regex. The unknown line is a WARNING and never
 * a save block — an unresolved token renders literally, which is a legible line rather than a
 * broken alert, and a user mid-edit should not be stopped from typing `{pl` on the way to
 * `{player}`.
 */
function CaptureHint({ text, captureNames }: { text: string; captureNames: string[] }): JSX.Element | null {
  const used = tokensIn(text)
  const unknown = used.filter((t) => !captureNames.includes(t))
  if (captureNames.length === 0 && unknown.length === 0) return null
  return (
    <Box data-testid="alert-display-captures">
      {captureNames.length > 0 && (
        <Typography variant="caption" color="text.secondary" display="block">
          This alert’s pattern captures: {captureNames.map((n) => `{${n}}`).join(' ')}
        </Typography>
      )}
      {unknown.length > 0 && (
        <Typography variant="caption" color="warning.main" display="block">
          {unknown.map((n) => `{${n}}`).join(' ')} - the pattern does not capture that; it will be
          drawn as written.
        </Typography>
      )}
    </Box>
  )
}

/**
 * A style control's caption: what it is, whether it is inherited, and the way back.
 *
 * "from the overlay" is a STATE, not an instruction — it says where this value came from, which is
 * the one thing the control itself cannot show.
 */
function FieldLabel({
  label,
  inherited,
  onReset
}: {
  label: string
  inherited: boolean
  onReset: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ minHeight: 20 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {inherited ? (
        <Typography variant="caption" color="text.disabled">
          from the overlay
        </Typography>
      ) : (
        <Button
          size="small"
          onClick={onReset}
          sx={{ minWidth: 0, p: 0, fontSize: 11, textTransform: 'none', lineHeight: 1.2 }}
        >
          use the overlay’s
        </Button>
      )}
    </Stack>
  )
}

/** One labelled style control. */
function Field({
  label,
  inherited,
  onReset,
  sx,
  children
}: {
  label: string
  inherited: boolean
  onReset: () => void
  sx?: object
  children: ReactNode
}): JSX.Element {
  return (
    <Box sx={sx}>
      <FieldLabel label={label} inherited={inherited} onReset={onReset} />
      {children}
    </Box>
  )
}

/** The text field + the tokens its trigger declares. */
function TextRow({ form, captureNames }: { form: DisplayForm; captureNames: string[] }): JSX.Element {
  return (
    <>
      <TextField
        size="small"
        label="Text"
        placeholder="The alert’s name"
        data-testid="alert-display-text"
        value={form.text}
        onChange={(e) => form.setText(e.target.value)}
        slotProps={{ htmlInput: { maxLength: MAX_DISPLAY_CHARS } }}
        helperText={`${String(form.text.length)} / ${String(MAX_DISPLAY_CHARS)}`}
      />
      <CaptureHint text={form.text} captureNames={captureNames} />
    </>
  )
}

/** Where it goes, and how long it stays. */
function TargetRow({ form, defaults }: { form: DisplayForm; defaults: AlertTextDefaults }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
      <Box sx={{ minWidth: 180, flexGrow: 1 }}>
        <Typography variant="caption" color="text.secondary">
          On which overlay
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="alert-display-overlay"
          value={form.overlay}
          onChange={(e) => form.setOverlay(e.target.value as AlertOverlayKind)}
        >
          {ALERT_OVERLAY_KINDS.map((k) => (
            <MenuItem key={k} value={k}>
              {ALERT_OVERLAY_LABELS[k]}
            </MenuItem>
          ))}
        </Select>
      </Box>
      <Field
        label="Seconds on screen"
        inherited={form.durationMs === null}
        onReset={() => form.setDurationMs(null)}
        sx={{ width: 160 }}
      >
        <TextField
          size="small"
          type="number"
          fullWidth
          data-testid="alert-display-duration"
          value={(form.durationMs ?? defaults.durationMs) / 1000}
          onChange={(e) => form.setDurationMs(Math.round((Number(e.target.value) || 0) * 1000))}
          slotProps={{
            htmlInput: { min: MIN_ALERT_DISPLAY_MS / 1000, max: MAX_ALERT_DISPLAY_MS / 1000, step: 0.5 }
          }}
        />
      </Field>
    </Stack>
  )
}

/** Font, size, colour — the three that only a preview can really answer. */
function StyleRow({ form, defaults }: { form: DisplayForm; defaults: AlertTextDefaults }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
      <Field
        label="Font"
        inherited={form.font === null}
        onReset={() => form.setFont(null)}
        sx={{ minWidth: 150, flexGrow: 1 }}
      >
        <Select
          size="small"
          fullWidth
          data-testid="alert-display-font"
          value={form.font ?? defaults.font}
          onChange={(e) => form.setFont(e.target.value as AlertFont)}
        >
          {ALERT_FONTS.map((f) => (
            <MenuItem key={f} value={f} sx={{ fontFamily: ALERT_FONT_STACKS[f] }}>
              {ALERT_FONT_LABELS[f]}
            </MenuItem>
          ))}
        </Select>
      </Field>
      <Field
        label="Size"
        inherited={form.fontSize === null}
        onReset={() => form.setFontSize(null)}
        sx={{ width: 110 }}
      >
        <TextField
          size="small"
          type="number"
          fullWidth
          data-testid="alert-display-size"
          value={form.fontSize ?? defaults.fontSize}
          onChange={(e) => form.setFontSize(Math.round(Number(e.target.value) || 0))}
          slotProps={{ htmlInput: { min: MIN_ALERT_FONT_PX, max: MAX_ALERT_FONT_PX } }}
        />
      </Field>
      <Field label="Colour" inherited={form.color === null} onReset={() => form.setColor(null)}>
        <input
          type="color"
          data-testid="alert-display-color"
          value={alertDisplayColor(form.color ?? defaults.color)}
          onChange={(e) => form.setColor(e.target.value)}
          style={{ width: 56, height: 38, padding: 2, background: 'transparent', border: 0, cursor: 'pointer' }}
        />
      </Field>
    </Stack>
  )
}

/**
 * The line as it will appear, over the dark ground the overlay draws on.
 *
 * The shadow is the overlay card's, not decoration: this kind draws on a transparent window with
 * no panel behind it, so the shadow is what makes the colour choice legible — previewing without
 * it would flatter a colour that turns out to be unreadable over the game.
 */
function DisplayPreview({
  name,
  form,
  defaults
}: {
  name: string
  form: DisplayForm
  defaults: AlertTextDefaults
}): JSX.Element {
  const preview = previewDisplayFor(name, form)
  return (
    <Box
      data-testid="alert-display-preview"
      sx={{
        borderRadius: 1,
        px: 1.5,
        py: 1.5,
        background: '#14161a',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 56,
        overflow: 'hidden'
      }}
    >
      {preview ? (
        <Box
          component="span"
          sx={{
            fontFamily: ALERT_FONT_STACKS[form.font ?? defaults.font],
            fontSize: `${String(form.fontSize ?? defaults.fontSize)}px`,
            color: alertDisplayColor(form.color ?? defaults.color),
            fontWeight: 700,
            lineHeight: 1.25,
            textAlign: 'center',
            overflowWrap: 'anywhere',
            textShadow: '0 1px 2px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.85)'
          }}
        >
          {preview}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Shows nothing - give the alert a name or some text.
        </Typography>
      )}
    </Box>
  )
}

/**
 * THE SHOW-ON-SCREEN SECTION. Unlike SpeechBlock this one owns its own switch and self-hides its
 * body, because there is no divider or sibling section whose layout depends on it — the dialog
 * ends here.
 */
export default function DisplayBlock({
  name,
  form,
  defaults,
  captureNames = []
}: {
  name: string
  form: DisplayForm
  /** What the TARGET overlay gives a field this alert does not override (useAlertOverlayDefaults). */
  defaults: AlertTextDefaults
  /**
   * The named capture groups the alert's CURRENT trigger declares (`captureNamesIn`), recomputed
   * as the user edits the pattern — the same list the Voice section gets, because it is the same
   * namespace. Empty for the alerts that capture nothing, which is most of them, and then the
   * hint renders nothing at all rather than an empty label.
   */
  captureNames?: string[]
}): JSX.Element {
  return (
    <Box data-testid="alert-display-block">
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="alert-display-enable"
            checked={form.on}
            onChange={(e) => form.setOn(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Show it on screen</Typography>}
      />
      {form.on && (
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextRow form={form} captureNames={captureNames} />
          <TargetRow form={form} defaults={defaults} />
          <StyleRow form={form} defaults={defaults} />
          <DisplayPreview name={name} form={form} defaults={defaults} />
        </Stack>
      )}
    </Box>
  )
}
