/**
 * ============================================================================
 * combatFoldCodec.test.mts — THE ENGINE'S CODEC, WHERE THE CORPUS CANNOT REACH (JOS-208 phase 4).
 * ============================================================================
 *
 * `foldCheckpointDifferential.test.mts` is the owner's law and the real proof: two arms, the real
 * scanner, the real container, deep-equal published snapshots. What it cannot do is cover a field
 * NO FIXTURE PRODUCES — and the engine has several, MEASURED rather than assumed. Folding the whole
 * committed corpus leaves these at their construction values:
 *
 *     specials            0 lanes on all six fixtures (the `You will now use …` line prints ONCE,
 *                         at a level-up, and no committed window contains one)
 *     charm.arm           never armed at a fixture's last byte
 *     charm.provisional   0 — every bind in `p2-pet-arc-bound` is corroborated and promoted
 *     charm.observed      0 — no foreign charm broadcast in any window
 *     recentCasts.suspended  0 — no fizzle/interrupt survives to a fixture's end
 *     slowSamples         0 — no committed window has a slow-capable coat on at engage
 *     coatUtility/coatCombat, markers, invocation   0
 *
 * A serializer that forgot any of them would be green across the entire matrix and wrong in the
 * field. So this test composes a state that reaches every declared field and round-trips it.
 *
 * IT IS A CODEC TEST, AND THAT IS WHY COMPOSING IS LEGITIMATE HERE. The awaiting-sample law is about
 * the WORLD MODEL — never invent a log shape, never claim a fold the log has not shown us. Nothing
 * here claims anything about the log: the base state is a REAL fold of a real fixture through the
 * real parser, and the top-up drives each collaborator through its OWN public method (the same call
 * `ingest.ts` makes) purely to make the field non-empty. The assertion is "what went in came out",
 * which is a statement about `foldCodec.ts` and about nothing else.
 *
 * THE COMPLETENESS HALF is what keeps this from rotting: the covered-field list is held against the
 * schema's own top-level keys, in both directions. A field added to the engine's declaration
 * without coverage here fails BY NAME.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { deserialize, serialize } from 'node:v8'
import { parseEvent } from '../src/main/log/parser'
import { installCharacterName } from '../src/main/log/rulesets'
import { ingestEvent } from '../src/main/combat/ingest'
import { EngineState } from '../src/main/combat/state'
import { engineStateIn, engineStateOut } from '../src/main/combat/foldCodec'
import { COMBAT_FOLD_SCHEMA } from '../src/main/combat/foldSchema'
import { validate } from '../src/main/foldCache/schema'
import type { AggFold, EngineStateFold } from '../src/main/combat/foldTypes'

const fixturePath = (name: string): string => join(import.meta.dirname, 'fixtures', name)

/**
 * A REAL fold of the pet-arc fixture — the richest combat state in the corpus (four fights, nine
 * spawn names, a confirmed charm bind, a live pet, heal ledgers and window ledgers).
 */
function foldedState(): EngineState {
  installCharacterName('Primitive')
  const st = new EngineState()
  st.setPlayerName('Primitive')
  let seq = 0
  for (const raw of readFileSync(fixturePath('p2-pet-arc-bound.log'), 'utf8').split('\n')) {
    const ev = parseEvent(raw.endsWith('\r') ? raw.slice(0, -1) : raw, seq++)
    if (ev) ingestEvent(st, ev, false)
  }
  return st
}

/**
 * Reach the fields the corpus never populates, each through the collaborator's own door.
 *
 * The timestamps are the fixture's own clock continued forward, not `Date.now()`: a fold has no
 * wall clock, and a test that used one would be the very thing `foldDeterminism.test.mts` exists to
 * refuse.
 */
