// ============================================================================
// serveCommands.ts — THE APP'S OWN COMMANDS, SENT TO THE ENGINE TOO (JOS-493).
// ============================================================================
//
// `serveShim.ts` is the READ half of the cutover and `serveDeltas.ts` is its notification half.
// This is the third kind of traffic, and it is the smallest: a USER ACTION that changes what a fold
// produces, applied to this process's world and stated to the engine's in the same breath.
//
// ── ONE ACTION, ONE INSTANT, EVERY WORLD ───────────────────────────────────────────────────────
//
// `sessionMarks.ts` already carries the owner's law for the only member so far: pressing "New
// session" splits EVERYTHING at once, so main stamps `Date.now()` ONCE and hands that very number to
// the combat engine and to the loot ledger — a second clock read would be a second boundary, and
// everything looted in between would fall on the wrong side of one of them. The engine is a third
// holder of the same boundary and gets the SAME number, for the same reason and by the same rule;
// `SessionMarkAddParams.at` says so on the wire ("the caller's clock rather than the engine's").
//
// ── FIRE AND FORGET, AND WHY THAT IS NOT LAXITY ────────────────────────────────────────────────
//
// `definePush.ts`'s rule, restated for a command: the user's click is answered by the app's own
// state, which has already moved by the time this is called. So nothing waits on the round trip and
// nothing branches on it — an engine that refused is a dev-log line, not a failed press. And a
// refusal is EXPECTED rather than exceptional: the protocol says `sessionMarks.add` can honestly
// answer `not now` while the engine's historical fold is running, which is the same state this
// process's own `combat.sessionMark(at)` refuses in.
//
// THE APP'S OWN ANSWER IS STILL THE GATE. `pressNewSession` calls this only after its own two halves
// have both accepted — see that file's "both halves or neither". A mark the app itself declined must
// not be announced to a third world as though it happened.
//
// ── THE FOLD-SIDE SPLIT IS NOT THIS FILE'S ─────────────────────────────────────────────────────
//
// What the engine DOES with the mark — splitting its zone records the way `combat/engine.ts` splits
// this process's — is JOS-492's work in `engine/`. This ticket is the WIRING, and it lands
// independently on purpose: the command reaching the engine and being acked is a claim that can be
// made and pinned today, and it is the half that has to exist before the other half can be observed
// at all.

import { logInfo } from '../errorLog'
import { engineRequest } from './engineClientHost'
import { shimServing } from './serveShim'

function note(line: string): void {
  logInfo(`[everquest-companion] ${line}`)
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * "THE USER PRESSED NEW SESSION AT `at`" — told to the engine, if this launch is serving from one.
 *
 * SYNCHRONOUS BY SIGNATURE because its caller is: `pressNewSession` returns the new mark list to the
 * window that pressed, and a press must never be made to wait on a socket.
 */
export function serveSessionMark(at: number): void {
  if (!shimServing()) return
  void engineRequest('sessionMarks.add', { at }).then(
    (ack) => {
      note(
        `data-server sessionMark: ${String(at)} — ` +
          (ack.accepted ? 'the engine split its records' : `the engine said not now (${ack.status})`)
      )
    },
    (err: unknown) => {
      note(`data-server sessionMark: ${String(at)} — the engine refused it (${describeErr(err)})`)
    }
  )
}
