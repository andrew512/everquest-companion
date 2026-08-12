# Alert text overlays

Design + implementation notes for the alert text overlay.

An alert could only ever be **heard** — a pack sound, a spoken phrase, or both. This adds the
third thing an alert can do: write its line over the game, in a transparent lane you position
once. It is the feature GINA users mean by "text triggers", built on two things the app already
had and had never joined: the overlay windows, and the `{token}` capture namespace a spoken
phrase already resolves against.

## 0. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A fourth audio channel, `'silent'` ("Nothing (text only)") | Without it every text alert must also make a noise. Text-only is the headline use of the feature, and turning the volume to zero would be a second, undiscoverable spelling of the same intent. |
| D2 | The font is a **curated closed list**, never a free-text family | The overlay bundle loads no webfonts, so a family it does not have renders as a silent fallback with nothing on screen saying why. And a def field is renderer input that reaches a `font-family` **in another window**. |
| D3 | A text alert whose overlay is **closed is dropped silently** | The celebration toast's law. The alert still fires, still sounds, still lands in the event log. Off means off, and only for the part that is off. |
| D4 | The presence of `AlertDef.display` **is** the enable | No second `enabled` flag beside the fields it would govern. Two switches for one state is how they drift (the toast's open-state rule). |
| D5 | Ids are minted **per firing**, and the queue never dedupes | Two fires of one alert are two things that happened. Stacking is the whole point of the feature, and a dedupe key is the one thing that could quietly defeat it. |
| D6 | This overlay **never captures the mouse** | A combat alert must not eat the click you aimed at the mob under it. It has no hover, no pin and no click target — which is the one place it deliberately differs from the toast. |
| D7 | One overlay ships; the **roster is the extension point** | One lane is enough to be useful, and the groundwork for several costs nothing. Defs store a target *kind*, and everything downstream reads `ALERT_OVERLAY_KINDS` rather than the literal `'alert'`. |
| D8 | No store migration | Both additions are additive-and-optional with readers that default, so no bytes already on disk change meaning. See §6. |
| D9 | Each overlay carries **its own** font/size/colour/seconds, and any alert may override any of the four | A user who wants their alerts big and yellow should say it once, and every alert that never disagreed should follow, including the ones written months ago. An absent per-alert field therefore means **inherit**, not "the shipped constant". |
| D10 | Which way the stack grows is a property of the **lane**, with no per-alert override | Two alerts pointed at one window cannot be allowed to disagree about which way it stacks — that is how lines end up drawn over each other. It is also the only setting here that is about the *window's* place on screen rather than about a line's look, which is why it sits beside "Move it" rather than in the editor. See §5. |

## 1. The model

`AlertDef.display?: AlertDisplay` — absent ⇒ the alert draws nothing, which is what every def
written before this meant.

```ts
interface AlertDisplay {
  text?: string             // template, `{token}` supported; absent/empty ⇒ the alert's NAME
  font?: AlertFont          // 'sans' | 'serif' | 'mono' | 'display'; absent ⇒ 'sans'
  fontSize?: number         // px, 10..96; absent ⇒ 28
  color?: string            // '#rgb' | '#rrggbb' ONLY; absent ⇒ '#ffcc33'
  overlay?: AlertOverlayKind// absent ⇒ 'alert'
  durationMs?: number       // 1000..30000; absent ⇒ 5000
}
```

**An omitted style field means INHERIT** — not "the shipped constant" (D9). An alert that
explicitly chose 28 px keeps 28 px even though 28 is also the constant, because the overlay it
targets may say 48; an alert that chose nothing follows whatever that overlay says today and
tomorrow. So the normalizer keeps a present, valid field verbatim and drops only an absent or
unusable one — still the omit-what-was-not-asked-for rule that keeps a def byte-identical across a
round trip, with a sharper definition of "not asked for".

The **overlay** side of that inheritance is `OverlayConfig.alertText` (`AlertTextDefaults`), riding
`overlays.<kind>` exactly as the toast's `durationMs` rides `overlays.toast.toast`. Unlike a
display block it is **always complete** — every field required, filled from the shipped constants
by `normalizeAlertTextDefaults` — because it is the thing being inherited *from*, and a hole in it
would have nothing left to fall back to.

Types live in `shared/alertTypes.ts`; the values, caps, normalizer, resolver and wire validator in
`shared/alertDisplay.ts` — the `speechText.ts` arrangement. The *roster* is separate again
(`shared/alertOverlays.ts`) because its consumers are window code, which has no business reaching
a def-field normalizer.

**Colour is a hex triple or it is the default.** Not `rgb()`, not a named colour, not `var()`. One
shape and one regex is what makes it impossible to smuggle a second declaration, a `url()` or a
trailing `;` into another window's inline style — the `isSafePackId` rule, applied to CSS.

## 2. Text is the SECOND consumer of the capture namespace, not a second namespace

`display.text` is the same `{token}` template a spoken phrase is: resolved by the same
`applyCaptures` (`shared/alertCaptures.ts`, JOS-103), against the same values, already through the
same `sanitizeCapture`, under the same 48-char cap, with the same **unknown token renders
literally** rule and the same editor token list (`captureNamesIn` / `tokensIn`). `displayTextFor`
mirrors `speechTextFor` exactly — apply → tidy → fall back to the alert's name → cap — and a test
asserts the two produce identical output for identical input, so "one implementation" is checked
rather than commented.

**NOTHING ABOUT CAPTURES IS NEW HERE, AND THAT IS THE POINT.** This feature adds no template
syntax, no second substitution pass, no ambient tokens and no new inlet for captured text: it is
one more CONSUMER of the namespace JOS-103 already built and already argued about. Every control
in that module's threat model still holds because the value reaching a lane took the same path a
spoken one does — which is also why the editor prints the same token list under both fields, and
why the display preview shows tokens unresolved rather than filling them with samples.

## 3. The notifier predicate

`isNotifierOverlayKind` (`shared/alertOverlays.ts`) names what the celebration strip and an alert
lane have in common: **a window that is empty at rest**. Three unrelated behaviours were each
spelled `kind !== 'toast'` in a different file, and all three are now that one predicate:

1. **No slot in the meter stack** (`main/overlayLayout.ts`) — a notifier has its own geometry and
   must not consume a stack index, or every meter's reserved slot shifts when one is added.
2. **No mouse forwarding** (`main/replayGate.ts`) — `forward:true` installs a system-wide
   WH_MOUSE_LL hook to serve a hover sensor. A notifier has none.
3. **Hidden while idle when opaque** (`main/notifierVisibility.ts`) — see §5.

## 4. The firing path

Renderer-originated, mirroring the toast, because `playAlertNow` is already the one place that
means "this alert fired, produce its output" and the only place all three firing paths converge:
the main-side module delta, renderer-only `'app'` signals, and the row's ▶.

```
playAlertNow(def, firing)
  └─ showAlertDisplay(def, firing)     ← THE FIRST STATEMENT
       window.eq.showAlertText(req) ──▶ 'alertText:show'      (only what the alert OVERRODE)
            main/alertOverlay.ts: validate → overlay open? → resolveAlertTextCard(req, cfg.alertText)
                                ──▶ 'alertText:card' ──▶ that one overlay window   (COMPLETE)
  └─ …speechPlan / coalesceAudio / playSound, untouched below it
```

**The inheritance happens in main, on a store read that was already being made.** The renderer
sends only what the alert chose, because only main holds the overlay's own look — and the
open-state check has that same config in hand at exactly the right moment. A renderer-side copy of
those defaults would be a second answer that goes stale the moment the user edits one in
Preferences. This is the toast's request/payload split arriving for the same reason
(`ToastRequest.itemName` → `ToastPayload.item`): a producer says what happened, main fills in what
only it knows.

**The insertion sits above the audio gate, and that ordering is the contract.** The master mute is
a promise the app makes no *noise*; the cross-alert coalescer exists to stop a smear of
simultaneous *sounds*. Neither is true of text — a card is a thing you see, and three buffs fading
at once is precisely when you want all three named. So a muted app still draws, and a burst still
draws every line.

`validateAlertTextRequest` is the trust boundary. Only two things are fatal — no text (nothing to
draw) and an unknown target overlay (nowhere to draw it). Everything else is **repaired** to its
clamped default, because a malformed field must never be why an alert the user can see is enabled
shows nothing.

## 5. The window

`AlertTextOverlay` + a pure `alertTextQueue` reducer over an explicit `dtMs`, with the same
discipline as `toastQueue` — no `setTimeout`, no `Date.now()`, and the same-array-identity guard
that keeps a still window from re-rendering ten times a second over the game.

**A sibling of `toastQueue`, not a reuse of it.** Three of its five rules are wrong here:
dedupe-by-id (forbidden, D5), hover-pin (unreachable — this window never captures the mouse, D6)
and the grace floor (meaningless without pinning). What is genuinely shared is "decrement, exit,
drop, preserve identity", about a dozen lines; threading five behaviour flags through shipped
celebration timing to save them would be the worse trade.

**Opaque-overlays compatibility (JOS-40) had to be generalised.** That mode builds windows
non-transparent, so an empty notifier would park a solid rectangle over the game forever — the
bug the mode exists to avoid. Main used to *infer* "drawing nothing" from the toast's
`setIgnoreMouse` signal, which works only because that window's capture happens to coincide with
its queue. An alert lane stays click-through whether or not it is drawing, so idleness is now
**stated** over a new `overlay:setIdle` channel, and the bookkeeping moved to
`main/notifierVisibility.ts` where it is unit-testable against a stub window. The toast sends both
signals and behaves byte-identically.

**IT STRETCHES, WITH NO MAXIMUM SIZE.** `overlaySizeLimits` is per kind: a
meter is a panel with a largest useful size (720×820 — about where a dense bar list stops gaining
from more room, and the neighbourhood the reserved-slot grid is laid out against), and a lane is a
banner with none. Its width is simply how much of a substituted line fits before it wraps, so
stretching one across the full top of an ultrawide is the feature working rather than a misuse of
it. The 720 cap that used to stop it was never a rendering constraint — it was the meters' number
applied to every kind, because the toast was the only exception anyone had needed. The drag frame
says both things it can do, since locked the lane is empty and click-through and an affordance the
user cannot see is one they will never find.

**AND SIZING IT IS ITS OWN PROBLEM, ANSWERED WHILE POSITIONING.** A meter's size is obvious the
moment you drag it, because it is full of bars. A lane is transparent and empty, so the question a
user is actually asking - how wide before a raid call wraps, how tall before the fourth stacked
alert is off the bottom - has nothing on screen to answer it. Unlocking therefore shows three
things beyond the drag bar: the window's **outline**, its **true dimensions** in the bar, and
**sample lines** drawn by the real `AlertTextCard` in this lane's own font/size/colour, inside the
real stack, one of them long enough to wrap (`alertPreviewCards`). The samples carry their own
testid: a sample is not an alert, and a count of what is on screen must not say three.

The **corner grip** (`ResizeGrip`, `overlay:resize`) exists because a notifier's whole surface is a
drag region - there is no header to grab, so the window moves from anywhere - which leaves the OS
resize border a few invisible pixels at the edge of a transparent window. It sends an absolute size
measured from where the drag began (a clamped incremental delta loses what it clips), main clamps
it with `clampOverlaySize` and persists the result, and the window's top-left never moves: the
corner you placed it by is not the corner that resizes it.

The first-open geometry is unchanged: 560×200, horizontally centred at `ALERT_TOP = 400`, which
clears the toast strip's 12…372 with a gutter so the two notifier lanes cannot open on top of each
other. Persisted bounds always win, so a stretched lane stays stretched.

**AND IT GROWS THE WAY THE USER PUT IT ON SCREEN** (D10). A lane dragged to the bottom of the
screen and told to grow *down* walks its own text off the desktop; the edge the user anchored is
the one they want the newest line against. So `AlertTextDefaults.growth` is `'down'` (the shipped
answer, and what every lane did before the option existed) or `'up'`, and the whole mechanism is
`alertStackJustify` — the block of lines fills the lane as a flex column and is anchored to one
end of it. Arrival order is untouched (D5 still holds), so the newest line is always the one
nearest the growing edge and the older ones move away from it.

`justifyContent`, not an auto margin, and the difference is not cosmetic: an auto margin needs
free space, and a lane holding more text than it is tall has none — so an 'up' lane would silently
revert to growing down at exactly the busy moment the setting was chosen for. Anchoring to the end
has no such cliff; the overflow leaves by the far edge, so what is lost is the OLDEST line.

## 6. Storage, sharing, and what would have gone wrong

**No migration.** `AlertDef.display` is the documented `alwaysPlay` / `cooldownScope` precedent —
every reader defaults on absence and electron-store round-trips the key untouched. `overlays.alert`
is a new key in a `Partial<Record<OverlayKind, OverlayConfig>>` whose reader fills from the
defaults. **The one thing that would flip this is `open: true`**: migration 8→9 exists precisely
because the toast changed an existing default from off to on, and a default change *is* a
re-reading of bytes already on disk. This kind ships off.

Two tripwires fire on any new overlay kind, both by design:

* `TELEMETRY_OVERLAY_KINDS` (`shared/telemetry.ts`) re-declares the kinds because that module may
  import nothing, and `tests/telemetryContract.test.mts` asserts exact set-equality. `TELEMETRY.md`
  is generated, committed and re-rendered under test.
* `sanitizeAlertDef` (`shared/shareSchema.ts`) rebuilds a def field by field, so **a field added to
  `AlertDef` and not added there does not survive a share** — exactly how `audio`/`speech` were
  once lost. `display` gets `applyDisplayFields`, running the same normalizer the save path uses,
  and re-checking `overlay` against the roster because a stranger's bundle can name a window this
  build does not have. `alertBehaviorKey` deliberately does **not** learn about `display`: two
  alerts that listen for the same thing and play the same sound are still one alert.

## 7. Scope fences

* **One lane ships.** The roster makes a second five lines (a union member, an array entry, a
  label, a telemetry entry, a store default the compiler demands) — but nothing speculative is
  built for it.
* ~~**No per-overlay style defaults.**~~ **Reversed (D9)** — the fence was wrong. It argued that a lane-level default would be a second place to look when one alert
  renders wrong; what it missed is that the common case is *every* alert wanting the same look,
  and saying that once is not a second place to look, it is the only place worth looking. The
  editor answers the original worry instead: each control shows the EFFECTIVE value and says "from
  the overlay" until you touch it, so where a value came from is on screen rather than inferred.
* **No text-size stepper on the lane's drag frame**, unlike the toast's. `overlay:setConfig` fans a
  `textScale` write out to every kind, and this kind's real size knob is per-alert `fontSize` — two
  answers to one question. The global scale still applies through `ScaledContent`.
* **Positioning lives in Preferences**, not the TitleBar overlay menu. That menu is a bare
  open/close checkbox, and a locked lane is empty and click-through with no chrome to grab — so
  "Move it" is the only route, which is exactly why `ToastSetting` exists for the same shape of
  window.
