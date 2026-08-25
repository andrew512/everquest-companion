// GENERATED FILE - DO NOT EDIT.
//
// Generated from protocol/schema/*.schema.json by `npm run gen:protocol`.
// Edit the schema, run the generator, commit both sides.
//
// Neither language is privileged: this file and its Rust twin
// (engine/crates/protocol/src/generated.rs) come from the same neutral JSON Schema, and a
// schema edit that lands without regenerating turns tests/protocolSchema.test.mts red on the
// TypeScript side and the protocol-codegen staleness test red on the Rust side.
//
// schema-digest: sha256:c38ce98fbccf84fe73f475efbb245c32cb5d18a64fdd595989c54a7ce94ab21b

/**
 * Anything that can travel the wire, in either direction. The transport adapters are generic over exactly this: a transport moves ProtocolMessages and knows nothing else about the protocol.
 */
export type ProtocolMessage = ClientMessage | EngineMessage
/**
 * Every message the app sends the engine. Internally tagged on `op`, so a new surface is a new branch and the envelope never changes.
 */
export type ClientMessage =
  | Hello
  | EchoRequest
  | SessionAttachRequest
  | SessionHealthRequest
  | SessionProgressRequest
  | ModuleSnapshotRequest
  | PerfSnapshotRequest
  | ViewSubscribeRequest
  | ViewUnsubscribeRequest
  | AlertsDefineRequest
  | BuffTrustDefineRequest
  | RespawnDefineRequest
  | ComboDefineRequest
  | RosterDefineRequest
  | SessionMarkAddRequest
/**
 * The per-launch shared secret. Minted by Electron main at spawn, handed to the engine out of band, presented once at hello. It is never persisted and never reused across launches. Compare it in CONSTANT TIME (src/main/dataServer/token.ts, engine/crates/protocol/src/token.rs) - a byte-at-a-time compare over a loopback socket is a timing oracle. The shape rules are environment-neutral and live in src/shared/dataServer/token.ts.
 */
export type Token = string
/**
 * Client-chosen correlation id. A reply carries the id of its request; every stream message carries the id of the subscribe request that opened it.
 */
export type RequestId = number
/**
 * ONE RENDER-READY VALUE. The renderer never munges domain data (owner ruling), so a cell is what the pixel says: already formatted, already rounded, already sorted into place. Numbers stay numbers only where the renderer needs the magnitude (a bar width, a share).
 */
export type Cell = string | number | boolean | null
/**
 * One sort key as the pair the plan doc writes: ["at","desc"]. THE DOUBLE SPELLING IS DELIBERATE. A draft 2020-12 VALIDATOR reads `prefixItems` and therefore enforces that the second element is asc or desc - that is the real contract. Both CODE GENERATORS predate or ignore that keyword and read `items` + minItems/maxItems instead, landing on a fixed-length array of strings in each language. The two can never disagree about a legal value: with minItems = maxItems = 2 there is no element left for `items` to reach under 2020-12 semantics, so the fallback is vacuous for a compliant validator and merely weaker for a generator. Anything the generated types accept and the validator rejects is caught by the fixture suite, which validates every message against the schema itself.
 *
 * @minItems 2
 * @maxItems 2
 */
export type SortTerm = [string, string]
/**
 * Every message the engine sends the app. Internally tagged on `kind`.
 */
export type EngineMessage =
  | HelloReply
  | Reply
  | ErrorReply
  | ResetMessage
  | DiffMessage
  | EpochMessage
  | FireMessage
  | ConCardMessage
  | ModuleChangedMessage
/**
 * THE RESULT REGISTRY, and it is CLOSED. Which shape a reply carries is decided by the OP of the request whose id it names - the envelope does not repeat it, because a reply that had to restate its own op would be a second place for the two to disagree. This list is the additive seam for the eight API surfaces: a new op adds an arm and nothing else in the envelope moves. There is deliberately NO open arm for a shape this build does not know: both sides generate from this one artifact and a protocolVersion mismatch is fatal at hello, so an engine that could answer with an unnamed shape is an engine this client already refused to talk to. A wildcard arm would also make the whole list unusable - an open object matches every named shape too, so `oneOf` could never pick one.
 */
export type ReplyResult =
  | EchoResult
  | HealthResult
  | AttachResult
  | SubscribeAck
  | ModuleSnapshotResult
  | PerfSnapshotResult
  | DefineAck
  | SessionMarkAck
/**
 * The world's generation. Monotonic within one engine process. A client that sees an epoch it did not expect DROPS ALL STATE and waits for the reset — it never reconciles across a bump.
 */
export type Epoch = number
/**
 * THE MODULE'S PUBLISHED STATE, AND THE PROTOCOL STATES NOTHING ABOUT ITS SHAPE — the same argument Cells makes, one level up: the field set belongs to the thing that publishes it, so a module growing a field is not a protocol change. `type` NAMES EVERY JSON TYPE rather than being omitted, and that is not decoration: an omitted `type` lowers to an INDEX-SIGNATURE object in TypeScript, which would forbid the ARRAY half of the registry — `kills` publishes an object, `loot`, `consider` and `eventFeed` publish arrays of rows, and a schema that named one of those shapes would be a rule the fold already breaks. IT IS THE SECOND HAND-WRITTEN REPLACEMENT ON THE RUST SIDE, for exactly the reason `Cell` is: typify lowers a multi-type schema to an untagged enum whose number arm is `f64`, and a module state is FULL of counts. The replacement is `serde_json::Value`, which is the same claim this definition makes, spelled in Rust.
 */
