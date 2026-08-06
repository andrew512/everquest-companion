// THE "IS THIS YOURS?" DETECTOR (JOS-47) — src/main/combat/petCandidates.ts, plus the parser
// family it runs on.
//
// The feature exists because a summoned pet that is never ORDERED sends no private tell, so
// nothing in the log says it is yours and every one of its hits is dropped at admission. The
// fix is not a cleverer guess — it is to ASK. Which makes the interesting tests the ones about
// what the app must NOT ask about, because a question in the wrong place is how a stranger's
// pet ends up on your meter (the Task #65 failure, re-run).
//
// Every line quoted below is real: the SAY sentences come from the whole-log sweep that
// enumerated the six-sentence vocabulary, and the mob flavor comes from the same sweep's
// rejects. The golden WINDOW that runs the whole thing through the real engine is
// tests/petClaimWindows.test.mts; this suite is the pure half.
//
// No Electron, no network, no fixtures — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import {
  MAX_CANDIDATES,
  MIN_HITS,
  MIN_HITS_WITH_SAY,
  MIN_SHARED_TARGETS,
  OFFER_IDLE_MS,
  PetCandidates,
  isProperName
} from '../src/main/combat/petCandidates'
import { FALLBACK_IDLE_MS } from '../src/main/combat/encounter'
import { PET_SAY_LINES } from '../src/shared/logScrub'
import type { PetSayEvent } from '../src/shared/logEvents'

// ---------------------------------------------------------------------------------------
// THE PARSER FAMILY — six sentences in, `petSay` out; everything else untouched
// ---------------------------------------------------------------------------------------

const at = (clock: string, body: string): string => `[Thu Jul 30 ${clock} 2026] ${body}`

test('every sentence in the vocabulary parses to a petSay with its own discriminant', () => {
  for (const [kind, text] of PET_SAY_LINES) {
    const ev = parseEvent(at('16:10:18', `Kober says, '${text}'`), 0)
    assert.equal(ev?.kind, 'petSay', `must parse: ${text}`)
    assert.equal((ev as PetSayEvent).name, 'Kober')
    assert.equal((ev as PetSayEvent).say, kind)
  }
})

test('a mob-named pet is the same event — the SPEAKER is never the discriminator', () => {
  // Another player's charmed pet says exactly the same words. That is the whole reason this
  // event nominates instead of binding, and the parser must not pretend otherwise.
  const ev = parseEvent(at('02:11:53', "A large heart spider says, 'Now regrouping, master.'"), 0)
  assert.equal(ev?.kind, 'petSay')
  assert.equal((ev as PetSayEvent).name, 'A large heart spider')
})

test('mob flavor that merely mentions a master is NOT a petSay', () => {
  const notPetSays = [
    "An ire ghast says, 'Uninvited guests to our master's home must be shown the way out!'",
    "Cleric of Innoruuk says, 'None shall defile the realm of our master!'",
    "A scorn banshee says, 'You are almost beneath notice, but our master commands your death.'",
    "Cleric of Innoruuk's corpse says, 'Innoruuk, I have failed you!'",
    // …and the pet sentence on any OTHER channel is a person's words, not a pet's
    "Rykkerr tells you, 'As you wish, oh great one.'",
    "Rykkerr shouts, 'Following you, Master.'"
  ]
  for (const body of notPetSays) {
    const ev = parseEvent(at('16:10:18', body), 0)
    assert.notEqual(ev?.kind, 'petSay', `must not be a petSay: ${body}`)
  }
})

test('the PRIVATE tell is still a petClaim — the two families never cross', () => {
  const tell = parseEvent(at('16:10:18', "Kober told you, 'Attacking a sonic bat Master.'"), 0)
  assert.equal(tell?.kind, 'petClaim')
})

// ---------------------------------------------------------------------------------------
// THE DETECTOR — the bars, and everything that must never clear them
// ---------------------------------------------------------------------------------------

