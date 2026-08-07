// One-off GROUP fixture extractor — the membership frame (join / leave / leader / self-join /
// self-removed) and the member damage that hangs off it. Sibling of extract-session-fixtures.mjs.
//
//   npm run fixtures:group -- "<path-to-eqlog>"
//
// (Run it under the tsx loader like its siblings — tests/fixture-scrub.mjs is a shim over the
// TypeScript src/shared/logScrub.ts. The npm script already does.)
//
// SCRUB: routed through the SHARED scrub, like every extractor. THIS FAMILY IS THE REASON THE
// SCRUB CHANGED. Until JOS-15 the drop list had a GROUP MEMBERSHIP family and these lines were
// deleted from every committed fixture and every feedback slice, which is exactly why the
// combat report that started this feature arrived with no way to tell who the reporter was
// grouped with. They are structural facts about the fight, not communications; group CHAT is
// still dropped by the quoted-speech rule, so the words never leave the machine.
//
// CONSEQUENCE, stated so the next reader is not surprised: the `confirm` shape
// (`<Name> tells the group, '…'`) CANNOT appear in this or any other committed fixture — it is
// a chat line. Its coverage is tests/groupShapes.test.mts, from synthetic lines written against
// the 30 real occurrences measured in the full log.
//
// WHAT IS KEPT INSIDE A WINDOW: everything the scrub allows, verbatim and contiguous — the
// same rule the session extractor documents, and for the same reason. The roster model reads
// timestamps (staleness, the epoch boundary) and the meter reads the damage between the group
// lines, so a window filtered down to "just the group lines" would prove nothing about either.
//
// Line numbers below were located in eqlog_Primitive_freeport.txt on 2026-08-05. The log only
// ever APPENDS, so historical line numbers stay valid as it grows; re-locate if it is truncated
// or rotated.
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { scrubKeep } from './fixture-scrub.mjs'

// Fixtures resolve RELATIVE to this file — never hardcode a repo path here.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const LOG = process.argv[2]
if (!LOG) throw new Error('usage: npm run fixtures:group -- "<path-to-eqlog>"')
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

/** A scrub-surviving, timestamped log line. */
function keep(line) {
  return line.startsWith('[') && scrubKeep(line)
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

// G1 THE WHOLE GROUP LIFECYCLE IN NINETY SECONDS (Wed Jul 29 01:21–01:25, The Ruins of Old
// Guk). Chosen over the three far longer Dranix sessions precisely because it is complete and
// hand-readable: the invite at 01:21:13, `You have joined the group.` + `You are now the
// leader of your group.` at 01:23:39, `Rykkerr has joined the group.` in the same second, 90
// seconds of a real four-way ghoul fight in which Rykkerr lands 37 hits for 1,423 damage
// against the player's own 3,958, then `Rykkerr is now the leader of your group.` and
// `You have been removed from the group.` at 01:25:10.
//
// That member damage is the entire bug this feature exists to fix: every one of those 37 hits
// parses perfectly and every one of them was thrown away by classify()'s admission gate
// (docs/plans/group-model.md §3.5). The fixture is therefore both halves of the proof — the
// roster the model must build, and the damage the meter must show once it has one.
const g1 = slice(314222, 315495, 'g1-group-lifecycle.log')

// The extractor asserts what it believes rather than writing a hollowed-out fixture (the
// session extractor's rule). If the scrub's DROP list ever grows back over this family, this
// fails loudly here instead of silently turning the golden window into a solo log.
const counted = (re) => g1.filter((l) => re.test(l)).length
const expected = [
  [/You invite Rykkerr to join your group\.$/, 1],
  [/^\[.*\] You have joined the group\.$/, 1],
  [/^\[.*\] You are now the leader of your group\.$/, 1],
  [/^\[.*\] Rykkerr has joined the group\.$/, 1],
  [/^\[.*\] Rykkerr is now the leader of your group\.$/, 1],
  [/^\[.*\] You have been removed from the group\.$/, 1]
]
for (const [re, n] of expected) {
  const got = counted(re)
  if (got !== n) throw new Error(`g1-group-lifecycle.log: expected ${n} line(s) matching ${re}, got ${got}`)
}
const rykkerrHits = g1.filter((l) => /\] Rykkerr [a-z]+ /.test(l)).length
if (rykkerrHits < 30) throw new Error(`g1-group-lifecycle.log: expected the member's combat lines to survive, got ${rykkerrHits}`)
console.log(`g1-group-lifecycle.log: all six membership lines present, ${rykkerrHits} member combat lines`)

