// captureNames.ts — WHICH `$<name>` placeholders a trigger offers, for the alert editor's hint
// chips. The editor's half of the capture feature; the runtime half is main/modules/alerts.ts.
//
// THIS FILE CANNOT BREAK A SUBSTITUTION, and that is the whole reason it is allowed to exist.
// The values a firing actually carries are read REFLECTIVELY off the matched event (see
// `eventCaptures` in main/modules/alerts.ts) — nothing consults this list at fire time. What it
// drives is the editor's "you can use…" chips. So the worst a stale entry can do is fail to
// SUGGEST a name that would have worked anyway; it can never suppress one, and it can never
// promise one that does not resolve.
//
// EVERY LIST IS COMPILE-CHECKED AGAINST THE REAL SHAPE. `satisfies` below types each entry's
// members as `keyof` that kind's own LogEvent interface, so a typo'd or deleted field fails to
// compile — and the record is keyed by the whole `LogEventKind` union, so a kind added to the
// union without an entry here fails too. What it deliberately does NOT catch is a field ADDED to
// an existing shape: that is the one drift the reflective runtime already covers for free, and
// buying it would mean a generated file to keep in sync.
//
// SCALARS ONLY, matching what `eventCaptures` will actually offer. A few shapes carry arrays
// (`damage.modifiers`, the buff/poison `candidates` lists — one of them an array of objects);
// they are omitted here for the same reason they are omitted there: nothing wants
// '[object Object]' spoken aloud.

import type { AlertTrigger, AlertTriggerPrimitive, LogEventKind } from './alertTypes'
import type { LogEvent } from './logEvents'

/** The field names of ONE event kind, constrained to keys that kind's interface actually has. */
type FieldsOf<K extends LogEventKind> = readonly (keyof Extract<LogEvent, { kind: K }> & string)[]

/**
 * Event kind → the scalar fields a firing of it can speak. Exhaustive over `LogEventKind` and
 * key-checked against each shape (see the header).
 *
 * An EMPTY list is a real answer, not an omission: `aaPotion` is the payload-free AA-potion
 * quaff and `unknown` is a line the parser did not recognize — neither has anything to name.
 */
export const EVENT_CAPTURE_FIELDS = {
  zone: ['zone'],
  loot: ['item', 'source', 'disposition', 'count', 'created'],
  offer: ['item', 'npc'],
  trade: ['npc'],
  level: ['level'],
  aaGain: ['amount', 'nowHave'],
  aaSpend: ['ability', 'rank', 'cost'],
  aaPotion: [],
  aaActivate: ['name'],
  death: ['name', 'bySelf', 'killer'],
  playerDeath: ['killer'],
  damage: ['attacker', 'target', 'amount', 'dtype', 'dclass', 'skill', 'crit', 'modifier', 'category', 'verb'],
  heal: ['target', 'amount', 'rawAmount', 'spell', 'healer', 'crit', 'overTime'],
  mitigation: ['mtype', 'amount', 'source'],
  miss: ['attacker', 'target', 'mtype', 'verb'],
  resist: ['caster', 'target', 'spell', 'incoming'],
  charm: ['mob'],
  uncharm: ['mob'],
  cc: ['mob', 'spell', 'refresh'],
  petClaim: ['name', 'via'],
  petSay: ['name', 'say'],
  castBegin: ['spell'],
  castFizzle: ['spell'],
  castInterrupted: ['spell'],
  buffApply: ['spell', 'target', 'illusion', 'durationMs'],
  buffFade: ['spell', 'target'],
  buffWearOff: ['spell', 'target'],
  illusionFade: ['target'],
  buffExpired: ['spell', 'target'],
  spellEmote: ['subject', 'text'],
  stanceChange: ['stance'],
  invocationChange: ['invocation'],
  consider: ['mob', 'rare', 'level', 'faction', 'difficulty'],
  poisonProc: ['strike', 'effect', 'target'],
  poisonCoat: ['poison', 'group', 'who'],
  poisonDry: ['group'],
  epoch: ['reason'],
  unknown: []
} as const satisfies { [K in LogEventKind]: FieldsOf<K> }

/**
 * The named groups a regex SOURCE declares, in first-appearance order.
 *
 * Reads the pattern as text rather than compiling it, because the editor calls this on every
 * keystroke against a pattern that is invalid for most of the time it is being typed. Lookbehind
 * (`(?<=`, `(?<!`) is not a named group and is excluded by construction: the character after `<`
 * must be able to START an identifier, which `=` and `!` cannot.
 */
const NAMED_GROUP_RE = /\(\?<([A-Za-z_$][A-Za-z0-9_$]*)>/g

export function namedGroupsIn(regexSource: string): string[] {
  const names = new Set<string>()
  for (const m of regexSource.matchAll(NAMED_GROUP_RE)) names.add(m[1])
  return [...names]
}

/** The names ONE primitive condition offers. An 'app' signal has no matched event, so: none. */
function namesForPrimitive(t: AlertTriggerPrimitive): readonly string[] {
  if (t.type === 'raw') return namedGroupsIn(t.regex)
  if (t.type === 'event') return EVENT_CAPTURE_FIELDS[t.kind] ?? []
  return []
}

/**
 * Every `$<name>` this trigger offers, deduped, in the order its conditions declare them.
 *
 * INCOMPLETE FOR A RAW TRIGGER, on purpose and visibly: a raw match ALSO carries the fields of
 * whatever event the line parsed to, and which event that is cannot be known until a line
 * arrives. So this returns the regex's own groups — the part that is knowable while typing — and
 * the editor says the rest in words rather than guessing at a kind.
 */
export function captureNamesFor(trigger: AlertTrigger): string[] {
  const conditions = 'conditions' in trigger ? trigger.conditions : [trigger]
  const names = new Set<string>()
  for (const c of conditions) {
    for (const n of namesForPrimitive(c)) names.add(n)
  }
  return [...names]
}

/** True when any condition is a raw regex — i.e. the name list above is knowingly partial. */
export function hasRawCondition(trigger: AlertTrigger): boolean {
  const conditions = 'conditions' in trigger ? trigger.conditions : [trigger]
  return conditions.some((c) => c.type === 'raw')
}
