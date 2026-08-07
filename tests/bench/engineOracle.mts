/**
 * ============================================================================
 * engineOracle.mts — THE COMBAT ENGINE'S LAW-8 TRIPWIRE, as a diffable file (JOS-59).
 * ============================================================================
 *
 * `npm run bench:engine-oracle` (optionally with log paths as arguments; with none it does every
 * committed fixture plus this machine's own EQ log). It writes ONE text file to stdout — nothing
 * is asserted here, because the assertion is `diff before after` and a human reading a zero-line
 * diff is the whole gate.
 *
 * WHY IT EXISTS. AGENTS.md world-model law 8 says a model refactor proves the untouched
 * dimensions BYTE-IDENTICAL: baseline the damage totals before, diff after, they must match
 * exactly. JOS-58 could do that with a sha256 over the whole EVENT STREAM, because the parser's
 * output IS a stream. The combat engine's output is not — it is a SNAPSHOT, assembled on demand.
 * So the strongest available pin is the snapshot itself, taken at a fixed instant, for every
 * selectable scope the engine offers:
 *
 *   - every ZONE SESSION (the live one and each finalized one), which is where "per zone session,
 *     per source" damage actually lives;
 *   - every FINALIZED FIGHT and the open one, via the same `selectedId` door the UI uses;
 *   - and the whole snapshot, timeline included, hashed.
 *
 * Reading them through `snapshot({selectedId})` rather than reaching into `EngineState` is
 * deliberate: that is the surface the app serializes to the renderer, so a change that moved a
 * number the UI shows cannot hide behind an internal field that happened not to move.
 *
 * THE INSTANT IS THE LAST EVENT'S TIMESTAMP, never `Date.now()`. Encounters close on elapsed
 * time, so a wall-clock instant would make the file depend on when it was generated. The log's
 * own last timestamp is a property of the input.
 *
 * THE OWNER'S LIVE LOG GROWS, so its rows are only comparable between two runs taken close
 * together — the header line records the byte size for exactly that reason. The committed
 * fixtures are frozen and are the part of this file that can be diffed across days.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ROOT } from '../e2e/build.mjs'
import { foldForOracle } from './foldArm.mjs'
import { discoverEqRoot, fixedDrives, registryInstallCandidates, rootHasLogs } from '../../src/main/log/discovery'
import type { CombatEngine } from '../../src/main/combat/engine'
import type { SourceView } from '../../src/shared/combat'

/** Every committed fixture, in name order — the frozen half of the corpus. */
function fixtureLogs(): string[] {
  const dir = join(ROOT, 'tests', 'fixtures')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .sort()
    .map((f) => join(dir, f))
}

/** This machine's own EQ log, discovered exactly as the app discovers it. */
function machineLog(): string | undefined {
  const root = discoverEqRoot({
    hasLogs: rootHasLogs,
    extraCandidates: () => registryInstallCandidates(),
    fixedDrives
  })
  if (!root) return undefined
  const logs = join(root, 'Logs')
  if (!existsSync(logs)) return undefined
  const files = readdirSync(logs)
    .filter((f) => /^eqlog_.+\.txt$/i.test(f))
    .map((f) => join(logs, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files[0]?.p
}

/** One source row, rendered to the fields that carry a NUMBER somebody could have moved. */
function sourceLine(r: SourceView): string {
  return (
    `    ${r.id} | ${r.kind} | ${r.name} | total ${String(r.total)} | hits ${String(r.hits)} | ` +
    `crits ${String(r.crits)} | misses ${String(r.misses)} | resists ${String(r.resists)} | ` +
    `amb ${String(r.ambiguousHits)}/${String(r.ambiguousTotal)}`
  )
}

/**
 * How many fights get a full PER-SOURCE breakdown. Every fight is pinned by its summary line
 * regardless (total / duration / active time / enemy healing, which is where a moved point of
 * damage would show); the drill-down is capped because the owner's log finalizes thousands of
 * them and each one costs its own `snapshot()` view build. The ZONE SESSIONS — which the ticket
 * names explicitly, and which every fight rolls up into — are never capped.
 */
const FIGHT_DETAIL = 25

/** The per-source drill for one selectable scope, as the UI would resolve it. */
function drill(combat: CombatEngine, id: string, now: number): string[] {
  const snap = combat.snapshot(now, { selectedId: id, maxSegments: 1 })
  const out: string[] = []
  for (const r of snap.selected?.entities ?? []) out.push(sourceLine(r))
  for (const r of snap.selected?.incoming ?? []) out.push(sourceLine(r))
  return out
}

/** Every scope the engine can be asked for, each with its per-source damage. */
function scopes(combat: CombatEngine, now: number): string[] {
  const out: string[] = []
  const base = combat.snapshot(now, { maxSegments: 100_000 })
  for (const zs of base.zoneSessions) {
    out.push(
      `  zoneSession ${zs.id} | ${zs.zone} | total ${String(zs.total)} | ` +
        `start ${String(zs.startTs)} | end ${String(zs.endTs)}`
    )
    out.push(...drill(combat, zs.id, now))
  }
  let detailed = 0
  for (const seg of base.segments) {
    if (seg.kind === 'zone') continue
    out.push(
      `  fight ${seg.id} | ${seg.name} | zone ${seg.zone ?? '-'} | total ${String(seg.total)} | ` +
        `dur ${seg.durationSec.toFixed(3)} | active ${seg.activeSec.toFixed(3)} | ` +
        `enemyHeal ${String(seg.enemyHealTotal)}`
    )
    if (detailed >= FIGHT_DETAIL) continue
    detailed += 1
    out.push(...drill(combat, seg.id, now))
  }
  return out
}

/** The whole snapshot, timeline included, as one hash — the JOS-58 pattern applied to the one
 *  artifact the engine actually produces. */
function snapshotHash(combat: CombatEngine, now: number): string {
  const full = combat.snapshot(now, { maxSegments: 100_000, timeline: true, showUnparsed: true })
  return createHash('sha256').update(JSON.stringify(full)).digest('hex')
}

async function one(logPath: string): Promise<void> {
  const m = /^eqlog_(.+)_([^_]+)\.txt$/i.exec(basename(logPath))
  const character = {
    // Every committed fixture is a slice of the owner's own log, so the self-`/who` rule and the
    // pet-leader carve-out need the same name the app would install.
    name: m?.[1] ?? 'Primitive',
    server: m?.[2] ?? 'freeport',
    logPath
  }
  const { combat, events, lastTs } = await foldForOracle(character)
  const now = lastTs > 0 ? lastTs : 0
  console.log(`== ${basename(logPath)} | ${String(statSync(logPath).size)} bytes | ${String(events)} events | now ${String(now)}`)
  for (const line of scopes(combat, now)) console.log(line)
  console.log(`  snapshot sha256 ${snapshotHash(combat, now)}`)
}

async function main(): Promise<void> {
  const given = process.argv.slice(2)
  const logs = given.length > 0 ? given : [...fixtureLogs(), ...(machineLog() ? [machineLog() as string] : [])]
  for (const log of logs) await one(log)
}

main().catch((err: unknown) => {
  console.error('engineOracle:', err)
  process.exitCode = 1
})
