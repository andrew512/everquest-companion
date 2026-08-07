// speechText.ts — WHAT a voice alert says. The content half of voice alerts
// (docs/plans/voice-alerts.md §1), and nothing else: no engine, no audio, no IPC.
//
// THE ONE FUNCTION. `speechTextFor(def, firing)` resolves a def's speech config plus the
// firing's spell context into the literal string to speak. It is PURE — no clock, no store,
// no I/O — so the alert editor's live preview, the renderer's player and any future
// main-side caller all produce byte-identical text from the same inputs. It answers WHAT to
// say; whether to say anything at all is `def.audio` ('speech' | 'both'), which lives on the
// def precisely so the two questions never get tangled.
//
// RANK-STRIPPING IS THE RESOLVER'S JOB. The log casts `Mesmerization III` and the fade line
// says `Mesmerization`; ranks are noise aloud, so the spell modes fold them out through
// `parseSpellRank` — the SAME rank machinery `spellCanonKey`/`spellLineKey` use (shared/
// spellLines.ts, whose equality with the parser helper is pinned by tests/spellLines.test.mts).
// It is imported, not re-implemented: a second rank regex in the tree is a second answer.
//
// NEVER SILENT, NEVER A GUESS (world-model law 1). A spell mode on a firing that carries no
// spell — an app-signal alert, a raw trigger on a spell-less line, an event family that names
// no spell — falls back to the alert's own NAME. Saying the alert's name is a true statement
// about what fired; saying nothing is a broken alert the user cannot see, and inventing a
// spell name is worse than both.
//
// This module also owns the RUNTIME constants of the voice model (the mode/engine/action
// lists, the char cap, the pref defaults). The TYPES live in shared/alertTypes.ts; these are
// their values, kept here because this is the module every consumer — the migration, the
// editor, the preferences panel — already has to import.

import type {
  AlertAudio,
  AlertDef,
  AlertSpeech,
  FiredAlert,
  SpeechEngine,
  SpeechMode,
  VoicePrefs
} from './alertTypes'
import { parseSpellRank } from './spellLines'

/**
 * Longest utterance a single alert may speak, in characters.
 *
 * 120 is roughly eight seconds of speech at a normal rate — already far past the point where
 * an ALERT stops being an alert. The cap is not a validation error: over-long text is TRUNCATED
 * so a paste-happy custom phrase still speaks its opening words instead of failing.
 */
export const MAX_SPEECH_CHARS = 120

/** Every SpeechMode, for the editor's mode picker. Exhaustive by construction. */
export const SPEECH_MODES = [
  'alertName',
  'spellName',
  'spellFirstWord',
  'custom'
] as const satisfies readonly SpeechMode[]

/** Every audio action, for the editor's sound/speech/both selector. Exhaustive by construction. */
export const ALERT_AUDIO_ACTIONS = ['sound', 'speech', 'both'] as const satisfies readonly AlertAudio[]

/** Every engine tier, for the preferences engine picker. Exhaustive by construction. */
export const SPEECH_ENGINES = ['system', 'kokoro'] as const satisfies readonly SpeechEngine[]

// Compile-time proof that each list covers its WHOLE union — the logEventKinds.ts pattern. If a
// member is added to the union and forgotten here, the assignment below stops compiling.
const _modesExhaustive: (typeof SPEECH_MODES)[number] = null as unknown as SpeechMode
const _actionsExhaustive: (typeof ALERT_AUDIO_ACTIONS)[number] = null as unknown as AlertAudio
const _enginesExhaustive: (typeof SPEECH_ENGINES)[number] = null as unknown as SpeechEngine
void _modesExhaustive
void _actionsExhaustive
void _enginesExhaustive

/**
 * The voice's CONFIGURATION at its defaults — the free, zero-download tier, the engine's own
 * choice of voice, ordinary speed and full volume (decision D1).
 *
 * There is no `enabled` here because there is no master switch: an alert speaks because ITS
 * `audio` says 'speech'/'both', full stop (see VoicePrefs in shared/alertTypes.ts). "Off until
 * asked for" is still true, and is still what a fresh install does — it is just enforced where
 * the ask happens (no alert asks to speak by default) instead of by a second global toggle.
 */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  engine: 'system',
  voiceId: null,
  rate: 1,
  volume: 1
}

/** Rate bounds. Below 0.5 speech drags past the alert's usefulness; above 2 it is a chipmunk. */
export const MIN_SPEECH_RATE = 0.5
export const MAX_SPEECH_RATE = 2

/**
 * Repair anything that claims to be VoicePrefs into something that IS.
 *
 * Takes `unknown` because that is the honest type of what it is handed: the store's `voice`
 * key (a file a user can edit, a downgrade can predate, and a future build can have written)
 * and the renderer's setter payload (a renderer string is a renderer string). ONE
 * implementation so the migration, the store read and the store write can never disagree
 * about which values are legal — an unknown engine is not coerced into a guess, it falls
 * back to the documented default.
 */
export function normalizeVoicePrefs(value: unknown): VoicePrefs {
  const raw: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const engine = SPEECH_ENGINES.find((e) => e === raw.engine)
  const voiceId = raw.voiceId
  // A legacy `enabled` key is DROPPED, not read: schema v8 retired the master switch, and the
  // migration that retired it is the only code that may still look at the old value (it decides
  // whether the user's spoken alerts stay spoken). Anything reading it here would be a second,
  // undocumented switch.
  return {
    engine: engine ?? DEFAULT_VOICE_PREFS.engine,
    // null (never undefined) is the stated "use whatever voice the engine defaults to".
    voiceId: typeof voiceId === 'string' && voiceId.trim() ? voiceId : null,
    rate: clampNumber(raw.rate, MIN_SPEECH_RATE, MAX_SPEECH_RATE, DEFAULT_VOICE_PREFS.rate),
    volume: clampNumber(raw.volume, 0, 1, DEFAULT_VOICE_PREFS.volume)
  }
}