// G2 THE QUICK BUFF FAN-OUT (Tue Jul 28 21:49:08–21:51:22, The Ruins of Old Guk) — JOS-85, user
// report 01KZEWFNSEHJN33W1BA797F806 ("doesn't seem to be picking my group members sometimes").
//
// G1 is the case where the game SAYS who you are with. This is the case where it already said
// it and the window missed it: the reporter's 12,376-line session carried ZERO group lines
// because his group formed before the log window, and the only recovery rung the model had
// (`<Name> tells the group, '…'`) needs somebody to talk — which a quiet group never does and
// which the shared scrub strips from every artifact anyway.
//
// THIS WINDOW REPRODUCES THAT SITUATION IN THE OWNER'S OWN BYTES, which is why it is cut here
// and not from the reporter's slice (AGENTS.md: a reporter's slice never becomes a fixture).
// Dranix joined at 21:09:31 — FORTY MINUTES and 12,000 lines earlier, so the join line is not
// in the window and cannot be. What IS in it, in order:
//
//   21:49:08  You gain party experience!            the gate: a group demonstrably exists
//   21:49:11  a froglok ton warrior has been charmed. the pet the burst will also land on
//   21:49:28  You gain party experience!
//   21:49:58  You activate Quick Buff.
//   21:50:01  You healed Primitive / a froglok ton warrior / Dranix … by Center.
//             ONE cast, three names, one second — the enumeration the parser used to discard
//   …then    Dranix's own combat lines, which are the damage the meter must show
//
// The join line 40 minutes earlier is the INDEPENDENT ground truth that the name this burst
// recovers is the right one; the whole-log measurement behind the rule is in
// src/main/modules/buffFanOut.ts.
const g2 = slice(268141, 268700, 'g2-buff-fanout.log')

const g2expected = [
  // Two before the burst (the gate) and one after — the third is what makes the window honest
  // about how ordinary this line is in a grouped session.
  [/^\[.*\] You gain party experience!/, 3],
  [/^\[.*\] You activate Quick Buff\.$/, 1],
  [/^\[.*\] a froglok ton warrior has been charmed\.$/, 1],
  [/^\[.*\] You healed Primitive for \d+ \(\d+\) hit points by Center\.$/, 1],
  [/^\[.*\] You healed a froglok ton warrior for \d+ hit points by Center\.$/, 1],
  [/^\[.*\] You healed Dranix for \d+ hit points by Center\.$/, 1]
]
for (const [re, n] of g2expected) {
  const got = g2.filter((l) => re.test(l)).length
  if (got !== n) throw new Error(`g2-buff-fanout.log: expected ${n} line(s) matching ${re}, got ${got}`)
}
// The window must NOT contain a membership line — its whole point is that there is none to read.
const g2group = g2.filter((l) => /(joined the group|left the group|leader of your group|removed from the group)/.test(l)).length
if (g2group !== 0) throw new Error(`g2-buff-fanout.log: the window must carry NO membership line, got ${g2group}`)
const dranixHits = g2.filter((l) => /\] Dranix [a-z]+ /.test(l)).length
if (dranixHits < 20) throw new Error(`g2-buff-fanout.log: expected the member's combat lines to survive, got ${dranixHits}`)
console.log(`g2-buff-fanout.log: burst intact, 0 membership lines, ${dranixHits} member combat lines`)
