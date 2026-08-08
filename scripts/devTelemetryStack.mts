/**
 * devTelemetryStack.mts — the LOCAL telemetry ingest, for `npm run dev:stack`.
 *
 * The `/v1/telemetry` half of scripts/dev-feedback-server.mts, in its own module because that
 * file is at the 400-code-line ceiling. Same bargain as the feedback half, and the same
 * honesty about it:
 *
 * IS: the same shared `validateTelemetryBatch` the Lambda runs (imported, never
 * re-implemented), the same shared `rollupBatch` (so the counters this produces are the
 * counters DSQL would hold), the same STEP ORDER (size → json → shape → empty → closed →
 * per-id cap → aggregate), the same status codes, and the same "first batch of the day"
 * inference the real install UPSERT reports back.
 *
 * IS NOT, and cannot be:
 *   * NO OPTIMISTIC CONCURRENCY. The real cap is enforced by a guarded UPSERT that DSQL may
 *     abort at commit with 40001; here it is a Map read in a single-threaded process, so the
 *     retry path is unrehearsable.
 *   * NO EMF. CloudWatch metrics are a stdout format that only means something inside a Lambda
 *     log group. `GET /devstack/usage` is what replaces it locally: the tables, as JSON.
 *   * NO 3,000-ROW TRANSACTION CAP, no chunked multi-row UPSERT — a Map has no such limit, so
 *     `UPSERT_CHUNK` is exercised only by the unit tests over the pure rollup.
 *
 * WHAT IT IS FOR: proving that a batch the client would send becomes the counters the panel
 * would read, end to end, with no cloud. It is the only place those two halves meet outside a
 * deployed stack — the app cannot even send yet (`TELEMETRY_API_URL` is '').
 */

import {
  MAX_TELEMETRY_BODY_BYTES,
  type TelemetryBatch
} from '../src/shared/telemetry'
import { validateTelemetryBatch } from '../src/shared/telemetryValidate'
import { hasNulByte } from '../src/shared/sanitizeText'
import {
  cohortForChannel,
  cohortOf,
  rollupBatch,
  utcDay,
  type ErrorReportRow,
  type UsageCohort
} from '../src/shared/telemetryRollup'

/** One in-memory `analytics_install` row. Exactly the columns the real table has. */
interface Install {
  firstSeenDay: string
  lastSeenDay: string
  daysSeen: number
  appVersion: string
  channel: string
  /** 'owner' for a dev build or a hand-marked install; the counter keys carry it too. */
  cohort: UsageCohort
  quotaDay: string
  quotaN: number
}

export interface TelemetryMode {
  /** True ⇒ every batch answers 503, the way a closed `telemetry_accepting` does. */
  closed: boolean
  maxEventsPerDay: number
}

export interface TelemetryState {
  mode: TelemetryMode
  /** `day|cohort|metric|dim` → n, i.e. `usage_daily` keyed by its own primary key. */
  usage: Map<string, number>
  /** `day|cohort|funnel|step|outcome|version` → n. */
  funnels: Map<string, number>
  installs: Map<string, Install>
  /**
   * `day|cohort|version|fingerprint` → the `error_report` row (JOS-100). A Map because the
   * real table is a Map with a primary key; the FIRST-WINS rule on the exemplar is the one
   * behaviour worth rehearsing locally, since it is the half a `DO UPDATE` clause gets wrong
   * silently.
   */
  errors: Map<string, { count: number; exemplar: unknown }>
}

export function emptyTelemetryState(maxEventsPerDay = 20_000): TelemetryState {
  return {
    mode: { closed: false, maxEventsPerDay },
    usage: new Map(),
    funnels: new Map(),
    installs: new Map(),
    errors: new Map()
  }
}

/** What the caller turns into an HTTP response. Mirrors the dev stack's own `Res`. */
export interface TelemetryRes {
  status: number
  json?: unknown
  note?: string
}

const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): TelemetryRes => ({
  status,
  json: { ok: false, error, message, ...extra },
  note: error
})

/** What the install UPSERT reports back, cohort included — the twin of the Lambda's own. */
interface InstallFacts {
  firstOfDay: boolean
  newInstall: boolean
  /** Did this batch arrive on a different build than the row held? The Lambda reads this from a
   *  PK lookup taken before its UPSERT; here the stored row is simply still in hand. */
  upgraded: boolean
  cohort: UsageCohort
}

/**
 * The install row, the day facts, the cohort and the cap — the local twin of the Lambda's one
 * guarded UPSERT. Returns null when the cap is spent, mirroring "zero rows returned".
 *
 * THE COHORT RESOLUTION IS THE SQL `CASE`, in JS: the channel forces 'owner' for a dev build,
 * and otherwise whatever is already on the row wins, which is what makes a hand-placed
 * `owner-add` mark survive every later batch.
 */
