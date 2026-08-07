// alerts module — the first real proof of the EqModule extension contract.
//
// It evaluates 'event' and 'raw' alert triggers against LIVE LogEvents only (the
// registry never flushes during replay, but we ALSO gate here so a future direct
// caller can't accidentally fire on historical events), respecting each alert's
// enabled flag and cooldown. Each fire is accumulated and pushed as the standard
// `module:delta` payload `{ fired: FiredAlert[] }`; the renderer's always-mounted
// player turns those into actual audio.
//
// 'app'-type triggers (e.g. bossDefeat) are evaluated RENDERER-side (they depend
// on derived boss state that lives in the renderer), so this module stores/serves
// their defs via snapshot() but never fires them itself.
//
// COMPOSITE triggers (Task #47): a trigger may be `{type:'any'|'all', conditions:[…]}` over
// the primitive event/raw/app shapes. 'any' fires when ANY condition matches a single event
// (OR); 'all' fires only when EVERY condition matches THE SAME event (AND — same-event only,
// no cross-event windows). Cooldown is per ALERT, not per condition — and, since the owner's
// 2026-08-04 slow incident, per alert-and-TARGET when the def asks for it (`cooldownScope`,
// see `cooldownKey` below). It also matches the DERIVED
// `buffExpired` event the buffs module synthesizes (a resolved, unambiguous "wears off you /
// your pet" signal) — see shared/logEvents.ts BuffExpiredEvent + log/bus.ts emitDerived.
//
// Alert defs are owned by the store; the module holds a live copy that main keeps
// in sync (setDefs) whenever the user saves/deletes an alert.

import type { EqModule } from './types'
import { idKey } from '../log/parseCommon'
import type { LogEvent } from '../../shared/logEvents'
import type {
  AlertDef,
  AlertFireRecord,
  AlertsDelta,
  AlertsSnap,
  AlertTrigger,
  AlertTriggerPrimitive,
  FiredAlert,
  PoisonSlowRecency
} from '../../shared/types'

const DEFAULT_COOLDOWN_MS = 2000
/** Max fires kept per alert in the recent-fires ring buffer (Task #22). */
const HISTORY_CAP = 20
/**
 * Max distinct spell DISPLAY names kept in the rank recency map. A character's own cast
 * vocabulary is well under 300 in the reference log; the cap is a bound, not a policy, and
 * it evicts the least-recently-cast name so the map always describes what you use NOW.
 */
const SPELL_CAST_CAP = 400
/**
 * Max distinct cooldown clocks kept at once, across every alert (Task: per-target cooldowns).
 *
 * An alert-level clock is ONE entry per alert, so this cap exists entirely for the
 * `cooldownScope:'target'` alerts, which mint an entry per mob: a marathon session slays
 * thousands, and an unbounded map would keep a row for every corpse of the day.
 *
 * Eviction is least-recently-FIRED (the map is re-inserted on write, so its iteration order is
 * oldest-first — the same trick `spellLastCast` uses). That ordering is what makes the bound
 * safe rather than merely small: the entry discarded is the one whose cooldown is the closest
 * to having expired anyway, so the worst case of an eviction is one extra alert on a mob
 * nobody has hit in hundreds of fires — never a suppressed one.
 */
const COOLDOWN_KEY_CAP = 500

/**
 * Compile a matcher value into a predicate. A value wrapped in slashes (`/.../`)
 * is a case-insensitive regex; anything else is a case-insensitive exact match on
 * the stringified field. Invalid regex falls back to literal equality so a bad
 * def degrades gracefully instead of throwing in the hot path.
 */
function compileFieldMatch(spec: string): (fieldValue: string) => boolean {
  if (spec.length >= 2 && spec.startsWith('/') && spec.endsWith('/')) {
    const body = spec.slice(1, -1)
    try {
      const re = new RegExp(body, 'i')
      return (v) => re.test(v)
    } catch {
      // fall through to literal
    }
  }
  const lower = spec.toLowerCase()
  return (v) => v.toLowerCase() === lower
}

/**
 * Stringify ONE event field for matching. A `where` key names an arbitrary field of an
 * arbitrary LogEvent, so the value is nearly always a string/number/boolean — but a few fields
 * hold arrays (`damage.modifiers`, the buff-landing `candidates` lists, one of which is an
 * array of OBJECTS).
 *
 * This reproduces JS's own `String()` coercion rather than improving on it, because the coerced
 * text is exactly what every existing alert def is matched against: an array joins its elements
 * with ',' (a nullish element contributing ''), and an object element renders as the literal
 * '[object Object]'. That last one IS what a def matching on the object-shaped `candidates` list
 * sees today — making it nicer would silently change which alerts fire. The final fallback also
 * absorbs bigint/symbol/function, which no LogEvent field holds.
 */
