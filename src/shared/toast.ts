// toast.ts — the CELEBRATION TOAST payload (docs/plans/celebration-toasts.md §2), its
// renderer→main request shape, the validator main re-runs on that request, and the pure
// formatter that turns an item's knowledge into the two-or-three stat lines the toast card
// prints.
//
// WHY A REQUEST AND A PAYLOAD. The producers are the main window's always-mounted celebration
// detectors (T4): they know the TITLE and, for a Sky turn-in, the reward item's NAME — nothing
// more. Main resolves that name into the embedded card (icon id, colour hint, stat lines) with
// `lookupItem`, because the overlay bundle is MUI-free and FETCHES NOTHING (T5): everything it
// draws arrives inside one push. So the wire carries two shapes:
//
//   ToastRequest  renderer → main   what happened + optionally the reward item's name
//   ToastPayload  main → overlay    the same, with the item card RESOLVED and pre-formatted
//
// THE VALIDATOR IS NOT A FORMALITY. `toast:show` is a renderer→main channel, and this repo's
// rule is that renderer input is re-validated at the handler rather than trusted because
// today's only caller is the app's own UI (the `sounds:getData` packId precedent). Everything
// here is a closed union or a capped string: an unknown kind, an over-long title or an
// unlisted focus view is DROPPED, never forwarded. The payload then crosses into a window
// that draws it, so "capped" is a rendering guarantee too — a 40 kB title cannot push the
// card off screen.
//
// Pure + dependency-free (types only), so `npm test` exercises it with no Electron.

import type { ItemKnowledge, ItemStatBlock } from './types'
import type { AppFocus, AppFocusView } from './types'
import type { AlertSoundRef } from './alertTypes'

// ---- the toast overlay's own config knobs (docs/plans/celebration-toasts.md §3) --------
//
// They ride `overlays.toast` (OverlayConfig.toast) rather than a second store key, so the
// toast is a sixth overlay KIND in every sense: one open-state, one persisted bounds, one
// per-kind config read. `open` IS the design's `enabled` — a toast overlay that is open is
// the feature being on, and two switches for one state is how they drift.

/** Sound + timing for the toast kind. Everything else it needs is standard OverlayConfig. */
export interface ToastOverlayConfig {
  /**
   * The line the MAIN WINDOW plays when a toast fires (T7 — the overlay bundle has no audio
   * stack). `null` is MUTE, and it is the shipped default: both producers already have a
   * seeded, enabled alert with its own voice line, so a default sound here would speak twice
   * over every boss kill. The picker offers the packs; silence is a state, not an omission.
   */
  sound: AlertSoundRef | null
  /** 0..1, applied on top of the sound. */
  volume: number
  /** how long a card holds before it leaves, when the payload names no duration of its own */
  durationMs: number
}

export const DEFAULT_TOAST_DURATION_MS = 6000

