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

import { type CSSProperties, type JSX, useEffect, useState } from 'react'
import type { ToastItemCard, ToastPayload } from '@shared/toast'
import { TOAST_ENTER_MS, TOAST_EXIT_MS } from './toastQueue'

const GOLD = '#d9b25f'
const MUTED = '#a8b0c6'
const ITEM_GREEN = '#5fe08a'
const MONO = '"Consolas","Courier New",monospace'

/** The name colour the payload's hint asks for. Unknown/absent ⇒ the ordinary item green. */
function nameColor(flag: string | undefined): string {
  return flag === 'lore' || flag === 'magic' ? GOLD : ITEM_GREEN
}

/** Item icons come from the app's PERMANENT cache (`eqimg://`), never the network — the
 *  overlay's CSP lists `img-src 'self' data: eqimg:` precisely so that stays structural. */
function iconUrl(iconId: number): string {
  return `eqimg://item/${String(iconId)}`
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
  onHover
}: {
  payload: ToastPayload
  exiting: boolean
  bgAlpha: number
  onHover: (over: boolean) => void
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
    </div>
  )
}
