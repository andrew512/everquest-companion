// IPC: the RESPAWN WATCH LIST (JOS-194 — shared/respawn.ts).
//
// One channel pair over the only thing about respawn clocks that is not derived from the log:
// which mobs you want a clock for, and the number you typed if you typed one.
//
// THE SETTER MUST DO THREE THINGS, AND MISSING ANY ONE IS A SILENT WRONG ANSWER. This is JOS-87's
// lesson applied to a module that has the same shape as the one it was learned on (a second input
// that advances no log seq):
//
//   1. PERSIST — through `normalizeRespawnPrefs`, the SAME normalizer the store reader uses, so a
//      renderer and a hand-edited settings file cannot hold two ideas of what a watch is. Validated
//      at the handler and never trusted because today's only caller is the app's own UI (the
//      `sounds:getData` rule).
//   2. APPLY LIVE — `setPrefs` on the running module, which bumps its private revision. Waiting for
//      the next launch would make "watch this mob" do nothing until you restart.
//   3. PUSH NOW — `registry.flushNow()`. `setPrefs` marks the module dirty, but the flush that
//      carries it is on a 1 s heartbeat that only runs while the tail is LIVE. A user adding a
//      watch is by definition looking at the screen, and quite possibly parked in a zone with an
//      idle log; without this the row appears whenever the next log line happens to arrive, which
//      on an idle log is never. The combo module's `republish()` is the precedent.
//
// The GET exists for the same reason its siblings' do: the renderer's editor mounts before any
// module delta has necessarily arrived, and the prefs also ride inside the module snapshot, so
// this is the cheap read that does not depend on the fold's timing.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { getRespawnPrefs, setRespawnPrefs } from '../storeRespawn'
import { registry, respawnModule } from '../pipeline'

/**
 * Longest row id the confirm handler will look at. A row id is `<zone key>::<mob key>` and both
 * halves are already bounded by the log's own names; this is the handler-side refusal that keeps a
 * renderer-supplied string from reaching a Map lookup unmeasured (the `sounds:getData` rule — the
 * validation belongs at the door, not at the one caller that exists today).
 */
const MAX_ROW_ID = 160

export function registerRespawnIpc(): void {
  ipcMain.handle(IPC.respawnGet, () => getRespawnPrefs())
  ipcMain.handle(IPC.respawnSet, (_e, value: unknown) => {
    const next = setRespawnPrefs(value)
    respawnModule.setPrefs(next)
    registry.flushNow()
    return next
  })
  /**
   * CONFIRM A SIGHTING (round 3). Two of the setter's three duties apply and the third does not:
   * it applies live and it pushes now, but it PERSISTS NOTHING. The confirmation is a judgement
   * about one spawn of one mob in one session; the fold it lives in is rebuilt from the log at
   * every launch and the log has never heard of it, so a stored copy would outlive its subject
   * (the argument is written out in shared/respawn.ts).
   *
   * It is a no-op — reported honestly as `false` — when the id is unknown or the row is no longer
   * seen, which is what a click racing a death looks like.
   */
  ipcMain.handle(IPC.respawnConfirmSighting, (_e, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ROW_ID) return false
    const applied = respawnModule.confirmSighting(id)
    if (applied) registry.flushNow()
    return applied
  })
}
