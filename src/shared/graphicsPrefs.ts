// shared/graphicsPrefs.ts — THE PURE HALF of graphics compatibility (JOS-40).
//
// WHY THIS EXISTS. A player on an RTX 5080 (driver 591.86, Windows 11) reported the floating
// overlays producing black-screen artifacting. The overlays are transparent, frameless,
// always-on-top windows — the one window shape whose correctness depends entirely on the
// driver's per-pixel alpha compositing — and there is no way to reproduce that here. So the app
// ships the two SELF-SERVE switches that between them retire both halves of the risk:
//
//   safeMode        — draw without the graphics card at all (`app.disableHardwareAcceleration()`).
//                     Whole-app, decided before Electron is ready, so it is a NEXT-LAUNCH setting
//                     by construction rather than by policy.
//   opaqueOverlays  — build the overlay windows WITHOUT transparency, on a solid background the
//                     same colour they already paint. Per-window, so it applies when an overlay
//                     is next opened.
//
// It is a ZERO-IMPORT module for the same reason `shared/perf.ts` and `shared/telemetry.ts` are:
// `storeMigrations.ts` runs from store.ts's module scope, before electron-store exists, and needs
// this normalizer without dragging the LogEvent union in behind it. No Electron, no Node — so
// `tests/graphicsPrefs.test.mts` pins every rule that decides what a switch MEANS.
//
// GENERIC ON PURPOSE — NO WINE DETECTION HERE (JOS-31 will reuse this). The env var below is the
// door a launcher script, a Wine prefix or a support reply can reach without the app's UI, which
// matters precisely in the case these switches exist for: a window you cannot see is a window
// whose Preferences you cannot open. Nothing in this module knows what a Wine prefix is, and
// nothing should: the platform-specific ticket sets the same variable everyone else can set.

/**
 * The two switches, persisted as one top-level `graphics` blob (store schema v10).
 *
 * BOTH DEFAULT OFF, and that is the whole policy: hardware acceleration and a see-through
 * overlay are what everyone should get, and a compatibility switch that is on by default is not
 * a compatibility switch — it is a downgrade shipped to every machine that never needed one.
 */
export interface GraphicsPrefs {
  /**
   * Draw the whole app in software (`app.disableHardwareAcceleration()`), from the next launch.
   * NEXT LAUNCH IS STRUCTURAL: Electron only accepts that call before the `ready` event, so
   * there is no version of this switch that could take effect mid-session.
   */
  safeMode: boolean
  /**
   * Build the floating overlays as ordinary opaque windows on a solid background instead of
   * transparent ones. Applies to each overlay the next time it is OPENED — a window's
   * transparency is fixed at construction and cannot be changed on a live one.
   */
  opaqueOverlays: boolean
}

export const DEFAULT_GRAPHICS_PREFS: GraphicsPrefs = { safeMode: false, opaqueOverlays: false }

/**
 * The environment variable that forces safe mode for ONE launch, whatever the stored setting
 * says. Its whole reason for existing is the case where the app's own UI is unreachable.
 */
export const GPU_ENV_VAR = 'EQ_DISABLE_GPU'

/** The truthy spellings accepted for `EQ_DISABLE_GPU`. A support reply says "set it to 1"; a
 *  shell script may well say `true`. Both are the same instruction, and `0`/`false`/empty are
 *  the same non-instruction — an env var that is SET TO OFF must not turn the thing on. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/**
 * Does this environment force graphics safe mode? Takes the env map rather than reading
 * `process.env` so it is pure and testable, and so JOS-31 can ask the same question of a
 * launcher's environment without a second opinion about what counts as "set".
 */
export function envDisablesGpu(env: Record<string, string | undefined>): boolean {
  const raw = env[GPU_ENV_VAR]
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase())
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Defaulted field by field, from `unknown`: the same value arrives from the store file, from a
 *  renderer toggle and from the v9 → v10 migration. Never throws, never returns a partial. */
export function normalizeGraphicsPrefs(value: unknown): GraphicsPrefs {
  const v = isPlainObject(value) ? value : {}
  return {
    safeMode: typeof v.safeMode === 'boolean' ? v.safeMode : DEFAULT_GRAPHICS_PREFS.safeMode,
    opaqueOverlays:
      typeof v.opaqueOverlays === 'boolean'
        ? v.opaqueOverlays
        : DEFAULT_GRAPHICS_PREFS.opaqueOverlays
  }
}

/** A transparent window's `backgroundColor`: fully transparent black, so element rgba does all
 *  of the translucency (windows.ts has always said so — this is that value, named). */
export const TRANSPARENT_OVERLAY_BG = '#00000000'

/**
 * The SOLID background an opaque overlay is built on — deliberately the exact RGB every overlay
 * already paints (`rgba(14,17,21,bgAlpha)` in OverlayMeter / HealMeter / EventLogOverlay).
 *
 * That identity is what makes this a compatibility switch rather than a theme: the page's own
 * translucent panel composites onto a window of the SAME colour, so the result is the overlay at
 * full opacity — the bgAlpha look with the alpha taken out — instead of some second palette
 * nobody chose. The alpha slider keeps working; it simply has nothing left to show through to.
 */
export const OPAQUE_OVERLAY_BG = '#0e1115'

/** The `backgroundColor` an overlay window is constructed with, given the switch. */
export function overlayBackgroundColor(opaque: boolean): string {
  return opaque ? OPAQUE_OVERLAY_BG : TRANSPARENT_OVERLAY_BG
}
