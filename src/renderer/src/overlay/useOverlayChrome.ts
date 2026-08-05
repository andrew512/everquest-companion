// useOverlayChrome — the window plumbing every overlay KIND shares, in one place.
//
// All five overlays (damage fight/overall, healing fight/overall, event log) are the same
// window with a different body: a persisted config (position, background alpha, row count,
// TEXT SIZE, lock AND the drill-down), a lock toggle that flips click-through, and the hover
// dance that briefly re-captures the mouse over a LOCKED overlay so its own controls stay
// reachable. This hook is that plumbing; each overlay file keeps only its header, selector and
// body — and, since the text size is a property of the WINDOW rather than of any one body, this
// is also where it is applied.
//
// CONFIG IS THE STATE. `patch` writes locally first (so the UI moves this frame) and then
// through to main, which echoes it back over onConfig — there is no second copy to drift, and
// a drill survives a restart exactly like window position does.
//
// MUI-FREE ON PURPOSE: the overlay is its own renderer entry (overlay.html) with no theme and
// no component library. Do not import @mui/* into this bundle.

import { useEffect, useRef, useState } from 'react'
import type { OverlayConfig, OverlayDrill } from '@shared/types'
import { clampTextScale } from '@shared/types'

/**
 * WHY A LOCKED OVERLAY EVER CAPTURES THE MOUSE, and why the reason has a NAME.
 *
 * Locked means `setIgnoreMouseEvents(true, {forward:true})`: clicks go to the game, and the
 * renderer still receives mouse MOVES — that forwarding is the hover sensor, and it is already
 * on for every meter kind (windows.ts spells out why the toast is the one kind that does not
 * pay for it). When something under the cursor genuinely needs a click, the renderer asks main
 * to stop ignoring; when it stops needing one, it asks again. No new WH_MOUSE_LL hook is
 * involved in any of this — nothing here changes what forwards.
 *
 * The reasons are NAMED because more than one can be true at once and they end at different
 * moments. The selector popup is the case that forced it (P3): the popup is `position: fixed`
 * and therefore NOT inside the header row, so moving the pointer from the header down into the
 * open list fires the header's `mouseleave` — and a single boolean would drop capture out from
 * under the very list the user is reaching for. Two reasons, released independently, cannot.
 *
 *   'window'   — the pointer is anywhere over the overlay. The whole-window sensor the event log
 *                and the pre-P3 meters use: everything is capturable while hovered.
 *   'selector' — the pointer is over the SELECTOR ROW specifically (P3). The meters use this
 *                instead of 'window', so a locked meter's BODY stays genuinely click-through.
 *   'popup'    — the selector's list is open. Outlives 'selector' by construction (above).
 */
export type CaptureReason = 'window' | 'selector' | 'popup'

export interface OverlayChrome {
  /**
   * Has the persisted config actually arrived? Every field below has a sensible default, so
   * most surfaces never need this — but a window that DECIDES something from `locked` before
   * the answer lands (the celebration toast, which asks main to capture or pass through the
   * mouse) must not act on the default first and correct itself a frame later.
   */
  ready: boolean
  /** click-through + no chrome; the persisted lock state */
  locked: boolean
  bgAlpha: number
  topN: number
  /** Text size, 0.8..2. Already APPLIED to the window (see the zoom effect below) — surfaces
   *  need it only to draw the stepper's current value. */
  textScale: number
  /** Config IS the drill state — no local mirror to drift. */
  drill: OverlayDrill | null
  /** the mouse is currently captured over a locked overlay (its controls are showing) */
  hovering: boolean
  patch: (p: Partial<OverlayConfig>) => void
  setDrill: (d: OverlayDrill | null) => void
  toggleLock: () => void
  /**
   * Declare that ONE named reason does (or no longer does) need real mouse events over a LOCKED
   * overlay. Capture is on while any reason holds; a no-op while interactive, where the window
   * already owns the mouse. See CaptureReason for the three and why they are named.
   */
  capture: (reason: CaptureReason, active: boolean) => void
  /** `capture('window', …)` — the whole-window sensor, spelled as the two DOM handler names. */
  onEnter: () => void
  onLeave: () => void
  /** spread onto the header: the whole bar drags the window when interactive */
  dragRegion: React.CSSProperties
  /** spread onto anything clickable inside a drag region */
  noDrag: React.CSSProperties
}

