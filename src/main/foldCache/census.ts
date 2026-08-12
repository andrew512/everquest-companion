// ============================================================================
// census.ts — EVERY CONSUMER OF THE LOG, DECLARED (JOS-208 phase 4, owner requirement).
// ============================================================================
//
// THE RULE THIS FILE EXISTS TO MECHANIZE: all log-derived state is checkpointed. Not "every module
// the registry folds" — that list is closed by `foldCheckpointDifferential.test.mts` and it was
// already closed while the CombatEngine sat outside the container for three phases, because the
// engine is not a module. It subscribes to the bus directly from `pipeline.ts`, publishes through
// its own IPC, and so was invisible to every completeness assertion in the tree. The owner's
// verdict: that must never be possible again, and discipline is not a mechanism.
//
// SO THE CENSUS IS OVER THE INLETS, not over the consumers. There are exactly two ways log-derived
// state can come into existence in this process:
//
//   1. SUBSCRIBING TO THE EVENT BUS (`bus.subscribe`, `registry.attach(bus)`) — the parsed stream.
//   2. READING LOG BYTES (`scanLog`, `new Tailer`, `parseEvent`, `newBytesSince`) — the feeders,
//      plus anything that goes around them.
//
// …and one implicit third that is worth naming rather than leaving to a reader's memory: the two
// TELEMETRY taps that sit inside the bus and the feeder (`noteEventKind`, `noteLinesParsed`). They
// see every event and every line, so they are inlets by any honest reading, and they are the first
// two entries in the exemption table below.
//
// `tests/foldConsumerCensus.test.mts` finds every one of those call sites in `src/main/**` by
// source scan and holds them against this table IN BOTH DIRECTIONS. A new site fails by name with
// its file and its count; a stale entry fails the same way. Each entry says what the consumer does
// with what it takes, and an exemption must carry an argument long enough to be an argument.
//
// WHY A SOURCE SCAN RATHER THAN A RUNTIME REGISTRY. A runtime census would need the composition
// root, and the composition root is Electron-bound (`pipeline.ts` reaches the store and the
// windows), so it cannot be imported by `npm test` — which is exactly where this has to fail. A
// scan reads the wiring as written, which is also the artifact a reviewer reads.

/** What a call site does with the log it is given. */
export type CensusVerdict =
  /**
   * The consumers ARE checkpointed `FoldUnit`s. A LIST, because one file's call sites of one inlet
   * can wire more than one (index.ts subscribes the two derived-event producers side by side), and
   * every id in it is asserted to exist in a built fold world.
   */
  | { kind: 'unit'; units: readonly string[] }
  /**
   * The site hands the stream to the MODULE REGISTRY, whose members are closed by
   * `CHECKPOINTED_MODULE_IDS` and the completeness gate in `foldCheckpointDifferential.test.mts`.
   * Delegation, not exemption: the members really are all checkpointed, by another test.
   */
  | { kind: 'registry' }
  /** Not fold state. `why` is the argument, and it has to be one. */
  | { kind: 'exempt' }

export interface CensusEntry {
  /** Repo-relative, forward slashes. */
  file: string
  /** The inlet's name as the scanner reports it (see `LOG_INLETS` in the test). */
  inlet: string
  /** How many call sites of this inlet that file holds. A new one is a new fact to argue. */
  count: number
  verdict: CensusVerdict
  /** What this consumer does with the log, and why that is a complete answer. */
  why: string
}

/**
 * THE COMMITTED CENSUS. Ordered by file, and every line of it is an argument somebody had to make.
 */