function topUp(st: EngineState): void {
  const ts = st.zoneLastTs + 60_000
  // A special-attack state line — the exact sentence `specialAttacks.ts`'s header quotes from the
  // real log, through the real parser, so the event is the one the engine actually folds.
  const special = parseEvent(
    `[Tue Aug 04 21:24:38 2026] You will now use Dragon Punch instead of Eagle Strike while attacking.`,
    999_000
  )
  assert.ok(special && special.kind === 'specialAttack', 'the state line must still parse')
  ingestEvent(st, special, false)

  // An ARMED cast that nothing has resolved yet, plus a provisional bind and a foreign sighting —
  // the three charm-model states a split can land in the middle of.
  st.charm.noteCastBegin('Allure VII', ts)
  st.charm.charmBroadcast('a sprited harpie', 'a sprited harpie', ts + 1_000)
  st.charm.noteCastBegin('Allure VII', ts + 2_000)
  st.charm.charmBroadcast('a fire giant warrior', 'a fire giant warrior', ts + 900_000)
  st.charm.noteCastBegin('Beguile VI', ts + 900_000)

  // A cast that fizzled and is being held for a `You regain your concentration` that has not
  // arrived — the JOS-167 suspension, which is exactly a mid-cast split's shape.
  st.recentCasts.note('Ebbing Strength IV', ts)
  st.recentCasts.forget('Ebbing Strength IV')

  // Coats, the modifier pair, the rolling slow ring, and one marker on the open fight.
  st.coatUtility = { poison: 'Weakening Poison IV', sinceTs: ts }
  st.coatCombat = [{ poison: 'Blade Venom II', sinceTs: ts }]
  st.stance = { name: 'Precision', ts }
  st.invocation = { name: 'Fellstrike', ts }
  st.slowSamples.push(1_200, null, 4_800)
  st.quickBuffTs = ts
  const enc = st.current ?? st.history[st.history.length - 1]
  st.pushMarker(enc, { ts, kind: 'coat', label: 'Weakening Poison IV' })
  st.pushMarker(enc, { ts, kind: 'slow', label: 'a sprited harpie', detail: 'Weakening Strike' })
  if (st.current === null) st.current = enc
  st.stateTimeline.noteState({ kind: 'coat', key: 'blade venom', name: 'Blade Venom II', ts })
  // A pinned stance row on the open fight — the list `procRouting.applyStance` writes and the
  // shipped TimelineView reads. No fight in the corpus opens with a stance already committed, so
  // this is the only way the span list is ever non-empty in a test.
  enc.stanceSpans.push({ group: 'stance', name: 'Precision', start: ts })
  enc.stanceSpans.push({ group: 'invocation', name: 'Fellstrike', start: ts, end: ts + 5_000 })
}

/**
 * EVERY TOP-LEVEL FIELD OF THE DECLARATION, and what "covered" means for it. The value is a probe
 * that must find something the codec could lose — an empty array or a missing optional proves
 * nothing, so each one asserts presence rather than merely reading the key.
 */
const COVERAGE: Record<string, (f: EngineStateFold) => boolean> = {
  petNames: (f) => f.petNames.length > 0,
  world: (f) => f.world.byName.length > 0 && f.world.gens.length > 0,
  charm: (f) =>
    f.charm.arm !== undefined &&
    f.charm.provisional.length > 0 &&
    f.charm.confirmed.length > 0 &&
    f.charm.observed.length > 0 &&
    f.charm.seenCharmed.length > 0,
  knownPlayers: (f) => f.knownPlayers.length > 0,
  everPet: (f) => f.everPet.length > 0,
  everStruck: (f) => f.everStruck.length > 0,
  playerKey: (f) => f.playerKey !== undefined,
  playerKeyInjected: (f) => f.playerKeyInjected,
  zone: (f) => f.zone !== undefined,
  seq: (f) => f.seq > 0,
  current: (f) => f.current !== undefined,
  history: (f) => f.history.length > 0,
  zoneAgg: (f) => f.zoneAgg.out.length > 0 && f.zoneAgg.windows.windows.length > 0,
  zoneFinalizedMs: (f) => f.zoneFinalizedMs > 0,
  zoneActiveMs: (f) => f.zoneActiveMs > 0,
  zoneStartTs: (f) => f.zoneStartTs > 0,
  zoneLastTs: (f) => f.zoneLastTs > 0,
  // The pet-arc window never zones with damage banked, so the frozen-session list is legitimately
  // empty here; `e2e-combat.log` carries one and the differential compares it at every split.
  zoneHistory: (f) => Array.isArray(f.zoneHistory),
  zoneSeq: (f) => f.zoneSeq >= 0,
  lastActivityTs: (f) => f.lastActivityTs > 0,
  stance: (f) => f.stance !== undefined,
  invocation: (f) => f.invocation !== undefined,
  coatUtility: (f) => f.coatUtility !== undefined,
  coatCombat: (f) => f.coatCombat.length > 0,
  slowSamples: (f) => f.slowSamples.length > 0 && f.slowSamples.includes(null),
  stateTimeline: (f) => f.stateTimeline.spans.length > 0,
  recentCasts: (f) => f.recentCasts.casts.length > 0 && f.recentCasts.suspended !== undefined,
  quickBuffTs: (f) => f.quickBuffTs > 0,
  specials: (f) => f.specials.length > 0
}

