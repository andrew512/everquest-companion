// ============================================================================
// TELEMETRY CONTRACT — the ONE definition of what usage analytics may ever say.
// ============================================================================
//
// Imported by FOUR consumers and owned by none of them:
//   * the renderer          (`window.eq.track()` builds these values and nothing else),
//   * the main process      (re-validates at the IPC boundary before a single event is
//                            buffered — renderer input is untrusted, same law as every
//                            other handler),
//   * the doc generator     (`src/shared/telemetryDoc.ts` renders TELEMETRY.md from the
//                            tables below, so the published doc cannot drift from the code),
//   * the ingest Lambda     (wave A2 — `validateTelemetryBatch` is the server's whole shape
//                            check, exactly as `validateSubmit` is for feedback).
//
// THE VALIDATORS LIVE NEXT DOOR, in `./telemetryValidate.ts`. That split is a factoring
// decision and nothing more (the contract plus its validators is past the repo's 400-code-line
// ceiling); the two files are one definition and only ever move together.
//
// LAWS THIS FILE OBEYS (docs/plans/usage-analytics.md T2):
//
//   * PURE. Zero imports — no `node:`, no Electron, no DOM, not even `shared/types.ts`.
//     It compiles under both tsconfigs, is read by `storeMigrations.ts` at store.ts's module
//     scope, and has to bundle into a Lambda. (`tests/telemetryContract.test.mts` pins the
//     duplicated overlay-kind list against the real `OVERLAY_KINDS`, so the copy cannot rot.)
//
//   * THE SCHEMA CANNOT EXPRESS A NAME. There is no free-text field anywhere in the event
//     union. Every string-typed field is a member of a CLOSED enum declared in this file;
//     the only two exceptions are `analyticsId` (a v4 UUID, regex-pinned) and `appVersion`
//     (semver, regex-pinned), neither of which can carry prose. A character, zone, mob,
//     spell, item, file path or log line has nowhere to go — not because we remember to
//     strip it, but because the type has no slot for it.
//
//   * WHERE A RAW NUMBER IS ITSELF REVEALING, THE SCHEMA CARRIES A BUCKET, and the bucket
//     EDGES are declared here so TELEMETRY.md prints them exactly. "How many characters do
//     you play" and "how big is your log" are facts about a person; "3–4" and "100–512 MB"
//     are facts about a population.
//
//   * The validators are TOTAL and side-effect free: every failure is a typed value, nothing
//     throws, and the same call on the same input always returns the same answer.

/** Bumped only for a BREAKING wire change; the server rejects anything else outright. */
export const TELEMETRY_API_VERSION = 1

// ---------------------------------------------------------------- closed enums
//
// Every one of these is a CLOSED set that grows by schema PR only. That is the whole point:
// a value not listed here is refused by the validator on the client before it is buffered and
// again on the server before it is counted.

/** `'e2e'` is deliberately absent — the headless harness never sends (T7). */
export const TELEMETRY_CHANNELS = ['prod', 'dev'] as const
export type TelemetryChannel = (typeof TELEMETRY_CHANNELS)[number]

/** `process.platform`, folded to a closed set. A raw platform string is still a string. */
export const TELEMETRY_PLATFORMS = ['win32', 'darwin', 'linux', 'other'] as const
export type TelemetryPlatform = (typeof TELEMETRY_PLATFORMS)[number]

/**
 * The app's top-level views (`renderer/src/appViews.ts`). Duplicated rather than imported
 * because that module is renderer-only (it reads a vite define through `devFlags`), and this
 * file may import nothing at all.
 */
export const TELEMETRY_VIEWS = [
  'overview',
  'combat',
  'mobs',
  'maps',
  'bosses',
  'posky',
  'alerts',
  'leveling',
  'loot',
  'planner',
  'buffs',
  'preferences',
  'triage'
] as const
export type TelemetryView = (typeof TELEMETRY_VIEWS)[number]

