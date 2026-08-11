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
//
// …AND THE UNIFORM SIZE IS NOW A FUNCTION OF THE DISPLAY (JOS-119). Splitting the buff/timer
// overlay in two made a SEVENTH meter kind, which is exactly the case the old note in
// shared/types.ts warned about: seven 380x320 slots do not fit a 1366x728 laptop's work area
// under any column arrangement (three columns fit, two rows fit, that is six slots), so the wrap
// would have clamped a fourth column on top of the third and two windows would have opened
// exactly over each other. The answer is NOT to let them overlap and it is NOT a per-kind size:
// on a display that cannot hold the whole reserved grid, EVERY kind shrinks TOGETHER by the same
// factor until the grid fits. Uniformity survives, the no-overlap guarantee survives, and a
// display big enough for the full grid (anything 1080p or larger) is untouched at 380x320.

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
 * ALERT TEXT is a LANE, not a panel (docs/plans/alert-text-overlays.md). Wide enough for a
 * substituted line at the default 28 px without wrapping mid-phrase, and only tall enough to hold
 * a few stacked lines — the window is transparent, so unused height costs nothing visually, but
 * unused height is also where a stray line would appear far from where the user is looking.
 */
const ALERT_SIZE: Size = { width: 560, height: 200 }

/**
 * Where the first alert overlay sits: centred, and BELOW the celebration strip.
 *
 * The toast occupies 12…372 from the top of the work area, so 400 clears it with a gutter and the
 * two notifier kinds cannot open on top of each other. It is high enough to read without looking
 * away from the fight and low enough not to sit in the toast's lane — and, like every other kind,
 * it is only ever the FIRST open: persisted bounds always win.
 */
const ALERT_TOP = 400

/** How far a kind's window may be dragged. An absent maximum means the OS imposes the only one. */
export interface SizeLimits {
  minWidth: number
  minHeight: number
  maxWidth?: number
  maxHeight?: number
}

/**
 * The resize bounds for a kind's window.
 *
 * A METER IS A PANEL AND HAS A LARGEST USEFUL SIZE. 720x820 is about where a dense bar list stops
 * gaining anything from more room and starts being a window you have to look away from the fight
 * to read — and the reserved-slot grid is laid out against sizes in that neighbourhood.
 *
 * AN ALERT LANE IS A BANNER, AND HAS NO SUCH CEILING. It draws one centred line per firing, so its
 * width is simply how much of a substituted line fits before it wraps — a raid caller who wants
 * "Kaiaren begins casting Ancient Breath" across the full top of an ultrawide is asking for the
 * feature to work, not misusing it. So the lane states its own limits: a minimum small enough to
 * park a short banner in a corner, and NO maximum at all. The height cap goes with the width for
 * the same reason — a taller lane is more stacked lines visible at once, which is what someone
 * widening it for a busy pull also wants.
 */
export function overlaySizeLimits(kind: OverlayKind): SizeLimits {
  if ((ALERT_OVERLAY_KINDS as readonly string[]).includes(kind)) {
    return { minWidth: 120, minHeight: 48 }
  }
  return { minWidth: 200, minHeight: 90, maxWidth: 720, maxHeight: 820 }
}

/**
 * Where an alert overlay's window goes on its first open: horizontally CENTRED like the toast, at
 * ALERT_TOP, and staggered DOWNWARD by its index in the roster so a second one never lands on the
 * first. Clamped to the work area exactly like every other path here.
 *
 * The stagger is by roster index rather than by "how many are open", for the same reason the meter
 * stack reserves slots: a position that depends on what else happens to be open is a position that
 * moves under the user.
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

/**
 * The first-open size for a kind — the same for all the meters; the toast is its own strip.
 *
 * `workArea` is optional because one caller genuinely has no display to ask about (windows.ts's
 * headless/e2e path sizes a window before any screen info exists). Without it the answer is the
 * full uniform size, which is what every display large enough for the reserved grid gets anyway.
 */
