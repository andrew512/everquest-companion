// Default overlay window placement (Task #59).
//
// Overlay windows persist their bounds the moment the user moves/resizes them, so this only
// ever decides where a kind appears the FIRST time it is opened (or after its stored bounds are
// cleared). The persisted position ALWAYS wins — see `overlayPlacement` in windows.ts, which
// prefers `cfg.bounds` and calls in here only when there are none.
//
// Layout: every kind docks to the BOTTOM-RIGHT of the primary display's work area, stacked
// upward in OVERLAY_KINDS order with a small gutter, so opening two or three overlays never
// lands one exactly on top of another. When the stack would run past the top of the work area it
// WRAPS INTO A NEW COLUMN to the left instead — with one uniform size that is exact, so no two
// kinds can ever overlap on their first open.
//
// SIZE IS UNIFORM across kinds (user decision): every overlay opens at the same width x height,
// whatever it renders. It is erring on the large side of the old per-kind values so the event
// log — the only kind that is a list rather than a handful of dense bars — is not cramped.

import { OVERLAY_KINDS, type OverlayKind } from '../shared/types'
import { ALERT_OVERLAY_KINDS, isNotifierOverlayKind } from '../shared/alertOverlays'

export interface Size {
  width: number
  height: number
}
export interface Bounds extends Size {
  x: number
  y: number
}

/**
 * The ONE default size every overlay kind opens at. Chosen to be ≥ every per-kind size this
 * replaced (the largest was the event log's 360x300): wide enough for a meter's `name · stats ·
 * rate · total` bar row without ellipsis, tall enough for ~8 event-log lines plus chrome.
 */
const DEFAULT_SIZE: Size = { width: 380, height: 320 }

/**
 * THE TOAST IS NOT A METER, and its geometry says so (docs/plans/celebration-toasts.md §3).
 * It is a transparent strip at the TOP CENTRE of the screen that normally renders nothing: it
 * has no selector, no drill and no bars, so the uniform meter size and the bottom-right stack
 * are both wrong for it. Width 560 (the card's own width), and tall enough to hold the capped
 * queue of three cards — the window is transparent, so unused height costs nothing visually
 * and the empty window is fully click-through.
 *
 * 440 → 560 and 300 → 360 on 2026-08-05: "look and feel is good, but it needs to be a bit
 * bigger/more prominent" (owner). The card's type scaled with it (overlay/ToastCard.tsx), so the
 * lane and its contents still fit exactly. PERSISTED BOUNDS STILL WIN — a user who has already
 * dragged or resized the strip keeps their geometry, and only sees the larger type.
 */
const TOAST_SIZE: Size = { width: 560, height: 360 }
/** Gap from the top of the work area to the first card. */
const TOAST_TOP = 12

/**
 * ALERT TEXT is a LANE, not a panel (docs/plans/alert-text-overlays.md §7). Wide enough for a
 * substituted line at the default 28 px without wrapping mid-phrase, and only tall enough to hold
 * a few stacked lines — the window is transparent, so unused height costs nothing visually, but
 * unused height is also where a stray line would appear far from where the user is looking.
 */
const ALERT_SIZE: Size = { width: 560, height: 200 }

/**
 * Where the first alert overlay sits: centred, and BELOW the celebration strip.
 *
 * The toast occupies 12…372 from the top of the work area, so 400 clears it with a gutter and
 * the two notifier kinds cannot open on top of each other. It is high enough to read without
 * looking away from the fight and low enough not to sit in the toast's lane — and, like every
 * other kind, it is only ever the FIRST open: persisted bounds always win.
 */
const ALERT_TOP = 400

/** The first-open size for a kind — the same for all the meters; each notifier is its own shape. */
export function overlayDefaultSize(kind: OverlayKind): Size {
  if (kind === 'toast') return { ...TOAST_SIZE }
  if ((ALERT_OVERLAY_KINDS as readonly string[]).includes(kind)) return { ...ALERT_SIZE }
  return { ...DEFAULT_SIZE }
}

/**
 * The toast's first-open placement: horizontally CENTRED on the work area, 12px from its top.
 * Clamped like every other kind so a display narrower than the strip still lands on-screen.
 */
function toastBounds(workArea: Bounds): Bounds {
  const size = { ...TOAST_SIZE }
  const x = workArea.x + Math.round((workArea.width - size.width) / 2)
  return {
    ...size,
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width)),
    y: Math.max(workArea.y, Math.min(workArea.y + TOAST_TOP, workArea.y + workArea.height - size.height))
  }
}

/**
 * Where an alert overlay's window goes on its first open: horizontally CENTRED like the toast,
 * at ALERT_TOP, and staggered DOWNWARD by its index in the roster so a second one never lands on
 * the first. Clamped to the work area exactly like every other path here.
 *
 * The stagger is by roster index rather than by "how many are open", for the same reason the
 * meter stack reserves slots: a position that depends on what else happens to be open is a
 * position that moves under the user.
 */
function alertBounds(kind: OverlayKind, workArea: Bounds): Bounds {
  const size = { ...ALERT_SIZE }
  const idx = Math.max(0, (ALERT_OVERLAY_KINDS as readonly string[]).indexOf(kind))
  const x = workArea.x + Math.round((workArea.width - size.width) / 2)
  const y = workArea.y + ALERT_TOP + idx * (size.height + GUTTER)
  return {
    ...size,
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size.height))
  }
}

/** Gap from the screen edge and between stacked overlays. */
const MARGIN = 16
const GUTTER = 10

/**
 * The kinds that dock into the bottom-right stack — every kind that is not a NOTIFIER
 * (shared/alertOverlays.ts). A notifier has its own geometry and must hold no slot here, or
 * adding one would shift every meter's reserved position.
 */
export const METER_KINDS: OverlayKind[] = OVERLAY_KINDS.filter((k) => !isNotifierOverlayKind(k))

/**
 * Where a kind's window goes when it has no persisted bounds: docked bottom-right, offset upward
 * past every kind stacked below it (whether or not those are currently open — the slot is
 * RESERVED so positions stay stable and predictable), wrapping into a fresh column to the left
 * once a column is full. Clamped to the work area as a last resort on a display too small to
 * hold even one full column.
 */
export function defaultOverlayBounds(kind: OverlayKind, workArea: Bounds): Bounds {
  if (kind === 'toast') return toastBounds(workArea)
  if ((ALERT_OVERLAY_KINDS as readonly string[]).includes(kind)) return alertBounds(kind, workArea)
  const size = overlayDefaultSize(kind)
  // A notifier holds no slot in the meter stack (each lives in its own lane), so it must not
  // consume an index either — otherwise adding one would shift every meter's reserved slot.
  const idx = Math.max(0, METER_KINDS.indexOf(kind))
  // How many uniform slots fit between the bottom and top margins of this work area.
  const perColumn = Math.max(
    1,
    Math.floor((workArea.height - 2 * MARGIN + GUTTER) / (size.height + GUTTER))
  )
  const col = Math.floor(idx / perColumn)
  const row = idx % perColumn
  const x = workArea.x + workArea.width - size.width - MARGIN - col * (size.width + GUTTER)
  const y = workArea.y + workArea.height - size.height - MARGIN - row * (size.height + GUTTER)
  return {
    ...size,
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size.height))
  }
}