function fieldText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return '' // only reachable as an array ELEMENT — join() renders nullish as ''
  if (Array.isArray(value)) return (value as unknown[]).map(fieldText).join(',')
  return '[object Object]'
}

/** A single PRIMITIVE condition prepared for fast evaluation (regex compiled once). */
interface CompiledCondition {
  event?: { kind: string; fields: { key: string; test: (v: string) => boolean }[] }
  raw?: RegExp
  // 'app' primitives compile to neither event nor raw → they never match main-side.
}

/**
 * A compiled alert. A primitive trigger compiles to a single condition (`composite:'single'`);
 * a composite compiles to its type ('any'/'all') + the list of compiled conditions (Task #47).
 */
interface CompiledAlert {
  def: AlertDef
  composite: 'single' | 'any' | 'all'
  conditions: CompiledCondition[]
}

/** Compile one PRIMITIVE trigger into a matcher condition. */
function compileCondition(t: AlertTriggerPrimitive): CompiledCondition {
  if (t.type === 'event') {
    const fields = Object.entries(t.where ?? {}).map(([key, spec]) => ({
      key,
      test: compileFieldMatch(spec)
    }))
    return { event: { kind: t.kind, fields } }
  }
  if (t.type === 'raw') {
    let re: RegExp
    try {
      re = new RegExp(t.regex, 'i')
    } catch {
      // A bad regex should never match (and never throw); use a pattern that can't.
      re = /$.^/
    }
    return { raw: re }
  }
  // 'app' triggers are renderer-evaluated; compile to an empty condition (never matches here).
  return {}
}

// ---- spell context on the firing payload (docs/plans/voice-alerts.md §1) ----
//
// A spoken alert can say the spell that set it off ("Mesmerization", "Swift"), which means the
// FIRING has to carry it: the renderer receives `FiredAlert`, and before this it carried only
// the alert id, the timestamp and the matched raw line. Re-deriving the spell renderer-side
// would mean a second parser for lines main has already parsed.
//
// WHICH FIELD NAMES THE SPELL, PER KIND — measured against shared/logEvents.ts, not assumed.
// Most of the families spell it `spell`; three do not, and the exceptions are the whole reason
// this is a table instead of a property read:
//   * poisonProc  → `strike`  (the Strike's own name; a proc has no cast line at all)
//   * poisonCoat  → `poison`  (and it is the literal string 'unknown' for the generic
//                              third-person coat line, which is filtered below — 'unknown' is
//                              a stated absence, not a spell name)
//   * damage      → `skill`, but ONLY for dtype 'spell' | 'dot' (verified in log/parseCombat.ts:
//                   the typed-nuke and DoT shapes put the spell name there). For 'melee' it is
//                   a melee skill and for 'ds' it is the damage-shield element — neither is a
//                   spell, so neither is claimed. Handled separately, below.
//
// FAMILIES THAT CARRY NO SPELL, and therefore fall back to the alert's name when a spell speech
// mode fires on them: zone, loot, offer, trade, level, expGain, aaGain, aaSpend, aaActivate (an
// AA name is not a spell), death, playerDeath, mitigation, miss, charm, uncharm, petClaim,
// spellEmote (the emote text names no spell — that ambiguity is the point of the family),
// illusionFade (27-way ambiguous by design), poisonDry, stanceChange, invocationChange, selfWho,
// skillUp, itemActivate, itemMerge, itemMergeFailed, consider, epoch, sessionStart, campStart,
// campAbort, offlineGap, unknown — plus EVERY 'raw' trigger that matched a spell-less line and
// every renderer-evaluated 'app' signal (bossDefeat / questComplete, which arrive via appFired
// and never see a LogEvent at all).
//
// `cc` and `heal` declare `spell?` — present on some shapes only (a CC application names no
// spell; its worn-off keep-alive does). An absent field is simply an absent spell.

