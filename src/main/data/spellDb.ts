// Spell database load + derived lookup tables (Task #34).
//
// Loads the committed src/main/data/spells.json (scraped from the wiki's
// Template:Spellpage — see scripts/scrape-spells.ts) and builds the message→spell lookup
// tables the parser uses to emit PRECISE, message-driven buff events:
//
//   msgCastOnYou  ("A cool breeze slips through your mind.")  → buffApply { spell, self }
//   msgCastOnOther ("Someone looks tranquil." → "<Name> looks tranquil.") → buffApply { spell, target }
//   msgWearsOff   ("The cool breeze fades.")                  → buffWearOff { spell, self }
//
// The cast-on-other wiki text names the subject as "Someone" (e.g. "Someone looks
// tranquil."); the LOG names the actual target ("a froglok looks tranquil."). So the
// cast-on-other table is keyed by the SUFFIX after stripping the leading "Someone "/name,
// and the parser recovers the target from the matched prefix.
//
// AMBIGUITY: several spells share a landing/wears-off message (e.g. "You feel much faster."
// is Alacrity/Celerity/Quickness/Swift; "You feel armored." is 7 shielding spells). Rank
// variants also share their message ("A cool breeze slips through your mind." is Clarity +
// several others). So the tables map a message to ALL its candidate spells — the buffs
// module resolves an ambiguous apply against the player's own recent cast history (which of
// the candidates they actually cast). A message with a single candidate is unambiguous.
//
// This module is loaded in MAIN at startup and injected into the parser via the ruleset
// config path (installSpellDb → getParserConfig().spellDb), preserving parser purity: a
// profile with no DB installed emits none of the new events and works exactly as before.

import type { SpellCatalog, SpellCatalogEntry, SpellDbFile, SpellEntry } from '../../shared/types'
// Line/rank model + the level-keeping twin of spellClasses.ts's class parse (shared/, so the
// renderer compiles against the SAME implementation the catalog was built with).
import { parseSpellClassLevels, parseSpellRank } from '../../shared/spellLines'
// THE source of truth for which cast-on-other emotes are rogue-poison Strike procs. Imported,
// never copied: the suffix list belongs to shared/poisons.ts and a second copy would drift.
import { POISON_PROCS } from '../../shared/poisons'
// Import the committed catalog directly so it's BUNDLED into the main build (electron-vite
// inlines JSON imports). A readFileSync from a path relative to import.meta.url would look
// beside out/main/index.js in production, where the JSON isn't copied — so import it.
import spellsJson from './spells.json'

/** The derived, message-driven lookup tables the parser consumes. Each message maps to
 *  the LIST of candidate spells sharing it (length 1 when unambiguous). */
export interface SpellDb {
  /** All spells, keyed by canonical (lowercased, rank-stripped) name. */
  byKey: Map<string, SpellEntry>
  /** msgCastOnYou text → candidate spells (self landing message). */
  castOnYou: Map<string, SpellEntry[]>
  /** msgWearsOff text → candidate spells (buff-fade message). */
  wearsOff: Map<string, SpellEntry[]>
  /**
   * cast-on-other SUFFIX → candidate spells. The suffix is the wiki msg_cast_on_other with
   * a leading "Someone " (or "Someone's "/"Someone 's ") stripped — the invariant tail
   * ("looks tranquil.", "'s face contorts …") that follows whatever the log names the
   * target. Matched by testing whether a log line ENDS WITH the suffix.
   *
   * THE TABLE, NOT THE INDEX. This is the definition; `castOnOtherByLastWord` below is a
   * derived lookup over exactly these entries, in exactly this order, and the parser reads
   * only the index. Keeping the table is what lets the equivalence oracle
   * (tests/spellMessageIndex.test.mts) re-derive the linear answer from first principles
   * every time spells.json changes, instead of trusting a structure to be its own witness.
   */
  castOnOtherSuffix: Map<string, SpellEntry[]>
  /**
   * THE HOT-PATH INDEX (JOS-58): last WORD of a suffix's match tail → the entries ending with
   * it, in table order. See `indexSuffixesByLastWord` for why this is exactly equivalent to
   * walking the whole table and why it is 36× cheaper.
   */
  castOnOtherByLastWord: Map<string, SuffixEntry[]>
  /**
   * The suffixes the index CANNOT key (see `lastWordKey`). Consulted on every lookup beside the
   * bucket, so the pair is total rather than lucky. MEASURED EMPTY on today's spells.json (all
   * 648 suffixes key), which is why the hot path is one map lookup and a zero-iteration loop —
   * but the matcher does not depend on that and a future scrape cannot silently unmatch a spell.
   */
  castOnOtherUnkeyed: SuffixEntry[]
  /** The raw spell list (for stats / diagnostics). */
  spells: SpellEntry[]
}

