// ToastCard — one celebration card, and the compact item window it embeds.
//
// MUI-FREE BY LAW (AGENTS.md: the overlay bundle is plain React + inline styles). This file is
// deliberately not the lazily-imported `ItemWindow` the event overlay's hover cards use: a
// toast's reward block is three lines and an icon, it arrives PRE-FORMATTED in the payload
// (docs/plans/celebration-toasts.md T5 — the overlay fetches nothing), and pulling MUI into the
// window that is supposed to be the cheapest thing on screen would defeat the point.
//
// LOOK (§4): dark glass, a gold title, a muted subtitle, a 10px radius and a hairline. Enter is
// a 250 ms slide-down + fade; exit is the same in reverse over 300 ms. Both are CSS transitions
// on transform/opacity — compositor-only properties, so the animation costs the game nothing.
//
// SCALE (owner, 2026-08-05: "look and feel is good, but it needs to be a bit bigger/more
// prominent"). Every number below went up by roughly a quarter — 18px title, 13px subtitle,
// 52px icon, more padding — against a 560px lane (main/overlayLayout.ts). The MOTION is
// deliberately untouched: it was already right, and a celebration that arrives faster or
// further would read as an alarm.
//
// THE ITEM CARD IS THE CLICK TARGET (T6) and the only affordance: it takes the pointer cursor
// and a hairline highlight on hover. The card as a whole pins on hover; only the reward block
// claims to go anywhere.
//
// EVERY CARD SAYS WHOSE IT IS, AND EVERY CARD CLOSES (JOS-83). A new user reported the strip as a
// nameless rectangle they took for a malfunction, so the card grew a chrome row: the app's name on
// the left, a × on the right. The row is INSIDE the card, which is the only thing this overlay
// ever paints — the resting state is still an empty transparent window, and that is what keeps
// the kind defaultable-on. The × dismisses THIS card (the queue reducer has always had the
// action; nothing was wired to it), and on the introduction card there is one more way out: a
// button that closes the overlay for good.

import { type CSSProperties, type JSX, type MouseEvent, useEffect, useState } from 'react'
import { TOAST_INTRO_BODY, type ToastItemCard, type ToastPayload } from '@shared/toast'
import { TOAST_ENTER_MS, TOAST_EXIT_MS } from './toastQueue'

const GOLD = '#d9b25f'
const MUTED = '#a8b0c6'
const ITEM_GREEN = '#5fe08a'
const MONO = '"Consolas","Courier New",monospace'

/** What the chrome row prints. Short enough for the lane at any text scale, specific enough that
 *  a player who has never opened Preferences knows which program put it there. */
const OVERLAY_LABEL = 'EQ Companion · celebration overlay'

/** The name colour the payload's hint asks for. Unknown/absent ⇒ the ordinary item green. */
function nameColor(flag: string | undefined): string {
  return flag === 'lore' || flag === 'magic' ? GOLD : ITEM_GREEN
}

/** Item icons come from the app's PERMANENT cache (`eqimg://`), never the network — the
 *  overlay's CSP lists `img-src 'self' data: eqimg:` precisely so that stays structural. */
function iconUrl(iconId: number): string {
  return `eqimg://item/${String(iconId)}`
}

/**
 * The identity + close row every card carries.
 *
 * `stop` on the button is load-bearing: a card with no reward block IS a click target (the
 * level-up card takes you to the Leveling tab), and "close" must never double as "go there".
 */
function CardChrome({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  const close = (e: MouseEvent): void => {
    e.stopPropagation()
    onDismiss()
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6
      }}
    >
      <span
        data-testid="toast-source-label"
        style={{
          color: MUTED,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          opacity: 0.85,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {OVERLAY_LABEL}
      </span>
      <button
        type="button"
        data-testid="toast-close"
        aria-label="Dismiss this celebration"
        title="Dismiss"
        onClick={close}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          lineHeight: '18px',
          padding: 0,
          borderRadius: 4,
          border: `1px solid ${hot ? GOLD : 'rgba(255,255,255,0.18)'}`,
          background: hot ? 'rgba(217,178,95,0.16)' : 'transparent',
          color: hot ? GOLD : MUTED,
          fontSize: 13,
          cursor: 'pointer'
        }}
      >
        ×
      </button>
    </div>
  )
}

/**
 * The introduction card's extra half (JOS-83): what this window is, and the way to be rid of it
 * permanently rather than for six seconds. `eqOverlay.close()` is the same door the meters' close
 * buttons use — it closes the window AND persists `open:false`, so it does not come back next
 * launch and Preferences shows the state it is actually in.
 */
