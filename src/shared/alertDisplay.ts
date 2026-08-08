// alertDisplay.ts — WHAT a text alert draws, and the wire it draws it over
// (docs/plans/alert-text-overlays.md §3/§4).
//
// The `speechText.ts` arrangement, for the same reasons: the TYPES (`AlertDisplay`, `AlertFont`)
// live in shared/alertTypes.ts beside the rest of the def; the VALUES — the font stacks, the
// caps, the normalizer, the resolver, the wire validator — live here, because this is the module
// every consumer (the store's save path, the IPC handler, the editor, the overlay window) already
// has to import.
//
// TWO FUNCTIONS CARRY THE FEATURE:
//   `displayTextFor(def, firing)`  the line to draw, resolved. PURE — no clock, no store, no IPC —
//                                  so the editor's live preview and the real firing produce
//                                  byte-identical text from the same inputs, the contract
//                                  `speechTextFor` already has. It MIRRORS that function
//                                  deliberately, including the alertName fallback, and calls the
//                                  SAME `substitute` (shared/captures.ts). One `$<name>`
//                                  implementation in the tree; tests pin that they agree.
//   `validateAlertTextRequest`     the trust boundary. `alertText:show` is renderer→main, and what
//                                  crosses it ends up in a `style` attribute IN ANOTHER WINDOW.
//
// EVERYTHING IS REPAIRED, ALMOST NOTHING IS REFUSED. An out-of-range size, a duration of a
// fortnight, a colour that is not a hex triple — each falls back to its documented default, and
// only a request with no text or an overlay this build does not have is dropped. The reason is
// the same one `speak()` gives for never being silent: a malformed FIELD must not be why an alert
// the user can see is enabled shows nothing at all.
//
// Pure and Electron-free, so `npm test` exercises all of it.

import type { AlertDef, AlertDisplay, AlertFont } from './alertTypes'
import type { SpeechFiring } from './speechText'
import { substitute, tidy } from './captures'
import { ALERT_OVERLAY_KINDS, isAlertOverlayKind, type AlertOverlayKind } from './alertOverlays'
import type { OverlayKind } from './types'

// ---- the font roster (owner decision, 2026-08-07: a curated list, never free text) ---------

/** Every font a text alert may pick, for the editor's picker. Exhaustive by construction. */
export const ALERT_FONTS = ['sans', 'serif', 'mono', 'display'] as const satisfies readonly AlertFont[]

// Compile-time proof that the list covers the WHOLE union — the SPEECH_MODES pattern. If a
// member is added to AlertFont and forgotten here, the assignment below stops compiling.
const _fontsExhaustive: (typeof ALERT_FONTS)[number] = null as unknown as AlertFont
void _fontsExhaustive

/**
 * The CSS each key resolves to. The overlay bundle loads no webfonts, so every stack is built
 * from families Windows ships and ends in a generic — a machine missing the first name still
 * draws the line, in something of the right shape.
 */
export const ALERT_FONT_STACKS: Record<AlertFont, string> = {
  sans: '"Segoe UI", Tahoma, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
  display: '"Arial Black", Impact, "Segoe UI Black", sans-serif'
}

/** What the picker calls each one. */
export const ALERT_FONT_LABELS: Record<AlertFont, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Monospace',
  display: 'Heavy'
}

export const DEFAULT_ALERT_FONT: AlertFont = 'sans'

// ---- caps + clamps (rendering guarantees, not taste) --------------------------------------

/**
 * Below 10 px the glyphs disappear into game art at any colour, so a "smaller" that cannot be
 * read is not a smaller alert — it is a missing one. Above 96 px the shipped 560 px lane holds
 * about six characters, and the honest answer past that is a BIGGER WINDOW, not a bigger number
 * (the TEXT_SCALE_MAX argument in shared/types.ts, applied to the same problem).
 */
export const MIN_ALERT_FONT_PX = 10
export const MAX_ALERT_FONT_PX = 96
export const DEFAULT_ALERT_FONT_PX = 28

/**
 * How long one line may hold the screen. The SAME bounds as the celebration toast
 * (TOAST_MIN/MAX_DURATION_MS) because it is the same question — and they are restated here
 * rather than imported, because coupling a def field to the celebration PAYLOAD module for two
 * numbers would be a worse dependency than two constants and this comment.
 */
