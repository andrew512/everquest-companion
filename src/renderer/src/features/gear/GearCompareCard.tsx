// gear/GearCompareCard.tsx — HOVER A SEARCH ROW AND SEE WHAT IT WOULD REPLACE (JOS-338).
//
// THE ONE DOOR. Every card this table draws comes through `GearRowCompare` below, and that wrapper
// always passes the safe mode — the `SkyItemCard` pattern (JOS-181), for the same reason: "the gear
// rows' cards cannot eat a click" has to be a property of ONE file rather than of whoever edits
// `GearTable` next. `tests/gearCompare.test.mts` derives both halves from the tree.
//
// ---------------------------------------------------------------------------
// WHAT IT IS BUILT ON, AND WHY EACH HALF CAME FROM WHERE IT DID
// ---------------------------------------------------------------------------
//
// THE MECHANICS ARE `KnownItemTooltip`'s CLICK-THROUGH MODE (JOS-181), not its card. That mode is
// the app's measured answer to the JOS-127/JOS-143 defect — a card belonging to a row BELOW a
// dropdown toolbar, opening upward across it and holding the pointer — and it is three guarantees,
// restated here rather than imported because the shared file's copies are pinned BY SOURCE REGEX in
// tests/tooltipCursor.test.mts (hoisting them out of it would turn that suite red and take the pin
// with it). The three, and this file's spelling of each:
//   1. IT CANNOT OPEN UPWARD. `right-start` puts the card's top edge at the ROW's top edge, `flip`
//      is disabled so it can never become `left`/`top`, and `preventOverflow`'s ALT axis — which is
//      the vertical one for a right-placed popper — is off, so nothing may slide it up. It may
//      still slide LEFT (main axis) to stay on screen, which lands it over the TABLE, never over
//      the toolbar above it. The price is JOS-181's price, honestly the same: a card anchored on the
//      last visible row is clipped by the window bottom rather than flipping above it, which is why
//      every list on it is capped.
//   2. IT HOLDS NO POINTER EVENTS. `disableInteractive` already leaves MUI's popper at
//      `pointer-events: none`; it is written out as well, because a library default is somebody
//      else's decision and this one IS the defect. It is also what makes the JOS-143 regression
//      test meaningful: `document.elementFromPoint` skips a pointer-events-none node, so the
//      toolbar, the wish heart (JOS-335) and the name's Loot link all still answer for their own
//      centres with the card open.
//   3. IT CLOSES ON POINTERDOWN, ANYWHERE, IN THE CAPTURE PHASE — so the card is gone before the
//      Select the user just aimed at opens its own option list over the same band.
// Plus the SpellCard leave discipline (JOS-293): `enterDelay` so dragging the pointer across thirty
// dense rows opens nothing, and a short `leaveDelay` so it goes with the pointer.
//
// THE DRAWING IS `hoverCards.tsx`'s VOCABULARY — the same palette, `CardSection` and `MoreLine`
// that the mob card and the spell card use, so the three hover cards in this app read as one
// family. What it deliberately does NOT reuse is `KnownItemTooltip`'s BODY: that card fetches
// `ItemKnowledge` over IPC to draw an EQ-style item window, and this one needs the numeric vector
// instead — both halves of a comparison have to be in one vocabulary or the delta is a guess. The
// renderer already holds the whole corpus (`useGearIndex`), so both sides are `GearRow`s joined by
// `itemKey`, the comparison costs ZERO IPC calls, and the plus-state the table is simulating is
// already baked into the row this card is handed.
//
// EVERY WORD IS `gearCompare.ts`'s (pure, node-tested). This file owns where a line goes.

import { type JSX, type ReactElement, useCallback, useEffect, useState } from 'react'
import type { GearRow } from '@shared/planner/gear'
import { scaleGearRow } from '@shared/planner/gearScale'
import { ITEM_MAX_TIER } from '@shared/itemStats'
import { percentLabel } from '@shared/itemUpgrade'
import { outputKind } from '@shared/outputs/kinds'
import { CARD_LABEL, CARD_MONO, CARD_TEXT, CardSection, LABEL_STYLE, MoreLine, TEXT_STYLE } from '../../lib/hoverCards'
import { Tooltip } from '../../lib/Tooltip'
import {
  compareStats,
  compareText,
  dumpFreshnessText,
  equippedCells,
  equippedState,
  hostText,
  statPairText,
  type EquippedCell
} from './gearCompare'
import type { GearCompareData } from './gearData'

/** How many of the item's own stats the card lists before collapsing to "+N more". */
const MAX_STATS = 10
/** …and how many CHANGES one equipped cell lists. Tighter: it is one line per cell, not a block. */
const MAX_DELTAS = 8

/** The hovered item's accent — the item green every card in this family gives an item name. */
const ITEM_ACCENT = '#5fe08a'
/**
 * THE DISTINCT TREATMENT the ticket asks for: the equipped half wears its own colour, its own
 * tinted panel and its own left rule, so a glance never mistakes what you HAVE for what you are
 * READING ABOUT. Amber rather than another green for exactly that reason — the two halves of this
 * card are the one place in the app where two item names mean opposite things.
 */