/** Land `n` hits from `name` on `target` at one-second intervals from `t0`. */
function hits(c: PetCandidates, name: string, blow: { on: string; n: number; t0?: number }): void {
  for (let i = 0; i < blow.n; i++) {
    c.noteHit({ key: name.toLowerCase(), name, targetKey: blow.on, amount: 10, ts: (blow.t0 ?? 1_000) + i * 1000 })
  }
}

/** The log clock `behavioural()` leaves behind — its candidate's last landed hit. Stated so the
 *  currency-gate tests can walk time from a known point instead of recomputing the fixture. */
const BEHAVIOURAL_LAST = 1_000 + MIN_HITS * 1_000

/** The minimum honest behavioural case: two shared targets and the hit volume. */
function behavioural(): PetCandidates {
  const c = new PetCandidates()
  c.noteYourTarget('a sonic bat', 1_000)
  c.noteYourTarget('a noxious spider', 2_000)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS })
  hits(c, 'Kober', { on: 'a noxious spider', n: 1, t0: BEHAVIOURAL_LAST })
  return c
}

test('a pet-shaped entity that keeps killing what you kill is worth asking about', () => {
  const [c] = behavioural().candidates()
  assert.equal(c.name, 'Kober')
  assert.equal(c.why, 'target')
  assert.equal(c.sharedTargets, 2)
  assert.equal(c.hits, MIN_HITS + 1)
  assert.equal(c.damage, (MIN_HITS + 1) * 10)
})

test('ONE shared target is a coincidence, however many hits it lands', () => {
  // Everybody in a contested camp shares one mob. Following you to a SECOND one is what a pet
  // does, and it is the only evidence that ties the entity to YOU rather than to the player
  // standing next to you — which is why a say does not lower this bar either.
  const c = new PetCandidates()
  c.noteYourTarget('a sonic bat', 1_000)
  hits(c, 'Stranger', { on: 'a sonic bat', n: MIN_HITS * 5 })
  assert.equal(c.candidates().length, 0)
  c.noteSay('stranger', 'Stranger', 2_000)
  assert.equal(c.candidates().length, 0, 'a say must not substitute for the shared target')
  assert.equal(MIN_SHARED_TARGETS, 2)
})

test('a pet that SPOKE needs far less behavioural proof — that is what the say buys', () => {
  const c = new PetCandidates()
  c.noteYourTarget('a sonic bat', 1_000)
  c.noteYourTarget('a noxious spider', 2_000)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS_WITH_SAY })
  hits(c, 'Kober', { on: 'a noxious spider', n: 1 })
  assert.equal(c.candidates().length, 0, 'below the behavioural bar and silent → no question')
  c.noteSay('kober', 'Kober', 3_000)
  const [got] = c.candidates()
  assert.equal(got.why, 'say')
  assert.equal(got.says, 1)
  assert.ok(got.hits < MIN_HITS, 'the point of the say tier is that it clears a lower bar')
})

test('a target you engage LATER still counts — the pet opened before your first swing', () => {
  // A pet routinely lands the first blow. Crediting the shared target only forward would have
  // made the very entity this feature exists for look like a passer-by.
  const c = new PetCandidates()
  c.noteYourTarget('a sonic bat', 1_000)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS })
  hits(c, 'Kober', { on: 'a fire giant warrior', n: 5 })
  assert.equal(c.candidates().length, 0)
  c.noteYourTarget('a fire giant warrior', 9_000)
  assert.equal(c.candidates()[0]?.sharedTargets, 2)
})

test('AN ARTICLE NAME IS A MOB — the whole namespace, excluded in one rule', () => {
  const c = new PetCandidates()
  c.noteYourTarget('a sonic bat', 1_000)
  c.noteYourTarget('a noxious spider', 2_000)
  hits(c, 'a fire giant warrior', { on: 'a sonic bat', n: MIN_HITS })
  hits(c, 'a fire giant warrior', { on: 'a noxious spider', n: 5 })
  c.noteSay('a fire giant warrior', 'a fire giant warrior', 3_000)
  assert.equal(c.candidates().length, 0)
  assert.equal(isProperName('a fire giant warrior'), false)
  assert.equal(isProperName('An isle goblin'), false)
  assert.equal(isProperName('The Hand of Veeshan'), false)
  assert.equal(isProperName('Kober'), true)
  assert.equal(isProperName('Guard Effel'), true)
})