export const MIN_ALERT_DISPLAY_MS = 1_000
export const MAX_ALERT_DISPLAY_MS = 30_000
export const DEFAULT_ALERT_DISPLAY_MS = 5_000

/**
 * Longest line a single alert may draw.
 *
 * Speech caps at 120 because that is roughly eight seconds of talking; this one is bounded by
 * PIXELS instead — 140 characters at the default 28 px wraps to about three lines in the default
 * lane, which is already past what anyone reads mid-pull. TRUNCATED, NEVER REFUSED, exactly as
 * MAX_SPEECH_CHARS is: a paste-happy template still shows its opening words.
 */
export const MAX_DISPLAY_CHARS = 140

/** The card's key. Capped because it rides IPC; it is never a path, a lookup or a style. */
export const MAX_ALERT_TEXT_ID = 64

/** The gold the overlay chrome already uses, so an alert that names no colour looks like the app. */
export const DEFAULT_ALERT_COLOR = '#ffcc33'

/**
 * A colour this app will put in another window's `style`. `#rgb` or `#rrggbb`, and NOTHING else:
 * not `rgb()`, not a named colour, not `var()`. One shape and one regex means the value cannot
 * carry a `url()`, a second declaration or a trailing `;` into a style attribute — the
 * `isSafePackId` rule (main/ipc/sounds.ts), applied to CSS.
 */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ---- coercion, one answer each ------------------------------------------------------------

/** The CSS stack for a key; anything unknown draws in the default rather than nothing. */
export function alertFontStack(font: AlertFont | undefined): string {
  return ALERT_FONT_STACKS[font ?? DEFAULT_ALERT_FONT] ?? ALERT_FONT_STACKS[DEFAULT_ALERT_FONT]
}

/** A font key from anything; unknown ⇒ DEFAULT_ALERT_FONT. */
export function alertFont(v: unknown): AlertFont {
  return ALERT_FONTS.find((f) => f === v) ?? DEFAULT_ALERT_FONT
}

/** A drawable colour from anything; malformed ⇒ DEFAULT_ALERT_COLOR. */
export function alertDisplayColor(v: unknown): string {
  return typeof v === 'string' && HEX_COLOR_RE.test(v.trim()) ? v.trim().toLowerCase() : DEFAULT_ALERT_COLOR
}

/** A pixel size in range; non-finite ⇒ the default. */
export function alertFontSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_ALERT_FONT_PX
  return Math.min(MAX_ALERT_FONT_PX, Math.max(MIN_ALERT_FONT_PX, Math.round(v)))
}

/** A hold time in range; non-finite ⇒ the default. */
export function alertDisplayDuration(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_ALERT_DISPLAY_MS
  return Math.min(MAX_ALERT_DISPLAY_MS, Math.max(MIN_ALERT_DISPLAY_MS, Math.floor(v)))
}

/**
 * Repair anything claiming to be an AlertDisplay, or null when there is nothing to draw.
 *
 * NULL IS "THE KEY IS ABSENT", not an error: the presence of `display` IS the enable, so a block
 * that survived as `{}` would be an alert silently showing its own name over the game. A caller
 * that gets null deletes the key.
 *
 * AN OMITTED FIELD MEANS "INHERIT", NOT "the global default". That distinction is the whole of the
 * per-overlay defaults feature: an alert that explicitly chose 28 px keeps 28 px even though 28 is
 * also the shipped constant, because the OVERLAY it targets may say 48 — and an alert that chose
 * nothing follows whatever the overlay says today and tomorrow. So a present, valid field is kept
 * verbatim; only an absent or unusable one is dropped, which is still the omit-what-was-not-asked-
 * for rule that keeps a def byte-identical across a round trip.
 */
export function normalizeAlertDisplay(v: unknown): AlertDisplay | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const out: AlertDisplay = { ...alertDisplayStyle(o) }
  const text = typeof o.text === 'string' ? tidy(o.text).slice(0, MAX_DISPLAY_CHARS) : ''
  if (text) out.text = text
  if (typeof o.overlay === 'string' && isAlertOverlayKind(o.overlay as OverlayKind)) {
    out.overlay = o.overlay as AlertOverlayKind
  }
  // An input that WAS a display block but overrode nothing still means "draw this alert" — the
  // block is the enable, and inheriting everything is a real answer. Only a non-object means
  // nothing.
  return out
}

