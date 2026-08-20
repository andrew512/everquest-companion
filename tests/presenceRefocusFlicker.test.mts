// THE OVERLAYS BLINKED ON EVERY REFOCUS — the asymmetric focus debounce, and the logging that
// earns whatever fix comes next (JOS-424, src/main/presenceProtocol.ts).
//
// THE REPORT, verbatim in intent: with hide-overlays-when-EQ-not-focused on, alt-tabbing back INTO
// EverQuest made the overlays flicker — on, off, on again quickly — and only then stay. "This was
// 'fixed' once before, but we didn't squash it", and he is right about that too: three fixes landed
// next to this path and none of them could touch it. 355da1e6 stopped the cursor ring sliding behind
// re-raised overlays; c650f811 (JOS-199) stopped the hide pass yanking the foreground back into the
// game; 53eed1ab (JOS-368) stopped five SetWindowPos calls per refocus. All three are about what
// happens AFTER a state change. The flicker was the state change.
//
// THE RESIDUAL PATH: in the first second after a refocus the foreground genuinely leaves EverQuest
// for a moment — our own re-show pass puts five or six `showInactive` windows over a
// borderless-fullscreen game, and Windows can hand the foreground to NO window at all (pid 0, which
// `foregroundSide` correctly calls `'other'`). The 300 ms debounce was SYMMETRIC and therefore
// shorter than that flap, so it faithfully round-tripped it into hide-then-show. The fold was doing
// its job; its job was mis-specified.
//
// This file is separate from tests/presence.test.mts for the reason cursorRingOff.test.mts is: it
// is one defect's whole story (a constant, a call site, two log lines) and that file is a page from
// its 400-line ceiling.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FOCUS_HIDE_DEBOUNCE_MS,
  FOCUS_SHOW_DEBOUNCE_MS,
  FOREGROUND_EVERY_TICKS,
  TRANSITION_TITLE_MAX,
  WATCHER_TICK_FLOOR_MS,
  describeFocusTransition,
  describeOverlayVisibility,
  focusDebounceStep,
  newFocusDebounce
} from '../src/main/presenceProtocol'

// ------------------------------------------------------- driving it the way presence.ts does
//
// The flicker is invisible to three bare `focusDebounceStep` calls, because three observations alone
// never commit anything: what commits a value that HELD STILL is the wake-up timer the fold asks for
// (`applyFocus` in presence.ts sets one for `waitMs` and re-folds with the last raw value). So the
// timer is part of the subject, and this driver is that loop with an injected clock.

/** One committed flip, as `presence.ts applyFocus` would have announced it. */
interface Commit {
  readonly at: number
  readonly committed: boolean
}

/**
 * Every observation clears the pending timer and re-folds; a timer that comes due first fires first,
 * with the last raw value.
 *
 * A timer due at exactly `t` has ALREADY elapsed when an observation lands at `t` — that is what
 * `setTimeout` does, and it is the conservative reading for a test whose whole subject is a race.
 */
function driveFocus(
  committed: boolean,
  events: readonly (readonly [number, boolean])[]
): { readonly commits: readonly Commit[]; readonly committed: boolean } {
  let s = newFocusDebounce(committed)
  let observed = committed
  let dueAt: number | null = null
  const commits: Commit[] = []
  const fold = (obs: boolean, now: number): void => {
    observed = obs
    dueAt = null
    const step = focusDebounceStep(s, obs, now)
    s = step.state
    if (step.changed) commits.push({ at: now, committed: s.committed })
    else if (step.waitMs !== null) dueAt = now + step.waitMs
  }
  for (const [at, obs] of events) {
    while (dueAt !== null && dueAt <= at) fold(observed, dueAt)
    fold(obs, at)
  }
  // Drain whatever the last observation left pending. Bounded rather than open-ended: a fold that
  // neither commits nor clears its timer would otherwise hang the suite instead of failing it.
  for (let i = 0; dueAt !== null && i < 8; i++) fold(observed, dueAt)
  assert.equal(dueAt, null, 'the debounce settled')
  return { commits, committed: s.committed }
}

// ------------------------------------------------------------------------- the asymmetry

test('REFOCUS FLAP: a false inside the hide window never dips the committed state', () => {
  // THE REPORTED BUG, as a test, in the owner's own numbers: committed true at t0, a raw false at
  // t0+400, and the game has it back at t0+700. Under the old symmetric 300 ms window the false
  // committed at t0+700 and the true committed again at t0+1000 — the overlays going off and back
  // on, which is exactly what he saw. Nothing may commit here. (Verified RED against the 300 ms
  // constant before the split landed: two commits, `false` then `true`, 300 ms apart.)
  const t0 = 2_000_000
  const flap = driveFocus(true, [
    [t0 + 400, false],
    [t0 + 700, true]
  ])
  assert.deepEqual(flap.commits, [], 'the flap is absorbed entirely — no hide, no re-show')
  assert.equal(flap.committed, true)

  // And it is not a knife-edge property of those two numbers: the whole first second after a
  // refocus is covered, which is the window the flap was observed in.
  for (const gone of [200, 400, 700, 999]) {
    const s = driveFocus(true, [
      [t0 + 100, false],
      [t0 + 100 + gone, true]
    ])
    assert.deepEqual(s.commits, [], `a ${String(gone)} ms flap must not reach the overlays`)
  }
})

