// GOLDEN WINDOW — THE UNBOUND PET (JOS-47). tests/fixtures/p1-unbound-pet.log, real log lines
// 491470..493040 (Thu Jul 30 16:10:10 → 16:30:24), extracted verbatim through the shared scrub
// by tests/extract-pet-claim-fixtures.mjs.
//
// WHAT THE WINDOW IS. Twenty minutes of the owner playing with his ENCHANTER animation pet,
// summoned by `Yegoreff's Animation` and called Kober. He never orders it, so it never sends
// the private `… Master.'` tell; it is not charmed, so there is no broadcast either. It says
// four PUBLIC pet lines, lands 105 hits for 1,966 points across four mobs — three of them mobs
// the owner is hitting too — and the app has never been able to see a single one of them.
//
// This is the reporter's bug (feedback 01KZBV8WFC8PD7DNASTJ5S5CWZ: "Dps overlay meter is not
// showing my pet dps") reproduced in the OWNER's own log, which is why it is the fixture rather
// than a synthetic one. The measured verdict on the reporter's slice was identical in kind:
// three successive pets, 476 hits, 13,555 points, zero tells, invisible at every scope.
//
// WHAT IT PINS, in order:
//   1. the bug, exactly — no claim, no pet, no row, at any scope;
//   2. the QUESTION the meter now asks, with the evidence behind it;
//   3. the NEGATIVE control — `Guard Effel` is proper-named and fights the same mobs, and is
//      never offered, because it swings at the owner;
//   4. the ANSWER — a claim recovers every point, byte-exact, across the four zone lines the
//      window happens to contain (a summoned pet follows you; that is not incidental here);
//   5. the CONVERGENCE the owner asked for — a claimed entity that later sends a real tell is
//      ONE pet, not a conflict, and the question is gone either way.
//
// Fixture-guarded: `readFixture` returns [] when the file is absent, and every test skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { CombatEngine } from '../src/main/combat/engine'
import { scopeSources } from '../src/renderer/src/features/combat/meterScope'
import type { MeterScope } from '../src/shared/roster'
import type { PetClaimsView } from '../src/shared/petClaims'
import type { SegmentView } from '../src/shared/combat'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (name: string): string[] => {
  const p = join(FIXTURES, name)
  return existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.length > 0) : []
}
const P1 = read('p1-unbound-pet.log')
const skip = P1.length === 0 ? 'fixture not present' : false

/**
 * THE OTHER SESSION (JOS-49). `w46-special-eagle-strike.log` is a four-minute froglok camp from
 * Tue Jul 28 22:06 — forty-two hours before P1 — and it is the only OTHER committed fixture that
 * contains an entity clearing the candidate bars: `Dranix`, 175 landed hits across four mobs the
 * owner also fought, never bound by anything. It was cut for an entirely different feature, which
 * is what makes it honest evidence here: the wall was not built out of exotic logs.
 */
const W46 = read('w46-special-eagle-strike.log')
const skipWall = P1.length === 0 || W46.length === 0 ? 'fixture not present' : false

/**
 * P2 — THE WHOLE ARC OF A PET, IN ELEVEN MINUTES (Thu Aug 06 12:34–12:46, a Nagafen's Lair
 * instance the owner made for himself). P1 is a pet that is never bound; this is the other half.
 * One span carries the unbound period, the tell that ends it, the pet that replaces it, and that
 * one's tell — and it is the owner's OWN last two encounters, located after he watched the
 * feature get the current pet wrong.
 */
const P2 = read('p2-pet-arc-bound.log')
const skipArc = P2.length === 0 ? 'fixture not present' : false

/** The pet-claim view a character with these statements has. */
function claims(claimed: string[] = [], denied: string[] = []): PetClaimsView {
  const names = new Map(claimed.map((n) => [n.toLowerCase(), n]))
  return {
    claimed: new Set(claimed.map((n) => n.toLowerCase())),
    denied: new Set(denied.map((n) => n.toLowerCase())),
    nameOf: (k) => names.get(k)
  }
}

