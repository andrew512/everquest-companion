// GOLDEN WINDOW — THE MOB THAT "HEALED YOU" (JOS-48). tests/fixtures/p1-unbound-pet.log, the
// same twenty real minutes JOS-47 cut (log lines 491470..493040, Thu Jul 30 16:10:10 → 16:30:24),
// replayed with one SYNTHESIZED heal line dropped into the middle of a pull.
//
// ── WHY ONE LINE IS SYNTHESIZED, AND WHY THAT IS NOT A GUESS ────────────────────────────────
//
// The defect arrived in a user's feedback slice (01KZBV8WFC8PD7DNASTJ5S5CWZ), whose bytes CANNOT
// become a fixture: .gitignore says of `.triage/` that those slices "are a user's own game log;
// they are read locally and never enter git or a public issue". The owner's own 1.4M-line log
// cannot reproduce it either, and that is a fact rather than an excuse — all 116 of its
// `<X> healed you for N hit points` lines come from a group-mate, a summoned pet of his own, or
// a mob he had CHARMED, and the charmed ones are already refused by charmModel's `everCharmed`.
// He has never been lifetapping a raid mob while a pet fought it.
//
// So the WINDOW is the owner's real log, verbatim and committed, and the one sentence the window
// lacks is injected as a parsed event — exactly the move petClaimWindows.test.mts makes with the
// `… Master.'` tell. The sentence is quoted from the slice, where it appeared seven times in two
// different pulls, and it is the reporter's grammar unchanged apart from the mob's name:
//
//     [19:17:41] You hit Lord of Loathing for 941 points of unresistable damage by Harm Touch X.
//     [19:17:43] Lord of Loathing has taken 509 damage from your Harm Touch X. (Critical)
//     [19:17:43] Your life force drains away.
//     [19:17:43] Lord of Loathing healed you for 509 hit points by Leech Touch I.
//
// The "healer" is the mob being DRAINED. `noteHealEvidence` read that as proof of a player, filed
// a raid mob as one, and from that instant `classify()` dropped every pet swing at it. Measured
// on the slice with the reporter's pet claimed: 24 hits / 964 points before, 42 / 1,362 after —
// 18 hits and 398 points of one pet's work in one pull, on a mob it never stopped hitting.
//
// ── WHAT THIS WINDOW PINS ───────────────────────────────────────────────────────────────────
//   1. the mob keeps its damage — the claimed pet's totals are byte-identical to the control,
//      for an ARTICLE-named mob (`a fire giant warrior`) and a PROPER-named one (`Guard Effel`),
//      because the refusal is behavioural and no catalog is consulted;
//   2. heal ROUTING is untouched — the injected heal still lands in the healing ledger under the
//      mob's name, with its full amount. The ticket is about who an entity IS, not about
//      accounting;
//   3. the NEGATIVE control — the same sentence spoken by a name the owner never struck (his own
//      unbound pet Kober) still files that name as a player, and the meter stops offering it.
//      The inference is narrowed, not deleted.
//
// Fixture-guarded: `readFixture` returns [] when the file is absent, and every test skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { CombatEngine } from '../src/main/combat/engine'
import type { PetClaimsView } from '../src/shared/petClaims'
import type { SegmentView } from '../src/shared/combat'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (name: string): string[] => {
  const p = join(FIXTURES, name)
  return existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.length > 0) : []
}
const P1 = read('p1-unbound-pet.log')
const skip = P1.length === 0 ? 'fixture not present' : false

/** The pet-claim view for a character who has said yes to Kober (JOS-47's shipped answer). */
const KOBER: PetClaimsView = {
  claimed: new Set(['kober']),
  denied: new Set(),
  nameOf: (k) => (k === 'kober' ? 'Kober' : undefined)
}

/**
 * The reporter's sentence, with the mob's name swapped for one in this window. `Leech Touch I`
 * is kept verbatim: the spell is the player's OWN lifetap, and naming it is what makes the shape
 * traceable to the slice it came from.
 */
