// notifierVisibility.ts — "an OPAQUE notifier is only on screen when it has something to show"
// (JOS-40, generalized by docs/plans/alert-text-overlays.md §6).
//
// THE PROBLEM IT ANSWERS. A notifier overlay (shared/alertOverlays.ts — the celebration strip,
// an alert text lane) renders nothing most of the time, and its window is normally transparent,
// so an empty one is simply invisible. Under the opaque-overlays compatibility switch it cannot
// be: the window is built with a solid background, and an empty one would park a dark rectangle
// over the game forever. That is not a compatibility mode, it is a new bug. So an opaque notifier
// is HIDDEN while idle and shown when a card arrives.
//
// WHY IT IS ITS OWN MODULE. windows.ts owns every BrowserWindow and sits at its measured
// factoring ceiling; this is two maps, three questions about them and one show/hide sequence.
// Splitting it out is also what makes the rules testable without Electron — the window is taken
// STRUCTURALLY (`NotifierWindow`), so a test hands in a stub and asserts what was called. Two of
// the rules are easy to get subtly wrong and are worth pinning:
//
//   * OPACITY IS RECORDED AT CONSTRUCTION, not re-read from the store. Transparency is fixed when
//     a BrowserWindow is created, so a user who flips the setting with an overlay open still has
//     a transparent window on screen — and the behaviour has to describe the window that EXISTS,
//     not the preference.
//   * ABSENT READS AS IDLE. Empty is a notifier's resting state, so a window that has never
//     reported anything must not be treated as having something to show.

import type { OverlayKind } from '../shared/types'
import { isNotifierOverlayKind } from '../shared/alertOverlays'

/** Which live notifier windows were built opaque. Absent ⇒ not opaque. */
const opaque = new Map<OverlayKind, boolean>()

/** Which of them are drawing nothing right now. Absent ⇒ idle (the resting state). */
const idle = new Map<OverlayKind, boolean>()

/** Record how a notifier's window was just built. Called once, at construction. */
export function noteNotifierOpacity(kind: OverlayKind, isOpaque: boolean): void {
  if (!isNotifierOverlayKind(kind)) return
  opaque.set(kind, isOpaque)
  // A fresh window is drawing nothing until its renderer says otherwise, and it must not inherit
  // the idle state of the window it replaced.
  idle.set(kind, true)
}

/**
 * Record what a notifier reported about itself, and answer whether that report has any visible
 * consequence — i.e. whether this is an opaque notifier whose window now needs showing or hiding.
 *
 * False for every transparent window, which is the common case: an empty transparent window is
 * already invisible, and hiding/showing it on every card would be churn for no pixel.
 */
export function noteNotifierIdle(kind: OverlayKind, isIdle: boolean): boolean {
  if (!isNotifierOverlayKind(kind)) return false
  idle.set(kind, isIdle)
  return opaque.get(kind) === true
}

/**
 * Should this kind be SKIPPED when overlays come back from an auto-hide? True only for an opaque
 * notifier with nothing queued: its visibility belongs to its own queue, and the next card brings
 * it up. Bringing it back here would undo the whole point.
 */
export function notifierIdleOpaque(kind: OverlayKind): boolean {
  return opaque.get(kind) === true && idle.get(kind) !== false
}

/**
 * The window surface this module touches — structural, so a test can hand it a stub.
 *
 * `level` is the literal this module actually passes rather than `string`: a property-style
 * function type is checked strictly (contravariantly), so widening it to `string` would make a
 * real BrowserWindow — whose own parameter is a closed union — fail to satisfy this.
 */
export interface NotifierWindow {
  isVisible: () => boolean
  hide: () => void
  showInactive: () => void
  setAlwaysOnTop: (flag: boolean, level: 'screen-saver') => void
}

/**
 * Put an opaque notifier's window where its idle state says it belongs. Returns true when it was
 * just SHOWN, which is the caller's cue to re-raise the cursor ring above it.
 *
 * `mayShow` is passed in rather than read here because it is the replay/E2E gate (replayGate.ts),
 * which this module has no business knowing about: nothing appears while a historical replay is
 * folding or under the headless harness, and that rule already has one owner.
 */
export function applyNotifierWindowVisibility(
  w: NotifierWindow,
  isIdle: boolean,
  mayShow: boolean
): boolean {
  if (isIdle) {
    if (w.isVisible()) w.hide()
    return false
  }
  if (!mayShow || w.isVisible()) return false
  w.showInactive()
  w.setAlwaysOnTop(true, 'screen-saver')
  return true
}

/** Forget everything (tests, and any future teardown that recreates windows). */
export function resetNotifierVisibility(): void {
  opaque.clear()
  idle.clear()
}