/** The floating-overlay kinds (`shared/types.ts OVERLAY_KINDS`; parity is pinned). */
export const TELEMETRY_OVERLAY_KINDS = [
  'fight',
  'overall',
  'heal-fight',
  'heal-overall',
  'events',
  'toast',
  'alert'
] as const
export type TelemetryOverlayKind = (typeof TELEMETRY_OVERLAY_KINDS)[number]

/**
 * The feature-reach enum (plan §2). It is deliberately WIDER than the call sites wave A1
 * wires: the enum exists so later waves add a `track()` call without touching the schema,
 * the doc, or the server. An entry with no call site simply never appears in the data.
 */
export const TELEMETRY_FEATURES = [
  'mapOpen',
  'mapSearch',
  'rangeSelect',
  'comboCorrection',
  'feedbackOpen',
  'alertGroupAdd',
  'drillPet',
  'copyView',
  'speechPreview',
  'procAnalyticsOpen',
  'questFavorite',
  'lootFilter',
  'profileSwitch'
] as const
export type TelemetryFeature = (typeof TELEMETRY_FEATURES)[number]

/**
 * Which TTS tier a session would speak with (voice-alerts §2).
 *
 * 'off' HAD TO BE REDEFINED and this is the honest replacement. It used to mean "the Preferences
 * master switch is off" — the switch that decided whether any alert could speak. That switch was
 * retired (2026-08-04, schema v8): an alert speaks because ITS OWN `audio` says so, and the tier
 * is now pure configuration that is always set to something. So 'off' now means the only thing
 * "this install does not use speech" can still mean: NO ENABLED ALERT IS SET TO SPEAK. 'system' /
 * 'kokoro' therefore say "at least one alert speaks, through this tier", which is what the
 * question was always after.
 *
 * The producer is unbuilt (usage-analytics A1 ships `setupSnapshot` deliberately dark), so this
 * is a contract note, not a description of running code — the mapping is stated here so whoever
 * builds the emitter cannot re-derive the old meaning from the old name.
 */
export const TELEMETRY_VOICE_ENGINES = ['system', 'kokoro', 'off'] as const
export type TelemetryVoiceEngine = (typeof TELEMETRY_VOICE_ENGINES)[number]

/** The auto-update release channel. */
export const TELEMETRY_UPDATE_CHANNELS = ['main', 'stable'] as const
export type TelemetryUpdateChannel = (typeof TELEMETRY_UPDATE_CHANNELS)[number]

/** The three funnels of plan §3. */
export const TELEMETRY_FUNNELS = ['first-run', 'voice-install', 'feedback'] as const
export type TelemetryFunnel = (typeof TELEMETRY_FUNNELS)[number]

/**
 * Each funnel's steps, in ORDER — the order is the funnel (the panel reads conversion between
 * adjacent entries). A step is legal only inside its own funnel; `validateFunnelStep` checks
 * the PAIR, so `{funnel:'feedback', step:'downloadStarted'}` is refused.
 */
export const TELEMETRY_FUNNEL_STEPS: Readonly<Record<TelemetryFunnel, readonly string[]>> = {
  'first-run': [
    'installed',
    'logDetected',
    'firstParse',
    'firstNonOverviewView',
    'firstOverlayEnabled'
  ],
  'voice-install': ['engineSelected', 'downloadStarted', 'downloadCompleted', 'firstUtterance'],
  feedback: ['dialogOpened', 'sendPressed', 'sendFinished']
}

/** How a step ended, when it ended at all. Absent means "reached", which is the common case. */
export const TELEMETRY_OUTCOMES = ['ok', 'failed', 'queued'] as const
export type TelemetryOutcome = (typeof TELEMETRY_OUTCOMES)[number]

/** A COARSE class, never a message. Five values, and 'other' is where everything else lands. */
export const TELEMETRY_FAILURE_CLASSES = [
  'network',
  'checksum',
  'disk',
  'timeout',
  'other'
] as const
export type TelemetryFailureClass = (typeof TELEMETRY_FAILURE_CLASSES)[number]

