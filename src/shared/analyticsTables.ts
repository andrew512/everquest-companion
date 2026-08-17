/**
 * analyticsTables.ts — WHAT THE ANALYTICS STORE CONSISTS OF, spelled once (JOS-398).
 *
 * The nightly export Lambda (`infra/lambda/export.ts`) and the restore path
 * (`scripts/analyticsImport.mts` behind `triage-feedback analytics import`) are the two halves
 * of "a backup that cannot be restored is not a backup", and they only work if they agree —
 * about which tables exist, which columns each one has, what its primary key is, and where a
 * restored row belongs. So the agreement is a module both import, exactly as
 * `telemetryRollup.ts` is the one definition the ingest handler and both readouts share.
 *
 * IT IS PINNED TO `infra/schema.sql` BY A TEST, not by care. `tests/analyticsExportImport.test.mts`
 * parses every `CREATE TABLE` in that file and fails when a table, a column or a primary key here
 * disagrees — in either direction. A column added to the schema and forgotten here would be a
 * column silently dropped from every backup, which is the one failure this ticket exists to make
 * impossible.
 *
 * -----------------------------------------------------------------------------------------
 * WHY THE COLUMN LISTS ARE EXPLICIT AND `SELECT *` IS NOT USED ANYWHERE
 * -----------------------------------------------------------------------------------------
 * The LIVE cluster still carries `report.title` and `report.contact` — retired from the wire
 * contract, retired from `schema.sql`, and un-droppable because Aurora DSQL's ALTER grammar has
 * no DROP COLUMN (infra/README.md carries the worked example). A `SELECT *` export would copy
 * those legacy values into a bucket every night, which is the opposite of "the values it held are
 * destroyed rather than kept" that SECURITY.md states. An explicit list cannot do that.
 *
 * -----------------------------------------------------------------------------------------
 * WHERE A RESTORED ROW LANDS — `importInto`, and why it is not always the table it came from
 * -----------------------------------------------------------------------------------------
 * `usage_daily` and `perf_daily` are FROZEN (JOS-394): the Lambda stopped writing them at
 * cutover, everything since goes to the `_sharded` twins, and `usage_daily_all` / `perf_daily_all`
 * sum both back together for every reader. A restore therefore has a choice about where a frozen
 * row goes, and the answer is the SHARDED table under shard 0 — one live table per counter
 * instead of two, and the merge view makes the move invisible to every reader. A row that already
 * carries a shard keeps it.
 *
 * THAT MAKES TWO SOURCE ROWS ABLE TO REACH ONE TARGET KEY (a frozen `usage_daily` row and a real
 * shard-0 row for the same day/metric), so the importer FOLDS by summing `sumColumn` before it
 * writes, and then writes by ASSIGNMENT. Fold-then-assign is what makes a re-run converge instead
 * of doubling — the same reasoning `scripts/analyticsBackfill.mts` states for its own upsert.
 */

/** The shard a row with no shard of its own is restored into. See the note above. */
export const IMPORT_SHARD = 0

export interface AnalyticsTable {
  /** The physical table name, and the name of its file in an export directory. */
  readonly name: string
  /** Every column, in schema order. The export SELECTs exactly these. */
  readonly columns: readonly string[]
  /** The uniqueness rule, i.e. the `ON CONFLICT` target an import upserts on. */
  readonly primaryKey: readonly string[]
  /**
   * The table a restored row is written INTO. Equal to `name` for everything except the two
   * frozen counter tables, which restore into their sharded twins under `IMPORT_SHARD`.
   */
  readonly importInto: string
  /**
   * The additive count column, when the table has one. Two source rows that collide on one
   * target key are SUMMED here before the write; without it a collision would be a silent loss.
   */
  readonly sumColumn?: string
}

const COUNTER_KEY = ['day', 'cohort', 'metric', 'dim'] as const
const CUBE_KEY = [
  'day',
  'cohort',
  'window_mode',
  'machine_class',
  'locked',
  'stall_bucket',
  'tail_bucket',
] as const

