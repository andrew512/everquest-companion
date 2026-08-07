// NAMED VALUES ON A FIRING — `$<name>` placeholders in a spoken alert.
//
// A custom phrase can say what the line said: `$<attacker> hit you for $<amount>`. That is two
// contracts in two modules, and this suite is the specification of both:
//
//   (A) THE PRODUCER — main/modules/alerts.ts fills `FiredAlert.captures` from ONE namespace with
//       two sources: the matched event's own scalar fields, and the trigger's regex named groups,
//       with the groups winning a collision. Driven through the REAL AlertsModule, and through
//       the REAL parser for the cases that are about a real line's real field names.
//
//   (B) THE RESOLVER — shared/speechText.ts substitutes those values into the phrase. The rules
//       worth pinning are the ones a user would otherwise discover by being surprised: an
//       unresolved name is DROPPED (not spoken, not a guess), a phrase that resolves to nothing
//       falls back to the alert's name, and substitution happens before the character cap.
//
//   (C) shared/captureNames.ts, the EDITOR's hint list — the one piece that is allowed to be
//       incomplete, and must therefore never be wrong.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { AlertsModule } from '../src/main/modules/alerts'
import { placeholdersIn, speechTextFor, type SpeechDef } from '../src/shared/speechText'
import {
  EVENT_CAPTURE_FIELDS,
  captureNamesFor,
  hasRawCondition,
  namedGroupsIn
} from '../src/shared/captureNames'
import type { AlertDef, FiredAlert } from '../src/shared/types'
import type { LogEvent } from '../src/shared/logEvents'

/** An always-on alert with no cooldown, so every line in a case can fire. */
function alert(trigger: AlertDef['trigger'], id = 'a'): AlertDef {
  return {
    id,
    name: `alert ${id}`,
    enabled: true,
    trigger,
    sound: { packId: 'alan-rickman', soundId: 'settled' },
    cooldownMs: 0
  }
}

/** Fire events through a module armed with `defs`, and return the fired payloads. */
function fire(events: readonly LogEvent[], defs: readonly AlertDef[]): FiredAlert[] {
  const mod = new AlertsModule()
  mod.setDefs([...defs])
  mod.reset()
  for (const e of events) mod.onEvent(e, true)
  return mod.flushDelta()?.delta.fired ?? []
}

let seq = 0
/** A synthetic event carrying exactly the fields under test. */
function ev(partial: Partial<LogEvent> & { kind: LogEvent['kind'] }): LogEvent {
  seq += 1
  return { seq, ts: 1_700_000_000_000 + seq * 1000, raw: `raw-${partial.kind}-${seq}`, ...partial } as LogEvent
}

/** A synthetic event whose RAW LINE is the subject — for the pure regex-capture cases. */
function rawEv(raw: string): LogEvent {
  seq += 1
  return { seq, ts: 1_700_000_000_000 + seq * 1000, raw, kind: 'unknown' } as LogEvent
}

/** Parse a real line, asserting it still parses to the kind the case is about. */
function parsed(line: string, kind: LogEvent['kind']): LogEvent {
  const e = parseEvent(line, ++seq)
  assert.equal(e?.kind, kind, `fixture line must still parse as ${kind}: ${line}`)
  return e as LogEvent
}

/** The captures of the single firing `defs` produced for `events`. */
function capturesOf(events: readonly LogEvent[], defs: readonly AlertDef[]): FiredAlert['captures'] {
  const [fired] = fire(events, defs)
  assert.ok(fired, 'the case is meaningless unless the alert actually fired')
  return fired.captures
}

// =========================================================== (A) the producer: what a firing carries

test('a raw trigger’s named groups land on the firing', () => {
  const caps = capturesOf(
    [rawEv('[Sat Aug 02 21:14:03 2026] King Tranix begins to cast Ancient Breath.')],
    [alert({ type: 'raw', regex: '\\] (?<mob>.+) begins to cast (?<spell>.+)\\.' })]
  )
  assert.equal(caps?.mob, 'King Tranix')
  assert.equal(caps?.spell, 'Ancient Breath')
})

test('a capture-less regex still fires, and carries the EVENT’s fields instead', () => {
  // The ordinary case: no groups written, yet the phrase can still name what the line said.
  const zone = parsed('[Sat Aug 02 21:20:00 2026] You have entered East Freeport.', 'zone')
  assert.equal(capturesOf([zone], [alert({ type: 'raw', regex: 'entered' })])?.zone, 'East Freeport')
})

test('an EVENT trigger carries that event’s scalar fields with no regex at all', () => {
  const caps = capturesOf(
    [ev({ kind: 'damage', attacker: 'King Tranix', target: 'you', amount: 412, dtype: 'melee', skill: 'hits', crit: false })],
    [alert({ type: 'event', kind: 'damage' })]
  )
  assert.deepEqual(caps, {
    attacker: 'King Tranix',
    target: 'you',
    amount: '412',
    dtype: 'melee',
    skill: 'hits',
    crit: 'false'
  })
})

