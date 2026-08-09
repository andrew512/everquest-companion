// OUR-SIDE CORRECTIONS TO THE SCRAPED SPELL DB (JOS-150).
//
// `spells.json` is a SCRAPE. `scripts/scrape-spells.ts` re-reads the eqlwiki
// `Template:Spellpage` pages and rewrites the file wholesale, so anything hand-edited into it is
// lost the next time somebody re-scrapes — and worse, the diff of a re-scrape stops being readable
// because our fixes and the wiki's changes are mixed into the same lines. This file is the other
// half of that arrangement: the wiki dataset stays PRISTINE and IDEMPOTENT under re-scrape, and
// everything we know that the wiki does not lives here, applied at load in `spellDb.ts`.
//
// WHY IT MATTERS AT ALL. The parser recognizes a spell landing or fading by matching the exact
// sentence the DB says it prints. One wrong word is total: a 0.14.0 druid reported that Drifting
// Death never tracks, and the slice showed why — the live game prints `<target> is engulfed BY a
// swarm.` and the wiki says `Someone is engulfed IN a swarm.`, so the landing line matched nothing
// and no bar could ever exist. That is not a bug in the matcher; it is one preposition of drift
// between a fan wiki and the shipped game, and there is no amount of matcher cleverness that
// fixes it. It gets fixed by writing down what the game really prints.
//
// THE EVIDENCE BAR — the rule this file lives or dies by, and the reason `evidence` is a required
// field rather than a comment. A correction is admitted ONLY when all four hold:
//
//   1. the wiki's text occurs ZERO times in the evidence log (1,460,978 lines of the owner's
//      `eqlog_Primitive_freeport.txt`, whole-log, measured 2026-08-09);
//   2. the replacement text DOES occur there;
//   3. the two differ by a stated mechanical drift — a preposition, an inflection, terminal
//      punctuation, a scrape artifact, a missing subject placeholder — never by a content word
//      that could name a DIFFERENT spell; and
//   4. it is ATTRIBUTED, by one of exactly three routes, named per entry:
//        `cast`   the owner demonstrably cast the spell and the replacement line follows the cast
//                 (the strongest, and the one the ticket asks for: N/M casts, measured);
//        `db`     sibling entries of the same family ALREADY carry the replacement text verbatim,
//                 so the DB is its own witness and the odd one out is the typo;
//        `sole`   no DB message anywhere is closer, so no other spell can be meant.
//
// Everything that failed the bar is REPORTED, not guessed at. The large majority of "the DB says a
// sentence the log never prints" is not drift at all: a DETRIMENTAL spell you cast lands on a MOB,
// so its `msgCastOnYou` and `msgWearsOff` print to the MOB and are unobservable in your own log
// forever. Sanity Warp, Color Shift, Enthrall, Entrance, Charm, Beguile, Cajoling Whispers, Strike,
// Smite, Flame Shock, Theft of Thought, Suffocating Sphere, Wandering Mind and the lull line
// (Pacify/Soothe/Calm/Lull) are all in that state and NONE of them is corrected here. Absence of
// evidence is not evidence of drift.
//
// THE ABSENT FIELD is the fourth drift class, and it is why `from` may be `null` (JOS-159). Almost
// everything here swaps one sentence for another, but the wiki can also state NOTHING where the
// game states something: `Allure`, the enchanter charm at 46, carries a cast time and a duration
// and no messages at all, so `Someone has been charmed.` named seven spells and not the one an
// enchanter actually casts. `from: null` says "the DB states nothing for this field" and is held
// to the same bar in both directions — it applies only while the field is genuinely ABSENT, it
// reports `satisfied` once a re-scrape supplies the same text, and it reports `stale` the moment a
// re-scrape supplies a DIFFERENT one. An empty field is not a licence to invent a sentence: the
// text still has to clear rules 2, 3 and 4 like every other line in this file.
//
// IDEMPOTENCE, IN BOTH DIRECTIONS. Every correction states the text it REPLACES. If a re-scrape
// leaves the wiki text unchanged the correction applies; if the wiki is fixed upstream the entry
// is already correct and the correction reports `satisfied` and does nothing; if the wiki changes
// to some THIRD text the correction reports `stale` and `tests/spellCorrections.test.mts` fails,
// which is the whole point — a correction that has quietly stopped describing anything is worse
// than no correction, because it looks like coverage.

