// NEVER LOSE THE DATA (JOS-398) — the export bundle, and the restore that makes it a backup.
//
// Four properties, and the first is the one that keeps the other three honest over time:
//
//   1. THE REGISTRY IS PINNED TO infra/schema.sql. `src/shared/analyticsTables.ts` is what the
//      nightly Lambda SELECTs and what the importer writes, so a column added to the schema and
//      forgotten there is a column silently dropped from every backup — the exact failure this
//      ticket exists to make impossible. The audit below parses every CREATE TABLE in the real
//      file and compares both directions.
//   2. THE BUNDLE REFUSES BY SHAPE. A file names its own table, and a table it does not name, a
//      column that does not exist, or a row that is not an object are all refusals rather than
//      guesses. A restore reads files nobody has looked at since the night they were written.
//   3. THE UPSERT IS IDEMPOTENT, AND THE FOLD IS WHY. The frozen `usage_daily` restores into
//      `usage_daily_sharded` under shard 0, so a frozen row and a real shard-0 row can reach one
//      key; they are summed in memory and then written by ASSIGNMENT. Running the same export in
//      twice must converge, not double.
//   4. THE KILL SWITCHES COME BACK CLOSED. A restore is an incident and the public endpoints
//      reopen deliberately.
//
// Driven by the same kind of in-memory fake `tests/analyticsBackfill.test.mts` uses — every
// statement the importer issues really runs against it, so the SQL itself (column list, parameter
// order, ON CONFLICT target, chunking) is under test. No AWS, no cluster, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  ANALYTICS_TABLES,
  analyticsTable,
  exportKey,
  importTargetOf,
  manifestKey,
  parseBundle,
  serializeBundle,
  splitParts,
  type ExportRow,
} from '../src/shared/analyticsTables'
import {
  IMPORT_CHUNK,
  exportFilesUnder,
  planImport,
  runImport,
  upsertSql,
} from '../scripts/analyticsImport.mjs'
import type { Clients, Row } from '../src/main/triage/store'

const SCHEMA = readFileSync(join(import.meta.dirname, '..', 'infra', 'schema.sql'), 'utf8')

// ---- 1. the registry is pinned to schema.sql -------------------------------------------------

interface SchemaTable {
  columns: string[]
  primaryKey: string[]
}

/** Every `CREATE TABLE IF NOT EXISTS <name> ( … );` in the real file, parsed. */
function schemaTables(sql: string): Map<string, SchemaTable> {
  const out = new Map<string, SchemaTable>()
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    const columns: string[] = []
    let primaryKey: string[] = []
    // `/\r?\n/`, and the comment strip is UNANCHORED, both for the same CRLF reason: JS treats
    // `\r` as a line terminator, so `.` will not cross one and a `--.*$` on a CRLF line matches
    // nothing at all. This file is checked out with CRLF on Windows.
    for (const line of m[2].split(/\r?\n/)) {
      const body = line.replace(/--.*/, '').trim().replace(/,$/, '')
      if (body.length === 0) continue
      const key = /^PRIMARY KEY \((.+)\)$/.exec(body)
      if (key) primaryKey = key[1].split(',').map((s) => s.trim())
      else columns.push(body.split(/\s+/)[0])
    }
    out.set(m[1], { columns, primaryKey })
  }
  return out
}

test('every table in infra/schema.sql is in the registry, and vice versa', () => {
  const schema = schemaTables(SCHEMA)
  // Sanity on the parser itself before it is used as an oracle.
  assert.ok(schema.size >= 13, `parsed only ${String(schema.size)} CREATE TABLE blocks`)
  const registry = new Set(ANALYTICS_TABLES.map((t) => t.name))
  for (const name of schema.keys()) {
    assert.ok(registry.has(name), `${name} exists in schema.sql and is NOT exported — it would be lost`)
  }
  for (const name of registry) {
    assert.ok(schema.has(name), `${name} is in the registry and has no CREATE TABLE in schema.sql`)
  }
})

test('every registry column and primary key matches the schema, in order', () => {
  const schema = schemaTables(SCHEMA)
  for (const table of ANALYTICS_TABLES) {
    const declared = schema.get(table.name)
    assert.ok(declared, `${table.name} is missing from schema.sql`)
    assert.deepEqual([...table.columns], declared.columns, `${table.name} columns`)
    assert.deepEqual([...table.primaryKey], declared.primaryKey, `${table.name} primary key`)
  }
})

test('the retired report columns are absent — a SELECT * export would copy them out', () => {
  const report = analyticsTable('report')
  assert.ok(report)
  assert.equal(report.columns.includes('title'), false)
  assert.equal(report.columns.includes('contact'), false)
})

