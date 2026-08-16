// THE ALERT BANNER (JOS-378) — everything about it that is decidable without a window.
//
// The claims under test, stated as the product states them:
//   * a fresh install shows no banner — the kind ships OFF and holds no slot in the meter grid;
//   * what a line SAYS is ONE derivation shared with speech: a filled "On-screen text" wins,
//     otherwise the line is EXACTLY the sentence the alert would speak (phrase, tokens, rank
//     stripping, alertName fallback and all), and a sound-only alert shows its own name;
//   * the per-alert switch is absent-means-shown, so no store migration exists and nothing an
//     existing user already wrote has changed meaning;
//   * an editor that touched none of this saves the alert BYTE-IDENTICALLY (import dedupe);
//   * the wire is re-validated at main's handler: rebuilt field by field, capped, closed unions;
//   * the queue the strip runs on is the toast's, generic — its own cap and its own hold, with
//     the toast's own behaviour unchanged through the façade.
//
// Pure: no DOM, no timers, no Electron, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_BANNER_COLORS,
  BANNER_INTRO_TEXT,
  BANNER_MAX_HOLD_MS,
  DEFAULT_ALERT_BANNER_CONFIG,
  MAX_BANNER_CHARS,
  alertBannerText,
  alertShowsOnScreen,
  introBannerPayload,
  normalizeAlertBannerConfig,
  normalizeBannerColor,
  validateAlertBannerPayload
} from '../src/shared/alertBanner'
import { speechTextFor } from '../src/shared/speechText'
import { OVERLAY_KINDS } from '../src/shared/types'
import { METER_KINDS, defaultOverlayBounds, overlayDefaultSize } from '../src/main/overlayLayout'
import { cardReduce, type CardState } from '../src/renderer/src/overlay/cardQueue'
import { TOAST_CAP, toastReduce, type ToastCardState } from '../src/renderer/src/overlay/toastQueue'
import type { AlertDef } from '../src/shared/alertTypes'

function def(over: Partial<AlertDef> = {}): AlertDef {
  return {
    id: 'a1',
    name: 'Mez broke',
    enabled: true,
    trigger: { type: 'raw', regex: 'broke' },
    sound: { packId: 'base', soundId: 'ding' },
    ...over
  }
}

// ---- the kind itself -------------------------------------------------------------------

test('the alert banner is an overlay kind, appended at the end, and holds no meter slot', () => {
  assert.ok(OVERLAY_KINDS.includes('alertBanner'), 'the kind exists')
  assert.equal(OVERLAY_KINDS[OVERLAY_KINDS.length - 1], 'alertBanner', 'APPENDED — see shared/types.ts')
  assert.ok(!METER_KINDS.includes('alertBanner'), 'a strip is not a meter and must not consume a slot')
})

test('its first-open geometry is a wide strip in the UPPER THIRD, centred, not a screen filler', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const b = defaultOverlayBounds('alertBanner', area)
  const size = overlayDefaultSize('alertBanner', area)
  assert.deepEqual({ width: b.width, height: b.height }, size, 'the bounds carry the kind’s own size')
  assert.ok(b.width < area.width && b.height < area.height * 0.4, `not a screen filler: ${JSON.stringify(b)}`)
  assert.equal(b.x, Math.round((area.width - b.width) / 2), 'horizontally centred')
  const third = area.height / 3
  assert.ok(Math.abs(b.y - third) <= 1, `top edge a third of the way down (got ${String(b.y)})`)
})

test('the config normalizer clamps the hold and the line budget, and defaults `introduced` false', () => {
  assert.deepEqual(normalizeAlertBannerConfig(undefined), DEFAULT_ALERT_BANNER_CONFIG)
  assert.equal(normalizeAlertBannerConfig({ holdMs: 99_000 }).holdMs, BANNER_MAX_HOLD_MS, 'capped at 15s')
  assert.equal(normalizeAlertBannerConfig({ holdMs: 1 }).holdMs, 1000, 'floored at 1s')
  assert.equal(normalizeAlertBannerConfig({ maxLines: 400 }).maxLines, 8)
  assert.equal(normalizeAlertBannerConfig({ maxLines: 0 }).maxLines, 1)
  assert.equal(normalizeAlertBannerConfig({ introduced: 1 }).introduced, false, 'only a literal true counts')
  assert.equal(normalizeAlertBannerConfig({ holdMs: 'soon', maxLines: null }).holdMs, 4000, 'garbage ⇒ default')
})