/** The auto-updater's three observable steps. */
export const TELEMETRY_UPDATE_STEPS = ['check', 'download', 'apply'] as const
export type TelemetryUpdateStep = (typeof TELEMETRY_UPDATE_STEPS)[number]

// ---------------------------------------------------------------- buckets
//
// EDGES, not labels: bucket `i` is the number of edges strictly at or below the value, so
// bucket 0 is "below the first edge" and bucket `edges.length` is "at or above the last".
// `edges.length + 1` buckets in total, and TELEMETRY.md prints every range from these arrays.

/** Time from process start to the first window paint. */
export const COLD_START_MS_EDGES = [1_000, 2_500, 5_000, 10_000, 20_000] as const
/** How many character logs the install can see. 1 is the overwhelming common case. */
export const CHAR_COUNT_EDGES = [1, 2, 3, 5, 9] as const
/** Size of the tailed log on disk. A raw byte count is a fingerprint; a decade is not. */
export const LOG_SIZE_BYTES_EDGES = [
  1_048_576,
  10_485_760,
  104_857_600,
  536_870_912,
  2_147_483_648
] as const
/** How many alert definitions the user keeps. */
export const ALERT_COUNT_EDGES = [1, 5, 10, 25, 50] as const

/** The bucket index of `value` under `edges`. Non-finite input lands in bucket 0. */
export function bucketOf(value: number, edges: readonly number[]): number {
  if (!Number.isFinite(value)) return 0
  let i = 0
  while (i < edges.length && value >= edges[i]) i++
  return i
}

/** The half-open range bucket `i` covers: `[lo, hi)`, with `hi: null` for the open top. */
export function bucketRange(
  edges: readonly number[],
  i: number
): { lo: number; hi: number | null } {
  return { lo: i === 0 ? 0 : edges[i - 1], hi: i < edges.length ? edges[i] : null }
}

/** UTC offset in WHOLE HOURS — the coarsest useful "when do people play" signal. */
export const MIN_TZ_OFFSET_HOURS = -12
export const MAX_TZ_OFFSET_HOURS = 14

/** Offset in minutes (`-new Date().getTimezoneOffset()`) → whole hours, clamped. */
export function tzOffsetBucket(offsetMinutes: number): number {
  if (!Number.isFinite(offsetMinutes)) return 0
  const hours = Math.round(offsetMinutes / 60)
  return Math.max(MIN_TZ_OFFSET_HOURS, Math.min(MAX_TZ_OFFSET_HOURS, hours))
}

// ---------------------------------------------------------------- limits

/** Ring capacity of `<userData>/telemetry.json`. Oldest is dropped; nothing is ever refused. */
export const TELEMETRY_BUFFER_CAP = 500
/** Most events one flush may carry. Same number: a full buffer is one batch. */
export const MAX_BATCH_EVENTS = TELEMETRY_BUFFER_CAP
/**
 * The ingest body cap, checked BEFORE `JSON.parse` (the Lambda's cheapest step, and the only
 * one that runs on a hostile body). Deliberately larger than feedback's 32 KB: a feedback body
 * is one description, a telemetry body is up to `MAX_BATCH_EVENTS` records.
 *
 * MEASURED CEILING: the fattest record in the union is a `setupSnapshot` carrying all five
 * overlay kinds — ~260 bytes with its `{ts, ev}` wrapper — so a maximal 500-record batch is
 * ~130 KB. 256 KB is that with room to spare and still small enough that a flood of maximal
 * bodies stays inside the route throttle's cost model.
 */
export const MAX_TELEMETRY_BODY_BYTES = 256 * 1024

