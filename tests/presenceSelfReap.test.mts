// THE SELF-REAP LOOP, AND THE PROGRAM THAT PRODUCED IT (JOS-164).
//
// Split out of `tests/presence.test.mts` for size, and it is a clean seam: everything here is
// about the child ENDING — the trail that recognises a run of self-reaps, and the emitted
// PowerShell that must never ask .NET about a process again. The line protocol, the EQ-window
// predicate, the debounce and the gating matrix stay in the original file.
//
// PURE, and it never skips. `tests/presenceWatcherScript.test.mts` is the Windows-only half that
// actually RUNS what this file reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEW_WATCHER_EXIT_TRAIL,
  SELF_REAP_LOOP_ERROR_NAME,
  WATCHER_SELF_REAP_STREAK,
  WATCHER_STALE_MS,
  parsePresenceLine,
  watcherExitStep,
  type WatcherExitLog,
  type WatcherExitTrail
} from '../src/main/presenceProtocol'
import { WATCHER_PINVOKE, watcherScript } from '../src/main/presenceWatcherScript'
import { errorFingerprint, errorNameOf, parseStackFrames } from '../src/shared/errorReport'

test('the EXIT line is the child’s last word, and its shape is narrow on purpose', () => {
  // JOS-164. From the parent, an exit used to be a code and nothing else — which is how 245
  // reports came to say "exited unexpectedly" about a child that had DECIDED to stop and knew
  // exactly why. `X|parent-gone` is the one line that closes that gap.
  assert.deepEqual(parsePresenceLine('X|parent-gone'), { t: 'exit', reason: 'parent-gone' })
  assert.deepEqual(parsePresenceLine('X|parent-gone\r'), { t: 'exit', reason: 'parent-gone' })
  // The reason lands in the parent's error log, so it is bounded by SHAPE rather than trusted:
  // lowercase kebab, capped, ONE field. Everything else is junk and moves nothing.
  for (const junk of [
    'X',
    'X|',
    'X| ',
    'X|1|2',
    'X|Parent-Gone',
    'X|parent gone',
    `X|${'a'.repeat(64)}`,
    'X|parent-gone|extra'
  ]) {
    assert.equal(parsePresenceLine(junk), null, `${JSON.stringify(junk)} must not decode`)
  }
  assert.equal(parsePresenceLine(`X|${'a'.repeat(63)}`)?.t, 'exit', 'the cap is inclusive at 63')
})

// ------------------------------------------------------- the self-reap loop (JOS-164)
//
// THE BUG, AS A SEQUENCE. One install produced 245+ copies of `presence watcher exited
// unexpectedly` in two days — one every ~32 s, forever — because its `Get-Process` could not see
// a LIVE parent, so the child reaped itself about a second after every spawn. Each entry was
// true and none of them was the diagnosis; the diagnosis is only visible in the SHAPE of the run.
// These drive that whole sequence, including the part that must NOT fire.

/** Fold a run of exits through the trail, collecting whatever each one would have logged. */
function exitRun(
  exits: readonly { code: number | null; lifetimeMs: number; reason?: string }[]
): { logs: (WatcherExitLog | null)[]; trail: WatcherExitTrail } {
  let trail = NEW_WATCHER_EXIT_TRAIL
  const logs: (WatcherExitLog | null)[] = []
  for (const e of exits) {
    const step = watcherExitStep(trail, { code: e.code, lifetimeMs: e.lifetimeMs, reason: e.reason ?? null })
    trail = step.trail
    logs.push(step.log)
  }
  return { logs, trail }
}

/** One self-reap-shaped exit: clean, immediate, and carrying the child's own reason. */
const SELF_REAP = { code: 0, lifetimeMs: 900, reason: 'parent-gone' } as const

test('THE CHILD’S REASON REACHES THE PARENT’S LOG — every exit carries it, and its lifetime', () => {
  // `X|parent-gone` decodes in `pumpStdout` and waits for the exit handler, which is the only
  // place that knows the code and how long the child lived. All three land in one entry, so a
  // reader of errors.log sees "it chose to stop, 900 ms in" instead of "code 0".
  const first = watcherExitStep(NEW_WATCHER_EXIT_TRAIL, { code: 0, lifetimeMs: 900, reason: 'parent-gone' })
  assert.deepEqual(first.log, {
    message: 'presence watcher exited unexpectedly',
    code: 0,
    lifetimeMs: 900,
    reason: 'parent-gone'
  })
  // A child that was killed, crashed or starved never got to say anything, and the entry says so
  // rather than inventing a reason.
  const silentDeath = watcherExitStep(NEW_WATCHER_EXIT_TRAIL, { code: 1, lifetimeMs: 40, reason: null })
  assert.equal(silentDeath.log?.reason, null)
  assert.equal(silentDeath.log?.lifetimeMs, 40)
})