/**
 * EVERY TABLE IN THE CLUSTER, and the list is deliberately not filtered down to "the interesting
 * ones". A backup that covers the counters and not the backlog would restore an account that
 * remembers how many maps were opened and not a single bug anybody reported.
 *
 * The two VIEWS (`usage_daily_all`, `perf_daily_all`) are absent on purpose: a view holds no rows
 * of its own, and exporting it would copy every counter a second time under a third name.
 */
export const ANALYTICS_TABLES: readonly AnalyticsTable[] = [
  {
    name: 'feedback_config',
    columns: [
      'id',
      'accepting',
      'closed_message',
      'max_per_install_per_day',
      'telemetry_accepting',
      'max_events_per_id_per_day',
    ],
    primaryKey: ['id'],
    importInto: 'feedback_config',
  },
  {
    name: 'install_profile',
    columns: ['install_id', 'blocked', 'blocked_reason', 'blocked_at'],
    primaryKey: ['install_id'],
    importInto: 'install_profile',
  },
  {
    name: 'report',
    columns: [
      'report_id',
      'install_id',
      'report_type',
      'description',
      'channel',
      'app_version',
      'platform',
      'env_json',
      'log_json',
      'log_key',
      'inventory_json',
      'inventory_key',
      'client_ts',
      'received_at',
      'spam_score',
      'status',
      'severity',
      'cluster_id',
      'dupe_of',
      'disposition',
      'issue_url',
      'triaged_at',
      'redacted_at',
    ],
    primaryKey: ['report_id'],
    importInto: 'report',
  },
  {
    name: 'install_quota',
    columns: ['install_id', 'quota_day', 'n', 'bytes', 'expires_at'],
    primaryKey: ['install_id', 'quota_day'],
    importInto: 'install_quota',
  },
  {
    name: 'report_idempotency',
    columns: ['install_id', 'client_report_id', 'report_id', 'expires_at'],
    primaryKey: ['install_id', 'client_report_id'],
    importInto: 'report_idempotency',
  },
  {
    name: 'dedupe_probe',
    columns: ['hash', 'probe_day', 'first_install', 'n', 'expires_at'],
    primaryKey: ['hash', 'probe_day'],
    importInto: 'dedupe_probe',
  },
  // ---- the counters. The two frozen tables restore into their sharded twins. ----
  {
    name: 'usage_daily',
    columns: [...COUNTER_KEY, 'n'],
    primaryKey: [...COUNTER_KEY],
    importInto: 'usage_daily_sharded',
    sumColumn: 'n',
  },
  {
    name: 'usage_daily_sharded',
    columns: ['shard', ...COUNTER_KEY, 'n'],
    primaryKey: ['shard', ...COUNTER_KEY],
    importInto: 'usage_daily_sharded',
    sumColumn: 'n',
  },
  {
    name: 'usage_funnel_daily',
    columns: ['day', 'cohort', 'funnel', 'step', 'outcome', 'app_version', 'n'],
    primaryKey: ['day', 'cohort', 'funnel', 'step', 'outcome', 'app_version'],
    importInto: 'usage_funnel_daily',
    sumColumn: 'n',
  },
  {
    name: 'analytics_install',
    columns: [
      'analytics_id',
      'first_seen_day',
      'last_seen_day',
      'days_seen',
      'app_version',
      'channel',
      'cohort',
      'quota_day',
      'quota_n',
      'machine_class',
      'window_mode',
    ],
    primaryKey: ['analytics_id'],
    importInto: 'analytics_install',
  },
  {
    name: 'error_report',
    columns: ['day', 'cohort', 'version', 'fingerprint', 'count', 'exemplar'],
    primaryKey: ['day', 'cohort', 'version', 'fingerprint'],
    importInto: 'error_report',
    sumColumn: 'count',
  },
  {
    name: 'perf_daily',
    columns: [...CUBE_KEY, 'n'],
    primaryKey: [...CUBE_KEY],
    importInto: 'perf_daily_sharded',
    sumColumn: 'n',
  },
  {
    name: 'perf_daily_sharded',
    columns: ['shard', ...CUBE_KEY, 'n'],
    primaryKey: ['shard', ...CUBE_KEY],
    importInto: 'perf_daily_sharded',
    sumColumn: 'n',
  },
]

