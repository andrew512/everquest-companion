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
  DefineAck,
  EchoResult,
  HealthResult,
  ModuleSnapshotResult,
  PerfSnapshotResult,
  SessionMarkAck,
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
  // THE ONE COMMAND WHOSE ANSWER IS NOT AN ACKNOWLEDGEMENT (JOS-487, boundary verdict 6). A define
  // always applies; a mark can be REFUSED while the fold is still replaying, and the caller has to
  // branch on it — `pressNewSession`'s "both halves or neither" is exactly that branch.
  'sessionMarks.add': SessionMarkAck
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
  // `accepted` ALONE STOPPED BEING A DISCRIMINATOR when `sessionMarks.add` arrived (JOS-487) — the
  // same thing that happened to `status` when `perf.snapshot` did, and caught the same way, by the
  // matrix in `tests/dataServerOps.test.mts` rather than by a caller reading a field that was not
  // there. Two ops now answer with an `accepted` flag, and what separates them is that an attach
  // names the GENERATION it created while a mark creates none.
  'session.attach': (r) => 'accepted' in r && 'epoch' in r,
  // `status` ALONE STOPPED BEING A DISCRIMINATOR when `perf.snapshot` arrived (JOS-483): that
  // result restates the five facts health gives, `status` among them, and neither shape has a
  // required field the other lacks. So the guard names what health is NOT — it carries no serve
  // table — which is the smallest true statement that separates the two. A guard both arms pass is
  // a guard that cannot tell them apart, and the matrix in `tests/dataServerOps.test.mts` is what
  // caught this rather than a caller reading a field that was not there.
  //
  // AND `status` ALONE GOT WEAKER AGAIN with `sessionMarks.add` (JOS-487), which carries the same
  // five-member status so that a REFUSAL can say what it was refusing under. Three arms now carry
  // that field, so the positive half of this guard moved to `uptimeMs` — the fact only a question
  // ABOUT THIS PROCESS has an answer to — and the negative half still separates it from perf's.
  // Twice in two tickets is a pattern worth naming: `status` is a value, not an identity.
  'session.health': (r) => 'uptimeMs' in r && !('serve' in r),
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
  // `accepted` IS SHARED WITH `AttachResult`, so the guard names what a mark ack is NOT — it carries
  // no epoch. Same reasoning as `session.health`'s: a guard both arms pass cannot tell them apart,
  // and the matrix in `tests/dataServerOps.test.mts` is what would catch it if it did.
  'sessionMarks.add': (r) => 'accepted' in r && !('epoch' in r)
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