/**
 * The four STYLE fields, each kept only when it is a usable OVERRIDE — an absent or unusable one
 * is left out, which is how it comes to be inherited from the overlay.
 *
 * Its own function because the two callers are the def's normalizer above and the wire's validator
 * below, and those five rules must be the same five rules in both places: a request carries
 * exactly the style a def can, so it is checked by exactly the same code.
 */
function alertDisplayStyle(o: Record<string, unknown>): AlertDisplayStyle {
  const out: AlertDisplayStyle = {}
  const font = ALERT_FONTS.find((f) => f === o.font)
  if (font) out.font = font
  if (typeof o.fontSize === 'number' && Number.isFinite(o.fontSize)) out.fontSize = alertFontSize(o.fontSize)
  if (typeof o.color === 'string' && HEX_COLOR_RE.test(o.color.trim())) out.color = o.color.trim().toLowerCase()
  if (typeof o.durationMs === 'number' && Number.isFinite(o.durationMs)) {
    out.durationMs = alertDisplayDuration(o.durationMs)
  }
  return out
}

/** The look half of a display block: what an alert overrides, all of it optional. */
type AlertDisplayStyle = Pick<AlertDisplay, 'font' | 'fontSize' | 'color' | 'durationMs'>

// ---- the per-overlay DEFAULTS (owner, 2026-08-07) -----------------------------------------
//
// Each alert overlay carries the look it gives a line that does not ask for its own, so a user
// who wants every alert big and yellow says it ONCE instead of on every alert — and can still
// override any of the four on any single alert. It rides `overlays.<kind>.alertText`
// (OverlayConfig.alertText) rather than a second store key, exactly as the toast's `durationMs`
// rides `overlays.toast.toast`: one open-state, one persisted bounds, one per-kind config read.
//
// THE BLOB IS ALWAYS COMPLETE. Unlike AlertDisplay — where an absent field means "inherit" — every
// field here is required, because this IS the thing being inherited from and a hole in it would
// have nothing left to fall back to. `normalizeAlertTextDefaults` fills each one from the shipped
// constant, so a single read answers every question the resolver can ask.

/** The look one alert overlay gives a line that does not override it. */
export interface AlertTextDefaults {
  font: AlertFont
  fontSize: number
  color: string
  durationMs: number
}

/** What an overlay looks like before anybody changes it — the shipped constants, gathered. */
export const DEFAULT_ALERT_TEXT: AlertTextDefaults = {
  font: DEFAULT_ALERT_FONT,
  fontSize: DEFAULT_ALERT_FONT_PX,
  color: DEFAULT_ALERT_COLOR,
  durationMs: DEFAULT_ALERT_DISPLAY_MS
}

/**
 * Coerce a stored/patched defaults blob into a COMPLETE one (the store's clamp lives here).
 *
 * Every coercer already answers `undefined` with its shipped constant, so a partial blob, a
 * hand-edited file and a blob from a future build all resolve to something drawable.
 */
export function normalizeAlertTextDefaults(v: unknown): AlertTextDefaults {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  return {
    font: alertFont(o.font),
    fontSize: alertFontSize(o.fontSize),
    color: alertDisplayColor(o.color),
    durationMs: alertDisplayDuration(o.durationMs)
  }
}

// ---- what a firing draws ------------------------------------------------------------------

/** The def fields the resolver reads. Any AlertDef satisfies it. */
export type DisplayDef = Pick<AlertDef, 'name' | 'display'>

/**
 * The text this alert should draw for this firing, or null when there is nothing truthful to
 * draw (a nameless def with an empty template — the overlay shows nothing rather than a blank
 * card).
 *
 * `firing` is optional so the editor can preview before anything has fired; with no firing the
 * placeholders simply drop, which is exactly what the user will see whenever the trigger turns
 * out not to carry them. The alertName fallback and the whitespace rule are `speechTextFor`'s,
 * unchanged — one behaviour across both surfaces, not two that look alike.
 */