/** The table with this name, or null. Never a guess: an unknown file name is refused. */
export function analyticsTable(name: string): AnalyticsTable | null {
  return ANALYTICS_TABLES.find((t) => t.name === name) ?? null
}

/** The table a restored row is written into — always one of `ANALYTICS_TABLES` itself. */
export function importTargetOf(table: AnalyticsTable): AnalyticsTable {
  const target = analyticsTable(table.importInto)
  if (!target) throw new Error(`analyticsTables: ${table.name}.importInto names no table`)
  return target
}

/** A row as it crosses the wire: JSON scalars only, keyed by column name. */
export type ExportRow = Record<string, string | number | boolean | null>

/**
 * ONE FILE OF ONE TABLE. Self-describing on purpose: the restore path is used on the worst day
 * this product will ever have, and a human should be able to `gunzip | jq` one of these and see
 * which table it is and when it was taken, without a manifest beside it.
 *
 * `part` is 0 for a single-file table and counts up when a table is split (the export pages a
 * table past ~50 MB into part files rather than buffering it whole).
 */
export interface ExportBundle {
  table: string
  exportedAt: number
  part: number
  rows: ExportRow[]
}

export function serializeBundle(bundle: ExportBundle): string {
  return JSON.stringify(bundle)
}

const isRow = (v: unknown): v is ExportRow =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Parse and VALIDATE one export file. Everything it can refuse, it refuses by shape rather than
 * by trusting a file name: the bundle names its own table, that name must be in the registry, and
 * every key in every row must be a column of it. A file carrying a column the schema does not
 * have would otherwise become a `42703` in the middle of a restore, which is exactly when a
 * confusing error costs the most.
 */
export function parseBundle(text: string): { bundle: ExportBundle; table: AnalyticsTable } {
  const raw: unknown = JSON.parse(text)
  if (!isRow(raw)) throw new Error('export bundle: expected a JSON object')
  const name = raw.table
  if (typeof name !== 'string') throw new Error('export bundle: missing "table"')
  const table = analyticsTable(name)
  if (!table) throw new Error(`export bundle: "${name}" is not an analytics table`)
  const rows: unknown = (raw as { rows?: unknown }).rows
  if (!Array.isArray(rows)) throw new Error(`export bundle: ${name} has no "rows" array`)
  const allowed = new Set(table.columns)
  for (const row of rows) {
    if (!isRow(row)) throw new Error(`export bundle: ${name} has a non-object row`)
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`export bundle: ${name} has no column "${key}"`)
    }
  }
  return {
    bundle: {
      table: name,
      exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
      part: typeof raw.part === 'number' ? raw.part : 0,
      rows: rows as ExportRow[],
    },
    table,
  }
}

/**
 * The S3 key one part lands under. Single-part tables get the plain
 * `exports/<table>/<YYYY-MM-DD>.json.gz` the runbook documents; a table big enough to split
 * grows a `.partNN` before the extension, so the plain name never means "part of a table".
 */
export function exportKey(table: string, day: string, part: number, parts: number): string {
  const suffix = parts > 1 ? `.part${String(part).padStart(2, '0')}` : ''
  return `exports/${table}/${day}${suffix}.json.gz`
}

/** The manifest key for one night. One object listing every part, so a restore can be planned. */
export function manifestKey(day: string): string {
  return `exports/_manifest/${day}.json`
}
