// conCard.ts — main's half of the CON CARD overlay (JOS-383, shared/conCard.ts).
//
// ONE LOG LINE IN, ONE CARD OUT. The trigger is a `/con` the player typed, and unlike the alert
// banner there is no renderer producer anywhere in this feature: main owns the log, the resist
// ledger, the mob knowledge and the kill counts the card is made of, so main builds it whole and
// the overlay window draws exactly what it is handed (the celebration toast's self-contained
// contract, kept).
//
// A CLOSED OVERLAY IS SILENT. Nothing is sent when the window is not open — that is what makes the
// Preferences switch honest, and it is checked here rather than in the overlay because a window
// that does not exist cannot decline anything.
//
// IT ARRIVES IN TWO PASSES, AND THE SECOND IS NOT A CORRECTION. The whole point of this card is the
// two seconds before you decide to fight, so pass 1 goes out the instant the line is parsed with
// everything that needs no lookup: the name, the level the game just stated, the zone, and the five
// resist chips off the ledger. Pass 2 follows when `lookupMob` answers — the drop table, your own
// looted counts, the respawn — and refreshes the SAME queue id, which the overlay treats as the
// card it already has getting fuller rather than a second card. A lookup that never answers simply
// leaves pass 1 on screen, which is the honest state (world-model law 1).
//
// THE THREE REFUSALS, all of them the owner's scope:
//   * NEVER FOR A PLAYER. `/con` on another character prints the same shape as `/con` on a mob, so
//     the refusal is `looksLikePlayer` below — and it is stated in one place because it is the one
//     inference in this file.
//   * NEVER TWICE INSIDE A MINUTE OF A CLOSE. Closing the card is a statement about that creature;
//     re-conning it while lining up the pull is not a request to read it again
//     (`CON_CARD_REOPEN_SUPPRESS_MS`). The close arrives from the overlay over `con:card-closed`.
//   * NEVER FOR A HISTORICAL LINE. Only LIVE cons reach here at all (the seam is fed from the
//     consider module's live path), so a startup replay of a month of logs draws nothing.

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { logError } from './errorLog'
import { getOverlayConfig } from './store'
import { getOverlayWindow } from './windows'
import { killsFor } from '../shared/kills'
import { mobKey } from '../shared/mobKey'
import {
  CON_CARD_WIRE_DROPS,
  cappedName,
  conCardChips,
  conCardIsPlayer,
  conCardSuppressed,
  type ConCardPayload,
  type ConCardSeenDrop,
  type ConCardWikiDrop
} from '../shared/conCard'
import type { ConsiderEvent } from '../shared/logEvents'
import type { MobKnowledge } from '../shared/types'
import { localMobEntry, lookupMob } from './mobLookup'
import { wikiRespawnFor } from './modules/respawn'
import { considerModule, killsModule } from './pipeline'
import { resistProfileDeps } from './ipc/resist'
import { mobResistProfile } from './resist/profile'
import { spellTable } from './resist/spellTable'

/**
 * The player refusal, bound to the committed catalog. The RULE (and the measurement that overturned
 * the ticket's claim that the con ladder answers this) is `conCardIsPlayer` in shared/conCard.ts,
 * where a node test can drive it; this is the one line that knows where the catalog lives.
 */
export function looksLikePlayer(name: string): boolean {
  // `localMobEntry` answers NULL for a mob the catalog has never heard of — not undefined. A
  // `!== undefined` here read as "the catalog knows everything", which is how the first cut of
  // this drew a card over another player's head in the e2e. One comparison, one measured bug.
  return conCardIsPlayer(name, (n) => localMobEntry(n) !== null)
}

/** Which mob the card on screen is about, so a late lookup for a mob that has been replaced by a
 *  newer `/con` is dropped instead of overwriting the newer card. */
let showing: string | null = null

/**
 * mob key -> when its card was last CLOSED by the user. The suppression window's whole memory.
 *
 * NOTHING RESETS IT, and that is deliberate rather than an omission: an entry means nothing one
 * minute after it is written, so a character switch or an epoch boundary has nothing to clear — and
 * every write drops the entries that have expired, so the map holds only the mobs whose cards were
 * closed in the last minute.
 */
const closedAt = new Map<string, number>()

function sendToConCardOverlay(payload: ConCardPayload): void {
  const w = getOverlayWindow('conCard')
  if (!w || w.isDestroyed()) return
  const wc = w.webContents
  // A window still loading its page would silently drop the send — the toast learned this first,
  // and the very first `/con` after a launch is exactly when the page is still loading.
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.onConCard, payload))
  else wc.send(IPC.onConCard, payload)
}

/** The five chips, off the same profile the mob page's Resists card is drawn from. */
function chipsFor(display: string): { chips: ConCardPayload['chips']; spellData: boolean } {
  const profile = mobResistProfile(display, resistProfileDeps())
  return { chips: conCardChips(profile), spellData: profile.spellDataAvailable }
}

/** The wiki drop table, trimmed to what a card can carry. */
function wireWikiDrops(k: MobKnowledge): ConCardWikiDrop[] {
  return (k.dropsWiki ?? []).slice(0, CON_CARD_WIRE_DROPS).map((d) => {
    const row: ConCardWikiDrop = { item: d.item }
    if (d.rarity !== undefined) row.rarity = d.rarity
    return row
  })
}

/** What YOUR log has looted off it, trimmed the same way. The `+N` fold happens in the overlay,
 *  through the mob page's own `foldSeenVariants` — one fold, two surfaces. */