function IntroBlock(): JSX.Element {
  const [hot, setHot] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <div data-testid="toast-intro-body" style={{ color: MUTED, fontSize: 12, lineHeight: 1.5 }}>
        {TOAST_INTRO_BODY}
      </div>
      <button
        type="button"
        data-testid="toast-intro-disable"
        onClick={(e) => {
          e.stopPropagation()
          window.eqOverlay.close()
        }}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          marginTop: 10,
          border: `1px solid ${hot ? GOLD : 'rgba(217,178,95,0.45)'}`,
          borderRadius: 4,
          background: hot ? 'rgba(217,178,95,0.16)' : 'transparent',
          color: GOLD,
          fontSize: 12,
          padding: '4px 10px',
          cursor: 'pointer'
        }}
      >
        Turn this overlay off
      </button>
    </div>
  )
}

function RewardBlock({ item, onClick }: { item: ToastItemCard; onClick?: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        display: 'flex',
        gap: 10,
        marginTop: 10,
        padding: 8,
        borderRadius: 8,
        border: `1px solid ${hot && clickable ? GOLD : 'rgba(255,255,255,0.10)'}`,
        background: 'rgba(255,255,255,0.04)',
        cursor: clickable ? 'pointer' : 'default'
      }}
    >
      {item.iconId !== undefined && (
        <img
          src={iconUrl(item.iconId)}
          alt=""
          width={52}
          height={52}
          style={{ width: 52, height: 52, imageRendering: 'pixelated', flex: '0 0 auto' }}
          onError={(e) => {
            // A miss is never cached, so hiding the <img> is the whole failure path: the next
            // toast retries the fetch and the icon simply appears when the wiki is reachable.
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ color: nameColor(item.colorFlag), fontSize: 14, fontFamily: MONO, fontWeight: 700 }}>
          {item.name}
        </div>
        {item.lines.map((l) => (
          <div key={l} style={{ color: MUTED, fontSize: 12, fontFamily: MONO, lineHeight: 1.45 }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The enter/exit transition, as a style. `entering` is true for exactly one frame after mount,
 * which is what gives the browser a FROM state to animate out of — set both at once and there
 * is no transition at all, only a jump.
 */
function motionStyle(entering: boolean, exiting: boolean): CSSProperties {
  const hidden = entering || exiting
  return {
    opacity: hidden ? 0 : 1,
    transform: hidden ? 'translateY(-8px)' : 'translateY(0)',
    transition: `opacity ${String(exiting ? TOAST_EXIT_MS : TOAST_ENTER_MS)}ms ease-out, transform ${String(
      exiting ? TOAST_EXIT_MS : TOAST_ENTER_MS
    )}ms ease-out`
  }
}

export function ToastCard({
  payload,
  exiting,
  bgAlpha,
  onHover,
  onDismiss
}: {
  payload: ToastPayload
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

  const focus = payload.focus
  const onOpen = focus ? (): void => window.eqOverlay.focusApp(focus) : undefined
  // A card with NO reward block has no inner click target, so the card itself becomes one — the
  // level-up toast (docs/plans/levelup-whats-new.md §2) is the first of those: a level is not a
  // reward you can hold, but it still has somewhere to take you (the Leveling tab, at that
  // level). Where a reward block exists it stays the only affordance, exactly as T6 wrote it.
  const onCardClick = payload.item ? undefined : onOpen

  return (
    <div
      data-testid="toast-card"
      /* The kind, on the DOM: the overlay's OWN introduction (JOS-83) is a card in the same queue
         as a boss kill, and a harness counting CELEBRATIONS must be able to tell them apart
         without reading the card's prose (tests/e2e/character-switch.e2e.mts). */
      data-toast-kind={payload.kind}
      onClick={onCardClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        cursor: onCardClick ? 'pointer' : 'default',
        marginBottom: 10,
        padding: '14px 18px',
        borderRadius: 10,
        border: '1px solid rgba(217,178,95,0.35)',
        background: `rgba(15,17,21,${String(bgAlpha)})`,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
        ...motionStyle(entering, exiting)
      }}
    >
      <CardChrome onDismiss={onDismiss} />
      <div data-testid="toast-title" style={{ color: GOLD, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>
        {payload.title}
      </div>
      {payload.subtitle && (
        <div data-testid="toast-subtitle" style={{ color: MUTED, fontSize: 13, marginTop: 3 }}>
          {payload.subtitle}
        </div>
      )}
      {/* Nothing else is clickable: a toast says a thing happened, and the reward block is the
          one place that promises to take you somewhere. */}
      {payload.item && <RewardBlock item={payload.item} onClick={onOpen} />}
      {/* …except the introduction, whose whole job is to offer a way out (JOS-83). */}
      {payload.kind === 'intro' && <IntroBlock />}
    </div>
  )
}
