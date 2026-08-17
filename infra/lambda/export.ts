/**
 * export.ts — the nightly logical export of every analytics table to S3 (JOS-398).
 *
 * A THIRD LAMBDA, on an EventBridge schedule, with no HTTP surface at all. Owner ruling
 * 2026-08-16: the analytics data must never be lost. Aurora DSQL's own durability answers a disk
 * dying; it does not answer a bad migration, `scripts/analyticsBackfill.mts` swapping the wrong
 * table, a fat-fingered DROP, or an account-level event. AWS Backup (infra/backup.tf) answers
 * those at the cluster level; this answers them at the ROW level, in a format anybody can read
 * without AWS Backup, a restore job, or this repo.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS A COPY, NOT A NEW COLLECTION
 * ---------------------------------------------------------------------------------------------
 * Every byte written here was already in the cluster. Nothing new is gathered, nothing is
 * derived, no field is added, and the column lists come from `src/shared/analyticsTables.ts`
 * rather than from `SELECT *` — so the retired `report.title`/`contact` columns that the live
 * cluster still physically carries are NOT copied out. The bucket blocks all public access, has
 * no bucket-level read grant to anything, and is written by exactly this function.
 * SECURITY.md says so in the user's own words.
 *
 * ---------------------------------------------------------------------------------------------
 * IT CONNECTS AS `analytics_export`, WHICH HOLDS SELECT AND NOTHING ELSE
 * ---------------------------------------------------------------------------------------------
 * A third DATABASE role (infra/schema.sql), for the reason `telemetry_ingest` is a second one:
 * what a function may do should be readable as a GRANT list. This one's list is SELECT on every
 * table and no INSERT, no UPDATE, no DELETE, anywhere. It is the only role in the cluster that
 * can read both the counters and the backlog, which is why it is also the only one with no
 * public trigger: its invoker is an EventBridge rule, and its IAM policy is `dsql:DbConnect` plus
 * `s3:PutObject` under one prefix of one bucket.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT DOES NOT USE ./db.ts
 * ---------------------------------------------------------------------------------------------
 * That module is shaped for a 30 ms invocation behind a public endpoint: a client cached across
 * warm invokes, a 3 s client-side statement bound, and a full-jitter OCC retry ladder. This
 * function runs once a day, holds one connection for one pass, retries nothing (a SELECT cannot
 * lose a write race), and needs statements measured in seconds rather than milliseconds. Making
 * db.ts configurable enough to serve both would also move `source_code_hash` on BOTH ingest
 * functions for a change neither of them needs — an entirely avoidable redeploy of the two things
 * users actually talk to. Sixty lines of connection code is the cheaper half of that trade.
 */

import { gzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import pg from 'pg'
import type { Client as PgClient } from 'pg'
import { DsqlSigner } from '@aws-sdk/dsql-signer'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { emit } from './emf'
import {
  ANALYTICS_TABLES,
  exportKey,
  manifestKey,
  serializeBundle,
  splitParts,
  type AnalyticsTable,
  type ExportRow,
} from '../../src/shared/analyticsTables'

const { Client, types } = pg

const HOST = process.env.DSQL_ENDPOINT ?? ''
const DB_USER = process.env.DSQL_USER ?? 'analytics_export'
const REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.ARCHIVE_BUCKET ?? ''
const APPLICATION = process.env.DSQL_APPLICATION ?? 'eqc-analytics-export'

/** Rows per SELECT. Small enough that one page is never a slow statement, large enough that a
 *  table of a few hundred thousand rows is a few hundred round trips. */
const PAGE = 2_000
/** A cold connect that has not landed in 10 s is not going to save this run. */
const CONNECT_TIMEOUT_MS = 10_000
/** One page, client-side. `SET statement_timeout` is unsupported on DSQL (db.ts records the
 *  live finding), so a socket timer is the only statement bound available. */
const STATEMENT_TIMEOUT_MS = 30_000
/** The ticket's part threshold: a table whose serialized JSON passes this is split. */
const MAX_PART_BYTES = 50 * 1024 * 1024
/** And the point at which buffering a table is no longer a sane thing to do. Failing LOUDLY at a
 *  stated ceiling beats an out-of-memory kill that looks like a timeout. */
const MAX_TABLE_BYTES = 512 * 1024 * 1024

/** Same reasoning as db.ts: int8 arrives as a STRING and every bigint here is exactly a double. */
types.setTypeParser(20, (value: string): number => Number(value))

/** Structured stdout, the same shape both ingest handlers use. */
function log(fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(fields)}\n`)
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** `YYYY-MM-DD` in UTC — the same day key every counter table is written with. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

async function open(): Promise<PgClient> {
  const signer = new DsqlSigner({ hostname: HOST, region: REGION })
  // The NON-admin token, exactly as the ingest path takes it: this role is granted
  // `dsql:DbConnect`, so asking for the admin token would fail at the IAM boundary anyway.
  const client = new Client({
    host: HOST,
    port: 5432,
    database: 'postgres',
    user: DB_USER,
    password: await signer.getDbConnectAuthToken(),
    ssl: { rejectUnauthorized: true },
    application_name: APPLICATION,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
  })
  // Without a listener a dropped socket is an unhandled 'error' event, i.e. a dead container
  // rather than a failed run — the lesson infra/lambda/db.ts records at length.
  client.on('error', (err: Error) => {
    log({ msg: 'export.socket', error: err.message })
  })
  await client.connect()
  return client
}

/**
 * One table, whole, in memory. OFFSET paging over the primary key — the same shape
 * `scripts/analyticsBackfill.mts` pages with, and the order is the key so a page boundary is
 * stable for the length of one pass.
 *
 * WHY BUFFER RATHER THAN STREAM: the part layout has to know how many parts there are before it
 * can name the first one (`<day>.json.gz` when there is one, `<day>.partNN.json.gz` when there
 * are several), and a name that changes meaning depending on what came later is the kind of
 * detail a restore gets wrong at 3am. These tables are megabytes; `MAX_TABLE_BYTES` is the loud
 * failure if that ever stops being true.
 */
async function readTable(client: PgClient, table: AnalyticsTable): Promise<ExportRow[]> {
  const columns = table.columns.join(', ')
  const order = table.primaryKey.join(', ')
  const rows: ExportRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const sql = `SELECT ${columns} FROM ${table.name} ORDER BY ${order} LIMIT $1 OFFSET $2`
    const page = await client.query<ExportRow>(sql, [PAGE, offset])
    rows.push(...page.rows)
    if (page.rows.length < PAGE) return rows
  }
}

interface PartRecord {
  key: string
  rows: number
  bytes: number
}

/**
 * Every PutObject names `ServerSideEncryption` explicitly rather than leaning on the bucket
 * default, because the bucket POLICY denies a put that does not carry the header (infra/export.tf
 * spells out both statements). Default encryption would satisfy the bucket and not the policy —
 * the header is what the condition can see.
 */
async function put(s3: S3Client, key: string, body: Buffer, type: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
      ServerSideEncryption: 'AES256',
    }),
  )
}

/** What one run carries from table to table. A record rather than five positionals — the repo's
 *  `max-params` cap is 4, and "the run" is a real thing rather than a bag made to satisfy it. */
interface RunContext {
  client: PgClient
  s3: S3Client
  day: string
  nowMs: number
}

async function exportTable(run: RunContext, table: AnalyticsTable): Promise<PartRecord[]> {
  const { s3, day, nowMs } = run
  const rows = await readTable(run.client, table)
  const parts = splitParts(rows, MAX_PART_BYTES)
  const written: PartRecord[] = []
  let total = 0
  for (const [index, part] of parts.entries()) {
    const body = gzipSync(
      Buffer.from(
        serializeBundle({ table: table.name, exportedAt: nowMs, part: index, rows: part }),
        'utf8',
      ),
      { level: 9 },
    )
    total += body.length
    if (total > MAX_TABLE_BYTES) {
      throw new Error(`${table.name} exceeded the ${String(MAX_TABLE_BYTES)}-byte export ceiling`)
    }
    const key = exportKey(table.name, day, index, parts.length)
    await put(s3, key, body, 'application/gzip')
    written.push({ key, rows: part.length, bytes: body.length })
  }
  // ONE dimensioned document per table. `Table` is a value from the closed registry, never
  // anything a client sent, so it cannot mint an unbounded number of billed metrics — the rule
  // emf.ts states, applied.
  emit({ Table: table.name }, [{ name: 'ExportRows', value: rows.length }], nowMs)
  log({ msg: 'export.table', table: table.name, rows: rows.length, parts: parts.length })
  return written
}

interface RunResult {
  day: string
  tables: number
  rows: number
}

/**
 * THE RUN. Every table, then the manifest, then the metrics. It is deliberately ALL-OR-NOTHING in
 * its reporting: one table failing raises `ExportFailed` and the invocation throws, because a
 * partial night that reported success is a backup nobody would check.
 */
export async function runExport(nowMs: number): Promise<RunResult> {
  if (BUCKET === '') throw new Error('ARCHIVE_BUCKET is not set')
  const day = utcDay(nowMs)
  const s3 = new S3Client({ region: REGION })
  const client = await open()
  try {
    const run: RunContext = { client, s3, day, nowMs }
    const manifest: Record<string, PartRecord[]> = {}
    let rows = 0
    for (const table of ANALYTICS_TABLES) {
      const parts = await exportTable(run, table)
      manifest[table.name] = parts
      rows += parts.reduce((sum, p) => sum + p.rows, 0)
    }
    // The index of the night: which tables, how many rows, which keys. `analytics import` can be
    // pointed at a directory of downloaded parts, and this is what says which ones to download.
    await put(
      s3,
      manifestKey(day),
      Buffer.from(JSON.stringify({ day, exportedAt: nowMs, tables: manifest }, null, 2), 'utf8'),
      'application/json',
    )
    return { day, tables: ANALYTICS_TABLES.length, rows }
  } finally {
    await client.end().catch(() => undefined)
  }
}

/**
 * EventBridge invokes this with a scheduled-event payload nothing here reads. The return value is
 * for a human running a manual invoke; the metrics are what the alarms watch.
 *
 * `ExportRows` is emitted a SECOND time with no dimensions, and that is not duplication: an EMF
 * document creates only the dimension sets it names, so a per-table metric cannot answer "did an
 * export happen at all last night". The un-dimensioned one is what the missing-data alarm in
 * infra/export.tf watches.
 */
export async function handler(): Promise<RunResult> {
  const started = Date.now()
  try {
    const out = await runExport(started)
    emit(
      {},
      [
        { name: 'ExportRows', value: out.rows },
        { name: 'ExportDurationMs', value: Date.now() - started, unit: 'Milliseconds' },
      ],
      started,
    )
    log({ msg: 'export.ok', day: out.day, tables: out.tables, rows: out.rows })
    return out
  } catch (err) {
    // The loss signal. `ExportFailed >= 1` alarms immediately: a missed night is a night whose
    // rows exist only in the cluster, which is the state this whole ticket exists to end.
    emit({}, [{ name: 'ExportFailed', value: 1 }], started)
    log({ msg: 'export.failed', error: errorMessage(err) })
    throw err
  }
}
