// THE WATCHER CHILD'S OWN PROGRAM, RUN (JOS-164).
//
// `tests/presence.test.mts` asserts what the emitted script SAYS. This file makes Windows answer:
// it compiles the exact `Add-Type` surface `src/main/presenceWatcherScript.ts` ships, calls the
// parent-liveness check against real pids, puts the whole emitted script through PowerShell's own
// parser, and finally spawns the real watcher with a parent it then kills.
//
// WHY IT EXISTS AT ALL. The defect this ticket fixes lived in a template literal for four
// releases: the child asked `Get-Process -Id $parentPid` whether its parent was alive, and on
// machines with corrupted `PerfProc` counters (or EDR that blocks process enumeration) that
// cmdlet answers NOTHING for a process that is demonstrably running. The child reaped itself ~1 s
// after every spawn, forever — 245+ error reports from one install in two days — and overlay
// auto-hide and the cursor ring were dead for every one of those sessions. No test could see it,
// because nothing in the suite had ever executed a line of that script.
//
// THE KEY TEST SIMULATES THE BROKEN MACHINE HONESTLY: PowerShell lets a FUNCTION shadow a cmdlet,
// so `function Get-Process { }` reproduces exactly the observed symptom — the cmdlet answers
// nothing about a live process — inside a session where that process is certainly alive. The old
// check breaks the loop under it; the new one does not.
//
// Windows-only, and it says so rather than passing vacuously: the watcher is a `powershell.exe`
// child and is never spawned off Windows (`startWatcher` returns early). CI runs on
// `windows-latest`, so these do not skip there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WATCHER_PINVOKE, watcherScript } from '../src/main/presenceWatcherScript'
import { parsePresenceLine } from '../src/main/presenceProtocol'

const NOT_WINDOWS = process.platform !== 'win32' && 'the watcher is a powershell.exe child'

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']

/** Run a PowerShell script the way the app does — `-EncodedCommand`, so no quoting rules apply. */
function runPs(script: string): string {
  return execFileSync(
    'powershell.exe',
    [...PS_ARGS, Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }
  )
}

/** The same, with the shipped P/Invoke surface compiled in front of it — i.e. `EqcWin` as the
 *  watcher itself has it. This is the REAL C#, not a copy: it is imported from the module. */
function runWithPinvoke(body: string): Record<string, string> {
  const out = runPs(
    `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${WATCHER_PINVOKE}
'@
$ErrorActionPreference = 'SilentlyContinue'
${body}`
  )
  // `key=value` per line, which keeps the assertions readable and the PowerShell trivial.
  const facts: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) facts[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return facts
}

test(
  'A PARENT `Get-Process` CANNOT SEE IS STILL ALIVE TO THE HANDLE CHECK — the reported bug',
  { skip: NOT_WINDOWS },
  () => {
    // `function Get-Process { }` is the broken machine, reproduced: the cmdlet answers nothing
    // about a process that is running right now (it is the very process asking). The OLD check was
    // `if (-not (Get-Process -Id $parentPid)) { break }`, so under this it breaks EVERY time —
    // which is the 245-entry loop. The new check asks the kernel about a handle instead.
    const f = runWithPinvoke(`
function Get-Process { }
[Console]::Out.WriteLine('getProcessSeesParent=' + [bool](Get-Process -Id $PID))
[EqcWin]::WatchParent($PID)
[Console]::Out.WriteLine('parentGone=' + [EqcWin]::ParentGone())
[Console]::Out.WriteLine('parentGoneAgain=' + [EqcWin]::ParentGone())
`)
    assert.equal(f.getProcessSeesParent, 'False', 'the blindness really is reproduced')
    assert.equal(f.parentGone, '0', 'and the watcher keeps running under it')
    assert.equal(f.parentGoneAgain, '0', 'every beat, not just the first')
  }
)

test('a parent that really HAS exited is still reaped', { skip: NOT_WINDOWS }, () => {
  // The self-reap must keep working: Windows orphans children rather than killing them, so a main
  // process that dies without running its quit path leaves this loop polling forever.
  const f = runWithPinvoke(`
$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c','exit' -PassThru -WindowStyle Hidden
$p.WaitForExit()
[EqcWin]::WatchParent($p.Id)
[Console]::Out.WriteLine('exitedParent=' + [EqcWin]::ParentGone())
# A pid that never existed at all: the kernel says ERROR_INVALID_PARAMETER, which is the ONE
# refusal that reads as "gone". Everything else it could say reads as "alive".
[EqcWin]::WatchParent(2147483632)
[Console]::Out.WriteLine('nonexistentParent=' + [EqcWin]::ParentGone())
# And a live one is still live, so this is not a check that always answers "gone".
[EqcWin]::WatchParent($PID)
[Console]::Out.WriteLine('liveParent=' + [EqcWin]::ParentGone())
`)
  assert.equal(f.exitedParent, '1')
  assert.equal(f.nonexistentParent, '1')
  assert.equal(f.liveParent, '0')
})

