// displayForm — the state behind the alert editor's "Show it on screen" section, and the
// translation back to the def's one optional key.
//
// Split from DisplayBlock.tsx (which is the rendering) for the reason `conditionDraft.ts` is split
// from `ConditionEditor.tsx`: a draft model that is pure and testable, and a component that only
// draws it. Both files stay well under the factoring ceiling as a result.
//
// NULL MEANS INHERIT, and that is the whole model. Each of the four style fields is either a real
// value the alert chose or `null`, which is the absence of the key on the def — and the absence of
// the key is what makes the alert follow its overlay's own font/size/colour/seconds, today and
// after the user changes them. It is deliberately NOT "the field holds the default value": that
// would freeze today's default onto every alert authored today, and the point of a per-overlay
// default is that changing it moves the alerts that never disagreed with it.

import { useEffect, useState } from 'react'
import type { AlertDef, AlertDisplay, AlertFont } from '@shared/types'
import { MAX_DISPLAY_CHARS } from '@shared/alertDisplay'
import { DEFAULT_ALERT_OVERLAY, type AlertOverlayKind } from '@shared/alertOverlays'

/** The sub-form AlertDialog holds and DisplayBlock renders. `null` on a style field = inherit. */
export interface DisplayForm {
  /** Does this alert draw at all? Maps to the PRESENCE of `AlertDef.display`. */
  on: boolean
  setOn: (v: boolean) => void
  /** '' = draw the alert's own name. */
  text: string
  setText: (v: string) => void
  overlay: AlertOverlayKind
  setOverlay: (v: AlertOverlayKind) => void
  font: AlertFont | null
  setFont: (v: AlertFont | null) => void
  fontSize: number | null
  setFontSize: (v: number | null) => void
  color: string | null
  setColor: (v: string | null) => void
  durationMs: number | null
  setDurationMs: (v: number | null) => void
}

/** Every field this sub-form holds, as plain values. */
interface DisplayValues {
  on: boolean
  text: string
  overlay: AlertOverlayKind
  font: AlertFont | null
  fontSize: number | null
  color: string | null
  durationMs: number | null
}

/** An alert that draws nothing yet: on the default overlay, overriding none of its look. */
const BLANK: DisplayValues = {
  on: false,
  text: '',
  overlay: DEFAULT_ALERT_OVERLAY,
  font: null,
  fontSize: null,
  color: null,
  durationMs: null
}

/** The fields read off a def (edit) or at their blanks (add). */
function displayDefaults(initial: AlertDef | null): DisplayValues {
  const d = initial?.display
  // The PRESENCE of the block is the switch, so a def without one is simply the blank form.
  if (!d) return { ...BLANK }
  return {
    on: true,
    text: d.text ?? BLANK.text,
    overlay: d.overlay ?? BLANK.overlay,
    font: d.font ?? null,
    fontSize: d.fontSize ?? null,
    color: d.color ?? null,
    durationMs: d.durationMs ?? null
  }
}

/** Hydrate the display sub-form from `initial` (edit) or its blanks (add), on every open. */
export function useDisplayForm(open: boolean, initial: AlertDef | null): DisplayForm {
  const [v, setV] = useState<DisplayValues>(BLANK)

  // Keyed on `open`+`initial` exactly like `useSpeechForm`, and for the reason documented there:
  // an effect that re-runs on anything else overwrites what the user has typed, which is how
  // alt-tabbing away from the dialog used to blank it.
  useEffect(() => {
    if (!open) return
    setV(displayDefaults(initial))
  }, [open, initial])

  const set = <K extends keyof DisplayValues>(key: K) => (value: DisplayValues[K]): void => {
    setV((cur) => ({ ...cur, [key]: value }))
  }

  return {
    ...v,
    setOn: set('on'),
    setText: set('text'),
    setOverlay: set('overlay'),
    setFont: set('font'),
    setFontSize: set('fontSize'),
    setColor: set('color'),
    setDurationMs: set('durationMs')
  }
}

/** Does this form draw anything? The dialog's show/hide and the def's key agree through it. */
export function showsText(f: DisplayForm): boolean {
  return f.on
}

/**
 * The def key this block owns. The whole key is OMITTED when the switch is off, and each field
 * inside it is omitted when it is INHERITED — so an alert that never asked to be seen saves
 * byte-identically to how it always did, and one that only wanted different words carries only
 * those words.
 */
export function displayFieldsFor(f: DisplayForm): Pick<AlertDef, 'display'> {
  if (!f.on) return {}
  const display: AlertDisplay = {}
  const text = f.text.trim().slice(0, MAX_DISPLAY_CHARS)
  if (text) display.text = text
  if (f.overlay !== DEFAULT_ALERT_OVERLAY) display.overlay = f.overlay
  if (f.font !== null) display.font = f.font
  if (f.fontSize !== null) display.fontSize = f.fontSize
  if (f.color !== null) display.color = f.color
  if (f.durationMs !== null) display.durationMs = f.durationMs
  return { display }
}