export function useOverlayChrome(): OverlayChrome {
  const [cfg, setCfg] = useState<OverlayConfig | null>(null)
  const [hovering, setHovering] = useState(false)
  /** What is asking for the mouse right now. Capture is on exactly while this is non-empty. */
  const reasonsRef = useRef<Set<CaptureReason>>(new Set())
  /** The state main is actually in, so a redundant IPC send can never happen. */
  const capturedRef = useRef(false)

  // Hydrate from the persisted config and stay subscribed to main's echo. The first snapshot
  // renders against whatever this resolves to.
  useEffect(() => {
    void window.eqOverlay.getConfig().then(setCfg)
    return window.eqOverlay.onConfig(setCfg)
  }, [])

  const locked = cfg?.locked ?? false
  const bgAlpha = cfg?.bgAlpha ?? 0.72
  const topN = cfg?.topN ?? 5
  const drill = cfg?.drill ?? null
  const textScale = clampTextScale(cfg?.textScale)

  /**
   * THE TEXT SCALE IS APPLIED HERE AND NOWHERE ELSE — one placement per window, on the root.
   *
   * CSS `zoom`, not `transform: scale()`: zoom participates in layout, so the bars reflow and the
   * scroll box measures itself at the new size instead of a magnified bitmap hanging off the
   * window's edges. Imperative because #overlay-root is OUTSIDE React's tree (main.tsx renders
   * INTO it) — and it has to be the container every kind mounts into, or four surfaces would each
   * grow their own copy of this.
   *
   * The two consequences, both paid where they land:
   *   - nothing under this may size itself in 100vw/100vh (a viewport unit resolves against the
   *     window and is THEN scaled) — overlay.html and the four surfaces use percentages;
   *   - anything that MEASURES with getBoundingClientRect and writes the number back as a
   *     coordinate divides by `overlayCssZoom` (see below).
   */
  useEffect(() => {
    document.getElementById('overlay-root')?.style.setProperty('zoom', String(textScale))
  }, [textScale])

  const patch = (p: Partial<OverlayConfig>): void => {
    setCfg((c) => (c ? { ...c, ...p } : c))
    void window.eqOverlay.setConfig(p)
  }

  // Drill/undrill writes straight through to the store — immediate, not debounced like bounds:
  // it's a rare, deliberate click. `patch` applies it locally first so the bars swap this frame.
  const setDrill = (d: OverlayDrill | null): void => patch({ drill: d })

  /** Push the union of the live reasons to main, once, and only when it actually changed. */
  const applyCapture = (): void => {
    const want = reasonsRef.current.size > 0
    if (capturedRef.current === want) return
    capturedRef.current = want
    setHovering(want)
    window.eqOverlay.setIgnoreMouse(!want)
  }

  const capture = (reason: CaptureReason, active: boolean): void => {
    // Interactive windows already own the mouse — a sensor firing there must not send anything,
    // or the first hover would "capture" a window that was never ignoring events.
    if (!locked) return
    if (active) reasonsRef.current.add(reason)
    else reasonsRef.current.delete(reason)
    applyCapture()
  }

  const toggleLock = (): void => {
    const next = !locked
    window.eqOverlay.setLocked(next)
    patch({ locked: next })
    // Main applies the new click-through state itself (applyOverlayLocked), so this side just
    // forgets every reason and records where that leaves us — otherwise a stale reason would
    // survive the mode change and the next `capture(x, false)` would send a spurious flip.
    reasonsRef.current.clear()
    capturedRef.current = !next
    setHovering(false)
  }

  return {
    ready: cfg !== null,
    locked,
    bgAlpha,
    topN,
    textScale,
    drill,
    hovering,
    patch,
    setDrill,
    toggleLock,
    capture,
    onEnter: () => capture('window', true),
    onLeave: () => capture('window', false),
    dragRegion: !locked ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {},
    noDrag: { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  }
}

/**
 * The text scale in force at `el` — i.e. the CSS zoom the hook above set on the overlay root.
 *
 * WHY A MEASURE-THEN-PLACE LAYER NEEDS IT. `getBoundingClientRect()` reports VISUAL pixels (the
 * zoom is already in them), while a pixel written back into `top`/`left` inside the zoomed
 * subtree is multiplied by that same zoom on the way to the screen. Divide once, at the boundary
 * between the two spaces, and a popup anchored to the header lands under the header at every
 * scale; skip it and at 1.5 it lands half a window too low. Only the two `position: fixed` layers
 * (the selector popup, the feed's hover card) do this — everything else is plain flow layout,
 * which zoom handles by itself.
 *
 * Read from the ELEMENT rather than from the config: this is the value the engine actually
 * applied, so a layer that is somehow outside the zoomed subtree measures 1 and is left alone.
 */
export function overlayCssZoom(el: Element | null | undefined): number {
  const z = el?.currentCSSZoom ?? 1
  return z > 0 ? z : 1
}
