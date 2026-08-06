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