/**
 * The aggregate's own sub-ledgers, and the encounter's rings — a table rather than a chain of
 * `if`s so each probe reads as one row and the list can grow without the function growing a branch.
 */
const AGG_COVERAGE: Record<string, (aggs: AggFold[], f: EngineStateFold) => boolean> = {
  'agg.out.bySkill': (aggs) => aggs.some((a) => a.out.some((s) => s[1].bySkill.length > 0)),
  'agg.out.byCategory': (aggs) => aggs.some((a) => a.out.some((s) => s[1].byCategory.length > 0)),
  'agg.out.rounds': (aggs) => aggs.some((a) => a.out.some((s) => s[1].rounds.length > 0)),
  'agg.out.mods': (aggs) => aggs.some((a) => a.out.some((s) => s[1].mods.length > 0)),
  'agg.out.roundAcc': (aggs) => aggs.some((a) => a.out.some((s) => s[1].roundAcc.lanes.length > 0)),
  'agg.inc': (aggs) => aggs.some((a) => a.inc.length > 0),
  'agg.targets': (aggs) => aggs.some((a) => a.targets.length > 0),
  'agg.heal.friendly': (aggs) => aggs.some((a) => a.heal.friendly.length > 0),
  'agg.procs.spellProcs': (aggs) => aggs.some((a) => a.procs.spellProcs.length > 0),
  'agg.windows': (aggs) => aggs.some((a) => a.windows.windows.length > 0),
  'encounter.events': (_aggs, f) => f.history.some((e) => e.events.length > 0),
  'encounter.engaged': (_aggs, f) => f.history.some((e) => e.engaged.length > 0),
  'encounter.stanceSpans': (_aggs, f) => (f.current?.stanceSpans.length ?? 0) > 0,
  'encounter.markers': (_aggs, f) => (f.current?.markers.length ?? 0) > 0
}

function aggCoverage(f: EngineStateFold): string[] {
  const aggs = [f.zoneAgg, ...f.history.map((e) => e.agg), ...(f.current ? [f.current.agg] : [])]
  return Object.entries(AGG_COVERAGE)
    .filter(([, probe]) => !probe(aggs, f))
    .map(([name]) => name)
}

test('combat fold codec: the composed state reaches every declared field', () => {
  const st = foldedState()
  topUp(st)
  const f = engineStateOut(st)

  const v = validate(COMBAT_FOLD_SCHEMA, f)
  assert.equal(v.ok, true, v.ok ? '' : `state does not match its own declaration at '${v.error.path}': expected ${v.error.expected}, got ${v.error.got}`)

  // THE COMPLETENESS GATE, both directions — the half that makes the probes above mean something
  // next year. `COMBAT_FOLD_SCHEMA` is an object at the root; a field added to it without a probe
  // here fails by name, and a probe for a field that no longer exists fails the same way.
  assert.equal(COMBAT_FOLD_SCHEMA.k, 'object')
  const declared = COMBAT_FOLD_SCHEMA.k === 'object' ? Object.keys(COMBAT_FOLD_SCHEMA.fields).sort() : []
  assert.deepStrictEqual(
    Object.keys(COVERAGE).sort(),
    declared,
    'every declared field needs a coverage probe here, and every probe needs a field'
  )

  const uncovered = Object.entries(COVERAGE)
    .filter(([, probe]) => !probe(f))
    .map(([name]) => name)
  assert.deepStrictEqual(uncovered, [], `these declared fields are empty, so the codec is untested for them: ${uncovered.join(', ')}`)
  assert.deepStrictEqual(aggCoverage(f), [], 'these aggregate ledgers are empty in the composed state')
})

