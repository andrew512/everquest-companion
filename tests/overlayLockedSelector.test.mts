// A LOCKED OVERLAY KEEPS ITS SELECTOR — and nothing else (P3 of
// docs/plans/combat-overlay-parity.md; owner ruling 3: "a LOCKED overlay keeps its top dropdown
// usable; click-through everywhere else").
//
// This is a SOURCE pin rather than a behaviour test on purpose: the thing being protected is a
// wiring decision across three files plus a main-process hazard note, and none of it can be
// observed without a real always-on-top window and a real cursor (the e2e harness asserts the
// IPC half of the seam instead — see tests/e2e/overlay-sync.e2e.mts).
//
// THE HAZARD IT GUARDS. `setIgnoreMouseEvents(true, {forward:true})` installs a low-level mouse
// hook (WH_MOUSE_LL) owned by MAIN, so every system mouse event waits on our message loop and a
// blocked main freezes the user's cursor system-wide (measured — it is why the cursor ring
// deliberately does not forward). P3 was implemented by REUSING that already-paid-for forwarding
// on the meter kinds, not by adding a second sensor: the pins below are what keep it that way.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

const METERS = {
  'the damage meter': '../src/renderer/src/overlay/OverlayMeter.tsx',
  'the healing meter': '../src/renderer/src/overlay/HealMeter.tsx'
}

