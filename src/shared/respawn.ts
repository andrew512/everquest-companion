// RESPAWN CLOCKS — the vocabulary shared by the main-process module, the Timers view and the
// Timers overlay (JOS-194). Pure: no Electron, no node, no React. Unit-tested by
// tests/respawnTimers.test.mts.
//
// WHAT THE FEATURE IS. A mob dies, the log prints a sentence saying so, and this app starts a
// clock. The owner's direction was explicit about where the number on that clock comes from:
// "the wiki is a bad primary source — build CUSTOM TIMERS TRIGGERED ON DEATH MESSAGES, with the
// wiki respawn value as a floor/default only." So the estimate is a three-rung ladder and the
// rungs are ranked by how much the app actually knows:
//
//   1. YOUR NUMBER      — you typed it. Nothing outranks a user who camped the spot.
//   2. YOUR KILLS       — the shortest gap between two deaths of this mob that you were present
//                         for, floored by the wiki (below).
//   3. THE WIKI         — the default before rung 2 has any evidence, and the floor under it.
//
// WHAT A DEATH→DEATH GAP ACTUALLY PROVES, stated honestly because the UI states it too. You
// cannot kill a mob before it spawns, so every gap you observe is `respawn + however long you
// took to find and re-kill it`. A gap is therefore an UPPER BOUND on the respawn, never a
// measurement of it, and the tightest bound your kills can produce is the SMALLEST gap. That is
// why rung 2 is a minimum and not a mean or a median: the minimum converges downward onto the
// truth as you camp, where an average would sit permanently above it and drift with how
// distracted you were. Every surface that prints rung 2 prints it as "≤", with the sample count
// beside it.
//
// WHY ONLY GAPS YOU WERE PRESENT FOR (`sameStay`). An upper bound is only useful if it is tight,
// and a gap spanning "I killed it Tuesday and came back Friday" is a true bound of three days
// that tells nobody anything. The log states exactly the thing that separates the two cases —
// the zone lines — so a gap counts as a sample only when BOTH deaths fall inside one continuous
// stay in the zone. A camped respawn produces samples; a return visit produces none. No timeout,
// no heuristic: it is the same "evidence, not a clock" rule the offline-gap work landed on.
//
// WHY THE WIKI IS A FLOOR AND NOT A TIEBREAK. Two different spawns can print the SAME NAME — a
// placeholder camp with two spawn points, or plain trash like `a froglok guk shaman` standing in
// pairs — and when they die minutes apart your minimum gap collapses to something far below the
// real cycle. That is the one failure mode rung 2 has, and the wiki number is the cheap guard
// against it: the estimate is never allowed below what the wiki states. It is not consulted for
// anything else, and where the wiki says nothing (85% of the mobs in the dungeons this ticket
// targets — see respawnWiki.ts for the measurement) rung 2 stands alone.
//
// WHAT THE APP NEVER DOES. It never claims the mob IS up: it says the clock ran out. A spawn
// this app did not see cannot be reported, a placeholder cycle can put the trash mob there
// instead, and none of that is in the log. `due` means "the estimate elapsed" and every label
// says so (world-model law 1, and law 6's "say what the log cannot say").
//
// TRACKING IS OPT-IN, PER MOB (owner ruling, 2026-08-10, prototype round 1). There is no rule
// that clocks a mob you did not ask about — not even "anything the wiki states a duration for",
// which is what the first prototype shipped and what the owner threw out after using it. The
// argument is the game's, not the UI's: EQ names are massively DUPLICATED (`a froglok guk
// shaman` is dozens of unrelated spawn points across four zones, and a name that means one mob
// in Befallen means trash in Guk), so a clock the player did not choose is a clock about a mob
// the app cannot identify. Clocking everything the wiki knows therefore produces confident
// countdowns for things nobody is camping. So: the Recently-killed panel is the DISCOVERY
// surface — it lists what has died, which costs nothing and claims nothing — and a clock exists
// only once the player clicks Watch or types a number. The wiki keeps both of its remaining
// jobs (the default estimate for a watched mob you have no gap for yet, and the floor under the
// gaps you do have); what it lost is the power to ADMIT a mob on its own.
//
// THE DISPLAY IS ZONE-SCOPED, THE DATA IS NOT (owner ruling, same round). The fold keeps every
// (zone, mob) it has seen — walking away from Guk must not throw away what Guk taught — but a
// respawn clock is only actionable where you are standing, and the overlay showing a mob due in
// a zone three loading screens away is noise on top of the game. So the surfaces FILTER by the
// zone the fold is currently in (`RespawnSnap.zone`, which is the module's own zone-stay state —
// the same field that decides whether a gap counts, never a second tracker): the floating window
// shows that zone and nothing else, and the Timers tab defaults to it with an explicit all-zones
// view for editing. `respawnInZone` below is the ONE comparison both surfaces call.
//
// ─────────────────────────────────────────────────────────────────────────────
// SEEN: THE LOG NAMED IT, SO THE ROW SAYS SO (owner ruling, 2026-08-10, prototype round 3)
// ─────────────────────────────────────────────────────────────────────────────
//
// The defect that produced this ruling is the sharpest one the feature has had. The owner was
// killing a watched mob that had spawned on time; he arrived late; the mob was ACTIVELY HITTING
// HIM — and the row read "due 4m ago". The countdown was not wrong about the estimate, it was
// wrong about the QUESTION: once the log is printing the mob's name, "when do I expect it" has
// been answered by the world, and the app was still reciting its guess.
//
// So a row now carries `seenTs` — the last instant the parse cascade produced an event NAMING
// this mob while the fold was in this row's zone — and a reading whose `seenTs` is newer than the
// clock's base reads UP rather than due. Nothing about the estimate changes; the row simply stops
// pretending the estimate is the best thing it knows.
//
// WHAT MARKS SEEN, and what does not (the coverage statement, kept here because the UI's honesty
// depends on it). The module subscribes to TYPED EVENTS, never to raw text — the parser is the
// only thing in this app that reads sentences, and a second regex sweep over `ev.raw` would be a
// second opinion that drifts (the `DamageEventE.verb` argument). The families that name an entity
// and therefore mark it seen are, by the shape of the name they carry:
//
//   combat   `damage` (attacker/target), `miss` (attacker/target), `heal` (healer/target),
//            `mitigation` is NOT included — it names a source only for the absorb shapes, which
//            the miss family already covers.
//   consider `consider` (mob) — sizing something up is the purest sighting the log has.
//   holds    `cc`, `ccWake`, `charm`, `uncharm` (mob) — a mez/root/charm landing or breaking.
//   spells   `resist` (caster/target), `otherCastBegin` (caster), `buffApply` (target),
//            `poisonProc` (target).
//
// AND WHAT CANNOT MARK IT, stated rather than glossed:
//   * A MOB STANDING THERE PRINTS NOTHING. EQ logs interactions, not presence, so a spawn nobody
//     touches and nobody cons is invisible to this app forever. `seen` is "the log mentioned it",
//     never "it is up"; the absence of `seen` is not evidence of anything at all.
//   * MOB SPEECH IS GONE BY DESIGN. Growls and emotes are quoted speech and the scrub drops them
//     (AGENTS.md), and nothing parses them, so a mob that only talks is not seen.
//   * A CORPSE IS NOT A SIGHTING. `loot`'s `source` names a corpse and `death`'s `name` names the
//     thing that just stopped existing; neither marks seen, or every kill would flip its own row
//     up at the instant it went down.
//   * `spellEmote` IS DELIBERATELY OUT. It is documented as a PERMISSIVE candidate stream full of
//     unrelated flavor whose `subject` the buffs module only trusts after repetition; admitting it
//     here would flip rows up on hunger messages.
//   * THE NAME IS STILL JUST A NAME. Two spawns of `a froglok guk shaman` are one key to this app
//     (law 13's whole argument), so a sighting of the OTHER one marks this row seen. That is the
//     same limit the clock itself has and the UI does not pretend otherwise.
//   * THE SIGHTING MUST BE IN THIS ROW'S ZONE. Rows are keyed `(zone, mob)` and only the entry for
//     the zone the fold is standing in can be marked, so a Guk sighting never lights a Befallen row.
//
// A SIGHTING NEVER AUTO-ADJUSTS THE SCHEDULE (the second half of the same ruling, and the more
// important half). Seeing a mob proves it is UP; it says nothing whatever about WHEN it spawned —
// it could have been standing there for an hour before anyone swung at it. So the clock's base is
// still the death message and only the death message, exactly as before. What the user gets is an
// explicit affordance on a seen row — "start the clock from this sighting" — which moves the base
// to that sighting instant and marks the row `basis: 'sighting'` so every surface can say the
// number came from a judgement the user made rather than a line the game printed. It exists
// because YOUR kill is not the only way a cycle restarts: a group-mate's kill is filtered out by
// `isCountedKill`, and a mob you never re-killed leaves the clock frozen on a stale death. A death
// message afterwards takes the base straight back (`baseTs` is whichever is later), so the normal
// death-driven cycle resumes on the next kill with nothing to undo.
//
// THE CONFIRMATION IS SESSION STATE, not a preference: it lives in the fold beside the deaths it
// competes with, and a relaunch re-derives the fold from the log — which has never heard of it.
// Persisting a judgement about one spawn of one mob would outlive the spawn it was about.
//
// ─────────────────────────────────────────────────────────────────────────────
// UNWATCH LIVES ON THE MOB, WHEREVER YOU MEET IT (owner ruling, 2026-08-10, prototype round 4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Watching was already a per-mob act — you meet a mob in the Recently-killed panel and click Watch
// beside it. STOPPING was not: the only way out was to find the name again in the global watch
// list at the bottom of the tab and delete it there. So the two halves of one decision lived in
// two different places, and the half you reach for while a clock is wrong in front of you (over
// the game, mid-camp, the mob a duplicate name the app cannot tell apart) was the one that made
// you go looking. The ruling makes them symmetric: wherever a surface names a watched mob, that
// mob carries its own way out — its clock row in the Timers tab, its clock row in an INTERACTIVE
// floating window, and its Recently-killed entry, where Watch and Unwatch are now the same
// control in the same place saying the opposite thing.
//
// A WATCH IS A NAME, SO UNWATCH IS A NAME TOO. The list is keyed by the canonical mob name and a
// watch deliberately follows that name into every zone you kill it in, so removing it from any
// surface removes it everywhere — including a clock for the same name running in a zone you are
// not standing in. Round 4 put that sentence on the control's tooltip; the owner deleted the
// tooltip in round 7 (the control speaks for itself), so it is argued HERE and pinned by
// tests/respawnUnwatch.test.mts instead of recited on screen — which is the same bargain round 5
// struck with every other caption on this feature.
//
// AND IT THROWS AWAY NOTHING BUT THE WATCH. The kills, the gaps and the sightings are the fold's,
// derived from the log; the watch list is the only thing the log cannot state. So unwatching drops
// the row and keeps the history behind it, the mob is still offered in Recently killed the moment
// after (`RespawnCandidate.watched` flips back to false), and watching it again brings back the
// same clock with the same numbers — which is what makes an unwatch on a floating window safe
// enough to be one click with no confirmation.
//
// THE ROW SURFACES OFFER ONLY THE UNWATCH HALF, and that is not an asymmetry: a clock row exists
// only because the mob is watched (the opt-in ruling is the admission rule), so "Watch" on one
// would be a control that can never be in its other state. The Recently-killed entry is the one
// surface that meets both kinds of mob, and it is the one that toggles.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ROW ANSWERS "IS IT WORTH WAITING FOR" (owner ruling, 2026-08-10, prototype round 6)
// ─────────────────────────────────────────────────────────────────────────────
//
// A countdown says WHEN. The question a player standing on a spawn point is actually asking is
// whether to keep standing there, and that is a question about LOOT. So a respawn row now reveals,
// on mouseover, the mob's drop table — the wiki's list plus what we have looted off it ourselves —
// beside what we know about its respawn.
//
// BOTH HALVES ARE THINGS THIS APP ALREADY HAD, and the ruling was explicit that neither may be
// rebuilt. The drops are `MobKnowledge` through the cache-first `mobs:lookup` door — the same
// answer the `/con` hover card, the mob page and the consider strip draw — split by the one fold
// in shared/mobDrops.ts. The card is the same component (`lib/hoverCards.tsx`, moved down from the
// event overlay so both windows can draw it). And the timer half is `respawnProvenance` verbatim:
// round 5 cut that sentence to the facts the row does not print and CAPPED it by test, so round 6
// carries it into the card as a titled block rather than growing a second tooltip beside it.
//
// AND THE CARD IS IN THE APP ONLY (owner ruling, round 7 — this AMENDS the paragraph above). Round
// 6 also wired the card into the floating window, behind the interactive gate. The owner used it and
// threw that half out: a 300px window whose whole job is a countdown cannot afford a 300px card on
// top of it, and it "takes the overlay over too completely". So the floating window is back to
// round 5's shape exactly — plain rows, with `respawnProvenance` on the row's native `title`, and a
// LOCKED window still getting neither because it is click-through and receives no mouse events at
// all. The card stays on the Timers tab, where there is room for it, and it is the SAME shared
// component either way (`lib/hoverCards.tsx` keeps its home: the event overlay's `/con` rows still
// draw it, so the move round 6 made is not undone, only one of its two callers is).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE MOB IS THE PLACE, AND THE LIST AT THE BOTTOM DIES (owner ruling, round 7)
// ─────────────────────────────────────────────────────────────────────────────
//
// Round 4 put unwatch on the mob and left "Your watches" standing at the bottom of the tab, because
// typing a number felt like list work. It was not: the list was a second inventory of the same mobs,
// sorted differently, carrying one control the mob itself did not have. So it is gone, and the two
// things it held — the removal and the custom-seconds box — are on the mob's RUNNING entry, which is
// where the player is already looking when they decide the number is wrong.
//
// AND THE RUNNING ENTRY NOW SHOWS ITS WORKING. The row printed the ESTIMATE and the rung; what it
// never printed was the evidence — the actual death→death gaps this fold measured for this mob in
// this zone. `gapsMs` carries them (newest first, `RESPAWN_MAX_GAPS` of them) and the row prints
// them under the countdown when there are any. They are the same samples `observedMs` is the
// minimum of, so nothing new is derived and nothing is claimed that was not already claimed: every
// one of them is an upper bound, which is what the hover has always said.
//
// THE ONE LIMIT THIS CREATES, stated rather than discovered. A watch whose clock is not on screen
// has no row to carry its controls — a mob you watch in Guk while standing in Befallen (switch to
// all zones), or one you have never killed at all (nothing has started a clock, so its
// Recently-killed entry is where it lives). The alternative was keeping a global list on screen for
// that case, which is the thing the ruling removed. (Round 7 listed a third case here — a clock the
// linger sweep had retired — and round 8 deleted the sweep, so that one is gone: a watched mob this
// fold has a death for always has a row, and the box is always on it.)
//
// ─────────────────────────────────────────────────────────────────────────────
// A WATCHED MOB ALWAYS HAS A ROW (owner ruling, round 8 — this AMENDS the linger everywhere above)
// ─────────────────────────────────────────────────────────────────────────────
//
// THE DEFECT, from live play again: the owner came back to the app HOURS after his kills, clicked
// Watch on a Recently-killed entry, saw the button flip to Unwatch — and Running still read "no
// clocks running". Nothing was lost on the way: the write persisted, the module bumped its revision
// (round 2's law held) and the delta reached the renderer. The row was BORN PAST THE LINGER. The
// fold ran the sweep below on every row it built, so a clock whose estimate had elapsed more than
// RESPAWN_LINGER_MS ago — which is what a five-hour-old death is, always — was published as no row
// at all. The one mob the user had just asked for by name was the one mob the module refused to
// show, and a successful click with no visible effect is the worst thing a control can do.
//
// SO THE SWEEP IS GONE FROM THE FOLD. A watched mob this fold holds a death for ALWAYS publishes a
// row, however old that death is. The list stays bounded the way the rest of the feature is: by the
// opt-in ruling (rows exist only for names the player asked for), by the zone scope, and by
// RESPAWN_MAX_ROWS — never by a clock silently retiring a mob the user is still watching.
//
// AND THE LINGER KEEPS THE TWO JOBS THAT ARE NOT "DELETE THE ROW" (owner: it "may tidy seen-state
// but must never make a watched row vanish while watched"). Both are readings, not admissions:
//
//   1. IT BOUNDS THE SEEN STATE. `UP` is the one label in this feature that claims a mob is
//      standing there, and it is allowed to because the log printed the name. A line from ninety
//      minutes ago prints nothing about now, so evidence older than the window stops reading UP.
//      Before round 8 the sweep did this by DELETING the row, which is why round 3 had to spare
//      seen rows from it; the state simply expires now, and the row stays.
//   2. IT MARKS A LONG-ELAPSED CLOCK STALE. A countdown that ran out five hours ago has stopped
//      being a countdown: "due 5h 12m ago" is a growing number about a thing this app knows nothing
//      about. So past the same window the reading is `stale`, and the surfaces say so in the two
//      honest ways there are — `due long ago` when an estimate elapsed, `awaiting next death` when
//      there was never an estimate to elapse — draw no progress bar (there is no estimate left
//      running to draw), and sort it UNDER every live clock. It is the least actionable row on the
//      screen and it is still on the screen.
//
// THE NEXT DEATH IS THE WHOLE RECOVERY, and it needs no code: `baseTs` moves to the new death, the
// reading stops being stale in the same tick, and the normal cycle resumes. A sighting does the
// same for the seen half. Nothing has to be re-watched, re-typed or re-discovered.
//
// ─────────────────────────────────────────────────────────────────────────────
// AND RECENTLY KILLED IS SEARCHABLE (owner ruling, round 7)
// ─────────────────────────────────────────────────────────────────────────────
//
// The discovery panel is the only door a clock comes through, and in a dungeon it fills with forty
// names in a few pulls. `filterRespawnCandidates` is the whole of the filter: ONE pass, a lowercased
// substring, three fields (the name, the zone, the wiki's verbatim text) and an empty query
// returning the SAME array untouched — the `filterByQuery` contract from the Sky search (JOS-206 /
// JOS-207), restated for the other list in the app that grows while you play. Pure and node-tested;
// the renderer's half of those learnings (a memoized row, stable props, an input that owns its own
// state) lives in TimersView.tsx.