/** Ceiling for every plain count field. Well past any real session; refuses nonsense. */
export const MAX_COUNT = 1_000_000
/**
 * Ceiling for a REPLAY event count, and it is deliberately not `MAX_COUNT`.
 *
 * MEASURED: the owner's own log is past 1.35M lines and the startup replay folds every one of
 * them, so `MAX_COUNT` is not "well past any real session" for this one number — it sits BELOW
 * the logs the measurement exists to describe, and clamping there would report every big log as
 * exactly one million. `linesParsed` can live with the cap because it is a delta that keeps its
 * remainder for the next heartbeat (collector.ts); a single launch's `eventsReplayed` has no
 * next report to carry a remainder into, so it needs a ceiling that is genuinely out of reach.
 */
export const MAX_REPLAY_EVENTS = 100_000_000
/** Ceiling for every duration field (30 days). A longer session is a broken clock. */
export const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000

/** `crypto.randomUUID()` shape — the analyticsId's only permitted spelling. */
export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** `app.getVersion()` — semver, optionally with the CI channel prerelease tag. */
export const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/

// ------------------------------------------------------- the startup replay reading (JOS-57)
//
// WHAT THIS IS FOR. The chunked replay (docs/plans/chunked-replay.md) and its duty cycle (JOS-50)
// are throttles tuned on ONE developer machine against ONE 1.35M-line log. Everything the app
// knows about whether they work is therefore a fact about that machine. These six numbers are the
// same launch measured on machines nobody here owns — the whole point of the ticket.
//
// NUMBERS ONLY, and structurally so: the same posture as `updateOutcome`'s `failureClass` (a
// message reduced to one of five words before it can reach an event). There is no field here a
// character, a server, a zone or a PATH could go in, and the one number that would itself be
// revealing — how big your log is — is a BUCKET INDEX before it is ever assigned.
//
// ONE LAUNCH IS ONE READING, and `src/main/perf.ts` enforces that at the seam: it is produced when
// the `replayDone` startup phase lands, which happens exactly once per process (`addMark` refuses
// a duplicate). A character SWITCH replays a log too — and is deliberately not measured, because a
// switch replay and a launch replay are different work under different conditions, and a
// population that mixed them could not answer "how long does starting this app take".

export interface StartupReplayStats {
  /** Wall clock of the startup replay, ms: `tailAttached` → `replayDone`. */
  replayMs: number
  /** Log events the historical scan folded. Ceiling `MAX_REPLAY_EVENTS`, not `MAX_COUNT`. */
  eventsReplayed: number
  /**
   * The duty the fold ACHIEVED, whole percent 0..100 — measured by the slicer, never the setting
   * it aimed at (Windows' 15.6 ms timer quantum decides what a rest is actually worth).
   */
  dutyPct: number
  /** The worst single main-loop block observed during the replay, ms. */
  maxBlockMs: number
  /** Probe ticks that were at least 50 ms late (`STARTUP_BLOCK_THRESHOLD_MS`). */
  blocksOver50: number
  /** Index into `LOG_SIZE_BYTES_EDGES`. A raw byte count is a fingerprint; a decade is not. */
  logSizeBucket: number
}

/** The raw facts the producer holds, before any of them is a legal wire value. */
export interface StartupReplayInput {
  replayMs: number
  eventsReplayed: number
  /** The duty ledger, as `shared/perf.ts ReplayDutyStats` states it. */
  workMs: number
  restMs: number
  maxBlockMs: number
  blocksOver50: number
  /** Bytes the scan actually folded (its frozen EOF) — bucketed here, never sent raw. */
  logBytes: number
}

/**
 * THE ONE PLACE A READING IS BUILT, so the producer cannot invent a shape and the ceilings cannot
 * be forgotten. Total: every field is clamped to what its own validator will accept, so an event
 * this function returns is one this app's own validator can never refuse (a producer whose events
 * are silently dropped at the IPC boundary would be indistinguishable from a fleet with no slow
 * launches). The duty is computed here rather than sent as two numbers because the wire should
 * carry the ANSWER, and `workMs`/`restMs` separately would invite a reader to re-derive it wrong.
 */