export type ModuleState = {} | unknown[] | string | number | boolean | null
/**
 * A CLOSED set. Both sides generate from this artifact, so adding a member is a schema edit that regenerates both — there is no version of the app that can meet a code it has never heard of.
 */
export type ErrorCode =
  | 'protocolMismatch'
  | 'unauthorized'
  | 'unknownOp'
  | 'badParams'
  | 'notFound'
  | 'unavailable'
  | 'internal'
/**
 * Stable identity of a row within one view, e.g. `loot:9413` or `ally:Primitive`. Unique inside a subscription; meaningless outside it.
 */
export type RowKey = string
export type DiffOp = InsertOp | UpdateOp | DropOp
export type EpochReason = 'attach' | 'restart' | 'progress'
/**
 * `shared/resistTypes.ts ResistAxis`. The display order is this list's order and every surface uses all five of it.
 */
export type ResistAxis = 'magic' | 'fire' | 'cold' | 'poison' | 'disease'
/**
 * `shared/resistTypes.ts ResistTag` — the scannable word. NO ACRONYMS, EVER (owner ruling): the axis word is the only label this app prints for an axis, and these four are the only bands.
 */
export type ResistTag = 'weak' | 'normal' | 'resistant' | 'very resistant'
/**
 * `shared/resistTypes.ts ResistGuidance` — the sentence under the word. The same three bands read twice: `resistant` means `needs overchannel`, every time, on every surface.
 */
export type ResistGuidance =
  'should land' | 'needs overchannel' | 'may not land even with overchannel'

/**
 * The FIRST message on a connection, always. The engine answers with HelloReply or closes the connection; nothing else may precede it.
 */
export interface Hello {
  op: 'hello'
  token: Token
  /**
   * The version the CLIENT was generated against. A mismatch is fatal by ruling: both sides log and the connection closes. Version skew is a build error, not a runtime state to recover from.
   */
  protocolVersion: number
}
/**
 * The skeleton's own op: it proves a whole message travelled the seam and came back, with no game logic anywhere.
 */
export interface EchoRequest {
  id: RequestId
  op: 'echo'
  params: EchoParams
}
export interface EchoParams {
  text: string
}
/**
 * Begins tail + fold of one log. PREEMPTS any in-flight attach — last pick wins, never queued (JOS-457's generation ownership, promoted to protocol law). A successful attach bumps the epoch.
 */
export interface SessionAttachRequest {
  id: RequestId
  op: 'session.attach'
  params: SessionAttachParams
}
export interface SessionAttachParams {
  /**
   * Absolute path to the EverQuest log file. The engine never discovers a path of its own and never reads a settings file — the app owns discovery and pushes the answer in.
   */
  logPath: string
}
export interface SessionHealthRequest {
  id: RequestId
  op: 'session.health'
  params: NoParams
}
/**
 * An op that takes nothing still sends `params: {}`. The envelope keeps one shape, so adding a parameter later is a schema edit rather than an envelope change.
 */
export interface NoParams {}
/**
 * Asks to be told about fold progress. The ticks themselves arrive as connection-wide EpochMessage frames carrying `progress` — the same channel the epoch bump uses, which is why they are not a fourth stream kind.
 */
export interface SessionProgressRequest {
  id: RequestId
  op: 'session.progress'
  params: NoParams
}
/**
 * THE FIRST DATA-BEARING OP. Asks the live fold for one module's published state — the same `{ seq, state }` the app's own module registry hydrates from today. The answer is a point-in-time read of the ingest's fold: mid-scan it is a real PREFIX state (every event up to `seq` and no part of another), because the fold answers between its own read boundaries and never inside one. An unknown module name is `notFound`: the registry is the authority on what a module is, and an empty state would be a lie about a module that does not exist.
 */
export interface ModuleSnapshotRequest {
  id: RequestId
  op: 'module.snapshot'
  params: ModuleSnapshotParams
}
export interface ModuleSnapshotParams {
  /**
   * The module's id, exactly as the registry spells it — `loot`, `kills`, `buffTimers`. Not a view source: a view is filtered, sorted and windowed, and this is the module's whole state.
   */
  module: string
}
/**
 * THE ENGINE'S OWN PERFORMANCE, ASKED FOR (owner ruling 19 surface, JOS-483). Everything `session.health` says about where the fold has got to, plus what the ingest cost to build and what the serve path has cost since — the counters `views::meter` already keeps, read WITHOUT resetting them so two asks read as a progression rather than as two disconnected windows. It is answered through the same one door `module.snapshot` uses: the meter lives on the ingest thread, the request arrives on a connection thread, and the ingest answers at a boundary it already reaches. THE APP MUST NOT POLL THIS IDLY. It is the in-app performance panel's data and the panel is open a few seconds at a time; a perf surface that costs a round trip a second while nobody is looking at it is the bug it exists to find.
 */
export interface PerfSnapshotRequest {
  id: RequestId
  op: 'perf.snapshot'
  params: NoParams
}
/**
 * Opens a subscription. The reply acknowledges; the data starts with a `reset` carrying the whole window.
 */
export interface ViewSubscribeRequest {
  id: RequestId
  op: 'view.subscribe'
  params: ViewDescriptor
}
export interface ViewDescriptor {
  /**
   * Which collection the view reads, e.g. `loot.ledger` or `combat.live`. The engine owns the registry of sources; an unknown one is a `notFound` error, never an empty result.
   */
  source: string
  filter?: ViewFilter
  sort?: SortTerm[]
  window?: ViewWindow
}
/**
 * Field-name to value, ANDed. Open by design for the same reason Cells is: which fields a source filters on is the SOURCE's contract, not the protocol's.
 */
