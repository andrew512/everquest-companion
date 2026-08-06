// THE SINGLE-PET INVARIANT FOR SUMMONED PETS (JOS-54) — AGENTS.md world-model law 4.
//
// You get one class pet, and re-summoning despawns the one you had. The log says NOTHING when
// that happens: no death line, no fade, no farewell. The only evidence that ever arrives is the
// successor's own `… Master.'` tell — so the claim that binds the new pet has to be the thing
// that retires the old one, or nothing ever does.
//
// Nothing did. `world.charm()` does not retire a prior pet either (the brief that opened this
// ticket assumed it did; it does not — succession across CHARM lives in modules/buffs.ts, at the
// buff-entity level, and never reached the combat world model). MEASURED before the fix, by
// replaying the owner's whole log (1,404,464 lines, 3,175 claim tells) through the real engine:
// the world model finished holding TWENTY-THREE simultaneously live summoned pets — every
// animation the owner had ordered since Jul 19 — each of them still eligible to have damage
// attributed to it. tests/fixtures/p2-pet-arc-bound.log is the same defect in one window, and
// petClaimWindows.test.mts freezes the corrected behaviour there.
//
// WHAT THIS BATTERY PINS, and why each rule is the shape it is:
//   1. IDEMPOTENCE SURVIVES. A pet re-tells you every few seconds; a claim for the pet you
//      already have is a no-op, not a succession against itself. This rule predates the ticket.
//   2. A NEW summoned claim retires the prior SUMMONED pet — instance-level retirement, so
//      everything already attributed to it stays attributed to it.
//   3. …and it stops being yours for the FUTURE: its later swings are nobody's, which is the
//      whole point (the engine's `petNames` index has to follow the world model out).
//   4. CHARMED PETS ARE NOT TOUCHED, in either direction. Measured: the log has no case of a
//      class pet and a charmed pet demonstrably alive together, and none of one replacing the
//      other, so the crossover gets no invented rule (see retirePriorSummoned's header).
//   5. The everCharmed re-arm is unchanged: a tell from a name a charm broadcast has named goes
//      through charm(), binds CHARMED, and leaves a live summoned pet alone.
//   6. Zoning is unchanged: the summoned pet walks through, the charmed one does not — and a
//      claim on the other side still retires the survivor.
//
// Synthetic lines in the real log's exact shapes (the controlled two-pet sequences these need
// are what the committed fixture supplies only once), plus one engine-level attribution check.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { installCharacterName } from '../src/main/log/rulesets'
import { CombatEngine } from '../src/main/combat/engine'
import { WorldModel } from '../src/main/combat/world'
import type { SegmentView } from '../src/shared/combat'

// The tailed character, as session.ts injects it before a replay. Only the `/pet who leader` rule
// reads it here (JOS-52) — none of the synthetic lines below is a `/who` row.
installCharacterName('Primitive')

// ── the pure model ─────────────────────────────────────────────────────────────────────────

const live = (w: WorldModel): string[] => w.petInstances().map((i) => `${i.display}/${i.petKind ?? '?'}`).sort()

test('a repeat claim for the pet you already have is a NO-OP, not a succession', () => {
  const w = new WorldModel()
  const first = w.claim('Jaber', 1_000)
  const again = w.claim('Jaber', 9_000)
  assert.equal(again.instanceId, first.instanceId, 'one entity, however many tells it sends')
  assert.equal(again.lastSeenTs, 9_000, 'the repeat still refreshes it')
  assert.deepEqual(live(w), ['Jaber/summoned'])
  assert.equal(w.isRetired(first.instanceId), false)
})

test('a claim and a later tell converge on ONE pet even when a hostile instance came first', () => {
  // The p2 shape: mobs swinging at the animation resolve an instance of its name before its own
  // tell arrives, so the claim binds that instance rather than spawning beside it.
  const w = new WorldModel()
  const seen = w.resolve('Jaber', 1_000)
  const claimed = w.claim('Jaber', 2_000)
  assert.equal(claimed.instanceId, seen.instanceId)
  assert.equal(claimed.petKind, 'summoned')
  assert.deepEqual(live(w), ['Jaber/summoned'])
})

test('claiming a NEW summoned pet retires the prior one', () => {
  const w = new WorldModel()
  const jaber = w.claim('Jaber', 1_000)
  const gonekn = w.claim('Gonekn', 60_000)
  assert.deepEqual(live(w), ['Gonekn/summoned'], 'one pet at a time')
  assert.equal(w.isRetired(jaber.instanceId), true, 'the prior pet is retired')
  assert.equal(w.isRetired(gonekn.instanceId), false)
  assert.equal(w.isLivePet(jaber.instanceId), false, '…and no longer a live pet for closure either')
})

