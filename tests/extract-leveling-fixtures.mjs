// Leveling fixture extractor (loadout-swap golden window). Slices the real log and keeps
// every line the LevelingModule consumes (level-ups, AA gains, AA purchases) plus the
// self `/who` line — which is the ONLY place the log ever states the class loadout, and
// which proves the level is a SINGLE number shared by three classes
// (`[50 PAL/MNK/ENC] Primitive (Dark Elf)`), not three concurrent levels.
//
// Usage: node tests/extract-leveling-fixtures.mjs "<path to eqlog_Primitive_freeport.txt>"
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { scrubKeep } from './fixture-scrub.mjs'

// Fixtures resolve RELATIVE to this file — the repo moved once and these extractors kept
// writing into the old absolute path. Never hardcode a repo path here again.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const LOG = process.argv[2]
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

const KEEP = [
  /You have gained a level! Welcome to level \d+!$/,
  // BOTH gain shapes. `gained \d+` alone misses the singular "You have gained an ability
  // point!", which is exactly the line that proves a potion ran out — every gain outside a
  // bottle's five is singular on this character, so dropping it would hide the reversion the
  // AA-potion window exists to pin.
  /You have gained (?:an|\d+) ability point/,
  /You have gained the ability "/,
  /You have improved .+ \d+ at a cost of/,
  // The item-shop AA potion quaff. The only line the log ever prints about the bottle.
  /You are filled with the spirit of alternate adventure\.$/,
  // self /who — documentary evidence of the one-level / three-class loadout
  /^\[[^\]]+\] \[\d+ [A-Z]{3}(?:\/[A-Z]{3})*\] Primitive /
]
// Routed through the SHARED scrub (tests/fixture-scrub.mjs) like every other extractor. The
// self `/who` row survives because the scrub exempts the user's OWN character by name; every
// other player's `/who` row is dropped there, not here.
const keep = (l) => l.startsWith('[') && scrubKeep(l) && KEEP.some((re) => re.test(l))

function slice(fromLine, toLine, out) {
  const seg = []
  for (let i = fromLine - 1; i < toLine && i < lines.length; i++) if (keep(lines[i])) seg.push(lines[i])
  writeFileSync(join(FIXTURES, out), seg.join('\n') + '\n')
  console.log(`${out}: ${seg.length} lines (from raw ${toLine - fromLine + 1})`)
}

// WL1 LOADOUT SWAP. Real span 669590 (Fri Jul 31 16:19:04, "Welcome to level 50!") ..
// 975780 (Sun Aug 02 02:26:50, "Welcome to level 13!"). Between them the user swapped a
// class into the loadout: the reported level fell 50 → 10 with NO log line of any kind
// (verified: every "loadout"/"swap"/"class" string in the whole 985k-line log is another
// player's chat), and the next thing the log says is "Welcome to level 11!". The window
// also carries the Jul 31 23:48 self /who at `[50 PAL/MNK/ENC]` — pre-swap loadout, one
// level for three classes.
slice(669590, 975780, 'wl1-loadout-swap.log')

// WL2 AA POTION. Real span 178200 (Tue Jul 28 13:55, the last SINGLE-point gain before the
// character's first Bottle of Alternate Adventure) .. 237000 (Tue Jul 28 19:35). It carries
// two full bottles end to end and the reversion between them, which is the whole model in one
// window:
//   13:55:42  gained an ability point        ← no bottle: 1 point
//   13:56:10  filled with the spirit …       ← quaff #1
//   14:22 … 15:41  five gains, 2 points each ← the five charges, as the game printed them
//   16:28:03  filled with the spirit …       ← quaff #2 (the first bottle paid nothing more)
//   16:32 … 19:06  five gains, 2 points each
//   19:34:48  gained an ability point        ← spent: back to 1 point, with no line saying so
// The whole-log sweep behind AA_POTION_CHARGES generalises this: 32 quaffs, 32 runs of exactly
// five doubled gains, zero exceptions.
slice(178200, 237000, 'wl2-aa-potion.log')