export interface ViewFilter {
  [k: string]: Cell
}
/**
 * The slice of the sorted, filtered view the client wants. Absent means the engine's default window for that source — never `everything`, because an unbounded window is how a payload budget gets blown.
 */
export interface ViewWindow {
  offset: number
  limit: number
}
/**
 * Closes a subscription. `id` is this REQUEST's id; `params.subscription` names the subscribe request whose stream is to stop.
 */
export interface ViewUnsubscribeRequest {
  id: RequestId
  op: 'view.unsubscribe'
  params: ViewUnsubscribeParams
}
export interface ViewUnsubscribeParams {
  subscription: RequestId
}
/**
 * THE USER'S ALERT DEFINITIONS, pushed (boundary verdict 3). The store stays persistence truth app-side and the engine never reads a settings file; the app pushes the WHOLE set on connect and on every save/delete. Since ruling 22 the engine is also what EVALUATES them: a match on a LIVE event becomes a `FireMessage` on the stream, and the app-side alert system reduces to receive-fire-make-sound.
 */
export interface AlertsDefineRequest {
  id: RequestId
  op: 'alerts.define'
  params: AlertsDefineParams
}
export interface AlertsDefineParams {
  /**
   * THE WHOLE SET, always. Not a delta: a define replaces what the engine holds, so a crash-respawn is a replay of the latest push and a command input is hash-friendly.
   */
  defs: AlertDefinition[]
}
/**
 * One alert, EXACTLY AS THE STORE HOLDS IT — `src/shared/alertTypes.ts AlertDef`. The protocol states nothing about its shape, and that is the `ModuleState`/`Cells` argument at full strength rather than a shortcut. Two reasons, and the second is the load-bearing one. (1) The field set is the STORE's contract: a def carries an id, a name, an enabled flag, a trigger grammar and a sound reference that the engine's evaluator reads, plus volume, audio channel, speech phrase, banner colour, notes and the early-warning offset that belong entirely to the app — and an alert growing a field must not be a protocol change or turn a whole push into `badParams`. (2) A DEFINITION ROUND-TRIPS: the fold republishes the pushed list as the `alerts` module's own `defs`, which is what the app's alert list is drawn from, so a typed protocol shape that quietly dropped an unlisted field would REWRITE THE USER'S ALERTS as they passed through the engine. Typed-where-cheap is not cheap here. The engine reads what it needs with its own reader (`fold::modules::alerts_rules::Rule::compile`), exactly as the fold reads an event.
 */
export interface AlertDefinition {
  [k: string]: unknown
}
/**
 * WHOSE CASTS, BESIDES YOUR OWN, MAY ANCHOR A LANDING (JOS-140). Pushed like every other piece of app knowledge; it ships empty and stays empty for almost everybody.
 */
export interface BuffTrustDefineRequest {
  id: RequestId
  op: 'buffTrust.define'
  params: BuffTrustDefineParams
}
export interface BuffTrustDefineParams {
  trust: BuffTrustPrefs
}
/**
 * `src/shared/buffTrust.ts BuffTrustPrefs`. Typed because it is cheap to type: one list of display spellings, in the order the user added them.
 */
export interface BuffTrustPrefs {
  externals: string[]
  [k: string]: unknown
}
/**
 * WHICH MOBS GET A CLOCK (JOS-194) — tracking is opt-in per mob, so this list is the whole of what the respawn fold knows that the log did not tell it.
 */
export interface RespawnDefineRequest {
  id: RequestId
  op: 'respawn.define'
  params: RespawnDefineParams
}
export interface RespawnDefineParams {
  prefs: RespawnPrefs
}
/**
 * `src/shared/respawn.ts RespawnPrefs`. An object rather than a bare array because that is the shape the store holds and the shape a later preference would grow into.
 */
export interface RespawnPrefs {
  watches: RespawnWatch[]
  [k: string]: unknown
}
/**
 * One mob the user chose to watch, and the number they typed if they typed one.
 */
export interface RespawnWatch {
  /**
   * Canonical (lowercased) mob name — what a death line's name canonicalizes to.
   */
  key: string
  display: string
  /**
   * The user's own respawn, in SECONDS. Absent means `use what you learn`, which is a different statement from zero.
   */
  customSec?: number
  [k: string]: unknown
}
/**
 * THE USER'S CLASS-COMBO CORRECTIONS — the one input to the loadout model that the log cannot state. Character-scoped app-side; the engine holds whatever the app last pushed for the character it is folding.
 */
export interface ComboDefineRequest {
  id: RequestId
  op: 'combo.define'
  params: ComboDefineParams
}
export interface ComboDefineParams {
  corrections: ComboCorrection[]
}
/**
 * `src/shared/classCombo.ts ComboCorrection` — a span the user re-labelled, and when they said so.
 */
export interface ComboCorrection {
  startTs: number
  /**
   * `null` means `from startTs onward`, i.e. it applies to the open interval too. REQUIRED AND NULLABLE rather than optional, because the store's own type says `number | null` and its only writer always writes one of the two — and because an optional nullable is a field that does not survive a round trip: a generator lowers it to `Option`, drops the null on the way back out, and a fixture that carried the store's own shape stops matching itself.
   */
  endTs: number | null
  /**
   * One to three class codes, as the `/who` row spells them.
   */
  classes: string[]
  /**
   * When the user set it — a later correction wins over an earlier overlapping one.
   */
  setAt: number
  [k: string]: unknown
}
/**
 * THE USER'S GROUP-ROSTER EDITS — names they added the log never named, and names they removed that it did.
 */