test('ALT-TAB AWAY STILL HIDES: a sustained false commits, at the hide window exactly', () => {
  // The other half, and the one the asymmetry could have broken. A real alt-tab out of the game is
  // a false that does not come back, so it must still commit — just later than it used to.
  const t0 = 3_000_000
  const away = driveFocus(true, [[t0, false]])
  assert.deepEqual(away.commits, [{ at: t0 + FOCUS_HIDE_DEBOUNCE_MS, committed: false }])
  assert.equal(away.committed, false)
})

test('AND THE ALT-TAB STROBE IS COVERED BETTER THAN BEFORE, not worse', () => {
  // The case the debounce was originally built for: Windows makes the task switcher (and sometimes
  // the shell) foreground on the way between two apps. That burst is a burst of transient FALSES,
  // and the hide side is now four times more debounced than it was — so a switcher that flashes
  // through on the way back into the game costs nothing at all.
  const t0 = 3_500_000
  const strobe = driveFocus(true, [
    [t0, false],
    [t0 + 80, false],
    [t0 + 140, true],
    [t0 + 900, false],
    [t0 + 980, true]
  ])
  assert.deepEqual(strobe.commits, [])
  assert.equal(strobe.committed, true)
})

test('THE SHOW SIDE IS PINNED AT ITS CONSTANT — the user is waiting on this one', () => {
  const t0 = 4_000_000
  const back = driveFocus(false, [[t0, true]])
  assert.deepEqual(back.commits, [{ at: t0 + FOCUS_SHOW_DEBOUNCE_MS, committed: true }])
  // Refocus is FASTER than it was before the split (the old symmetric window was 300 ms), so the
  // fix costs the felt latency nothing at all.
  assert.ok(FOCUS_SHOW_DEBOUNCE_MS < 300, 'the show side did not get slower')
})

test('THE TWO WINDOWS ARE THE ARGUMENT: a floor under show, a second and change over hide', () => {
  // Neither number is free. The show side must span at least one foreground scan or it commits on a
  // SINGLE sample and is not a debounce at all…
  const scanMs = FOREGROUND_EVERY_TICKS * WATCHER_TICK_FLOOR_MS
  assert.ok(
    FOCUS_SHOW_DEBOUNCE_MS > scanMs,
    `the show window (${String(FOCUS_SHOW_DEBOUNCE_MS)} ms) must outlast one ~${String(scanMs)} ms scan`
  )
  // …and it must stay inside what reads as instant for a response to one's own keystroke.
  assert.ok(FOCUS_SHOW_DEBOUNCE_MS <= 250, 'refocus must keep feeling immediate')
  // The hide side must cover the whole first second after a refocus, with margin — and must not be
  // bought so far that the hide stops reading as automatic.
  assert.ok(FOCUS_HIDE_DEBOUNCE_MS > 1_000, 'the observed flap window is covered')
  assert.ok(FOCUS_HIDE_DEBOUNCE_MS <= 2_000, 'past ~2 s an auto-hide reads as broken, not patient')
  assert.ok(FOCUS_HIDE_DEBOUNCE_MS > FOCUS_SHOW_DEBOUNCE_MS, 'and hide is the debounced direction')
})

// ------------------------------------------------------------------------- the transition log
//
// The logging is what earns the NEXT fix. If a blink survives the asymmetry there are exactly two
// shapes it can have and they are indistinguishable from the outside: a residual FOCUS flap (a
// committed false followed by a committed true) or a Z-ORDER pulse (nothing here moved at all —
// `assertTopmost` trusts Electron's remembered `isAlwaysOnTop` rather than a live WS_EX_TOPMOST
// read, so a window genuinely stripped of the style is never re-asserted). One line per committed
// flip beside the overlay-visibility edges separates them at a glance. The z-order fix is
// deliberately NOT in this ticket: the logging earns the evidence first.

const EQ_ROOT = 'C:\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends'
const EQ_FG = {
  pid: 4321,
  exePath: `${EQ_ROOT}\\eqgame.exe`,
  title: 'EverQuest',
  side: 'eq' as const
}
const AT = Date.parse('2026-08-19T18:30:00.000Z')

/** The body of a named top-level function in a source file, up to the next top-level `}` — the
 *  same reader tests/overlayFocusPolicy.test.mts uses for the other half of this mechanism. */
function body(path: string, decl: string): string {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8')
  const start = src.indexOf(decl)
  assert.notEqual(start, -1, `${decl} not found`)
  const end = src.indexOf('\n}', start)
  assert.notEqual(end, -1, `${decl} has no end`)
  return src.slice(start, end)
}