/** Which rung of the ladder produced the estimate on a row. `'none'` = no rung had anything. */
export type RespawnSource = 'custom' | 'observed' | 'wiki' | 'none'

/**
 * WHICH FAMILY OF LINE NAMED THE MOB (see the seen-coverage statement in the header). Carried so a
 * row can say what its evidence was rather than asserting a bare "up" — a consider is a deliberate
 * look at something, a combat line is somebody swinging at it, and the user is entitled to know
 * which of those the app is going on.
 */
export type RespawnSeenVia = 'combat' | 'consider' | 'hold' | 'spell'

export const RESPAWN_SEEN_VIA_LABEL: Record<RespawnSeenVia, string> = {
  combat: 'a combat line',
  consider: 'a consider',
  hold: 'a mez/root/charm line',
  spell: 'a spell line'
}

/** What the clock's `baseTs` IS — a death the log printed, or a sighting the user confirmed. */
export type RespawnBasis = 'death' | 'sighting'

/**
 * The shape version — bumped when a renderer holding an older baseline must re-hydrate.
 * 2: `diedTs` became `baseTs` and the row grew `basis` / `seenTs` / `seenVia` (round 3).
 * 3: the row grew `gapsMs` and `customMs` — the working the Running entry now shows, and the
 *    number its own seconds box edits, after the watch list at the bottom of the tab died (round 7).
 */
