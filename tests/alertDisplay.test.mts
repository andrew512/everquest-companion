// ALERT TEXT OVERLAYS — the shared model (docs/plans/alert-text-overlays.md §1/§3/§4).
//
// Three claims, in three sections:
//   (A) THE ROSTER      — which overlays an alert may target, and what a notifier is.
//   (B) THE RESOLVER    — what a firing draws, and that it is the SAME `$<name>` machinery the
//                         spoken half uses. That equality is the reason `substitute` moved to
//                         shared/captures.ts, and it is asserted here rather than commented.
//   (C) THE BOUNDARY    — `normalizeAlertDisplay` (the store + share + save path) and
//                         `validateAlertTextRequest` (the IPC handler). Both are repair
//                         functions, and what they refuse matters as much as what they fix:
//                         these values end up in a `style` attribute in another window.
//
// Pure: no DOM, no Electron, never skips. Value imports from `shared/` are RELATIVE.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_FONTS,
  DEFAULT_ALERT_COLOR,
  DEFAULT_ALERT_DISPLAY_MS,
  DEFAULT_ALERT_FONT,
  DEFAULT_ALERT_FONT_PX,
  MAX_ALERT_DISPLAY_MS,
  MAX_ALERT_FONT_PX,
  MAX_DISPLAY_CHARS,
  MIN_ALERT_DISPLAY_MS,
  MIN_ALERT_FONT_PX,
  DEFAULT_ALERT_TEXT,
  alertFontStack,
  displayTextFor,
  normalizeAlertDisplay,
  normalizeAlertTextDefaults,
  resolveAlertTextCard,
  validateAlertTextRequest
} from '../src/shared/alertDisplay'
import {
  ALERT_OVERLAY_KINDS,
  ALERT_OVERLAY_LABELS,
  DEFAULT_ALERT_OVERLAY,
  NOTIFIER_OVERLAY_KINDS,
  alertOverlayKind,
  isAlertOverlayKind,
  isNotifierOverlayKind
} from '../src/shared/alertOverlays'
import { OVERLAY_KINDS } from '../src/shared/types'
import { speechTextFor } from '../src/shared/speechText'
import { alertBehaviorKey, sanitizeAlertDef } from '../src/shared/profiles'
import type { AlertDef } from '../src/shared/types'

// ------------------------------------------------------------------ (A) the roster

test('every overlay an alert may target is a real overlay kind', () => {
  // The list is a subset of the union by construction (`satisfies`), but a member could still be
  // dropped from OVERLAY_KINDS without the compiler noticing the array, and a def pointing at a
  // window that cannot be created would be an alert that silently never appears.
  for (const k of ALERT_OVERLAY_KINDS) {
    assert.equal(OVERLAY_KINDS.includes(k), true, `${k} is spawnable`)
    assert.equal(isAlertOverlayKind(k), true)
    assert.equal(typeof ALERT_OVERLAY_LABELS[k], 'string', `${k} has a label for the picker`)
  }
  assert.equal(ALERT_OVERLAY_KINDS.includes(DEFAULT_ALERT_OVERLAY), true, 'the default is one of them')
})

test('the NOTIFIERS are the toast plus every alert overlay — the empty-at-rest windows', () => {
  // Three unrelated behaviours read this one predicate (no meter-stack slot, no mouse forwarding,
  // hidden while idle when opaque). If the set ever disagreed with itself, one of them would be
  // wrong in a way only a user with an opaque overlay or a jerky mouse would ever notice.
  assert.equal(isNotifierOverlayKind('toast'), true)
  for (const k of ALERT_OVERLAY_KINDS) assert.equal(isNotifierOverlayKind(k), true, `${k} is a notifier`)
  assert.equal(isNotifierOverlayKind('fight'), false, 'a meter is not')
  for (const k of NOTIFIER_OVERLAY_KINDS) assert.equal(OVERLAY_KINDS.includes(k), true)
})

test('a stored target that does not exist here coerces to the default rather than vanishing', () => {
  // A shared alert set can name an overlay this build has never heard of. An alert that silently
  // stopped appearing is the one failure the user cannot see, so it lands somewhere.
  assert.equal(alertOverlayKind('alert2'), DEFAULT_ALERT_OVERLAY)
  assert.equal(alertOverlayKind(undefined), DEFAULT_ALERT_OVERLAY)
  assert.equal(alertOverlayKind(7), DEFAULT_ALERT_OVERLAY)
  assert.equal(alertOverlayKind('fight'), DEFAULT_ALERT_OVERLAY, 'a meter is not a text target')
})