/** Replay the window through the real parser + engine, as the app does at launch. */
function replay(view: PetClaimsView = claims()): { eng: CombatEngine; lastTs: number; says: number } {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  eng.setPetClaims(() => view)
  let seq = 0
  let lastTs = 0
  let says = 0
  for (const raw of P1) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    if (ev.kind === 'petSay') says++
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  return { eng, lastTs, says }
}

/** Every zone session's outgoing rows — a pet follows you through a zone line, and this window
 *  crosses four of them, so "what did the pet do" is only answerable across all of them. */
function allSessions(eng: CombatEngine, lastTs: number): SegmentView[] {
  const now = lastTs + 120_000
  const out: SegmentView[] = []
  for (const zs of eng.snapshot(now, {}).zoneSessions) {
    const s = eng.snapshot(now, { selectedId: zs.id }).selected
    if (s) out.push(s)
  }
  return out
}

function petTotals(views: SegmentView[]): { total: number; hits: number; names: Set<string> } {
  let total = 0
  let hits = 0
  const names = new Set<string>()
  for (const v of views)
    for (const e of v.entities)
      if (e.kind === 'pet') {
        total += e.total
        hits += e.hits
        names.add(e.name)
      }
  return { total, hits, names }
}

// ── 1. THE BUG, EXACTLY ────────────────────────────────────────────────────────────────────

test('P1: 105 pet hits parse perfectly and NOTHING binds them', { skip }, () => {
  const { eng, lastTs } = replay()
  // Every one of the pet's lines parses — this was never a parse failure.
  const raw = P1.filter((l) => /\] Kober [a-z]+ .* for \d+ points? of damage\.$/.test(l))
  assert.equal(raw.length, 105)
  // …and none of it is attributed to anybody.
  assert.deepEqual(eng.petDisplayNames(), [])
  assert.equal(petTotals(allSessions(eng, lastTs)).total, 0)
})

test('P1: the missing damage is invisible at EVERY scope, not hidden by one', { skip }, () => {
  // The scope chip is a view filter over rows the engine RECORDED. This damage was dropped at
  // admission, so no row was ever created and there is no scope the user could switch to. The
  // triage brief assumed Everyone covered discovery; the replay says it cannot.
  const { eng, lastTs } = replay()
  const snap = eng.snapshot(lastTs + 120_000, { selectedId: 'zone' })
  const rows = snap.selected?.entities ?? []
  for (const scope of ['you', 'group', 'everyone'] as MeterScope[]) {
    const kept = scopeSources(rows, scope, snap.roster)
    assert.equal(kept.some((r) => r.kind === 'pet'), false, `${scope} must show no pet row`)
  }
})

// ── 2. THE QUESTION ────────────────────────────────────────────────────────────────────────

test('P1: the meter asks about the pet, and says what it saw', { skip }, () => {
  const { eng, lastTs, says } = replay()
  // The four public sentences survive the scrub now — without them the offer is a guess.
  assert.equal(says, 4)
  const { candidates } = eng.snapshot(lastTs + 120_000, {}).petClaims
  assert.equal(candidates.length, 1)
  const [c] = candidates
  assert.equal(c.name, 'Kober')
  assert.equal(c.why, 'say', 'it answered a pet command out loud')
  assert.equal(c.says, 4)
  assert.equal(c.hits, 105)
  assert.equal(c.damage, 1966)
  assert.equal(c.sharedTargets, 4)
})

test('P1: a DENIED answer removes the question and never moves a number', { skip }, () => {
  const { eng, lastTs } = replay(claims([], ['Kober']))
  const snap = eng.snapshot(lastTs + 120_000, {})
  assert.deepEqual(snap.petClaims.candidates, [])
  assert.deepEqual(snap.petClaims.claimed, [])
  assert.equal(petTotals(allSessions(eng, lastTs)).total, 0, 'saying no is not saying yes')
})

// ── 3. THE NEGATIVE CONTROL ────────────────────────────────────────────────────────────────

