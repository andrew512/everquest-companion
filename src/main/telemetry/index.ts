// telemetry/index.ts — THE PUBLIC SURFACE of usage analytics (docs/plans/usage-analytics.md).
//
// The IPC layer (`src/main/ipc/telemetry.ts`) and the composition root import only from here, so
// the wiring can never reach around the façade into the ring or the flush loop.
//
// ======================== WHAT THIS FEATURE IS ALLOWED TO BE ========================
//   * ALLOWLIST OR IT DOES NOT EXIST. Every event is a member of the closed union in
//     `src/shared/telemetry.ts`, validated by the SAME function the renderer, main and the
//     ingest Lambda run. The schema has no free-text field, so a character name, a zone, a
//     spell or a line of log has nowhere to go.
//   * OPT-OUT, BUT NOTHING TRANSMITS BEFORE THE NOTICE HAS RENDERED. Collection may buffer;
//     the network gate (`telemetryFlushEnabled`) additionally requires `noticeShown`. Opting
//     out drops the buffer AND the id, immediately.
//   * THIS BUILD SENDS. `TELEMETRY_API_URL` names the deployed ingest route, and the ONLY fetch
//     in this directory targets that constant (net.ts, pinned by tests/telemetryNet.test.mts).
//     SECURITY.md, README.md and TELEMETRY.md say so in the same commit that lit it.
//   * NOTHING HERE THROWS. Every path is best-effort; losing a counter is not an app failure.

export {
  ensureAnalyticsId,
  pendingBatch,
  platformOf,
  recordEvent,
  rotateAnalyticsId,
  telemetryPayload
} from './collector'
// The switch and the notice go through flush.ts, not collector.ts: flipping the pref is only
// half the job — this session's timers have to come into line with it too, and one function
// doing both is how the toggle and the modal can never diverge.
export {
  answerNotice,
  applyTelemetryEnabled,
  flushTelemetry,
  startTelemetry,
  stopTelemetry
} from './flush'
export { TELEMETRY_API_URL, telemetryEndpointConfigured, telemetryFlushEnabled } from './net'