test('RETIREMENT, NOT DELETION: the old pet keeps its identity, its label and its history', () => {
  const w = new WorldModel()
  const jaber = w.claim('Jaber', 1_000)
  const before = { id: jaber.instanceId, label: w.label(jaber), first: jaber.firstSeenTs }
  w.claim('Gonekn', 60_000)
  // Same object, same instance id, same first-seen — aggregates key by instanceId, so every row
  // already booked against it reads exactly as it did. Only `retired` and the pet flags moved.
  assert.equal(jaber.instanceId, before.id)
  assert.equal(w.label(jaber), before.label)
  assert.equal(jaber.firstSeenTs, before.first)
  assert.equal(jaber.charmed, false)
  assert.equal(jaber.petKind, undefined)
})

test('a third pet retires the second, and never revives the first', () => {
  const w = new WorldModel()
  const a = w.claim('Jaber', 1_000)
  const b = w.claim('Gonekn', 60_000)
  const c = w.claim('Labann', 120_000)
  assert.deepEqual(live(w), ['Labann/summoned'])
  for (const gone of [a, b]) assert.equal(w.isRetired(gone.instanceId), true)
  assert.equal(w.isRetired(c.instanceId), false)
})

// ── the crossover: charmed pets are somebody else's question ───────────────────────────────

test('a summoned claim does NOT retire a live CHARMED pet', () => {
  const w = new WorldModel()
  const charmed = w.charm('an ice giant', 1_000)
  const summoned = w.claim('Gonekn', 60_000)
  assert.deepEqual(live(w), ['Gonekn/summoned', 'an ice giant/charmed'])
  assert.equal(w.isRetired(charmed.instanceId), false, 'no line said the charmed mob went away')
  assert.equal(w.isRetired(summoned.instanceId), false)
})

test('…and a charm does not retire a live SUMMONED pet either (charm() is untouched)', () => {
  const w = new WorldModel()
  const summoned = w.claim('Gonekn', 1_000)
  const charmed = w.charm('an ice giant', 60_000)
  assert.deepEqual(live(w), ['Gonekn/summoned', 'an ice giant/charmed'])
  assert.equal(w.isRetired(summoned.instanceId), false)
  assert.equal(w.isRetired(charmed.instanceId), false)
})

test('a summoned succession leaves the charmed pet standing', () => {
  const w = new WorldModel()
  const charmed = w.charm('an ice giant', 1_000)
  const jaber = w.claim('Jaber', 30_000)
  w.claim('Gonekn', 60_000)
  assert.deepEqual(live(w), ['Gonekn/summoned', 'an ice giant/charmed'])
  assert.equal(w.isRetired(jaber.instanceId), true, 'only the summoned predecessor retires')
  assert.equal(w.isRetired(charmed.instanceId), false)
})

// ── zoning ─────────────────────────────────────────────────────────────────────────────────

test('zoning is unchanged — the summoned pet walks through, the charmed one does not', () => {
  const w = new WorldModel()
  const summoned = w.claim('Gonekn', 1_000)
  const charmed = w.charm('an ice giant', 2_000)
  const survivors = w.zone(3_000)
  assert.deepEqual(survivors.map((i) => i.instanceId), [summoned.instanceId])
  assert.equal(w.isRetired(summoned.instanceId), false)
  assert.equal(w.isRetired(charmed.instanceId), true)
})

test('a claim on the far side of a zone retires the pet that came through with you', () => {
  const w = new WorldModel()
  const gonekn = w.claim('Gonekn', 1_000)
  w.zone(2_000)
  const labann = w.claim('Labann', 3_000)
  assert.deepEqual(live(w), ['Labann/summoned'])
  assert.equal(w.isRetired(gonekn.instanceId), true)
  assert.equal(w.isRetired(labann.instanceId), false)
})

// ── through the engine: the retired pet's damage stops being yours ─────────────────────────

const TELL = (t: string, name: string): string =>
  `[Thu Aug 06 ${t} 2026] ${name} told you, 'Attacking a greater kobold Master.'`
/** The `/pet who leader` answer (JOS-52) — the log's other binding line, in its one real shape. */
const LEADER = (t: string, name: string, leader = 'Primitive'): string =>
  `[Thu Aug 06 ${t} 2026] ${name} says, 'My leader is ${leader}.'`
