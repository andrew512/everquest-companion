# Celebration toasts — transient top-center overlay alerts

Status: DESIGN. Author: planning session (Fable), 2026-08-04. Owner-requested.
Constrained by AGENTS.md: overlay laws (MUI-free bundle, persisted bounds win,
click-through when locked), celebrations law (live transitions only — the law
is replay-vs-live, not first-vs-every), Electron trust boundary (one
WEB_PREFERENCES, hardenWebContents covers every window), UI conventions
(state never process). Wave L; dispatches after wave J frees the overlay
files.

## 0. What we are building, in one paragraph

A sixth overlay kind, **`toast`**: a transparent, always-on-top strip at the
**top-center of the screen** that normally renders nothing. When something
worth celebrating happens — a **boss kill**, a **Plane of Sky quest
completion** — a compact card animates in (subtle slide-down + fade, ~250 ms),
plays a **subtle sound**, holds for ~6 s, and fades away. **Mouse-over pins
it** (stays until mouse-out, then resumes its exit). The Sky-completion toast
embeds the reward **item card**; clicking it focuses the main window and jumps
to that quest on the PoS page. Position is top-center by default and
configurable the way every overlay already is: drag it in interactive mode,
persisted bounds win forever after.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| T1 | Toast is a NEW OVERLAY KIND in the existing system (`overlays.toast` config, same overlay.html bundle, `?kind=toast`) — not a new window species | The overlay infra already solves transparency, always-on-top, per-kind persisted config, spawn/close IPC, the security wrapper; a sixth kind is additive |
| T2 | The window is PERSISTENT while enabled, click-through when idle; when a card is visible it flips `setIgnoreMouseEvents(false)` so hover/click work, and back when the card exits | On-demand window creation would pay ~200 ms of Electron spawn on every toast — the exact moment we want the animation crisp |
| T3 | Content arrives over ONE IPC push `toast:show` with a self-contained payload (text, kind, optional embedded item block, optional deep-link target); the overlay renders, times, and dismisses locally | The overlay must stay dumb and MUI-free; timing/hover-pin is pure renderer state |
| T4 | Producers are the EXISTING app-signal detectors (bossDefeat, questComplete) in the main window renderer — they already own the live-only/replay-silence discipline; they call a new `window.eq.showToast(payload)` and main fans out to the toast window | No second detector, no drift between what celebrates and what toasts (celebrations law kept in ONE place) |
| T5 | The Sky item card is a MUI-FREE compact item window (icon via `eqimg://`, name in EQ item color, key stat lines) rendered from data RESOLVED IN MAIN (lookupItem) and embedded in the payload | The overlay bundle is MUI-free by law and must not fetch: payload carries everything, offline-safe |
| T6 | Click-through to the quest: the card's click sends the existing cross-window `AppFocus` nav (closed union gains a posky/quest member) — focus main window, open PoS anchored at the quest | The AppFocus pattern is exactly this; deep links stay nonce-keyed like openMob/openLoot |
| T7 | Sound: per-toast-kind sound from the installed packs, default a subtle line from the shipped default pack; volume + mute in the toast config; played by the MAIN WINDOW's existing alert audio path, not the overlay | The overlay bundle has no audio stack; the alert player already handles packs, volume, coalescing — a toast sound is one more caller |
| T8 | Auto-dismiss default 6 s; hover pauses the clock (pin), mouse-out resumes with ~1.5 s grace; a queue of ≥2 stacks vertically (newest under oldest), each with its own clock, capped at 3 with oldest evicted | The owner's stated interaction, plus the obvious burst case (boss + quest complete on the same kill) |
| T9 | Boss-kill toast fires EVERY kill (owner decision, same as the audio-alert change in wave K); hydration/replay never toast | Celebrations law reread: once-per-live-transition ≠ once-ever |

## 2. Payload

```ts
// shared (new file src/shared/toast.ts)
export type ToastKind = 'bossKill' | 'skyQuestComplete'
export interface ToastItemCard {
  name: string
  iconId?: number
  colorFlag?: string        // magic/lore rendering hint for the name color
  lines: string[]           // pre-formatted key stat lines, MAIN resolves them
}
export interface ToastPayload {
  id: string                // dedupe/eviction key
  kind: ToastKind
  title: string             // "Lord Nagafen defeated" / "Quest complete: <quest>"
  subtitle?: string         // tier chip text, zone, etc.
  item?: ToastItemCard      // sky completion embeds the reward
  focus?: AppFocus          // click target (posky quest anchor)
  durationMs?: number       // default 6000
}
```

## 3. Config & shell

`overlays.toast`: `{ enabled, bounds?, sound: {packId, soundId} | null,
volume, durationMs }`. Default geometry: width 440, height fit-content,
x = centered on the primary display, y = 12 — computed in overlayLayout.ts
beside the existing default-stack logic; persisted bounds always win.
Interactive mode shows a faint outline + drag handle (matching the meter
overlays' idiom) so "configurable position later" is just the existing
mechanism. Settings live with the other overlay toggles in Preferences.

## 4. Look & feel

Transparent window, card = dark glass (rgba theme-derived, 1px hairline,
8px radius, backdrop blur if cheap), EQ-gold title line, subtitle muted.
Enter: translateY(-8px→0) + opacity 0→1, 250 ms ease-out. Exit: reverse,
300 ms. Subtle. No confetti in the overlay (the main window keeps its own
celebration behavior). The Sky variant renders the item card beneath the
title; hover anywhere pins; the item card is the click target for T6 and
gets a pointer cursor + hairline highlight on hover — the only affordance.

## 5. Scope fences

- No generic user-authored toast rules in v1 (the alert engine is not
  involved); exactly the two producers, extensible by payload kind.
- No stacking config, no per-kind positions, no animation options.
- Overlay stays MUI-free; no network, no lookup from the overlay.

## 6. Waves

- **Wave L (after J lands — overlay files)**: shared/toast.ts + config +
  windows/overlayLayout wiring + overlay renderer (card, queue, hover-pin,
  animations) + IPC + preload + detector calls + main-window audio hookup +
  posky AppFocus anchor + tests (payload validation, layout default, queue
  timing pure-function tests) + e2e smoke (toast window spawns hidden in
  EQ_E2E, receives a payload, renders the card).
