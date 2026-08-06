// One-off PET-CLAIM fixture extractor (JOS-47) — the unbound pet, the public lines it speaks,
// and the damage the meter throws away because nothing in the log says whose it is.
//
//   npm run fixtures:pet-claim -- "<path-to-eqlog>"
//
// (Run it under the tsx loader like its siblings — tests/fixture-scrub.mjs is a shim over the
// TypeScript src/shared/logScrub.ts. The npm script already does.)
//
// SCRUB: routed through the SHARED scrub, like every extractor. THIS FAMILY IS THE SECOND
// REASON THE SCRUB CHANGED (the group extractor's header records the first). The six pet-voiced
// SAY sentences carry the quoted-speech comma-quote, so until JOS-47 they were dropped from
// every committed fixture and every feedback slice — and they are the only public evidence that
// an entity is somebody's pet. They are an NPC's words and an NPC's name, so the carve-out costs
// no one their privacy; see src/shared/logScrub.ts for the enumeration that made it exact.
//
// WHAT IS KEPT INSIDE A WINDOW: everything the scrub allows, verbatim and contiguous. The
// candidate detector reasons about SHARED TARGETS over time, so a window filtered down to "just
// the pet lines" would prove nothing at all.
//
// Line numbers below were located in eqlog_Primitive_freeport.txt on 2026-08-06. The log only
// ever APPENDS, so historical line numbers stay valid as it grows; re-locate if it is truncated
// or rotated.
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { scrubKeep } from './fixture-scrub.mjs'

// Fixtures resolve RELATIVE to this file — never hardcode a repo path here.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const LOG = process.argv[2]
if (!LOG) throw new Error('usage: npm run fixtures:pet-claim -- "<path-to-eqlog>"')
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

/** A scrub-surviving, timestamped log line. Self is 'Primitive' — the owner's own /who row. */
function keep(line) {
  return line.startsWith('[') && scrubKeep(line, { selfName: 'Primitive' })
}

/** Write one fixture from a 1-based inclusive line RANGE. */
function slice(from, to, out) {
  const seg = []
  for (let i = from - 1; i < to && i < lines.length; i++) {
    if (keep(lines[i])) seg.push(lines[i])
  }
  writeFileSync(join(FIXTURES, out), seg.join('\n') + '\n')
  console.log(`${out}: ${seg.length} lines`)
  return seg
}

// P1 — THE UNBOUND PET, TWENTY MINUTES OF IT (Thu Jul 30 16:10–16:30, Solusek's Eye).
//
// The owner's ENCHANTER animation pet, summoned by `Yegoreff's Animation`. It is called Kober,
// and the app has never once been able to see it, because:
//   * it is not charmed, so there is no `has been charmed.` broadcast to bind it;
//   * the owner never ORDERS it, so it never sends the private `… Master.'` tell that is the
//     only signal a summoned pet's binding has ever had.
// It says `Sorry, Master... calming down.` twice, `Now regrouping, master.` once and
// `As you wish, oh great one.` once — all PUBLIC, all worthless as proof of ownership on their
// own, and until this extractor all four were scrubbed out of every fixture in the repo.
//
// Meanwhile it lands 105 hits for 1,966 points across four mobs, THREE of which the owner is
// hitting too (a noxious spider, a sonic bat, a fire giant warrior). Every one of those hits is
// dropped by classify()'s admission gate. This window is the reporter's bug reproduced in the
// owner's own log, which is the whole reason it is the fixture.
//
// It also carries its own NEGATIVE CONTROL: `Guard Effel` is proper-named, fights the same
// mobs, and is a HOSTILE — it swings at the owner. Nothing may ever offer it as a pet.
const p1 = slice(491470, 493040, 'p1-unbound-pet.log')

// The extractor asserts what it believes rather than writing a hollowed-out fixture (the
// session extractor's rule). If the scrub's DROP list ever grows back over the pet-say family,
// this fails loudly here instead of silently turning the golden window into a mute one.
const counted = (re) => p1.filter((l) => re.test(l)).length
const expected = [
  [/^\[.*\] Kober says, 'Sorry, Master\.\.\. calming down\.'$/, 2],
  [/^\[.*\] Kober says, 'Now regrouping, master\.'$/, 1],
  [/^\[.*\] Kober says, 'As you wish, oh great one\.'$/, 1]
]
for (const [re, n] of expected) {
  const got = counted(re)
  if (got !== n) throw new Error(`p1-unbound-pet.log: expected ${n} line(s) matching ${re}, got ${got}`)
}
// …and the two things the window must NOT contain, because their absence is the bug.
for (const [re, what] of [
  [/^\[.*\] Kober told you, /, 'a private pet tell'],
  [/^\[.*\] Kober has been charmed\.$/, 'a charm broadcast']
]) {
  if (counted(re) !== 0) throw new Error(`p1-unbound-pet.log: ${what} for Kober would defeat the fixture`)
}
const koberHits = p1.filter((l) => /\] Kober [a-z]+ .* for \d+ points? of damage\.$/.test(l)).length
if (koberHits < 90) throw new Error(`p1-unbound-pet.log: expected the pet's combat lines to survive, got ${koberHits}`)
const guardHits = p1.filter((l) => /\] Guard Effel /.test(l)).length
if (guardHits < 10) throw new Error(`p1-unbound-pet.log: the negative control (Guard Effel) must be present`)
console.log(`p1-unbound-pet.log: 4 pet says, ${koberHits} unbound pet hits, ${guardHits} negative-control lines`)