function wireSeenDrops(k: MobKnowledge): ConCardSeenDrop[] {
  return (k.dropsSeen ?? []).slice(0, CON_CARD_WIRE_DROPS).map((d) => ({
    item: d.item,
    count: d.count,
    lastTs: d.lastTs
  }))
}

/** The card as the log line alone can describe it, before any lookup has answered. */
function firstPass(ev: ConsiderEvent, zone: string | undefined, key: string): ConCardPayload {
  const display = cappedName(ev.mob)
  const { chips, spellData } = chipsFor(display)
  const payload: ConCardPayload = { id: key, ts: ev.ts, name: display, chips, spellData }
  if (ev.level !== undefined) payload.level = ev.level
  if (zone !== undefined) payload.zone = zone
  if (ev.rare) payload.rare = true
  // The respawn is LOCAL — a committed table, keyed by the same name — so it costs nothing to
  // answer now rather than waiting for the network half of the knowledge lookup.
  const respawn = wikiRespawnFor(key)
  if (respawn) payload.respawn = respawn.text
  return payload
}

/**
 * The card once the knowledge has landed: everything pass 1 said, plus what it drops and how often
 * YOU have had it. `knowledgeIn` is what lets the overlay tell "this mob drops nothing we know of"
 * from "we are still asking" — two different sentences, and only one of them is true at a time.
 */
function secondPass(base: ConCardPayload, k: MobKnowledge): ConCardPayload {
  const payload: ConCardPayload = { ...base, knowledgeIn: true }
  const wiki = wireWikiDrops(k)
  const seen = wireSeenDrops(k)
  if (wiki.length > 0) payload.dropsWiki = wiki
  if (seen.length > 0) payload.dropsSeen = seen
  // The perceived rate's DENOMINATOR — your own recorded kills of this mob, which is the number
  // the mob page divides by and states beside every rate it prints (features/mobs/MobDropRow.tsx).
  const kills = killsFor(killsModule.snapshot().state.mobs, base.name)?.count
  if (kills !== undefined && kills > 0) payload.kills = kills
  return payload
}

/**
 * ONE LIVE `/con`. Returns whether a card was sent, so the tests can drive the whole gate without
 * an overlay window in the way.
 */
export function noteConsider(ev: ConsiderEvent, zone: string | undefined, now = Date.now()): boolean {
  if (!getOverlayConfig('conCard').open) return false
  if (looksLikePlayer(ev.mob)) return false
  const key = mobKey(ev.mob)
  if (!key) return false
  // THE SUPPRESSION IS WALL CLOCK, NOT LOG CLOCK, and the difference is not academic: EQ stamps a
  // line to the SECOND, so a con played back inside the same second as the close arrives with a `ts`
  // up to 999 ms EARLIER than the close it is supposed to be suppressed by — which the e2e caught by
  // putting the card straight back up. "Closed within the last minute" is a fact about the person,
  // so it is measured on the clock the person lives on. `ev.ts` still stamps the payload, because
  // WHEN THE CON HAPPENED is a fact about the log.
  if (conCardSuppressed(closedAt.get(key), now)) return false
  const base = firstPass(ev, zone, key)
  showing = key
  sendToConCardOverlay(base)
  enrich(base, key)
  return true
}

/**
 * The second pass, off the event path. `spellTable()` is awaited alongside the lookup because the
 * client's own table is read once per launch on a worker thread — so the FIRST con of a session
 * draws its chips from whatever was already loaded (usually nothing, i.e. five honest "not enough
 * data" chips) and this pass fills them in a moment later, exactly as it fills in the drops.
 *
 * `lookupMob` is the app's ONE door to mob knowledge and is cache-first: a catalog mob is answered
 * with no network at all, and a wiki mob rides the same politely-spaced queue every other surface
 * shares. Nothing here re-implements a lookup, and nothing here fabricates one that failed.
 */
function enrich(base: ConCardPayload, key: string): void {
  void Promise.all([spellTable(), lookupMob(base.name)])
    .then(([, knowledge]) => {
      // The player has conned something else since, or closed this card. Either way the newer
      // state is the true one and this answer is stale.
      if (showing !== key) return
      const { chips, spellData } = chipsFor(base.name)
      sendToConCardOverlay(secondPass({ ...base, chips, spellData }, knowledge))
    })
    .catch((err: unknown) => {
      logError('main:conCard', err)
    })
}

/** How long a mob key a renderer may name. A key is a folded mob name; this is its cap. */
const MAX_KEY_CHARS = 120

/**
 * The user closed the card. Recorded here because the SUPPRESSION is main's business — the overlay
 * has no idea what a re-con is — and re-validated because it is a renderer-supplied string.
 */
export function noteConCardClosed(input: unknown, now = Date.now()): void {
  if (typeof input !== 'string') return
  const key = input.trim().slice(0, MAX_KEY_CHARS)
  if (!key) return
  for (const [k, at] of closedAt) {
    if (!conCardSuppressed(at, now)) closedAt.delete(k)
  }
  closedAt.set(key, now)
  if (showing === key) showing = null
}

/**
 * The close channel AND the trigger seam, installed together because they are two halves of one
 * feature: the consider module is where a `/con` becomes a fact, and this file is where a fact
 * becomes a card. Called from `ipc/index.ts` beside the other producer registrations.
 */
export function registerConCardIpc(): void {
  considerModule.setConCardHook((ev, zone) => {
    noteConsider(ev, zone)
  })
  ipcMain.on(IPC.conCardClosed, (_e, key: unknown) => {
    try {
      noteConCardClosed(key)
    } catch (err: unknown) {
      logError('main:conCardClosed', err)
    }
  })
}