import type { SpellEntry } from '../../shared/types'

/** The three message fields a correction can patch. */
export type SpellMessageField = 'msgCastOnYou' | 'msgCastOnOther' | 'msgWearsOff'

/** How a correction earned its place — see THE EVIDENCE BAR above. */
export type CorrectionAttribution = 'cast' | 'db' | 'sole'

export interface SpellCorrection {
  /** Exact `SpellEntry.name`s this applies to. A name absent from the DB fails the audit test. */
  spells: readonly string[]
  field: SpellMessageField
  /**
   * The wiki text being replaced, or `null` when the DB states NOTHING for this field. The
   * correction is a no-op unless the entry still says exactly this (or, for `null`, still says
   * nothing at all) — see THE ABSENT FIELD above.
   */
  from: string | null
  /** What the live game prints, verbatim. */
  to: string
  attribution: CorrectionAttribution
  /** The measurement, in one line: what was counted, where, and how much of it there was. */
  evidence: string
}

/**
 * THE COMMITTED OVERLAY. Ordered by the drift it fixes, not by spell name, because the drifts come
 * in families and a reader checking one is checking all of them.
 *
 * All counts below are whole-log over the owner's `eqlog_Primitive_freeport.txt` (1,460,978 lines,
 * measured 2026-08-09). "N/M casts" means N of the M `You begin casting <Spell>.` lines in that log
 * are followed by the replacement shape within 12 s.
 */