test('P1: a proper-named HOSTILE fighting the same mobs is never offered', { skip }, () => {
  // `Guard Effel` is proper-named, is not a mob-shaped article name, and trades blows with the
  // same entities. It is also swinging at the owner, which is the whole difference.
  assert.ok(P1.some((l) => /\] Guard Effel .*YOU/.test(l)), 'the control must actually hit you')
  const { eng, lastTs } = replay()
  const { candidates } = eng.snapshot(lastTs + 120_000, {}).petClaims
  assert.equal(candidates.some((c) => c.name.toLowerCase().includes('effel')), false)
})

// ── 4. THE ANSWER ──────────────────────────────────────────────────────────────────────────

test('P1: a claim recovers every point of it — 1,966 over 105 hits, exactly', { skip }, () => {
  const { eng, lastTs } = replay(claims(['Kober']))
  const totals = petTotals(allSessions(eng, lastTs))
  assert.deepEqual([...totals.names], ['Kober'])
  assert.equal(totals.hits, 105)
  assert.equal(totals.total, 1966)
  assert.deepEqual(eng.petDisplayNames(), ['Kober'])
})

test('P1: a claimed pet is SUMMONED, so it walks through the four zone lines with you', { skip }, () => {
  assert.equal(P1.filter((l) => /\] You have entered /.test(l)).length, 5)
  const { eng, lastTs } = replay(claims(['Kober']))
  // Still bound at the end, and its damage lands in more than one zone session — which is
  // exactly what would NOT happen if a claim bound it as a charmed pet (charm cannot zone).
  assert.deepEqual(eng.petDisplayNames(), ['Kober'])
  const withPet = allSessions(eng, lastTs).filter((v) => v.entities.some((e) => e.kind === 'pet'))
  assert.ok(withPet.length >= 2, 'the pet followed you')
})

test('P1: the claim answers the question — it is not still being asked', { skip }, () => {
  const { eng, lastTs } = replay(claims(['Kober']))
  const snap = eng.snapshot(lastTs + 120_000, {})
  assert.deepEqual(snap.petClaims.candidates, [], 'an unbound-state offer, and it is bound now')
  assert.deepEqual(snap.petClaims.claimed, ['Kober'])
})

test('P1: a claim adds a pet row and moves NO other number', { skip }, () => {
  // The design's central promise, stated as arithmetic: the user's own damage is byte-identical
  // either way, and the segment total grows by exactly the pet's own contribution.
  const before = replay()
  const after = replay(claims(['Kober']))
  const you = (views: SegmentView[]): number =>
    views.reduce((n, v) => n + v.entities.filter((e) => e.kind === 'you').reduce((m, e) => m + e.total, 0), 0)
  const out = (views: SegmentView[]): number => views.reduce((n, v) => n + v.outTotal, 0)
  const b = allSessions(before.eng, before.lastTs)
  const a = allSessions(after.eng, after.lastTs)
  assert.equal(you(a), you(b))
  assert.equal(out(a) - out(b), 1966)
})

// ── 5. CONVERGENCE: A CLAIM AND A TELL ARE ONE PET ─────────────────────────────────────────

test('P1: a claimed pet that LATER sends a real tell is one pet, not a conflict', { skip }, () => {
  // The owner's refinement (JOS-47): the two paths must converge cleanly. They walk the same
  // `world.claim()` door, which is idempotent on a live pet instance — so the tell confirms the
  // claim rather than competing with it, there is exactly one row, and the provenance stays the
  // user's (shared/roster.ts `outranks`: nothing the log says outranks rung 'user').
  const view = claims(['Kober'])
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  eng.setPetClaims(() => view)
  let seq = 0
  let lastTs = 0
  for (const raw of P1) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  const tell = parseEvent(
    `[Thu Jul 30 16:30:30 2026] Kober told you, 'Attacking a fire giant warrior Master.'`,
    seq++
  )
  assert.equal(tell?.kind, 'petClaim')
  eng.ingestEvent(tell!, false)
  assert.deepEqual(eng.petDisplayNames(), ['Kober'], 'one pet, one name, one instance')
  const totals = petTotals(allSessions(eng, lastTs + 60_000))
  assert.deepEqual([...totals.names], ['Kober'], 'and one row — no second generation appeared')
  assert.equal(totals.total, 1966)
  const snap = eng.snapshot(lastTs + 120_000, {})
  assert.deepEqual(snap.petClaims.candidates, [])
  assert.deepEqual(snap.petClaims.claimed, ['Kober'])
})