export function startupReplayStats(input: StartupReplayInput): StartupReplayStats {
  const work = clampWhole(input.workMs, MAX_DURATION_MS)
  const rest = clampWhole(input.restMs, MAX_DURATION_MS)
  const wall = work + rest
  return {
    replayMs: clampWhole(input.replayMs, MAX_DURATION_MS),
    eventsReplayed: clampWhole(input.eventsReplayed, MAX_REPLAY_EVENTS),
    dutyPct: wall > 0 ? Math.round((work / wall) * 100) : 0,
    maxBlockMs: clampWhole(input.maxBlockMs, MAX_DURATION_MS),
    blocksOver50: clampWhole(input.blocksOver50, MAX_COUNT),
    logSizeBucket: bucketOf(clampWhole(input.logBytes, Number.MAX_SAFE_INTEGER), LOG_SIZE_BYTES_EDGES)
  }
}

/** A whole number in `[0, max]`. Non-finite reads as 0 — the producer's numbers come from timers
 *  and a `stat()`, both of which can hand over a NaN on a bad day. */
function clampWhole(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.round(value), max))
}

// ---------------------------------------------------------------- the event union
//
// THE ADDITIVE-FIELD RULE (learned while adding `linesParsed`, 2026-08-06). A shipped client can
// be talking to a server running an OLDER copy of this contract, because the app auto-updates
// itself and the Lambda is deployed by hand. The two ways to add a measurement are NOT equally
// safe under that skew:
//
//   * A NEW EVENT KIND is fatal. `validateTelemetryBatch` fails the WHOLE batch on an unknown
//     `t`, the endpoint answers 400, and `telemetryPermanentRefusal` (main/telemetry/net.ts)
//     classes 400 as "these bytes will never be accepted" and DROPS the batch. So a client that
//     emits an event the deployed server has never heard of throws away every counter it is
//     carrying, on every flush, until the deploy lands.
//
//   * A NEW OPTIONAL FIELD on an existing kind is free. The validators do not sanitize an object,
//     they CONSTRUCT one field by field — so an older server simply does not copy the field
//     across, accepts the batch, and counts everything else exactly as before. The measurement
//     starts at zero and begins moving the moment the Lambda is redeployed.
//
// That is why `linesParsed` rides on `sessionHeartbeat`/`sessionEnd` instead of arriving as its
// own event: the client half of this feature is safe to ship BEFORE the additive infra apply.
//
// `startup` (JOS-57) is the SECOND measurement to take that deal, and it took it for exactly the
// same reason. A `startupReplay` event of its own would have read better and would have blacked
// out every counter this app collects — not just the startup ones — on every install that
// auto-updated ahead of the Lambda deploy. What it costs instead is stated on the field itself:
// the reading rides the next session report, so a launch killed before either one is lost.