/** Event kind → the field on that event whose value is the triggering spell's DISPLAY name. */
const SPELL_FIELD_BY_KIND: Partial<Record<LogEvent['kind'], string>> = {
  castBegin: 'spell',
  castFizzle: 'spell',
  castInterrupted: 'spell',
  resist: 'spell',
  cc: 'spell',
  heal: 'spell',
  buffApply: 'spell',
  buffFade: 'spell',
  buffWearOff: 'spell',
  buffExpired: 'spell',
  poisonProc: 'strike',
  poisonCoat: 'poison'
}

/**
 * The spell that set this event off, DISPLAY form with the rank suffix INTACT — or undefined
 * when the family names none. Rank-stripping belongs to the speech resolver
 * (shared/speechText.ts), never to the producer: a consumer that wants "Mesmerization III"
 * must still be able to see the III.
 *
 * The one dynamic read mirrors `conditionMatches`'s own field access (the `where` matcher has
 * always indexed events by an arbitrary key), so this introduces no new escape hatch.
 */
function firingSpell(ev: LogEvent): string | undefined {
  if (ev.kind === 'damage') {
    return ev.dtype === 'spell' || ev.dtype === 'dot' ? ev.skill.trim() || undefined : undefined
  }
  const field = SPELL_FIELD_BY_KIND[ev.kind]
  if (field === undefined) return undefined
  const value = (ev as unknown as Record<string, unknown>)[field]
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  // 'unknown' is what a poisonCoat says when the line deliberately hides which poison it was.
  return name && name !== 'unknown' ? name : undefined
}

// ---- named values a firing can speak (`$<name>` placeholders, shared/speechText.ts) ----
//
// ONE NAMESPACE, TWO SOURCES. A custom phrase says `$<mob> is casting $<spell>`; this is where
// `mob` and `spell` get their values. They come from the matched EVENT's own scalar fields and
// from the trigger's own regex named groups, merged with the groups winning — see
// `mergeCaptures` for why that direction and not the other.
//
// THE EVENT HALF IS FREE, AND IT REACHES 'raw' TRIGGERS TOO. Every line is parsed into a typed
// LogEvent before any alert sees it, so a raw-matched line still has a shape behind it with
// `attacker`/`target`/`amount`/`mob`/… already extracted and canonicalized. That is the same
// reason `firingSpell` above works for a raw trigger, and it means the common cases need no
// regex at all: `kind:'damage'` already offers `$<attacker>` and `$<amount>`.
//
// REFLECTIVE, NOT A TABLE, and that is the load-bearing choice. `SPELL_FIELD_BY_KIND` above is a
// table because it answers a question the shapes do not agree on (three families spell the spell
// differently). This answers "what does this event carry", which the event itself already states
// — so it is read off the object. A parser change that adds a field makes that field speakable
// with no edit here, and no list can go stale into a broken alert. (shared/eventFields.ts holds a
// per-kind list for the EDITOR's hint chips only; a gap there costs a chip, never a substitution.)

/** Max named values one firing may carry. A bound on what rides every fire over IPC. */
const MAX_CAPTURES = 24
/**
 * Max characters one captured value contributes. The whole utterance is capped again at
 * MAX_SPEECH_CHARS by the resolver; this stops a `(?<all>.*)` group from putting a 400-character
 * log line on the wire in the first place.
 */
const MAX_CAPTURE_CHARS = 120

/**
 * Event keys that are BOOKKEEPING, not content. `raw` is the whole line (including the timestamp
 * prefix), `kind`/`seq`/`ts` are the envelope — none is something a player wants said aloud, and
 * `raw` would blow the character cap on its own.
 */
const NON_CONTENT_KEYS = new Set(['kind', 'seq', 'ts', 'raw'])

/**
 * One field's spoken form, or null when it has none.
 *
 * Scalars only, DELIBERATELY: a few event fields hold arrays (`damage.modifiers`, the buff
 * `candidates` lists — one of them an array of objects). `fieldText` above stringifies those for
 * `where` MATCHING, where reproducing JS's own coercion is the whole point because it is what
 * every existing def is already matched against. Nothing wants '[object Object]' spoken out loud,
 * so this omits them instead: an absent name resolves to nothing and the rest of the phrase still
 * speaks, which beats a sentence with punctuation read into the middle of it.
 */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return String(value)
  return null
}

/** Every scalar field of an event, as speakable text. Computed once per firing, not per alert. */
function eventCaptures(ev: LogEvent): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(ev)) {
    if (NON_CONTENT_KEYS.has(key)) continue
    const text = scalarText(value)
    if (text !== null) out[key] = text
  }
  return out
}