test('NO NEW HOOK: main still decides forwarding per kind, in exactly one place', () => {
  const windows = src('../src/main/windows.ts')
  // ONE call site FORWARDS, and the toast is still the one kind that does not pay for the hook.
  // (The cursor ring's own `setIgnoreMouseEvents(true)` is the deliberate non-forwarding one and
  // is counted out here by the `{ forward` it does not have.)
  assert.equal((windows.match(/setIgnoreMouseEvents\(true, \{ forward/g) ?? []).length, 1)
  // …and it asks ONE predicate what the answer is. The rule moved to replayGate.ts with JOS-62,
  // which added the second reason not to forward (a historical replay is folding); the toast's
  // exemption is unchanged and still lives in exactly one expression.
  assert.match(windows, /forward: overlayMouseForward\(kind\)/)
  const gate = src('../src/main/replayGate.ts')
  assert.match(gate, /kind !== 'toast' && !replayRunning/)
  // The freeze-hazard note has to survive in BOTH halves: it is the reason the split exists at
  // all, and now also the reason the replay drops the hook entirely.
  assert.match(windows, /WH_MOUSE_LL/)
  assert.match(gate, /WH_MOUSE_LL/)
})

test('NO NEW CHANNEL: the capture flip rides the existing fine-grained pass-through', () => {
  const chrome = src('../src/renderer/src/overlay/useOverlayChrome.ts')
  assert.match(chrome, /window\.eqOverlay\.setIgnoreMouse\(!want\)/)
  // Exactly one place sends it, so the "what does main think the state is" bookkeeping cannot
  // be defeated by a second caller.
  assert.equal((chrome.match(/setIgnoreMouse\(/g) ?? []).length, 1)
})

test('CAPTURE IS A SET OF NAMED REASONS, released independently', () => {
  const chrome = src('../src/renderer/src/overlay/useOverlayChrome.ts')
  assert.match(chrome, /export type CaptureReason = 'window' \| 'selector' \| 'popup'/)
  // The union, not a boolean: the popup is `position: fixed` and therefore not inside the header
  // row, so moving into the open list fires the row's mouseleave. A single boolean would drop
  // capture out from under the list the user is reaching for.
  assert.match(chrome, /reasonsRef\.current\.size > 0/)
  // Interactive windows already own the mouse — a sensor firing there must send nothing.
  assert.match(chrome, /if \(!locked\) return/)
})

test('THE SELECTOR ROW IS THE ONLY INTERACTIVE PART of a locked meter', () => {
  const header = src('../src/renderer/src/overlay/OverlayHeader.tsx')
  // The header row itself carries the sensor…
  assert.match(header, /onMouseEnter=\{\(\) => capture\('selector', true\)\}/)
  assert.match(header, /onMouseLeave=\{\(\) => capture\('selector', false\)\}/)
  // …and the popup holds capture for as long as it is open.
  assert.match(header, /capture\('popup', next\)/)
  // A locked overlay is now selectable — but only when a sensor was supplied. Without one there
  // is no way for the click to land, and a chevron that did nothing would be worse than none.
  assert.match(header, /!locked \|\| chrome\.capture/)
})

test('…and the meters no longer capture the WHOLE window on hover', () => {
  for (const [who, rel] of Object.entries(METERS)) {
    const text = src(rel)
    // The old whole-window sensor. Its removal is what makes the bars genuinely click-through
    // while locked — the ruling's "click-through everywhere else".
    assert.doesNotMatch(text, /onMouseEnter=\{onEnter\}/, `${who} still captures its whole window`)
    assert.doesNotMatch(text, /onMouseLeave=\{onLeave\}/, `${who} still captures its whole window`)
    // It hands the header the precise sensor instead.
    assert.match(text, /toggleLock, capture \}/, `${who} does not give its header the sensor`)
  }
})

test('the drill stays READ-ONLY while locked — only the selector was opened up', () => {
  for (const [who, rel] of Object.entries(METERS)) {
    assert.match(
      src(rel),
      /setDrill=\{locked \? null : setDrill\}/,
      `${who} made its bars clickable while locked`
    )
  }
})

test('JOS-121: the scope word is out of the title bar and onto the panel floor', () => {
  const header = src('../src/renderer/src/overlay/OverlayHeader.tsx')
  // The header row is the window's ONLY drag handle and the fight selector's whole width budget.
  // Nothing in it may render the scope again — not the tag, not its testid, not `chipLabel`.
  assert.doesNotMatch(header, /overlay-scope-label/)
  assert.doesNotMatch(header, /chipLabel|OverlayHeaderScope/)
  // …and the slice of the freed width that did NOT go to the selector is a real drag target,
  // which only works because it carries no `no-drag` (it inherits the row's drag region).
  assert.match(header, /data-testid="overlay-drag-gutter"/)

  const floor = src('../src/renderer/src/overlay/scopeFloor.tsx')
  // NON-INTERACTIVE IS THE CONTRACT, not a styling detail: the watermark stays rendered while the
  // overlay is LOCKED (unlike the header tag it replaced), so `pointerEvents: none` is the only
  // thing keeping a click-through window click-through.
  assert.match(floor, /pointerEvents: 'none'/)
  // …and it CANNOT know about the lock, because the only things it is given are the word and the
  // tooltip. That is the whole of "it does not vanish when pinned", stated as a signature rather
  // than as a missing branch somebody could add back.
  assert.match(floor, /export function ScopeFloor\(\{ label, title \}: ScopeFloorText\)/)
  assert.match(floor, /export interface ScopeFloorText \{\s+label: string\s+title: string\s+\}/)

  for (const [who, rel] of Object.entries(METERS)) {
    const text = src(rel)
    // Both meters say it from the floor, through the SAME helper the Combat tab uses — one
    // phrasing, three renderers (the healRows.ts rule).
    assert.match(text, /<MeterPane[\s\S]*?scope=\{\{/, `${who} does not put its bars in the floor-bearing pane`)
    assert.match(text, /label: chipLabel\(meterScope, roster\)/, `${who} spells the scope itself`)
    // …and neither hands the HEADER a scope prop any more. Read off the element itself rather
    // than the file: both meters still say `scope=` — one line lower, to the pane.
    const headerEl = /<OverlayHeader[\s\S]*?\/>/.exec(text)?.[0] ?? ''
    assert.ok(headerEl.length > 0, `${who} renders no OverlayHeader`)
    assert.doesNotMatch(headerEl, /scope=/, `${who} still passes scope to its header`)
  }
})

test('the event log keeps the whole-window sensor it always had', () => {
  // It has no selector, so it never opted into the precise one — and it must not be dragged
  // along by a change that was about the meters.
  const feed = src('../src/renderer/src/overlay/EventLogOverlay.tsx')
  assert.match(feed, /onMouseEnter=\{onEnter\}/)
  assert.match(feed, /onMouseLeave=\{onLeave\}/)
})
