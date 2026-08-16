// Generate the COMMITTED resist baseline (JOS-382).
//
// Replays one or more real logs through the parser and `ResistFold` — the SAME class the running
// app folds a user's log with, so what ships and what a player mines cannot drift — and writes the
// pooled observations to `src/main/data/resistBaseline.json`.
//
// WHY A BASELINE SHIPS AT ALL. The engine needs observations before it can say anything, and a
// fresh install has none: the mob page would be five "not enough data" rows for weeks. One
// player's four weeks in this log is ~50k attributable outcomes across 865 (mob, axis) cells,
// which is enough to answer "should I nuke fire or cold on a lava guardian" on day one.
//
// WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT. Observations only — mob names, spell names and
// counts. No character names, no zones' chat, no verdicts. It records what the log printed and
// nothing this app concluded from it, exactly as `messageOverlay.baseline.json` does, because a
// stored conclusion is a second opinion waiting to disagree with the derived one and because a
// patch that retunes a spell must cost a re-estimate rather than a re-mine.
//
// AND NOTHING DERIVED FROM `spells_us.txt` IS IN IT. The fold never reads the client file, so this
// artifact is table-independent: it is the player's own log, not Daybreak's data.
//
// Run: `npm run gen:resist-baseline` (dev machine only; the log is never committed).
// Optionally pass log paths: `npm run gen:resist-baseline -- <path> [<path>...]`.

import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseEvent } from '../src/main/log/parser'
import { installCharacterName, installSpellDb } from '../src/main/log/rulesets'
import { loadSpellDb } from '../src/main/data/spellDb'
import { ResistFold } from '../src/main/resist/fold'
import { rowTotal } from '../src/main/resist/ledger'
import { BASELINE_SOURCE_KEY, type ResistLedger, type ResistRow } from '../src/shared/resistTypes'

const DEFAULT_LOG =
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/Logs/eqlog_Primitive_freeport.txt'
const DEFAULT_SPELLS_US =
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/spells_us.txt'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'src', 'main', 'data', 'resistBaseline.json')

/**
 * A row has to carry this many observations to ship. Below it the estimator's prior dominates
 * anyway, so the row costs bytes and says nothing — and the user's own log will overwrite the
 * cell within an evening of play.
 */
const MIN_ROW_OBSERVATIONS = Number(process.env.EQ_RESIST_MIN_ROW ?? '5')

/**
 * PINNED, not `new Date()`. A re-run on an unchanged log must diff to nothing, so the only thing
 * in this file that is allowed to move is an observation (the same rule
 * `gen-message-overlay.ts` follows, and the one `tests/foldDeterminism.test.mts` exists to keep).
 */
const FROZEN_AT = '2026-08-16T00:00:00.000Z'

async function foldLog(fold: ResistFold, path: string): Promise<number> {
  let seq = 0
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    const ev = parseEvent(line, seq++)
    if (ev) fold.onEvent(ev)
  }
  return seq
}

function spellsUsMtime(): number | null {
  try {
    return Math.round(statSync(process.env.EQ_SPELLS_US ?? DEFAULT_SPELLS_US).mtimeMs)
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const logs = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const paths = logs.length > 0 ? logs : [DEFAULT_LOG]

  installSpellDb(loadSpellDb())
  // The self `/who` row is keyed on the tailed character's name; without it a level is never read
  // off one, and every early observation would carry a null caster level.
  installCharacterName('Primitive')

  const fold = new ResistFold({ spellDb: loadSpellDb() })
  const kept: ResistRow[] = []
  let lines = 0
  for (const path of paths) {
    fold.beginSource()
    lines += await foldLog(fold, path)
    fold.finish()
    for (const row of fold.rows()) {
      if (rowTotal(row) >= MIN_ROW_OBSERVATIONS) kept.push(row)
    }
  }

  // ZONES AND TIMESTAMPS ARE DROPPED. A baseline row states what a mob does; which zone this
  // player fought it in and at what hour on what evening are his itinerary, not facts about the
  // creature, and nothing downstream reads either. Same argument as the message overlay's
  // "no chat, no character name": the file records observations, and an observation is a count.
  const rows = kept
    .map(({ zone: _zone, source: _source, ...row }) => ({ ...row, firstTs: 0, lastTs: 0 }))
    .sort((a, b) =>
      a.mobKey === b.mobKey
        ? a.spellKey === b.spellKey
          ? a.family.localeCompare(b.family)
          : a.spellKey.localeCompare(b.spellKey)
        : a.mobKey.localeCompare(b.mobKey)
    )

  const mtime = spellsUsMtime()
  const ledger: ResistLedger = {
    schema: 1,
    frozenAt: FROZEN_AT,
    ...(mtime === null ? {} : { spellsUsMtime: mtime }),
    sources: [{ key: BASELINE_SOURCE_KEY, rows }],
  }
  const json = JSON.stringify(ledger) + '\n'
  writeFileSync(OUT, json, 'utf8')

  const mobs = new Set(rows.map((r) => r.mobKey)).size
  const observations = rows.reduce((a, r) => a + rowTotal(r), 0)
  console.log(
    `[gen-resist-baseline] ${String(lines)} lines -> ${String(rows.length)} rows ` +
      `(>= ${String(MIN_ROW_OBSERVATIONS)} observations each), ${String(mobs)} mobs, ` +
      `${String(observations)} observations, ${(json.length / 1024).toFixed(0)} kB -> ${OUT}`
  )
}

void main()