/**
 * Extract a raw condition's named groups, or null when the line does not match at all.
 *
 * `{}` (matched, captured nothing) and `null` (did not match) are DIFFERENT ANSWERS and the
 * caller depends on the difference — a capture-less regex is the ordinary case and must still
 * fire. The regex carries no `g` flag (compileCondition builds it with 'i' alone), so `exec` has
 * no `lastIndex` to carry between calls and this stays safe to run per event.
 *
 * A group that did not participate in the match is OMITTED rather than stored empty: absent is
 * the honest encoding, and the resolver treats the two identically anyway.
 */
function rawCaptures(re: RegExp, line: string): Record<string, string> | null {
  const m = re.exec(line)
  if (!m) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(m.groups ?? {})) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) out[key] = text
  }
  return out
}

/**
 * Merge the two sources into the firing's namespace, or undefined when there is nothing to carry.
 *
 * THE REGEX GROUPS GO IN FIRST, which is what makes them win a name collision — a group the user
 * wrote by hand is a more specific statement of intent than a field the parser happened to name
 * the same thing — and, because the cap fills in insertion order, what keeps THEM from being the
 * ones dropped when an unusually wide event would overflow it.
 */
function mergeCaptures(
  groups: Record<string, string>,
  fields: Record<string, string>
): Record<string, string> | undefined {
  const out = new Map<string, string>()
  const add = (key: string, text: string): void => {
    if (out.size >= MAX_CAPTURES || out.has(key)) return
    out.set(key, text.slice(0, MAX_CAPTURE_CHARS))
  }
  for (const [key, text] of Object.entries(groups)) add(key, text)
  for (const [key, text] of Object.entries(fields)) add(key, text)
  return out.size > 0 ? Object.fromEntries(out) : undefined
}

/**
 * The cooldown clock this firing belongs to (AlertDef.cooldownScope).
 *
 * 'alert' (and absent, which means the same thing) → the alert's own id: one clock, exactly as
 * every alert behaved before per-target scope existed.
 *
 * 'target' → `<id>\0<idKey(target)>`, so the first match on a mob always fires and only re-lands
 * on THAT mob are rate-limited. `target` is read dynamically because it is a field of some
 * LogEvent shapes and not others — the same arbitrary-field access `where` matchers have always
 * done. A family that names no target (or names an empty one) has nothing to scope by and
 * DEGRADES to the alert-level clock rather than minting a bogus one: that is a quieter alert,
 * never a missing cooldown, and it never throws in the hot path.
 *
 * `idKey` is the repo-wide canonicalization (world-model law 2: names are dirty — damage lines
 * capitalize the article, lifecycle lines lowercase it), so "King Tranix" and "king tranix" are
 * one mob and cannot hold two clocks between them.
 */
function cooldownKey(def: AlertDef, ev: LogEvent): string {
  if (def.cooldownScope !== 'target') return def.id
  const target = (ev as unknown as Record<string, unknown>).target
  if (typeof target !== 'string') return def.id
  const key = idKey(target)
  return key ? `${def.id}\u0000${key}` : def.id
}

function compileAlert(def: AlertDef): CompiledAlert {
  const t: AlertTrigger = def.trigger
  if ('conditions' in t) {
    return { def, composite: t.type, conditions: t.conditions.map(compileCondition) }
  }
  return { def, composite: 'single', conditions: [compileCondition(t)] }
}

/** A trigger that matched: the text to record, and the regex groups it captured (often none). */
interface TriggerHit {
  text: string
  captures: Record<string, string>
}

/** Whether ONE compiled EVENT condition matches `ev` (kind + every `where` field matcher). */
function eventConditionMatches(spec: NonNullable<CompiledCondition['event']>, ev: LogEvent): boolean {
  if (ev.kind !== spec.kind) return false
  for (const f of spec.fields) {
    const raw = (ev as unknown as Record<string, unknown>)[f.key]
    if (raw == null) return false
    if (!f.test(fieldText(raw))) return false
  }
  return true
}

/**
 * Whether ONE primitive condition matches `ev`, and with what groups. Null is "did not match";
 * `{}` is "matched, captured nothing" — the difference is what lets a capture-less regex fire.
 *
 * A `where` matcher's `/regex/` does NOT capture, deliberately: a condition may carry several
 * such fields, and two of them defining the same group name would have no honest winner. Named
 * groups belong to 'raw' conditions, where there is exactly one pattern per condition.
 */