test('numbers and booleans are stringified; arrays and objects are left out entirely', () => {
  const caps = capturesOf(
    [
      ev({
        kind: 'buffApply',
        spell: 'Quickness',
        target: 'self',
        illusion: false,
        durationMs: 4500,
        candidates: [{ name: 'Quickness', durationMs: 4500, illusion: false }]
      })
    ],
    [alert({ type: 'event', kind: 'buffApply' })]
  )
  assert.equal(caps?.durationMs, '4500', 'a number speaks as its digits')
  assert.equal(caps?.illusion, 'false', 'a boolean speaks as true/false')
  assert.equal('candidates' in (caps ?? {}), false, 'never “[object Object]” out loud')
})

test('the envelope is never speakable — no kind, seq, ts, or the whole raw line', () => {
  const caps = capturesOf([ev({ kind: 'charm', mob: 'a gorgon' })], [alert({ type: 'event', kind: 'charm' })])
  assert.deepEqual(Object.keys(caps ?? {}), ['mob'])
})

test('a REGEX GROUP WINS a name it shares with an event field', () => {
  // The event calls the mob `mob`; so does the group, and the group is the more specific ask.
  const caps = capturesOf(
    [ev({ kind: 'charm', mob: 'a gorgon', raw: '[Sat Aug 02 21:14:03 2026] You have charmed A GORGON.' })],
    [alert({ type: 'raw', regex: 'charmed (?<mob>.+)\\.' })]
  )
  assert.equal(caps?.mob, 'A GORGON', 'the hand-written group, not the parsed field')
})

test('a group that did not participate in the match is omitted, not stored empty', () => {
  const caps = capturesOf(
    [rawEv('[Sat Aug 02 21:14:03 2026] Ancient Breath')],
    [alert({ type: 'raw', regex: '(?<a>Ancient)(?<b>Nope)?' })]
  )
  assert.equal(caps?.a, 'Ancient')
  assert.equal('b' in (caps ?? {}), false)
})

test('captures is ABSENT — not empty — when there is nothing at all to name', () => {
  // aaPotion is the payload-free family, matched here by a regex that captures nothing.
  const [fired] = fire([ev({ kind: 'aaPotion' })], [alert({ type: 'raw', regex: 'raw-' })])
  assert.equal('captures' in fired, false, 'an absent key is the honest encoding')
})

test('an “all” composite merges every condition’s groups; earlier conditions win', () => {
  const caps = capturesOf(
    [rawEv('[Sat Aug 02 21:14:03 2026] alpha bravo')],
    [
      alert({
        type: 'all',
        conditions: [
          { type: 'raw', regex: '(?<first>alpha) (?<shared>bravo)' },
          { type: 'raw', regex: '(?<shared>alpha)' }
        ]
      })
    ]
  )
  assert.equal(caps?.first, 'alpha', 'a name only condition 1 defines still lands')
  assert.equal(caps?.shared, 'bravo', 'condition 1 claimed the shared name first')
})

test('an “any” composite takes the groups of the condition that actually matched', () => {
  const caps = capturesOf(
    [rawEv('[Sat Aug 02 21:14:03 2026] bravo')],
    [
      alert({
        type: 'any',
        conditions: [
          { type: 'raw', regex: '(?<which>alpha)' },
          { type: 'raw', regex: '(?<which>bravo)' }
        ]
      })
    ]
  )
  assert.equal(caps?.which, 'bravo')
})

test('a long capture is bounded before it ever reaches the wire', () => {
  const caps = capturesOf(
    [rawEv(`[Sat Aug 02 21:14:03 2026] ${'x'.repeat(500)}`)],
    [alert({ type: 'raw', regex: '\\] (?<all>x+)' })]
  )
  assert.equal(caps?.all.length, 120)
})

test('the payload only GREW — spell context and matched text are untouched', () => {
  const cast = parsed('[Sat Aug 02 21:14:03 2026] You begin casting Mesmerization III.', 'castBegin')
  const [fired] = fire([cast], [alert({ type: 'event', kind: 'castBegin' })])
  assert.equal(fired.spell, 'Mesmerization III', 'rank intact — stripping is still the resolver’s job')
  assert.equal(fired.matchedText, cast.raw)
  assert.equal(fired.captures?.spell, 'Mesmerization III')
})

test('replay never fires, so it never captures', () => {
  const mod = new AlertsModule()
  mod.setDefs([alert({ type: 'event', kind: 'charm' })])
  mod.reset()
  mod.onEvent(ev({ kind: 'charm', mob: 'a gorgon' }), false)
  assert.equal(mod.flushDelta(), null)
})

// =========================================================== (B) the resolver: what gets spoken

/** A def that speaks `phrase`, for the resolver half. */
function speaks(phrase: string, name = 'Fallback name'): SpeechDef {
  return { name, speech: { mode: 'custom', phrase } }
}