export const RESPAWN_SHAPE_VERSION = 3

/**
 * HOW LONG A READING STAYS CURRENT — and, since round 8, the ONLY thing this number governs.
 *
 * It used to be a retirement: a row whose clock ran out this long ago was dropped from the fold
 * entirely, which is the defect round 8 exists to fix (see the header — watching an hours-old kill
 * produced no row at all). Now it bounds two READINGS and removes nothing:
 *
 *   * a sighting older than this stops flipping the row to `UP` (the log said so once; it is not
 *     saying so now), and
 *   * a clock overdue by more than this — or, with no estimate, a death this old — reads `stale`,
 *     which every surface prints as an honest state and sorts under the live clocks.
 *
 * One number for both, because they are one question: how long a thing the log said stays worth
 * repeating.
 */
export const RESPAWN_LINGER_MS = 30 * 60 * 1000

/** Most rows the module will publish. Bounded because a dungeon prints a lot of death lines. */
export const RESPAWN_MAX_ROWS = 60

/** Most recently-killed mobs offered as watch candidates in the view. */
export const RESPAWN_MAX_RECENT = 40

/**
 * How many measured gaps a row carries as its working (round 7).
 *
 * Bounded for the reason every list in this file is: a camped spawn produces a sample every cycle
 * and a long night would put a hundred durations under one countdown. Six is what fits under a row
 * without the row becoming a table, and the NEWEST are the ones kept — the estimate is the minimum
 * of all of them (`observedMs`, published beside these), so nothing is lost by dropping the tail.
 */
