// alertOverlays.ts — WHICH overlay windows an alert may put text into, and the one predicate
// that says what such a window has in common with the celebration toast
// (docs/plans/alert-text-overlays.md §1).
//
// THE ROSTER, NOT THE MODEL. What a `display` block CONTAINS — the template, the font, the caps,
// the normalizer — lives next door in ./alertDisplay. This file is imported by WINDOW code
// (main/windows.ts, main/overlayLayout.ts, main/replayGate.ts), which has no business reaching a
// def-field normalizer, and the split is what keeps that true.
//
// ONE TODAY, AND THE LIST IS THE EXTENSION POINT. The owner asked for a single positionable alert
// overlay with the groundwork for several, so a def stores its target as an overlay KIND and
// everything downstream reads this list rather than the literal `'alert'`. Adding a second is
// five lines: a union member in ./types, an entry here, a label, a TELEMETRY_OVERLAY_KINDS entry,
// and a DEFAULT_OVERLAY_CONFIG entry the compiler will demand. The layout stagger, the mouse
// rule, the opaque-mode hide, the editor's target picker and the Preferences panel all follow.
//
// Pure and dependency-free (one type-only import), so `npm test` exercises it with no Electron.

import type { OverlayKind } from './types'

/** The overlay kinds an alert may dump text into. */
export const ALERT_OVERLAY_KINDS = ['alert'] as const satisfies readonly OverlayKind[]
export type AlertOverlayKind = (typeof ALERT_OVERLAY_KINDS)[number]

/** Where a def's text goes when it names no overlay of its own. */
export const DEFAULT_ALERT_OVERLAY: AlertOverlayKind = 'alert'

/** What the editor's target picker calls each one. */
export const ALERT_OVERLAY_LABELS: Record<AlertOverlayKind, string> = {
  alert: 'Alert text'
}

/** Is this kind one an alert may target? */
export function isAlertOverlayKind(kind: OverlayKind): kind is AlertOverlayKind {
  return (ALERT_OVERLAY_KINDS as readonly string[]).includes(kind)
}

/**
 * Coerce a stored / renderer-supplied / IMPORTED target to a real one.
 *
 * Unknown ⇒ the default, never dropped. A shared alert set can name an overlay this build does
 * not have, and a def whose target went away should still show up SOMEWHERE — an alert that
 * silently stopped appearing is the one failure the user cannot see (world-model law 1's spirit:
 * say something true rather than nothing).
 */
export function alertOverlayKind(v: unknown): AlertOverlayKind {
  return typeof v === 'string' && (ALERT_OVERLAY_KINDS as readonly string[]).includes(v)
    ? (v as AlertOverlayKind)
    : DEFAULT_ALERT_OVERLAY
}

/**
 * NOTIFIER kinds — the overlay windows that are mostly EMPTY, whose resting state is drawing
 * nothing at all. Three consequences follow, and all three used to be spelled `kind !== 'toast'`
 * in three separate files:
 *
 *   1. NO SLOT IN THE METER STACK (main/overlayLayout.ts). A notifier is not a panel you park in
 *      the bottom-right corner; it has its own geometry, and it must not consume a stack index
 *      or every meter's reserved slot would shift when one is added.
 *   2. NO MOUSE FORWARDING (main/replayGate.ts). `setIgnoreMouseEvents(true, {forward:true})`
 *      installs a system-wide WH_MOUSE_LL hook to serve a hover sensor. A notifier has none — it
 *      is empty most of the time — so it would pay a hook that lands on the user's own mouselook.
 *   3. HIDDEN WHILE IDLE IN OPAQUE MODE (main/windows.ts, JOS-40). A window built non-transparent
 *      cannot be an invisible empty strip, so an opaque notifier is shown only when it has
 *      something to show. Otherwise the compatibility mode parks a solid rectangle over the game
 *      forever, which is not a compatibility mode — it is a new bug.
 *
 * The toast is the original; every alert text overlay is one too.
 */
export const NOTIFIER_OVERLAY_KINDS: OverlayKind[] = ['toast', ...ALERT_OVERLAY_KINDS]

/** Is this kind an empty-at-rest notifier (see NOTIFIER_OVERLAY_KINDS for the three rules)? */
export function isNotifierOverlayKind(kind: OverlayKind): boolean {
  return NOTIFIER_OVERLAY_KINDS.includes(kind)
}