function lifetap(stamp: string, mob: string): string {
  return `[Thu Jul 30 ${stamp} 2026] ${mob} healed you for 509 hit points by Leech Touch I.`
}

/** Replay the window, optionally INJECTING one extra raw line at its own timestamp. */
function replay(inject?: string): { eng: CombatEngine; lastTs: number } {
  const extra = inject === undefined ? null : parseEvent(inject, 0)
  assert.ok(inject === undefined || extra, 'the injected line must parse')
  let pending = extra
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  eng.setPetClaims(() => KOBER)
  let seq = 1
  let lastTs = 0
  for (const raw of P1) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    if (pending && ev.ts >= pending.ts) {
      eng.ingestEvent({ ...pending, seq: seq++ }, false)
      pending = null
    }
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  if (pending) eng.ingestEvent({ ...pending, seq: seq++ }, false)
  return { eng, lastTs }
}

/** Every zone session's view — the window crosses five zone lines and a summoned pet walks
 *  through all of them, so "what did the pet do" is only answerable across the set. */
function allSessions(eng: CombatEngine, lastTs: number): SegmentView[] {
  const now = lastTs + 120_000
  const out: SegmentView[] = []
  for (const zs of eng.snapshot(now, {}).zoneSessions) {
    const s = eng.snapshot(now, { selectedId: zs.id }).selected
    if (s) out.push(s)
  }
  return out
}

function petTotals(views: SegmentView[]): { total: number; hits: number } {
  let total = 0
  let hits = 0
  for (const v of views)
    for (const e of v.entities)
      if (e.kind === 'pet') {
        total += e.total
        hits += e.hits
      }
  return { total, hits }
}

// ── 0. THE WINDOW SAYS WHAT THIS TEST THINKS IT SAYS ───────────────────────────────────────

test('LT: the window really is a pet and the owner fighting the same two mobs', { skip }, () => {
  // The article-named mob: the owner hits it, it hits the owner, and the pet works on it for a
  // minute. The proper-named one is the same story in miniature, and is here because it is the
  // case a mob catalog would NOT cover.
  const kob = (mob: string): number =>
    P1.filter((l) => new RegExp(`\\] Kober [a-z]+ ${mob} for \\d+ points? of damage\\.$`).test(l)).length
  assert.equal(kob('a fire giant warrior'), 45)
  assert.equal(kob('Guard Effel'), 4)
  assert.ok(P1.some((l) => /\] You .* a fire giant warrior for \d+ points/.test(l)), 'you struck the giant')
  assert.ok(P1.some((l) => /\] Guard Effel is burned by YOUR flames/.test(l)), 'you struck the guard')
  // …and neither of them is bound to the owner by anything: no charm broadcast, no tell. The
  // `everCharmed` guard that protects the owner's own charmed healers cannot help here.
  assert.equal(P1.filter((l) => /has been charmed\.$/.test(l)).length, 0)
})

// ── 1. THE MOB KEEPS ITS DAMAGE ────────────────────────────────────────────────────────────

test('LT: an ARTICLE-named mob that lifetaps you is still a mob', { skip }, () => {
  // Injected at 16:28:45, three seconds into the fire giant pull and six seconds before the pet's
  // next swing. Before the fix this filed `a fire giant warrior` as a KNOWN PLAYER and every
  // later pet swing at it was dropped at the admission gate: this window reported 64 hits /
  // 1,198 points instead of 105 / 1,966 — 41 hits and 768 points of a claimed pet's work gone
  // from one injected sentence.
  const control = replay()
  const tapped = replay(lifetap('16:28:45', 'a fire giant warrior'))
  const b = petTotals(allSessions(control.eng, control.lastTs))
  const a = petTotals(allSessions(tapped.eng, tapped.lastTs))
  assert.deepEqual(a, b)
  // Stated absolutely as well as relatively, so a future change cannot move both together:
  // JOS-47's hand-read total for this claimed pet, unchanged.
  assert.equal(a.hits, 105)
  assert.equal(a.total, 1966)
})