const SWING = (t: string, name: string, amount: number): string =>
  `[Thu Aug 06 ${t} 2026] ${name} slashes a greater kobold for ${amount} points of damage.`

function replay(lines: string[]): { eng: CombatEngine; lastTs: number } {
  const eng = new CombatEngine()
  eng.setPlayerName('Primitive')
  let seq = 0
  let lastTs = 0
  for (const raw of lines) {
    const ev = parseEvent(raw, seq++)
    if (!ev) continue
    eng.ingestEvent(ev, false)
    lastTs = ev.ts
  }
  return { eng, lastTs }
}

function petRows(eng: CombatEngine, lastTs: number): Map<string, { hits: number; total: number }> {
  const now = lastTs + 120_000
  const out = new Map<string, { hits: number; total: number }>()
  const views: SegmentView[] = []
  for (const zs of eng.snapshot(now, {}).zoneSessions) {
    const s = eng.snapshot(now, { selectedId: zs.id }).selected
    if (s) views.push(s)
  }
  for (const v of views)
    for (const e of v.entities) {
      if (e.kind !== 'pet') continue
      const name = e.name.replace(/\s+\(\d+\)$/, '')
      const row = out.get(name) ?? { hits: 0, total: 0 }
      row.hits += e.hits
      row.total += e.total
      out.set(name, row)
    }
  return out
}

test('the retired pet keeps what it earned and earns nothing more', () => {
  // Jaber swings twice as your pet, Gonekn's tell replaces it, then BOTH swing. Only Gonekn's
  // is yours. Jaber's first two hits are untouched — retirement ends a future, not a past.
  const { eng, lastTs } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    TELL('12:36:00', 'Jaber'),
    SWING('12:36:02', 'Jaber', 40),
    SWING('12:36:04', 'Jaber', 60),
    TELL('12:37:00', 'Gonekn'),
    SWING('12:37:02', 'Gonekn', 30),
    SWING('12:37:04', 'Jaber', 999),
    SWING('12:37:06', 'Gonekn', 70)
  ])
  const rows = petRows(eng, lastTs)
  assert.deepEqual(rows.get('Jaber'), { hits: 2, total: 100 }, 'the 999 after the succession is not yours')
  assert.deepEqual(rows.get('Gonekn'), { hits: 2, total: 100 })
  assert.deepEqual(eng.petDisplayNames(), ['Gonekn'], 'one pet')
})

test('the succession is measured to cost NOTHING on the real log', () => {
  // The rule above is only safe because the game despawns the old pet before the new one's tell
  // ever arrives. Whole-log measurement, JOS-54: the invariant fires 23 times and the pet it
  // retires lands zero further damage lines — not in five minutes, not ever. This test is the
  // shape of that claim in miniature: a pet that goes on swinging after its successor's tell is
  // a shape the log has never printed, and the assertion above states what we do if it ever is.
  const { eng } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    TELL('12:36:00', 'Jaber'),
    SWING('12:36:02', 'Jaber', 40),
    TELL('12:37:00', 'Gonekn'),
    SWING('12:37:02', 'Gonekn', 30)
  ])
  assert.deepEqual(eng.petDisplayNames(), ['Gonekn'])
})

test('the everCharmed re-arm still wins: an ever-charmed name binds CHARMED, beside your pet', () => {
  // AGENTS.md: "a pet-claim tell from a name EVER seen charmed re-arms the charmed set, never the
  // permanent one." The tell for `an ice giant` takes the PROMOTE path (world.charm), so it is
  // not a summoned claim at all — and the live class pet is therefore untouched.
  const { eng } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    TELL('12:36:00', 'Gonekn'),
    `[Thu Aug 06 12:36:30 2026] an ice giant has been charmed.`,
    `[Thu Aug 06 12:36:40 2026] an ice giant told you, 'Attacking a greater kobold Master.'`
  ])
  assert.deepEqual(eng.petDisplayNames().sort(), ['Gonekn', 'an ice giant'])
  assert.deepEqual(eng.charmedPetNames(), ['an ice giant'], 'promoted as CHARMED, not summoned')
})

// ── `/pet who leader`: the same rules, because it is the same event (JOS-52) ────────────────
//
// `<Name> says, 'My leader is <You>.'` parses to `petClaim` with `via: 'leader'` — the one
// canonical event both binding lines produce. That is the whole design, and this block is what
// makes it a fact rather than an intention: every rule above is re-run through the say, and none
// of them is re-implemented anywhere to make it pass.