function conditionMatches(cond: CompiledCondition, ev: LogEvent): Record<string, string> | null {
  if (cond.event) return eventConditionMatches(cond.event, ev) ? {} : null
  if (cond.raw) return rawCaptures(cond.raw, ev.raw)
  // 'app' conditions never match main-side.
  return null
}

/**
 * The 'all' arm: every condition must match THE SAME event, and the groups of all of them are
 * merged. Its own function so the nesting stays inside the tree's max-depth budget.
 *
 * EARLIER CONDITIONS WIN a name collision, matching the 'any' arm's "the groups belong to the
 * condition you read first" rule. An empty condition list can't be satisfied meaningfully —
 * treat it as no-match to avoid a firehose.
 */
function matchAll(conditions: CompiledCondition[], ev: LogEvent): Record<string, string> | null {
  if (conditions.length === 0) return null
  const merged: Record<string, string> = {}
  for (const cond of conditions) {
    const groups = conditionMatches(cond, ev)
    if (!groups) return null
    for (const [key, text] of Object.entries(groups)) merged[key] ??= text
  }
  return merged
}

export class AlertsModule implements EqModule<AlertsSnap, AlertsDelta> {
  readonly id = 'alerts'
  private compiled: CompiledAlert[] = []
  private seq = 0
  /**
   * COOLDOWN CLOCK → last fire timestamp (ms).
   *
   * The key is `def.id` for an ordinary (alert-scoped) alert and `def.id\0<targetKey>` for a
   * `cooldownScope:'target'` one — see `cooldownKey`. One map holds both because the two are
   * never confusable: a NUL can appear in no alert id and in no mob name, so an alert-level
   * row can never collide with one of its own per-target rows. Bounded by COOLDOWN_KEY_CAP,
   * least-recently-fired first.
   */
  private lastFire = new Map<string, number>()
  /** fires accumulated since the last flush. */
  private pending: FiredAlert[] = []
  /**
   * Per-alert ring buffer of recent fires (last HISTORY_CAP, newest last). The
   * single source of truth for the renderer's "recent fires" panel — fed by both
   * main-side event/raw fires (onEvent) and renderer-routed app fires (appFired).
   * Persists across character switches so history isn't lost on a reload.
   */
  private history = new Map<string, AlertFireRecord[]>()
  /**
   * RANK-PRESERVING cast recency: spell DISPLAY name (suffix intact — "Mesmerization III") →
   * the newest ts you were seen to begin casting it.
   *
   * WHY IT LIVES HERE. The buffs model's own `lastSeen` map is keyed by `spellCanonKey`, which
   * STRIPS the rank — so it cannot answer "which rank am I actually using", the question the
   * suggestions surface and the upgrade offers are built on. `castBegin` is the literal
   * definition of "most recently cast" and is the ONE event family that keeps the rank
   * (fizzle / interrupt / wears-off lines all drop it). Recording it here costs one map write
   * per cast and adds no IPC: the alerts snapshot already flows to the renderer via useModule.
   *
   * Recorded for REPLAY events too (unlike firing, which is live-only) so the map is complete
   * the moment the renderer hydrates.
   */
  private spellLastCast = new Map<string, number>()
  /** Names whose recency advanced since the last flush (delta payload). */
  private castPending = new Map<string, number>()
  /**
   * ROGUE SLOW POISON RECENCY (docs/plans/poison-slow-alerts.md §1.3) — the observation the
   * "alert when a mob gets slowed?" offer is made from. Recorded on REPLAY as well as live,
   * exactly like `spellLastCast` above and for the same reason: the offer must be right at
   * hydration, not one proc later. Null until a slow has actually been seen — an offer is
   * never made from an assumption about what class you are playing beside.
   */
  private poisonSlowSeen: PoisonSlowRecency | null = null
  /** true when `poisonSlowSeen` advanced since the last flush (delta payload). */
  private poisonSlowDirty = false

  /** Replace the live alert set (called by main after load + every save/delete). */
  setDefs(defs: AlertDef[]): void {
    this.compiled = defs.map(compileAlert)
  }

  /** The defs currently loaded (for snapshot()). */
  private defs(): AlertDef[] {
    return this.compiled.map((c) => c.def)
  }