export interface RosterDefineRequest {
  id: RequestId
  op: 'roster.define'
  params: RosterDefineParams
}
export interface RosterDefineParams {
  edits: RosterEdit[]
}
/**
 * `src/shared/progressState.ts RosterEdit` — one name, one verb, and the instant the user said it. The instant is load-bearing rather than provenance: an edit older than the last character rebirth, or older than the last `You have been removed from the group.`, described a group that no longer exists and is dropped by the fold rather than by the pusher.
 */
export interface RosterEdit {
  /**
   * The canonical identity key — `idKey(name)`.
   */
  key: string
  name: string
  action: 'add' | 'remove'
  setAt: number
  [k: string]: unknown
}
/**
 * PRESS `NEW SESSION` (boundary verdict 6: `sessionMark` is a command with an accepted/refused reply; marks stay ephemeral for replay determinism). ONE INSTANT SPLITS EVERYTHING — the loot ledger app-side and the meter's engine records — so the app stamps the clock ONCE and hands that same number here, exactly as `src/main/sessionMarks.ts pressNewSession` hands it to `combat.sessionMark(ts)` today. THE ENGINE STORES NOTHING. A mark is a user action that is persisted nowhere, which is half of why a relaunch replays the log into the records the log alone describes; the other half is the refusal below. IT CAN BE REFUSED, and a refusal is not an error: the request is perfectly well formed and the honest answer is `not now` (see SessionMarkAck).
 */
export interface SessionMarkAddRequest {
  id: RequestId
  op: 'sessionMarks.add'
  params: SessionMarkAddParams
}
export interface SessionMarkAddParams {
  /**
   * THE INSTANT THE PERSON PRESSED, in epoch milliseconds, on the app's WALL CLOCK — and it is the caller's clock rather than the engine's on purpose (JOS-436's rule, moved rather than re-decided). Marking at the live edge of the log would hand the stale minutes since the newest line — the zoning, the corpse run, the instance reset itself — to the session that had not started yet. It is also the one number that makes the two halves of the split share ONE boundary: the app applies the same value to its own ledger, so nothing looted in between can fall on the wrong side of one of them. This is NOT in tension with ruling 18 law 1: a mark is an IMPURE INPUT (law 4), pushed and named, never a clock the engine read for itself.
   */
  at: number
}
/**
 * The handshake answer. `ok: false` is a courtesy sent immediately before the engine closes the connection — a client must treat a closed connection with no reply as the same outcome.
 */
export interface HelloReply {
  kind: 'hello'
  ok: boolean
  /**
   * The engine binary's own version (informational; it is NOT the compatibility check).
   */
  engineVersion: string
  /**
   * The version the ENGINE was generated against.
   */
  protocolVersion: number
}
/**
 * A successful answer to one request.
 */
export interface Reply {
  kind: 'reply'
  id: RequestId
  ok: true
  result: ReplyResult
}
export interface EchoResult {
  text: string
}
/**
 * What the engine's ingest is doing, and where it has got to. THE LAST FOUR FIELDS ARE OPTIONAL AND THAT IS NOT A CONVENIENCE: a health answer given before any attach honestly has no mark, no event count, no log timestamp and no file to stat, and a zero would be a measurement nobody took. Absent means `this engine has not folded anything`; present means the numbers are the fold's own.
 */
export interface HealthResult {
  status: 'starting' | 'attaching' | 'folding' | 'live' | 'idle'
  epoch: Epoch
  uptimeMs: number
  mark?: LogMark
  /**
   * Events folded in this generation. Counts EVENTS, not lines — a log line the parser declines is not one.
   */
  events?: number
  /**
   * The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Absent when nothing folded, or when no event so far carried a stamp the parser could read.
   */
  lastEventTs?: number
  /**
   * THE LOG FILE'S LAST-MODIFIED TIME, in epoch milliseconds, as the engine stats it (owner ruling 21: the server owns log-file facts — `the server should be the one reading the log file, rather than the app reaching in… reported so the app can use it to display and choose the correct character on launch`). A FILESYSTEM FACT, NOT A FOLD FACT, and the distinction is ruling 18's: it never enters fold state, it is not addressed by (log identity, byte offset), and it is re-stated fresh on every health answer rather than remembered — a remembered mtime is a cache of something the filesystem already holds. Absent before any attach (no file to stat), and absent when the stat fails, which is honest: a log that was renamed out from under the engine has no answer, and 0 would claim 1970. Truncated to whole milliseconds, so it equals `Math.floor(statSync(log).mtimeMs)`.
   */
  logMtimeMs?: number
}
/**
 * THE ADDRESSABLE COORDINATE (owner ruling 18 law 3): state is addressed by (log identity, byte offset) and by nothing else — never by wall time, never by `current`. `offset` is the end of the last COMPLETE line folded, which is the same definition as the scan's end offset; a half-written line is not an event and the mark waits with it. THIS IS NOT A FRAMING CONCERN: it is a coordinate INSIDE the file the engine reads, and it would mean the same thing over any transport.
 */