test('A COMMITTED FLIP SAYS WHAT DROVE IT: the commit, the clock, the pid and the image', () => {
  assert.equal(
    describeFocusTransition({ committed: true, at: AT, driver: EQ_FG }),
    'presence: eqFocused -> true at 2026-08-19T18:30:00.000Z; ' +
      'foreground pid 4321 eqgame.exe [eq] "EverQuest"'
  )
  // The interesting one is the other direction with a DIFFERENT window: "who took the foreground"
  // is the whole question a flicker report asks, and pid 0 — the OS yielding the foreground to no
  // window at all — is one of the two shapes the flap was traced to.
  assert.equal(
    describeFocusTransition({
      committed: false,
      at: AT,
      driver: { pid: 0, exePath: '', title: '', side: 'other' }
    }),
    'presence: eqFocused -> false at 2026-08-19T18:30:00.000Z; ' +
      'foreground pid 0 (no image path) [other] (untitled)'
  )
})

test('a commit with no foreground record yet says so rather than inventing one', () => {
  assert.equal(
    describeFocusTransition({ committed: false, at: AT, driver: null }),
    'presence: eqFocused -> false at 2026-08-19T18:30:00.000Z; no foreground record yet'
  )
})

test('THE LINE IS ONE LINE, AND A WINDOW TITLE CANNOT FORGE A SECOND', () => {
  // A title is arbitrary third-party text. It is the most useful field locally — it is often the
  // only thing that names the window that took the foreground — and it is why this line is
  // `logInfo` and nothing else. But it must not be able to write extra lines into dev.log, close
  // the quotes it sits in, or push the pid off the end of the line.
  const hostile = { ...EQ_FG, title: `x\ny\r\u0000\u001f z" ${'A'.repeat(400)}` }
  const line = describeFocusTransition({ committed: true, at: AT, driver: hostile })
  assert.ok(!line.includes('\n') && !line.includes('\r'), 'no embedded newline')
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0
    assert.ok(code >= 0x20 && code !== 0x7f, `no control character survives (saw ${String(code)})`)
  }
  assert.equal((line.match(/"/g) ?? []).length, 2, 'exactly the pair this line opens and closes')
  assert.ok(
    line.startsWith('presence: eqFocused -> true at 2026-08-19T18:30:00.000Z; foreground pid 4321 '),
    'the fields that matter are still first'
  )
  assert.ok(line.length < 200, `capped, not unbounded: ${String(line.length)} chars`)
  assert.ok(TRANSITION_TITLE_MAX < 100, 'and the cap is a cap')
})

test('NOTHING BUT THE RECORD REACHES THE LINE — the telemetry bright line, at the sink', () => {
  // Two halves. (a) The sentence is built from a CLOSED argument, so no game event, log line or
  // world-model read can reach it — the cases above are exhaustive over the shape. (b) It is
  // emitted through `logInfo`, which is `console.log` and nothing else: never errors.log, never the
  // error store, so nothing about a user's other windows can leave the machine.
  const applyFocus = body('../src/main/presence.ts', 'function applyFocus(')
  assert.match(applyFocus, /logInfo\(/, 'the transition is narrated')
  assert.ok(!applyFocus.includes('logError'), 'and never as an error — it is not one')
  assert.match(
    applyFocus,
    /describeFocusTransition\(\{ committed: focus\.committed, at: now, driver: lastForeground \}\)/,
    'with the committed value, the clock and the raw record, and nothing else'
  )
  const hide = body('../src/main/windows.ts', 'export function setOverlaysHidden(')
  assert.match(hide, /logInfo\('\[everquest-companion\]', describeOverlayVisibility\(hidden, Date\.now\(\)\)\)/)
  assert.ok(!hide.includes('logError'), 'an overlay edge is not an error either')
})

test('THE OVERLAY EDGE IS THE OTHER HALF OF THE EVIDENCE, and it is an EDGE', () => {
  assert.equal(
    describeOverlayVisibility(true, AT),
    'presence: overlays hidden at 2026-08-19T18:30:00.000Z'
  )
  assert.equal(
    describeOverlayVisibility(false, AT),
    'presence: overlays shown at 2026-08-19T18:30:00.000Z'
  )
  // `setOverlaysHidden` is called on every presence change and is idempotent by design, so only a
  // real change of the asserted visibility may say anything — otherwise dev.log becomes a
  // transcript of the watcher and the two lines that matter are lost in it.
  const hide = body('../src/main/windows.ts', 'export function setOverlaysHidden(')
  assert.ok(
    hide.indexOf('if (overlaysHiddenNow !== hidden) {') < hide.indexOf('logInfo('),
    'the edge guard precedes the line'
  )
})

test('THE COMMIT IS NARRATED, THE OBSERVATIONS ARE NOT — a quiet session says nothing', () => {
  // One line per COMMITTED flip, not per watcher record. The watcher speaks on every foreground
  // change; an alt-tab out and back is two commits and therefore two lines, and a session spent in
  // the game is silent. That is what makes dev.log readable as evidence rather than as a trace.
  const applyFocus = body('../src/main/presence.ts', 'function applyFocus(')
  const logAt = applyFocus.indexOf('logInfo(')
  const changedAt = applyFocus.indexOf('if (step.changed) {')
  assert.ok(changedAt !== -1 && changedAt < logAt, 'the line lives inside the commit branch')
})
