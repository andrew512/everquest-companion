// roster.ts — the slice of the main app's bridge that is about WHO YOU ARE GROUPED WITH
// (docs/plans/group-model.md §3).
//
// A separate file for FILE MASS, not for scope: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the rule here is to split rather than ratchet (windows.ts and
// perf.ts are the same pattern). This object is spread into that bridge, so both methods below
// are ordinary members of the one `window.eq` surface.
//
// WRITES ONLY, and that asymmetry is the design rather than an omission. The roster READ path is
// `CombatSnapshot.roster`: it rides the snapshot both meter surfaces already poll, so the scope
// chip and the rows it filters are answered by ONE call and can never describe two different
// groups. Only the corrections need a channel of their own.
//
// These are the top rung of the provenance ladder (user > joined > stated > confirmed) and the
// only roster state that survives a replay — everything else is re-derived from the log every
// time. The name is re-validated and canonicalized in main against the same pattern the parser
// requires: a name the parser could never produce is a key that could never match, and storing
// one would be a permanent silent no-op.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ComboWriteResult } from './index'

export const rosterApi = {
  /** "This person is with me" / "this person is not." Outranks the log until the epoch. */
  setRosterEdit: (edit: { name: string; action: 'add' | 'remove' }): Promise<ComboWriteResult> =>
    ipcRenderer.invoke(IPC.rosterSetEdit, edit),
  /** "Let the log decide again" — forget the hand-made statement about this name. */
  clearRosterEdit: (name: string): Promise<ComboWriteResult> =>
    ipcRenderer.invoke(IPC.rosterClearEdit, { name }),

  // ---- pet claims (JOS-47) ----
  // Beside the roster because they are the same kind of thing said about a different subject:
  // the user answering a question the log cannot. Write-only for the same reason — the offer
  // and the answer both ride `CombatSnapshot.petClaims`.
  /** "That one is mine" / "that one is not." A claim re-runs the replay in main, so the pet's
   *  whole history arrives at once; the promise resolves when it has. */
  setPetClaim: (edit: { name: string; action: 'claim' | 'deny' }): Promise<ComboWriteResult> =>
    ipcRenderer.invoke(IPC.petClaimSet, edit),
  /** "Ask me again" — forget the statement about this name. */
  clearPetClaim: (name: string): Promise<ComboWriteResult> =>
    ipcRenderer.invoke(IPC.petClaimClear, { name })
}