  reset(): void {
    // Defs persist across character switches (they're user prefs, not log state);
    // only the per-character firing bookkeeping resets. The cast-recency map IS character
    // state (a different character casts different ranks), so it resets with it — the
    // replay that follows repopulates it.
    this.seq = 0
    this.lastFire = new Map()
    this.pending = []
    this.spellLastCast = new Map()
    this.castPending = new Map()
    this.poisonSlowSeen = null
    this.poisonSlowDirty = false
  }

  /**
   * Record a rank-preserving cast. Runs for replay events as well as live ones — the map
   * describes the character, not the session, and the renderer must see it at hydration.
   */
  private noteCast(ev: LogEvent): void {
    if (ev.kind !== 'castBegin') return
    const name = ev.spell.trim()
    if (!name) return
    const prev = this.spellLastCast.get(name)
    if (prev !== undefined && prev >= ev.ts) return
    // Re-insert so Map iteration order stays least-recent-first for the eviction below.
    this.spellLastCast.delete(name)
    this.spellLastCast.set(name, ev.ts)
    this.castPending.set(name, ev.ts)
    if (this.spellLastCast.size > SPELL_CAST_CAP) {
      const oldest = this.spellLastCast.keys().next()
      if (!oldest.done) this.spellLastCast.delete(oldest.value)
    }
  }

  /**
   * Record a rogue slow landing. Like `noteCast`, this runs for REPLAY events too — the
   * record describes the character's fights, not the current session, and the offer strip
   * must be correct at hydration.
   *
   * `effect` is the unambiguous half of a poison proc: the two shared emotes are shared
   * between strikes that agree on their effect (shared/poisons.ts), so 'slow' is exactly
   * Weakening Strike's landing and nothing else.
   */
  private notePoisonSlow(ev: LogEvent): void {
    if (ev.kind !== 'poisonProc' || ev.effect !== 'slow') return
    const prev = this.poisonSlowSeen
    this.poisonSlowSeen = {
      lastAt: Math.max(prev?.lastAt ?? 0, ev.ts),
      count: (prev?.count ?? 0) + 1,
      lastTarget: ev.ts >= (prev?.lastAt ?? 0) ? ev.target : (prev?.lastTarget ?? ev.target)
    }
    this.poisonSlowDirty = true
  }

  onEvent(ev: LogEvent, live: boolean): void {
    this.seq = ev.seq
    this.noteCast(ev)
    this.notePoisonSlow(ev)
    // Fire on LIVE events only — replay must never make a sound.
    if (!live) return
    // Resolved once per firing (fires are rare), not once per compiled alert: both the spell and
    // the event's field namespace are properties of the EVENT, so N alerts matching one line
    // read them once between them. The regex groups are per-alert and come off the hit.
    let spell: string | undefined
    let fields: Record<string, string> = {}
    let resolved = false
    for (const c of this.compiled) {
      if (!c.def.enabled) continue
      const hit = this.matches(c, ev)
      if (hit === null) continue
      const key = cooldownKey(c.def, ev)
      if (this.onCooldown(key, c.def, ev.ts)) continue
      this.noteFire(key, ev.ts)
      if (!resolved) {
        spell = firingSpell(ev)
        fields = eventCaptures(ev)
        resolved = true
      }
      const fired: FiredAlert = { alertId: c.def.id, ts: ev.ts, matchedText: hit.text }
      // Omitted rather than set to undefined: the delta is JSON over IPC, and an absent key
      // is the honest encoding of "this family names no spell".
      if (spell !== undefined) fired.spell = spell
      // Same rule: absent means "there was nothing to name", not "there were zero of them".
      const captures = mergeCaptures(hit.captures, fields)
      if (captures !== undefined) fired.captures = captures
      this.pending.push(fired)
      this.record(c.def.id, ev.ts, hit.text)
    }
  }

  /**
   * Record a renderer-evaluated 'app' fire (e.g. bossDefeat) into the history so
   * the module stays the single source of truth for recent fires. `context` is the
   * signal's matched text (e.g. the boss name). The renderer already applied the
   * cooldown before calling this; we just append to the ring. Returns the updated
   * history for that alert so main can push it back if desired.
   */
  appFired(alertId: string, context: string, ts: number = Date.now()): void {
    // Only record for a known 'app' alert id (ignore stale/unknown ids).
    const known = this.compiled.some((c) => c.def.id === alertId)
    if (!known) return
    this.record(alertId, ts, context)
    // Also queue a delta so the renderer's history updates over the same module
    // transport as event/raw fires. Bump seq so useModule doesn't reject it as a
    // dupe (app fires arrive off the bus, so there's no fresh LogEvent seq); a
    // trailing flushNow() by main pushes it. matchedText = the signal context.
    this.seq += 1
    this.pending.push({ alertId, ts, matchedText: context })
  }