export interface EvSessionStart {
  t: 'sessionStart'
  coldStartMsBucket: number
}
export interface EvSessionHeartbeat {
  t: 'sessionHeartbeat'
  uptimeMs: number
  /** Log lines parsed since the previous report. OPTIONAL — see THE ADDITIVE-FIELD RULE below. */
  linesParsed?: number
  /** This launch's startup replay, if it has not been reported yet. Optional, same rule. */
  startup?: StartupReplayStats
}
export interface EvSessionEnd {
  t: 'sessionEnd'
  durationMs: number
  viewsVisited: number
  /** The tail of the same counter: lines parsed since the last heartbeat. Optional, same rule. */
  linesParsed?: number
  /** This launch's startup replay, if no heartbeat carried it first. Optional, same rule. */
  startup?: StartupReplayStats
}
export interface EvViewDwell {
  t: 'viewDwell'
  view: TelemetryView
  ms: number
}
export interface EvOverlayToggle {
  t: 'overlayToggle'
  kind: TelemetryOverlayKind
  open: boolean
}
export interface EvFeatureUse {
  t: 'featureUse'
  feature: TelemetryFeature
  count: number
}
export interface EvAlertFired {
  t: 'alertFired'
  count: number
  spokenCount: number
}
export interface EvSetupSnapshot {
  t: 'setupSnapshot'
  charCountBucket: number
  logSizeBucket: number
  alertCountBucket: number
  overlaysEnabled: TelemetryOverlayKind[]
  cursorRing: boolean
  autoHide: boolean
  voiceEngine: TelemetryVoiceEngine
  soundPackCount: number
  updateChannel: TelemetryUpdateChannel
}
export interface EvFunnelStep {
  t: 'funnelStep'
  funnel: TelemetryFunnel
  step: string
  outcome?: TelemetryOutcome
  failureClass?: TelemetryFailureClass
}
export interface EvHealthCounters {
  t: 'healthCounters'
  rendererCrashes: number
  mainErrorLogLines: number
  parserStalls: number
  presenceRestarts: number
  speechFailures: number
}
export interface EvUpdateOutcome {
  t: 'updateOutcome'
  step: TelemetryUpdateStep
  ok: boolean
  failureClass?: TelemetryFailureClass
}

export type TelemetryEvent =
  | EvSessionStart
  | EvSessionHeartbeat
  | EvSessionEnd
  | EvViewDwell
  | EvOverlayToggle
  | EvFeatureUse
  | EvAlertFired
  | EvSetupSnapshot
  | EvFunnelStep
  | EvHealthCounters
  | EvUpdateOutcome

export type TelemetryEventKind = TelemetryEvent['t']

/** Runtime spelling of the union's tags, in doc order. */
export const TELEMETRY_EVENT_KINDS = [
  'sessionStart',
  'sessionHeartbeat',
  'sessionEnd',
  'viewDwell',
  'overlayToggle',
  'featureUse',
  'alertFired',
  'setupSnapshot',
  'funnelStep',
  'healthCounters',
  'updateOutcome'
] as const

// ---------------------------------------------------------------- envelope + batch
//
// Plan §2: "all events carry {v, analyticsId, appVersion, channel, platform, tzOffsetBucket}".
// They do — through the BATCH, which is the unit that crosses the wire. Every one of those
// fields is constant for the life of a session, and stamping six copies onto every event so a
// flush of 500 can repeat them 500 times would be payload, not information.

export interface TelemetryEnvelope {
  /** The rotatable anonymous id. NOT the feedback installId — deliberately non-correlatable. */
  analyticsId: string
  appVersion: string
  channel: TelemetryChannel
  platform: TelemetryPlatform
  /** UTC offset in whole hours (`tzOffsetBucket`). */
  tzOffsetBucket: number
}

/** One buffered event plus the client clock. The SERVER aggregates by arrival day; `ts` exists
 *  so the Preferences payload viewer can say when, and for ordering inside the ring. */
export interface TelemetryRecord {
  ts: number
  ev: TelemetryEvent
}

export interface TelemetryBatch {
  v: typeof TELEMETRY_API_VERSION
  env: TelemetryEnvelope
  events: TelemetryRecord[]
}

/**
 * What the Preferences payload viewer renders (T4: "show the payload"). It crosses the preload
 * bridge, so it is a SHARED shape — main and the renderer name one definition.
 *
 * `lastBatch` is null until a batch has actually been ACCEPTED by the server, and the pane says
 * which silence that is — "nothing sent yet" or "this build has no endpoint". An empty box the
 * user has to interpret would be a worse answer than a sentence explaining why it is empty.
 */
export interface TelemetryPayloadView {
  prefs: TelemetryPrefs
  /** True once an endpoint is compiled in — see `src/main/telemetry/net.ts`. */
  endpointConfigured: boolean
  /** The live ring, oldest first. */
  buffered: TelemetryRecord[]
  lastBatch: TelemetryBatch | null
}

