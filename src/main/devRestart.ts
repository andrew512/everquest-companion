// ============================================================================
// devRestart — "restart the app" for a dev build, and the guard that keeps it inert anywhere
// else (JOS-61).
// ============================================================================
//
// WHY IT EXISTS. Hand-testing startup performance means launching the app over and over, and
// the Performance section already shows the phase-by-phase breakdown of the launch you are in.
// A button beside that readout closes the loop: restart, read the new numbers, repeat — without
// leaving the app for a terminal.
//
// WHY THE LOGIC IS HERE AND NOT IN THE HANDLER. `relaunch()` + `exit(0)` cannot be exercised
// against the real Electron `app` in a unit test — calling it would end the test runner. So the
// decision is a pure function over a two-method HOST, and the handler (ipc/dev.ts) passes
// Electron's `app`, which satisfies the shape structurally. That is the `security.ts` pattern:
// the policy is a plain module with no Electron import, so `tests/devRestart.test.mts` runs it
// in both directions and never skips.
//
// THE GUARD IS `isPackaged`, AND IT IS THE POINT. The channel is registered unconditionally
// (the renderer surface is stripped from production bytes, but a door with no lock is not a
// guarantee), so a packaged build must be provably inert even if the channel is reached: it
// does nothing at all and answers `false`. Nothing about a shipped app should be one IPC call
// away from being killed — and the update flow has its own relaunch (`quitAndInstall`), which
// this must never become a second, unversioned copy of.
//
// `exit(0)` rather than `quit()`: `quit()` runs the ordinary close path, which a `close`
// handler can veto or delay, and a restart button that sometimes does nothing is worse than no
// button. `relaunch()` only QUEUES the new process — it starts once this one is gone — so the
// pair is the documented Electron idiom, in this order.

/** The slice of Electron's `app` a restart needs. Electron's own object satisfies it. */
export interface RestartHost {
  readonly isPackaged: boolean
  relaunch: () => void
  exit: (code?: number) => void
}

/**
 * Restart the app, unless this is a packaged build.
 *
 * @returns true when the relaunch was performed, false when it was refused. The boolean is the
 * handler's reply, so a caller can tell "did nothing" from "about to die" — though in the
 * happy case the process is gone before the reply can be delivered, which is expected.
 */
export function performDevRestart(host: RestartHost): boolean {
  if (host.isPackaged) return false
  host.relaunch()
  host.exit(0)
  return true
}