const EQUIPPED_ACCENT = '#e0b76a'

const EQUIPPED_PANEL: React.CSSProperties = {
  marginTop: 4,
  padding: '3px 5px',
  borderLeft: `2px solid ${EQUIPPED_ACCENT}`,
  background: 'rgba(224,183,106,0.08)'
}

/** The command, from the registry that owns its spelling — never re-typed into a literal. */
const INVENTORY_COMMAND = outputKind('inventory').command

/**
 * WHAT THE TABLE IS SIMULATING, said on the card too (JOS-284's slider).
 *
 * The row this card is handed is the SCALED one, so at a non-base plus-state the item half states
 * numbers no copy in the world has yet — and the equipped half beside it is a real object off a
 * real dump. A comparison between a simulation and a fact has to say which is which; at base there
 * is nothing to say and the line is absent.
 */
function SimulatedLine({ data }: { data: GearCompareData }): JSX.Element | null {
  const { full, fraction } = data.state
  if (full === 0) return null
  const denominator = full >= ITEM_MAX_TIER ? 0 : 2 ** full
  return (
    <div style={{ ...LABEL_STYLE, marginTop: 2 }} data-testid="gear-compare-simulated">
      simulated at Tier {full}
      {denominator > 0 && ` · ${String(fraction)}/${String(denominator)}`} · {percentLabel(data.state)}
    </div>
  )
}

/** The hovered item's own numbers, in the corpus's key order. Absent keys draw nothing (law 1). */
function ItemStats({ row }: { row: GearRow }): JSX.Element | null {
  // `compareStats(…, null)` states every key the page states and nothing else, so the `flatMap` is
  // the compiler's proof rather than a filter: an entry with no `item` cannot reach `statPairText`.
  const stated = compareStats(row.stats, null).flatMap((s) => (s.item === undefined ? [] : [statPairText(s.key, s.item)]))
  if (stated.length === 0) return null
  return (
    <>
      <div style={{ ...TEXT_STYLE, marginTop: 3 }} data-testid="gear-compare-stats">
        {stated.slice(0, MAX_STATS).join(' · ')}
      </div>
      <MoreLine total={stated.length} shown={MAX_STATS} />
    </>
  )
}

/**
 * ONE PLACE THIS ITEM WOULD GO, and what is in it.
 *
 * THREE ANSWERS, AND THEY ARE THREE DIFFERENT STATEMENTS (law 1). The dump names a copy and the
 * corpus knows its numbers ⇒ the name and the changes. The dump names a copy the corpus has no page
 * for ⇒ the name, and the card says the numbers are missing rather than drawing an empty delta
 * line. The dump names nothing ⇒ that place is EMPTY, which is a fact the client's own file states
 * (gearCompare.ts, decision 2) and the best news a gear planner can give you.
 */
function EquippedRow({ cell, row, data }: { cell: EquippedCell; row: GearRow; data: GearCompareData }): JSX.Element {
  const host = cell.host
  const worn = host === null ? undefined : data.byKey.get(host.key)
  // The worn copy is scaled at ITS OWN `+N` before the subtraction — comparing a candidate against
  // a base-tier reading of something you have already merged five times is the wrong answer, and
  // `equippedState` is where the fraction the dump does not state is priced (gearCompare.ts).
  const changes =
    host === null || worn === undefined ? [] : compareStats(row.stats, scaleGearRow(worn, equippedState(host)).stats)
  return (
    <div data-testid="gear-compare-slot" data-cell={cell.cell} data-equipped={host === null ? undefined : host.key}>
      <div style={TEXT_STYLE}>
        <span style={{ color: CARD_LABEL }}>{cell.label}: </span>
        {host === null ? (
          <span style={{ color: CARD_LABEL }} data-testid="gear-compare-empty">
            nothing equipped
          </span>
        ) : (
          <span style={{ color: EQUIPPED_ACCENT }} data-testid="gear-compare-equipped-name">
            {hostText(host)}
          </span>
        )}
      </div>
      {host !== null && worn === undefined && (
        <div style={LABEL_STYLE}>the item database has no numbers for that one</div>
      )}
      {changes.length > 0 && (
        <>
          <div style={LABEL_STYLE} data-testid="gear-compare-delta">
            {changes.slice(0, MAX_DELTAS).map(compareText).join(' · ')}
          </div>
          <MoreLine total={changes.length} shown={MAX_DELTAS} />
        </>
      )}
    </div>
  )
}

/**
 * THE EQUIPPED HALF, or the reason there is none.
 *
 * NO DUMP IS NOT AN EMPTY BODY (the ticket's own rule, and law 1's): "you are wearing nothing there"
 * and "this app has never seen your inventory" are different sentences, and only the second one has
 * a fix the player can type. Before the first read settles the card says neither — a card that
 * flashed the command hint at somebody who exported an hour ago would be the JOS-253 failure again.
 */