/** A finite number clamped into [lo, hi]; anything that is not a number becomes `fallback`. */
function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The firing context `speechTextFor` reads. Structural on purpose: a `FiredAlert` satisfies it
 * (that is the real caller), and so does a `{ spell }` literal in a test or an editor preview,
 * without either having to fabricate an alertId and a timestamp.
 */
export type SpeechFiring = Pick<FiredAlert, 'spell' | 'captures'>

// ----- `$<name>` substitution in a custom phrase -----
//
// A custom phrase may name values the firing carried: `$<mob> is casting $<spell>`. The names
// come from ONE namespace with two sources — the matched event's own scalar fields and the
// trigger's regex named groups, merged in main (modules/alerts.ts `mergeCaptures`) — so the
// phrase does not have to know, or care, which half a name came from.
//
// THE SYNTAX IS JAVASCRIPT'S OWN. `$<name>` is exactly how a named group is spelled at the other
// end (`(?<mob>.+)`), so the phrase reads like the regex that feeds it and there is one spelling
// to learn rather than two. It also cannot collide with an existing saved phrase: `$<` is not a
// sequence anyone typed into a sentence they wanted read aloud.
//
// AN UNRESOLVED NAME IS DROPPED, NOT SPOKEN (owner decision). A group that did not participate
// in the match, or a name typed with a typo, substitutes to nothing and the surrounding
// whitespace collapses — so `$<mob> resisted $<spell>` with no spell says "a froglok resisted"
// rather than reading punctuation out loud. If the WHOLE phrase resolves to nothing, the caller's
// existing alertName fallback takes over: still never silent, still never a guess.
//
// SUBSTITUTION IS 'custom' ONLY. The other three modes are fixed content by definition — the
// alert's name, the spell's name, its first word — and a placeholder in a def's NAME would be a
// name that reads differently in the alert list than in the history than out loud.

/**
 * A placeholder occurrence. The name is restricted to what JS actually accepts as a group name's
 * leading-ASCII case (`(?<1bad>…)` is a SyntaxError), so a pattern that cannot exist on the
 * regex side cannot be written on the phrase side either.
 */
const PLACEHOLDER_RE = /\$<([A-Za-z_$][A-Za-z0-9_$]*)>/g

/** Replace every `$<name>` with its captured value, or with nothing when there is none. */
function substitute(text: string, captures: SpeechFiring['captures']): string {
  if (!text.includes('$<')) return text
  return text.replace(PLACEHOLDER_RE, (_match, name: string) => captures?.[name] ?? '')
}

/** Every distinct `$<name>` a phrase references, in first-appearance order. */
export function placeholdersIn(phrase: string): string[] {
  const names = new Set<string>()
  for (const m of phrase.matchAll(PLACEHOLDER_RE)) names.add(m[1])
  return [...names]
}

/** The def fields the resolver reads. Any AlertDef satisfies it. */
export type SpeechDef = Pick<AlertDef, 'name' | 'speech'>

/** Trim + collapse runs of whitespace: a newline in a phrase is a pause, not a word break. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cap an utterance at MAX_SPEECH_CHARS, cutting mid-word rather than refusing to speak. */
function cap(text: string): string {
  return text.length <= MAX_SPEECH_CHARS ? text : text.slice(0, MAX_SPEECH_CHARS).trimEnd()
}

/** The rank-stripped display base of a spell name ("Mesmerization III" → "Mesmerization"). */
function spellBase(spell: string): string {
  return tidy(parseSpellRank(spell).base)
}

/**
 * Resolve ONE mode against the firing, or null when this mode cannot answer (a spell mode with
 * no spell, an empty custom phrase). Null is what the caller turns into the alertName fallback.
 */
function resolveMode(mode: SpeechMode, speech: AlertSpeech, firing: SpeechFiring | null): string | null {
  // Substitute BEFORE tidying, so the whitespace a dropped placeholder leaves behind collapses
  // with the rest rather than becoming a double space in the middle of the utterance.
  if (mode === 'custom') return tidy(substitute(speech.phrase ?? '', firing?.captures)) || null
  if (mode === 'alertName') return null
  const spell = tidy(firing?.spell ?? '')
  if (!spell) return null
  const base = spellBase(spell)
  if (!base) return null
  if (mode === 'spellName') return base
  // 'spellFirstWord' — shortest useful utterance. `base` is already whitespace-collapsed.
  return base.split(' ')[0] || null
}

/**
 * The text this alert should speak for this firing, or null when there is nothing truthful to
 * say (a nameless def whose mode resolved to nothing — the UI shows no preview and the player
 * speaks nothing rather than an empty utterance).
 *
 * `firing` is optional so the alert editor can render a live preview before anything has fired;
 * with no firing the spell modes simply take the alertName fallback, which is exactly what the
 * user will hear if the trigger turns out to name no spell.
 */
export function speechTextFor(def: SpeechDef, firing?: SpeechFiring | null): string | null {
  // A def with no speech block still has a sensible thing to say: its own name. Defaulting
  // here (rather than refusing) means enabling `audio:'speech'` on an existing alert is a
  // one-field change that already works.
  const speech: AlertSpeech = def.speech ?? { mode: 'alertName' }
  const resolved = resolveMode(speech.mode, speech, firing ?? null)
  const text = resolved ?? tidy(def.name)
  return text ? cap(text) : null
}