test('the frozen counter tables restore into their sharded twins; everything else into itself', () => {
  for (const table of ANALYTICS_TABLES) {
    const target = importTargetOf(table)
    const expected =
      table.name === 'usage_daily'
        ? 'usage_daily_sharded'
        : table.name === 'perf_daily'
          ? 'perf_daily_sharded'
          : table.name
    assert.equal(target.name, expected, table.name)
    assert.ok(target.columns.length > 0)
  }
})

test('the two MERGE VIEWS are not exported — a view holds no rows of its own', () => {
  assert.equal(analyticsTable('usage_daily_all'), null)
  assert.equal(analyticsTable('perf_daily_all'), null)
})

// ---- 2. the bundle refuses by shape ----------------------------------------------------------

const bundleText = (table: string, rows: ExportRow[], part = 0): string =>
  serializeBundle({ table, exportedAt: 1_755_000_000_000, part, rows })

test('a bundle round-trips, and it names its own table rather than trusting a file name', () => {
  const text = bundleText('usage_daily', [{ day: '2026-08-16', cohort: 'user', metric: 'sessions', dim: '-', n: 7 }])
  const { bundle, table } = parseBundle(text)
  assert.equal(table.name, 'usage_daily')
  assert.equal(bundle.rows.length, 1)
  assert.equal(bundle.rows[0].n, 7)
  assert.equal(bundle.exportedAt, 1_755_000_000_000)
})

test('a table the registry does not know, a column it does not have, and a non-object row are all REFUSED', () => {
  assert.throws(() => parseBundle(bundleText('secrets', [])), /not an analytics table/)
  assert.throws(
    () => parseBundle(bundleText('usage_daily', [{ day: '2026-08-16', nope: 1 }])),
    /has no column "nope"/,
  )
  assert.throws(() => parseBundle('{"table":"usage_daily"}'), /has no "rows" array/)
  assert.throws(() => parseBundle('{"table":"usage_daily","rows":[3]}'), /non-object row/)
  assert.throws(() => parseBundle('[]'), /expected a JSON object/)
})

test('the object layout: a single part is the plain name, several grow a partNN', () => {
  assert.equal(exportKey('usage_daily', '2026-08-16', 0, 1), 'exports/usage_daily/2026-08-16.json.gz')
  assert.equal(exportKey('report', '2026-08-16', 0, 3), 'exports/report/2026-08-16.part00.json.gz')
  assert.equal(exportKey('report', '2026-08-16', 11, 12), 'exports/report/2026-08-16.part11.json.gz')
  assert.equal(manifestKey('2026-08-16'), 'exports/_manifest/2026-08-16.json')
})

test('a table past the part threshold is SPLIT, and every row lands in exactly one part', () => {
  const rows: ExportRow[] = []
  for (let i = 0; i < 200; i++) rows.push({ day: '2026-08-16', cohort: 'user', metric: 'm', dim: `d${String(i)}`, n: i })
  // A threshold small enough that 200 short rows have to split several ways.
  const parts = splitParts(rows, 400)
  assert.ok(parts.length > 1, 'it split')
  assert.equal(parts.reduce((sum, p) => sum + p.length, 0), rows.length)
  assert.deepEqual(parts.flat().map((r) => r.dim), rows.map((r) => r.dim))
  // And one pass with a huge threshold is exactly one part — the common case.
  assert.equal(splitParts(rows, 50 * 1024 * 1024).length, 1)
  assert.equal(splitParts([], 1000).length, 1)
})

// ---- 3. the importer, against an in-memory cluster --------------------------------------------

interface Fake {
  clients: Clients
  tables: Map<string, Row[]>
  statements: string[]
}

/** Enough postgres to run the importer's one statement shape, and nothing else. */
function fakeCluster(): Fake {
  const tables = new Map<string, Row[]>()
  const statements: string[] = []
  const run = (sql: string, params: unknown[]): Row[] => {
    const text = sql.replace(/\s+/g, ' ').trim()
    statements.push(text)
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES (.+) ON CONFLICT \(([^)]+)\) DO UPDATE SET (.+)$/.exec(text)
    if (!m) throw new Error(`the fake cluster does not implement: ${text}`)
    const columns = m[2].split(',').map((s) => s.trim())
    const keys = m[4].split(',').map((s) => s.trim())
    const dest = tables.get(m[1]) ?? []
    tables.set(m[1], dest)
    const written: Row[] = []
    for (let i = 0; i < params.length; i += columns.length) {
      const row = Object.fromEntries(columns.map((c, k) => [c, params[i + k]]))
      const same = dest.find((d) => keys.every((c) => d[c] === row[c]))
      // ON CONFLICT DO UPDATE SET <every non-key column> = EXCLUDED.<col> — ASSIGNMENT.
      if (same) Object.assign(same, row)
      else dest.push(row)
      written.push(row)
    }
    return written
  }
  const clients = {
    query: (sql: string, params: unknown[] = []) => Promise.resolve(run(sql, params)),
    execute: (sql: string, params: unknown[] = []) => Promise.resolve(run(sql, params).length),
    s3: {},
    stack: {},
    close: () => Promise.resolve(),
  } as unknown as Clients
  return { clients, tables, statements }
}

