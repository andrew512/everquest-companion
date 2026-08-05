// ROGUE-SLOW ALERT golden-window fixture extractor (per-target cooldowns, 2026-08-04).
//
// Same law as tests/extract-proc-fixtures.mjs: the window is kept VERBATIM and only what the
// shared scrub (tests/fixture-scrub.mjs `scrubKeep`) classifies as third-party chat/social is
// dropped. NEVER hand-copy a span into fixtures/ and never re-implement the drop list:
// `tests/fixtures/*.log` is COMMITTED to a PUBLIC repo.
//
// Usage: npm run fixtures:poison-slow -- "<path to eqlog_Primitive_freeport.txt>"
//    or: node --import tsx tests/extract-poison-slow-fixtures.mjs "<path>"
//
// Line numbers are against the LIVE log (1,330,626 lines as of Tue Aug 04 2026 22:4x). The log
// only ever grows by APPENDING, so a span's raw range stays valid; the timestamps in the header
// below are the real anchor if a number ever looks wrong.
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { scrubKeep } from './fixture-scrub.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = process.argv[2]
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

// ---------------------------------------------------------------------------------------
// W44 THE SLOW THAT NEVER SPOKE (Tue Aug 04 22:30:45 → 22:33:45, raw 1328240..1330570).
//
// The owner's incident, cut whole. A Nagafen's Lair fight that starts on King Tranix, takes a
// fire giant warrior as an add, and ends with the player dead. Both rogue slow Strikes are
// landing throughout — one utility coat grants both (Paralytic Poison → Weakening Strike +
// Clumsiness Strike) — so this one window carries every case the alert has to get right.
//
// THE SLOW-FAMILY LANDINGS, hand-read (`slow` = Weakening, `spellSlow` = Clumsiness):
//   22:30:52  King Tranix's fingers slow down.            spellSlow
//   22:30:55  King Tranix's fingers slow down.            spellSlow
//   22:31:16  King Tranix's limbs move slower!            slow
//   22:31:38  a fire giant warrior's fingers slow down.   spellSlow   ← the add arrives
//   22:31:43  a fire giant warrior's limbs move slower!   slow        ← THE SUPPRESSED ONE
//   22:31:50  a fire giant warrior's limbs move slower!   slow
//   22:31:58  a fire giant warrior's limbs move slower!   slow
//   22:32:35  King Tranix's limbs move slower!            slow
//   22:32:41  King Tranix's limbs move slower!            slow
//   22:32:45  King Tranix's limbs move slower!            slow
//   22:32:51  King Tranix's fingers slow down.            spellSlow
//   22:32:56  King Tranix's limbs move slower!            slow
//   22:33:11  King Tranix's fingers slow down.            spellSlow
//   22:33:31  King Tranix's limbs move slower!            slow
//   22:33:35  King Tranix's fingers slow down.            spellSlow
//   22:33:37  King Tranix's limbs move slower!            slow
//   22:33:40  You have been slain by a fire giant warrior!
//
// WHY 22:31:43 IS THE WHOLE POINT. Under the shipped def's 30 s cooldown measured once for the
// WHOLE alert, 22:31:16 fires and 22:31:43 is 27 s later — suppressed. The add's slow, the one
// landing that says something new, is the one the alert swallows; the next thing it does say is
// a re-land on a mob already slowed. Two minutes later the player is dead.
//
// The window deliberately opens 31 s BEFORE the first slow (on `You try to frenzy on King
// Tranix, but miss!` at 22:30:45) so the fight is already running when the first landing
// arrives, and closes 5 s after the death — before the 22:33:49 zone-out, so no zone boundary
// muddies the replay.
slice(1328240, 1330570, 'w44-poison-slow-per-mob.log')