test('every font key resolves to a CSS stack, and an unknown one still draws', () => {
  for (const f of ALERT_FONTS) {
    assert.match(alertFontStack(f), /\w/, `${f} has a stack`)
  }
  assert.equal(alertFontStack(undefined), alertFontStack(DEFAULT_ALERT_FONT))
})

// ------------------------------------------------------------------ (B) the resolver

const def = (name: string, text?: string): { name: string; display: { text?: string } } => ({
  name,
  display: text === undefined ? {} : { text }
})

test('a display template substitutes {tokens} from the firing, exactly as a spoken phrase does', () => {
  const firing = { captures: { mob: 'a fire giant', spell: 'Ancient Breath' } }
  assert.equal(
    displayTextFor(def('Breath', '{mob} is casting {spell}'), firing),
    'a fire giant is casting Ancient Breath'
  )
})

test('AN UNDECLARED TOKEN RENDERS LITERALLY — nothing is ever silently deleted', () => {
  // JOS-103's rule, and it is the opposite of what this branch's retired `$<name>` did (it
  // dropped the token and closed the gap). Literal is the better answer for the same reason the
  // preview shows tokens unresolved: a line that says `{spell}` tells the user their pattern
  // does not capture that, where a line with a hole in it just looks like the alert is broken.
  const firing = { captures: { mob: 'a froglok' } }
  assert.equal(displayTextFor(def('Resist', '{mob} resisted {spell}'), firing), 'a froglok resisted {spell}')
})

test('THE TWO SURFACES AGREE: the same template and captures draw and speak the same words', () => {
  // This is why `displayTextFor` calls `applyCaptures` rather than carrying its own substitution.
  // A second implementation would drift the moment either side grew a rule — and only one of them
  // would have the threat model in shared/alertCaptures.ts.
  const firing = { captures: { attacker: 'a gnoll', amount: '212' } }
  const phrase = '{attacker} hit you for {amount}'
  const spoken = speechTextFor({ name: 'Big hit', speech: { mode: 'custom', phrase } }, firing)
  const drawn = displayTextFor(def('Big hit', phrase), firing)
  assert.equal(drawn, spoken)
  assert.equal(drawn, 'a gnoll hit you for 212')
})

test('no template at all falls back to the alert’s own NAME', () => {
  // The `speechTextFor` rule, deliberately identical: saying nothing is a broken alert the user
  // cannot see, and inventing content is worse than both.
  assert.equal(displayTextFor(def('Charm broke')), 'Charm broke')
  assert.equal(displayTextFor(def('Charm broke', '   ')), 'Charm broke')
  assert.equal(displayTextFor({ name: 'Named', display: undefined }), 'Named', 'even with no block')
})

test('a nameless def with nothing to say draws nothing rather than a blank line', () => {
  assert.equal(displayTextFor(def('', '')), null)
})

test('an over-long line is truncated, never refused', () => {
  const long = 'x'.repeat(MAX_DISPLAY_CHARS + 80)
  const out = displayTextFor(def('Long', long))
  assert.equal(out?.length, MAX_DISPLAY_CHARS)
})

// ------------------------------------------------------------------ (C) the boundary

test('normalizeAlertDisplay omits what was NOT OVERRIDDEN — an absent field means "inherit"', () => {
  // The whole of the per-overlay defaults feature turns on this distinction. An alert that
  // overrode nothing carries nothing, and follows its overlay's look today and after the user
  // changes it.
  assert.deepEqual(normalizeAlertDisplay({}), {})
  const configured = { text: 'Adds!', font: 'display' as const, fontSize: 48, color: '#ff0000' }
  assert.deepEqual(normalizeAlertDisplay(configured), configured, 'a real choice survives whole')
})

