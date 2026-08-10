// ============================================================================
// presenceWatcherScript.ts — the watcher child's ENTIRE program, as text.
// ============================================================================
//
// `presence.ts` spawns this and folds what it says; `presenceProtocol.ts` decides what the lines
// MEAN. This file is the third side of that split and the last one to get its own module (JOS-164):
// the PowerShell + C# source the child actually runs.
//
// IT IS HERE SO IT CAN BE TESTED. The script is the half of the presence feature that has never
// been driven by anything but a real user's machine — it is a string inside a module that reaches
// Electron, so no unit test could so much as look at it, and the defect this file was cut out for
// (a `Get-Process` that answers nothing about a LIVE process; see `WATCHER_PINVOKE`) lived in it
// for four releases. Standing alone with NO imports at all, it is `Add-Type`-able straight out of
// a node test on Windows — `tests/presenceWatcherScript.test.mts` compiles this exact C# and runs
// the parent-liveness check against a real live pid with `Get-Process` shadowed into blindness.
//
// PowerShell 5.1 IS THE TARGET, and the floor is lower than it looks: `powershell.exe` is Windows
// PowerShell, not `pwsh`, so there is no `&&`/`||` chaining and no ternary. The script below uses
// neither, and `tests/presence.test.mts` pins that so a future edit cannot quietly assume 7.x.

/**
 * The polling loop, as PowerShell. Sent to `powershell.exe -EncodedCommand` (base64 UTF-16LE)
 * rather than through a shell or stdin: no quoting rules apply to base64, so the script below
 * is the script that runs, byte for byte.
 *
 * Everything expensive happens once, before the loop: the P/Invoke surface is compiled by
 * `Add-Type` at startup (~1 s, paid a single time per app run) and process image paths are
 * memoized per pid. The loop itself is five user32 calls and a string compare.
 *
 * CURSOR VISIBILITY is one of those calls, AND IT IS THE ONE THAT RUNS EVERY TICK (JOS-120).
 * `GetCursorInfo` reports the session-wide cursor, and EverQuest hides it for the whole time a
 * mouse button is held in the world view — during which it also re-centers the pointer every
 * frame, so an absolute cursor sample oscillates while nothing is on screen to follow it.
 * `CURSORINFO.flags` is a bit field, so the test is `& CURSOR_SHOWING(0x1)`, not `!= 0`. A failed
 * call answers "showing": the ring is a display aid, and a watcher that cannot see the cursor
 * must not be the reason it disappears.
 *
 * THE LOOP IS SPLIT, AND THAT IS THE WHOLE POINT. This one call gates an 8 ms consumer, so
 * running it on the same 150 ms tick as the expensive foreground work let a whole mouse click
 * pass unobserved — the ring tracked a pointer nobody could see for up to nineteen samples. It is
 * a single user32 call and costs nothing, so it runs EVERY tick at the platform's floor
 * (~16 ms), while the foreground/running/heartbeat block keeps the cadence it always had by
 * running every `FOREGROUND_EVERY_TICKS`th tick. Measured price: ~1.3 ms of CPU per second (see
 * presenceProtocol.ts's cadence section).
 *
 * `$ErrorActionPreference` drops to SilentlyContinue after `Add-Type`, ON PURPOSE: an ordinary
 * best-effort answer about a process we may not inspect must not raise a non-terminating error
 * every 5 s forever, and the watcher's job is to answer best-effort rather than to be right about
 * every process on the machine.
 *
 * NOTHING IN THIS SCRIPT ASKS .NET ABOUT A PROCESS ANY MORE (JOS-164) — see the P/Invoke surface
 * below. Every process fact the loop needs (is the parent alive, what is the foreground window's
 * image, is the game running) comes from kernel32/psapi handles.
 */
