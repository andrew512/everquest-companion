// BuffsOverlay (JOS-89) — the 'buffs' overlay kind: your self buffs, the debuffs you put on each
// target, and a per-enemy crowd-control clock, so a chain-mez shows a named countdown per enemy.
// Design record: docs/plans/buff-timer-overlay.md.
//
// Ten user reports converge on this window. It ships DEFAULT OFF (store.ts DEFAULT_OVERLAY_CONFIG,
// no migration) for internal validation before promotion — the owner's direction.
//
// A sibling of OverlayMeter and EventLogOverlay in the SAME overlay.html bundle (kind read from
// `?kind=`), so it shares every piece of per-kind machinery: the persisted `overlays.buffs`
// config, drag/resize, the bg-alpha slider, the text-scale stepper and the lock (pin) semantics.
// Plain divs + inline styles, no MUI — the window has to be cheap to paint over the game.
//
// DATA: TWO modules, composed by ONE pure function. `buffs` owns the instances (self buffs,
// per-target debuffs, the DB duration prior, own-cast gating, the death/zone censoring); the
// small `buffTimers` module owns the per-target mez holds the buff model does not track. Neither
// is re-folded here — `shared/buffTimers.ts buildTimerRows` is the projection, is pure, and is
// what tests/buffTimers.test.mts drives over real fixture bytes. This file only draws it.
//
// THE HONESTY LAW ON SCREEN: a receding bar means spells.json STATED a duration. A row with no
// bar and a `+` before its time is counting UP because nobody states one. The overlay never
// renders a remaining it had to invent — see buffTimerBars.tsx.
//
// WHY IT TICKS ITSELF: the module deltas arrive when the LOG moves, and a buff running out is
// precisely the moment the log is silent. A 1 Hz local clock re-reads rows the renderer already
// holds; it asks main for nothing.

import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import type { BuffsSnap, ModuleDelta } from '@shared/types'
import { type BuffTimerRow, type BuffTimersSnap, buildTimerRows } from '@shared/buffTimers'
import { OverlayHeader } from './OverlayHeader'
import { OverlayContent } from './overlayScale'
import { TextScaleStepper } from './TextScaleStepper'
import { type OverlayChrome, useOverlayChrome } from './useOverlayChrome'
import { BuffTimerGroup } from './buffTimerBars'

const GOLD = '#d9b25f'

const EMPTY_BUFFS: BuffsSnap = { active: [], stats: {} }
const EMPTY_TIMERS: BuffTimersSnap = { holds: [], ends: [] }

/**
 * Hydrate one whole-snapshot module and ride its deltas. Both modules here ship their ENTIRE
 * state on every flush (`BuffsDelta = BuffsSnap`, `BuffTimersDelta = BuffTimersSnap`), so
 * applying a delta is a replace and there is nothing to accumulate.
 *
 * A `log:character` rebuild resets a module and its seq restarts low, so a delta whose seq went
 * BACKWARDS re-hydrates rather than being dropped forever — the same rule `useModule` enforces in
 * the app and `EventLogOverlay` enforces here.
 */
function useWholeSnapshot<S>(moduleId: string, empty: S): S {
  const [state, setState] = useState<S>(empty)
  const seqRef = useRef(-1)

  useEffect(() => {
    let alive = true
    const hydrate = (): void => {
      void window.eqOverlay.getModuleSnapshot<S>(moduleId).then((snap) => {
        if (!alive || !snap) return
        seqRef.current = snap.seq
        setState(snap.state)
      })
    }
    hydrate()
    const off = window.eqOverlay.onModuleDelta<S>((d: ModuleDelta<S>) => {
      if (d.moduleId !== moduleId) return
      if (d.seq <= seqRef.current) {
        if (d.seq < seqRef.current) hydrate()
        return
      }
      seqRef.current = d.seq
      setState(d.delta)
    })
    return () => {
      alive = false
      off()
    }
  }, [moduleId])

  return state
}

/** A local 1 Hz clock. A timer must recede while the log is idle, which is exactly when no delta
 *  is coming; every row already carries its own `startedTs`, so this costs one render a second
 *  and zero IPC. */
function useSecondsClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [])
  return now
}

/**
 * "Flash when a positive spell drops" — one of the ten reports' asks, and pure renderer state.
 *
 * It watches the row set it is ALREADY holding and reports a `kind: 'buff'` row that disappeared.
 * That is deliberately the weakest possible claim: it fires only on a removal the MODEL already
 * believed (a wears-off message, a death, a zone), so it can never announce a drop the log did
 * not state. It does not fire for the first snapshot, which would otherwise announce an empty
 * hydrate as N drops.
 */