export const RESPAWN_MAX_GAPS = 6

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES (electron-store, additive optional key — no migration)
// ─────────────────────────────────────────────────────────────────────────────

/** One mob the user has chosen to watch, and the number they chose for it. */
export interface RespawnWatchPref {
  /** Canonical (lowercased) mob name — what a death line's name canonicalizes to. */
  key: string
  /** The name as the log printed it, for display. */
  display: string
  /** The user's own respawn, in SECONDS. Rung 1; absent means "use what you learn". */
  customSec?: number
}

export interface RespawnPrefs {
  /**
   * The mobs the player asked for, and the ONLY mobs that get a clock. An empty list means no
   * clocks at all, which is what a fresh install has and what it keeps until somebody clicks
   * Watch — see the opt-in paragraph in the header for why there is no rule that fills this in.
   */
  watches: RespawnWatchPref[]
}

export const DEFAULT_RESPAWN_PREFS: RespawnPrefs = { watches: [] }

/** Longest custom respawn the editor accepts (a week), and the shortest (one second). */
export const RESPAWN_CUSTOM_MIN_SEC = 1
export const RESPAWN_CUSTOM_MAX_SEC = 7 * 24 * 3600

/** Most watches a user may keep. Bounded for the same reason every store list here is. */
export const RESPAWN_MAX_WATCHES = 200

/**
 * Normalize whatever came out of the store or in over IPC. Runs at BOTH ends — the store reader
 * and the IPC handler — so a renderer can never write a shape the module then has to defend
 * against. Unknown fields are dropped rather than carried, which is also how the retired
 * `autoWiki` flag leaves: a store written by the prototype build loads here as its watch list and
 * nothing else, so the ruling that removed auto-watch takes effect on the next read with no
 * migration to write.
 */
export function normalizeRespawnPrefs(raw: unknown): RespawnPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_RESPAWN_PREFS, watches: [] }
  const obj = raw as Partial<RespawnPrefs>
  const seen = new Set<string>()
  const watches: RespawnWatchPref[] = []
  for (const w of Array.isArray(obj.watches) ? obj.watches : []) {
    const clean = normalizeWatch(w)
    if (!clean || seen.has(clean.key)) continue
    seen.add(clean.key)
    watches.push(clean)
    if (watches.length >= RESPAWN_MAX_WATCHES) break
  }
  return { watches }
}

function normalizeWatch(raw: unknown): RespawnWatchPref | null {
  if (typeof raw !== 'object' || raw === null) return null
  const w = raw as Partial<RespawnWatchPref>
  const display = typeof w.display === 'string' ? w.display.trim().slice(0, 64) : ''
  const key = typeof w.key === 'string' ? w.key.trim().toLowerCase().slice(0, 64) : ''
  if (key.length === 0) return null
  const out: RespawnWatchPref = { key, display: display.length > 0 ? display : key }
  const sec = typeof w.customSec === 'number' && Number.isFinite(w.customSec) ? Math.round(w.customSec) : 0
  if (sec >= RESPAWN_CUSTOM_MIN_SEC && sec <= RESPAWN_CUSTOM_MAX_SEC) out.customSec = sec
  return out
}

/**
 * DROP ONE MOB FROM THE WATCH LIST, and touch nothing else — the whole of round 4's write.
 *
 * Pure, and shared by every surface through the IPC handler that calls it, so "stop watching this"
 * has ONE definition: the clock row in the tab, the row in the floating window and the
 * Recently-killed entry cannot drift into three ideas of what the button did. The key is
 * canonicalized here the way `normalizeWatch` canonicalizes what it stores (world-model law 2 —
 * canonicalize at boundaries), so a row's `key` (which is `idKey(name)` on the far side of that
 * rule) and a hand-edited settings file both land on the same entry.
 *
 * Removing a name that is not watched is not an error and not a special case: it returns a list
 * equal to the one it was given, and the caller decides whether an unchanged list is worth
 * persisting. That is what a click racing a delta looks like.
 */
export function respawnWithoutWatch(prefs: RespawnPrefs, key: string): RespawnPrefs {
  const want = key.trim().toLowerCase()
  return { ...prefs, watches: prefs.watches.filter((w) => w.key !== want) }
}