function EquippedHalf({ row, data }: { row: GearRow; data: GearCompareData }): JSX.Element | null {
  if (!data.ready) return null
  if (!data.hasDump) {
    return (
      <CardSection label="Currently equipped:">
        <div style={{ ...TEXT_STYLE, ...EQUIPPED_PANEL }} data-testid="gear-compare-nodump">
          No inventory dump for this character yet. Type <span style={{ color: EQUIPPED_ACCENT }}>{INVENTORY_COMMAND}</span> in
          game and this card fills itself.
        </div>
      </CardSection>
    )
  }
  const cells = equippedCells(data.equipped, row.slots)
  return (
    <CardSection label="Currently equipped:">
      <div style={EQUIPPED_PANEL}>
        {cells.map((cell) => (
          <EquippedRow key={cell.cell} cell={cell} row={row} data={data} />
        ))}
      </div>
    </CardSection>
  )
}

/** The card body. Exported for any surface that draws it somewhere other than this tooltip. */
export function GearCompareCard({ row, data }: { row: GearRow; data: GearCompareData }): JSX.Element {
  return (
    <div
      data-testid="gear-compare-card"
      data-item-key={row.key}
      style={{
        background: 'rgba(15,16,23,0.98)',
        border: `1px solid ${ITEM_ACCENT}`,
        borderRadius: 6,
        padding: 8,
        maxWidth: 340,
        fontFamily: CARD_MONO,
        color: CARD_TEXT,
        boxShadow: '0 6px 20px rgba(0,0,0,0.6)'
      }}
    >
      <div style={{ color: ITEM_ACCENT, fontSize: 12, fontWeight: 700 }}>{row.name}</div>
      <div style={LABEL_STYLE}>
        {row.slots.join(' ')}
        {row.classes.length > 0 && ` · ${row.classes.length >= 16 ? 'ALL' : row.classes.join(' ')}`}
      </div>
      <SimulatedLine data={data} />
      <ItemStats row={row} />
      <EquippedHalf row={row} data={data} />
      {data.ready && (
        <div style={{ ...LABEL_STYLE, marginTop: 4 }} data-testid="gear-compare-freshness">
          {dumpFreshnessText(data.exportedAt)}
        </div>
      )}
    </div>
  )
}

/**
 * The popper modifiers that make this card unable to reach the toolbar above its row — guarantee 1
 * of the three in the header. Both are the JOS-181 modifiers, re-aimed at a `right-start` card: for
 * a right-placed popper the ALT axis is the vertical one, so it is the one that must not move.
 */
const NEVER_UPWARD = [
  { name: 'flip', enabled: false },
  { name: 'preventOverflow', options: { mainAxis: true, altAxis: false } }
]

/**
 * The chrome, hoisted to module scope — the JOS-206 finding, which `MOB_CARD_SLOT_PROPS` states in
 * full: a fresh `slotProps` with a nested `sx` per render is real reconciliation cost across a list
 * of anchors, and this card hangs off EVERY mounted row of a windowed 6,766-row table.
 *
 * The tooltip contributes no padding, no background and no 300px cap — `GearCompareCard` draws its
 * own surface. The popper's `pointerEvents: 'none'` is guarantee 2, written out rather than
 * inherited from `disableInteractive`.
 */
const COMPARE_SLOT_PROPS = {
  popper: { modifiers: NEVER_UPWARD, sx: { pointerEvents: 'none' } },
  tooltip: { sx: { p: 0, bgcolor: 'transparent', maxWidth: 'none' } }
} as const

/**
 * Guarantee 3: the card is gone on the first pointerdown ANYWHERE, capture phase — before the
 * control the user aimed at opens its own list. Controlled state is the only way to say that, so
 * this card is controlled and MUI's own hover lifecycle drives `onOpen`/`onClose` as usual.
 */
function useCloseOnPointerDown(): { open: boolean; onOpen: () => void; onClose: () => void } {
  const [open, setOpen] = useState(false)
  const onClose = useCallback(() => {
    setOpen(false)
  }, [])
  const onOpen = useCallback(() => {
    setOpen(true)
  }, [])
  useEffect(() => {
    if (!open) return
    window.addEventListener('pointerdown', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', onClose, true)
    }
  }, [open, onClose])
  return { open, onOpen, onClose }
}

export interface GearRowCompareProps {
  row: GearRow
  data: GearCompareData
  /** the anchor: the table ROW itself, which is the thing the owner asked to be able to hover */
  children: ReactElement
}

/**
 * Hover a gear row → the comparison card. The ONE door (see the header).
 *
 * `enterDelay` is longer than the spell card's 250ms on purpose: the anchor here is a whole 37px row
 * in a dense list, so a pointer crossing the table on its way to the scrollbar passes over a dozen
 * of them and must open none. `enterNextDelay` keeps that true after the first card has opened.
 */
export function GearRowCompare({ row, data, children }: GearRowCompareProps): JSX.Element {
  const controlled = useCloseOnPointerDown()
  return (
    <Tooltip
      {...controlled}
      title={<GearCompareCard row={row} data={data} />}
      placement="right-start"
      disableInteractive
      enterDelay={350}
      enterNextDelay={350}
      leaveDelay={60}
      slotProps={COMPARE_SLOT_PROPS}
    >
      {children}
    </Tooltip>
  )
}
