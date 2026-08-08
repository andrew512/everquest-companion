// "An OPAQUE notifier is only on screen when it has something to show" (JOS-40, generalized by
// docs/plans/alert-text-overlays.md §6).
//
// The rule used to be INFERRED in windows.ts from the toast's ignore-mouse signal, where it could
// only be checked by running the app with the compatibility switch on and watching for a black
// rectangle. It is now stated, and it lives in a module that touches the window only through a
// four-method structural type — so the stub below is enough to assert every branch of it with no
// Electron and no window at all.
//
// WHAT THIS PROTECTS: a user who turned on opaque overlays because transparent ones broke their
// GPU (that is what the switch is FOR) must not be handed a solid rectangle parked over the game
// as the fix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyNotifierWindowVisibility,
  noteNotifierIdle,
  noteNotifierOpacity,
  notifierIdleOpaque,
  resetNotifierVisibility,
  type NotifierWindow
} from '../src/main/notifierVisibility'

/** A window that records what was done to it. `visible` starts false, as a fresh one does. */
function stubWindow(visible = false): NotifierWindow & { visible: boolean; calls: string[] } {
  const w = {
    visible,
    calls: [] as string[],
    isVisible: (): boolean => w.visible,
    hide: (): void => {
      w.calls.push('hide')
      w.visible = false
    },
    showInactive: (): void => {
      w.calls.push('showInactive')
      w.visible = true
    },
    setAlwaysOnTop: (): void => {
      w.calls.push('setAlwaysOnTop')
    }
  }
  return w
}

test('a TRANSPARENT notifier is never shown or hidden — its empty window is already invisible', () => {
  resetNotifierVisibility()
  noteNotifierOpacity('toast', false)
  // False means "nothing to do", and that is the common case: churning show/hide on every card
  // for a window nobody can see would be work for no pixel.
  assert.equal(noteNotifierIdle('toast', true), false)
  assert.equal(noteNotifierIdle('toast', false), false)
  assert.equal(notifierIdleOpaque('toast'), false, 'and auto-hide has no special case for it')
})

test('an OPAQUE notifier reports that its window needs moving', () => {
  resetNotifierVisibility()
  noteNotifierOpacity('alert', true)
  assert.equal(noteNotifierIdle('alert', false), true)
  assert.equal(noteNotifierIdle('alert', true), true)
})

test('a kind that is not a notifier is never any of this', () => {
  resetNotifierVisibility()
  noteNotifierOpacity('fight', true)
  assert.equal(noteNotifierIdle('fight', true), false, 'a meter fills its window either way')
  assert.equal(notifierIdleOpaque('fight'), false)
})

test('a window that has never reported anything counts as IDLE — empty is the resting state', () => {
  resetNotifierVisibility()
  noteNotifierOpacity('alert', true)
  // The window has just been constructed and its renderer has not spoken yet. Treating that as
  // "has something to show" would flash a solid rectangle between first paint and first signal —
  // the exact moment this mode exists to protect.
  assert.equal(notifierIdleOpaque('alert'), true)
})

test('OPACITY IS RECORDED AT CONSTRUCTION, and a rebuilt window starts idle again', () => {
  resetNotifierVisibility()
  noteNotifierOpacity('alert', true)
  noteNotifierIdle('alert', false)
  assert.equal(notifierIdleOpaque('alert'), false, 'it is drawing something')

  // Closed and reopened — under a setting the user has since turned OFF. The behaviour must
  // describe the window that exists now, and must not inherit the old one's idle state.
  noteNotifierOpacity('alert', false)
  assert.equal(notifierIdleOpaque('alert'), false, 'a transparent window is never auto-hide-skipped')
  assert.equal(noteNotifierIdle('alert', true), false, 'and needs no show/hide')
})

test('idle HIDES a visible window, and does nothing to one already hidden', () => {
  const w = stubWindow(true)
  assert.equal(applyNotifierWindowVisibility(w, true, true), false, 'hiding is not "just shown"')
  assert.deepEqual(w.calls, ['hide'])

  const already = stubWindow(false)
  assert.equal(applyNotifierWindowVisibility(already, true, true), false)
  assert.deepEqual(already.calls, [], 'no churn on a window that is already gone')
})

test('a card arriving SHOWS the window and re-asserts always-on-top', () => {
  const w = stubWindow(false)
  assert.equal(applyNotifierWindowVisibility(w, false, true), true, 'the caller must re-raise the ring')
  assert.deepEqual(w.calls, ['showInactive', 'setAlwaysOnTop'])
  assert.equal(w.visible, true)
})

test('a second card does not re-show a window that is already up', () => {
  const w = stubWindow(true)
  assert.equal(applyNotifierWindowVisibility(w, false, true), false)
  assert.deepEqual(w.calls, [], 'showing an already-visible window would steal z-order for nothing')
})

test('NOTHING is shown while windows may not be shown — the replay / E2E gate', () => {
  // `mayShow` is passed in rather than read here: the rule that nothing of ours appears during a
  // historical fold or under the headless harness has exactly one owner (replayGate.ts).
  const w = stubWindow(false)
  assert.equal(applyNotifierWindowVisibility(w, false, false), false)
  assert.deepEqual(w.calls, [])

  // …but HIDING still works while the gate is shut, so a window cannot be stranded on screen.
  const up = stubWindow(true)
  applyNotifierWindowVisibility(up, true, false)
  assert.deepEqual(up.calls, ['hide'])
})