/**
 * The P/Invoke surface, as C# for `Add-Type`. Compiled ONCE per app run (~1 s) before the loop
 * starts, which is the whole reason the loop itself can be a handful of syscalls.
 *
 * A module constant rather than part of the template below purely so the script builder stays one
 * readable function — nothing here is parameterised.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PROCESS HALF EXISTS BECAUSE `Get-Process` LIED ABOUT A LIVE PROCESS (JOS-164).
 * ---------------------------------------------------------------------------------------------
 * PowerShell 5.1 rides .NET Framework's process APIs, and on some machines those answer NOTHING
 * for processes that are demonstrably running — corrupted `PerfProc` performance counters and EDR
 * that blocks process enumeration are the two documented causes. One install produced 245+ error
 * reports in two days from exactly that: the child asked `Get-Process -Id $parentPid`, got nothing
 * back for a parent that was alive and reading its pipe, reaped itself ~1 s after every spawn, and
 * left overlay auto-hide and the cursor ring dead for the whole session — fail-open, so the user
 * saw only overlays that never hid and never filed a report.
 *
 * The replacement asks the KERNEL instead, and asks it about a HANDLE rather than about a table:
 *
 *   * PARENT LIVENESS — `OpenProcess(SYNCHRONIZE)` ONCE, then `WaitForSingleObject(h, 0)` per
 *     beat. A signalled process object means the process has exited; `WAIT_TIMEOUT` means it is
 *     still running. Holding the handle is what makes this immune to PID REUSE as well: the handle
 *     names the process we were started by, not whatever now owns that number.
 *   * IMAGE PATHS — `QueryFullProcessImageName` on a `PROCESS_QUERY_LIMITED_INFORMATION` handle.
 *     That is the modern replacement for `.MainModule.FileName`, which OPENED the process and
 *     THREW for every protected one (a few hundred .NET exceptions per poll on a normal desktop);
 *     the limited-information right is granted for almost everything, so this answers MORE often
 *     and costs less.
 *   * THE RUNNING SCAN — `EnumProcesses` + the above, one pass. It replaces two passes over a
 *     `[System.Diagnostics.Process]::GetProcesses()` snapshot (name first, path second), which was
 *     the same .NET table and so had the same blind spot. On the reporting machine that blindness
 *     would ALSO have pinned `eqRunning` to 0 — which, with the shipped default
 *     `hideWhenNotRunning`, hides every overlay forever.
 *
 * FAILURE DIRECTION IS EXPLICIT AND IS ALWAYS "KEEP GOING". `ParentGone` answers 1 only for
 * `ERROR_INVALID_PARAMETER` — the kernel's way of saying there is no such process — so an
 * ACCESS_DENIED, a hooked syscall or any other refusal reads as "alive" and the watcher keeps
 * watching. `EqRunning` answers -1 when the enumeration itself failed, and the loop then holds the
 * last known value rather than announcing that the game vanished.
 */
