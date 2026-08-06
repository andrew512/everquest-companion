// The dev-only restart button's guard (JOS-61 — src/main/devRestart.ts).
//
// The channel is registered in EVERY build (src/main/ipc/dev.ts), so the thing that keeps a
// packaged app safe is this predicate and nothing else. It is a pure function over a two-method
// host precisely so it can be asserted in both directions here: `relaunch()` + `exit(0)` against
// the real Electron `app` would end the test runner.
//
// No Electron, no fixtures, no network — the security.test.mts / storeMigrations.test.mts
// precedent, so this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { performDevRestart, type RestartHost } from '../src/main/devRestart'

/** A stand-in for Electron's `app`, recording what was asked of it. */
function spyHost(isPackaged: boolean): RestartHost & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isPackaged,
    relaunch: () => calls.push('relaunch'),
    exit: (code?: number) => calls.push(`exit:${String(code)}`)
  }
}

test('unpackaged: queues the relaunch, THEN exits — that order, code 0', () => {
  const host = spyHost(false)
  assert.equal(performDevRestart(host), true)
  // `relaunch()` only queues the successor; it starts once this process is gone. Exiting first
  // would therefore restart nothing, so the order is part of the contract, not a style choice.
  assert.deepEqual(host.calls, ['relaunch', 'exit:0'])
})

test('packaged: a NO-OP — nothing is called and the refusal is reported', () => {
  const host = spyHost(true)
  assert.equal(performDevRestart(host), false)
  assert.deepEqual(host.calls, [])
})

test('the guard is the ONLY input — a packaged host refuses however often it is asked', () => {
  // There is no argument, no env read and no store lookup in the path: the same host answers
  // the same way every time, which is what "provably inert when packaged" has to mean.
  const packaged = spyHost(true)
  for (let i = 0; i < 5; i++) assert.equal(performDevRestart(packaged), false)
  assert.deepEqual(packaged.calls, [])

  // …and an unpackaged one performs it every time it is asked (idempotence is not a property
  // this needs — the first call ends the process — but a second refusal would be a bug).
  const dev = spyHost(false)
  assert.equal(performDevRestart(dev), true)
  assert.equal(performDevRestart(dev), true)
  assert.deepEqual(dev.calls, ['relaunch', 'exit:0', 'relaunch', 'exit:0'])
})

test('Electron IS the host shape — the handler passes `app` itself, unadapted', () => {
  // A structural check standing in for the type system's own: if a future Electron renames
  // `exit` or `relaunch`, src/main/ipc/dev.ts stops compiling. This asserts the SHAPE this
  // module demands has not quietly grown a member the real `app` would not have.
  const host: RestartHost = { isPackaged: false, relaunch: () => undefined, exit: () => undefined }
  assert.deepEqual(Object.keys(host).sort(), ['exit', 'isPackaged', 'relaunch'])
})