export function overlayDefaultSize(kind: OverlayKind, workArea?: Bounds): Size {
  if (kind === 'toast') return { ...TOAST_SIZE }
  // A NOTIFIER ignores `workArea` entirely: it holds no slot in the reserved grid, so the shrink
  // that keeps the meters from overlapping has nothing to do with it — and shrinking a text lane
  // would shrink the one thing on screen the user asked to be able to read.
  if ((ALERT_OVERLAY_KINDS as readonly string[]).includes(kind)) return { ...ALERT_SIZE }
  return workArea ? meterSize(workArea) : { ...DEFAULT_SIZE }
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

/** Gap from the screen edge and between stacked overlays. */
const MARGIN = 16
const GUTTER = 10

/** The kinds that dock into the bottom-right stack — every kind except the toast strip. */
export const METER_KINDS: OverlayKind[] = OVERLAY_KINDS.filter((k) => !isNotifierOverlayKind(k))

/**
 * How many uniform slots of this height stack between the bottom and top margins of a work area.
 * Always at least one — a display shorter than a single overlay still has to place it somewhere,
 * and the final clamp in `defaultOverlayBounds` keeps it on-screen.
 */
function rowsThatFit(height: number, workArea: Bounds): number {
  return Math.max(1, Math.floor((workArea.height - 2 * MARGIN + GUTTER) / (height + GUTTER)))
}

/**
 * How many columns of this width fit walking LEFT from the right margin. Column `c` starts at
 * `workArea.width - width - MARGIN - c * (width + GUTTER)` measured from the work area's left
 * edge, so it fits while that expression is >= 0. Always at least one, for the same reason as above.
 */
function colsThatFit(width: number, workArea: Bounds): number {
  return Math.max(1, Math.floor((workArea.width - MARGIN - width) / (width + GUTTER)) + 1)
}

/**
 * THE SHRINK LADDER. Rungs are tried largest-first and the first one whose grid holds every meter
 * kind wins, so a display that can seat the full stack never leaves the top rung.
 *
 * It is a fixed ladder rather than a solved equation because the fit is a step function of both
 * dimensions (floor() twice) and a two-variable search would answer with sizes nobody chose. Five
 * rungs down to 70 % is enough for every display this app can be opened on: at 0.7 the slot is
 * 266x224 and a 1366x728 work area seats 4 columns x 3 rows = 12 of them. The bottom rung is
 * returned even if it still does not fit — an overlay that is slightly too big is a better answer
 * than a postage stamp, and `defaultOverlayBounds` clamps every window on-screen regardless.
 */
const SHRINK_LADDER = [1, 0.85, 0.8, 0.75, 0.7] as const

/** The uniform meter size for one display: the largest ladder rung whose grid seats every kind. */
function meterSize(workArea: Bounds): Size {
  const needed = METER_KINDS.length
  for (const scale of SHRINK_LADDER) {
    const size = {
      width: Math.round(DEFAULT_SIZE.width * scale),
      height: Math.round(DEFAULT_SIZE.height * scale)
    }
    if (colsThatFit(size.width, workArea) * rowsThatFit(size.height, workArea) >= needed) return size
  }
  const last = SHRINK_LADDER[SHRINK_LADDER.length - 1]
  return { width: Math.round(DEFAULT_SIZE.width * last), height: Math.round(DEFAULT_SIZE.height * last) }
}

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
  const size = overlayDefaultSize(kind, workArea)
  // A NOTIFIER holds no slot in the meter stack (each lives in its own lane), so it must not
  // consume an index either — otherwise adding one would shift every meter's reserved slot.
  const idx = Math.max(0, METER_KINDS.indexOf(kind))
  // How many uniform slots fit between the bottom and top margins of this work area.
  const perColumn = rowsThatFit(size.height, workArea)
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

/**
 * Per-kind OS WINDOW TITLE — never user-visible on a frameless overlay, but it is what shows up in
 * a window list, a crash report, and the Task Manager row somebody screenshots into a bug report.
 *
 * It lives HERE, beside the size and the reserved slot, because it is the same kind of fact: a
 * per-kind presentation constant with no Electron in it. It used to sit in windows.ts, whose
 * subject is the runtime — BrowserWindow construction, the trust boundary, the hide policy — and
 * which reached the 400-code-line ceiling the moment JOS-194 added a tenth row to this table. The
 * repo's answer to that ceiling is a split, and a pure lookup table is the part of that file which
 * was never about Electron in the first place.
 *
 * Partial + fallback, so a new kind can never break the build here: an untitled window gets
 * Electron's default rather than a compile error in the middle of the window factory.
 */
export const OVERLAY_TITLE: Partial<Record<OverlayKind, string>> = {
  fight: 'Fight Overlay',
  overall: 'Zone Overlay',
  events: 'Event Log Overlay',
  'heal-fight': 'Fight Healing Overlay',
  'heal-overall': 'Zone Healing Overlay',
  toast: 'Celebration Overlay',
  buffs: 'Buff Timer Overlay',
  debuffs: 'Debuff Timer Overlay',
  xp: 'XP Overlay',
  respawn: 'Respawn Timer Overlay',
  alert: 'Alert Text Overlay'
}
