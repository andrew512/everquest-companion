// alertsEarlyWarning.ts — the SCHEDULER behind an alert's early-warning offset (JOS-216).
//
// The offset itself, its bounds and the rule that picks which timer row a landing is tracked by are
// in `shared/earlyWarning.ts`; the user-facing meaning is on `AlertDef.earlyWarnSec`. THIS file is
// the state machine in between: it holds the warnings that are armed, advances them on the
// registry's 1-second heartbeat, and hands back the ones that have come due.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY AN ARM IS RESOLVED ON THE NEXT TICK AND NOT AT THE MATCH.
//
// The alerts module is registered BEFORE buffs and buffTimers (modules/wiring.ts), so at the
// instant a mez landing matches an alert, the row that landing produces DOES NOT EXIST YET — the
// two modules that build it have not folded the event. Looking the row up in `onEvent` would find
// the PREVIOUS state of the world every single time. So a match files an ARM REQUEST carrying what
// the landing was about, and the next heartbeat — by which point every module has folded the same
// event — resolves it against the projection. A resolution delay of up to a second is invisible on
// a warning measured in tens of seconds, and it is the only ordering in which the answer is right.
//
// A request that finds no row within {@link ARM_RESOLVE_WINDOW_MS} is DROPPED, silently and on
// purpose: it means the model states no countdown for that landing (an unresolved spell family, a
// duration nobody states, a debuff somebody else cast), and there is no honest end to count back
// from. Silence is world-model law 1 applied to a schedule.
//
// ─────────────────────────────────────────────────────────────────────────────
// AND WHY CANCELLATION IS "THE ROW IS GONE", RATHER THAN A LIST OF ENDINGS.
//
// A pending warning must not fire when the debuff already broke — the mob died, a nuke woke it, you
// zoned, someone dispelled it. Enumerating those endings here would be a second opinion about a
// question the timer model already answers, and it would drift from it (that is the two-models scar
// world-model law 4 is made of). Every one of them removes the row from `buildTimerRows`, so the
// cancellation rule is exactly one sentence: no row, no warning. It is also self-correcting for
// endings nobody has thought of yet.
//
// The deadline is RE-READ from the row on every tick for the same reason. The learner can raise an
// estimate mid-hold (a sample that beats the DB floor re-states every live bar), and a re-land moves
// the landing — a warning that had fixed its own deadline would be describing a countdown the app
// had already corrected.

import { idKey } from '../log/parseCommon'
import { earlyWarnFireAt, earlyWarnRowFor, type EarlyWarnSubject } from '../../shared/earlyWarning'
import type { BuffTimerRow } from '../../shared/buffTimers'
import type { LogEvent } from '../../shared/logEvents'
import type { FiredAlert } from '../../shared/types'

/**
 * How long an unresolved arm request keeps looking for its row.
 *
 * Generous by design and still short: the row it is waiting for is created by the SAME event that
 * armed it, so on the ordinary path it is already there on the first tick. Five seconds is the
 * slack for a heartbeat that was busy, not a window in which a row might still turn up.
 */
export const ARM_RESOLVE_WINDOW_MS = 5_000

/**
 * The most warnings held at once, across every alert.
 *
 * A BOUND, not a policy. One warning per landing per alert, and an AE mez plus a chain of adds can
 * legitimately arm a dozen; anything past this is a def matching something far broader than its
 * author meant. Oldest-armed is dropped first (insertion order), because it is the one closest to
 * having resolved or expired anyway.
 */
export const MAX_ARMED_WARNINGS = 200

/**
 * The separator in an armed warning's key — a NUL, which can appear in no alert id and in no row
 * id, so an alert can never collide with another alert's row.
 *
 * BUILT rather than written, because AGENTS.md's rule is that a NUL is never a raw byte in a source
 * file (git calls the file binary and diffs/blame/grep go dark). `cooldownKey` in modules/alerts.ts
 * spells the same character as an escape inside a template literal; this is the same value.
 */
const KEY_SEP = String.fromCharCode(0)

/** One armed warning as the caller files it: the firing it will make, and what to track it by. */
export interface EarlyWarnArm {
  /** The offset in seconds, already normalized (shared/earlyWarning.ts). */
  sec: number
  /** The cooldown clock this firing belongs to — computed from the ARMING event, spent at the fire. */
  cooldownKey: string
  /** Which landing this is, so the row can be found once the world has folded it. */
  subject: EarlyWarnSubject
  /** Event ts (ms) of the landing — the clock the resolve window is measured on. */
  ts: number
  /** The firing this warning will make, built at match time so it says what the LANDING matched. */
  fired: FiredAlert
}

/** A warning that has come due: the firing to make, and the clock to spend for it. */
export interface EarlyWarnDue {
  cooldownKey: string
  fired: FiredAlert
}

/** An arm that has found its row. `rowId` is the whole identity — its absence is the cancellation. */
interface Armed extends EarlyWarnArm {
  rowId: string
}

