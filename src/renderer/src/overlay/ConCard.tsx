// ConCard — ONE card for one `/con` (JOS-383).
//
// MUI-FREE BY LAW (AGENTS.md: the overlay bundle is plain React + inline styles), tooltip-shaped
// and semi-transparent, over the game. It is a CARD rather than a line because the question it
// answers has parts: what is it, how hard does it resist what I cast, what does it drop, when does
// it come back.
//
// EVERY SENTENCE ON IT IS SOMEBODY ELSE'S DERIVATION, deliberately:
//   * the axis WORD and its COLOUR come from `@shared/resistTypes` + `features/resists/
//     resistColors.ts`, which says in its own header that this overlay imports it — an axis that is
//     purple on the mob page and blue here is two axes to the person reading them;
//   * `R 126 (110-144)`, `n=32` and `not enough data (n=2)` come from `features/resists/
//     resistRow.ts`, the same three functions the mob page's rows print;
//   * the drop lines come from `conCardRows.ts`, which folds `+N` variants through the mob page's
//     own `foldSeenVariants` and states the perceived rate through its own `perceivedDropRate`.
// Nothing here computes anything about the world. It lays five chips out and draws what it is told.
//
// NO ACRONYMS, EVER (owner ruling, 2026-08-16). A chip carries the colour AND the word AND the tag,
// in that fixed order, every time — magic, fire, cold, poison, disease — so the eye learns the
// positions and a red-green colour-blind reader never has to tell poison from disease by hue.
//
// AN AXIS IS NEVER OMITTED, AND ITS ANSWER IS NEVER WITHHELD (owner ruling, 2026-08-16). Every chip
// with an observation behind it carries the tag, the number, the interval and the count — at n = 1
// exactly as at n = 600, with a quieter `low samples` caveat under ten — because the wide interval
// IS the honest display of a thin cell. A chip with nothing behind it draws grey and says "no data"
// rather than disappearing: "we have not seen fire cast on this" and "fire is fine" are different
// statements, and a missing chip says neither (world-model law 1).

import { type CSSProperties, type JSX, useEffect, useState } from 'react'
import { CON_CARD_MAX_DROPS, type ConCardChip, type ConCardPayload } from '@shared/conCard'
import { RESIST_AXIS_WORDS } from '@shared/resistTypes'
import { lowSamples } from '@shared/resistModel'
import { RESIST_AXIS_COLORS, RESIST_UNKNOWN_COLOR } from '../features/resists/resistColors'
import { LOW_SAMPLE_NOTE, NO_DATA_TEXT, countText, estimateText } from '../features/resists/resistRow'
import { formatDropsPerKill } from '../lib/formatRate'
import { CARD_ENTER_MS, CARD_EXIT_MS } from './cardQueue'
import { conCardDropLines, type ConCardDropLine } from './conCardRows'

const MUTED = '#a8b0c6'
const DIM = '#7c8397'
const GOLD = '#d9b25f'
const BUTTON_PX = 20

/** The enter/exit transition, as a style — the banner's, so two cards over one game move alike. */
function motionStyle(entering: boolean, exiting: boolean): CSSProperties {
  const hidden = entering || exiting
  return {
    opacity: hidden ? 0 : 1,
    transform: hidden ? 'translateY(-6px)' : 'translateY(0)',
    transition: `opacity ${String(exiting ? CARD_EXIT_MS : CARD_ENTER_MS)}ms ease-out, transform ${String(
      exiting ? CARD_EXIT_MS : CARD_ENTER_MS
    )}ms ease-out`
  }
}

/** The identity line: what it is, what level the game just said it is, and where you are. */
function Identity({ payload }: { payload: ConCardPayload }): JSX.Element {
  const facts = [
    payload.level === undefined ? null : `Level ${String(payload.level)}`,
    payload.rare === true ? 'rare creature' : null,
    payload.zone ?? null
  ].filter((f): f is string => f !== null)
  return (
    <div style={{ minWidth: 0 }}>
      <div
        data-testid="con-card-name"
        style={{ color: '#e6ebf5', fontSize: 15, fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}
      >
        {payload.name}
      </div>
      {facts.length > 0 && (
        <div data-testid="con-card-facts" style={{ color: MUTED, fontSize: 11, marginTop: 1 }}>
          {facts.join(' · ')}
        </div>
      )}
    </div>
  )
}

/**
 * ONE AXIS CHIP: colour, word, tag — and, underneath in smaller type, the estimate and its interval
 * for the axes that have one. The number NEVER appears without its interval and its count, which is
 * JOS-382's rule and the difference between "nuke cold" and "we have no idea yet".
 */
function Chip({ chip }: { chip: ConCardChip }): JSX.Element {
  // EMPTY, never "thin" (owner ruling, 2026-08-16): a chip with one observation reports in full —
  // tag, R, interval, count — and wears the quieter `low samples` caveat. Only a chip with nothing
  // behind it says "no data", and it still holds its place in the row.
  const empty = chip.tag === null || chip.fit === null
  const color = empty ? RESIST_UNKNOWN_COLOR : RESIST_AXIS_COLORS[chip.axis]
  return (
    <div
      data-testid={`con-chip-${chip.axis}`}
      data-tag={chip.tag ?? 'none'}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        padding: '4px 6px',
        borderRadius: 6,
        border: `1px solid ${color}66`,
        background: `${color}1f`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: '0 0 auto' }} />
        <span style={{ color, fontSize: 11, fontWeight: 700 }}>{RESIST_AXIS_WORDS[chip.axis]}</span>
      </div>
      {/* THE TAG IS WORDS, ALWAYS — including "no data", which is a state and not an absence.
          `overflowWrap` rather than an ellipsis: "very resistant" truncated to "very resis…" is the
          acronym problem wearing different clothes. */}
      <div
        data-testid={`con-chip-tag-${chip.axis}`}
        style={{ color: empty ? DIM : color, fontSize: 11, marginTop: 2, overflowWrap: 'anywhere' }}
      >
        {chip.tag ?? NO_DATA_TEXT}
        {lowSamples(chip.n) && <span style={{ color: DIM }}>{` · ${LOW_SAMPLE_NOTE}`}</span>}
      </div>
      {/* The number and its interval, with the count beside them — never one without the others.
          A chip with nothing behind it has no line here at all rather than a placeholder. */}
      {chip.fit && (
        <div data-testid={`con-chip-detail-${chip.axis}`} style={{ color: DIM, fontSize: 9, marginTop: 1 }}>
          {`${estimateText(chip.fit)} ${countText(chip.n)}`}
        </div>
      )}
    </div>
  )
}