function touchInstall(state: TelemetryState, batch: TelemetryBatch, day: string): InstallFacts | null {
  const events = batch.events.length
  const byChannel = cohortForChannel(batch.env.channel)
  const held = state.installs.get(batch.env.analyticsId)
  if (held === undefined) {
    state.installs.set(batch.env.analyticsId, {
      firstSeenDay: day,
      lastSeenDay: day,
      daysSeen: 1,
      appVersion: batch.env.appVersion,
      channel: batch.env.channel,
      cohort: byChannel,
      quotaDay: day,
      quotaN: events
    })
    return { firstOfDay: true, newInstall: true, upgraded: false, cohort: byChannel }
  }
  // The GUARD, read before the increment — exactly what the SQL `WHERE` evaluates.
  if (held.quotaDay === day && held.quotaN >= state.mode.maxEventsPerDay) return null
  // Read BEFORE `held.appVersion` is overwritten below — the same ordering the Lambda buys with
  // a separate statement (its `RETURNING` can only see the row it just wrote).
  const upgraded = held.appVersion !== batch.env.appVersion
  const newDay = held.lastSeenDay < day
  held.daysSeen += newDay ? 1 : 0
  held.lastSeenDay = held.lastSeenDay > day ? held.lastSeenDay : day
  held.appVersion = batch.env.appVersion
  held.channel = batch.env.channel
  held.cohort = byChannel === 'owner' ? 'owner' : cohortOf(held.cohort)
  held.quotaN = held.quotaDay === day ? held.quotaN + events : events
  held.quotaDay = day
  return { firstOfDay: held.quotaN === events, newInstall: false, upgraded, cohort: held.cohort }
}

function bump(table: Map<string, number>, key: string, n: number): void {
  table.set(key, (table.get(key) ?? 0) + n)
}

/**
 * The `error_report` half (JOS-100), and the ONE behaviour worth rehearsing locally is the
 * asymmetry: `count` accumulates, `exemplar` is FIRST WINS — the local mirror of the real
 * statement's `COALESCE(error_report.exemplar, EXCLUDED.exemplar)`. That is the half a
 * `DO UPDATE` clause gets wrong silently, and a reader of the panel would never notice the
 * exemplar quietly changing under them.
 *
 * Its own function rather than a third loop inside `telemetryRoute`, which is at the repo's
 * complexity ceiling.
 */
function writeErrors(
  state: TelemetryState,
  errors: readonly ErrorReportRow[],
  day: string,
  cohort: UsageCohort
): void {
  for (const e of errors) {
    const key = `${day}|${cohort}|${e.appVersion}|${e.fingerprint}`
    const held = state.errors.get(key)
    if (held) held.count += e.n
    else state.errors.set(key, { count: e.n, exemplar: e.exemplar })
  }
}

/** The route. `now` is injectable so a test can drive two days without waiting for one. */
export function telemetryRoute(state: TelemetryState, body: Buffer, now = Date.now()): TelemetryRes {
  if (body.byteLength > MAX_TELEMETRY_BODY_BYTES) {
    return fail(413, 'too_large', 'Telemetry batch is too large.')
  }
  const raw = body.toString('utf8')
  // Step 1.5, mirroring infra/lambda/telemetry.ts: a NUL in the RAW body, before the parser.
  if (hasNulByte(raw)) return fail(400, 'invalid_event', 'Body contains a NUL byte.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return fail(400, 'invalid_event', 'Body is not valid JSON.')
  }
  const v = validateTelemetryBatch(parsed)
  if (!v.ok) return fail(400, 'invalid_event', v.message, { field: v.field })
  if (v.value.events.length === 0) return { status: 202, json: { ok: true, accepted: 0 }, note: 'empty' }
  if (state.mode.closed) {
    return fail(503, 'closed', 'Usage analytics is not being collected right now.')
  }

  const day = utcDay(now)
  const facts = touchInstall(state, v.value, day)
  if (facts === null) {
    return fail(429, 'quota_exceeded', 'Daily event limit reached for this analytics id.')
  }
  const roll = rollupBatch(v.value, facts)
  const co = facts.cohort
  for (const c of roll.counters) bump(state.usage, `${day}|${co}|${c.metric}|${c.dim}`, c.n)
  for (const f of roll.funnels) {
    bump(state.funnels, `${day}|${co}|${f.funnel}|${f.step}|${f.outcome}|${f.appVersion}`, f.n)
  }
  writeErrors(state, roll.errors, day, co)
  return {
    status: 202,
    json: { ok: true, accepted: v.value.events.length },
    note: `${String(v.value.events.length)} events → ${String(roll.counters.length)} counters`
  }
}

/** `GET /devstack/usage` — the four tables, in the shape the triage reader consumes. */
export function telemetryTables(state: TelemetryState): TelemetryRes {
  const split = (key: string): string[] => key.split('|')
  return {
    status: 200,
    json: {
      ok: true,
      usageDaily: [...state.usage.entries()].map(([key, n]) => {
        const [day, cohort, metric, dim] = split(key)
        return { day, cohort, metric, dim, n }
      }),
      usageFunnelDaily: [...state.funnels.entries()].map(([key, n]) => {
        const [day, cohort, funnel, step, outcome, appVersion] = split(key)
        return { day, cohort, funnel, step, outcome, app_version: appVersion, n }
      }),
      analyticsInstall: [...state.installs.entries()].map(([analyticsId, i]) => ({
        analytics_id: analyticsId,
        first_seen_day: i.firstSeenDay,
        last_seen_day: i.lastSeenDay,
        days_seen: i.daysSeen,
        app_version: i.appVersion,
        channel: i.channel,
        cohort: i.cohort
      })),
      errorReport: [...state.errors.entries()].map(([key, row]) => {
        const [day, cohort, version, fingerprint] = split(key)
        return { day, cohort, version, fingerprint, count: row.count, exemplar: row.exemplar }
      })
    },
    note: `${String(state.usage.size)} counters`
  }
}