/**
 * The word on the control, one spelling for all three surfaces — and now the WHOLE of it.
 *
 * ROUND 7 ADDENDUM (owner): the tooltip is gone. `respawnUnwatchTitle` used to state the two
 * consequences on the hover — that a watch follows the NAME so its clocks stop in every zone, and
 * that nothing is destroyed because everything but the watch re-derives from the log — and the
 * owner's ruling is that the control speaks for itself. That is round 5's argument taken one step
 * further: the word `Unwatch` is the opposite of the `Watch` beside it, both facts remain true and
 * are argued here rather than recited on screen, and the second one is what made the button safe to
 * press without a confirmation in the first place — a property of the write, not of the caption.
 * So the string is DELETED rather than shortened; a hover kept "for reference" is how it grows back.
 */
export const RESPAWN_UNWATCH_LABEL = 'Unwatch'

/**
 * WHAT THE CONFIRM AFFORDANCE DOES, one spelling for the tab and the floating window (round 5 -
 * they had drifted into two four-sentence paragraphs saying the same thing).
 *
 * It states the action and the two things a player can get wrong about it: nothing else ever moves
 * a clock onto a sighting, and a death message afterwards undoes this one. The epistemics behind
 * that ("a sighting proves it is up, never when it spawned") are the header's job, not a caption's.
 */
export const RESPAWN_CONFIRM_TITLE =
  'Start this clock from the sighting. Nothing else re-bases it, and the next death message takes it back.'

// ─────────────────────────────────────────────────────────────────────────────
// THE ESTIMATE LADDER
// ─────────────────────────────────────────────────────────────────────────────

/** Everything known about one mob's respawn, before the ladder picks a rung. */
export interface RespawnEvidence {
  /** Rung 1 — the user's own number, in ms. */
  customMs?: number
  /** Rung 2 — the SMALLEST same-stay death→death gap, in ms. */
  observedMs?: number
  /** How many same-stay gaps back `observedMs`. Zero when there are none. */
  samples: number
  /** Rung 3 — the wiki's stated duration, in ms. Absent when it states none. */
  wikiMs?: number
}

export interface RespawnEstimate {
  /** The countdown length. Absent when no rung had anything — the row then counts UP. */
  estimateMs?: number
  source: RespawnSource
}

/**
 * Pick the rung. See the header for why rung 2 is floored by rung 3 rather than averaged with it,
 * and why a user's own number is never floored at all (they are looking at the spawn; the wiki is
 * describing a different server).
 */