export function displayTextFor(def: DisplayDef, firing?: SpeechFiring | null): string | null {
  // Substitute BEFORE tidying, so the gap a dropped placeholder leaves collapses with the rest
  // rather than becoming a double space in the middle of the line.
  const resolved = tidy(substitute(def.display?.text ?? '', firing?.captures))
  const text = resolved || tidy(def.name)
  return text ? text.slice(0, MAX_DISPLAY_CHARS) : null
}

// ---- the wire (renderer → main → the overlay window) --------------------------------------

/**
 * What a FIRING sends (renderer → main): the resolved line, the overlay it belongs on, and ONLY
 * the styling this alert actually overrode.
 *
 * The style fields are optional for the same reason the def's are: absent means "whatever that
 * overlay says", and only MAIN can answer that — it holds the store. This is the toast's
 * request/payload split arriving for the same reason (`ToastRequest.itemName` → `ToastPayload.item`):
 * a producer says what happened, main fills in what only it knows.
 */
export interface AlertTextRequest {
  /**
   * PER-FIRING id (`<alertId>:<seq>`) — the React key and the eviction handle, and deliberately
   * NOT a dedupe key the way `ToastPayload.id` is. Two fires of one alert are two things that
   * happened, and the owner's requirement is that they STACK rather than replace each other.
   */
  id: string
  /** Which overlay window it lands in. */
  overlay: AlertOverlayKind
  text: string
  /** Absent ⇒ the target overlay's default (AlertTextDefaults). */
  font?: AlertFont
  fontSize?: number
  color?: string
  durationMs?: number
}

/**
 * The card as the overlay window receives it: COMPLETE. Every question is answered before it
 * crosses, because the overlay bundle draws what it is given and looks nothing up.
 */
export interface AlertTextCard {
  id: string
  text: string
  font: AlertFont
  fontSize: number
  color: string
  durationMs: number
}

/**
 * Fill a firing's gaps from the overlay it landed on — the ONE place the inheritance happens, so
 * "the alert wins, the overlay decides the rest" is a single expression rather than a rule spread
 * over four call sites.
 */
export function resolveAlertTextCard(req: AlertTextRequest, defaults: AlertTextDefaults): AlertTextCard {
  return {
    id: req.id,
    text: req.text,
    font: req.font ?? defaults.font,
    fontSize: req.fontSize ?? defaults.fontSize,
    color: req.color ?? defaults.color,
    durationMs: req.durationMs ?? defaults.durationMs
  }
}

function cappedText(v: unknown, max: number): string {
  return typeof v === 'string' ? tidy(v).slice(0, max) : ''
}

/**
 * Re-validate a renderer-supplied request. Returns a NEW object carrying only the fields this
 * module names — unknown properties are stripped, not passed through — or null when the request
 * cannot be honoured.
 *
 * ONLY TWO THINGS ARE FATAL: no id/text (there is nothing to draw) and an overlay this build does
 * not have (there is nowhere to draw it — and unlike a def's stored target, which coerces to the
 * default so a shared alert still appears, a live request naming a window that does not exist is
 * a bug in the caller, not a preference to honour).
 *
 * A MALFORMED STYLE FIELD IS DROPPED, WHICH MEANS INHERITED. It used to be forced to the shipped
 * constant; now that overlays carry their own look, the honest repair for "this value is not
 * usable" is to fall through to the overlay rather than to override it with a global the user may
 * never have chosen. Either way a bad field is never why an alert goes unseen.
 */
export function validateAlertTextRequest(input: unknown): AlertTextRequest | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  const id = cappedText(o.id, MAX_ALERT_TEXT_ID)
  const text = cappedText(o.text, MAX_DISPLAY_CHARS)
  if (!id || !text) return null
  if (typeof o.overlay !== 'string' || !(ALERT_OVERLAY_KINDS as readonly string[]).includes(o.overlay)) {
    return null
  }
  // The style half is exactly the def's own optional shape, so it is checked by the same function
  // rather than by a second list of the same rules.
  return { id, overlay: o.overlay as AlertOverlayKind, text, ...alertDisplayStyle(o) }
}
