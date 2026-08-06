// ============================================================================
// unreleased.ts — MAIN's half of the "landed on main, not released yet" gate (JOS-45).
// ============================================================================
//
// The owner's review gate: a module may land on main before it has been reviewed, PROVIDED a
// packaged user cannot reach it. The renderer half of that promise is a compile-time STRIP
// (`UNRELEASED` in src/renderer/src/devFlags.ts, anchored on `import.meta.env.DEV`) — the
// component tree, the nav row and the route are deleted from `out/renderer` by rollup, so
// there is nothing in a shipped build to un-hide.
//
// This file is the door on the other side. It exists for two reasons:
//
//   1. DEFENCE IN DEPTH. The strip is the guarantee; this is the second lock, so a future
//      surface that forgets the renderer gate still finds no handler behind it. It follows
//      `registerDevTriageIpc`'s predicate exactly (index.ts): `app.isPackaged` is FALSE under
//      the e2e harness (it launches an unpackaged binary against `out-e2e/`), which is the
//      whole reason `E2E` is a separate term.
//
//   2. IT MAKES THE GATE TESTABLE IN BOTH DIRECTIONS. A production-shaped e2e can assert the
//      module is absent — but an absence test also passes when the feature was never wired up
//      at all. `EQ_UNRELEASED=1` forces the main-side door open in any build, so the same spec
//      can launch a second time and watch the SAME channel answer. Absent, then present, on
//      one build: that is a gate, not dead code (tests/e2e/character-sheet.e2e.mts).
//
// The override cannot make a packaged build show the feature: the renderer surface is not in
// those bytes to show. It opens an IPC handler that a shipped renderer has no code to call.

import { app } from 'electron'
import { E2E } from './e2e'

/** An explicit opt-in for a production-shaped build. Read once — env is fixed at launch. */
const FORCED = process.env.EQ_UNRELEASED === '1'

/** Main-side door for surfaces that have not passed the owner's review gate. */
export const UNRELEASED = FORCED || (!app.isPackaged && !E2E)
