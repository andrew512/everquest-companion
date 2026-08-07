import { DEFAULT_PROFILE } from '../../shared/profiles'
import type { SpellDb } from '../data/spellDb'

/**
 * Per-profile parser configuration. Different EQ servers/emulators can differ in
 * log wording, so the single parse pass (see parser.ts) is parameterized by a
 * config looked up per profile. Today the only genuine per-profile knob is the
 * charm-spell stem set (which "worn off" lines count as un-charm vs MEZ); the bulk
 * of the grammar is shared "classic" EQ. Add fields here as real divergences show
 * up rather than forking whole regex batteries.
 */
export interface ParserConfig {
  id: string
  /**
   * Optional injected spell database (Task #34). When present, the parser emits PRECISE,
   * message-driven buffApply / buffWearOff events by matching a line against the DB's
   * cast-on-you / cast-on-other / wears-off message tables. Injected at main startup via
   * installSpellDb(); ABSENT by default so parser purity holds — a profile with no DB
   * installed emits none of the new events and behaves exactly as before. This is the
   * ruleset/config injection path the buffs DB uses (never a direct module import in the
   * parser).
   */
  spellDb?: SpellDb
  /**
   * The TAILED character's name (Wave 1 of docs/plans/class-combo-inference.md). The self-`/who`
   * rule needs it because a `/who` lists every stranger in the zone in the SAME grammar as the
   * player's own row — the name is the only thing that tells them apart, and it must come from
   * the session (session.ts `resetWorldFor`), never from a constant. ABSENT by default, and the
   * rule declines every line while it is absent: with no character installed we cannot know
   * whose loadout a row states, and guessing would hand a stranger's classes to the player.
   */
  characterName?: string
  /**
   * Matches the spell name from "Your <spell> spell has worn off of <mob>." to
   * decide whether it un-charms a pet. True charm spells only — MEZ spells also
   * wear off but must NOT uncharm. Stems audited against real worn-off lines, and
   * completed against the spell DB's own charm rosters (see below).
   */
  charmSpell: RegExp
  /**
   * Matches the spell name from "Your <spell> spell has worn off of <mob>." to
   * decide whether it is a CROWD-CONTROL (mez/root) spell — as opposed to a charm
   * spell (handled by charmSpell) or an unrelated buff/debuff. A CC spell wearing
   * off means the mob was mez'd/rooted right up to that moment, so the engine treats
   * it as a keep-alive CC refresh. Stems audited against real worn-off lines:
   * Mesmerization/Mesmerize/Enthrall/Entrance/Dazzle (mez), Largo's Melodic Binding
   * & Screaming Terror (bard/enchanter mez), Ensnare/Immobilize/Suffocate (root).
   * Deliberately EXCLUDES pacify/lull/calm (aggro-reduction, not a hold) and the
   * Selo's snare line (a movement slow, not a hold).
   */
  ccSpell: RegExp
}