/** The five chips, in `RESIST_AXES` order, always all five. */
function Chips({ payload }: { payload: ConCardPayload }): JSX.Element {
  return (
    <div data-testid="con-card-resists">
      {!payload.spellData && (
        <div style={{ color: DIM, fontSize: 10, marginBottom: 3 }}>
          Resists need your EverQuest install&apos;s spells_us.txt - the axes below are what the log
          alone can say.
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        {payload.chips.map((c) => (
          <Chip key={c.axis} chip={c} />
        ))}
      </div>
    </div>
  )
}

/** One drop line: the item, whatever the page said about it, and what YOUR log has had. */
function DropLine({ line }: { line: ConCardDropLine }): JSX.Element {
  const rate = line.perKill === null ? null : formatDropsPerKill(line.perKill)
  return (
    <div
      data-testid="con-card-drop"
      style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0, padding: '1px 0' }}
    >
      <span style={{ color: '#cfd6e6', fontSize: 11, minWidth: 0, overflowWrap: 'anywhere' }}>{line.item}</span>
      {line.rarity !== undefined && <span style={{ color: DIM, fontSize: 10, flexShrink: 0 }}>{line.rarity}</span>}
      <span style={{ flex: '1 1 auto' }} />
      {line.seen !== undefined && (
        <span style={{ color: '#7fc99a', fontSize: 10, flexShrink: 0 }}>
          {`seen by you: ${String(line.seen)}x`}
          {rate !== null && ` · ${rate}`}
          {line.yoursOnly && ' · your log only'}
        </span>
      )}
    </div>
  )
}

/**
 * The drops block. "Still asking" and "nothing known" are DIFFERENT and are said differently:
 * `knowledgeIn` is main telling us the lookup has answered, so a card that draws no drops before it
 * lands says so rather than claiming the creature drops nothing.
 */
function Drops({ payload }: { payload: ConCardPayload }): JSX.Element {
  const { lines, more } = conCardDropLines(payload, CON_CARD_MAX_DROPS)
  if (lines.length === 0) {
    return (
      <div data-testid="con-card-drops" style={{ color: DIM, fontSize: 10 }}>
        {payload.knowledgeIn === true ? 'No drops known for this one.' : 'Looking up what it drops...'}
      </div>
    )
  }
  return (
    <div data-testid="con-card-drops">
      {lines.map((l) => (
        <DropLine key={`${l.item}-${String(l.yoursOnly)}`} line={l} />
      ))}
      {more > 0 && (
        <div style={{ color: DIM, fontSize: 10, paddingTop: 1 }}>{`+${String(more)} more`}</div>
      )}
    </div>
  )
}

export function ConCard({
  payload,
  exiting,
  bgAlpha,
  onHover,
  onDismiss
}: {
  payload: ConCardPayload
  exiting: boolean
  bgAlpha: number
  onHover: (over: boolean) => void
  onDismiss: () => void
}): JSX.Element {
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      data-testid="con-card"
      data-mob={payload.id}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${GOLD}55`,
        background: `rgba(15,17,21,${String(bgAlpha)})`,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        ...motionStyle(entering, exiting)
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Identity payload={payload} />
        <span style={{ flex: '1 1 auto' }} />
        {/* EVERY CARD CLOSES (the celebration card's JOS-83 rule, kept twice over): this window is
            always-on-top over a game, and a user who wants it gone must not have to find
            Preferences. Closing also tells main, which is what stops a re-con putting it straight
            back up (ConCardOverlay.tsx). */}
        <button
          type="button"
          data-testid="con-card-close"
          aria-label="Close this mob card"
          onClick={onDismiss}
          style={{
            flexShrink: 0,
            width: BUTTON_PX,
            height: BUTTON_PX,
            lineHeight: '18px',
            padding: 0,
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: MUTED,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          ×
        </button>
      </div>
      <Chips payload={payload} />
      <Drops payload={payload} />
      {payload.respawn !== undefined && (
        <div data-testid="con-card-respawn" style={{ color: MUTED, fontSize: 10 }}>
          {`Respawn: ${payload.respawn}`}
        </div>
      )}
      {/* THE FACTION SLOT (JOS-94). Deliberately EMPTY and deliberately here: the ticket that owns
          faction-on-con lands its standing read in this exact position, under the respawn, and a
          slot reserved in the layout is the difference between that being an insertion and a
          redesign. Nothing is drawn, because nothing is known — the con line states a faction RUNG,
          which is a fact about standing this card does not yet claim to report. */}
      <div data-testid="con-card-faction" />
    </div>
  )
}