// ── 6. THE QUESTION IS ABOUT THE FIGHT IN FRONT OF YOU (JOS-49) ────────────────────────────
//
// THE BUG, in the owner's words: the offer is fed by the FULL historical replay, so every
// never-ordered pet since the beginning of the log becomes a standing question — a streamer's
// meter opened onto a wall of "your pet?" rows and was unusable. Measured on the owner's own log
// before the fix: 101 entities cleared the bars and were still being offered at the end of the
// replay, the three the meter actually showed last seen six, nine and two DAYS earlier.
//
// The corpus below is that wall in miniature and made of committed bytes: two real spans from two
// different days, replayed through ONE engine the way the startup scan replays a whole log.

/** Replay several fixture spans through one engine, in the order the log wrote them. */
function replaySpans(...spans: string[][]): { eng: CombatEngine; lastTs: number } {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  let lastTs = 0
  for (const span of spans) {
    for (const raw of span) {
      const ev = parseEvent(raw, seq++)
      if (!ev) continue
      eng.ingestEvent(ev, false)
      lastTs = ev.ts
    }
  }
  return { eng, lastTs }
}

test('JOS-49: the earlier session’s pet really would have qualified — the wall was real', { skip: skipWall }, () => {
  // Half of the reproduction: on its OWN, W46's span ends with Dranix standing as a question.
  // Without this the test below would prove nothing (an entity that never qualified is not
  // evidence that historical entities stop being offered).
  const { eng, lastTs } = replaySpans(W46)
  const { candidates } = eng.snapshot(lastTs + 120_000, {}).petClaims
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'Dranix')
  assert.ok(candidates[0].hits >= 100, `${candidates[0].hits} landed hits`)
})

test('JOS-49: replaying BOTH days leaves only the pet that is still there', { skip: skipWall }, () => {
  // The whole point. Two sessions, two qualifying entities, forty-two hours apart. Before the
  // currency gate the answer here was BOTH of them — Dranix carried into Thursday evening as a
  // permanent, unanswerable question. Now the replay resolves to what was current when it ended.
  const { eng, lastTs } = replaySpans(W46, P1)
  const { candidates } = eng.snapshot(lastTs + 120_000, {}).petClaims
  assert.deepEqual(candidates.map((c) => c.name), ['Kober'])
})

test('JOS-49: …and the survivor keeps every point of its evidence', { skip: skipWall }, () => {
  // The gate hides questions; it must never quietly shrink the answer behind the one it keeps.
  // Same numbers as section 2, through a replay that crossed another day and five zone lines.
  const { eng, lastTs } = replaySpans(W46, P1)
  const [c] = eng.snapshot(lastTs + 120_000, {}).petClaims.candidates
  assert.equal(c.why, 'say')
  assert.equal(c.says, 4)
  assert.equal(c.hits, 105)
  assert.equal(c.damage, 1966)
  assert.equal(c.sharedTargets, 4)
})

test('JOS-49: logging in the next day is not asked about yesterday’s pet', { skip }, () => {
  // The user-visible shape of the same rule, driven by real log lines rather than by reaching
  // into the detector: replay the window, then let the log go on WITHOUT the pet. A zone line is
  // the everyday way that happens (you walked out), and it is what the owner does next.
  const { eng, lastTs } = replaySpans(P1)
  assert.equal(eng.snapshot(lastTs + 120_000, {}).petClaims.candidates.length, 1, 'asked at the end of the window')
  const after = parseEvent(`[Thu Jul 30 16:31:00 2026] You have entered East Commonlands.`, 99_000)
  assert.equal(after?.kind, 'zone')
  eng.ingestEvent(after!, false)
  assert.deepEqual(
    eng.snapshot(lastTs + 120_000, {}).petClaims.candidates,
    [],
    'an unbound candidate does not follow you through a zone line — it has to show up again'
  )
})