/** An export directory on disk, the way `aws s3 cp --recursive` would leave one. */
function exportDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-export-'))
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, name.endsWith('.gz') ? gzipSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8'))
  }
  return dir
}

const counter = (day: string, metric: string, n: number): ExportRow => ({
  day,
  cohort: 'user',
  metric,
  dim: '-',
  n,
})

test('a gzipped directory is read, gunzipped and restored — and the frozen table lands in the sharded twin at shard 0', async () => {
  const dir = exportDir({
    'usage_daily/2026-08-16.json.gz': bundleText('usage_daily', [counter('2026-08-16', 'sessions', 11)]),
    'analytics_install/2026-08-16.json.gz': bundleText('analytics_install', [
      { analytics_id: 'a1', first_seen_day: '2026-08-04', last_seen_day: '2026-08-16', days_seen: 3, app_version: '1.2.0', channel: 'prod', cohort: 'user', quota_day: '2026-08-16', quota_n: 4, machine_class: null, window_mode: null },
    ]),
  })
  const f = fakeCluster()
  const out = await runImport(f.clients, { path: dir, dryRun: false })
  assert.deepEqual(out.map((r) => [r.table, r.rows]), [
    ['analytics_install', 1],
    ['usage_daily_sharded', 1],
  ])
  const sharded = f.tables.get('usage_daily_sharded') ?? []
  assert.equal(sharded.length, 1)
  assert.equal(sharded[0].shard, 0, 'a row with no shard of its own restores under shard 0')
  assert.equal(sharded[0].n, 11)
  // Nothing was written to the frozen table itself: one live table per counter, and the merge
  // view is what makes the move invisible to every reader.
  assert.equal(f.tables.has('usage_daily'), false)
})

test('a FROZEN row and a real shard-0 row for the same counter are SUMMED, never lost', async () => {
  const dir = exportDir({
    'a/usage_daily.json.gz': bundleText('usage_daily', [counter('2026-08-16', 'sessions', 11)]),
    'b/usage_daily_sharded.json.gz': bundleText('usage_daily_sharded', [
      { shard: 0, ...counter('2026-08-16', 'sessions', 8) },
      { shard: 5, ...counter('2026-08-16', 'sessions', 3) },
    ]),
  })
  const f = fakeCluster()
  await runImport(f.clients, { path: dir, dryRun: false })
  const rows = f.tables.get('usage_daily_sharded') ?? []
  // shard 0 is 11 + 8; shard 5 keeps its own shard and its own count. Total through the merge
  // view is 22, which is exactly what the three source rows held.
  const byShard = new Map(rows.map((r) => [r.shard, r.n]))
  assert.deepEqual([...byShard.entries()].sort(), [[0, 19], [5, 3]])
  assert.equal(rows.reduce((sum, r) => sum + Number(r.n), 0), 22)
})

test('running the SAME export in twice converges — fold then ASSIGN, never addition', async () => {
  const dir = exportDir({
    'usage_daily.json.gz': bundleText('usage_daily', [counter('2026-08-16', 'sessions', 11)]),
    'usage_daily_sharded.json.gz': bundleText('usage_daily_sharded', [{ shard: 0, ...counter('2026-08-16', 'sessions', 8) }]),
  })
  const f = fakeCluster()
  await runImport(f.clients, { path: dir, dryRun: false })
  const first = JSON.stringify(f.tables.get('usage_daily_sharded'))
  await runImport(f.clients, { path: dir, dryRun: false })
  assert.equal(JSON.stringify(f.tables.get('usage_daily_sharded')), first, 'a re-run is the same cluster')
})