test('N CONSECUTIVE SELF-REAPS COLLAPSE INTO ONE ENTRY, AND THEN THE STORE GOES QUIET', () => {
  const n = WATCHER_SELF_REAP_STREAK
  assert.ok(n >= 2, 'one fast clean exit is a one-off and must still be reported')
  // The reporter's session, at the length that produced 245 entries.
  const { logs, trail } = exitRun(Array.from({ length: 60 }, () => SELF_REAP))

  const written = logs.filter((l) => l !== null)
  assert.equal(written.length, n, `${String(n)} entries for a run of any length — not 60, not 245`)
  for (const l of written.slice(0, n - 1)) {
    assert.equal(l.message, 'presence watcher exited unexpectedly')
    assert.equal(l.name, undefined, 'the ordinary entries keep the identity the store already has')
  }
  const collapsed = written[n - 1]
  assert.equal(collapsed.name, SELF_REAP_LOOP_ERROR_NAME)
  assert.equal(collapsed.exits, n)
  assert.match(collapsed.message, /self-reap loop/)
  assert.equal(collapsed.reason, 'parent-gone', 'the diagnosis still carries the child’s own word')
  assert.equal(trail.collapsed, true)
  assert.equal(trail.streak, n, 'the streak is held at N, so a day-long session cannot run it away')
})

test('THE COLLAPSED ENTRY IS ITS OWN FINGERPRINT — that is what makes it a new row', () => {
  // `errorFingerprint` hashes the error NAME and the top frames, never the message (shared/
  // errorReport.ts says why: a message-sensitive hash shatters one issue into singletons). So a
  // distinct diagnosis needs a distinct NAME, and `errorNameOf` is what reads it off the payload
  // `logError` is handed. Same capture site, same frames — only the name differs.
  const frames = parseStackFrames('    at handleChildGone (C:\\app\\out\\main\\index.js:900:11)')
  assert.equal(frames.length, 1, 'the capture site parses, or this test proves nothing')

  const { logs } = exitRun(Array.from({ length: WATCHER_SELF_REAP_STREAK }, () => SELF_REAP))
  const ordinary = logs[0]
  const collapsed = logs[WATCHER_SELF_REAP_STREAK - 1]
  assert.ok(ordinary && collapsed)

  const fp = (l: WatcherExitLog): string => errorFingerprint(errorNameOf(l.name), frames)
  assert.equal(errorNameOf(ordinary.name), 'Error', 'an unnamed payload keeps the old identity')
  assert.equal(errorNameOf(collapsed.name), SELF_REAP_LOOP_ERROR_NAME)
  assert.notEqual(fp(ordinary), fp(collapsed))
})

test('ONLY A CLEAN, IMMEDIATE EXIT COUNTS — a crash and a long healthy run both reset the trail', () => {
  const n = WATCHER_SELF_REAP_STREAK
  // A non-zero code is PowerShell failing, which is a different story with a different fix.
  const crashes = exitRun(Array.from({ length: 20 }, () => ({ code: 1, lifetimeMs: 300 })))
  assert.equal(crashes.logs.filter((l) => l === null).length, 0, 'every crash is still reported')
  assert.equal(crashes.trail.streak, 0)

  // A child that outlived the staleness window was WORKING; whatever ended it is not this bug.
  const healthy = exitRun([{ code: 0, lifetimeMs: WATCHER_STALE_MS }])
  assert.equal(healthy.trail.streak, 0)
  assert.equal(healthy.logs[0]?.name, undefined)
  // …and the window is exclusive at its own edge, one ms below it and inside.
  assert.equal(exitRun([{ code: 0, lifetimeMs: WATCHER_STALE_MS - 1 }]).trail.streak, 1)

  // ONE GOOD RUN IN THE MIDDLE IS ENOUGH: the streak restarts, so the diagnosis never fires for a
  // machine that hiccups occasionally.
  const interrupted = exitRun([
    ...Array.from({ length: n - 1 }, () => SELF_REAP),
    { code: 0, lifetimeMs: WATCHER_STALE_MS * 2 },
    ...Array.from({ length: n - 1 }, () => SELF_REAP)
  ])
  assert.equal(
    interrupted.logs.filter((l) => l?.name === SELF_REAP_LOOP_ERROR_NAME).length,
    0,
    'never diagnosed — the pattern was broken before it completed, twice'
  )
  assert.equal(interrupted.logs.filter((l) => l !== null).length, 2 * (n - 1) + 1)
})