export const DEFAULT_TOAST_CONFIG: ToastOverlayConfig = {
  sound: null,
  volume: 0.7,
  durationMs: DEFAULT_TOAST_DURATION_MS
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** A stored sound reference, or null. HALF a reference is no reference — a packId with no
 *  soundId cannot be played, and storing it would look like a choice the user made. */
function asSoundRef(v: unknown): AlertSoundRef | null {
  const o = asRecord(v)
  const packId = typeof o.packId === 'string' ? o.packId : ''
  const soundId = typeof o.soundId === 'string' ? o.soundId : ''
  return packId && soundId ? { packId, soundId } : null
}

/** Coerce a stored/patched toast config into the valid shape (the store's clamp lives here). */
export function normalizeToastConfig(v: unknown): ToastOverlayConfig {
  const o = asRecord(v)
  const duration = Math.floor(asNumber(o.durationMs, DEFAULT_TOAST_CONFIG.durationMs))
  return {
    sound: asSoundRef(o.sound),
    volume: Math.max(0, Math.min(1, asNumber(o.volume, DEFAULT_TOAST_CONFIG.volume))),
    durationMs: Math.min(TOAST_MAX_DURATION_MS, Math.max(TOAST_MIN_DURATION_MS, duration))
  }
}

/** What kind of celebration this is. Closed union — the overlay styles per member. */
export type ToastKind = 'bossKill' | 'skyQuestComplete'

export const TOAST_KINDS: ToastKind[] = ['bossKill', 'skyQuestComplete']

/**
 * The reward item, as the toast draws it. Everything is RESOLVED IN MAIN and pre-formatted:
 * the overlay renders these strings verbatim and asks nobody anything.
 */
export interface ToastItemCard {
  name: string
  /** wiki icon id — the overlay renders `eqimg://item/<id>` (permanent cache, never network) */
  iconId?: number
  /** rendering hint for the NAME's colour: 'lore' | 'magic'. Absent ⇒ the ordinary item green. */
  colorFlag?: string
  /** pre-formatted key stat lines ("MAGIC ITEM · LORE ITEM", "Slot: FINGER", …) */
  lines: string[]
}

/** One celebration, as the toast overlay receives it. */
export interface ToastPayload {
  /** dedupe / eviction key — a repeat id refreshes the card already on screen */
  id: string
  kind: ToastKind
  /** headline ("Lord Nagafen defeated", "Quest complete: Test of Sacrifice") */
  title: string
  /** supporting line: the instance tier, the quest's class, the zone */
  subtitle?: string
  /** the Sky reward, embedded (resolved in main) */
  item?: ToastItemCard
  /** where a click takes you (T6) — re-validated at the IPC handler like every deep link */
  focus?: AppFocus
  /** how long the card holds before it starts leaving. Absent ⇒ the config's duration. */
  durationMs?: number
}

/**
 * What a PRODUCER sends (renderer → main). Same shape minus the resolved card: the detector
 * knows the reward item's NAME, main knows how to look it up.
 */
export interface ToastRequest extends Omit<ToastPayload, 'item'> {
  /** the reward item to embed as a card, by name. Main resolves it; an unknown name simply
   *  yields no card rather than a fabricated one (world-model law 1). */
  itemName?: string
}

// ---- caps (rendering guarantees, not taste) ------------------------------------------

export const TOAST_MAX_TEXT = 120
export const TOAST_MAX_LINES = 4
export const TOAST_MAX_LINE = 64
/** Longest a payload may hold the screen, whatever it asks for. */
export const TOAST_MAX_DURATION_MS = 30_000
export const TOAST_MIN_DURATION_MS = 1_000

/** The deep-link destinations a toast may name. Mirrors the AppFocusView union (closed set). */
const FOCUS_VIEWS: AppFocusView[] = ['mobs', 'posky']

function cappedText(v: unknown, max = TOAST_MAX_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
}

/** Validate a focus target against the closed view union; anything else is dropped. */
function validFocus(v: unknown): AppFocus | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const view = typeof o.view === 'string' ? o.view : ''
  if (!(FOCUS_VIEWS as string[]).includes(view)) return undefined
  const mob = cappedText(o.mob)
  return mob ? { view: view as AppFocusView, mob } : { view: view as AppFocusView }
}

/**
 * Re-validate a renderer-supplied toast request. Returns a NEW object carrying only the
 * fields this module names — unknown properties are stripped, not passed through — or null
 * when the request cannot be honoured (no id, no title, or an unknown kind).
 */
export function validateToastRequest(input: unknown): ToastRequest | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  const id = cappedText(o.id)
  const title = cappedText(o.title)
  const kind = typeof o.kind === 'string' && (TOAST_KINDS as string[]).includes(o.kind)
    ? (o.kind as ToastKind)
    : null
  if (!id || !title || !kind) return null
  const durationMs = positiveInt(o.durationMs)
  const out: ToastRequest = { id, kind, title }
  const subtitle = cappedText(o.subtitle)
  if (subtitle) out.subtitle = subtitle
  const itemName = cappedText(o.itemName)
  if (itemName) out.itemName = itemName
  const focus = validFocus(o.focus)
  if (focus) out.focus = focus
  if (durationMs !== undefined) {
    out.durationMs = Math.min(TOAST_MAX_DURATION_MS, Math.max(TOAST_MIN_DURATION_MS, durationMs))
  }
  return out
}