export const SPELL_CORRECTIONS: readonly SpellCorrection[] = [
  // --- the reported defect, and its family: `in a swarm` -> `by a swarm` -------------------------
  {
    spells: ['Creeping Crud', 'Drifting Death', 'Drones of Doom', 'Stinging Swarm'],
    field: 'msgCastOnOther',
    from: 'Someone is engulfed in a swarm.',
    to: 'Someone is engulfed by a swarm.',
    attribution: 'sole',
    evidence:
      'Reported by a 0.14.0 druid and slice-proven for Drifting Death itself. Owner log: 12 lines of `<T> is engulfed by a swarm.` with no DB owner, 0 of the wiki form. The other three are the same druid DoT ladder (Stinging Swarm 10 → Creeping Crud 24 → Drones of Doom 32 → Drifting Death 40) sharing ONE wiki sentence, so whatever that sentence is it is the same for all four; Winged Death 53 writes a different one and is untouched.'
  },
  // --- the same preposition, three more families ------------------------------------------------
  // ONE spell, contradicting ITSELF, is the only darkness entry that earns a correction.
  //
  // The whole family (Cascading 47, Dooming 27/44, Engulfing 11/20) writes `in darkness` for the
  // third-person landing, and the owner's log has 123 lines of `by` and 0 of `in`. That looks like
  // a family-wide drift and it is NOT SAFE to treat it as one: the bard root pair below proved
  // that this game really does change the preposition between ranks of one line, so a zero count
  // may only mean nobody in this log ever cast the OTHER rank. What separates Engulfing Darkness
  // is that its own `msgCastOnYou` already says `by` — the wiki disagrees with itself inside a
  // single entry, and 78 first-person `by` lines say which half is right. Cascading and Dooming
  // say `in` in BOTH fields and are left alone; see the unverifiable list in the ticket.
  {
    spells: ['Engulfing Darkness'],
    field: 'msgCastOnOther',
    from: 'Someone is engulfed in darkness.',
    to: 'Someone is engulfed by darkness.',
    attribution: 'db',
    evidence:
      'Owner log: 123 lines of `<T> is engulfed by darkness.` with no DB owner, 0 of the wiki form, and 78 first-person `You are engulfed by darkness.` matching this same entry`s own msgCastOnYou.'
  },
  // NOT CORRECTED, and the reason is worth keeping: Largo's Melodic Binding (bard 20) says `bound
  // IN strands of solid music.` while its direct upgrade Largo's Assonant Binding (bard 51) says
  // `bound BY`. The owner's log has 4,148 of `by` and 0 of `in` — and that is NOT drift, it is a
  // level-20 song nobody in this log ever sang. JOS-84 already treats the two as separate families
  // (tests/charmCcRoster.test.mts CC_FAMILIES) and merging them would delete a real distinction.
  // The same doubt covers Selo's Chords of Cessation (`in chords` in the wiki, 7 log lines of `by
  // chords` with no DB owner): the shape is real, the SPELL is not established, so it waits for a
  // bard's log rather than being guessed. This is the awaiting-sample law, applied against a
  // correction that would otherwise have looked obvious.
  {
    spells: ['Resist Magic', 'Resistance to Magic'],
    field: 'msgCastOnYou',
    from: 'You feel resistant from magic.',
    to: 'You feel resistant to magic.',
    attribution: 'cast',
    evidence:
      'Resist Magic 2/4 casts (+3 s each); owner log 2 lines of the `to` form, 0 of the `from` form. The other two casts produced no landing at all.'
  },
  // --- the root line: the wiki names the feet, the game names the target ------------------------
  {
    spells: ['Fetter', 'Instill', 'Paralyzing Earth', 'Root'],
    field: 'msgCastOnOther',
    from: "Someone 's feet adhere to the ground.",
    to: 'Someone adheres to the ground.',
    attribution: 'cast',
    evidence:
      'Root 1/1 cast (+2 s). Owner log: 493 lines of `<T> adheres to the ground.` with NO DB owner at all, 0 of the wiki form. The cast-on-YOU half (`Your feet adhere to the ground.`, 798 lines) is correct and untouched.'
  },
  {
    spells: ['Immobilize'],
    field: 'msgCastOnOther',
    from: "Someone's feet adhere to the ground.",
    to: 'Someone adheres to the ground.',
    attribution: 'cast',
    evidence:
      'Immobilize 14/14 casts (0-8 s). Same 493 lines as the entry above; Immobilize spells the possessive without the wiki space, hence the separate `from`.'
  },
  // --- the subject placeholder the scrape lost: no `Someone`, so NO suffix and no event ----------
  //
  // `castOnOtherSuffix()` keys the table by what follows the wiki's "Someone " subject. A message
  // written with any OTHER subject ("Target", "Player", "Soandso") or with none at all yields NO
  // suffix, so the spell is absent from the matcher entirely — JOS-103 measured 68 spells in that
  // state. These are the ones the owner's log can prove, and note what the fix IS: the sentence is
  // the wiki's own, unchanged; only the subject token is restored.
  {
    spells: ["Garrison's Mighty Mana Shock"],
    field: 'msgCastOnOther',
    from: "Target's skin blisters as it is consumed by pure mana.",
    to: "Someone's skin blisters as it is consumed by pure mana.",
    attribution: 'cast',
    evidence: '347/352 casts (0-2 s); owner log 341 lines of the shape, which had no DB owner.'
  },
  {
    spells: ['Cease', 'Desist', 'Sacred Word'],
    field: 'msgCastOnOther',
    from: 'is struck by a sudden force.',
    to: 'Someone is struck by a sudden force.',
    attribution: 'cast',
    evidence:
      'Cease 122/142 casts, Desist 103/120. The suffix already exists (Force, Markar`s Clash/Discord, Monkey Stun, Stun Command, Tishan`s) and matches 597 lines; these three were simply missing from it.'
  },
  {
    spells: ['Cancelling of Life', 'Cessation of Life', 'Negation of Life'],
    field: 'msgCastOnOther',
    from: 'is shrouded by anti-life magic.',
    to: 'Someone is shrouded by anti-life magic.',
    attribution: 'cast',
    evidence: 'Negation of Life 68/83 casts; owner log 239 lines of the shape, which had no DB owner.'
  },
  {
    spells: ['Force Snap'],
    field: 'msgCastOnOther',
    from: 'Target has been force struck.',
    to: 'Someone has been force struck.',
    attribution: 'cast',
    evidence: '6/8 casts (1-2 s); owner log 8 lines of `<T> has been force struck.`, which had no DB owner.'
  },
  {
    spells: ['Thunder of Karana'],
    field: 'msgCastOnOther',
    from: "'s ears fill with the deafening roar of Karana's Thunder.",
    to: "Someone's ears fill with the deafening roar of Karana's Thunder.",
    attribution: 'cast',
    evidence: '3/7 casts (+3 s each); owner log 3 lines of the shape, which had no DB owner.'
  },
  {
    spells: ['Intellectual Advancement'],
    field: 'msgCastOnOther',
    from: "Someone' mind sharpens.",
    to: "Someone's mind sharpens.",
    attribution: 'cast',
    evidence:
      '1/3 casts (+4 s); owner log 31 lines of `<T>`s mind sharpens.`, 0 of the apostrophe-only form. The scrape dropped the possessive s.'
  },
  {
    spells: ['Ethereal Cleansing'],
    field: 'msgCastOnOther',
    from: "'s body is covered in ethereal light.",
    to: "Someone's body is covered in ethereal light.",
    attribution: 'sole',
    evidence:
      'Owner log: 2 lines of `<T>`s body is covered in ethereal light.` with no DB owner. Subject restoration only; the sentence is the wiki`s own and no other spell claims it.'
  },
  {
    spells: ['Instrument of Nife'],
    field: 'msgCastOnOther',
    from: "'s weapon becomes an instrument of Rodcet Nife.",
    to: "Someone's weapon becomes an instrument of Rodcet Nife.",
    attribution: 'sole',
    evidence: 'Owner log: 8 lines of the shape, no DB owner. Subject restoration only.'
  },
  {
    spells: ['Valor of Marr'],
    field: 'msgCastOnOther',
    from: 'feels the blessing of Mithaniel Marr.',
    to: 'Someone feels the blessing of Mithaniel Marr.',
    attribution: 'sole',
    evidence: 'Owner log: 5 lines of the shape, no DB owner. Subject restoration only.'
  },
  {
    spells: ['Divine Vigor'],
    field: 'msgCastOnOther',
    from: 'begins to radiate with divine favor.',
    to: 'Someone begins to radiate with divine favor.',
    attribution: 'sole',
    evidence: 'Owner log: 39 lines of the shape, no DB owner. Subject restoration only.'
  },
  {
    spells: [
      'Cazic Temple Gate', 'Greater Faydark Gate', 'Nektulos Gate', 'North Karana Gate',
      'North Ro Gate', 'Ring of Misty Thicket', 'Ring of South Ro', 'Ring of Stonebrunt',
      'Ring of West Commons', 'Stonebrunt Gate', 'Toxxulia Gate', 'West Commons Gate',
      'West Karana Gate', 'Zephyr: Butcherblock', 'Zephyr: Feerrott', 'Zephyr: Lavastorm',
      'Zephyr: Misty Thicket', 'Zephyr: North Karana', 'Zephyr: South Ro', 'Zephyr: Steamfont',
      'Zephyr: Stonebrunt', 'Zephyr: Surefall Glade', 'Zephyr: Toxxulia', 'Zephyr: West Commons'
    ],
    field: 'msgCastOnOther',
    from: 'Player fades away.',
    to: 'Someone fades away.',
    attribution: 'db',
    evidence:
      'Twenty-odd sibling gates (Abscond, Gate, Common Gate, Fay Gate, Frost Port, …) already say `Someone fades away.` verbatim, so the suffix already exists and matches 155 owner-log lines; these 24 use the wiki`s other placeholder and were absent from it. Purely additive: no new suffix is created.'
  },
  // --- scrape artifacts: HTML, wiki navigation and stray editorial marks in the message ----------
  {
    spells: ['Invisibility Versus Undead'],
    field: 'msgWearsOff',
    from: 'Your skin stops tingling. <!--',
    to: 'Your skin stops tingling.',
    attribution: 'cast',
    evidence:
      '26/27 casts fade to the clean sentence. The scrape swallowed the start of an HTML comment; four sibling entries (Invisibility to Undead, Improved Invis vs Undead, Sunskin, …) carry the clean text.'
  },
  {
    spells: ['Instill'],
    field: 'msgWearsOff',
    from: 'Your feet come free. Cleric Spell Vendors Enchanter Spell Vendors Necromancer Spell Vendors Paladin Spell Vendors Shaman Spell Vendors Wizard Spell Vendors',
    to: 'Your feet come free.',
    attribution: 'db',
    evidence:
      'The wiki page`s vendor navigation bled into the field. Ten sibling roots (Root, Fetter, Immobilize, Paralyzing Earth, Bonds of Force, …) carry the clean text, which matches 869 owner-log lines.'
  },
  {
    spells: ['Poison'],
    field: 'msgCastOnYou',
    from: 'You have been poisoned. (?)',
    to: 'You have been poisoned.',
    attribution: 'db',
    evidence:
      'An editorial `(?)` from the wiki page. Eighteen sibling poisons carry the clean text, which matches 447 owner-log lines.'
  },
  {
    spells: ['Poison'],
    field: 'msgWearsOff',
    from: 'The poison has run its course. (?)',
    to: 'The poison has run its course.',
    attribution: 'db',
    evidence: 'Same `(?)`; 48 sibling poisons carry the clean text, which matches 168 owner-log lines.'
  },
  {
    spells: ["Ikatiar's Revenge"],
    field: 'msgCastOnOther',
    from: 'Someone has been poison.',
    to: 'Someone has been poisoned.',
    attribution: 'db',
    evidence:
      'The scrape truncated the participle. Forty-seven sibling poisons carry the full suffix, which matches 952 owner-log lines.'
  },
  {
    spells: ['Frost Shards'],
    field: 'msgCastOnYou',
    from: 'You feel your skin freeze',
    to: 'You feel your skin freeze.',
    attribution: 'db',
    evidence:
      'Terminal period lost by the scrape. Four siblings (Ice Comet, Silver Breath, …) carry the full stop, which matches 376 owner-log lines.'
  },
  {
    spells: ['Shock of Frost'],
    field: 'msgCastOnYou',
    from: 'Your feel your skin freeze.',
    to: 'You feel your skin freeze.',
    attribution: 'db',
    evidence: 'A `Your`/`You` typo on the wiki page; the same four siblings carry the correct sentence.'
  },
  // --- inflection and spelling drift between the wiki text and the shipped string ----------------
  {
    spells: ['Lifedraw', 'SpectreLifetap'],
    field: 'msgCastOnYou',
    from: 'You feel your lifeforce drain away.',
    to: 'You feel your life force drain away.',
    attribution: 'db',
    evidence:
      'Seventeen sibling lifetaps (Lifetap, Lifespike, Siphon Life, Drain Soul, …) spell it as two words, which matches 1,639 owner-log lines; the one-word form occurs 0 times.'
  },
  {
    spells: ['Rune II', 'Rune III', 'Rune IV', 'Rune V'],
    field: 'msgWearsOff',
    from: 'The shimmer of runes fade.',
    to: 'The shimmer of runes fades.',
    attribution: 'db',
    evidence: 'Rune I carries the inflected verb, which matches 19 owner-log lines; the bare form occurs 0 times.'
  },
  {
    spells: ['Rune IV', 'Rune V'],
    field: 'msgCastOnYou',
    from: 'A coat of shimmering runes surround you.',
    to: 'A coat of shimmering runes surrounds you.',
    attribution: 'sole',
    evidence:
      'Owner log: 19 lines of the inflected sentence with no DB owner at all, 0 of the wiki form; it pairs one-for-one with the 19 fades above.'
  },
  {
    spells: ['Guardian Rhythms'],
    field: 'msgCastOnYou',
    from: 'You feel an aura of mystic protection surround you.',
    to: 'You feel an aura of mystic protection surrounding you.',
    attribution: 'sole',
    evidence: 'Owner log: 264 lines of the participle form with no DB owner, 0 of the wiki form.'
  },
  {
    spells: ['Reckoning'],
    field: 'msgCastOnYou',
    from: 'You have been struck down by the judgement of the gods.',
    to: 'You have been struck down by the judgment of the gods.',
    attribution: 'sole',
    evidence:
      'British spelling on the wiki, American in the game: 14 owner-log lines of `judgment`, 0 of `judgement`, and Reckoning is the only spell with the sentence.'
  },
  {
    spells: ['Torbas Poison Blast'],
    field: 'msgCastOnYou',
    from: 'A blast of poison eats at your skin.',
    to: 'A blast of Poison eats at your skin.',
    attribution: 'sole',
    evidence:
      'The game capitalizes the damage type: 3 owner-log lines of `A blast of Poison`, 0 of the lowercase form, no DB owner. Matching is case-sensitive, so the case IS the defect.'
  },
  {
    spells: ['Scarab Storm'],
    field: 'msgCastOnOther',
    from: 'Someone shrieks as scarabs burrow into their skin.',
    to: 'Someone shrieks as a scarab burrows into their skin.',
    attribution: 'sole',
    evidence: 'Owner log: 5 lines of the singular form with no DB owner, 0 of the wiki plural.'
  },
  {
    spells: ['Scarab Storm'],
    field: 'msgWearsOff',
    from: 'The scarabs die.',
    to: 'The scarab dies.',
    attribution: 'sole',
    evidence: 'Owner log: 2 lines of the singular form with no DB owner, 0 of the wiki plural; the same drift as its landing.'
  },
  // --- the stun family: the wiki writes the sentence the game does not print ---------------------
  {
    spells: ['Divine Wrath', 'Sound of Force', 'Stun'],
    field: 'msgCastOnYou',
    from: 'You are stunned.',
    to: 'You are stunned!',
    attribution: 'sole',
    evidence:
      'Owner log: 1,208 lines of `You are stunned!` with no DB owner, 0 of the period form, against 1,214 of the wear-off `You are no longer stunned.` these same spells already match. The pair is the evidence: the fade half was matching and the landing half was not.'
  },
  {
    spells: ['Stun'],
    field: 'msgCastOnOther',
    from: 'Someone is stunned.',
    to: 'Someone is struck by a sudden force.',
    attribution: 'cast',
    evidence:
      '15/20 casts (0-2 s), and NONE of the 20 had another stun-family cast of ours in the prior 20 s, so it is not the neighbouring Cease/Desist. `<T> is stunned.` occurs 0 times whole-log. Left alone for Holy Might and Sound of Force, which share the wiki text and which the log cannot separate.'
  },
  // --- the symbol line: the wiki writes one generic sentence, the game names the symbol ----------
  //
  // `messageOverlay.baseline.json` already LEARNED the Pinzarn form from the log (spellDb.ts
  // `applyOverlayCorrections`); that path is per-user, mined and revocable. These two are the same
  // fact stated once, for everybody, at the source. The other three spells sharing the wiki
  // sentence (Naltron`s Mark, Symbol of Marzin, Symbol of Naltron) are NOT corrected: the log has
  // never printed their landings, and inventing `The symbol of Marzin …` is exactly the guess this
  // file refuses.
  {
    spells: ['Symbol of Transal'],
    field: 'msgCastOnYou',
    from: 'A mystic symbol flashes before your eyes.',
    to: 'The symbol of Transal flashes before your eyes.',
    attribution: 'cast',
    evidence: '12/16 casts (3-10 s); owner log 22 lines of the sentence, 0 of the wiki form.'
  },
  {
    spells: ['Symbol of Pinzarn'],
    field: 'msgCastOnYou',
    from: 'A mystic symbol flashes before your eyes.',
    to: 'The symbol of Pinzarn flashes before your eyes.',
    attribution: 'cast',
    evidence: '1/3 casts; owner log 50 lines of the sentence, 0 of the wiki form.'
  },
  // --- the absent field: the wiki states nothing, so the sentence had one owner too few ---------
  //
  // THE GAP THE OWNER LIVED IN (JOS-159). `<mob> has been charmed.` is the enchanter charm
  // ladder's landing line, and the DB gave it seven owners with Allure not among them — so
  // JOS-140's charm countdown, which opens a hold only for the candidate whose own cast is
  // anchored, had NOTHING to narrow to for the one charm this enchanter actually casts. Not a
  // wrong word this time: the entry carries a cast time and a 16-minute duration and all three
  // message fields are simply empty.
  //
  // THE LOG CASTS IT BY RANK and the DB knows only the base line, which is fine and is exactly
  // what `spellCanonKey` folding is for: `You begin casting Allure VI.` and the candidate `Allure`
  // meet at the key `allure`, so the anchor matches and the row still prints the ranked name the
  // cast line carried. The BREAK half already worked — `Your Allure spell has worn off of <mob>.`
  // names the spell and `CHARM_STEMS` has always matched it (161 such lines in the owner's log).
  // The landing half was the only one missing, and it was missing because the field is EMPTY.
  //
  // ONLY `msgCastOnOther` IS SUPPLIED, and the other two stay empty on purpose. A charm is
  // detrimental and lands on a MOB, so `You have been charmed.` and `You are no longer charmed.`
  // print to the mob: both occur 0 times. That is the unobservable-detrimental case the header
  // names, and a DB sibling is not a licence to copy text this log can never witness into fields
  // nothing reads.
  //
  // THE COUNTS BELOW ARE THE SAME LOG, ONE SESSION LONGER: 1,473,035 lines against the header's
  // 1,460,978, because the owner kept playing on 2026-08-09 while this was being measured. Same
  // file, same whole-log method.
  {
    spells: ['Allure'],
    field: 'msgCastOnOther',
    from: null,
    to: 'Someone has been charmed.',
    attribution: 'cast',
    evidence:
      'Allure VI 108/111 casts, Allure IV 59/65, Allure III 48/51 (215/227, 1-12 s, p50 4 s). 201 of the log`s 423 `<T> has been charmed.` lines have an Allure rank as their nearest preceding own cast, against 95 Charm, 59 Cajoling Whispers and 53 Beguile; 161 `Your Allure spell has worn off of <T>.` lines close the same lifecycle. The five ladder siblings (Charm 11, Beguile 23, Cajoling Whispers 37, Boltran`s Agacerie 53, Dictate 60) already carry this exact sentence, and Allure is the ONLY enchanter detrimental in the DB with no cast-on-other message at all.'
  }
]

