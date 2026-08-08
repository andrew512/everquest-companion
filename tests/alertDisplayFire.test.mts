// WHAT ONE FIRING SENDS to an alert text overlay
// (docs/plans/alert-text-overlays.md §4; src/renderer/src/features/alerts/displayFire.ts).
//
// `alertTextRequest` is the pure half of the firing path: def + firing + a counter in, one wire
// request out. It is pure and takes the counter as a PARAMETER precisely so the property that
// matters most can be asserted here rather than by watching a window — two firings of one alert
// must produce two different ids, because the overlay's queue refuses to dedupe and stacking is
// the whole feature.
//
// The `window.eq` half (`showAlertDisplay`) is not exercised here; it is one guarded call, and
// the e2e spec drives it through the real channel.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertTextRequest } from '../src/renderer/src/features/alerts/displayFire'
import { DEFAULT_ALERT_FONT, DEFAULT_ALERT_FONT_PX } from '../src/shared/alertDisplay'
import { DEFAULT_ALERT_OVERLAY } from '../src/shared/alertOverlays'
import type { AlertDef } from '../src/shared/types'

const def = (over: Partial<AlertDef> = {}): AlertDef => ({
  id: 'charm-break',
  name: 'Charm broke',
  enabled: true,
  trigger: { type: 'event', kind: 'uncharm' },
  sound: { packId: 'alan-rickman', soundId: 'attention' },
  ...over
})

test('an alert with no display block sends NOTHING', () => {
  // Absent ⇒ it draws nothing, which is what every def written before this feature meant. The
  // firing path must not invent a request for them, or every existing alert would start
  // appearing over the game after an update.
  assert.equal(alertTextRequest(def(), null, 0), null)
})

test('an alert that draws sends its resolved line, styled as it asked', () => {
  const req = alertTextRequest(
    def({ display: { text: '$<mob> is casting', font: 'display', fontSize: 40, color: '#ff0000', durationMs: 9000 } }),
    { captures: { mob: 'a fire giant' } },
    0
  )
  assert.equal(req?.text, 'a fire giant is casting')
  assert.equal(req?.font, 'display')
  assert.equal(req?.fontSize, 40)
  assert.equal(req?.color, '#ff0000')
  assert.equal(req?.durationMs, 9000)
  assert.equal(req?.overlay, DEFAULT_ALERT_OVERLAY)
})

test('a field the def did not override is left OFF the wire, to be inherited in main', () => {
  // The renderer deliberately does not fill these: what a lane looks like lives in the store, and
  // a renderer-side copy would be a second answer that goes stale the moment the user changes a
  // default in Preferences. `resolveAlertTextCard` fills them from the target overlay, in main.
  const req = alertTextRequest(def({ display: {} }), null, 0)
  assert.equal(req?.text, 'Charm broke', 'no template ⇒ the alert’s own name')
  assert.equal(req?.overlay, DEFAULT_ALERT_OVERLAY, 'the target is always stated — it is the routing')
  assert.deepEqual(Object.keys(req ?? {}).sort(), ['id', 'overlay', 'text'])
})

test('…and a field it DID override rides along, even at the shipped constant', () => {
  const req = alertTextRequest(
    def({ display: { fontSize: DEFAULT_ALERT_FONT_PX, font: DEFAULT_ALERT_FONT } }),
    null,
    0
  )
  assert.equal(req?.fontSize, DEFAULT_ALERT_FONT_PX)
  assert.equal(req?.font, DEFAULT_ALERT_FONT)
  assert.equal(req?.color, undefined, 'while the ones it did not mention stay absent')
})

test('TWO FIRINGS OF ONE ALERT GET TWO IDS — this is what makes lines stack', () => {
  const d = def({ display: { text: 'slowed' } })
  const first = alertTextRequest(d, null, 0)
  const second = alertTextRequest(d, null, 1)
  assert.notEqual(first?.id, second?.id)
  // The id is the alert's, plus the counter: readable in a devtools inspection, and impossible to
  // collide with another alert's.
  assert.equal(first?.id, 'charm-break:0')
  assert.equal(second?.id, 'charm-break:1')
})

test('a firing with no captures drops the placeholders and keeps the words around them', () => {
  // A ▶ Test and an app-signal fire both arrive with no matched event. Speech already behaves
  // exactly this way — `$<mob> resisted $<spell>` with no spell says "a froglok resisted" — and
  // drawing must not invent values where speech would not, nor throw away the words that DID
  // resolve. The whitespace closes up rather than leaving a hole.
  const d = def({ display: { text: '$<mob> incoming' } })
  assert.equal(alertTextRequest(d, null, 0)?.text, 'incoming')
})

test('…and falls back to the alert’s NAME only when nothing at all resolved', () => {
  const d = def({ display: { text: '$<mob> $<spell>' } })
  assert.equal(alertTextRequest(d, null, 0)?.text, 'Charm broke')
})

test('an alert that would draw nothing at all sends nothing', () => {
  // A nameless def with an empty template has nothing truthful to put on screen, and a blank card
  // over the game is worse than no card.
  assert.equal(alertTextRequest(def({ name: '', display: { text: '' } }), null, 0), null)
})
