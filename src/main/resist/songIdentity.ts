// WHICH SPELLS ARE SONGS, AND WHICH SONG A LANDING SENTENCE BELONGS TO (JOS-382, round 2).
//
// Pure over an injected spell catalog. `tests/resistSongs.test.mts` drives it directly.
//
// ── WHY THIS FILE EXISTS: THE BUG IT IS THE FIX FOR ─────────────────────────────────────────────
//
// The first cut decided "is this a song" from the log's own `You begin singing` line. That is a
// perfectly good signal and it is almost never printed: EQ Legends bards run their songs under the
// SYMPHONIC AURA, which re-pulses every six seconds with NO cast line at all. The owner's
// 2,013,829-line log contains FIVE `You begin singing` lines and 4,152 pulses of one song's
// landing emote. So nothing was ever flagged as a song, no cast was ever armed for the emote to
// join to, and every one of the 400 Largo's resists in the shipped baseline was filed as an
// ordinary cast with ZERO landings beside it. A spell that is 100% resisted by construction drags
// magic toward "nearly immune" on every mob a bard ever sang at.
//
// THE FIX IS TO DECIDE IT FROM SPELL IDENTITY. A spell only the Bard can learn is a song, always,
// whether or not the log announced it — and `spells.json` states the class outright
// (`"* Bard - Level 20"`). The parser's `sung` flag stays as a corroborating signal for the rare
// song a bard actually starts by hand.
//
// ── AND ONE PLACE THE WIKI IS WRONG, WITH THE EVIDENCE ──────────────────────────────────────────
//
// The catalog says:
//     Largo's Melodic Binding    Bard 20    "Someone is bound IN strands of solid music."
//     Largo's Assonant Binding   Bard 51    "Someone is bound BY strands of solid music."
//
// EQ Legends prints `<mob> is bound BY strands of solid music.` 4,152 times in the owner's log,
// and `<mob> resisted your Largo's Melodic Binding!` 570 times, interleaved on the same six-second
// grid, while the character is level 21 to 24. A level-21 bard does not have a level-51 song. The
// sentence is MELODIC's on this server, and the catalog has it filed under Assonant.
//
// That is drift class five — the one `spellCorrectionsList.ts` was built for — and this table is
// the same shape of answer, kept LOCAL to the resist feature on purpose: correcting the global
// catalog changes what the parser emits for the buff overlay, the alerts and the timers as well,
// and that is an owner-level call about a shared table rather than something a resist ticket
// should smuggle in. A row here says only "for the purpose of pooling resist observations, these
// two names are one song", which is exactly true and nothing more.

import { parseSpellClassLevels } from '../../shared/spellLines'
import type { SpellDb } from '../data/spellDb'
import { spellCanonKey } from '../log/parseCommon'

/**
 * Canonical key -> the key its observations pool under. EVERY ROW IS A CLAIM ABOUT WHAT THE GAME
 * DOES, backed by log lines, and never a way to quiet a number somebody dislikes.
 *
 * `largo's assonant binding` -> `largo's melodic binding`
 *   The catalog's landing sentence for Assonant (Bard 51) is the one Legends prints for Melodic
 *   (Bard 20): 4,152 emotes against 570 `resisted your Largo's Melodic Binding` on one six-second
 *   grid, cast by a level 21-24 character. Both names are one song line, and the resist model
 *   needs the emote (the landing half) and the resist line to meet or the song has no denominator.
 */
export const SONG_FAMILY_OVERRIDES: Readonly<Record<string, string>> = {
  "largo's assonant binding": "largo's melodic binding",
}

/** The key a song's observations pool under. Identity for everything the table does not name. */
export function songFamilyKey(spellKey: string): string {
  return SONG_FAMILY_OVERRIDES[spellKey] ?? spellKey
}

/**
 * MEMOISED, per catalog, and the reason is a measurement. Both answers below are constant for the
 * life of a catalog, and the fold asks them on EVERY resist, EVERY spell-damage line and EVERY
 * landing sentence in a two-million-line replay — and `parseSpellClassLevels` is a regex pass over
 * a free-text class column ("* Bard - Level 20"). Answering it fresh each time cost 1.6 seconds of
 * fold on the owner's log (`npm run bench:replay`: 2,671 ms with the naive call, 1,088 ms with
 * this cache, on identical input and byte-identical output). A WeakMap so a catalog that goes away
 * takes its cache with it.
 */
const songCache = new WeakMap<SpellDb, Map<string, { song: boolean; landing: boolean }>>()

function facts(db: SpellDb | undefined, spellKey: string): { song: boolean; landing: boolean } {
  if (!db) return { song: false, landing: false }
  let byKey = songCache.get(db)
  if (!byKey) {
    byKey = new Map()
    songCache.set(db, byKey)
  }
  const hit = byKey.get(spellKey)
  if (hit) return hit
  const entry = db.byKey.get(spellKey)
  const levels = parseSpellClassLevels(entry?.classes)
  const msg = entry?.msgCastOnOther
  const computed = {
    song: levels.length > 0 && levels.every((l) => l.cls === 'BRD'),
    landing: typeof msg === 'string' && msg.length > 0,
  }
  byKey.set(spellKey, computed)
  return computed
}

/**
 * Is this a song? True when the Bard is the ONLY class the catalog says can learn it. "Only" is
 * load-bearing: a handful of lines are shared with other classes and those roll once per cast like
 * anything else.
 */
export function isSongSpell(db: SpellDb | undefined, spellKey: string): boolean {
  return facts(db, spellKey).song
}

/**
 * Does the catalog know a landing sentence for this song? When it does, every pulse that LANDS
 * prints one and the denominator is exact — lands plus resists, no reconstruction at all. When it
 * does not, songs.ts has to rebuild the pulses.
 */
export function songLandingObservable(db: SpellDb | undefined, spellKey: string): boolean {
  return facts(db, spellKey).landing
}

/**
 * WHICH song a landing sentence belongs to. EQ prints ONE sentence per spell FAMILY (world-model
 * law 3), so the parser hands over a candidate LIST and the model resolves it — here against what
 * the log has NAMED, which for a song is its resist lines.
 *
 * `named` is every song key a resist line has spelled out, best first (this mob, then anywhere in
 * the session). A single candidate needs no resolving; several with nothing to separate them are
 * REFUSED rather than guessed at, because pooling two songs would smear their resist adjusts
 * together and a -100 proc adjust is exactly the thing this model exists to take out.
 */
export function resolveSongEmote(
  db: SpellDb | undefined,
  candidates: readonly string[],
  named: readonly string[]
): string | null {
  const songs: string[] = []
  for (const name of candidates) {
    const key = spellCanonKey(name)
    if (isSongSpell(db, key)) songs.push(songFamilyKey(key))
  }
  if (songs.length === 0) return null
  const unique = [...new Set(songs)]
  if (unique.length === 1) return unique[0]
  for (const key of named) {
    if (unique.includes(key)) return key
  }
  return null
}
