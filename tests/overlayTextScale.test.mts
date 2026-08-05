// PER-OVERLAY TEXT SIZE (owner feedback, 2026-08-05: "text size scaling for overlays. we are old
// folks now.").
//
// Two halves, both cheap and neither skippable:
//
//   1. `clampTextScale` — the pure normalizer the store runs on the way IN and on the way OUT.
//      It is the whole contract for a field that is optional in the store (every install
//      predates it), renderer-writable, and hand-editable.
//   2. SOURCE PINS for the rendering rule, which cannot be observed without a real transparent
//      always-on-top window: the scale is a CSS `zoom` applied in exactly ONE place, and the two
//      things a zoomed subtree breaks — viewport units, and measure-then-place coordinates — are
//      answered everywhere they occur. The same idiom (and reason) as
//      `overlayLockedSelector.test.mts`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TEXT_SCALE_DEFAULT,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  clampTextScale
} from '../src/shared/types'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** The same file with its COMMENTS removed. Every rule pinned below is written out in prose
 *  directly above the line that obeys it — `100vw` in a comment saying not to use `100vw` must
 *  not read as a violation. */
const code = (rel: string): string =>
  src(rel)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Every surface that mounts into #overlay-root, i.e. everything the zoom is applied over. */
const SURFACES = {
  'the damage meter': '../src/renderer/src/overlay/OverlayMeter.tsx',
  'the healing meter': '../src/renderer/src/overlay/HealMeter.tsx',
  'the event log': '../src/renderer/src/overlay/EventLogOverlay.tsx',
  'the celebration toast': '../src/renderer/src/overlay/ToastOverlay.tsx'
}

// ---- the normalizer ---------------------------------------------------------------------

test('an absent or malformed scale is the default, not a broken window', () => {
  // The case every existing store is in: the key simply is not there.
  assert.equal(clampTextScale(undefined), TEXT_SCALE_DEFAULT)
  assert.equal(clampTextScale(null), TEXT_SCALE_DEFAULT)
  // …and the cases a hand-edited store or a bad patch can be in. NaN is the one that matters:
  // `zoom: NaN` is not an error anywhere, it is an invisible overlay.
  assert.equal(clampTextScale(NaN), TEXT_SCALE_DEFAULT)
  assert.equal(clampTextScale(Infinity), TEXT_SCALE_DEFAULT)
  assert.equal(clampTextScale('1.5'), TEXT_SCALE_DEFAULT)
  assert.equal(clampTextScale({}), TEXT_SCALE_DEFAULT)
})

test('out-of-range values are clamped at both ends', () => {
  assert.equal(clampTextScale(0), TEXT_SCALE_MIN)
  assert.equal(clampTextScale(0.5), TEXT_SCALE_MIN)
  assert.equal(clampTextScale(-3), TEXT_SCALE_MIN)
  assert.equal(clampTextScale(2.5), TEXT_SCALE_MAX)
  assert.equal(clampTextScale(1000), TEXT_SCALE_MAX)
  // The ends themselves are legal — a clamp that excluded them would make the stepper's last
  // press a no-op that still wrote to the store.
  assert.equal(clampTextScale(TEXT_SCALE_MIN), TEXT_SCALE_MIN)
  assert.equal(clampTextScale(TEXT_SCALE_MAX), TEXT_SCALE_MAX)
})

test('in-range values survive, and float dust does not accumulate', () => {
  assert.equal(clampTextScale(1), 1)
  assert.equal(clampTextScale(1.35), 1.35)
  // 0.1 steps off a float: without the round, a few presses persist 1.2000000000000002 and the
  // stepper's tooltip prints the dust back at the user.
  let v = TEXT_SCALE_DEFAULT
  for (let i = 0; i < 4; i++) v = clampTextScale(v + TEXT_SCALE_STEP)
  assert.equal(v, 1.4)
  for (let i = 0; i < 8; i++) v = clampTextScale(v - TEXT_SCALE_STEP)
  assert.equal(v, TEXT_SCALE_MIN, 'walking down past the floor stops AT the floor')
})