test('…but an EXPLICIT value is kept even when it equals the shipped constant', () => {
  // This is the case that would silently break inheritance if it were "omitted at the default":
  // an alert that deliberately picked 28 px must stay 28 px even though 28 is also the constant,
  // because the OVERLAY it targets may say 48. Absent and explicitly-28 are different statements.
  assert.deepEqual(normalizeAlertDisplay({ fontSize: DEFAULT_ALERT_FONT_PX }), {
    fontSize: DEFAULT_ALERT_FONT_PX
  })
  assert.deepEqual(normalizeAlertDisplay({ font: DEFAULT_ALERT_FONT }), { font: DEFAULT_ALERT_FONT })
  assert.deepEqual(normalizeAlertDisplay({ color: DEFAULT_ALERT_COLOR }), { color: DEFAULT_ALERT_COLOR })
  assert.deepEqual(normalizeAlertDisplay({ durationMs: DEFAULT_ALERT_DISPLAY_MS }), {
    durationMs: DEFAULT_ALERT_DISPLAY_MS
  })
})

test('normalizeAlertDisplay clamps the numbers to the documented range', () => {
  assert.equal(normalizeAlertDisplay({ fontSize: 4 })?.fontSize, MIN_ALERT_FONT_PX)
  assert.equal(normalizeAlertDisplay({ fontSize: 9000 })?.fontSize, MAX_ALERT_FONT_PX)
  assert.equal(normalizeAlertDisplay({ durationMs: 1 })?.durationMs, MIN_ALERT_DISPLAY_MS)
  assert.equal(normalizeAlertDisplay({ durationMs: 86_400_000 })?.durationMs, MAX_ALERT_DISPLAY_MS)
  // A non-finite number is not a smaller size, it is no answer — so it takes the default and is
  // therefore omitted, exactly like an absent key.
  assert.deepEqual(normalizeAlertDisplay({ fontSize: Number.NaN }), {})
  assert.deepEqual(normalizeAlertDisplay({ durationMs: Number.POSITIVE_INFINITY }), {})
})

test('COLOUR IS A HEX TRIPLE OR IT IS THE DEFAULT — nothing else reaches a style attribute', () => {
  // These values are written into another window's inline style. One shape and one regex is what
  // makes it impossible to smuggle a second declaration, a url() or a var() through.
  for (const bad of [
    'rgb(255,0,0)',
    'red',
    'var(--x)',
    '#12',
    '#1234567',
    '#abc; background:url(http://x)',
    'transparent',
    '',
    42
  ]) {
    assert.deepEqual(normalizeAlertDisplay({ color: bad }), {}, `${String(bad)} is dropped to the default`)
  }
  assert.equal(normalizeAlertDisplay({ color: '#F00' })?.color, '#f00', 'a real triple survives, folded')
  assert.equal(normalizeAlertDisplay({ color: '#ff8800' })?.color, '#ff8800')
})

test('an unknown font or overlay coerces rather than sticking', () => {
  assert.deepEqual(normalizeAlertDisplay({ font: 'Comic Sans' }), {}, 'unknown ⇒ the default, omitted')
  assert.deepEqual(normalizeAlertDisplay({ overlay: 'nowhere' }), {}, 'unknown ⇒ the default, omitted')
})

test('normalizeAlertDisplay answers a non-object with null — the key is simply absent', () => {
  // Null is what a caller turns into "this alert draws nothing", because the PRESENCE of the
  // block is the enable. A block that survived as `{}` from a string would be an alert quietly
  // showing its own name over the game.
  for (const bad of [null, undefined, 'yes', 7, true]) {
    assert.equal(normalizeAlertDisplay(bad), null, `${String(bad)} is not a display block`)
  }
  assert.deepEqual(normalizeAlertDisplay({}), {}, 'but an empty block IS one — every default is an answer')
})

// ------------------------------------------------------------------ (D) the per-overlay defaults

test('an overlay’s defaults blob is always COMPLETE — it is the thing being inherited FROM', () => {
  // Unlike a display block, a hole here would have nothing left to fall back to. A partial blob, a
  // hand-edited file and a blob from a future build all resolve to something drawable.
  assert.deepEqual(normalizeAlertTextDefaults(undefined), DEFAULT_ALERT_TEXT)
  assert.deepEqual(normalizeAlertTextDefaults({}), DEFAULT_ALERT_TEXT)
  assert.deepEqual(normalizeAlertTextDefaults('nonsense'), DEFAULT_ALERT_TEXT)
  assert.deepEqual(normalizeAlertTextDefaults({ font: 'display' }), {
    ...DEFAULT_ALERT_TEXT,
    font: 'display'
  })
})