test('placeholders resolve from the firing’s captures', () => {
  const said = speechTextFor(speaks('$<attacker> hit you for $<amount>'), {
    captures: { attacker: 'King Tranix', amount: '412' }
  })
  assert.equal(said, 'King Tranix hit you for 412')
})

test('an unresolved placeholder is DROPPED and the whitespace closes up', () => {
  const said = speechTextFor(speaks('$<mob> resisted $<spell>'), { captures: { mob: 'a froglok' } })
  assert.equal(said, 'a froglok resisted', 'no double space, no punctuation read aloud')
})

test('a phrase that resolves to NOTHING falls back to the alert’s name — never silence', () => {
  assert.equal(speechTextFor(speaks('$<nope>', 'Charm break'), { captures: {} }), 'Charm break')
  assert.equal(speechTextFor(speaks('$<nope>', 'Charm break'), null), 'Charm break')
})

test('a firing with no captures at all leaves a plain phrase completely alone', () => {
  assert.equal(speechTextFor(speaks('Charm broke!'), null), 'Charm broke!')
  assert.equal(speechTextFor(speaks('Charm broke!'), { captures: { mob: 'x' } }), 'Charm broke!')
})

test('substitution happens BEFORE the character cap, so a long value truncates the sentence', () => {
  const said = speechTextFor(speaks('$<all>'), { captures: { all: 'y'.repeat(200) } })
  assert.equal(said?.length, 120, 'capped, not refused')
})

test('only the custom mode substitutes — a name is a name in every surface it appears', () => {
  const def: SpeechDef = { name: 'Pull on $<mob>', speech: { mode: 'alertName' } }
  assert.equal(speechTextFor(def, { captures: { mob: 'King Tranix' } }), 'Pull on $<mob>')
})

test('a bare dollar is not a placeholder', () => {
  assert.equal(speechTextFor(speaks('costs $5 and $<x'), { captures: {} }), 'costs $5 and $<x')
})

test('placeholdersIn names what a phrase references, deduped and in order', () => {
  assert.deepEqual(placeholdersIn('$<b> then $<a> then $<b>'), ['b', 'a'])
  assert.deepEqual(placeholdersIn('nothing here'), [])
})

// =========================================================== (C) the editor's hint list

test('an event trigger offers its kind’s fields; an app signal offers none', () => {
  assert.deepEqual(captureNamesFor({ type: 'event', kind: 'charm' }), ['mob'])
  assert.deepEqual(captureNamesFor({ type: 'app', signal: 'bossDefeat' }), [])
})

test('a raw trigger offers its own groups, and is flagged as a PARTIAL list', () => {
  const trigger = { type: 'raw' as const, regex: '\\] (?<mob>.+) begins to cast (?<spell>.+)\\.' }
  assert.deepEqual(captureNamesFor(trigger), ['mob', 'spell'])
  assert.equal(hasRawCondition(trigger), true, 'the event half is unknowable until a line arrives')
  assert.equal(hasRawCondition({ type: 'event', kind: 'charm' }), false)
})

test('a composite offers the union of its conditions’ names', () => {
  assert.deepEqual(
    captureNamesFor({
      type: 'any',
      conditions: [
        { type: 'event', kind: 'charm' },
        { type: 'raw', regex: '(?<who>.+)' }
      ]
    }),
    ['mob', 'who']
  )
})

test('namedGroupsIn reads groups off an INVALID pattern (the editor calls it per keystroke)', () => {
  assert.deepEqual(namedGroupsIn('(?<mob>.+) begins ((('), ['mob'])
  assert.deepEqual(namedGroupsIn('(?<=\\] )foo'), [], 'lookbehind is not a named group')
  assert.deepEqual(namedGroupsIn('(?<!x)foo'), [], 'negative lookbehind is not one either')
  assert.deepEqual(namedGroupsIn('(?<a>x)(?<a>y)'), ['a'], 'deduped')
})

test('every hint the editor offers is a name the producer would actually fill', () => {
  // The list is ALLOWED to be incomplete (the runtime reads fields reflectively) but must never
  // promise a name that does not resolve. Drive the real module with an event carrying a value
  // for every advertised field of the smallest shapes and check each one arrives.
  const cases: { kind: 'charm' | 'zone' | 'resist'; event: Partial<LogEvent> }[] = [
    { kind: 'charm', event: { mob: 'a gorgon' } },
    { kind: 'zone', event: { zone: 'East Freeport' } },
    { kind: 'resist', event: { caster: 'you', target: 'a froglok', spell: 'Mesmerization III', incoming: false } }
  ]
  for (const c of cases) {
    const caps = capturesOf([ev({ ...c.event, kind: c.kind })], [alert({ type: 'event', kind: c.kind })])
    for (const field of EVENT_CAPTURE_FIELDS[c.kind]) {
      assert.ok(field in (caps ?? {}), `${c.kind}.${field} is offered, so it must be delivered`)
    }
  }
})