// ---------------------------------------------------------------- prefs (persisted)
//
// The store blob behind schema migration 5 → 6. It lives here rather than in a `telemetryPrefs`
// module because this file is already the pure, import-free home of everything telemetry-shaped
// that main, the renderer and `storeMigrations.ts` all have to agree on.
//
// OPT-OUT (owner decision T1) — `enabled: true` on a fresh install — but `noticeShown: false`,
// and NOTHING may transmit until that flips. `analyticsId: null` until the collector first
// starts: there is no reason to mint an identifier for a user who has not run the app yet.

export interface TelemetryPrefs {
  /** Master switch. False ⇒ the buffer is dropped immediately and nothing is collected. */
  enabled: boolean
  /** Has the first-run notice RENDERED? The network gate, not just a UI flag. */
  noticeShown: boolean
  /** The rotatable anonymous id, or null until the collector mints one. */
  analyticsId: string | null
  /**
   * ONCE-EVER FUNNEL STEPS ALREADY EMITTED, as `"<funnel>:<step>"` marks — see
   * `funnelStepMark` below.
   *
   * The first-run and voice-install funnels ask "how far did this INSTALL get", so each of their
   * steps may contribute at most one event for the life of the install. A counter that could be
   * re-emitted would measure how often somebody re-opens a tab, not how many installs ever
   * reached it, and the panel's conversion rates would exceed 100% by construction.
   *
   * It lives beside the switch rather than in the disposable ring because it must OUTLIVE the
   * ring: the ring is dropped on opt-out, on rotation and on any unreadable file, and a mark that
   * went with it would let `installed` fire a second time on the same machine.
   *
   * It is NOT an identifier and carries nothing personal — a list of at most a dozen schema
   * constants, each of which is printed in TELEMETRY.md.
   */
  funnelsDone: string[]
}

export const DEFAULT_TELEMETRY_PREFS: TelemetryPrefs = {
  enabled: true,
  noticeShown: false,
  analyticsId: null,
  funnelsDone: []
}

/** The one spelling of a once-ever mark, so the writer and the reader cannot disagree. */
export function funnelStepMark(funnel: TelemetryFunnel, step: string): string {
  return `${funnel}:${step}`
}

/** Every mark that could ever be legal — the normalizer's allowlist, built from the schema. */
export function allFunnelStepMarks(): string[] {
  return TELEMETRY_FUNNELS.flatMap((funnel) =>
    TELEMETRY_FUNNEL_STEPS[funnel].map((step) => funnelStepMark(funnel, step))
  )
}

/** A plain object, or not. Shared with every validator in `./telemetryValidate.ts` — one
 *  answer to "is this even a record", so the prefs normalizer and the wire validators can
 *  never disagree about what an object is. */
export function isTelemetryObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Defaulted field by field. Takes `unknown`: a hand edit, a downgrade or a share import can
 *  leave anything in this key, and a malformed id is DROPPED (⇒ a fresh one is minted) rather
 *  than repaired into something that is not a UUID. */
export function normalizeTelemetryPrefs(value: unknown): TelemetryPrefs {
  const v = isTelemetryObject(value) ? value : {}
  const id = v.analyticsId
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_TELEMETRY_PREFS.enabled,
    noticeShown:
      typeof v.noticeShown === 'boolean' ? v.noticeShown : DEFAULT_TELEMETRY_PREFS.noticeShown,
    analyticsId: typeof id === 'string' && UUID_V4_RE.test(id) ? id : null,
    // ALLOWLISTED, deduped and canonically ordered: the marks are schema constants, so an
    // unrecognized one (a hand edit, a downgrade from a build with more steps) is DROPPED rather
    // than carried. A dropped mark can only ever cost one duplicate event, never a wrong one.
    funnelsDone: normalizeFunnelsDone(v.funnelsDone)
  }
}

function normalizeFunnelsDone(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const held = new Set(value.filter((m): m is string => typeof m === 'string'))
  return allFunnelStepMarks().filter((mark) => held.has(mark))
}