test('the introduction names the window, the marking that reaches it, and where to move it', () => {
  const p = introBannerPayload(1000)
  assert.equal(p.text, BANNER_INTRO_TEXT)
  assert.match(p.text, /alert banner/i, 'says what the window is')
  assert.match(p.text, /Show on screen/, 'names the per-alert marking that reaches it')
  assert.match(p.text, /Preferences/, 'points at the switch that moves and closes it')
  assert.ok(!/[–—]/.test(p.text), 'NO EM DASHES in user-facing copy (JOS-106)')
})

// ---- what a line SAYS ------------------------------------------------------------------

test('the banner line is EXACTLY what the alert would speak — one derivation, not a copy', () => {
  const d = def({ name: 'Mez broke', speech: { mode: 'custom', phrase: 'Mez has dropped on {target}' } })
  const firing = { spell: 'Mesmerization III', captures: { target: 'a ghoul' } }
  assert.equal(alertBannerText(d, firing), speechTextFor(d, firing), 'the two channels agree by construction')
  assert.equal(alertBannerText(d, firing), 'Mez has dropped on a ghoul')
})

test('a spell mode strips ranks on the banner too, because it is the same resolver', () => {
  const d = def({ speech: { mode: 'spellName' } })
  assert.equal(alertBannerText(d, { spell: 'Mesmerization III' }), 'Mesmerization')
})

test('a SOUND-ONLY alert shows its own name — the documented fallback, never an invention', () => {
  assert.equal(alertBannerText(def({ name: 'Charm break' })), 'Charm break')
})

test('a filled On-screen text REPLACES the spoken sentence, and is capped', () => {
  const d = def({ speech: { mode: 'custom', phrase: 'a long spoken sentence' }, bannerText: 'MEZ BROKE' })
  assert.equal(alertBannerText(d, null), 'MEZ BROKE')
  const long = def({ bannerText: 'x'.repeat(500) })
  assert.equal((alertBannerText(long, null) ?? '').length, MAX_BANNER_CHARS, 'capped, never refused')
})

test('an EMPTY (or whitespace) On-screen text is not an override — it means "say what you speak"', () => {
  assert.equal(alertBannerText(def({ name: 'Slow fading', bannerText: '   ' }), null), 'Slow fading')
})

test('nothing truthful to say ⇒ null, and the player sends nothing', () => {
  assert.equal(alertBannerText({ name: '   ', speech: { mode: 'custom', phrase: '' } }, null), null)
})

// ---- the per-alert switch --------------------------------------------------------------

test('absent showOnScreen means SHOWN — which is why there is no store migration', () => {
  assert.equal(alertShowsOnScreen(def()), true, 'every def written before JOS-378 shows')
  assert.equal(alertShowsOnScreen(def({ showOnScreen: true })), true)
  assert.equal(alertShowsOnScreen(def({ showOnScreen: false })), false, 'false is the taming direction')
})

// ---- the wire --------------------------------------------------------------------------

test('the handler REBUILDS a payload field by field: unknown properties never survive', () => {
  const out = validateAlertBannerPayload({
    id: 'a1:5',
    alertId: 'a1',
    ts: 5,
    text: 'Mez broke',
    evil: 'passed through?',
    color: 'red'
  })
  assert.deepEqual(out, { id: 'a1:5', alertId: 'a1', ts: 5, text: 'Mez broke', color: 'red' })
})