// ---- the item card's stat lines -------------------------------------------------------
//
// The in-game item window has a dozen rows; a toast has room for three. What survives is what
// tells you whether the thing you just won is worth wearing: its flags, where it goes, the
// numbers, and the effect on it. Everything is taken VERBATIM from the parsed block — nothing
// here computes, ranks or judges a stat (law 1).

/**
 * Flags + slot, the item window's first two rows, folded into one.
 *
 * A wiki stat block usually opens with the item's own NAME and a rule of dashes, and
 * `parseStatsBlock` — which never drops anything it does not understand (law 1) — keeps both as
 * FLAGS. The full item window can afford to print them; a three-line toast card cannot, and the
 * name is already the line above. So those two are skipped HERE, at the point of display, and
 * nowhere upstream.
 */
function headerLine(b: ItemStatBlock, name: string): string | undefined {
  const key = name.trim().toLowerCase()
  const flags = b.flags
    .filter((f) => !/^-+$/.test(f) && f.trim().toLowerCase() !== key)
    .slice(0, 3)
    .join(' · ')
  const slot = b.slot ? `Slot: ${b.slot}` : ''
  return [flags, slot].filter(Boolean).join('  ') || undefined
}

/** AC + the attribute grid, in source order, as `AC 21 · STR +20 · HP +80`. */
function statsLine(b: ItemStatBlock): string | undefined {
  const parts: string[] = []
  if (typeof b.ac === 'number') parts.push(`AC ${String(b.ac)}`)
  if (typeof b.dmg === 'number') parts.push(`DMG ${String(b.dmg)}`)
  if (typeof b.atkDelay === 'number') parts.push(`Delay ${String(b.atkDelay)}`)
  for (const s of b.stats) parts.push(`${s.key} ${s.value}`)
  return parts.length ? parts.slice(0, 6).join(' · ') : undefined
}

/** The first effect line, named the way the block names it. */
function effectLine(b: ItemStatBlock): string | undefined {
  const e = b.effects[0]
  if (!e) return undefined
  const kind = e.kind === 'effect' ? 'Effect' : `${e.kind[0].toUpperCase()}${e.kind.slice(1)} Effect`
  return `${kind}: ${e.name}`
}

/**
 * Fall back to the RAW stat-block text when the structured parse produced nothing — the wiki
 * writes some blocks in shapes the parser leaves in `extras`, and printing the page's own
 * lines is more honest than printing none.
 */
function rawLines(statsBlock: string | undefined): string[] {
  if (!statsBlock) return []
  return statsBlock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^-+$/.test(l))
    .slice(1, 1 + TOAST_MAX_LINES)
}

/** The name colour hint: LORE first (the flag that constrains you), then MAGIC. */
function colorFlagOf(k: ItemKnowledge): string | undefined {
  if (k.lore) return 'lore'
  const flags = k.stats?.flags ?? []
  if (flags.some((f) => /magic/i.test(f))) return 'magic'
  return undefined
}

/**
 * Turn an item's knowledge into the compact card the toast embeds. Pure, so the exact lines a
 * Sky reward prints are pinned by a test rather than by looking at the app.
 */
export function toastItemCard(k: ItemKnowledge): ToastItemCard {
  const b = k.stats
  const lines = (
    b
      ? [headerLine(b, k.name), statsLine(b), effectLine(b)].filter((l): l is string => !!l)
      : rawLines(k.statsBlock)
  )
    .map((l) => l.slice(0, TOAST_MAX_LINE))
    .slice(0, TOAST_MAX_LINES)
  const card: ToastItemCard = { name: k.name.slice(0, TOAST_MAX_TEXT), lines }
  const iconId = positiveInt(k.iconId)
  if (iconId !== undefined) card.iconId = iconId
  const colorFlag = colorFlagOf(k)
  if (colorFlag) card.colorFlag = colorFlag
  return card
}
