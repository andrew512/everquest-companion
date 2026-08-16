// Cut the committed fixtures for the resist fold (JOS-382).
//
// Run: `npm run fixtures:resist -- <path to the live log>`
//
// Every line goes through the shared scrub (`scrubKeep`), like every other extractor in this
// directory: the repo is public, and the scrub DROPS third-party chat rather than rewriting it —
// a rewritten line still parses into a fake event and would pollute the golden expectation.
//
// ── r1-kodiak-fight.log ─────────────────────────────────────────────────────────────────────────
//
// Hand-read window, West Commonlands, Tue Jul 28 2026 16:42:13 to 16:45:56. It was chosen because
// one pull contains every shape the fold has to get right, and it contains them about a mob whose
// name has an ARTICLE:
//
//   * the zone line that opens it, so the fold has a zone to file rows under;
//   * `You begin casting Languid Pace.` joined to `a kodiak slows down.` — an all-or-nothing
//     landing earned by a cast-to-emote join, the only way one is ever earned;
//   * `You hit a kodiak for 30 points of magic damage by Chaotic Feedback.` repeatedly at the SAME
//     value, which is what a fixed-damage nuke landing in full looks like and what the estimator
//     later reads partials against;
//   * `You crush a kodiak for 35 points of damage. (Critical)` — a crit, which is a LANDING and
//     must never enter the damage histogram (its number is not the spell's full damage);
//   * `You hit a kodiak for 28 points of magic damage by Smiting Strike.` — the -250 proc, whose
//     resist adjust is the whole argument for modelling adjusts at all;
//   * `A kodiak resisted your Chaotic Feedback!` and `A young kodiak resisted your Chaotic
//     Feedback!` — note the CAPITALISED article, where every damage line above spells it
//     lowercase. Both fold to one key or the whole feature counts one mob as two;
//   * `Your Chaotic Feedback spell fizzles!` — a cast that never happened, and must file nothing;
//   * melee both ways, which is what puts a mob "in contact" for a song pulse;
//   * two kills, so the debuff windows and the contact set have something to close on;
//   * a `/con` line, which is how a mob's level beats the catalog's.
//
// NOTHING IS INJECTED AND NOTHING IS AUTHORED. These are the owner's real bytes.

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { scrubKeep } from './fixture-scrub.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG =
  process.argv[2] ??
  'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/Logs/eqlog_Primitive_freeport.txt'
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

function slice(fromLine, toLine, out) {
  const seg = []
  for (let i = fromLine - 1; i < toLine && i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('[')) continue
    if (!scrubKeep(l)) continue
    seg.push(l)
  }
  writeFileSync(join(HERE, 'fixtures', out), seg.join('\n') + '\n')
  console.log(`${out}: ${seg.length} lines (from raw ${toLine - fromLine + 1})`)
}

slice(213496, 213730, 'r1-kodiak-fight.log')