export const WATCHER_PINVOKE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EqcWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
  public static string Title(IntPtr h) { StringBuilder sb = new StringBuilder(512); GetWindowTextW(h, sb, 512); return sb.ToString(); }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  public static int CursorShowing() {
    CURSORINFO ci = new CURSORINFO();
    ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (!GetCursorInfo(ref ci)) return 1;
    return (ci.flags & 0x1) != 0 ? 1 : 0;
  }

  // ---- processes, by handle rather than by .NET's process table (JOS-164) ----
  const uint SYNCHRONIZE = 0x00100000;
  const uint QUERY_LIMITED_INFORMATION = 0x00001000;
  const uint WAIT_OBJECT_0 = 0x00000000;
  const int ERROR_INVALID_PARAMETER = 87;
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
  public static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder buf, ref uint size);
  [DllImport("psapi.dll", SetLastError = true)] public static extern bool EnumProcesses(uint[] ids, uint cb, out uint needed);

  static IntPtr parentHandle = IntPtr.Zero;
  static uint parentPid = 0;

  /** Remember whose child we are, and take the wait handle now while the parent is certainly up. */
  public static void WatchParent(uint pid) {
    parentPid = pid;
    parentHandle = OpenProcess(SYNCHRONIZE, false, pid);
  }

  /** 1 = the parent has exited, 0 = it is alive OR we cannot tell. Never guesses "gone". */
  public static int ParentGone() {
    if (parentHandle == IntPtr.Zero) {
      parentHandle = OpenProcess(SYNCHRONIZE, false, parentPid);
      if (parentHandle == IntPtr.Zero) {
        return Marshal.GetLastWin32Error() == ERROR_INVALID_PARAMETER ? 1 : 0;
      }
    }
    return WaitForSingleObject(parentHandle, 0) == WAIT_OBJECT_0 ? 1 : 0;
  }

  /** A process's full image path, or "" when the kernel will not say. */
  public static string ImagePath(uint pid) {
    IntPtr h = OpenProcess(QUERY_LIMITED_INFORMATION, false, pid);
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      uint n = 1024;
      if (!QueryFullProcessImageName(h, 0, sb, ref n)) return "";
      return sb.ToString();
    } finally { CloseHandle(h); }
  }

  /** 1 = an EverQuest client is running, 0 = none is, -1 = the enumeration itself failed. */
  public static int EqRunning(string root) {
    uint[] ids = new uint[4096];
    uint needed = 0;
    if (!EnumProcesses(ids, (uint)(ids.Length * 4), out needed)) return -1;
    int n = (int)(needed / 4);
    if (n > ids.Length) n = ids.Length;
    for (int i = 0; i < n; i++) {
      if (ids[i] == 0) continue;
      string p = ImagePath(ids[i]);
      if (p.Length == 0) continue;
      int cut = p.LastIndexOf('\\\\');
      string leaf = cut < 0 ? p : p.Substring(cut + 1);
      if (string.Equals(leaf, "eqgame.exe", StringComparison.OrdinalIgnoreCase)) return 1;
      if (root.Length > 0 && p.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return 1;
    }
    return 0;
  }
}
`.trim()

/** The child's three cadences. One object because they only mean anything together — see
 *  presenceProtocol.ts's cadence section. */
export interface WatcherCadence {
  /** ms between process-existence scans (and therefore between heartbeats). */
  runningPollMs: number
  /** ms the loop asks to sleep between ticks; every tick reads CURSOR_SHOWING. */
  tickMs: number
  /** how many ticks between the expensive foreground/running block. */
  foregroundEveryTicks: number
}

export function watcherScript(
  eqRootWithSep: string,
  cadence: WatcherCadence,
  parentPid: number
): string {
  // A single-quoted PowerShell literal: the only character that needs escaping is `'`, and a
  // Windows path cannot contain one. Doubling it keeps that true even for a pathological root.
  const rootLiteral = eqRootWithSep.replace(/'/g, "''")
  const { runningPollMs, tickMs, foregroundEveryTicks } = cadence
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${WATCHER_PINVOKE}
'@
$ErrorActionPreference = 'SilentlyContinue'
$root = '${rootLiteral}'
# Take the parent's wait handle NOW, while it is certainly alive — see EqcWin's header.
[EqcWin]::WatchParent(${parentPid})
$paths = @{}
$lastFg = ''
$lastRun = -1
$lastCur = -1
$nextRun = [DateTime]::MinValue
$fgEvery = ${foregroundEveryTicks}
$fgCountdown = 0
while ($true) {
  # EVERY TICK, and deliberately alone up here: one user32 call, no allocation, no string work.
  # This is the gate on main's 8 ms cursor sampler, so its latency is the ring's honesty (JOS-120).
  $cur = [EqcWin]::CursorShowing()
  if ($cur -ne $lastCur) { $lastCur = $cur; [Console]::Out.WriteLine('C|' + $cur) }
  $fgCountdown = $fgCountdown - 1
  if ($fgCountdown -gt 0) { Start-Sleep -Milliseconds ${tickMs}; continue }
  $fgCountdown = $fgEvery
  # ---- everything below runs on the ORIGINAL ~150 ms cadence, not the fast tick ----
  $h = [EqcWin]::GetForegroundWindow()
  $fgPid = [uint32]0
  [void][EqcWin]::GetWindowThreadProcessId($h, [ref]$fgPid)
  $rect = New-Object EqcWin+RECT
  [void][EqcWin]::GetWindowRect($h, [ref]$rect)
  if (-not $paths.ContainsKey($fgPid)) {
    if ($paths.Count -gt 256) { $paths.Clear() }
    $paths[$fgPid] = [EqcWin]::ImagePath($fgPid)
  }
  $line = 'F|' + $fgPid + '|' + $rect.Left + '|' + $rect.Top + '|' + ($rect.Right - $rect.Left) + '|' + ($rect.Bottom - $rect.Top) + '|' + $paths[$fgPid] + '|' + [EqcWin]::Title($h)
  if ($line -ne $lastFg) { $lastFg = $line; [Console]::Out.WriteLine($line) }
  $now = [DateTime]::UtcNow
  if ($now -ge $nextRun) {
    $nextRun = $now.AddMilliseconds(${runningPollMs})
    # SELF-REAP. Windows does not kill a child when its parent dies, so a main process that goes
    # away without running its quit path — a crash, or the Stop-Process -Force an integrator
    # reaches for — leaves this loop polling user32 forever with nobody reading the pipe. The
    # parent's WAIT HANDLE is taken at startup; when the process object signals, so do we.
    # It answers "gone" only for the kernel's "no such process", so a refusal keeps us running.
    # THE REASON LINE IS THE LAST THING WE SAY (JOS-164): from the parent side an exit is a code
    # and nothing else, and this is the one exit the child chose.
    if ([EqcWin]::ParentGone() -eq 1) {
      [Console]::Out.WriteLine('X|parent-gone')
      break
    }
    # The pid -> image-path memo is dropped on every beat rather than only when it grows past
    # 256 entries. Windows RECYCLES pids, and an entry that outlives its process is not stale
    # data, it is WRONG data: the browser that inherits a departed eqgame.exe's pid would be
    # handed eqgame's path and classified as the game. Five seconds bounds that window, and the
    # memo still absorbs the ~31 foreground scans between beats, which is all it was ever for.
    $paths.Clear()
    # -1 means the enumeration failed, which is not the same fact as "the game is not running":
    # hold the last answer rather than announcing a disappearance nobody observed.
    $running = [EqcWin]::EqRunning($root)
    if ($running -ge 0 -and $running -ne $lastRun) { $lastRun = $running; [Console]::Out.WriteLine('R|' + $running) }
    # THE HEARTBEAT, and the only line printed unconditionally. Everything else is change-driven,
    # so a healthy idle watcher is indistinguishable from a wedged one on the pipe alone — see
    # presenceProtocol.ts's note. One byte per beat is what buys the parent that distinction.
    [Console]::Out.WriteLine('H')
  }
  Start-Sleep -Milliseconds ${tickMs}
}
`
}