/** What one pass of the overlay did, for the startup line and for the audit test. */
export interface CorrectionsReport {
  /** Entries whose `from` was found and replaced, counted per (correction, spell) pair. */
  applied: number
  /** Entries whose spell already said `to` — a re-scrape fixed it upstream and we can drop it. */
  satisfied: number
  /**
   * Entries whose spell said NEITHER `from` nor `to`. The wiki moved under us and the correction
   * now describes nothing; `tests/spellCorrections.test.mts` fails on a non-empty list.
   */
  stale: { spell: string; field: SpellMessageField; found: string | undefined }[]
  /** Correction entries naming a spell the DB does not have (a rename, or a typo here). */
  unknownSpells: string[]
}

/**
 * Apply the overlay to a spell list, returning a NEW list.
 *
 * NON-MUTATING ON PURPOSE. The list comes from an ES-imported JSON module, which is a single shared
 * object for the whole process — mutating it would make `loadSpellDb()` non-idempotent and would
 * leak into every test that imports `spells.json` directly (`tests/buffUnifiedModel.test.mts` reads
 * it for the spellType oracle). Only the entries that actually change are copied.
 *
 * TWO CORRECTIONS MAY SHARE A `from` AND DIFFER IN `to` — Symbol of Transal and Symbol of Pinzarn
 * both replace the same generic mystic-symbol sentence with their own spell's name. That works
 * because a correction names SPELLS, not messages: each is matched against the CURRENT text of the
 * entry it names, so the two never see each other. A pair that named the same spell AND field would
 * be a contradiction, and `tests/spellCorrections.test.mts` refuses it rather than letting order
 * decide.
 */