export interface LogMark {
  /**
   * The log being folded, as the path the app handed the engine at attach. The engine never discovers a path of its own.
   */
  log: string
  /**
   * The end of the last complete line folded, counted from the start of the file.
   */
  offset: number
}
export interface AttachResult {
  epoch: Epoch
  /**
   * False when the attach was preempted by a later one before it began — the caller's own attach is the one that lost, and the epoch names the winner.
   */
  accepted: boolean
}
export interface SubscribeAck {
  subscription: RequestId
  subscribed: boolean
}
export interface ModuleSnapshotResult {
  /**
   * The module that answered, echoed back so a caller holding several in flight needs no bookkeeping of its own.
   */
  module: string
  /**
   * The module's OWN published seq — for most modules the seq of the last event it folded, and for the four that publish a private revision counter (combo, character, respawn, buffTimers) that counter. It is a hydration cursor, not the fold's event count; `HealthResult.events` is the count.
   */
  seq: number
  state: ModuleState
}
/**
 * What the engine is doing and what it has cost. The first five fields are `HealthResult`'s and mean exactly what they mean there, restated rather than nested so a panel reads one object — and OPTIONAL on the same terms, because a health answer given before any attach honestly has no mark, no event count and no log timestamp. `ingest` is what building this generation cost; `serve` is one row per view source, cumulative for the generation.
 */
export interface PerfSnapshotResult {
  status: 'starting' | 'attaching' | 'folding' | 'live' | 'idle'
  epoch: Epoch
  /**
   * How long THIS PROCESS has been up. Process metadata, never world state: it survives an attach, which the epoch does not.
   */
  uptimeMs: number
  mark?: LogMark
  /**
   * Events folded in this generation. Counts EVENTS, not lines — the same number `HealthResult.events` carries.
   */
  events?: number
  /**
   * The `ts` of the last event folded — THE LOG'S OWN CLOCK, never the host's. Its distance from the host's clock is the freshness figure the panel draws, and that subtraction is the CALLER's to make: the engine does not read a wall clock to answer this.
   */
  lastEventTs?: number
  ingest: PerfIngest
  /**
   * One row per view source that has served a frame in this generation. A source nobody has subscribed to is ABSENT rather than a row of zeros — the same rule the panel applies to a process type with no process behind it.
   */
  serve: PerfServeSource[]
}
/**
 * WHAT STARTING THIS GENERATION COST. Every field is optional and absent means NOT YET MEASURED rather than zero: `scanMs` is unknown until the scan finishes, and a zero there would say a whole log folded instantly. The engine prints the same two numbers to stderr; this is the same measurement on the wire, so a panel does not have to scrape a log.
 */
export interface PerfIngest {
  /**
   * How long the parser's spell catalog took to become available for this attach. Near zero after the first attach of a process — the catalog is built once per process — and the number is reported rather than assumed.
   */
  spellDbMs?: number
  /**
   * Wall time from the first byte read to the fold landing. Absent while the scan is still running.
   */
  scanMs?: number
  /**
   * Bytes read by the scan, up to the mark it landed on. Absent while the scan is still running.
   */
  scanBytes?: number
}
/**
 * ONE SOURCE'S SERVE PATH, cumulative for this generation — the counters `views::meter` keeps, exactly as ruling 19 names them. QUEUE TIME IS NEVER COUNTED AS COMPUTE: `foldToFrameUs*` is measured from the instant the fold produced what the frame reports to the instant the frame reached the connection's outbox, and a frame with no fold behind it (the fresh reset a just-opened subscription is owed) is COUNTED but not TIMED — which is why the two latency fields are optional and their absence means `no frame here had a fold behind it`, never `zero microseconds`.
 */
export interface PerfServeSource {
  /**
   * The view source's name, exactly as the source registry spells it.
   */
  source: string
  /**
   * Frames actually sent — `resets + diffs`. Reported rather than left to the caller's addition so the row reads without arithmetic.
   */
  frames: number
  resets: number
  diffs: number
  /**
   * Rows carried by the resets. A diff carries ops, not rows.
   */
  rows: number
  /**
   * HOW MUCH THIS SOURCE HAS SENT, cumulative — the payload budget ruling 4 asks for, weighed off the frames' own serializations. THE UNIT IS IN THIS SENTENCE AND NOT IN THE NAME, and that is this schema keeping its own law rather than dodging it: a property name here may not carry a wire unit, because a schema that grew a byte count would quietly make the transport unswappable (the owner's constraint, enforced structurally in tests/protocolSchema.test.mts) — while the prose is exactly where a measurement is allowed to say what it measured. It is bytes of the JSON this engine serialized, so a different encoding would weigh the same frames differently: a client compares this against itself over time, never against a constant. `weight` is the vocabulary this repo already uses for the size of a committed thing (scripts/gen-data-weight.mts).
   */
  payloadWeight: number
  /**
   * The largest single frame, weighed the same way. The budget number that matters — a mean hides the one frame that stalled a window.
   */
  widestPayloadWeight: number
  /**
   * Mean fold-to-frame latency in MICROSECONDS, over the timed frames only. Microseconds rather than milliseconds because cutting a fifty-row window off a fold takes tens of them, and a serve path reporting `0 ms` reads as a measurement nobody took.
   */
  foldToFrameUsMean?: number
  /**
   * The worst timed frame, in microseconds.
   */
  foldToFrameUsMax?: number
  /**
   * Open subscriptions over this source RIGHT NOW, across every connection — a live count, not a cumulative one, and the world's answer rather than the meter's. It is what makes a row with no recent frames readable: nobody is watching, as against nothing is moving.
   */
  subscribers: number
}
/**
 * The answer to every `*.define` command, and it is deliberately the SAME shape for all five. A define is an idempotent FULL-SET REPLACE (the cutover ledger's command law: replayable, order-collapsing, hash-friendly for ruling 18's cache key), so there is nothing per-family to report back — the engine either took the set or refused the frame. `count` is how many entries it took, which is the one number a caller can check its own push against; it is absent for a family whose payload is not a list (`buffTrust`, `respawn` push one object each).
 */
