// Graphics compatibility (src/shared/graphicsPrefs.ts + the 9→10 store migration) — JOS-40.
//
// The claim under test is a claim about a machine nobody here owns: a player's RTX 5080 turned
// the transparent, always-on-top overlays into black-screen artifacting, and the fix that shipped
// is two SELF-SERVE switches rather than a reproduction. So what can be pinned is exactly what
// this suite pins — that each switch means one thing, that neither is on unless someone said so,
// that a store written by any past build arrives with a complete block, and that the env door
// (the one a user with an unusable window reaches through, and the one JOS-31 will reuse for
// Wine) opens on the spellings a support reply would actually give and on nothing else.
//
// No Electron, no store file: shared/graphicsPrefs.ts is a zero-import pure module by design, so
// this suite is as cheap and as unskippable as overlayLayout/updateCadence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GRAPHICS_PREFS,
  GPU_ENV_VAR,
  OPAQUE_OVERLAY_BG,
  TRANSPARENT_OVERLAY_BG,
  envDisablesGpu,
  normalizeGraphicsPrefs,
  overlayBackgroundColor
} from '../src/shared/graphicsPrefs'
import { CURRENT_SCHEMA_VERSION, migrateStoreData } from '../src/main/storeMigrations'

test('both switches are OFF by default — a compatibility mode nobody asked for is a downgrade', () => {
  assert.deepEqual(DEFAULT_GRAPHICS_PREFS, { safeMode: false, opaqueOverlays: false })
})

test('the normalizer answers with a COMPLETE block from anything at all', () => {
  for (const junk of [undefined, null, 42, 'on', [], { safeMode: 'yes' }, { opaqueOverlays: 1 }]) {
    assert.deepEqual(
      normalizeGraphicsPrefs(junk),
      DEFAULT_GRAPHICS_PREFS,
      `${JSON.stringify(junk) ?? 'undefined'} must default rather than half-parse`
    )
  }
  // A real value survives, field by field — including one switch on and the other off.
  assert.deepEqual(normalizeGraphicsPrefs({ safeMode: true, opaqueOverlays: false }), {
    safeMode: true,
    opaqueOverlays: false
  })
  assert.deepEqual(normalizeGraphicsPrefs({ opaqueOverlays: true }), {
    safeMode: false,
    opaqueOverlays: true
  })
  // Unknown keys are dropped rather than carried: the blob is a closed shape.
  assert.deepEqual(normalizeGraphicsPrefs({ safeMode: true, gpu: 'off' }), {
    safeMode: true,
    opaqueOverlays: false
  })
})

test(`${GPU_ENV_VAR} opens on the spellings a support reply gives — and on nothing else`, () => {
  for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
    assert.equal(envDisablesGpu({ [GPU_ENV_VAR]: raw }), true, `${JSON.stringify(raw)} must count`)
  }
  // SET TO OFF IS NOT SET TO ON. An env var spelled `0` is someone declining, and reading it as
  // truthy-because-present would turn a diagnostic into a trap.
  for (const raw of ['0', 'false', 'no', 'off', '', '  ', 'maybe']) {
    assert.equal(envDisablesGpu({ [GPU_ENV_VAR]: raw }), false, `${JSON.stringify(raw)} must not`)
  }
  assert.equal(envDisablesGpu({}), false, 'an absent variable is the ordinary case')
  // It is the ONLY variable consulted — nothing here guesses at a Wine/Proton environment
  // (JOS-31 sets this same one rather than being detected).
  assert.equal(envDisablesGpu({ WINEPREFIX: '/home/u/.wine', PROTON: '1' }), false)
})

test('an opaque overlay is built on the SAME colour the page already paints', () => {
  assert.equal(overlayBackgroundColor(false), TRANSPARENT_OVERLAY_BG)
  assert.equal(overlayBackgroundColor(true), OPAQUE_OVERLAY_BG)
  // The identity is the point: `rgba(14,17,21,α)` (OverlayMeter / HealMeter / EventLogOverlay)
  // composited onto #0e1115 is #0e1115 at every α — the bgAlpha look with the alpha taken out,
  // never a second palette. If those components ever change colour, this assertion is where the
  // compatibility mode finds out.
  assert.equal(OPAQUE_OVERLAY_BG.toLowerCase(), '#0e1115')
  assert.equal(TRANSPARENT_OVERLAY_BG, '#00000000')
})

test('9 → 10 gives every upgrading store a complete graphics block, both switches off', () => {
  // A v9 store — the shape every build shipped before this ticket — carries no `graphics` key.
  const v9 = { schemaVersion: 9, byCharacter: {}, overlays: { toast: { open: true } } }
  const out = migrateStoreData(v9)
  assert.equal(out.to, CURRENT_SCHEMA_VERSION)
  assert.ok(out.applied.includes(10), 'the 10 step must have run')
  assert.deepEqual(out.data.graphics, DEFAULT_GRAPHICS_PREFS)
  // …and it touched nothing else on the way through.
  assert.deepEqual(out.data.overlays, { toast: { open: true } })
})

test('…and a hand-edited graphics block is repaired, never coerced into a switch nobody set', () => {
  const out = migrateStoreData({
    schemaVersion: 9,
    byCharacter: {},
    graphics: { safeMode: 'yes', opaqueOverlays: true }
  })
  assert.deepEqual(
    out.data.graphics,
    { safeMode: false, opaqueOverlays: true },
    'the unreadable field falls back to the default; the readable one is kept'
  )
})
