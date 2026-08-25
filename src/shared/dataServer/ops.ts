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
  EchoResult,
  HealthResult,
  ModuleSnapshotResult,
  SubscribeAck
} from './protocol.generated'

interface ResultRegistry {
  echo: EchoResult
  'session.attach': AttachResult
  'session.health': HealthResult
  'session.progress': SubscribeAck
  'module.snapshot': ModuleSnapshotResult
  'view.subscribe': SubscribeAck
  'view.unsubscribe': SubscribeAck
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
  'session.health': (r) => 'status' in r,
  'session.progress': (r) => 'subscribed' in r,
  // `module` rather than `state`: it is the field no other arm carries, and it is the one a caller
  // reads first anyway. `state` would be a weaker guard for the same cost — the schema lets it be
  // any JSON at all, including a value `in` cannot be asked about meaningfully.
  'module.snapshot': (r) => 'module' in r,
  'view.subscribe': (r) => 'subscribed' in r,
  'view.unsubscribe': (r) => 'subscribed' in r
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