test('JOS-49: a pet that goes quiet while the log runs on stops being asked about', { skip }, () => {
  // The other axis, and the one that matters inside a long camp: the pet despawned or the fight
  // ended, and the log keeps printing. Real line shapes, stamped past OFFER_IDLE_MS.
  const { eng, lastTs } = replaySpans(P1)
  let seq = 99_000
  for (const clock of ['16:31:30', '16:32:30', '16:33:30']) {
    const ev = parseEvent(`[Thu Jul 30 ${clock} 2026] You have become better at 1H Blunt! (121)`, seq++)
    if (ev) eng.ingestEvent(ev, false)
  }
  assert.deepEqual(eng.snapshot(lastTs + 300_000, {}).petClaims.candidates, [])
})

test('JOS-49: an ANSWERED question is untouched by any of it — a claim still recovers everything', { skip: skipWall }, () => {
  // The gate is on the QUESTION, never on the answer. A claim made today still re-runs the whole
  // replay and books the pet's entire history, across both days and every zone line in them.
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  eng.setPetClaims(() => claims(['Kober']))
  let seq = 0
  let lastTs = 0
  for (const span of [W46, P1]) {
    for (const raw of span) {
      const ev = parseEvent(raw, seq++)
      if (!ev) continue
      eng.ingestEvent(ev, false)
      lastTs = ev.ts
    }
  }
  // Scoped to Kober's own rows: Tuesday's camp has a genuine charmed pet of its own
  // (`a froglok ton knight`), which is a correct row and none of this test's business.
  let hits = 0
  let total = 0
  for (const v of allSessions(eng, lastTs)) {
    for (const e of v.entities) {
      if (e.kind === 'pet' && e.name === 'Kober') {
        hits += e.hits
        total += e.total
      }
    }
  }
  assert.equal(hits, 105)
  assert.equal(total, 1966)
})

// ── 7. THE OWNER'S OWN LAST TWO PETS (JOS-49, P2) ──────────────────────────────────────────
//
// The measurement that made this ticket urgent, and the one that says the fix works. Replaying
// the whole real log through the PRE-FIX engine, at the exact minutes the owner's live pet Jaber
// was swinging beside him (Aug 06 12:35:40–12:43:20, 301 events), the meter offered:
//
//     Kober (1,966) | President (38,903) | Shiva (34,957)
//
// — a pet from Jul 30, one from Jul 31 and one from Jul 28. Jaber appeared in that offer ZERO
// times out of 301. The wall did not merely clutter the meter: ranked by evidence and capped at
// three, it CROWDED OUT the one pet the user could actually have answered about. With the gate,
// the same replay over the same window offers Jaber and nothing else, on 78 of those 301 events
// — every event from the moment it cleared the bar until the log itself fell silent for five
// minutes after the kill.
//
// AND THE ANIMATION CASTS SPELLS. Jaber opens with `Jaber begins casting Wrath.`, lands
// 168-point magic hits by it, casts Stun / Daring / Symbol of Ryltan, and heals itself. Anything
// that read casting or self-healing as player-shaped evidence would silently disqualify the one
// entity this whole feature exists for — so the fixture carries those lines and the first test
// below is that they change nothing.

/** Every distinct non-empty offer seen while `spans` are replayed, plus how often it stood. */
function offersDuring(spans: string[][]): { seen: Map<string, number>; endedEmpty: boolean; pets: string[] } {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  const seen = new Map<string, number>()
  let seq = 0
  let lastTs = 0
  for (const span of spans) {
    for (const raw of span) {
      const ev = parseEvent(raw, seq++)
      if (!ev) continue
      eng.ingestEvent(ev, false)
      lastTs = ev.ts
      const names = eng.snapshot(ev.ts, {}).petClaims.candidates.map((c) => c.name).join(' | ')
      if (names) seen.set(names, (seen.get(names) ?? 0) + 1)
    }
  }
  return {
    seen,
    endedEmpty: eng.snapshot(lastTs + 120_000, {}).petClaims.candidates.length === 0,
    pets: eng.petDisplayNames()
  }
}