test('the defaults blob is clamped and repaired on the way in, like every renderer-written value', () => {
  const out = normalizeAlertTextDefaults({
    font: 'wingdings',
    fontSize: 9000,
    color: 'red; background:url(x)',
    durationMs: 1
  })
  assert.equal(out.font, DEFAULT_ALERT_FONT)
  assert.equal(out.fontSize, MAX_ALERT_FONT_PX)
  assert.equal(out.color, DEFAULT_ALERT_COLOR)
  assert.equal(out.durationMs, MIN_ALERT_DISPLAY_MS)
})

test('THE ALERT WINS, THE OVERLAY DECIDES THE REST', () => {
  const overlay = { font: 'display' as const, fontSize: 48, color: '#00ff00', durationMs: 12_000 }
  const base = { id: 'a:1', overlay: DEFAULT_ALERT_OVERLAY, text: 'Adds!' }

  // Overrode nothing ⇒ the lane's look, whole.
  assert.deepEqual(resolveAlertTextCard(base, overlay), {
    id: 'a:1',
    text: 'Adds!',
    font: 'display',
    fontSize: 48,
    color: '#00ff00',
    durationMs: 12_000
  })

  // Overrode ONE field ⇒ that one wins and the other three still come from the lane. This is the
  // property the whole feature is for, and the one a per-field default would have got wrong.
  const partial = resolveAlertTextCard({ ...base, color: '#ff0000' }, overlay)
  assert.equal(partial.color, '#ff0000', 'the alert’s own colour')
  assert.equal(partial.font, 'display', 'and everything it did not mention is still the lane’s')
  assert.equal(partial.fontSize, 48)
  assert.equal(partial.durationMs, 12_000)
})

test('an override that matches the shipped constant still WINS over a different overlay default', () => {
  // The end-to-end form of the "explicit value is kept" rule above: an alert that deliberately
  // asked for 28 px on a lane that says 48 gets 28, not 48.
  const card = resolveAlertTextCard(
    { id: 'a:1', overlay: DEFAULT_ALERT_OVERLAY, text: 'x', fontSize: DEFAULT_ALERT_FONT_PX },
    { ...DEFAULT_ALERT_TEXT, fontSize: 48 }
  )
  assert.equal(card.fontSize, DEFAULT_ALERT_FONT_PX)
})

// ------------------------------------------------------------------ (C, cont.) the boundary

test('validateAlertTextRequest rebuilds the request field by field, stripping anything else', () => {
  const out = validateAlertTextRequest({
    id: 'charm:3',
    overlay: DEFAULT_ALERT_OVERLAY,
    text: 'Charm broke!',
    font: 'display',
    fontSize: 40,
    color: '#ff0000',
    durationMs: 4000,
    onClick: 'rm -rf /',
    __proto__: { nope: true }
  })
  assert.deepEqual(Object.keys(out ?? {}).sort(), [
    'color',
    'durationMs',
    'font',
    'fontSize',
    'id',
    'overlay',
    'text'
  ])
})

test('a request with nothing to draw, or nowhere to draw it, is DROPPED', () => {
  const ok = { id: 'a:1', overlay: DEFAULT_ALERT_OVERLAY, text: 'hi' }
  assert.notEqual(validateAlertTextRequest(ok), null, 'the control case is honoured')
  assert.equal(validateAlertTextRequest({ ...ok, text: '' }), null, 'no text')
  assert.equal(validateAlertTextRequest({ ...ok, text: '   ' }), null, 'no text after tidying')
  assert.equal(validateAlertTextRequest({ ...ok, id: '' }), null, 'no id')
  assert.equal(validateAlertTextRequest({ ...ok, overlay: 'alert2' }), null, 'an overlay we do not have')
  assert.equal(validateAlertTextRequest({ ...ok, overlay: 'fight' }), null, 'a meter is not a text target')
  assert.equal(validateAlertTextRequest(null), null)
  assert.equal(validateAlertTextRequest('text'), null)
})