export interface DefineAck {
  applied: true
  /**
   * Entries taken, for a list-shaped payload. Absent means the payload was not a list, NEVER that nothing was taken — an empty list answers `count: 0`, which is how a caller clears a family and can tell it worked.
   */
  count?: number
}
/**
 * TAKEN, OR NOT TAKEN, AND WHAT THE WORLD WAS DOING. `accepted: false` IS NOT AN ERROR — it is the census's own semantics (boundary verdict 6) and it mirrors `combat/engine.ts sessionMark`, which returns false while the historical fold is still running. A mark cannot enter a replaying fold at all, which is what makes the JOS-208 replay-versus-live divergence class structurally impossible here rather than carefully avoided. THE CALLER MUST TREAT A REFUSAL AS `NEITHER HALF` (`pressNewSession`'s own law): a mark the engine never took is a boundary only half the app has, so the app records nothing either and leaves its loading state up. `status` is here rather than left to a follow-up `session.health` because the two would RACE — a fold that went live between the refusal and the question would explain the refusal with a state that no longer holds — and because a refusal that cannot say what it was refusing under is a bug report with a hole in it. WHETHER THE MARK MINTED A RECORD IS A DIFFERENT QUESTION and this ack deliberately does not answer it: an empty stay mints nothing, which is also what makes a double press harmless, and the honest answer to `did anything change` is the history itself.
 */
export interface SessionMarkAck {
  /**
   * True when the live fold took the instant. False ONLY when the world was not live — see `status`.
   */
  accepted: boolean
  /**
   * What the engine's ingest was doing at the moment it decided, in `HealthResult.status`'s own words. `live` accompanies every acceptance; anything else accompanies a refusal.
   */
  status: 'starting' | 'attaching' | 'folding' | 'live' | 'idle'
}
/**
 * A refused request. An error is always a reply to a request id — a failure with no request behind it closes the connection instead.
 */
export interface ErrorReply {
  kind: 'error'
  id: RequestId
  ok: false
  error: ProtocolError
}
export interface ProtocolError {
  code: ErrorCode
  /**
   * Human-readable, for a log line and a bug report. Never parsed — branch on `code`.
   */
  message: string
}
/**
 * The whole window, as of now. Every subscription opens with one, and every epoch bump produces a new one once the fold lands.
 */
export interface ResetMessage {
  kind: 'reset'
  id: RequestId
  epoch: Epoch
  /**
   * How many rows the view holds in total, ignoring the window — what a `1–50 of 1834` line reads off.
   */
  total: number
  rows: Row[]
}
/**
 * One render-ready row: its key and its cells. THE KEY IS OUTSIDE THE CELLS on purpose — an `update` op carries `cells` alone, so reset rows and diff updates have to agree on where the identity lives or a client cannot apply a diff to a row it already holds.
 */
export interface Row {
  key: RowKey
  cells: Cells
}
/**
 * A row's fields by name. Open by design — the field set is the VIEW's contract, not the protocol's, so a new column is not a protocol change.
 */
export interface Cells {
  [k: string]: Cell
}
/**
 * One coalesced batch of changes to the open window. Ops apply IN ORDER. `total` is present only when it moved.
 */
export interface DiffMessage {
  kind: 'diff'
  id: RequestId
  epoch: Epoch
  total?: number
  ops: DiffOp[]
}
/**
 * A row entered the window. EXACTLY ONE of `before`/`after` is present and names an anchor row already in the window; neither present means the window was empty. That constraint is not expressible here without an if/then the Rust generator cannot read, so it is enforced in code and pinned by test.
 */
export interface InsertOp {
  op: 'insert'
  before?: RowKey
  after?: RowKey
  row: Row
}
/**
 * CHANGED CELLS ONLY. A cell absent from `cells` is unchanged, never cleared — clearing is an explicit null.
 */
export interface UpdateOp {
  op: 'update'
  key: RowKey
  cells: Cells
}
/**
 * A row left the window. It may still exist in the view — a newest-first window pushes the oldest row out on every insert.
 */
export interface DropOp {
  op: 'drop'
  key: RowKey
}
/**
 * CONNECTION-WIDE, and therefore the one stream message with no `id`: the world's generation belongs to the connection, not to any subscription. It announces a bump (`attach`, `restart`) or reports fold progress within the current generation (`progress`, which never changes `epoch`). After a bump every open subscription receives its own fresh reset when the fold lands.
 */
export interface EpochMessage {
  kind: 'epoch'
  epoch: Epoch
  reason: EpochReason
  progress?: FoldProgress
}
/**
 * What the loading UI reads. Present while a fold is running and on the bump that starts one.
 */
export interface FoldProgress {
  /**
   * How far the fold has got, 0 to 100, FRACTIONAL. The engine emits the number it actually measured and does not pre-round it: rounding is a display decision and belongs to whoever is drawing the bar. That is not in tension with the renderer-never-munges rule - that rule is about DOMAIN data (no client-side filtering, sorting or aggregation of the world), and formatting a progress readout for the pixel it lands on is not domain work. A NOTE FOR WORKED EXAMPLES: Rust serializes an f64 whole value as X.0, so a fixture carrying `62` would come back `62.0` and stop being byte-verbatim across the two languages. Examples therefore use a genuinely fractional value (62.4), which round-trips identically in both.
   */
  pct: number
  events: number
}
/**
 * AN ALERT FIRED (owner ruling 22). The engine evaluates the user's alert definitions against LIVE events — replay must never make a sound, which is the same boundary law the app-side evaluator has always obeyed — and this is what it says when one matches. CONNECTION-WIDE, and therefore carrying NO `id`: a fire belongs to the world rather than to any subscription, which is the `EpochMessage` precedent. It carries no `epoch` either, and that is the difference from an epoch message rather than an oversight: every other stream frame describes WINDOW STATE a client has to reconcile across a generation, while a fire is a thing that happened once — there is nothing to drop and nothing to re-request, so a generation number would be a field with no reader. IT IS FULLY RESOLVED SERVER-SIDE (the conCard principle): everything the app needs in order to make the identical noise is in these four fields, so no client ever has to hold the definition the fire came from.
 */