function useDropFlash(rows: BuffTimerRow[], nowMs: number): { name: string; at: number }[] {
  const prevRef = useRef<Map<string, string> | null>(null)
  const [drops, setDrops] = useState<{ name: string; at: number }[]>([])

  useEffect(() => {
    const current = new Map(rows.filter((r) => r.kind === 'buff').map((r) => [r.id, r.name]))
    const prev = prevRef.current
    prevRef.current = current
    if (prev === null) return
    const gone: { name: string; at: number }[] = []
    for (const [id, name] of prev) if (!current.has(id)) gone.push({ name, at: Date.now() })
    if (gone.length > 0) setDrops((d) => [...d, ...gone].slice(-3))
  }, [rows])

  return drops.filter((d) => nowMs - d.at < DROP_FLASH_MS)
}

const DROP_FLASH_MS = 6_000

/** Footer — interactive mode only: the bg-alpha slider + text size, matching every other kind. */
function BuffsFooter({
  bgAlpha,
  textScale,
  patch,
  noDrag
}: {
  bgAlpha: number
  textScale: number
  patch: OverlayChrome['patch']
  noDrag: React.CSSProperties
}): JSX.Element {
  return (
    <div
      style={{
        ...noDrag,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 8px 5px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        fontSize: 10,
        color: 'rgba(255,255,255,0.6)',
        flexShrink: 0
      }}
    >
      <span title="Background opacity" style={{ flexShrink: 0 }}>
        bg
      </span>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.02}
        value={bgAlpha}
        onChange={(e) => {
          patch({ bgAlpha: Number(e.target.value) })
        }}
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 24, accentColor: GOLD, height: 4 }}
      />
      <TextScaleStepper textScale={textScale} patch={patch} noDrag={noDrag} />
    </div>
  )
}

/** Self rows first, then one block per target — the order `buildTimerRows` already produced; this
 *  only cuts it into the blocks the eye reads. */
function groupRows(rows: BuffTimerRow[]): { key: string; label: string; inferred: boolean; rows: BuffTimerRow[] }[] {
  const out: { key: string; label: string; inferred: boolean; rows: BuffTimerRow[] }[] = []
  for (const row of rows) {
    const key = row.group === 'self' ? 'self' : (row.targetKey ?? 'unknown')
    const last = out[out.length - 1]
    if (last?.key === key) {
      last.rows.push(row)
      last.inferred = last.inferred || row.inferredTarget === true
      continue
    }
    out.push({
      key,
      label: row.group === 'self' ? 'Your buffs' : (row.target ?? 'Unknown target'),
      inferred: row.inferredTarget === true,
      rows: [row]
    })
  }
  return out
}

export default function BuffsOverlay(): JSX.Element {
  const buffs = useWholeSnapshot<BuffsSnap>('buffs', EMPTY_BUFFS)
  const timers = useWholeSnapshot<BuffTimersSnap>('buffTimers', EMPTY_TIMERS)
  const nowMs = useSecondsClock()
  const { locked, bgAlpha, textScale, hovering, patch, toggleLock, onEnter, onLeave, dragRegion, noDrag } =
    useOverlayChrome()

  const rows = useMemo(() => buildTimerRows(buffs, timers), [buffs, timers])
  const groups = useMemo(() => groupRows(rows), [rows])
  const drops = useDropFlash(rows, nowMs)

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-testid="buffs-overlay"
      style={{
        // 100%, NOT 100vw/100vh — a viewport unit inside the scaled content pane resolves against
        // the window and is then zoomed (overlayScale).
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif',
        color: '#f2f2f2',
        background: `rgba(14,17,21,${bgAlpha})`,
        border: locked ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(217,178,95,0.4)',
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {/* The same one-row header every kind draws, minus the selector: this kind has nothing to
          select — it shows what is on you and on your targets right now, which is one live set,
          not a set of segments. The lock pin and the close ✕ come from HeaderControls. */}
      <OverlayHeader
        tag="BUFFS"
        title="Buffs & timers"
        titleColor={GOLD}
        tail={String(rows.length)}
        tailTitle="Tracked buffs, debuffs and holds"
        tailColor="rgba(255,255,255,0.5)"
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock }}
      />

      {/* A growing list in a fixed-height scroll box (AGENTS.md: a growing list never sizes to its
          content), which is also the one place the text scale applies — the chrome above and
          below stays at 1 so it cannot be pushed out of a small window. */}
      <OverlayContent textScale={textScale} testId="buff-timer-rows">
        {groups.length === 0 ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '8px 2px' }}>
            Watching for buffs you cast, debuffs you land, and mez you hold…
          </div>
        ) : (
          groups.map((g) => (
            <BuffTimerGroup key={g.key} label={g.label} inferred={g.inferred} rows={g.rows} nowMs={nowMs} />
          ))
        )}

        {drops.map((d) => (
          <div
            key={`${d.name}-${d.at}`}
            data-testid="buff-timer-drop"
            style={{ fontSize: 10, color: '#e07a6a', padding: '2px 4px' }}
          >
            {d.name} dropped
          </div>
        ))}
      </OverlayContent>

      {!locked && <BuffsFooter bgAlpha={bgAlpha} textScale={textScale} patch={patch} noDrag={noDrag} />}
    </div>
  )
}