test('a leader say binds a never-ordered pet, and retires the pet you had (JOS-54 path)', () => {
  // The ticket's own case: a player who never types `/pet attack` asks instead. Jaber is bound by
  // asking, Gonekn replaces it by asking, and the succession fires exactly as it does for tells —
  // including the retired pet's later swing going back to being nobody's.
  const { eng, lastTs } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    LEADER('12:36:00', 'Jaber'),
    SWING('12:36:02', 'Jaber', 40),
    SWING('12:36:04', 'Jaber', 60),
    LEADER('12:37:00', 'Gonekn'),
    SWING('12:37:02', 'Gonekn', 30),
    SWING('12:37:04', 'Jaber', 999),
    SWING('12:37:06', 'Gonekn', 70)
  ])
  const rows = petRows(eng, lastTs)
  assert.deepEqual(rows.get('Jaber'), { hits: 2, total: 100 }, 'the 999 after the succession is not yours')
  assert.deepEqual(rows.get('Gonekn'), { hits: 2, total: 100 })
  assert.deepEqual(eng.petDisplayNames(), ['Gonekn'], 'one pet at a time, however it was bound')
})

test('a leader say binds FORWARD, not backward — same limit as the tell', () => {
  // `ingestPetClaim` binds from the line's own timestamp and nothing reaches back, so asking LATE
  // costs exactly what ordering late costs (petClaimWindows.test.mts measures that on the owner's
  // real window). Ask before the first swing and you keep all of it.
  const late = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    SWING('12:36:02', 'Jaber', 500),
    LEADER('12:36:30', 'Jaber'),
    SWING('12:36:40', 'Jaber', 60)
  ])
  assert.deepEqual(petRows(late.eng, late.lastTs).get('Jaber'), { hits: 1, total: 60 })

  const early = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    LEADER('12:35:30', 'Jaber'),
    SWING('12:36:02', 'Jaber', 500),
    SWING('12:36:40', 'Jaber', 60)
  ])
  assert.deepEqual(petRows(early.eng, early.lastTs).get('Jaber'), { hits: 2, total: 560 })
})

test('an ever-charmed name saying you are its leader re-arms the CHARMED set, not the permanent one', () => {
  // The PROMOTE path, reached through the say. A charmed mob can be asked `/pet who leader` like
  // any other pet, and if the answer bound it as SUMMONED it would follow you through every zone
  // line for the rest of the session, crediting its kills to you forever.
  const { eng } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    LEADER('12:36:00', 'Gonekn'),
    `[Thu Aug 06 12:36:30 2026] an ice giant has been charmed.`,
    LEADER('12:36:40', 'an ice giant')
  ])
  assert.deepEqual(eng.petDisplayNames().sort(), ['Gonekn', 'an ice giant'])
  assert.deepEqual(eng.charmedPetNames(), ['an ice giant'], 'promoted as CHARMED, not summoned')
  // …and, being charmed, it does NOT walk through a zone line with you, while the class pet does.
  const zoned = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    LEADER('12:36:00', 'Gonekn'),
    `[Thu Aug 06 12:36:30 2026] an ice giant has been charmed.`,
    LEADER('12:36:40', 'an ice giant'),
    `[Thu Aug 06 12:37:00 2026] You have entered Solusek's Eye.`
  ])
  assert.deepEqual(zoned.eng.petDisplayNames(), ['Gonekn'])
})

test('a leader say naming SOMEBODY ELSE binds nothing and retires nothing', () => {
  // The line is broadcast, so a stranger's pet three feet away prints this shape naming ITS owner.
  // Two things have to hold: it must not bind that pet, and it must not count as a succession
  // against the pet you do have — a rule that fired on the shape alone would silently un-own your
  // own pet every time somebody nearby ran the command.
  const { eng, lastTs } = replay([
    `[Thu Aug 06 12:35:28 2026] You have entered Nagafen's Lair.`,
    LEADER('12:36:00', 'Gonekn'),
    SWING('12:36:02', 'Gonekn', 30),
    LEADER('12:36:30', 'Vebarn', 'Rykkerr'),
    SWING('12:36:40', 'Gonekn', 70),
    SWING('12:36:42', 'Vebarn', 999)
  ])
  assert.deepEqual(eng.petDisplayNames(), ['Gonekn'], 'still exactly one pet, and still yours')
  const rows = petRows(eng, lastTs)
  assert.deepEqual(rows.get('Gonekn'), { hits: 2, total: 100 })
  assert.equal(rows.has('Vebarn'), false, "the stranger's pet earns no row")
})
