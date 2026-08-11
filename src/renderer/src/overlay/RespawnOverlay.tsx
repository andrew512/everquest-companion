// RespawnOverlay (JOS-194) — the respawn clocks, floating over the game.
//
// This window is the whole point of the ticket in practice. A respawn timer you have to alt-tab to
// read is a timer you do not read; the corroborating report (01KZQ4X16MPDKQ2CF4SY35P5ED) is from
// somebody who left a tool that put named-mob clocks on screen and missed them. So the Timers tab
// is where you SET this up and this window is where you USE it.
//
// IT DERIVES NOTHING AND FOLDS NOTHING. Every row is the `respawn` module's own, composed by the
// same pure helpers the tab reads (`orderRespawnRows`, `respawnReading`, `respawnSourceLabel`) —
// a second opinion about which mob is due soonest, one process away from the first, is exactly the
// drift the shared/ split exists to prevent.
//
// IT SHOWS THE ZONE YOU ARE IN, AND NOTHING ELSE (owner ruling after the first hands-on round,
// 2026-08-10). The fold keeps every zone it has walked through, and this window used to draw all of
// them — so a Befallen camp put four Guk clocks over the game, none of which anybody could act on.
// The filter is `respawnInZone(snap.rows, snap.zone)`: the module's OWN zone-stay state, published
// in the snapshot, applied by the shared helper the Timers tab also calls. Nothing is derived here
// and no second zone is tracked. A clock in another zone is not hidden data — it is still in the
// fold and still on the tab's all-zones view — it is just not something this window can help with,
// and that includes one that has come DUE (see the helper's header).
//
// IT TICKS ITSELF, at 1 Hz, because a countdown is the one thing in this app that must keep moving
// while the log is silent — and a row carries its own `baseTs`, so ticking costs no IPC at all.
// (The XP window's clock is 30 s for the opposite reason: nothing in it is a countdown.)
//
// AND IT IS WHERE THE ROUND-3 RULING HAS TO LAND (owner, 2026-08-10). The defect was reported from
// live play: the mob was hitting him and the row over the game still read "due 4m ago". So a row
// the log has NAMED since its clock started reads UP here, in its own colour, sorted to the top —
// and the affordance that re-bases the clock onto that sighting lives here too, in INTERACTIVE
// mode, because a locked window is click-through by law and has no clicks to give. Confirming from
// the Timers tab is the same call on the same module (`confirmRespawnSighting`); this window simply
// spares you the alt-tab in the one moment the feature is for.
//
// AND ROUND 4 LANDS HERE FOR THE SAME REASON (owner, 2026-08-10). Unwatching used to mean finding
// the name in the watch list at the bottom of the Timers tab — i.e. alt-tabbing out of the game to
// get rid of a row that is wrong about the mob in front of you, which on EQ's duplicated names is
// the common case. So a row here carries its own Unwatch, in INTERACTIVE mode only, beside the
// confirm affordance and under the same law: a locked window is click-through and has no clicks to
// give. It stops that NAME everywhere, including zones this window does not show, and the button's
// title says so — the row it removes from another zone is off screen here by construction.
//
// MUI-FREE, plain divs and inline styles, like every file in this bundle.

import { type JSX, useEffect, useState } from 'react'
import {
  EMPTY_RESPAWN_SNAP,
  RESPAWN_UNWATCH_LABEL,
  mergeRespawnDelta,
  orderRespawnRows,
  respawnUnwatchTitle,
  respawnBasisLabel,
  respawnClockLabel,
  respawnInZone,
  respawnReading,
  respawnSeenLabel,
  respawnSourceLabel,
  type RespawnDelta,
  type RespawnRow,
  type RespawnSnap
} from '@shared/respawn'
import { fmtDuration } from '../features/buffs/format'
import { OverlayHeader } from './OverlayHeader'
import { OverlayContent } from './overlayScale'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayModule } from './useOverlayModule'
import { type OverlayChrome, useOverlayChrome } from './useOverlayChrome'

/** This window's accent — a warm amber, deliberately none of the four already in use (damage gold,
 *  healing green, debuff red, XP blue). Two windows that look alike at a glance would be worse. */
const ACCENT = '#e8b45f'
const ACCENT_BG = 'rgba(232,180,95,0.2)'
/** A clock that has run out. Green, so "go look" is readable in peripheral vision. */
const DUE = '#7fd18b'
/**
 * THE LOG SAID IT IS THERE. Deliberately not green and not the window's amber: `due` and `seen`
 * are different kinds of claim — one is this app's estimate elapsing, the other is the game naming
 * the mob — and a player glancing at this window in peripheral vision has to be able to tell them
 * apart without reading a word. Red-pink also happens to be what the moment actually is: the
 * report that produced this ruling is a mob standing on top of the owner, hitting him.
 */
const SEEN = '#ff6b8a'

/** One second. A countdown is the one number in this app that has to move while the log is idle. */
const TICK_MS = 1000

function useSecondsClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [])
  return now
}

/** What the confirm button will and will not do, on the one control that can move a clock here. */
const CONFIRM_TITLE =
  'The log named this mob, so it is up - but a sighting does not say when it spawned, so nothing ' +
  'has been changed. Click to start this clock from that sighting. A death message afterwards ' +
  'takes the clock straight back.'

/**
 * The seen line, and the button that is the whole of the second ruling. Its own component because
 * `RespawnLine` is at the repo's factoring ceiling — and because the button exists only where a
 * click can land: a LOCKED overlay is click-through by law and passes them to the game.
 */
function SeenLine({
  row,
  nowMs,
  interactive,
  onConfirm
}: {
  row: RespawnRow
  nowMs: number
  interactive: boolean
  onConfirm: (rowId: string) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
      <span data-testid="respawn-overlay-seen" style={{ fontSize: 9, color: SEEN, flexGrow: 1, minWidth: 0 }}>
        {respawnSeenLabel(row, nowMs, fmtDuration)}
      </span>
      {interactive && (
        <button
          type="button"
          data-testid="respawn-overlay-confirm"
          title={CONFIRM_TITLE}
          onClick={() => {
            onConfirm(row.id)
          }}
          style={{
            flexShrink: 0,
            fontSize: 9,
            lineHeight: 1.4,
            padding: '0 4px',
            color: SEEN,
            background: 'transparent',
            border: `1px solid ${SEEN}66`,
            borderRadius: 3,
            cursor: 'pointer'
          }}
        >
          start clock here
        </button>
      )}
    </div>
  )
}

/**
 * THE ROW'S OWN WAY OUT (round 4), and the second control on this window that exists only while it
 * is unlocked. Deliberately dim — it is the least urgent thing on a row whose whole job is a
 * countdown — and deliberately a WORD rather than an ×, which on a floating window reads as "close
 * this thing" and would be a lie: nothing closes and nothing derived from the log is lost.
 */
function UnwatchButton({ row, onUnwatch }: { row: RespawnRow; onUnwatch: (key: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      data-testid="respawn-overlay-unwatch"
      title={respawnUnwatchTitle(row.display)}
      onClick={() => {
        onUnwatch(row.key)
      }}
      style={{
        flexShrink: 0,
        fontSize: 9,
        lineHeight: 1.4,
        padding: '0 4px',
        color: 'rgba(255,255,255,0.55)',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 3,
        cursor: 'pointer'
      }}
    >
      {RESPAWN_UNWATCH_LABEL.toLowerCase()}
    </button>
  )
}

/**
 * THE FULL PROVENANCE SENTENCE, on the native title — the same place the tab's tooltip puts it. A
 * floating window has no room to print this and no right to hide it.
 *
 * Its own function because `RespawnLine` is at the repo's `complexity` ceiling and this is where
 * three of its branches were; the string is the row's, not the layout's.
 */
function rowTitle(row: RespawnRow, basis: string): string {
  const wiki = row.wikiText === undefined ? '' : ` · wiki: "${row.wikiText}"`
  return `${respawnSourceLabel(row)}${wiki}${basis.length > 0 ? ` · ${basis}` : ''}`
}

/** One clock. Name on the left, the number on the right, the provenance underneath in dim text. */
function RespawnLine({
  row,
  nowMs,
  interactive,
  onConfirm,
  onUnwatch
}: {
  row: RespawnRow
  nowMs: number
  /** The window is UNLOCKED. A locked overlay is click-through, so it draws no button at all. */
  interactive: boolean
  onConfirm: (rowId: string) => void
  /** Round 4: stop watching this mob from here, without alt-tabbing to the tab's list. */
  onUnwatch: (key: string) => void
}): JSX.Element {
  const r = respawnReading(row, nowMs)
  const hasEstimate = row.estimateMs !== undefined
  // The clock's WORDING is the tab's, from shared/respawn.ts — a countdown must not read one way
  // in the app and another way over the game. That includes the UP a seen row shows instead.
  const label = respawnClockLabel(row, nowMs, fmtDuration)
  const tone = r.seen ? SEEN : r.due ? DUE : ACCENT
  const basis = respawnBasisLabel(row)
  return (
    <div
      data-testid="respawn-overlay-row"
      data-respawn-mob={row.key}
      data-respawn-due={r.due ? 'true' : 'false'}
      data-respawn-seen={r.seen ? 'true' : 'false'}
      data-respawn-basis={row.basis}
      title={rowTitle(row, basis)}
      style={{ padding: '2px 2px 3px', borderLeft: `2px solid ${tone}66`, paddingLeft: 5 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: 11.5,
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {row.display}
        </span>
        <span
          data-testid="respawn-overlay-clock"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: tone,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0
          }}
        >
          {label}
        </span>
        {/* After the number, so the countdown keeps its place on every row. */}
        {interactive && <UnwatchButton row={row} onUnwatch={onUnwatch} />}
      </div>
      {/* The bar is the estimate running down. Absent entirely when there is no estimate, rather
          than drawn empty — an empty bar reads as "nearly up", which would be a lie. */}
      {hasEstimate && (
        <div style={{ height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 2 }}>
          <div
            style={{
              height: '100%',
              width: `${String(Math.round((1 - r.fraction) * 100))}%`,
              background: tone,
              borderRadius: 2
            }}
          />
        </div>
      )}
      {/* NOTHING RE-BASES ITSELF — the affordance below is the only path to `basis: 'sighting'`. */}
      {r.seen && (
        <SeenLine row={row} nowMs={nowMs} interactive={interactive} onConfirm={onConfirm} />
      )}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.42)', marginTop: 1 }}>
        {row.source === 'observed' ? '<= ' : ''}
        {hasEstimate ? fmtDuration(row.estimateMs) : 'no estimate'} · {respawnSourceLabel(row)}
        {basis.length > 0 ? ' · re-based' : ''}
      </div>
    </div>
  )
}