export const LOG_CONSUMER_CENSUS: readonly CensusEntry[] = [
  {
    file: 'src/main/foldCache/attach.ts',
    inlet: 'bus.subscribe',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The last-event-timestamp probe. It keeps ONE number — the largest `ev.ts` any feeder has ' +
      'emitted — and that number is written into the container HEADER (the identity block, which ' +
      'uses it to notice a log that regrew), never into any unit blob. A restore reads it back off ' +
      'the header it was written to, so it is checkpointed, just not as fold state; and it is ' +
      'installed only when the flag is on, so an off launch pays nothing for it.'
  },
  {
    file: 'src/main/foldCache/shadow.ts',
    inlet: 'scanLog',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      "The shadow verifier's COLD ARM. It folds [0, B) into a throwaway world built by " +
      '`shadowWorld.ts` from the same unit list `attach.ts` uses, compares it against the restored ' +
      'arm, and drops both. Nothing it folds is ever served to a window or written to a container, ' +
      'so there is no state here to checkpoint — this IS the check.'
  },
  {
    file: 'src/main/foldCache/shadowWorld.ts',
    inlet: 'registry.attach',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The throwaway verification world, which is a deliberate COPY of the production wiring — the ' +
      'same `createModules` list, the same engine, the same two producers, subscribed in the same ' +
      'order. Its consumers are the units `attach.ts` names; it is built to be compared and dropped, ' +
      'and a second checkpoint of it would be checkpointing the instrument.'
  },
  {
    file: 'src/main/foldCache/shadowWorld.ts',
    inlet: 'bus.subscribe',
    count: 3,
    verdict: { kind: 'exempt' },
    why:
      'The same throwaway world: its combat engine and its two derived-event producers. Every one of ' +
      'the three is a checkpointed unit in the app; here they are instruments, and the world they ' +
      'fold is discarded the moment the comparison is over.'
  },
  {
    file: 'src/main/index.ts',
    inlet: 'bus.subscribe',
    count: 2,
    verdict: { kind: 'unit', units: ['epoch', 'session'] },
    why:
      'The two DERIVED-EVENT PRODUCERS, subscribed last so they observe each event only after the ' +
      'modules and the engine have folded it: the epoch detector and the offline-gap detector. Both ' +
      'are checkpointed units — phase 1 measured what leaving them out cost, which was a fresh ' +
      'detector re-firing the launch boundary at the first event of the tail and wiping the respawn ' +
      'history, at every split point in every fixture.'
  },
  {
    file: 'src/main/log/bus.ts',
    inlet: 'noteEventKind',
    count: 3,
    verdict: { kind: 'exempt' },
    why:
      'The BREADCRUMB RING — the one choke point that sees every primary and every derived event ' +
      '(telemetry/breadcrumbs.ts). It is three slot writes into preallocated arrays with no clock ' +
      'read and no allocation, it is bounded and drop-oldest, and its only reader is a crash report ' +
      'describing THIS process. Ephemeral by design: a restored launch is entitled to its own ' +
      "crumbs, and last session's would describe a crash that already happened."
  },
  {
    file: 'src/main/log/scanHistory.ts',
    inlet: 'parseEvent',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The historical FEEDER. It turns bytes into events and pushes them onto the bus; the only ' +
      'state it carries across the call is `seq` and `endOffset`, and both are in the container ' +
      "header rather than in a blob (they are what a checkpoint's byte position IS)."
  },
  {
    file: 'src/main/modules/registry.ts',
    inlet: 'bus.subscribe',
    count: 1,
    verdict: { kind: 'registry' },
    why:
      'The module registry\'s own dispatch — the ONE subscription that fans out to every registered ' +
      'module. Its membership is closed in both directions by the completeness gate in ' +
      '`foldCheckpointDifferential.test.mts`, which holds `CHECKPOINTED_MODULE_IDS` against ' +
      '`registry.list()`, so a module added to `wiring.ts` without a seam already fails by name.'
  },
  {
    file: 'src/main/pipeline.ts',
    inlet: 'registry.attach',
    count: 1,
    verdict: { kind: 'registry' },
    why: 'The app\'s one registry attachment. Same delegation as the registry\'s own dispatch above.'
  },
  {
    file: 'src/main/pipeline.ts',
    inlet: 'bus.subscribe',
    count: 1,
    verdict: { kind: 'unit', units: ['combat'] },
    why:
      'THE COMBAT ENGINE, and this row is the reason this file exists. This subscription is how the ' +
      'largest fold in the app was wired for a year without the registry ever hearing about it, and ' +
      'therefore how it stayed outside the container through three phases of a project whose whole ' +
      'subject is that the container is complete. It is a `FoldUnit` now (JOS-208 phase 4), and the ' +
      'census is what makes the next one of these impossible to miss.'
  },
  {
    file: 'src/main/session.ts',
    inlet: 'scanLog',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The launch feeder — the call a restore moves the START OFFSET of and changes in no other way. ' +
      'It holds no fold state: `scan.seq` and `scan.endOffset` go to the container header and to the ' +
      'tailer handoff, and every event it produces is folded by a checkpointed consumer.'
  },
  {
    file: 'src/main/session.ts',
    inlet: 'new Tailer',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The LIVE feeder. Its state is a byte offset and a partial-line buffer, and `checkpointOffset()` ' +
      'is one of the two producers of B (always the end of a COMPLETE line, which is the property the ' +
      'whole format rests on). The offset is in the header; the partial line has been folded by ' +
      'nobody and must not be.'
  },
  {
    file: 'src/main/session.ts',
    inlet: 'parseEvent',
    count: 1,
    verdict: { kind: 'exempt' },
    why: 'The live feeder\'s parse — the same argument as the historical feeder\'s in scanHistory.ts.'
  },
  {
    file: 'src/main/session.ts',
    inlet: 'noteLinesParsed',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The TELEMETRY LINES-PARSED counter. A per-launch integer meaning "how many lines did THIS ' +
      'launch fold", reported once per session and reset with the process. After a restore it ' +
      'honestly counts the tail alone, which is the number the reader wants; carrying last session\'s ' +
      'count across would make the one statistic that measures a launch describe two of them.'
  },
  {
    file: 'src/main/session.ts',
    inlet: 'newBytesSince',
    count: 1,
    verdict: { kind: 'exempt' },
    why:
      'The COLD-READ SIZE for the startup profile, computed from the clean-shutdown tail mark. The ' +
      'mark is a STORE-PERSISTED record, durable through its own store, and the one-truth law puts it ' +
      'there and nowhere else — a copy in the container would be a second, older answer to a question ' +
      'the store already answers. It folds nothing: the number is a diagnostic about the READ.'
  }
]
