// THE CLOSED REGISTRY, APP SIDE (JOS-468) — which result shape belongs to which op, and the one
// error type a caller of this client ever sees.
//
// The schema states the rule and refuses to restate it on the wire: a reply carries no op of its
// own, because the op of the REQUEST whose id it names is what decides the result shape (a reply
// that repeated its own op would be a second place for the two to disagree). That rule is not
// expressible in the generated types — `ReplyResult` is a bare union there — so this file is where
// it becomes one, and `OpsAreExhaustive` makes a new op in `protocol/schema/` a compile error here
// until somebody writes down what it answers with.
//
// PARAMS ARE DERIVED, NEVER RESTATED. `ParamsFor` reads them straight off the wire union, so only
// the result side of the registry can drift at all.

import type { ClientMessage, ErrorCode, Hello, ReplyResult, RequestId } from './protocol.generated'
import type {
  AttachResult,
  CombatSearchFightsResult,
  CombatSnapshotResult,
  DefineAck,
  EchoResult,
  HealthResult,
  KnowledgeResult,
  KnowledgeSearchResult,
  ModuleSnapshotResult,
  PerfSnapshotResult,
  SubscribeAck
} from './protocol.generated'

interface ResultRegistry {
  echo: EchoResult
  'session.attach': AttachResult
  'session.health': HealthResult
  'session.progress': SubscribeAck
  'module.snapshot': ModuleSnapshotResult
  'perf.snapshot': PerfSnapshotResult
  'view.subscribe': SubscribeAck
  'view.unsubscribe': SubscribeAck
  // THE FIVE `*.define` COMMANDS (JOS-482) SHARE ONE ANSWER, and the registry says so once per op
  // rather than collapsing them into a wildcard: the whole point of this file is that a NEW op
  // cannot compile until somebody writes down what it answers with, and five ops that happen to
  // agree today are still five entries.
  'alerts.define': DefineAck
  'buffTrust.define': DefineAck
  'respawn.define': DefineAck
  'combo.define': DefineAck
  'roster.define': DefineAck
  // THE COMBAT SURFACE (JOS-485). Two ops and two shapes: the meter's whole state, and a ranked
  // answer to a search box. Neither is a `view.*` — one is the app's own `combat:snapshot` IPC
  // moved server-side, the other is a question rather than a window — and the third surface the
  // ticket adds, `combat.live`, is a view SOURCE and therefore not an op at all.
  'combat.snapshot': CombatSnapshotResult
  'combat.searchFights': CombatSearchFightsResult,
  // THE KNOWLEDGE SURFACE (JOS-486). Three lookups share one result shape and that is the shape
  // being right rather than the registry being lazy: `KnowledgeResult` names its own `domain`, so a
  // caller holding an item card and a mob card can tell them apart from the value alone — which is
  // what the five `*.define` ops CANNOT do with `DefineAck`, and why they are five entries too.
  'knowledge.item': KnowledgeResult
  'knowledge.mob': KnowledgeResult
  'knowledge.spell': KnowledgeResult
  'knowledge.search': KnowledgeSearchResult
  // …and the push-back reuses `DefineAck`, because it IS a define: one entry taken, `applied` true,
  // and no `count`, which the schema already says is what a non-list payload answers with.
  'knowledge.define': DefineAck
}

/** Every client message that carries a request id — i.e. everything except the handshake. */
export type RequestMessage = Exclude<ClientMessage, Hello>
/** Every op that can be requested. */
export type RequestOp = keyof ResultRegistry
/** The params the schema gives that op. */
export type ParamsFor<O extends RequestOp> = Extract<RequestMessage, { op: O }>['params']
/** The result the registry gives that op. */
export type ResultFor<O extends RequestOp> = ResultRegistry[O]

/** Compile-time pin, both directions: the registry names every op the schema has, and no other. */
export type OpsAreExhaustive = [Exclude<RequestMessage['op'], RequestOp>] extends [never]
  ? [Exclude<RequestOp, RequestMessage['op']>] extends [never]
    ? true
    : false
  : false