test('an unusable style field is DROPPED (so it inherits); an out-of-range one is CLAMPED', () => {
  // Either way a bad field is never the reason an alert goes unseen. The difference is what it
  // falls back TO: a value that is not a value at all falls through to the overlay, while a real
  // number outside the range is a statement of intent and is honoured as far as it can be.
  const out = validateAlertTextRequest({
    id: 'a:1',
    overlay: DEFAULT_ALERT_OVERLAY,
    text: 'Adds!',
    font: 'wingdings',
    color: 'chartreuse',
    fontSize: -3,
    durationMs: 999_999
  })
  assert.equal(out?.text, 'Adds!')
  assert.equal(out?.font, undefined, 'an unknown font inherits rather than forcing the constant')
  assert.equal(out?.color, undefined, 'an unusable colour inherits')
  assert.equal(out?.fontSize, MIN_ALERT_FONT_PX, 'a too-small size is clamped, not dropped')
  assert.equal(out?.durationMs, MAX_ALERT_DISPLAY_MS, 'a too-long hold is clamped, not dropped')
})

test('a request carries ONLY what the alert overrode', () => {
  const out = validateAlertTextRequest({ id: 'a:1', overlay: DEFAULT_ALERT_OVERLAY, text: 'Adds!' })
  assert.deepEqual(Object.keys(out ?? {}).sort(), ['id', 'overlay', 'text'])
})

test('an over-long line is capped at the boundary too, not just at the resolver', () => {
  const out = validateAlertTextRequest({
    id: 'a:1',
    overlay: DEFAULT_ALERT_OVERLAY,
    text: 'y'.repeat(MAX_DISPLAY_CHARS + 500)
  })
  assert.equal(out?.text.length, MAX_DISPLAY_CHARS)
})

// ------------------------------------------------------------------ (E) surviving a share
//
// `sanitizeAlertDef` (shared/shareSchema.ts) rebuilds a def FIELD BY FIELD, which is what makes an
// untrusted payload safe — and is exactly why it once silently dropped `audio`/`speech`: a field
// added to AlertDef and not added there does not survive a share, and the alert arrives looking
// like it never had the feature. These live here rather than in tests/shareProfiles.test.mts only
// because that file is at its 400-line ceiling; the claim they pin belongs to both.

test('the display block survives a share round trip, validated field by field', () => {
  const shown = sanitizeAlertDef({
    id: 'd',
    name: 'Adds',
    trigger: { type: 'raw', regex: 'adds' },
    sound: { packId: 'p', soundId: 's' },
    display: { text: '{mob} incoming', font: 'display', fontSize: 48, color: '#ff0000', durationMs: 8000 }
  })
  assert.deepEqual(shown?.display, {
    text: '{mob} incoming',
    font: 'display',
    fontSize: 48,
    color: '#ff0000',
    durationMs: 8000
  })
})

test('an imported display block is repaired, not trusted', () => {
  // A stranger's bundle is untrusted input that ends up in a `style` attribute in another window,
  // so it goes through the same normalizer the app's own save path uses.
  const dirty = sanitizeAlertDef({
    id: 'd',
    name: 'D',
    trigger: { type: 'raw', regex: 'ok' },
    sound: { packId: 'p', soundId: 's' },
    display: {
      text: 'hi',
      color: 'red; background:url(http://evil)',
      fontSize: 9000,
      font: 'Comic Sans',
      // An overlay this build does not have — the alert must still appear SOMEWHERE.
      overlay: 'alert99'
    }
  })
  assert.deepEqual(dirty?.display, { text: 'hi', fontSize: MAX_ALERT_FONT_PX })
})

test('adding a display block does NOT change the merge fingerprint', () => {
  // `alertBehaviorKey` hashes trigger/sound/volume/cooldown — what an alert LISTENS for and what
  // it plays. Two copies of one alert that differ only in what they draw are still one alert, so
  // importing a friend's styled copy over your own must not duplicate it.
  const base = { id: 'k', name: 'K', trigger: { type: 'raw' as const, regex: 'ok' }, sound: { packId: 'p', soundId: 's' } }
  const plain = sanitizeAlertDef(base) as AlertDef
  const styled = sanitizeAlertDef({ ...base, display: { text: 'K!', fontSize: 40 } }) as AlertDef
  assert.equal(alertBehaviorKey(styled), alertBehaviorKey(plain))
})