test('stepping cannot walk out of range from either end', () => {
  let up = TEXT_SCALE_DEFAULT
  for (let i = 0; i < 50; i++) up = clampTextScale(up + TEXT_SCALE_STEP)
  assert.equal(up, TEXT_SCALE_MAX)
  let down = TEXT_SCALE_DEFAULT
  for (let i = 0; i < 50; i++) down = clampTextScale(down - TEXT_SCALE_STEP)
  assert.equal(down, TEXT_SCALE_MIN)
})

// ---- the store seam ---------------------------------------------------------------------

test('the store clamps the scale on the way OUT as well as in', () => {
  const store = src('../src/main/store.ts')
  // Read side: `getOverlayConfig` fills the default for the stores (all of them) written before
  // this field existed.
  assert.match(store, /cfg\.textScale = clampTextScale\(cfg\.textScale\)/)
  // Write side: the value comes from a renderer, like bgAlpha and topN beside it.
  assert.match(store, /next\.textScale = clampTextScale\(next\.textScale\)/)
})

test('NO NEW CHANNEL: the scale rides the existing per-kind overlay config', () => {
  const stepper = src('../src/renderer/src/overlay/TextScaleStepper.tsx')
  assert.match(stepper, /patch\(\{ textScale:/, 'the stepper writes through the config patch')
  assert.doesNotMatch(stepper, /ipcRenderer|window\.eqOverlay\./, 'and reaches for no channel of its own')
})

// ---- the rendering rule -----------------------------------------------------------------

test('the zoom is applied ONCE, on the window root, by the shared chrome hook', () => {
  const chrome = src('../src/renderer/src/overlay/useOverlayChrome.ts')
  assert.match(chrome, /getElementById\('overlay-root'\)\?\.style\.setProperty\('zoom'/)
  // `zoom` participates in layout; `transform: scale()` would magnify a bitmap over the window's
  // own edges and leave the scroll box measuring the old size.
  assert.doesNotMatch(code('../src/renderer/src/overlay/useOverlayChrome.ts'), /transform:\s*`?scale/)
  for (const [name, path] of Object.entries(SURFACES)) {
    assert.doesNotMatch(code(path), /zoom:/, `${name} must not grow a second copy of the zoom`)
  }
})

test('nothing under the zoom sizes itself in viewport units', () => {
  // A viewport unit resolves against the window and is THEN scaled, so `100vw` at 1.5 is half a
  // screen wider than the window it is supposed to fill. Percentages resolve against the
  // (unzoomed) parent and fill it at any scale — which is why overlay.html sizes html/body too.
  for (const [name, path] of Object.entries(SURFACES)) {
    assert.doesNotMatch(code(path), /100vw|100vh/, `${name} still sizes itself in viewport units`)
  }
  const html = code('../src/renderer/overlay.html')
  assert.doesNotMatch(html, /100vw|100vh/)
  assert.match(html, /#overlay-root \{\s*width: 100%;\s*height: 100%;/)
})

test('the two fixed layers convert between visual and zoomed pixels', () => {
  // getBoundingClientRect reports visual pixels; a pixel written back into top/left inside the
  // zoomed subtree is multiplied again. Both measure-then-place layers divide exactly once.
  for (const path of [
    '../src/renderer/src/overlay/OverlaySelect.tsx',
    '../src/renderer/src/overlay/hoverCardLayer.tsx'
  ]) {
    const text = code(path)
    assert.match(text, /overlayCssZoom\(/, `${path} must ask what scale it is being drawn at`)
    assert.doesNotMatch(text, /calc\(100v[wh]/, `${path} must not clamp itself with viewport units`)
  }
})

test('every overlay kind can reach the control', () => {
  // The meters and the event log put it in their footer; the toast has neither header nor footer,
  // so it lives in the drag frame that IS its interactive chrome.
  for (const [name, path] of Object.entries(SURFACES)) {
    assert.match(src(path), /<TextScaleStepper/, `${name} offers no text size control`)
  }
})
