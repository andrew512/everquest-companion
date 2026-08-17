/**
 * A STRIP AT 200% IS ITSELF, BIGGER (JOS-406) — the shared step for the toast and the alert banner.
 *
 * The three strips (toast, alertBanner, conCard) are the overlays whose WINDOW IS THE CARD, so
 * since JOS-406 their persisted rectangle is a LAYOUT BOX in CSS px at 100% text and the window
 * that reaches the screen is that box times the kind's effective text scale
 * (main/overlayLayout.ts `scaledStripBounds`). The con card has its own steps next door, because
 * its chips carry a second claim; the toast and the banner share this one, and sharing it is the
 * point — the rule is the same rule for all three, and two copies of it would be two rules.
 *
 * WHAT ONLY A REAL APP CAN SAY. The arithmetic is pinned in tests/overlayLayout.test.mts —
 * centre-preserving, work-area clamped, exact round trip. What no unit test can claim is that the
 * press REACHES a BrowserWindow: the scale is written through the overlay's own config door, routed
 * to the shared preference by main (JOS-405), broadcast, and only then does main re-place the
 * window. Four processes' worth of wiring, and a real window at the end of it.
 *
 * AND THAT NOTHING IS CLIPPED. Growing the window is only half the promise; the other half is that
 * the card inside it lays out in the room it was given rather than running off the edge, which is
 * measured here against the real document.
 *
 * NO WINDOW IS EVER SHOWN (`EQ_E2E=1`), so the size is asked of main and the screenshot borrows the
 * window for the moment it takes to capture — see `shootOverlay`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, check, note, settle } from './appHarness.mjs'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * `TEXT_SCALE_MAX` from src/shared/overlayTextScale.ts, spelled out rather than imported: an e2e
 * file loads no `src` module (tests/e2e/overlayMinSizeSteps.mts states that rule). A change to the
 * ceiling that forgets this line fails loudly here.
 */
export const MAX_SCALE = 2

/** A window is whole pixels and a layout box is not, and `setBounds` can round on a scaled display:
 *  a pixel either way is not a size anybody is expressing. */
const SLACK = 2

/** Where a kind's overlay window IS, asked of main — identified by the `?kind=` it was opened with. */
export function overlayBounds(app: ElectronApplication, kind: string): Promise<Bounds | null> {
  return app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(`kind=${k}`))
    return w ? w.getBounds() : null
  }, kind)
}

/** Set a strip's text size through the overlay's own config door — the one A+ presses. */
export function setOverlayTextScale(page: Page, textScale: number): Promise<unknown> {
  return page.evaluate(
    (s) =>
      (
        window as unknown as { eqOverlay: { setConfig: (p: { textScale: number }) => Promise<unknown> } }
      ).eqOverlay.setConfig({ textScale: s }),
    textScale
  )
}

/** What a strip's overlay has persisted — the LAYOUT box since JOS-406, never the window. */
export function storedBounds(page: Page): Promise<Bounds | undefined> {
  return page.evaluate(async () => {
    const eq = window as unknown as { eqOverlay: { getConfig: () => Promise<{ bounds?: Bounds }> } }
    return (await eq.eqOverlay.getConfig()).bounds
  })
}

/** Does anything inside the window run past its edges? Measured on the real document. */
export function clipCheck(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }))
}

/**
 * WHAT IT LOOKS LIKE, saved as a picture — the con card spec's own `shootCard`, generalised.
 *
 * A hidden BrowserWindow produces no frames, so a screenshot of one never resolves (JOS-120's law,
 * arriving from the other side). `EQ_E2E=1` skips every `showInactive`, so this asks MAIN to show
 * the window for the moment it takes to capture and puts it back. Everything is best-effort and
 * reports through `note`, never a check: a machine with no display owes a spec nothing.
 */
export async function shootOverlay(
  app: ElectronApplication,
  page: Page,
  kind: string,
  file: string
): Promise<void> {
  const path = join(ARTIFACTS, file)
  const setShown = (shown: boolean): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, { k, show }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.webContents.getURL().includes(`kind=${k}`)) continue
          if (show) w.showInactive()
          else w.hide()
        }
      },
      { k: kind, show: shown }
    )
  try {
    mkdirSync(ARTIFACTS, { recursive: true })
    await setShown(true)
    await page.screenshot({ path, omitBackground: true, timeout: 20_000 })
    note(`overlay screenshot: ${path}`)
  } catch (err: unknown) {
    note(`overlay screenshot unavailable — ${String(err)}`)
  } finally {
    await setShown(false).catch(() => undefined)
  }
}

/** Poll until main has re-placed the window at the width the scale asks for. */
function settleWidth(app: ElectronApplication, kind: string, want: number): Promise<Bounds | null> {
  return settle(
    () => overlayBounds(app, kind),
    (b) => b !== null && Math.abs(b.width - want) <= SLACK,
    { timeoutMs: 15_000 }
  )
}

/**
 * THE STEP: this strip's window grows with its text, stays where its middle was, and clips nothing.
 *
 * `label` names the kind in the check text and the screenshot files, because a run's artifacts are
 * read by a person deciding whether the thing looks right.
 */
export async function stepStripScalesWithText(
  app: ElectronApplication,
  strip: Page,
  kind: string,
  label: string
): Promise<void> {
  const before = await overlayBounds(app, kind)
  if (!check(`the ${label} window has bounds to read`, before !== null)) return
  const b = before as Bounds
  await shootOverlay(app, strip, kind, `${kind}-100.png`)

  await setOverlayTextScale(strip, MAX_SCALE)
  const after = await settleWidth(app, kind, b.width * MAX_SCALE)
  if (check(`the ${label} window follows the text to 200%`, after !== null)) {
    const big = after as Bounds
    check(
      `…and it is exactly TWICE the window it was, not a zoomed card in the old one`,
      Math.abs(big.width - b.width * MAX_SCALE) <= SLACK,
      `${String(b.width)} -> ${String(big.width)}`
    )
    // CENTRE-PRESERVING: a strip that grew from its left edge would walk across the screen every
    // time somebody pressed A+. (Unless the work area clamped it, which is its own right answer —
    // so this only holds while the grown window still fits, which at these sizes it does.)
    check(
      '…grown about its own MIDDLE, with the top edge unmoved',
      Math.abs(big.x + big.width / 2 - (b.x + b.width / 2)) <= SLACK && big.y === b.y,
      `${JSON.stringify(b)} -> ${JSON.stringify(big)}`
    )
    const clip = await clipCheck(strip)
    check(
      `…and nothing on the ${label} is clipped off the edge at 200%`,
      clip.scroll <= clip.client + 1,
      `${String(clip.scroll)}px of content in a ${String(clip.client)}px window`
    )
    await shootOverlay(app, strip, kind, `${kind}-200.png`)
  }

  // Back to the shipped size, and the window with it — the last half of "it is a switch".
  await setOverlayTextScale(strip, 1)
  const back = await settleWidth(app, kind, b.width)
  check(
    `…and turning the size back down puts the ${label} window back exactly where it was`,
    back !== null && Math.abs((back as Bounds).width - b.width) <= SLACK,
    `${String((back as Bounds | null)?.width)} vs ${String(b.width)}`
  )
}