export const OPS_ARE_EXHAUSTIVE: OpsAreExhaustive = true

/**
 * One discriminating field per result shape. The registry is a CLAIM about what the engine answers
 * with; this is the cheapest possible check that it kept its side of it. A reply whose shape the op
 * does not own becomes an `internal` failure rather than a value handed to a caller who is about to
 * read a field that is not there.
 */
export const RESULT_GUARDS: Record<RequestOp, (result: ReplyResult) => boolean> = {
  echo: (r) => 'text' in r,
  'session.attach': (r) => 'accepted' in r,
  // `status` ALONE STOPPED BEING A DISCRIMINATOR when `perf.snapshot` arrived (JOS-483): that
  // result restates the five facts health gives, `status` among them, and neither shape has a
  // required field the other lacks. So the guard names what health is NOT — it carries no serve
  // table — which is the smallest true statement that separates the two. A guard both arms pass is
  // a guard that cannot tell them apart, and the matrix in `tests/dataServerOps.test.mts` is what
  // caught this rather than a caller reading a field that was not there.
  'session.health': (r) => 'status' in r && !('serve' in r),
  'session.progress': (r) => 'subscribed' in r,
  // `module` rather than `state`: it is the field no other arm carries, and it is the one a caller
  // reads first anyway. `state` would be a weaker guard for the same cost — the schema lets it be
  // any JSON at all, including a value `in` cannot be asked about meaningfully.
  'module.snapshot': (r) => 'module' in r,
  // `serve` rather than `status`: `session.health` already owns `status`, and a guard that two
  // arms of the registry both pass is a guard that cannot tell them apart. `serve` is required by
  // the schema and carried by no other result shape.
  'perf.snapshot': (r) => 'serve' in r,
  'view.subscribe': (r) => 'subscribed' in r,
  'view.unsubscribe': (r) => 'subscribed' in r,
  // `applied` is the field no other arm carries — `count` would be a weaker guard, because it is
  // absent for the two families whose payload is one object rather than a list.
  'alerts.define': (r) => 'applied' in r,
  'buffTrust.define': (r) => 'applied' in r,
  'respawn.define': (r) => 'applied' in r,
  'combo.define': (r) => 'applied' in r,
  'roster.define': (r) => 'applied' in r,
  // `snapshot` rather than `now`: the payload is the field this result exists for, and a name as
  // generic as `now` is the one a later result shape is most likely to want too. The lesson is
  // JOS-483's — a guard is only worth its line if no other arm can pass it — and `status` losing its
  // discriminating power the moment `perf.snapshot` restated it is what taught it.
  'combat.snapshot': (r) => 'snapshot' in r,
  // `hits` rather than `corpus`, for the same reason and one step further: `corpus` is a count and
  // counts are exactly what other shapes grow.
  'combat.searchFights': (r) => 'hits' in r,
  // `record` rather than `found`: it is the field no other arm carries, and a boolean guard would
  // read `false` as "wrong shape" if `in` were ever swapped for a truthiness test by a later hand.
  'knowledge.item': (r) => 'record' in r,
  'knowledge.mob': (r) => 'record' in r,
  'knowledge.spell': (r) => 'record' in r,
  // `hits` rather than `query`: a search result and a lookup result must be separable, and `hits`
  // is required by the schema and carried by no other shape.
  'knowledge.search': (r) => 'hits' in r,
  'knowledge.define': (r) => 'applied' in r
}

/**
 * Why a request or a subscription failed. `code` is what a caller branches on — the message is for
 * a log line and a bug report, never for parsing.
 *
 * The codes are the schema's own closed set, and this client borrows two of them for failures that
 * happen on THIS side of the wire: `unavailable` for a connection that is gone, replaced or closed
 * (with the underlying `TransportError` kept as `cause`), and `protocolMismatch` for a handshake
 * whose versions disagree. One rejection type for every caller is worth more than a second error
 * class that means "and this one came from us".
 */
export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly requestId?: RequestId,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'EngineError'
  }
}