test('a name YOU attacked is never offered — you do not swing at your own pet', () => {
  const c = behavioural()
  assert.equal(c.candidates().length, 1)
  c.noteYourTarget('kober', 5_000)
  assert.equal(c.candidates().length, 0, 'and the disqualification is permanent')
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS * 3, t0: 6_000 })
  assert.equal(c.candidates().length, 0)
})

test('a disqualified name cannot be resurrected by a later say, either', () => {
  const c = behavioural()
  c.disqualify('kober')
  c.noteSay('kober', 'Kober', 9_000)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS, t0: 9_000 })
  assert.equal(c.candidates().length, 0)
})

test('a DENIED name is filtered at read time, so clearing the no gives the evidence back', () => {
  const c = behavioural()
  assert.equal(c.candidates(new Set(['kober'])).length, 0)
  assert.equal(c.candidates().length, 1, 'the evidence was never thrown away, only hidden')
})

test('the offer list is capped and ranks a spoken candidate above a silent one', () => {
  const c = new PetCandidates()
  for (const t of ['m1', 'm2']) c.noteYourTarget(t, 1_000)
  // four behavioural candidates, descending damage; the quietest one also SPOKE
  for (const [i, name] of ['Aa', 'Bb', 'Cc', 'Dd'].entries()) {
    for (const t of ['m1', 'm2']) {
      for (let k = 0; k < MIN_HITS; k++) {
        c.noteHit({ key: name.toLowerCase(), name, targetKey: t, amount: 100 - i * 10, ts: 2_000 + k })
      }
    }
  }
  c.noteSay('dd', 'Dd', 3_000)
  const got = c.candidates()
  assert.equal(got.length, MAX_CANDIDATES)
  assert.equal(got[0].name, 'Dd', 'the one that spoke goes first, whatever it hit for')
  assert.equal(got[0].why, 'say')
  assert.equal(got[1].name, 'Aa', 'then by the damage the user is missing most')
})

test('release() retires a question for good — a bound pet is never also a candidate', () => {
  const c = behavioural()
  assert.equal(c.candidates().length, 1)
  c.release('kober')
  assert.equal(c.candidates().length, 0)
  assert.equal(c.idle, true)
})

test('reset() forgets everything, including your target set', () => {
  const c = behavioural()
  c.reset()
  assert.equal(c.idle, true)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS })
  assert.equal(c.candidates().length, 0, 'the shared targets went with it')
})

// ---------------------------------------------------------------------------------------
// THE CURRENCY GATE (JOS-49) — a question is only worth asking about the fight in front of you
//
// The evidence bars above have no notion of time, so on the ordinary startup replay every
// never-ordered pet since the beginning of the log became a standing question: 101 of them at
// the end of the owner's real log, the strongest three last seen six, nine and two DAYS earlier.
// These are the rules that make that structurally impossible. `hits()` lands at one-second
// intervals from t0, so a stated t0 is a stated log clock.
// ---------------------------------------------------------------------------------------

test('the offer window IS the engine’s own fight-is-over window — one number, not two', () => {
  // Not a tuned constant: the offer lives exactly as long as the fight it is a question about.
  assert.equal(OFFER_IDLE_MS, FALLBACK_IDLE_MS)
})

test('a candidate that stops fighting while the log goes on ages OUT of the offer', () => {
  const c = behavioural()
  assert.equal(c.candidates().length, 1, 'it qualified while it was swinging')
  // Walk the log clock past the window with events that are not its own — which is the whole
  // point: silence is only visible against progress.
  const last = BEHAVIOURAL_LAST
  c.observe(last + OFFER_IDLE_MS)
  assert.equal(c.candidates().length, 1, 'exactly at the boundary it is still current')
  c.observe(last + OFFER_IDLE_MS + 1)
  assert.equal(c.candidates().length, 0, 'and a millisecond past it, the question is not about now')
})