test('LT: a PROPER-named mob is too — this is behaviour, not a catalog lookup', { skip }, () => {
  // `Guard Effel` is a named guard, not an article-named mob, and the shipped mobs catalog is
  // never consulted. What makes it a mob is that the owner is burning it with a damage shield.
  // Pre-fix this window reported 103 hits / 1,899 points — the two swings the pet still had
  // left in that short exchange, 67 points, deleted.
  const control = replay()
  const tapped = replay(lifetap('16:10:16', 'Guard Effel'))
  assert.deepEqual(
    petTotals(allSessions(tapped.eng, tapped.lastTs)),
    petTotals(allSessions(control.eng, control.lastTs))
  )
})

test('LT: two lifetaps in one session, one from each mob, still move nothing', { skip }, () => {
  const control = petTotals(allSessions(...Object.values(replay()) as [CombatEngine, number]))
  const first = replay(lifetap('16:10:16', 'Guard Effel'))
  const both = replay(lifetap('16:28:45', 'a fire giant warrior'))
  assert.deepEqual(petTotals(allSessions(first.eng, first.lastTs)), control)
  assert.deepEqual(petTotals(allSessions(both.eng, both.lastTs)), control)
})

// ── 2. HEAL ROUTING IS UNTOUCHED ───────────────────────────────────────────────────────────

test('LT: the heal itself is still counted, in full, under the mob that printed it', { skip }, () => {
  // The ticket is about WHO an entity is, not about accounting: a heal landing on you is
  // incoming healing whoever the log names as its source, and 509 points of it must survive.
  const { eng, lastTs } = replay(lifetap('16:28:45', 'a fire giant warrior'))
  const rows = allSessions(eng, lastTs).flatMap((v) => v.healing.healers)
  const giant = rows.filter((r) => r.name.toLowerCase() === 'a fire giant warrior')
  assert.equal(giant.length, 1, 'one healer row, named as the log named it')
  assert.equal(giant[0].total, 509)
  // …and the control has no such row at all, so the 509 came from the injected line and
  // nothing else in the window is quietly producing it.
  const control = replay()
  const before = allSessions(control.eng, control.lastTs).flatMap((v) => v.healing.healers)
  assert.equal(before.some((r) => r.name.toLowerCase() === 'a fire giant warrior'), false)
})

// ── 3. THE NEGATIVE CONTROL: THE INFERENCE IS NARROWED, NOT DELETED ────────────────────────

test('LT: the same sentence from a name you never struck STILL files a player', { skip }, () => {
  // Kober is the owner's own unbound pet: he fights beside it for twenty minutes and never once
  // swings at it, which is precisely the evidence the new refusal reads. So a heal from Kober is
  // still player-shaped evidence, and the visible consequence is that the meter stops asking
  // "Kober — your pet?" (petCandidates disqualifies a known player).
  const asked = new CombatEngine()
  asked.setPlayerName('Primitive')
  let seq = 0
  for (const raw of P1) {
    const ev = parseEvent(raw, seq++)
    if (ev) asked.ingestEvent(ev, false)
  }
  const offered = asked.snapshot(Date.parse('2026-07-30T23:59:00Z'), {}).petClaims.candidates
  assert.deepEqual(offered.map((c) => c.name), ['Kober'], 'the question JOS-47 shipped')

  const filed = new CombatEngine()
  filed.setPlayerName('Primitive')
  let s2 = 0
  const heal = parseEvent(lifetap('16:10:11', 'Kober'), s2++)!
  filed.ingestEvent(heal, false)
  for (const raw of P1) {
    const ev = parseEvent(raw, s2++)
    if (ev) filed.ingestEvent(ev, false)
  }
  assert.deepEqual(
    filed.snapshot(Date.parse('2026-07-30T23:59:00Z'), {}).petClaims.candidates,
    [],
    'a healer of yours you have never struck is a person, and people are not offered as pets'
  )
})
