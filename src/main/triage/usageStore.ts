// usageStore — the usage-analytics half of the triage store (docs/plans/usage-analytics.md §4).
//
// Split from store.ts when two independent waves (the A2/A3 readout and the smoke test's
// per-id reader) composed that file past the 400-line ceiling — the merge crossed the cap
// even though each wave alone stayed under it, which is exactly the failure mode a per-file
// cap is supposed to surface. Same laws as store.ts: every read is a single bounded
// statement; consumers import these names FROM store.ts (it re-exports this whole module),
// so the split moved code, not import paths.
//
// THREE READS, and each is a single indexed statement with a bound:
//   * `usage_daily` and `usage_funnel_daily` are `day >= :floor` over the PRIMARY KEY's
//     leading column, so the window bounds the scan.
//   * `analytics_install` is the whole table, because that is the question — WAU/MAU,
//     retention cohorts and version spread are all "count rows by a date", and there is no
//     window that makes them cheaper. It is bounded by a LIMIT anyway: this panel must not
//     promise to render an install base it has not measured.
//
// THE TABLES MAY NOT EXIST. A stack applied before the A2 migration answers `42P01
// undefined_table`, which is a genuinely different fact from "the tables are empty" and the
// panel renders it differently (available:false vs honest zeros). `missingTable` is how the
// caller tells them apart without matching on message text.

import { sqlState, UNDEFINED_TABLE, type Clients, type Row } from './store'

/** The table named by a `42P01 undefined_table`, or null for any other failure. */
export function missingTable(err: unknown): string | null {
  if (sqlState(err) !== UNDEFINED_TABLE) return null
  const raw = err instanceof Error ? err.message : String(err)
  // postgres: `relation "usage_daily" does not exist`.
  return /relation "([^"]+)"/.exec(raw)?.[1] ?? 'usage_daily'
}

/** Rows are capped hard: 90 days of counters is a few thousand rows, and a runaway `dim`
 *  cardinality (which the closed enums make impossible, but this is a boundary) stays bounded. */
export const USAGE_ROW_LIMIT = 20_000
export const INSTALL_ROW_LIMIT = 50_000

export function readUsageDaily(c: Clients, sinceDay: string): Promise<Row[]> {
  return c.query(
    'SELECT day, metric, dim, n FROM usage_daily WHERE day >= $1 ORDER BY day LIMIT $2',
    [sinceDay, USAGE_ROW_LIMIT],
  )
}

export function readUsageFunnelDaily(c: Clients, sinceDay: string): Promise<Row[]> {
  return c.query(
    'SELECT day, funnel, step, outcome, app_version, n FROM usage_funnel_daily' +
      ' WHERE day >= $1 ORDER BY day LIMIT $2',
    [sinceDay, USAGE_ROW_LIMIT],
  )
}

/**
 * NOTE WHAT IS NOT SELECTED: `analytics_id`. The readout needs day-grained facts about the
 * population (how many, first seen when, on what version) and never the identifier itself, so
 * the id does not leave the database — not into main, not over the bridge, not into a panel.
 * The one place it is named is `wipe --id`, where the caller already has it.
 */
export function readAnalyticsInstalls(c: Clients): Promise<Row[]> {
  return c.query(
    'SELECT first_seen_day, last_seen_day, days_seen, app_version, channel' +
      ' FROM analytics_install ORDER BY last_seen_day DESC LIMIT $1',
    [INSTALL_ROW_LIMIT],
  )
}

/**
 * ONE id's install row, or null. The only per-id READ in this module, and it exists for exactly
 * one caller: the post-release smoke test (`scripts/smoke-feedback.mts verify-telemetry`), which
 * has to answer "did the batch this VM sent actually land" and cannot do that from population
 * aggregates.
 *
 * It is the exact twin of `deleteAnalyticsInstall` below, and safe for the same reason: the
 * CALLER ALREADY HOLDS THE ID (it came off the machine that generated it, or from a user asking
 * for a deletion). Nothing here hands out an identifier that was not already in hand — the
 * SELECT list still omits `analytics_id`, so this cannot be used to enumerate ids, and the
 * readout path (`readAnalyticsInstalls`) is untouched.
 */
export async function readAnalyticsInstall(c: Clients, analyticsId: string): Promise<Row | null> {
  const rows = await c.query(
    'SELECT first_seen_day, last_seen_day, days_seen, app_version, channel' +
      ' FROM analytics_install WHERE analytics_id = $1',
    [analyticsId],
  )
  return rows[0] ?? null
}

/**
 * `analytics wipe --id` (T7). The install row is the ONLY per-id row that exists — the
 * counters it contributed to are anonymous sums with no id in them and are deliberately left
 * alone (they cannot be attributed, and unpicking one id's contribution from a sum is not
 * possible in either direction). Returns the number of rows deleted, so the CLI can say
 * whether the id was ever seen.
 */
export function deleteAnalyticsInstall(c: Clients, analyticsId: string): Promise<number> {
  return c.execute('DELETE FROM analytics_install WHERE analytics_id = $1', [analyticsId])
}

/**
 * The telemetry kill switch — `feedback_config.telemetry_accepting`, the twin of
 * `setAccepting`. An UPDATE rather than an UPSERT because the row is seeded by `migrate` and a
 * telemetry switch on a cluster with no config row would be a switch on nothing; zero rows
 * updated is reported to the caller as exactly that.
 */
export function setTelemetryAccepting(c: Clients, accepting: boolean): Promise<number> {
  return c.execute(
    `UPDATE feedback_config SET telemetry_accepting = $1 WHERE id = 'FEEDBACK'`,
    [accepting],
  )
}