test('…and aging out is NOT a deny — one more hit brings back the whole history', () => {
  const c = behavioural()
  const last = BEHAVIOURAL_LAST
  c.observe(last + OFFER_IDLE_MS * 10)
  assert.equal(c.candidates().length, 0)
  hits(c, 'Kober', { on: 'a sonic bat', n: 1, t0: last + OFFER_IDLE_MS * 10 })
  const [back] = c.candidates()
  assert.equal(back.name, 'Kober')
  assert.equal(back.hits, MIN_HITS + 2, 'every landed hit it ever had, not a count restarted at 1')
  assert.equal(back.sharedTargets, 2)
})

test('ZONING censors the question: an unbound candidate is not current on the other side', () => {
  // World-model law 4 applied to the QUESTION. The entity is unbound, so the app cannot know
  // whether it is a summoned pet (follows you) or a charmed mob (does not) — and the honest test
  // is whether it shows up again, not a guess about which kind it was.
  const c = behavioural()
  assert.equal(c.candidates().length, 1)
  c.zone(30_000)
  assert.equal(c.candidates().length, 0, 'you left; the question went with you')
})

test('…and a pet that FOLLOWS you through the zone line is offered again, evidence intact', () => {
  const c = behavioural()
  c.zone(30_000)
  c.noteYourTarget('a fire giant warrior', 31_000)
  hits(c, 'Kober', { on: 'a fire giant warrior', n: 1, t0: 31_000 })
  const [back] = c.candidates()
  assert.equal(back.name, 'Kober')
  assert.equal(back.hits, MIN_HITS + 2)
  assert.equal(back.sharedTargets, 3, 'the new zone’s mob joined the two it already shared')
})

test('a pet that walks a QUIET CORRIDOR with you keeps everything — zones are not a stopwatch', () => {
  // The P1 golden crosses five zone lines and a two-and-a-half minute Lavastorm transit its pet
  // never fights in. Pruning on "missed a zone" cost it three of its four says; the sweep is
  // TIME-based (half an hour) precisely so a corridor is free.
  const c = behavioural()
  c.zone(30_000)
  c.zone(90_000)
  c.zone(150_000)
  c.noteYourTarget('a fire giant warrior', 151_000)
  hits(c, 'Kober', { on: 'a fire giant warrior', n: 1, t0: 151_000 })
  assert.equal(c.candidates()[0]?.hits, MIN_HITS + 2, 'three zone lines later, still the same pet')
})

test('the ORDER is gate-then-rank: a stale strong candidate never displaces a live one', () => {
  const c = new PetCandidates()
  for (const t of ['m1', 'm2']) c.noteYourTarget(t, 1_000)
  // A big historical hitter, then a modest one that is still swinging an hour later.
  for (const t of ['m1', 'm2']) hits(c, 'Big', { on: t, n: MIN_HITS, t0: 2_000 })
  assert.equal(c.candidates()[0]?.name, 'Big')
  const later = 2_000 + 3_600_000
  for (const t of ['m1', 'm2']) c.noteYourTarget(t, later)
  for (const t of ['m1', 'm2']) hits(c, 'Small', { on: t, n: MIN_HITS, t0: later })
  const got = c.candidates()
  assert.deepEqual(got.map((x) => x.name), ['Small'], 'ranking never gets to see the stale one')
})

test('reset() puts the clock and the zone counter back too', () => {
  const c = behavioural()
  c.zone(30_000)
  c.reset()
  c.noteYourTarget('a sonic bat', 1_000)
  c.noteYourTarget('a noxious spider', 2_000)
  hits(c, 'Kober', { on: 'a sonic bat', n: MIN_HITS })
  hits(c, 'Kober', { on: 'a noxious spider', n: 1 })
  assert.equal(c.candidates().length, 1, 'a fresh detector at zone 0 with a fresh clock')
})