export interface FireMessage {
  kind: 'fire'
  /**
   * When it fired, on THE LOG'S OWN CLOCK — the `ts` of the event that matched, never the host's wall clock. A fire is a statement about the log (ruling 18 law 1).
   */
  at: number
  /**
   * The alert's LABEL — `AlertDefinition.name`. What fired, in the words the user gave it, so a log line or a banner needs nothing else to be readable.
   */
  rule: string
  /**
   * THE KEY THE APP WOULD PLAY: `<packId>/<soundId>`, joined from the definition's `sound` reference, which is exactly how the renderer's sound cache is keyed. Resolved here rather than sent as a reference for the conCard reason — an app that had to look the definition back up to know what to play would be holding a second copy of the rule set, which is the coupling this boundary exists to delete.
   */
  sound: string
  /**
   * THE TEXT THAT MATCHED — the log line the trigger fired on, which is what `FiredAlert.matchedText` has always carried and what the event log prints beside the alert's name.
   */
  message: string
}
/**
 * ONE LIVE `/con`, AS A FINISHED CARD (boundary verdict 2). The fold used to call synchronously INTO Electron — `considerModule.setConCardHook` — and the verdict inverts that: the engine emits the card and main only opens the overlay window. CONNECTION-WIDE, carrying no `id` and no `epoch`, on the `FireMessage` precedent and for its reasons: a con belongs to the world rather than to any subscription, and it is a thing that HAPPENED once, with no window state to reconcile across a generation. LIVE ONLY, STRUCTURALLY — a historical fold reaches this nowhere, so a startup replay of a month of logs draws nothing. It is the same boundary law a fire obeys and the same one `main/conCard.ts` states as its third refusal. SELF-CONTAINED BY LAW: the overlay window has no knowledge service, no ledger and no store, so everything the card draws is in this frame and the window fetches nothing (`shared/conCard.ts ConCardPayload`, whose field set this is). TWO OF THE APP'S THREE REFUSALS ARE NOT HERE, and both absences are argued rather than overlooked. The re-open suppression is a fact about the PERSON — a card they closed within the last minute, measured on the wall clock they live on — and it is driven by a window event (`con:card-closed`) that never reaches the fold; it stays with the window that owns it. The PLAYER refusal (`conCardIsPlayer`) needs the committed mob catalog to answer, and applying only its name-shape half would refuse a card for every proper-named NPC the app draws one for today (Innoruuk, Blugurg) — a regression dressed as a port. It arrives with the knowledge surface; until then the app's own gate still stands in front of the overlay.
 */
export interface ConCardMessage {
  kind: 'conCard'
  /**
   * When the `/con` happened, on THE LOG'S OWN CLOCK — the `ts` of the consider event, never the host's. Spelled `at` here rather than `ts` because that is what every other connection-wide frame the engine sends calls its instant (`FireMessage.at`), and one vocabulary for one concept is worth a rename in the app-side shim.
   */
  at: number
  /**
   * QUEUE IDENTITY: the canonical mob key (`shared/mobKey.ts mobKey`). A re-con REFRESHES the card on screen rather than stacking a second one, which is what the overlay's card queue keys off.
   */
  id: string
  /**
   * The mob's display name as the log printed it, whitespace-collapsed and capped (`cappedName`) — a rendering guarantee, not taste: a 40 kB mob name cannot push a card off the screen.
   */
  name: string
  /**
   * The level the con line stated. Every con line in the real log states one; absent when this one did not.
   */
  level?: number
  /**
   * The zone the player was in when they conned. Absent before the first zone line of the fold.
   */
  zone?: string
  /**
   * The ` - a rare creature - ` infix was on the line. Absent rather than false when it was not, which is the shape the app's payload has.
   */
  rare?: boolean
  /**
   * ALWAYS FIVE, ALWAYS IN `RESIST_AXES` ORDER (magic, fire, cold, poison, disease). All five are present whatever the ledger has seen, because `we have not seen fire cast on this` and `fire is fine` are different statements and a missing chip says neither.
   */
  chips: ConCardChip[]
  /**
   * FALSE WHEN THE CLIENT'S `spells_us.txt` COULD NOT BE READ, and the card says so instead of drawing five identical `not enough data` chips with no explanation. It is false in every frame this build sends: the spell-table parse is boundary verdict 7 and has not moved engine-side yet, so this engine takes the SAME branch `mobResistProfile` takes app-side when the table is absent — five empty chips and this flag down. That is the app's own honest answer under the same condition rather than a stub, and it is named in the engine README as the gap the con-card cutover waits on.
   */
  spellData: boolean
}
/**
 * ONE AXIS CHIP (`shared/conCard.ts ConCardChip`). IT CARRIES NUMBERS, NOT SENTENCES, and that is the same decision the app made: the words on the chip (`R 126 (110-144)`, `n=32`) are the mob page's own vocabulary, built by the one derivation both surfaces read, and a wire carrying finished strings would be a second copy of it that drifts the first time a word changes. This is the one place the render-ready rule bends, and it bends the way the app already bent it. ABSENT IS THE EMPTY CELL. `tag`, `benchmark` and `fit` are optional here where the app's type spells them `| null`, and the two say the same thing: a con card is a WHOLE CARD every time, so absence has no second meaning to be confused with — unlike a diff's `cells`, where absent means unchanged and null means cleared. The three travel together: a chip has all of them or none of them. `tag` is the guidance band, absent when nothing at all has been observed on this axis AND when the fit is PINNED — a posterior that slid off the end of the grid is the model saying it cannot answer, and a card that printed a band anyway would be inventing one. `benchmark` is the two landing chances behind that band at the viewer's level, plus the same pair at each end of the interval. `fit` is the estimate and its 95% interval, wide at a low `n`, which is the honest display of a thin cell rather than a reason to withhold it.
 */