function RespawnFooter({
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
        gap: 6,
        padding: '3px 8px 5px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0
      }}
    >
      <input
        type="range"
        title="Background opacity"
        min={0.1}
        max={1}
        step={0.02}
        value={bgAlpha}
        onChange={(e) => {
          patch({ bgAlpha: Number(e.target.value) })
        }}
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 20, accentColor: ACCENT, height: 4 }}
      />
      <TextScaleStepper textScale={textScale} patch={patch} noDrag={noDrag} />
    </div>
  )
}

export default function RespawnOverlay(): JSX.Element {
  const snap = useOverlayModule<RespawnSnap, RespawnDelta>('respawn', mergeRespawnDelta, EMPTY_RESPAWN_SNAP)
  const { locked, bgAlpha, textScale, hovering, patch, toggleLock, capture, dragRegion, noDrag } =
    useOverlayChrome()
  const nowMs = useSecondsClock()
  // Scoped to the zone the fold says you are in FIRST, then re-ordered against the LOCAL clock —
  // not the one the fold last published: "soonest due" moves every second whether or not the log
  // does, and a list that only re-sorts on a death line would put a mob that came due a minute ago
  // below one that has ten minutes to run.
  const rows = orderRespawnRows(respawnInZone(snap.rows, snap.zone), nowMs)
  /** Clocks the fold is holding for somewhere else. Counted so the empty state can say so. */
  const elsewhere = snap.rows.length - rows.length
  /** Fire-and-forget: the module answers with a delta, and a refusal is already described by it. */
  const confirmSighting = (rowId: string): void => {
    void window.eqOverlay.confirmRespawnSighting(rowId)
  }
  /** Same contract, round 4's write: main removes the watch, persists it and pushes the delta. */
  const unwatch = (key: string): void => {
    void window.eqOverlay.unwatchRespawn(key)
  }

  return (
    <div
      data-testid="respawn-overlay"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif',
        color: '#f2f2f2',
        background: `rgba(14,17,21,${bgAlpha})`,
        border: locked ? '1px solid rgba(255,255,255,0.04)' : `1px solid ${ACCENT}66`,
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <OverlayHeader
        tag="RESP"
        title={snap.zone.length > 0 ? snap.zone : 'Respawn'}
        titleColor={ACCENT}
        tail={rows.length > 0 ? String(rows.length) : undefined}
        tailTitle="Clocks running."
        iconAccentBg={ACCENT_BG}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock, capture }}
      />

      <OverlayContent textScale={textScale} testId="respawn-overlay-rows" locked={locked} capture={capture}>
        {rows.length === 0 ? (
          // An empty window is a STATE, and it says WHICH one — this is the single most likely
          // thing a first-time user sees. Two different empties: nothing watched anywhere (go to
          // the tab), or clocks running somewhere you are not (they are safe, they are not here).
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', padding: '8px 2px' }}>
            {elsewhere > 0
              ? `No clocks in this zone - ${String(elsewhere)} running elsewhere.`
              : 'No clocks running - kill something, then Watch it on the Timers tab.'}
          </div>
        ) : (
          rows.map((row) => (
            <RespawnLine
              key={row.id}
              row={row}
              nowMs={nowMs}
              interactive={!locked}
              onConfirm={confirmSighting}
              onUnwatch={unwatch}
            />
          ))
        )}
        {/* ONE SENTENCE FOR THE WHOLE WINDOW rather than a caveat per row, and it now has to
            distinguish the two claims: a clock at zero is this app's estimate elapsing and is
            still never a sighting, while UP is the game having named the mob. */}
        {rows.length > 0 && (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', paddingTop: 4 }}>
            zero = estimate elapsed, not a sighting · UP = the log named it
          </div>
        )}
      </OverlayContent>

      {!locked && (
        <RespawnFooter bgAlpha={bgAlpha} textScale={textScale} patch={patch} noDrag={noDrag} />
      )}
    </div>
  )
}