export function applySpellCorrections(
  spells: readonly SpellEntry[],
  corrections: readonly SpellCorrection[] = SPELL_CORRECTIONS
): { spells: SpellEntry[]; report: CorrectionsReport } {
  const out = spells.map((s) => s)
  const byName = new Map<string, number>()
  spells.forEach((s, i) => {
    if (!byName.has(s.name)) byName.set(s.name, i)
  })
  const report: CorrectionsReport = { applied: 0, satisfied: 0, stale: [], unknownSpells: [] }
  for (const c of corrections) {
    for (const name of c.spells) {
      const at = byName.get(name)
      if (at === undefined) {
        report.unknownSpells.push(name)
        continue
      }
      const current = out[at][c.field]
      if (current === c.to) {
        report.satisfied++
        continue
      }
      // `from: null` describes an ABSENT field, so its match test is "the DB still says nothing"
      // rather than a string compare. Everything downstream is unchanged: a re-scrape that fills
      // the field with our text reports satisfied above, and one that fills it with anything else
      // falls through to stale exactly as a moved sentence does.
      const describes = c.from === null ? current === undefined : current === c.from
      if (!describes) {
        report.stale.push({ spell: name, field: c.field, found: current })
        continue
      }
      out[at] = { ...out[at], [c.field]: c.to }
      report.applied++
    }
  }
  return { spells: out, report }
}