export interface ConCardChip {
  axis: ResistAxis
  tag?: ResistTag
  benchmark?: ResistAxisBenchmark
  /**
   * The fit ran out of grid: no number, no band, and the raw resist rate instead.
   */
  pinned: boolean
  empirical: ResistEmpirical
  /**
   * Every observation behind this axis came from a pet or another creature. The chip says so.
   */
  npcOnly: boolean
  /**
   * OBSERVATIONS THAT COULD HAVE GONE EITHER WAY — `ResistEstimate.nInformative`, not `n`. The two are the same number on most cells and part company exactly where a proc dominates, which is where an older chip claimed eighty observations off eight.
   */
  n: number
  /**
   * Everything the fit saw, informative or not. Printed beside `n` when they differ.
   */
  nTotal: number
  fit?: ResistFit
}
/**
 * `shared/resistTypes.ts ResistAxisBenchmark` — the answer at the estimate, and the answer at each end of the interval, so a surface prints the uncertainty in the reader's own units. `atLo` is the OPTIMISTIC end (the low R) and `atHi` the pessimistic one: the interval's ends CROSS when they are mapped through the level formula, and naming them after the R they came from is what stops a surface printing the range backwards.
 */
export interface ResistAxisBenchmark {
  level: number
  mobLevel: number | null
  atMobLevel: boolean
  pPlain: number
  pOver: number
  tag: ResistTag
  guidance: ResistGuidance
  atLo: ResistBenchmark
  atHi: ResistBenchmark
}
/**
 * ONE EVALUATION OF THE BENCHMARK (`shared/resistTypes.ts ResistBenchmark`): the two probabilities the tag is drawn from, and how they were evaluated. `level` is the caster level `rc0` was computed at; `atMobLevel` says the viewer's own level was not known, so the benchmark is an EVEN-LEVEL cast and the surfaces say `at the mob's level`.
 */
export interface ResistBenchmark {
  level: number
  mobLevel: number | null
  atMobLevel: boolean
  /**
   * P(a rank-0, adjust-0, all-or-nothing spell lands), 0 to 1.
   */
  pPlain: number
  /**
   * The same, with the overchannel invocation up.
   */
  pOver: number
  tag: ResistTag
  guidance: ResistGuidance
}
/**
 * What the informative observations said, with no model in the way: how many there were and how many of them resisted.
 */
export interface ResistEmpirical {
  total: number
  resisted: number
}
/**
 * The posterior's point estimate and the ends of its 95% interval, in resist points. Clamped at zero for DISPLAY app-side — the grid runs below zero because `rc` does, and `R -150` is noise on a card while `R 0` is the same statement in the reader's units.
 */
export interface ResistFit {
  R: number
  lo: number
  hi: number
}
/**
 * A MODULE'S PUBLISHED STATE MOVED — the dirty bit, and nothing more. CONNECTION-WIDE and carrying no `id`, on the `FireMessage` precedent: a module belongs to the world rather than to any subscription. IT CARRIES NO STATE, DELIBERATELY. The whole payload is a name and a cursor, so a client that is not showing that module pays one small frame and ignores it, and a client that is re-fetches through `module.snapshot` — which is the op that already exists and the only place a module's shape is stated. A frame that carried the state would be `module.snapshot` pushed at a cadence nobody asked for, which is the per-window snapshot fan-out this whole boundary exists to delete. IT IS COALESCED TO ONE PER MODULE PER SERVE BEAT (~10 Hz, `views::SERVE_EVERY`), not one per event: a busy tail moves a module's seq many times between two beats and the newest cursor is the whole answer — the same newest-wins rule rule 2 states for diffs. Nothing is sent for a module whose seq did not move, so an idle session pays nothing. IT IS NOT AN EPOCH AND DOES NOT REPLACE ONE: a bump still means drop-everything-and-take-the-reset, and a `moduleChanged` inside one generation means only `there is something newer to fetch`.
 */
export interface ModuleChangedMessage {
  kind: 'moduleChanged'
  /**
   * The module's id, exactly as the registry spells it and exactly as `module.snapshot` takes it — `loot`, `kills`, `buffTimers`.
   */
  module: string
  /**
   * The module's OWN published seq as of this beat — the same cursor `ModuleSnapshotResult.seq` carries, so a client holding a snapshot compares the two numbers and refetches only when this one is ahead. For the four modules that publish a private revision counter (combo, character, respawn, buffTimers) it is that counter, because a preference push advances no log seq.
   */
  seq: number
}

/**
 * THE WIRE VERSION. A single integer, bumped on any breaking change. A client presents it in
 * `Hello.protocolVersion`; the engine answers with its own in `HelloReply.protocolVersion`. A
 * mismatch is FATAL by ruling - both sides log and the connection closes. Version skew is a
 * build error, not a runtime state to recover from, because both sides generate from this one
 * artifact.
 */
export const PROTOCOL_VERSION = 1