test('P2: the animation CASTS SPELLS and HEALS ITSELF — and is still the question', { skip: skipArc }, () => {
  // The fixture must actually contain the evidence, or the test below is vacuous.
  assert.ok(P2.some((l) => /\] Jaber begins casting Wrath\.$/.test(l)), 'it casts')
  assert.ok(P2.some((l) => /\] Jaber hit .* points of magic damage by Wrath\.$/.test(l)), 'its spell lands')
  assert.ok(P2.some((l) => /\] Jaber healed himself for \d+ hit points by Daring\.$/.test(l)), 'it self-heals')
  // A self-heal is NOT player evidence in this log (routing.ts noteHealEvidence takes the healer
  // only when the heal LANDS ON the owner or a known player), and a cast is evidence of nothing
  // at all here. So the animation qualifies on exactly the behaviour the bars describe.
  const { seen } = offersDuring([P2])
  assert.deepEqual([...seen.keys()], ['Jaber'], 'one question, and it names the right entity')
  assert.ok((seen.get('Jaber') ?? 0) >= 50, `${seen.get('Jaber') ?? 0} events with the offer standing`)
})

test('P2: the tell RETIRES the question, and the second pet never becomes one', { skip: skipArc }, () => {
  // 12:43:12 `Jaber told you, 'Attacking a greater kobold Master.'` binds it; 12:44:45 a second
  // Kintaz cast makes Gonekn, whose own tell arrives six seconds later — too fast to ever clear
  // a bar. The offer is an unbound-state offer, so both are gone from it by construction.
  assert.equal(P2.filter((l) => /told you, 'Attacking a greater kobold Master\.'$/.test(l)).length, 2)
  const { seen, endedEmpty, pets } = offersDuring([P2])
  assert.equal(seen.has('Gonekn'), false, 'a pet bound three seconds after its first swing is never asked about')
  assert.equal(endedEmpty, true, 'and nothing is still being asked at the end of the arc')
  assert.ok(pets.includes('Gonekn'), 'the replacement is bound, by its own tell')
  // OBSERVED AND DELIBERATELY NOT FROZEN (JOS-49 measurement, reported for a follow-up): the
  // single-pet invariant does NOT fire between two SUMMONED pets. `world.claim()` retires
  // nothing — only `world.charm()` does — and no line in this span says Jaber went away, so both
  // animations stand as live pets after 12:44:51. It costs this feature nothing (an offer is an
  // unbound-state offer and both are bound), and correcting it means changing pet ATTRIBUTION in
  // world.ts, which is a different ticket. Asserting `pets` exactly here would freeze the gap.
})

test('P2: nothing from earlier in the log survives into this window — the whole point', { skip: skipArc || skipWall }, () => {
  // THE REGRESSION, stated as the owner experienced it. Prepending two earlier sessions is a
  // miniature of the startup replay: before the currency gate their candidates carried forward
  // and, ranked by evidence, took all three offer slots away from the pet actually on screen.
  const alone = offersDuring([P2])
  const withHistory = offersDuring([W46, P1, P2])
  assert.deepEqual(
    [...withHistory.seen.keys()].filter((k) => !/^(Kober|Dranix|Jaber)$/.test(k)),
    [],
    'no offer combining sessions ever appears'
  )
  // Each session asks about its OWN pet while that pet is current, and about nothing else. The
  // count for Jaber is identical with and without two days of history in front of it — which is
  // the arithmetic form of "the historical wall cannot crowd out the live question".
  assert.equal(withHistory.seen.get('Jaber'), alone.seen.get('Jaber'))
  assert.equal(withHistory.endedEmpty, true)
})

test('P1: the tell alone would ALSO have worked — the claim is a backstop, not a replacement', { skip }, () => {
  // Sanity on the other side of the convergence: with no claim at all, an ordinary tell binds
  // the same pet the same way. The feature adds a rung to the ladder; it does not move one.
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  const tell = parseEvent(`[Thu Jul 30 16:10:11 2026] Kober told you, 'Attacking a sonic bat Master.'`, seq++)
  eng.ingestEvent(tell!, false)
  let lastTs = 0
  for (const raw of P1) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  assert.equal(petTotals(allSessions(eng, lastTs)).total, 1966)
  assert.deepEqual(eng.snapshot(lastTs + 120_000, {}).petClaims.candidates, [])
})