test('combat fold codec: what went in comes out, through a real structured clone', () => {
  const st = foldedState()
  topUp(st)
  const before = engineStateOut(st)

  // Through V8, exactly as the container carries it — a blob that survives `validate` but not the
  // clone is a blob nobody can ever read back.
  const cloned: unknown = deserialize(serialize(before))
  assert.equal(validate(COMBAT_FOLD_SCHEMA, cloned).ok, true, 'the clone no longer matches the declaration')

  const fresh = new EngineState()
  engineStateIn(fresh, cloned as EngineStateFold)
  assert.deepStrictEqual(engineStateOut(fresh), before, 'the round trip lost or changed something')

  // …and a SECOND round trip through the fresh state, because `engineStateIn` adds to four name
  // sets rather than replacing them: a restore that unioned instead of adopting would pass once.
  const second = new EngineState()
  engineStateIn(second, deserialize(serialize(engineStateOut(fresh))) as EngineStateFold)
  assert.deepStrictEqual(engineStateOut(second), before, 'the second round trip diverged')
})

/**
 * THE DERIVED INDEXES ARE REBUILT, not stored — asserted through the behaviour that depends on
 * them, because a field that is absent from the blob by design cannot be compared field-wise.
 *
 *   * the world model's live index (`petInstances`) and its label generation (`gens`);
 *   * the state timeline's open-span index (`active`), which every damage line reads;
 *   * the encounter's CC holds, which the world model's `onRetire` listener must still be wired to.
 */
test('combat fold codec: the derived indexes come back with the state', () => {
  const st = foldedState()
  topUp(st)
  const fresh = new EngineState()
  engineStateIn(fresh, engineStateOut(st))

  assert.deepStrictEqual(fresh.petDisplayNames(), st.petDisplayNames(), 'the live pet index')
  assert.deepStrictEqual(fresh.charmedPetNames(), st.charmedPetNames(), 'the charm roster')
  assert.deepStrictEqual([...fresh.stateTimeline.active].sort(), [...st.stateTimeline.active].sort(), 'the open-span index')
  assert.equal(fresh.stateTimeline.activeAt(st.zoneLastTs).length, st.stateTimeline.activeAt(st.zoneLastTs).length)

  // `onRetire` is installed in `EngineState`'s CONSTRUCTOR and must survive a restore, or a mez'd
  // mob retired by staleness goes on vetoing the death-close for 120 s (JOS-176). That listener is
  // the reason `engineStateIn` restores the world model IN PLACE instead of assigning a fresh one,
  // and this is what would go red if it ever stopped doing so.
  //
  // A HOSTILE, deliberately: `zone()` keeps live SUMMONED pets (they walk through with you), so a
  // hold pinned on a pet legitimately survives and would make this assert the opposite of the rule.
  const enc = fresh.current
  assert.ok(enc, 'the composed state leaves a fight open')
  const hostile = fresh.world.resolve('a sprited harpie', st.zoneLastTs + 1)
  assert.equal(hostile.charmed, false, 'the probe instance must be a hostile')
  enc.engaged.add(hostile.instanceId)
  enc.ccActiveUntil.set(hostile.instanceId, st.zoneLastTs + 120_000)
  fresh.world.zone(st.zoneLastTs + 2)
  assert.equal(enc.ccActiveUntil.size, 0, 'the retirement listener was lost in the restore')
})