/**
 * WHAT A LANDING WAS ABOUT, from the event that carried it.
 *
 * The entity is read dynamically from `mob` (the CC/charm families) then `target` (the buff
 * families) — the same arbitrary-field access a `where` matcher has always done, because these are
 * fields of some LogEvent shapes and not others. `buffApply` spells a self-landing as the literal
 * string 'self', which is the model's own word for "the player" and is why it maps to no entity key
 * rather than to a mob called self.
 *
 * `spellNames` is handed in rather than derived here: the caller has already resolved which names
 * this event can answer to (JOS-84's candidate widening, modules/alerts.ts), and re-deriving them
 * would be a second copy of that rule.
 */
export function earlyWarnSubject(ev: LogEvent, spellNames: readonly string[]): EarlyWarnSubject {
  const r = ev as unknown as Record<string, unknown>
  let entity: string | undefined
  for (const field of ['mob', 'target']) {
    const v = r[field]
    if (typeof v !== 'string' || v.trim() === '') continue
    entity = v.trim().toLowerCase() === 'self' ? undefined : idKey(v)
    break
  }
  return { ...(entity ? { targetKey: entity } : {}), spellNames: [...spellNames] }
}

/** The armed early warnings, advanced by the alerts module's heartbeat. */
export class EarlyWarnings {
  /** The timer projection, injected by the wiring. Empty until something hands over the real one. */
  private rows: () => readonly BuffTimerRow[] = () => []
  /** Arms still looking for their row (see the header on why this is not resolved at match time). */
  private pending: EarlyWarnArm[] = []
  /** Warnings tracking a live row, keyed by `<alertId>\0<rowId>` — one per alert per row. */
  private armed = new Map<string, Armed>()

  /** Where the timer rows come from (modules/wiring.ts hands over the real projection). */
  setRowSource(rows: () => readonly BuffTimerRow[]): void {
    this.rows = rows
  }

  reset(): void {
    this.pending = []
    this.armed = new Map()
  }

  /** True when nothing is waiting — the caller skips reading the projection entirely. */
  get idle(): boolean {
    return this.pending.length === 0 && this.armed.size === 0
  }

  /** File a warning for a landing that just matched an alert with an offset. */
  arm(req: EarlyWarnArm): void {
    this.pending.push(req)
    if (this.pending.length > MAX_ARMED_WARNINGS) this.pending.shift()
  }

  /**
   * Advance to `nowMs`: resolve what can be resolved, cancel what has ended, and hand back the
   * warnings that have come due. Reads the projection at most ONCE, and not at all when idle.
   */
  tick(nowMs: number): EarlyWarnDue[] {
    if (this.idle) return []
    const rows = this.rows()
    this.resolve(rows, nowMs)
    return this.advance(rows, nowMs)
  }

  /** Turn arm requests into armed warnings, discarding the ones the model states no end for. */
  private resolve(rows: readonly BuffTimerRow[], nowMs: number): void {
    if (this.pending.length === 0) return
    const keep: EarlyWarnArm[] = []
    for (const p of this.pending) {
      const row = earlyWarnRowFor(rows, p.subject)
      if (!row) {
        if (nowMs - p.ts <= ARM_RESOLVE_WINDOW_MS) keep.push(p)
        continue
      }
      // Re-arming the same (alert, row) REPLACES: a fresh landing on a row already being watched is
      // the same warning moved, never a second one.
      // The separator is a NUL, SPELLED AS AN ESCAPE and never written as a raw byte (AGENTS.md):
      // a row id carries mob and spell names, so nothing printable is safe to split on. Same
      // reasoning — and the same character — as `cooldownKey` in modules/alerts.ts.
      this.armed.set(p.fired.alertId + KEY_SEP + row.id, { ...p, rowId: row.id })
      if (this.armed.size > MAX_ARMED_WARNINGS) {
        const oldest = this.armed.keys().next()
        if (!oldest.done) this.armed.delete(oldest.value)
      }
    }
    this.pending = keep
  }

  /**
   * Cancel the warnings whose row has gone, and collect the ones that are due.
   *
   * A deadline ALREADY IN THE PAST fires on this very tick, which is the honest degradation for an
   * offset longer than the debuff (warn 30 s early on a 24 s mez): the warning is as early as the
   * spell allows, rather than silently never arriving.
   */
  private advance(rows: readonly BuffTimerRow[], nowMs: number): EarlyWarnDue[] {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const due: EarlyWarnDue[] = []
    for (const [key, a] of [...this.armed]) {
      const row = byId.get(a.rowId)
      // No row: the hold ended — a break line, a death, a zone, a cull. Nothing left to warn about.
      const at = row ? earlyWarnFireAt(row, a.sec) : undefined
      if (at === undefined) {
        this.armed.delete(key)
        continue
      }
      if (nowMs < at) continue
      this.armed.delete(key)
      due.push({ cooldownKey: a.cooldownKey, fired: a.fired })
    }
    return due
  }
}