test('image paths and the running scan answer without .NET’s process table', { skip: NOT_WINDOWS }, () => {
  // The other two questions that rode on the same broken API. `QueryFullProcessImageName` on a
  // PROCESS_QUERY_LIMITED_INFORMATION handle answers for far more processes than `.MainModule`
  // ever did (and throws for none of them), and `EnumProcesses` replaces the snapshot that would
  // ALSO have pinned `eqRunning` to 0 on the reporting machine — which, with the shipped default
  // `hideWhenNotRunning`, hides every overlay forever.
  const f = runWithPinvoke(`
$self = [EqcWin]::ImagePath($PID)
[Console]::Out.WriteLine('self=' + $self)
[Console]::Out.WriteLine('bogus=[' + [EqcWin]::ImagePath(2147483632) + ']')
$dir = [System.IO.Path]::GetDirectoryName($self) + '\\'
[Console]::Out.WriteLine('underOwnRoot=' + [EqcWin]::EqRunning($dir))
[Console]::Out.WriteLine('underNoRoot=' + [EqcWin]::EqRunning('ZZ:\\nowhere\\'))
`)
  assert.match(f.self.toLowerCase(), /\\powershell\.exe$/, 'a full image path, not a name')
  assert.equal(f.bogus, '[]', 'a pid that is not there answers empty, not garbage')
  assert.equal(
    f.underOwnRoot,
    '1',
    'the scan finds a process under a given root — this very PowerShell is one'
  )
  // NOT asserted as 0: the machine running this suite may have EverQuest open, and that is a
  // legitimate 1. What must never happen is -1, which is the enumeration itself failing.
  assert.notEqual(f.underNoRoot, '-1', 'the enumeration works')
})

test('the emitted script parses under Windows PowerShell’s OWN parser', { skip: NOT_WINDOWS }, () => {
  // Stronger than any string check: `powershell.exe` is 5.1, and a `&&` or a ternary that crept in
  // is a parse error — a watcher that never starts, on every machine, with nothing on stdout to
  // say why. This runs the real thing through the real parser.
  const dir = mkdtempSync(join(tmpdir(), 'eq-watcher-'))
  try {
    const path = join(dir, 'watcher.ps1')
    writeFileSync(
      path,
      watcherScript('C:\\Games\\EQ\\', { runningPollMs: 5000, tickMs: 1, foregroundEveryTicks: 10 }, 4242),
      'utf8'
    )
    const out = runPs(`
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile('${path.replace(/'/g, "''")}', [ref]$null, [ref]$errs)
[Console]::Out.WriteLine('psMajor=' + $PSVersionTable.PSVersion.Major)
[Console]::Out.WriteLine('errors=' + $errs.Count)
foreach ($e in $errs) { [Console]::Out.WriteLine('detail=' + $e.Message) }
`)
    assert.match(out, /psMajor=5/, 'powershell.exe is Windows PowerShell 5.1 — that is the target')
    assert.match(out, /errors=0/, out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(
  'END TO END: the child keeps beating while its parent lives, and says WHY when it dies',
  { skip: NOT_WINDOWS },
  async () => {
    // The whole fix, in one run of the shipped script. A doomed stand-in plays the parent; the
    // watcher is told to watch it, keeps running while it lives, and on its death prints the one
    // line the parent's error log has been missing since this feature shipped.
    //
    // It does not (and cannot cheaply) reproduce the broken machine — nothing here shadows
    // `Get-Process`, because the script no longer calls it. That half is the unit test at the top
    // of this file plus the emitted-script assertions in `tests/presence.test.mts`; this one
    // proves the REPLACEMENT works on a healthy machine, which is the regression that would
    // otherwise be discovered by an orphaned powershell.exe on somebody's desktop.
    const doomed = spawn(process.execPath, ['-e', 'setInterval(() => { /* alive */ }, 1000)'], {
      stdio: 'ignore',
      windowsHide: true
    })
    const parentPid = doomed.pid
    assert.ok(parentPid !== undefined)

    const script = watcherScript(
      'C:\\Games\\EQ\\',
      // A fast running-poll so the beat (and therefore the liveness check) turns quickly.
      { runningPollMs: 300, tickMs: 1, foregroundEveryTicks: 10 },
      parentPid
    )
    const watcher = spawn('powershell.exe', [...PS_ARGS, Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    watcher.stdout.setEncoding('utf8')

    let out = ''
    const done = new Promise<number | null>((resolve) => {
      watcher.on('exit', resolve)
    })
    // WAIT FOR THE CONDITION, NEVER FOR THE CLOCK: the child is alive and looping once it has
    // beaten twice, which is also proof it did NOT reap itself while its parent was up.
    const beating = new Promise<void>((resolve) => {
      watcher.stdout.on('data', (chunk: string) => {
        out += chunk
        if ((out.match(/^H$/gm) ?? []).length >= 2) resolve()
      })
    })
    try {
      await beating
      assert.equal(out.includes('X|'), false, 'no exit line while the parent is alive')
      doomed.kill()
      const code = await done
      assert.equal(code, 0, 'a self-reap is a clean exit — which is what made the loop invisible')
    } finally {
      doomed.kill()
      watcher.kill()
    }

    const last = out.trim().split('\n').pop()?.trim() ?? ''
    assert.equal(last, 'X|parent-gone', `the LAST line is the reason; got:\n${out}`)
    assert.deepEqual(parsePresenceLine(last), { t: 'exit', reason: 'parent-gone' })
  }
)