  /** Append a fire to an alert's ring buffer, capping at HISTORY_CAP (newest last). */
  private record(alertId: string, ts: number, matchedText: string): void {
    const arr = this.history.get(alertId) ?? []
    arr.push({ ts, matchedText })
    if (arr.length > HISTORY_CAP) arr.splice(0, arr.length - HISTORY_CAP)
    this.history.set(alertId, arr)
  }

  /** The recent-fires ring as a plain object for the snapshot. */
  private historyObj(): Record<string, AlertFireRecord[]> {
    const out: Record<string, AlertFireRecord[]> = {}
    for (const [id, arr] of this.history) out[id] = arr.slice()
    return out
  }

  /** Whether the clock `key` is still within alert `def`'s cooldown window at `ts`. */
  private onCooldown(key: string, def: AlertDef, ts: number): boolean {
    const cd = def.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const last = this.lastFire.get(key)
    return last !== undefined && ts - last < cd
  }

  /**
   * Stamp a fire on clock `key`, keeping the map bounded and its iteration order
   * least-recently-fired first (delete-then-set re-inserts at the tail).
   */
  private noteFire(key: string, ts: number): void {
    this.lastFire.delete(key)
    this.lastFire.set(key, ts)
    if (this.lastFire.size > COOLDOWN_KEY_CAP) {
      const oldest = this.lastFire.keys().next()
      if (!oldest.done) this.lastFire.delete(oldest.value)
    }
  }

  /**
   * Returns the matched text + this trigger's own regex named groups if the alert's trigger
   * matches `ev`, else null. `captures` is `{}` for a trigger that declares no groups, which is
   * the ordinary case — the EVENT's fields are folded in later (`mergeCaptures`), not here.
   *
   * Composite semantics (Task #47) — evaluated against the SINGLE incoming event:
   *   'any'    → fires when at least ONE condition matches (OR).
   *   'all'    → fires only when EVERY condition matches THE SAME event (AND).
   *   'single' → the one primitive condition (backward-compatible, unchanged).
   * Cross-event correlation is deliberately out of scope; an 'all' over conditions that can
   * never co-occur on one event (e.g. two different `kind`s) simply never fires.
   */
  private matches(c: CompiledAlert, ev: LogEvent): TriggerHit | null {
    if (c.composite === 'all') {
      const groups = matchAll(c.conditions, ev)
      return groups ? { text: ev.raw, captures: groups } : null
    }
    // 'any' and 'single': fire on the first matching condition, and take ITS groups — evaluation
    // stops there, so there is no second condition whose groups could have been meant instead.
    for (const cond of c.conditions) {
      const groups = conditionMatches(cond, ev)
      if (groups) return { text: ev.raw, captures: groups }
    }
    return null
  }

  snapshot(): { seq: number; state: AlertsSnap } {
    const state: AlertsSnap = {
      defs: this.defs(),
      history: this.historyObj(),
      spellLastCast: Object.fromEntries(this.spellLastCast)
    }
    // Omitted rather than null: the snapshot is JSON over IPC and an absent key is the honest
    // encoding of "no slow has ever been observed for this character".
    if (this.poisonSlowSeen) state.poisonSlowSeen = { ...this.poisonSlowSeen }
    return { seq: this.seq, state }
  }

  flushDelta(): { seq: number; delta: AlertsDelta } | null {
    // A flush is warranted by a fire, a cast-recency advance OR a slow landing — the upgrade
    // offers recompute off the second and the poison-slow offer off the third, and neither
    // may wait for an unrelated alert to fire.
    const slow = this.poisonSlowDirty ? this.poisonSlowSeen : null
    if (this.pending.length === 0 && this.castPending.size === 0 && !slow) return null
    const fired = this.pending
    this.pending = []
    const cast = [...this.castPending].map(([spell, ts]) => ({ spell, ts }))
    this.castPending = new Map()
    this.poisonSlowDirty = false
    const delta: AlertsDelta = { fired }
    if (cast.length > 0) delta.cast = cast
    if (slow) delta.poisonSlow = { ...slow }
    return { seq: this.seq, delta }
  }
}