/**
 * CC AND CHARM ARE ROSTERS, NOT NAMES (JOS-84) — the same law shared/alertGroups.ts states for
 * slows ("a slow is the spell you REPLACE as you level, so a def pinned to one name goes silently
 * dead at the next tier"), applied to the two stem sets that decide whether a `Your <X> spell has
 * worn off of <mob>.` line is a charm break, a mez/root break, or an ordinary debuff fade.
 *
 * THE BUG THIS FIXES, in the reporter's words: "Hey, for bard the charm break doesnt work? :D".
 * Measured, not guessed. `ccSpell` covered exactly ONE bard song — Largo's Melodic Binding,
 * which a bard gets at level 20 — and NOTHING a bard casts after it. So every bard past the
 * mid-twenties held a crowd-control break that the parser filed as a plain `buffFade`: no `cc`
 * event, no `uncharm` event, and therefore neither the "Mez / root broke" group alert nor the
 * seeded charm-break alert could ever fire. The whole ladder, read out of the committed
 * spells.json by shared LANDING MESSAGE (which is what makes it evidence rather than a guess —
 * the same argument SLOW_SPELLS makes):
 *
 *   "Someone 's head nods."                          Kelin's Lucid Lullaby        Bard 15
 *   "Someone is bound in strands of solid music."    Largo's Melodic Binding      Bard 20  (was covered)
 *   "Someone 's eyes glaze over."                    Solon's Song of the Sirens   Bard 27
 *   "Someone 's eyes glaze over."                    Crission's Pixie Strike      Bard 28
 *   "Someone 's eyes glaze over."                    Solon's Bewitching Bravura   Bard 39
 *   "Target's eyes glaze over."                      Sionachie's Dreams           Bard 40
 *   "Someone is bound by strands of solid music."    Largo's Assonant Binding     Bard 51
 *
 * Largo's Assonant Binding is the tell: it is the DIRECT UPGRADE of the one song the list had,
 * one word apart, and it was missing — the level-up failure the roster law exists to prevent.
 *
 * AND THE BARD'S SONG IS A MEZ, NOT A CHARM — stated because the report calls it charm and the
 * distinction changes which alert fires. Evidence from the reporter's own slice (feedback report
 * 01KZAG2QAW885YJNRTDDND8BF2, read-only, never committed): each of their five
 * `You begin singing Solon's Bewitching Bravura IX.` lines is followed ~2 s later by
 * `a fire giant warrior's eyes glaze over.` — Bravura's own landing message per the DB — while
 * EVERY `<mob> has been charmed.` line in that slice trails another player's
 * `Aevus begins casting Allure X.` / `Heinz begins casting Allure VI.` by one second. So the
 * bard mezzes, an enchanter beside them charms, and `Your Solon's Bewitching Bravura spell has
 * worn off of a fire giant warrior.` (5 occurrences) is a MEZ break. It now routes to `cc
 * {refresh:true}` and fires the "Mez / root broke" group — the honest alert — rather than being
 * miscast as an uncharm that would retire a pet the player never had.
 *
 * THE CHARM SIDE gets the same completion, from the DB's other roster: five Necromancer
 * charm-undead spells share the landing message "Someone moans." — Dominate Undead 18, Beguile
 * Undead 31, Cajole Undead 47, Thrall of Bones 54, Enslave Death 60 — and the stems covered the
 * first three by accident (dominate / beguile / cajol) while a necro who reached 54 lost their
 * charm break. The Enchanter ladder (Charm 11, Beguile 23, Cajoling Whispers 37, Allure 46,
 * Boltran's Agacerie 53, Dictate 60) and the Druid/Shaman pair (Charm Animals, Allure of the
 * Wild) were already complete and are unchanged.
 *
 * NOTHING HERE IS INVENTED. Every added name is a spell in src/main/data/spells.json that shares
 * its landing message with a member the rosters already classified; tests/charmCcRoster.test.mts
 * re-derives both families from spells.json on every run, so a future scrape that adds a member
 * fails the suite instead of going quietly mute in somebody's ears.
 *
 * The `.` in `Kelin.s` / `Largo.s` / `Solon.s` is the same trick SLOW_SPELLS uses: EQ writes
 * possessives with both an apostrophe and a backtick, so one character class covers the pair.
 *
 * `(bewitching )?` is NOT decoration — the roster oracle found it. The committed spells.json
 * records the level-39 song as **"Solon's Bravura"** while the LOG prints **"Solon's Bewitching
 * Bravura"** (the wiki scrape lost the middle word). The parser only ever sees the log's
 * spelling, but the roster is CHECKED against the DB's, so the stem has to answer to both or the
 * oracle and the game disagree about the same song. Nothing else in the DB is named Bravura.
 */
const CHARM_STEMS =
  /\bcharm\b|beguile|allure|cajol|dictate|besiege|agacerie|beckon|command of druzzil|dominate|boltran|thrall of bones|enslave death/i
const CC_STEMS =
  /mesmeriz|enthrall|entranc|dazzle|largo.s (melodic|assonant) binding|screaming terror|ensnar|immobiliz|suffocat|kelin.s lucid lullaby|song of the sirens|pixie strike|solon.s (bewitching )?bravura|sionachie.s dreams/i

const classic: ParserConfig = {
  id: 'classic',
  charmSpell: CHARM_STEMS,
  ccSpell: CC_STEMS
}

export const PARSER_CONFIGS: Record<string, ParserConfig> = {
  eqlegends: classic,
  p99: classic // classic format; refine if P99 diverges
}

export function getParserConfig(profileId: string = DEFAULT_PROFILE): ParserConfig {
  return PARSER_CONFIGS[profileId] ?? classic
}

/**
 * Inject a spell database into a profile's parser config (Task #34), enabling the
 * message-driven buffApply / buffWearOff events. Called once at main startup after the DB
 * is loaded. Applies to ALL configs by default (they share the same message grammar); pass
 * a profileId to scope it. Idempotent — re-installing replaces the DB.
 */
export function installSpellDb(db: SpellDb | undefined, profileId?: string): void {
  if (profileId) {
    const cfg = PARSER_CONFIGS[profileId]
    if (cfg) cfg.spellDb = db
    return
  }
  for (const cfg of Object.values(PARSER_CONFIGS)) cfg.spellDb = db
  classic.spellDb = db
}

/**
 * Inject the TAILED character's name into the parser config, enabling the self-`/who` rule
 * (Wave 1 of docs/plans/class-combo-inference.md). Called from session.ts on every character
 * (re)tail, BEFORE the replay, so the very first `/who` row in the scan is attributed
 * correctly. Same injection path as installSpellDb — the parser stays pure and never reaches
 * for the session. Pass undefined to clear (no character ⇒ no self row can be identified).
 */
export function installCharacterName(name: string | undefined, profileId?: string): void {
  if (profileId) {
    const cfg = PARSER_CONFIGS[profileId]
    if (cfg) cfg.characterName = name
    return
  }
  for (const cfg of Object.values(PARSER_CONFIGS)) cfg.characterName = name
  classic.characterName = name
}