test('a payload with no id, no alertId or no text is REFUSED, never forwarded', () => {
  assert.equal(validateAlertBannerPayload({ alertId: 'a', text: 't' }), null)
  assert.equal(validateAlertBannerPayload({ id: 'a', text: 't' }), null)
  assert.equal(validateAlertBannerPayload({ id: 'a', alertId: 'a', text: '   ' }), null)
  assert.equal(validateAlertBannerPayload('a string'), null)
  assert.equal(validateAlertBannerPayload(null), null)
})

test('the text is capped and the colour is a closed union — a window draws both', () => {
  const out = validateAlertBannerPayload({ id: 'i', alertId: 'a', text: 'y'.repeat(400), color: 'chartreuse' })
  assert.equal(out?.text.length, MAX_BANNER_CHARS)
  assert.equal(out?.color, undefined, 'an unlisted colour is DROPPED, never coerced')
  assert.equal(normalizeBannerColor('default'), undefined, "'default' is absence, not a value")
  for (const c of ALERT_BANNER_COLORS) {
    if (c !== 'default') assert.equal(normalizeBannerColor(c), c, `${c} survives`)
  }
})

test('a payload-named hold is clamped to the same bounds the config is', () => {
  assert.equal(validateAlertBannerPayload({ id: 'i', alertId: 'a', text: 't', holdMs: 99_000 })?.holdMs, BANNER_MAX_HOLD_MS)
  assert.equal(validateAlertBannerPayload({ id: 'i', alertId: 'a', text: 't', holdMs: -5 })?.holdMs, undefined)
})

test('dueAt rides the wire for a countdown, and only when it is a real timestamp', () => {
  assert.equal(validateAlertBannerPayload({ id: 'i', alertId: 'a', text: 't', dueAt: 1_700_000 })?.dueAt, 1_700_000)
  assert.equal(validateAlertBannerPayload({ id: 'i', alertId: 'a', text: 't', dueAt: 'soon' })?.dueAt, undefined)
})

// ---- the shared queue ------------------------------------------------------------------

interface Line {
  id: string
}
const line = (id: string): Line => ({ id })
const showLine = (s: CardState<Line>[], id: string, holdMs = 4000, cap = 4): CardState<Line>[] =>
  cardReduce(s, { type: 'show', payload: line(id), holdMs, cap })

test('the banner queue holds its OWN cap, and a further line evicts the OLDEST', () => {
  let s: CardState<Line>[] = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) s = showLine(s, id, 4000, 4)
  assert.deepEqual(s.map((c) => c.payload.id), ['b', 'c', 'd', 'e'], 'newest last, oldest gone')
})

test('…and its OWN hold: the arrival names it, so Preferences changes the next line', () => {
  const s = showLine([], 'a', 2000)
  assert.equal(s[0].remainingMs, 2000)
  assert.equal(showLine([], 'b', 9000)[0].remainingMs, 9000)
})

test('a line holds, then exits — and pointing at it pauses only that line', () => {
  let s = showLine(showLine([], 'a', 1000), 'b', 1000)
  s = cardReduce(s, { type: 'hover', id: 'a', over: true })
  for (let t = 0; t < 1000; t += 100) s = cardReduce(s, { type: 'tick', dtMs: 100 })
  assert.equal(s.find((c) => c.payload.id === 'a')?.exitingMs, null, 'the pinned line is still holding')
  assert.notEqual(s.find((c) => c.payload.id === 'b')?.exitingMs, null, 'its neighbour left on time')
})

test('THE TOAST IS UNCHANGED through the façade: three cards, and a fourth evicts the oldest', () => {
  let s: ToastCardState[] = []
  for (const id of ['a', 'b', 'c', 'd']) {
    s = toastReduce(s, { type: 'show', payload: { id, kind: 'bossKill', title: id, durationMs: 6000 } })
  }
  assert.equal(s.length, TOAST_CAP)
  assert.deepEqual(s.map((c) => c.payload.id), ['b', 'c', 'd'])
  assert.equal(s[0].remainingMs, 6000, 'a toast’s hold still rides its own payload')
})