/**
 * One cast-on-other suffix, precompiled for matching (JOS-58).
 *
 * `tail` is what a log line must END WITH — the possessive suffixes ("'s face contorts …")
 * attach straight to the target's name, the rest ("looks tranquil.") follow a space — computed
 * once at build time instead of concatenated per line per suffix. `index` is the entry's
 * position in `castOnOtherSuffix`, which is the ONLY thing that decides precedence when a line
 * ends with two different known suffixes: the pre-index matcher walked the table and took the
 * first match, so the indexed one takes the lowest index and the two can never disagree.
 */
export interface SuffixEntry {
  suffix: string
  tail: string
  index: number
  cands: SpellEntry[]
}

/** Rank tail (mirrors parser.spellCanonKey — kept local to avoid a cycle). */
const RANK_TAIL_RE = / (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i
function canonKey(name: string): string {
  return name.trim().replace(RANK_TAIL_RE, '').trim().toLowerCase()
}

/**
 * The invariant SUFFIX of a cast-on-other message: strip the leading subject token the
 * wiki uses ("Someone", possibly with a stray "'s"/" 's") so the remainder is what
 * follows the (log-named) target. Returns null when the message has no usable suffix.
 *   "Someone looks tranquil."                 → "looks tranquil."
 *   "Someone 's face contorts and stretches…" → "'s face contorts and stretches…"  (kept
 *                                                so "<Name>'s face …" still ends with it)
 */
export function castOnOtherSuffix(msg: string): string | null {
  const m = msg.trim()
  // "Someone 's ..." (wiki's spaced possessive) → keep the "'s ..." so a real "<Name>'s"
  // line still matches on the suffix. "Someone looks ..." → drop "Someone ".
  const spaced = /^Someone\s+'s\b(.*)$/i.exec(m)
  if (spaced) return ("'s" + spaced[1]).trim()
  const poss = /^Someone's\b(.*)$/i.exec(m)
  if (poss) return ("'s" + poss[1]).trim()
  const lead = /^Someone\s+(.*)$/i.exec(m)
  if (lead) return lead[1].trim()
  return null
}

/** Add a spell to a message→candidates multimap, de-duping identical names. */
function pushCandidate(map: Map<string, SpellEntry[]>, msg: string, s: SpellEntry): void {
  const list = map.get(msg)
  if (!list) {
    map.set(msg, [s])
    return
  }
  // De-dupe same-named entries (rank variants of the same base spell) so a burst apply
  // doesn't see the "same" spell N times; keep the first (canonical) occurrence.
  if (!list.some((e) => canonKey(e.name) === canonKey(s.name))) list.push(s)
}

/**
 * What a log line must END WITH for this suffix to match: possessive suffixes ("'s face
 * contorts …") attach straight to the target's name, everything else follows a space. The one
 * place this rule is written down — the matcher reads `SuffixEntry.tail`, never re-derives it.
 */
function matchTail(suffix: string): string {
  return suffix.startsWith("'s") ? suffix : ` ${suffix}`
}

/**
 * The bucket key for a suffix, or null when it has none.
 *
 * THE WHOLE ARGUMENT FOR THE INDEX (JOS-58), and it is a proof rather than a measurement, so
 * read it before touching either side. A line matches when it ends with the suffix's TAIL. If
 * that tail contains a space, then the line's own last word IS the tail's last word — the space
 * that separates them sits at the same offset from the end of both strings. So every suffix
 * whose tail contains a space can only ever be matched by a line whose last word is that same
 * word, and bucketing by it cannot lose a match: it only skips suffixes that could not have
 * matched anyway.
 *
 * A non-possessive suffix always qualifies, because its tail begins with the space we added.
 * A POSSESSIVE one qualifies only if the suffix itself contains a space ("'s face contorts and
 * stretches.") — a hypothetical "'sface." attaches with no space at all, so a line ending in
 * "Fredsface." would have last word "Fredsface." and no key could find it. Those (zero today;
 * `castOnOtherUnkeyed` is measured empty) are scanned linearly instead of being quietly dropped.
 *
 * The key is computed with `lastIndexOf(' ')`, which returns -1 for a spaceless string and
 * therefore yields the whole string — correct for a spaceless NON-possessive suffix, whose tail
 * is " " + suffix and whose last word is the suffix entire (22 of those today: "weakens.",
 * "dies." …).
 */
function lastWordKey(suffix: string): string | null {
  const space = suffix.lastIndexOf(' ')
  if (space >= 0) return suffix.slice(space + 1)
  return suffix.startsWith("'s") ? null : suffix
}

/**
 * Precompile the cast-on-other table into the last-word index the parser matches against.
 *
 * WHY (measured, JOS-58, 1,404,455 events of the owner's log): the matcher used to walk all 648
 * suffixes calling `endsWith` for every line that reached it — 284,073 lines, 20.2% of the log,
 * every line no earlier family claimed. That scan alone cost 9.2 s of an 11.5 s parse and was
 * the single largest line item in the whole startup fold (5.8 us of every event, before any
 * consumer saw anything). Bucketing by last word turns it into one hash lookup over 381 buckets
 * whose largest holds 18 entries.
 *
 * It is the SAME shape `POISON_PROC_BY_LAST_WORD` in parseCasts.ts already uses, and for the
 * same stated reason — that table just happened to be small enough that nobody noticed the big
 * one beside it had never been given the treatment.
 */
function indexSuffixesByLastWord(table: Map<string, SpellEntry[]>): {
  byLastWord: Map<string, SuffixEntry[]>
  unkeyed: SuffixEntry[]
} {
  const byLastWord = new Map<string, SuffixEntry[]>()
  const unkeyed: SuffixEntry[] = []
  let index = 0
  for (const [suffix, cands] of table) {
    const entry: SuffixEntry = { suffix, tail: matchTail(suffix), index, cands }
    index += 1
    const key = lastWordKey(suffix)
    if (key === null) {
      unkeyed.push(entry)
      continue
    }
    const bucket = byLastWord.get(key)
    if (bucket) bucket.push(entry)
    else byLastWord.set(key, [entry])
  }
  return { byLastWord, unkeyed }
}

/** Build the derived lookup tables from a spell list. Each message maps to ALL candidates
 *  sharing it; the buffs module resolves an ambiguous apply via cast history. */
export function buildSpellDb(spells: SpellEntry[]): SpellDb {
  const byKey = new Map<string, SpellEntry>()
  const castOnYou = new Map<string, SpellEntry[]>()
  const wearsOff = new Map<string, SpellEntry[]>()
  const castOnOtherSuffixMap = new Map<string, SpellEntry[]>()
  for (const s of spells) {
    const key = canonKey(s.name)
    if (!byKey.has(key)) byKey.set(key, s)
    if (s.msgCastOnYou) pushCandidate(castOnYou, s.msgCastOnYou, s)
    if (s.msgWearsOff) pushCandidate(wearsOff, s.msgWearsOff, s)
    if (s.msgCastOnOther) {
      const suf = castOnOtherSuffix(s.msgCastOnOther)
      if (suf) pushCandidate(castOnOtherSuffixMap, suf, s)
    }
  }
  const { byLastWord, unkeyed } = indexSuffixesByLastWord(castOnOtherSuffixMap)
  return {
    byKey,
    castOnYou,
    wearsOff,
    castOnOtherSuffix: castOnOtherSuffixMap,
    castOnOtherByLastWord: byLastWord,
    castOnOtherUnkeyed: unkeyed,
    spells
  }
}

/** No allocation for the overwhelmingly common "this line's last word names no spell" case. */
const NO_SUFFIXES: readonly SuffixEntry[] = []

/**
 * The first entry of `list` (which is in table order) whose tail this line really ends with.
 *
 * The two rejections are as load-bearing as the match and are why this is a LOOP rather than a
 * lookup: a line that is nothing BUT the tail has no target, and a "target" longer than 60
 * characters is a sentence that happens to end in a spell's words rather than a mob's name. In
 * both cases the pre-index matcher carried on down the table, so this one carries on down the
 * bucket.
 */
function firstSuffixMatch(
  text: string,
  list: readonly SuffixEntry[]
): { entry: SuffixEntry; target: string } | null {
  for (const entry of list) {
    const tail = entry.tail
    if (text.endsWith(tail) && text.length > tail.length) {
      const target = text.slice(0, text.length - tail.length).trim()
      if (target && target.length <= 60) return { entry, target }
    }
  }
  return null
}

/**
 * Which cast-on-other message this line is, and who it landed on — ONE HASH LOOKUP, not 648
 * `endsWith` calls (JOS-58).
 *
 * MEASURED, 1,404,455 events of the owner's log, on a quiet machine: the matcher this replaces
 * walked the whole suffix table for every line that reached it, and the comment claiming "the
 * volume is tiny" was wrong by two orders of magnitude — the caller is reached by every line NO
 * earlier family claimed, which is 284,073 lines, 20.2% of the log. The walk cost 9.2 s of an
 * 11.5 s parse and was the largest single line item in the entire startup fold: 5.8 us of every
 * event, charged inside `parseEvent` before any consumer saw anything. `castOnOtherByLastWord`
 * buckets the same entries by the last word a matching line must end with (`lastWordKey` proves
 * that is lossless), so a line now costs one `lastIndexOf` + one map lookup + at most 18
 * `endsWith` calls.
 *
 * PRECEDENCE IS UNCHANGED, and that is the whole equivalence claim: matches are still taken in
 * TABLE ORDER. Within a bucket that is simply its own order; the unkeyable entries (measured
 * zero today) are merged in by `index`, so a table that ever grows one cannot silently change
 * which spell a shared message resolves to. The old comment claimed longest-suffix-first
 * ordering — it never did that, the Map was iterated in insertion order, and
 * tests/spellMessageIndex.test.mts pins the real behaviour against a linear reference.
 *
 * The target comes back RAW; canonicalization is the parser's (`norm`), because it is the
 * parser's names that have to be dirty-tolerant, not this table's.
 */
export function matchCastOnOtherSuffix(
  text: string,
  db: SpellDb
): { entry: SuffixEntry; target: string } | null {
  const bucket = db.castOnOtherByLastWord.get(text.slice(text.lastIndexOf(' ') + 1)) ?? NO_SUFFIXES
  const keyed = firstSuffixMatch(text, bucket)
  // Total rather than lucky: a suffix the index cannot key (`lastWordKey`) is still matched, and
  // still by table order. The list is empty on today's spells.json, so this is one length check —
  // but a future scrape cannot quietly unmatch a spell.
  const unkeyed =
    db.castOnOtherUnkeyed.length > 0 ? firstSuffixMatch(text, db.castOnOtherUnkeyed) : null
  if (!unkeyed) return keyed
  return !keyed || unkeyed.entry.index < keyed.entry.index ? unkeyed : keyed
}

/**
 * Build the slim, searchable spell catalog for the suggested-alerts wizard (Task #38).
 * Derived from the effective DB (spells.json + overlay corrections already applied to `db`),
 * with per-spell live usage folded in from `usage` (the buffs module's snapshot stats `n`,
 * keyed by canonical spell key).
 *
 * A spell earns a template flag ONLY when the DB has the field the parser needs for that
 * template's event to fire — so the wizard never offers an alert that can't actually trigger:
 *   - wearsOff : Beneficial AND msgWearsOff present → buffWearOff{spell} fires.
 *   - fade     : Beneficial (any) → buffFade{spell} fires (pet/named-target fades).
 *   - lands    : Detrimental AND msgCastOnOther present → buffApply{spell} fires (cast-on-other).
 * Illusion spells additionally get the shared illusion-fade suggestion (deduped in the UI).
 * A spell with NO template and no illusion flag is dropped (nothing to suggest for it).
 */
/**
 * Every DISPLAY name the DB holds for each LINE (rank-folded key), ascending by rank.
 * `db.byKey` keeps only the FIRST entry per key, so the rank siblings ("Rune II".."Rune V")
 * are otherwise invisible to the catalog. Only 42 of the ~1.9k spells have siblings at all —
 * the log knows far more ranks than the wiki does, which is why the renderer unions this with
 * the ranks it has actually observed cast (shared/spellLines.ts).
 */
function rankNamesByLine(db: SpellDb): Map<string, string[]> {
  const byLine = new Map<string, { name: string; rank: number }[]>()
  for (const s of db.spells) {
    const key = canonKey(s.name)
    const { rank } = parseSpellRank(s.name)
    const list = byLine.get(key)
    if (list) list.push({ name: s.name, rank })
    else byLine.set(key, [{ name: s.name, rank }])
  }
  const out = new Map<string, string[]>()
  for (const [key, list] of byLine) {
    const names = [...new Set(list.sort((a, b) => a.rank - b.rank).map((r) => r.name))]
    out.set(key, names)
  }
  return out
}

/**
 * The cast-on-other emotes the PARSER routes to `poisonProc`, not to `buffApply` — verbatim
 * the `suffix` of every POISON_PROCS entry, which is verbatim the DB's own msgCastOnOther for
 * those Strikes (that is how the table was built; shared/poisons.ts says so).
 *
 * WHY THE CATALOG CARES. `templates.lands` authors a `{event, kind:'buffApply', where:{spell}}`
 * alert. For these twelve detrimental Strikes that alert CAN NEVER FIRE: the parser cascade
 * (parser.ts CLASSIFIERS) offers the line to `classifyPoisonProc` BEFORE `classifyDbBuff`, so
 * `<mob>'s limbs move slower!` becomes a poisonProc and no buffApply is ever emitted. The
 * suggestion wizard was offering a dead alert — a guessed trigger that never fires is worse
 * than an absent one (shared/alertGroups.ts's law), so the template is suppressed and the
 * "Rogue slow poisons" group covers the real event instead.
 */
const POISON_PROC_MSGS: ReadonlySet<string> = new Set(POISON_PROCS.map((p) => p.suffix))

/** Which one-click suggestion templates a spell can offer (see SpellCatalogEntry.templates). */
function suggestionTemplates(s: SpellEntry): SpellCatalogEntry['templates'] {
  const beneficial = s.spellType === 'Beneficial'
  return {
    wearsOff: beneficial && !!s.msgWearsOff,
    fade: beneficial,
    lands:
      s.spellType === 'Detrimental' &&
      !!s.msgCastOnOther &&
      !POISON_PROC_MSGS.has(s.msgCastOnOther)
  }
}

/**
 * The prejoined, lowercased SEARCH SURFACE for one line (SpellCatalogEntry.searchText):
 * display name + every rank name the DB knows + the three message texts.
 *
 * The messages are the whole point (docs/plans/suggest-dialog-redesign.md §1): they let one
 * search box answer "slow", "root", "dispel" from the game's own words instead of from an
 * invented effect taxonomy. Lowercased HERE so the renderer's per-keystroke work is a plain
 * substring test — see the field's doc comment in shared/buffTypes.ts.
 */
export function searchTextFor(s: SpellEntry, rankNames: readonly string[] | undefined): string {
  const parts = [s.name, ...(rankNames ?? []), s.msgCastOnYou, s.msgCastOnOther, s.msgWearsOff]
  return parts
    .filter((p): p is string => !!p)
    .join(' ')
    .toLowerCase()
}

export function buildSpellCatalog(
  db: SpellDb,
  usage: Map<string, number>,
  lastSeen?: Map<string, number>
): SpellCatalog {
  const entries: SpellCatalogEntry[] = []
  const rankNames = rankNamesByLine(db)
  let hasIllusions = false
  for (const [key, s] of db.byKey) {
    const templates = suggestionTemplates(s)
    if (s.illusion) hasIllusions = true
    // Nothing to suggest for a spell with no template and not an illusion — skip it.
    if (!templates.wearsOff && !templates.fade && !templates.lands && !s.illusion) continue
    entries.push({
      key,
      name: s.name,
      spellType: s.spellType,
      illusion: s.illusion,
      templates,
      usageCount: usage.get(key) ?? 0,
      lastSeenMs: lastSeen?.get(key) ?? null,
      classLevels: parseSpellClassLevels(s.classes),
      // Always present in practice (the map is built from the same spell list db.byKey is);
      // the optional field absorbs the impossible miss without a branch.
      rankNames: rankNames.get(key),
      searchText: searchTextFor(s, rankNames.get(key))
    })
  }
  // Sort (Task #45 — the user's directive: recency over frequency). USED spells (those the
  // buffs model has observed) sort first by lastSeenMs DESC (most recently seen at the top),
  // tie-breaking on usageCount DESC, then name. The never-used spells form an alphabetical
  // tail after all used ones. A used spell missing a lastSeenMs (shouldn't happen — usage
  // implies a fade) is treated as least-recent among used so it never jumps the tail.
  entries.sort((a, b) => {
    const aUsed = a.usageCount > 0
    const bUsed = b.usageCount > 0
    if (aUsed !== bUsed) return aUsed ? -1 : 1
    if (aUsed && bUsed) {
      const at = a.lastSeenMs ?? 0
      const bt = b.lastSeenMs ?? 0
      if (at !== bt) return bt - at // more recent first
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount
    }
    return a.name.localeCompare(b.name)
  })
  const withUsage = entries.reduce((n, e) => n + (e.usageCount > 0 ? 1 : 0), 0)
  return { entries, total: db.byKey.size, withUsage, hasIllusions }
}

let cached: SpellDb | null = null

/** Load + build the spell DB (cached) from the bundled spells.json. */
export function loadSpellDb(): SpellDb {
  if (cached) return cached
  const file = spellsJson as SpellDbFile
  cached = buildSpellDb(file.spells)
  return cached
}

/**
 * Apply observed-message-overlay corrections to the DB's cast-on-you table (Task #36) — the
 * EFFECTIVE DB (spells.json + overlay, overlay WINS). For each VERIFIED / CONTRADICTS-WIKI
 * landing message the overlay learned, register that exact text → the observed spell, so the
 * parser recognizes a self-landing line the wiki got wrong or omitted (e.g. Symbol of
 * Pinzarn's real "The symbol of Pinzarn flashes before your eyes.", whose wiki
 * msg_cast_on_you is inaccurate). Additive + idempotent: an existing correct mapping is left
 * alone; a contradiction REPLACES the message's candidates with the observed spell (overlay
 * wins). Unknown/shared messages contribute nothing (a shared message can't name a spell).
 */
export function applyOverlayCorrections(
  db: SpellDb,
  corrections: Map<string, { spell: string; contradicts?: string }>
): number {
  let applied = 0
  for (const [text, corr] of corrections) {
    const spell = db.byKey.get(canonKey(corr.spell))
    if (!spell) continue
    // A cast-on-YOU landing message is a BENEFICIAL-buff signal (a detrimental spell the
    // player casts lands on a MOB, not on themselves). A "correction" pointing at a
    // Detrimental spell is a mining false positive (the self line coincided with a debuff
    // cast); never let it override the DB. Skip it.
    if (spell.spellType === 'Detrimental') continue
    const existing = db.castOnYou.get(text)
    if (corr.contradicts) {
      // Wiki contradiction: the observed line really means THIS spell — override.
      db.castOnYou.set(text, [spell])
      applied++
    } else if (!existing) {
      // A verified landing message the DB didn't have — fill the gap.
      db.castOnYou.set(text, [spell])
      applied++
    } else if (!existing.some((e) => canonKey(e.name) === canonKey(spell.name))) {
      // The DB maps this text to other spells too; add ours as a candidate.
      existing.push(spell)
      applied++
    }
  }
  return applied
}
