// BOSS TIER-RUN golden-window fixture extractor (the Lord of Ire misattribution, 2026-08-04).
//
// Cuts VERBATIM spans of the real log (only third-party chat/social dropped, via the shared
// scrub tests/fixture-scrub.mjs — never a hand-copied or rewritten line) into
// tests/fixtures/. Fixtures are COMMITTED and CI runs them, so this must be DETERMINISTIC:
// re-running it against the same log rewrites every file byte-identically.
//
// Usage: node tests/extract-boss-tier-fixtures.mjs "<path to eqlog_Primitive_freeport.txt>"
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { scrubKeep } from './fixture-scrub.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = process.argv[2]
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

/** Collect a raw 1-based inclusive line range, scrubbed. */
function span(fromLine, toLine) {
  const seg = []
  for (let i = fromLine - 1; i < toLine && i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('[')) continue
    if (!scrubKeep(l)) continue
    seg.push(l)
  }
  return seg
}

/** Write one fixture from one or more raw spans (concatenated in the order given). */
function slice(out, ...ranges) {
  const seg = ranges.flatMap(([from, to]) => span(from, to))
  writeFileSync(join(HERE, 'fixtures', out), seg.join('\n') + '\n')
  const raw = ranges.reduce((n, [from, to]) => n + (to - from + 1), 0)
  console.log(`${out}: ${seg.length} lines (from raw ${raw})`)
}

// THE MISATTRIBUTION, cut from the two real kills that produced it. One mob, two instance
// tiers, two days apart, with a class-loadout swap in between (Sun Aug 02 01:57:42) — so the
// two kills belong to two DIFFERENT combo intervals and the roster used to file the higher
// tier under the later loadout.
//
// Four spans, in log order (each zone line is the nearest preceding `You have entered` for the
// kill that follows it — verified: nothing re-zones in between, which is why the fixture can
// skip the ~12k intervening lines and still state the truth):
//   1. Sat Aug 01 15:33:26, raw 853620 — `You have entered The Plane of Hate - Solo 4
//      (Refined).` The `- Solo N` is stripped as noise and `(Refined)` reads as tier 4.
//   2. Sat Aug 01 16:09:29, raw 865678..865690 — `You have slain Lord of Ire!` at d4, with its
//      exp line, its corpse loot and the con of Innoruuk`s Chosen riding along.
//   3. Mon Aug 03 22:45:48, raw 1205559 — `You have entered The Plane of Hate.` No suffix, so
//      the same zone at BASE tier (0).
//   4. Mon Aug 03 23:02:44, raw 1211528..1211542 — `You have slain Lord of Ire!` at d0.
//
// Expected fold: ONE KillMap entry, count 2, tiers { 4: {1 kill, Aug 01 16:09:29}, 0: {1 kill,
// Aug 03 23:02:44} } — two runs whose timestamps and tiers stay attached to each other.
slice(
  'bosstier-lord-of-ire.log',
  [853620, 853620],
  [865678, 865690],
  [1205559, 1205559],
  [1211528, 1211542]
)

// THE TOAST THAT ANNOUNCED THE WRONG TIER (JOS-165, owner 2026-08-09). Same mob, three tiers,
// nine days: the ladder the owner actually climbs. He clears d0 through d4 every week, so his
// LAST kill of a target is routinely at a LOWER tier than his best — and the celebration toast
// was built from `bestTier`, the all-time maximum, so a Sunday d1 kill kept announcing itself as
// the d4 he beat on the first Saturday.
//
// Six spans, in log order (each zone line is the nearest preceding `You have entered` for the
// kill that follows it — verified against the full log: nothing re-zones in between, which is
// what lets the fixture skip the ~7k intervening lines and still state the truth):
//   1. Sat Aug 01 14:35:15, raw 839935 — `You have entered The Plane of Hate - Solo 3 (Fused).`
//   2. Sat Aug 01 14:56:20, raw 847286..847293 — the d3 kill. The killing blow is the charmed
//      pet`s (`Maestro of Rancor has been slain by Innoruuk\`s Chosen!`), which is still YOUR
//      kill: the `You gain experience!` line four lines above it is the credit join.
//   3. Sat Aug 01 15:33:26, raw 853620 — `... - Solo 4 (Refined).`
//   4. Sat Aug 01 16:02:37, raw 863975..863982 — the d4 kill, `You have slain Maestro of
//      Rancor!`, with its own exp line. This is the kill that poisoned every later toast.
//   5. Sun Aug 09 17:18:56, raw 1485672 — `... - Solo 1 (Awakened).`
//   6. Sun Aug 09 17:29:39, raw 1489474..1489479 — THE INCIDENT: the d1 kill that toasted
//      "D4 · Refined · Plane of Hate".
//
// Expected fold: ONE KillMap entry, count 3, credited 3, tiers { 3, 4, 1 } — and three
// celebrations whose tiers are 3, then 4, then 1, against a `bestTier` that is 4 from the
// second kill onward.
slice(
  'bosstier-maestro-ladder.log',
  [839935, 839935],
  [847286, 847293],
  [853620, 853620],
  [863975, 863982],
  [1485672, 1485672],
  [1489474, 1489479]
)