export function resolveRespawn(ev: RespawnEvidence): RespawnEstimate {
  if (ev.customMs !== undefined && ev.customMs > 0) return { estimateMs: ev.customMs, source: 'custom' }
  if (ev.observedMs !== undefined && ev.observedMs > 0 && ev.samples > 0) {
    const floored = ev.wikiMs !== undefined ? Math.max(ev.observedMs, ev.wikiMs) : ev.observedMs
    return { estimateMs: floored, source: 'observed' }
  }
  if (ev.wikiMs !== undefined && ev.wikiMs > 0) return { estimateMs: ev.wikiMs, source: 'wiki' }
  return { source: 'none' }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ROW
// ─────────────────────────────────────────────────────────────────────────────

/** One live respawn clock. Carries its own `baseTs` so the renderer ticks with no IPC at all. */
export interface RespawnRow {
  /** Stable across ticks — React key and e2e selector. `<zone key>::<mob key>`. */
  id: string
  /** Canonical mob name. */
  key: string
  /** The name as the death line printed it. */
  display: string
  /** The zone you were standing in when it died. Empty when the scan had seen no zone line. */
  zone: string
  /**
   * WHAT THE CLOCK COUNTS FROM, in ms — an instant the LOG stated, never a wall clock read at
   * fold time. Normally the death line's own timestamp; a sighting the user explicitly confirmed
   * moves it (see `basis` and the header's ruling), and the later of the two always wins, so the
   * next death takes it back with nothing to undo.
   */
  baseTs: number
  /** Which of those two `baseTs` is. Absent is impossible; it is stated on every row. */
  basis: RespawnBasis
  /**
   * The last instant an event NAMED this mob while the fold stood in this row's zone, and only
   * when that is NEWER than `baseTs` — a mention from before the clock started is not a sighting
   * of the spawn the clock is about. Absent means the log has said nothing since, which is not
   * evidence of anything (the coverage statement in the header says why).
   */
  seenTs?: number
  /** Which family of line said so. Present exactly when `seenTs` is. */
  seenVia?: RespawnSeenVia
  estimateMs?: number
  source: RespawnSource
  /** Rung 2's raw bound, kept beside `estimateMs` so the UI can show when the floor lifted it. */
  observedMs?: number
  samples: number
  /**
   * THE WORKING BEHIND RUNG 2 (round 7) — the qualifying death→death gaps themselves, NEWEST FIRST
   * and capped at `RESPAWN_MAX_GAPS`. Absent when there are none, so a surface renders it
   * unconditionally and gets nothing when there is nothing to show.
   *
   * `observedMs` is the minimum over ALL of them, not over these — a row that measured twenty gaps
   * publishes six and is still numbered by the smallest of the twenty. Every one of these is an
   * upper bound on the respawn (the header's argument), which is why the row prints them as
   * measurements of GAPS and never as spawns observed: this app has never seen a spawn.
   */
  gapsMs?: number[]
  /**
   * Rung 1's number as the watch list holds it, in ms — carried so the row can EDIT it (round 7,
   * where the seconds box moved when the watch list at the bottom of the tab died). Absent means no
   * number of your own, which is the norm; it is not derivable from `estimateMs`, because a custom
   * number and a wiki default that happen to agree are different facts about where the number came
   * from.
   */
  customMs?: number
  /** The wiki's verbatim text, when it has one — shown as-is, including "Triggered" and "?". */
  wikiText?: string
  wikiMs?: number
  /** How many deaths of this mob this fold has counted in this zone. */
  kills: number
}

/** A mob you recently killed, offered in the view as a one-click watch. */
export interface RespawnCandidate {
  key: string
  display: string
  zone: string
  lastTs: number
  kills: number
  watched: boolean
  wikiText?: string
  wikiMs?: number
}

export interface RespawnSnap {
  v: number
  /** The zone the fold is currently in, for the view's header. */
  zone: string
  rows: RespawnRow[]
  recent: RespawnCandidate[]
  prefs: RespawnPrefs
}

/**
 * The delta is a WHOLE snapshot. Rows are bounded at RESPAWN_MAX_ROWS and change on nearly every
 * death anyway, so a per-row merge would buy nothing and cost a second definition of the state.
 */
export type RespawnDelta = RespawnSnap

export const EMPTY_RESPAWN_SNAP: RespawnSnap = {
  v: RESPAWN_SHAPE_VERSION,
  zone: '',
  rows: [],
  recent: [],
  prefs: DEFAULT_RESPAWN_PREFS
}

export function respawnBaselineStale(state: RespawnSnap, delta: RespawnDelta): boolean {
  return state.v !== delta.v
}

export function mergeRespawnDelta(_state: RespawnSnap, delta: RespawnDelta): RespawnSnap {
  return delta
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPING THE DISPLAY TO ONE ZONE (owner ruling — see the header)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The zone comparison key: trimmed and lowercased, the same canonicalization `idKey` applies to
 * every other dirty name in this app (world-model law 2 — canonicalize at boundaries, display
 * raw). Spelled here rather than imported because this file is pure and `idKey` lives in the
 * main-process parser; the two agree by rule, and a row's `id` is built from `idKey(zone)` on the
 * far side of that rule.
 */
export function respawnZoneKey(zone: string): string {
  return zone.trim().toLowerCase()
}

/**
 * Everything from one zone, in order, out of a list of rows or candidates.
 *
 * THE EMPTY ZONE IS A ZONE — its own bucket, not a wildcard. Before the fold has seen any
 * `You have entered` line the snapshot's zone is `''` and so is every row's, so an unplaced kill
 * shows while the app is still unplaced and vanishes the moment a zone line says where you are.
 * The alternative (treat unknown as "show everything") would put the exact cross-zone list the
 * owner rejected on screen for the first seconds of every launch, and the opposite (show nothing)
 * would hide rows that are, as far as anything knows, right here.
 *
 * A DUE CLOCK IN ANOTHER ZONE IS STILL ANOTHER ZONE'S. Nothing about `due` widens this filter: a
 * mob that came up in Guk while you are in Befallen is not something you can act on, and the row
 * is waiting in the tab's all-zones view (and in the fold) for when you go back.
 */
export function respawnInZone<T extends { zone: string }>(items: readonly T[], zone: string): T[] {
  const want = respawnZoneKey(zone)
  return items.filter((i) => respawnZoneKey(i.zone) === want)
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCHING RECENTLY KILLED (owner ruling, round 7 — see the header)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does this candidate match what was typed? `needle` is expected ALREADY TRIMMED AND LOWERCASED —
 * `filterRespawnCandidates` does that once per keystroke rather than once per row.
 *
 * THREE FIELDS, ONE RULE: the name as the log printed it, the zone it died in, and the wiki's
 * verbatim respawn text. Lowercased substring, no tokenising, no fuzzing, no per-field special
 * cases — the `questMatchesQuery` contract (JOS-207), which is what makes a search box explainable
 * in one sentence. The zone is in because the all-zones view is a list across a whole night's
 * dungeons, and the wiki text is in because "min" is a real thing to type when you are looking for
 * the mobs the wiki numbers at all.
 *
 * The canonical `key` is deliberately NOT a fourth field: it is `display` lowercased (law 2), so
 * matching it would be the first comparison run twice.
 */
export function respawnCandidateMatches(c: RespawnCandidate, needle: string): boolean {
  if (!needle) return true
  if (c.display.toLowerCase().includes(needle)) return true
  if (c.zone.toLowerCase().includes(needle)) return true
  // `?? false` only so the expression is a boolean; a candidate the wiki says nothing about
  // matched nothing here either way (the `questMatchesQuery` spelling, for the same reason).
  return c.wikiText?.toLowerCase().includes(needle) ?? false
}

/**
 * Narrow the Recently-killed list by the typed query, folding the query ONCE. An empty (or
 * whitespace-only) query returns the SAME array untouched, so the default path costs one comparison
 * and allocates nothing — which is the property that lets the caller memoize on identity.
 */
export function filterRespawnCandidates<T extends RespawnCandidate>(
  items: readonly T[],
  query: string
): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((c) => respawnCandidateMatches(c, needle))
}

// ─────────────────────────────────────────────────────────────────────────────
// READING A ROW AGAINST THE CLOCK
// ─────────────────────────────────────────────────────────────────────────────

export interface RespawnReading {
  /** How long since the clock's base (the death, or a confirmed sighting). */
  elapsedMs: number
  /** How long the estimate has left. Absent when the row has no estimate. */
  remainingMs?: number
  /** Share of the estimate still to run, 1 → 0. Zero when there is no estimate. */
  fraction: number
  /** The estimate elapsed. Never a claim that the mob is standing there. */
  due: boolean
  /** How long ago it came due. Zero until it does. */
  overdueMs: number
  /**
   * THE LOG HAS NAMED THIS MOB SINCE THE CLOCK STARTED, RECENTLY ENOUGH TO STILL MEAN IT. This is
   * the one thing on the row that is an OBSERVATION rather than an estimate, so every surface leads
   * with it — see the header. It is true whether or not the clock has run out: a sighting while the
   * countdown still has ten minutes on it is the app being told its estimate (or its idea of which
   * mob this is) is wrong, which is worth showing rather than suppressing.
   *
   * ROUND 8 BOUNDED IT BY `RESPAWN_LINGER_MS`. Until then a sighting held forever and the 30-minute
   * sweep deleted the row instead; now the row never leaves, so the STATE has to expire or a line
   * from two hours ago would still be shouting UP — the one label here that claims a mob is there.
   */
  seen: boolean
  /** How long ago that was. Zero when nothing has been seen. */
  seenAgoMs: number
  /**
   * THE CLOCK HAS STOPPED MEANING ANYTHING (round 8). True when the estimate elapsed more than
   * `RESPAWN_LINGER_MS` ago — or, on a row with no estimate, when the death itself is that old —
   * and nothing has been seen since. It is never true at the same time as `seen`: fresh evidence is
   * the better answer and outranks a tired countdown.
   *
   * It is a READING, never an admission: the row is still published, still watched and still
   * carries its controls. What changes is what it says (`respawnClockLabel`), that it draws no bar,
   * and that it sorts under every live clock.
   */
  stale: boolean
}

/**
 * How long ago the log named this mob — `undefined` when it has not since the clock started, or
 * when it was long enough ago that the claim has gone stale (see `RESPAWN_LINGER_MS`). Its own
 * function so `respawnReading` states one thing per line and stays under the complexity ceiling.
 */
function seenAgoOf(row: RespawnRow, nowMs: number): number | undefined {
  if (row.seenTs === undefined || row.seenTs <= row.baseTs) return undefined
  const ago = Math.max(0, nowMs - row.seenTs)
  return ago <= RESPAWN_LINGER_MS ? ago : undefined
}

export function respawnReading(row: RespawnRow, nowMs: number): RespawnReading {
  const elapsedMs = Math.max(0, nowMs - row.baseTs)
  const ago = seenAgoOf(row, nowMs)
  const seen = ago !== undefined
  const seenAgoMs = ago ?? 0
  if (row.estimateMs === undefined || row.estimateMs <= 0) {
    // No estimate to elapse, so the elapsed time is what goes stale: a row counting up from a death
    // five hours ago is not telling anybody anything the mob page does not tell them better.
    const stale = !seen && elapsedMs > RESPAWN_LINGER_MS
    return { elapsedMs, fraction: 0, due: false, overdueMs: 0, seen, seenAgoMs, stale }
  }
  const left = row.estimateMs - elapsedMs
  return {
    elapsedMs,
    remainingMs: left > 0 ? left : 0,
    fraction: Math.min(1, Math.max(0, left / row.estimateMs)),
    due: left <= 0,
    overdueMs: left < 0 ? -left : 0,
    seen,
    seenAgoMs,
    stale: !seen && -left > RESPAWN_LINGER_MS
  }
}

/**
 * Display order: SEEN first, then the live clocks by soonest due, then the ones with no estimate,
 * and STALE last of all. Ties break on name so the list never shuffles under a re-render.
 *
 * SEEN OUTRANKS EVERY COUNTDOWN because it is a different KIND of fact. Every other row on this
 * list is the app's estimate of when something might happen; a seen row is the log stating that it
 * already has, and burying an observation under a pile of guesses is the defect round 3 exists
 * to fix. Among seen rows the freshest evidence leads — a mention two seconds ago is a better
 * reason to look than one from twenty minutes back.
 *
 * AND STALE SINKS (round 8), for the mirror-image reason. A row whose estimate elapsed hours ago
 * still ranks `remainingMs: 0`, so under the round-3 ordering alone a night's worth of old kills
 * would sit ON TOP of the clock actually running in front of you — the ruling that keeps a watched
 * mob visible must not cost the player the ordering that makes the list readable. It is last rather
 * than hidden: still there, still watched, still one glance away.
 *
 * There is no "pinned first" tier, and there is nothing to be pinned ABOVE: every row on screen is
 * a mob the player asked for by name (the opt-in ruling in the header), so a rank that says "this
 * one was your idea" would sort every row into the same bucket.
 */
export function orderRespawnRows(rows: readonly RespawnRow[], nowMs: number): RespawnRow[] {
  return [...rows].sort((a, b) => {
    const ra = respawnReading(a, nowMs)
    const rb = respawnReading(b, nowMs)
    if (ra.seen !== rb.seen) return ra.seen ? -1 : 1
    if (ra.seen && rb.seen && ra.seenAgoMs !== rb.seenAgoMs) return ra.seenAgoMs - rb.seenAgoMs
    if (ra.stale !== rb.stale) return ra.stale ? 1 : -1
    const ka = ra.remainingMs ?? Number.POSITIVE_INFINITY
    const kb = rb.remainingMs ?? Number.POSITIVE_INFINITY
    if (ka !== kb) return ka - kb
    return a.display.localeCompare(b.display)
  })
}

/**
 * Did the wiki floor LIFT this row's estimate above what your own kills said? True only when both
 * numbers exist and the wiki's is the larger — i.e. when the guard in the header actually fired.
 */
export function respawnFloored(row: RespawnRow): boolean {
  if (row.source !== 'observed') return false
  return row.observedMs !== undefined && row.wikiMs !== undefined && row.wikiMs > row.observedMs
}

/** The one-line provenance the UI prints beside a row. Written once, shown on every surface. */
export function respawnSourceLabel(row: RespawnRow): string {
  if (row.source === 'custom') return 'your number'
  if (row.source === 'observed') {
    const n = row.samples === 1 ? '1 gap' : `${String(row.samples)} gaps`
    return respawnFloored(row) ? `your kills (${n}), floored by the wiki` : `your kills (${n})`
  }
  if (row.source === 'wiki') return 'wiki default'
  return 'no estimate yet'
}

/**
 * THE ROW'S PROVENANCE, ON THE HOVER — one definition for the tab's tooltip and the floating
 * window's native title (round 5; the two used to spell it separately, and the tab's ran to five
 * sentences of teaching under a row that already prints the rung).
 *
 * What survives the cut is the set of facts stated NOWHERE ELSE on the row: the raw gap behind an
 * observed number and what a gap proves, the wiki's verbatim text, whether the floor lifted the
 * estimate, whether the base is a sighting, and the kill count. Everything the visible line already
 * says (the rung, the zone, the duration) is not repeated here.
 */
const RESPAWN_RUNG_TITLE: Record<RespawnSource, string> = {
  custom: 'Your number.',
  observed: '',
  wiki: 'Wiki default - no gap of your own yet.',
  none: 'No respawn known yet. Kill it twice in one visit, or type a number.'
}

export function respawnProvenance(row: RespawnRow, fmt: (ms: number | null | undefined) => string): string {
  const parts: string[] = []
  if (row.source === 'observed') {
    const gaps = `${String(row.samples)} gap${row.samples === 1 ? '' : 's'}`
    parts.push(`Your shortest gap in one visit: ${fmt(row.observedMs)} over ${gaps}. A gap is an upper bound.`)
  } else if (RESPAWN_RUNG_TITLE[row.source].length > 0) {
    parts.push(RESPAWN_RUNG_TITLE[row.source])
  }
  if (row.wikiText !== undefined) parts.push(`Wiki: "${row.wikiText}".`)
  if (respawnFloored(row)) parts.push('The wiki floor lifted it.')
  if (row.basis === 'sighting') parts.push('Re-based on a sighting you confirmed.')
  parts.push(`Killed ${String(row.kills)} time${row.kills === 1 ? '' : 's'} here.`)
  return parts.join(' ')
}

/**
 * THE TITLE OVER THAT SENTENCE when it is a block of the mob's hover CARD rather than a bare
 * tooltip (round 6). Both surfaces spell it once, like everything else in this file.
 */
export const RESPAWN_CARD_LABEL = 'Respawn:'

/**
 * WHAT THE ROW'S HOVER IS, ONE COMPOSITION FOR BOTH SURFACES (owner ruling, round 6).
 *
 * The owner asked a respawn row to answer two questions on mouseover: what the mob DROPS (the
 * wiki table plus what we have looted off it ourselves) and what we know about its RESPAWN (the
 * wiki's number or the one we learned, labelled with which). The drops half is the mob hover card
 * that already existed for `/con` rows in the event overlay, and the timer half is this — the
 * round-5 provenance string, unchanged and still capped by test, carried into that card as its
 * leading block rather than duplicated into a second tooltip.
 */
export function respawnCardNote(
  row: RespawnRow,
  fmt: (ms: number | null | undefined) => string
): { label: string; text: string } {
  return { label: RESPAWN_CARD_LABEL, text: respawnProvenance(row, fmt) }
}

/**
 * THE SAME CARD, ON A MOB YOU HAVE ONLY KILLED (owner ruling, round 7: the hover card opens on
 * Recently-killed entries too, not only on running clocks).
 *
 * A candidate is the same mob asking the same question — is it worth coming back for — one decision
 * earlier, so it gets the same card and the drops half is identical. What differs is the note, and
 * it is SHORTER by construction rather than by editing: a mob with no clock has no rung, no basis
 * and no gap of its own to report, so what is left is whether it is watched at all, what the wiki
 * says, and how many times you have killed it here. Capped by the same test as `respawnProvenance` —
 * a hover, not a paragraph.
 */
export function respawnCandidateNote(cand: RespawnCandidate): { label: string; text: string } {
  const parts: string[] = []
  parts.push(cand.watched ? 'Watched - its clock is under Running.' : 'Not watched, so nothing is clocked.')
  if (cand.wikiText !== undefined) parts.push(`Wiki: "${cand.wikiText}".`)
  parts.push(`Killed ${String(cand.kills)} time${cand.kills === 1 ? '' : 's'} here.`)
  return { label: RESPAWN_CARD_LABEL, text: parts.join(' ') }
}

/**
 * THE ROW'S WORKING, ON THE ROW (owner ruling, round 7): the gaps this fold actually measured for
 * this mob in this zone, newest first. Empty string when there are none, so a surface can render it
 * unconditionally.
 *
 * IT SAYS "GAPS" AND IT MEANS IT. Every number in this list is a death→death interval — respawn
 * plus however long you took to find it again — and the app has never watched a mob spawn (law 1).
 * So the word is the one the rest of the feature already uses, the estimate beside it is still
 * printed with `<=`, and the hover still spells out what a gap proves. Naming these "respawns seen"
 * would be the single sentence that undoes the whole ticket's honesty.
 */
export function respawnGapsLabel(row: RespawnRow, fmt: (ms: number | null | undefined) => string): string {
  if (row.gapsMs === undefined || row.gapsMs.length === 0) return ''
  return `gaps: ${row.gapsMs.map((g) => fmt(g)).join(' · ')}`
}

/**
 * THE NUMBER ON THE CLOCK, worded once for every surface that draws one — the Timers tab and the
 * floating window both call this, so a countdown can never read one way in the app and another way
 * over the game.
 *
 * A SEEN ROW HAS NO NUMBER TO GIVE, so it gives the answer instead. `UP` is the whole label: the
 * estimate is still printed beside it (the surfaces draw `respawnSourceLabel` and the duration on
 * their second line, and the bar keeps running), but the loudest thing on the row is no longer a
 * countdown that has been overtaken by events. This is also the ONE label in the feature that
 * claims a mob is there — and it may, because unlike `due` it is reporting a line the game printed
 * rather than a clock this app ran.
 *
 * AND A STALE ROW STOPS COUNTING (round 8). Once the estimate has been elapsed longer than the
 * linger, `due 5h 12m ago` is a number that grows forever about a mob this app knows nothing about;
 * a row that never had an estimate is in the same position with `+5h 12m`. Both say what is
 * actually true instead — the estimate is long gone, and what would restart the clock is the next
 * death. The two spellings are constants because three surfaces read them and round 5's law is that
 * a string on screen has ONE home.
 *
 * `fmt` is injected because the app's ONE duration formatter lives in the renderer
 * (features/buffs/format.ts) and this module is pure. Injecting it is what keeps that rule — one
 * formatter — from being broken by a second spelling written down here.
 */
export const RESPAWN_LONG_DUE_LABEL = 'due long ago'
export const RESPAWN_AWAITING_LABEL = 'awaiting next death'

export function respawnClockLabel(
  row: RespawnRow,
  nowMs: number,
  fmt: (ms: number | null | undefined) => string
): string {
  const r = respawnReading(row, nowMs)
  if (r.seen) return 'UP'
  if (r.stale) return row.estimateMs === undefined ? RESPAWN_AWAITING_LABEL : RESPAWN_LONG_DUE_LABEL
  if (row.estimateMs === undefined) return `+${fmt(r.elapsedMs)}`
  return r.due ? `due ${fmt(r.overdueMs)} ago` : fmt(r.remainingMs ?? 0)
}

/**
 * The seen line: what named it and how long ago. Empty string when the row has not been seen, so a
 * surface can render it unconditionally and get nothing when there is nothing to say.
 *
 * The AGE is always stated and never rounded away, because it is the whole of what the user needs
 * to judge the claim: "seen 3s ago" is a mob in front of you and "seen 24m ago" is a mob that was
 * there once. The app declines to turn that judgement into a threshold of its own.
 */
export function respawnSeenLabel(
  row: RespawnRow,
  nowMs: number,
  fmt: (ms: number | null | undefined) => string
): string {
  const r = respawnReading(row, nowMs)
  if (!r.seen) return ''
  const via = row.seenVia === undefined ? '' : ` (${RESPAWN_SEEN_VIA_LABEL[row.seenVia]})`
  return r.seenAgoMs < 1000 ? `seen just now${via}` : `seen ${fmt(r.seenAgoMs)} ago${via}`
}

/**
 * What the clock is counting from. The death case says nothing — it is the norm and every surface
 * already reads "your kills" — while a re-based row states its provenance out loud, because a
 * number resting on a judgement the user made must never be indistinguishable from one resting on
 * a line the game printed (law 1: anything inferred is LABELED inferred).
 *
 * It is a LABEL and not a sentence (round 5): it sits in a run of chips beside the zone and the
 * rung, where "clock started from your confirmed sighting" was a caption pretending to be one.
 */
export function respawnBasisLabel(row: RespawnRow): string {
  return row.basis === 'sighting' ? 'from your sighting' : ''
}