test('the kill switches come back CLOSED whatever the export held', async () => {
  const dir = exportDir({
    'feedback_config.json': bundleText('feedback_config', [
      { id: 'FEEDBACK', accepting: true, closed_message: 'back soon', max_per_install_per_day: 10, telemetry_accepting: true, max_events_per_id_per_day: 20000 },
    ]),
  })
  const f = fakeCluster()
  await runImport(f.clients, { path: dir, dryRun: false })
  const row = (f.tables.get('feedback_config') ?? [])[0]
  assert.equal(row.accepting, false)
  assert.equal(row.telemetry_accepting, false)
  // Everything else restores faithfully — it is the switches, not the row, that are refused.
  assert.equal(row.closed_message, 'back soon')
  assert.equal(row.max_per_install_per_day, 10)
})

test('--dry-run reads, parses and folds the whole export and writes NOTHING', async () => {
  const dir = exportDir({ 'usage_daily.json.gz': bundleText('usage_daily', [counter('2026-08-16', 'sessions', 11)]) })
  const f = fakeCluster()
  const out = await runImport(f.clients, { path: dir, dryRun: true })
  assert.deepEqual(out.map((r) => [r.table, r.rows]), [['usage_daily_sharded', 1]])
  assert.equal(f.statements.length, 0, 'not one statement reached the cluster')
})

test('a corrupt file fails BEFORE anything is written — a half-restore is a second incident', async () => {
  const dir = exportDir({
    'usage_daily.json.gz': bundleText('usage_daily', [counter('2026-08-16', 'sessions', 11)]),
    'broken.json': '{"table":"usage_daily","rows":[{"nope":1}]}',
  })
  const f = fakeCluster()
  await assert.rejects(() => runImport(f.clients, { path: dir, dryRun: false }), /has no column "nope"/)
  assert.equal(f.statements.length, 0)
})

test('an empty path is refused rather than reported as a successful restore of nothing', async () => {
  const dir = exportDir({ 'readme.txt': 'not an export' })
  const f = fakeCluster()
  await assert.rejects(() => runImport(f.clients, { path: dir, dryRun: false }), /no \.json/)
})

// BOTH MANIFEST SPELLINGS ARE SKIPPED, and this test exists because the first rehearsal run
// against a real cluster and a real bucket died on exactly this: `aws s3 sync` of the nightly
// export brings back `_manifest/<day>.json` beside the thirteen bundles, and a manifest names no
// table, so `parseBundle` refused it and took the whole restore down with it.
test('the walk finds nested files, skips BOTH manifest spellings, and is deterministic', () => {
  const dir = exportDir({
    'usage_daily/2026-08-16.json.gz': bundleText('usage_daily', []),
    'report/2026-08-16.json.gz': bundleText('report', []),
    // The nightly Lambda's index, exactly where `aws s3 sync s3://…/exports/` leaves it.
    '_manifest/2026-08-16.json': '{"day":"2026-08-16","tables":{}}',
    // The operator-side export's index (JOS-399).
    'manifest.json': '{}',
  })
  const found = exportFilesUnder(dir).map((p) => p.replace(dir, '').replace(/\\/g, '/'))
  assert.deepEqual(found, ['/report/2026-08-16.json.gz', '/usage_daily/2026-08-16.json.gz'])
})

// ---- the statement itself ---------------------------------------------------------------------

test('the UPSERT names every column, keys on the primary key, and assigns every non-key column', () => {
  const plans = planImport([{ path: 'x', text: bundleText('error_report', []) }])
  const sql = upsertSql({ ...plans[0], rows: [] }, 2)
  assert.match(sql, /^INSERT INTO error_report \(day, cohort, version, fingerprint, count, exemplar\) /)
  assert.match(sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\), \(\$7, \$8, \$9, \$10, \$11, \$12\)/)
  assert.match(sql, /ON CONFLICT \(day, cohort, version, fingerprint\) DO UPDATE SET count = EXCLUDED\.count, exemplar = EXCLUDED\.exemplar$/)
})

test('a table bigger than one chunk is written in bounded statements — DSQL caps a txn at 3,000 rows', async () => {
  const rows: ExportRow[] = []
  for (let i = 0; i < IMPORT_CHUNK * 2 + 7; i++) rows.push(counter('2026-08-16', `m${String(i).padStart(4, '0')}`, i))
  const dir = exportDir({ 'usage_daily.json.gz': bundleText('usage_daily', rows) })
  const f = fakeCluster()
  const out = await runImport(f.clients, { path: dir, dryRun: false })
  assert.equal(out[0].rows, rows.length)
  assert.equal(f.statements.length, 3, 'ceil(207 / 100) statements')
  assert.equal((f.tables.get('usage_daily_sharded') ?? []).length, rows.length)
})