test('A COLLAPSED RUN STARTS REPORTING AGAIN THE MOMENT THE PATTERN BREAKS', () => {
  // The quiet is about ONE repeating condition, not about the presence watcher forever. The next
  // genuinely different failure is a full entry again.
  const n = WATCHER_SELF_REAP_STREAK
  const { logs } = exitRun([
    ...Array.from({ length: n + 10 }, () => SELF_REAP),
    { code: 1, lifetimeMs: 50 },
    ...Array.from({ length: n }, () => SELF_REAP)
  ])
  const written = logs.filter((l) => l !== null)
  assert.equal(written.length, n + 1 + n)
  assert.equal(written[n].code, 1, 'the crash that broke the run')
  assert.equal(
    written.filter((l) => l.name === SELF_REAP_LOOP_ERROR_NAME).length,
    2,
    'and the loop is diagnosed once per run of it, not once per session'
  )
})

// ------------------------------------------------------- the child's program (JOS-164)
//
// The script is a string until a user runs it, which is how a `Get-Process` that answers nothing
// about a live process survived four releases. These are the assertions that need no Windows;
// `tests/presenceWatcherScript.test.mts` compiles the same C# and runs it.

const SCRIPT = watcherScript('C:\\Games\\EQ\\', { runningPollMs: 5000, tickMs: 1, foregroundEveryTicks: 10 }, 4242)

test('THE WATCHER NEVER ASKS .NET ABOUT A PROCESS AGAIN — that was the whole defect', () => {
  // `Get-Process` and `[System.Diagnostics.Process]::GetProcesses()` are the same .NET Framework
  // process table, and on the reporting machine it answered NOTHING about processes that were
  // demonstrably running. Three questions rode on it: is my parent alive (→ 245 self-reaps), what
  // is the foreground window's image (→ every window unclassifiable), is the game running (→
  // `eqRunning` pinned to 0, which with the shipped default hides every overlay forever).
  for (const banned of ['Get-Process', 'GetProcesses', 'MainModule', 'System.Diagnostics.Process']) {
    assert.equal(SCRIPT.includes(banned), false, `${banned} is the API that lied`)
  }
  // And the replacements are actually there, rather than the question having been deleted.
  for (const wanted of ['OpenProcess', 'WaitForSingleObject', 'QueryFullProcessImageName', 'EnumProcesses']) {
    assert.equal(SCRIPT.includes(wanted), true, wanted)
  }
})

test('the child announces WHY before it reaps itself, and the parent can decode that line', () => {
  const i = SCRIPT.indexOf("[Console]::Out.WriteLine('X|parent-gone')")
  assert.ok(i > 0, 'the reason line is in the emitted script')
  assert.ok(SCRIPT.indexOf('break', i) > i, 'and it is printed BEFORE the break, not after')
  assert.deepEqual(parsePresenceLine('X|parent-gone'), { t: 'exit', reason: 'parent-gone' })
})

test('THE SCRIPT IS WINDOWS POWERSHELL 5.1 — no pwsh-only syntax may creep in', () => {
  // `powershell.exe` is 5.1, not `pwsh`: pipeline chain operators (`&&`, `||`) and the ternary
  // are 7.x and are PARSE errors there — a whole watcher that never starts, on every machine.
  // The C# in `Add-Type` is a separate language and legitimately uses `?:`, so the check runs on
  // the PowerShell half only. (`tests/presenceWatcherScript.test.mts` puts the whole thing through
  // PowerShell's own parser on Windows; this is the half that never skips.)
  const powershellOnly = SCRIPT.replace(WATCHER_PINVOKE, '')
  assert.equal(powershellOnly.includes('&&'), false, 'no pipeline chain operator')
  assert.equal(powershellOnly.includes('||'), false, 'no pipeline chain operator')
  assert.equal(/\?\s*[^\s]+\s*:/.test(powershellOnly), false, 'no ternary')
  // The parameters really are substituted — an unexpanded `${…}` would be a script that runs and
  // watches the wrong pid.
  assert.equal(SCRIPT.includes('${'), false)
  assert.ok(SCRIPT.includes('[EqcWin]::WatchParent(4242)'))
  assert.ok(SCRIPT.includes("$root = 'C:\\Games\\EQ\\'"))
})

test('a pathological install root cannot break out of its PowerShell literal', () => {
  const nasty = watcherScript("C:\\It's\\EQ\\", { runningPollMs: 1, tickMs: 1, foregroundEveryTicks: 1 }, 1)
  assert.ok(nasty.includes("$root = 'C:\\It''s\\EQ\\'"), 'the quote is doubled, not escaped')
})

