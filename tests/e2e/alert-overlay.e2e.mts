/**
 * Headless Electron smoke test for ALERT TEXT OVERLAYS (docs/plans/alert-text-overlays.md).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The pure halves are pinned elsewhere — the model, the caps and
 * both validators in tests/alertDisplay.test.mts, the stacking/timing in
 * tests/alertTextQueue.test.mts, the request one firing builds in tests/alertDisplayFire.test.mts,
 * the lane's geometry in tests/overlayLayout.test.mts. What no unit test can claim is that the
 * PIECES ARE WIRED: that toggling the new overlay kind actually spawns a window, that a request
 * sent over the REAL `alertText:show` channel crosses main (validation, open-state check,
 * fan-out) and lands in THAT window's DOM styled as it asked, that two requests STACK rather than
 * replacing each other — the owner's headline requirement — and that a refused request, or one
 * sent to a closed overlay, lands nowhere.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`, so the lane here is created, loaded and driven
 * entirely off-screen while the user plays. That is also why this spec drives the app's own
 * bridge rather than clicking anything — a hidden, always-on-top window has no pointer. (It has
 * nothing to click either: this kind never captures the mouse.)
 *
 * IT ASSERTS THE DOM, NEVER THE ANIMATION. The line's enter/exit is a CSS transition on
 * transform/opacity; what is checked here is that the line, its text and the font/size/colour
 * main forwarded are actually rendered.
 *
 * Run: `npm run test:e2e -- alert-overlay` (or `node --import tsx tests/e2e/alert-overlay.e2e.mts`).
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleStable
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The alert overlay's page, identified by the `?kind=` query its window was opened with. */
async function findAlertWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=alert')) return w
  }
  return null
}

/** Poll until the alert overlay exists (window creation + page load is asynchronous). */
function waitForAlertWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page | null> {
  return settle(() => findAlertWindow(app), (w) => w !== null, { timeoutMs })
}

/** Toggle the overlay kind through the app's own bridge; resolves to the resulting open-state. */
function toggleOverlay(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { eq: { toggleOverlay: (k: string) => Promise<boolean> } }).eq.toggleOverlay('alert')
  )
}

/** Send one request over the REAL renderer→main channel, exactly as the alert player does. */
function send(page: Page, req: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (r) => (window as unknown as { eq: { showAlertText: (x: unknown) => void } }).eq.showAlertText(r),
    req
  )
}

/** Every rendered line, with the styling main actually forwarded, in stack order. */
function lines(page: Page): Promise<{ text: string; color: string; fontSize: string; fontFamily: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="alert-text-card"]')].map((el) => {
      const s = getComputedStyle(el as HTMLElement)
      return {
        text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        color: s.color,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily
      }
    })
  )
}

/** A request whose fields are all explicit, so what is asserted is what was sent. */
function request(id: string, text: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    overlay: 'alert',
    text,
    font: 'sans',
    fontSize: 32,
    color: '#ff0000',
    // A long hold on purpose: the stacking step asserts that a second line joins the first, and a
    // short default would make that a race against the machine rather than a claim about the
    // queue. The validator caps it regardless.
    durationMs: 25_000,
    ...over
  }
}

/** Set the lane's own defaults, exactly as the Preferences panel does. */
function setDefaults(page: Page, defaults: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(
    (d) =>
      (
        window as unknown as {
          eq: { setAlertOverlayDefaults: (k: string, v: unknown) => Promise<unknown> }
        }
      ).eq.setAlertOverlayDefaults('alert', d),
    defaults
  )
}

/** Send, then wait for the lane to hold at least `expect` lines. */
async function sendAndSettle(main: Page, lane: Page, req: Record<string, unknown>, expect: number): Promise<string[]> {
  await send(main, req)
  await settle(() => lines(lane), (l) => l.length >= expect, { timeoutMs: 15_000 })
  return (await lines(lane)).map((l) => l.text)
}

/**
 * OFF OUT OF THE BOX, and the window IS the feature — so the proof that it defaults off is that
 * no such window exists before anybody has touched a setting. (The toast is the opposite and its
 * own spec says so; the two defaults are deliberate opposites, per store.ts.)
 */
async function stepDefaultsOff(app: ElectronApplication): Promise<void> {
  check('the alert overlay is OFF for a fresh install — no window until it is asked for', (await findAlertWindow(app)) === null)
}

/** The switch lives in Preferences → Overlays, and it is the only route to positioning the lane. */
async function stepPreferences(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-overlays"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-overlays"]')
  await page.waitForSelector('[data-testid="pref-alert-overlay"]', { timeout: 15_000 })
  if (!check('Preferences → Overlays offers the alert text overlay', (await countOf(page, '[data-testid="pref-alert-overlay"]')) === 1)) {
    return
  }
  // The switch's testid sits on the MUI root, so the checkbox is the input inside it. Its state
  // arrives from MAIN's store over IPC a beat after the pane mounts, so it is read until it
  // settles rather than whatever it happened to say first.
  const on = await settle(
    () =>
      page.evaluate(
        (sel) => (document.querySelector(sel) as HTMLInputElement | null)?.checked,
        '[data-testid="pref-alert-overlay-enabled"] input'
      ),
    (v) => v === true,
    { timeoutMs: 10_000 }
  )
  check('…and its switch reports the window that is now open', on === true, String(on))
  check('…with a "Move it" switch, the only way to position a click-through lane', (await countOf(page, '[data-testid="pref-alert-overlay-move"]')) === 1)
  // The lane's own look — said once here rather than on every alert.
  const knobs = await Promise.all(
    ['font', 'size', 'color', 'seconds'].map((k) => countOf(page, `[data-testid="pref-alert-overlay-${k}"]`))
  )
  check('…and the lane’s default font, size, colour and seconds', knobs.every((n) => n === 1), knobs.join(','))
}

/** One line, drawn with the font, size and colour the request named. */
async function stepFirstLine(main: Page, lane: Page): Promise<void> {
  await sendAndSettle(main, lane, request('e2e:1', 'Ancient Breath incoming'), 1)
  const drawn = await lines(lane)
  if (!check('a request sent over `alertText:show` renders a line in the alert window', drawn.length === 1, `${drawn.length} line(s)`)) {
    return
  }
  check('…carrying the resolved text', drawn[0].text === 'Ancient Breath incoming', drawn[0].text)
  // The style is the feature, not decoration: it crossed two processes and a validator to get
  // here, and it is the only thing the user chose per alert.
  check('…in the COLOUR the alert asked for', drawn[0].color === 'rgb(255, 0, 0)', drawn[0].color)
  check('…at the SIZE the alert asked for', drawn[0].fontSize === '32px', drawn[0].fontSize)
}

/** THE HEADLINE REQUIREMENT: two alerts at once are two lines, not one overwriting the other. */
async function stepStacking(main: Page, lane: Page): Promise<void> {
  const texts = await sendAndSettle(main, lane, request('e2e:2', 'Adds from the left'), 2)
  if (!check('a second alert STACKS rather than replacing the first', texts.length === 2, texts.join(' | '))) return
  check('…with the first still on screen', texts[0] === 'Ancient Breath incoming', texts[0])
  check('…and the newest underneath it (arrival order is render order)', texts[1] === 'Adds from the left', texts[1])

  // Two fires of the SAME alert differ only in the per-firing counter, which is exactly the case
  // a dedupe-by-id queue (the celebration toast's) would collapse. It must not be collapsed here.
  const again = await sendAndSettle(main, lane, request('e2e:3', 'Adds from the left'), 3)
  check('…and a repeat of the same alert is a THIRD line, because it happened again', again.length === 3, again.join(' | '))
}

/** A refused request must reach no window at all — the validator is main's, not the overlay's. */
async function stepRefusal(main: Page, lane: Page): Promise<void> {
  const before = (await lines(lane)).length
  await send(main, request('e2e:bad-overlay', 'nowhere to go', { overlay: 'alert99' }))
  await send(main, request('e2e:bad-target', 'a meter is not a lane', { overlay: 'fight' }))
  await send(main, request('e2e:no-text', ''))
  await send(main, { overlay: 'alert', text: 'no id at all' })
  // Nothing is supposed to happen, so the positive signal is the lane HOLDING STILL — a settled
  // count says "the send round trip has been and gone", which a flat sleep only assumed.
  const after = await settleStable(() => lines(lane), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  check(
    'a request with no text, no id, or an overlay we do not have renders NOTHING — main refuses it',
    after.length === before,
    `${after.length} line(s)`
  )
}

/** A malformed STYLE is repaired, never a reason the alert goes unseen. */
async function stepRepair(main: Page, lane: Page): Promise<void> {
  const before = (await lines(lane)).length
  await sendAndSettle(
    main,
    lane,
    request('e2e:repair', 'Charm broke', { color: 'red; background:url(http://evil)', fontSize: 9000, font: 'Comic Sans' }),
    before + 1
  )
  const drawn = await lines(lane)
  const repaired = drawn.find((l) => l.text === 'Charm broke')
  if (!check('a request with a bogus colour/size/font still DRAWS — the fields are repaired', !!repaired, drawn.map((l) => l.text).join(' | '))) {
    return
  }
  // An unusable colour is DROPPED, which means inherited — and at this point the lane is still at
  // its shipped defaults, so what comes back is the default gold. (The next step changes the
  // lane's own look and proves the inheritance moves with it.)
  check('…in the lane’s colour rather than whatever was smuggled in', repaired?.color === 'rgb(255, 204, 51)', repaired?.color ?? '')
  // A real number outside the range is a statement of intent, so it is clamped rather than dropped.
  check('…and clamped to the largest size the lane allows', repaired?.fontSize === '96px', repaired?.fontSize ?? '')
}

/** What a line that never arrived looks like, so the assertions below need no optional chaining. */
const NO_LINE = { text: '', color: '', fontSize: '', fontFamily: '' }

/** Send one request, wait for the lane to grow, and hand back the line it drew. */
async function sendAndFind(
  main: Page,
  lane: Page,
  req: Record<string, unknown>,
  text: string
): Promise<typeof NO_LINE> {
  const before = (await lines(lane)).length
  await send(main, req)
  await settle(() => lines(lane), (l) => l.length > before, { timeoutMs: 15_000 })
  return (await lines(lane)).find((l) => l.text === text) ?? NO_LINE
}

/**
 * THE LANE'S OWN LOOK. Only the real app can show this: the defaults live in main's store, the
 * alert sends only what it overrode, and the two meet in `showAlertText`. Every unit test either
 * side of that seam could pass with the wiring backwards.
 */
async function stepInheritedLook(main: Page, lane: Page): Promise<void> {
  await setDefaults(main, { font: 'display', fontSize: 44, color: '#00ff00', durationMs: 25_000 })
  // A request that overrides NOTHING — every style field absent from the wire.
  const l = await sendAndFind(main, lane, { id: 'e2e:inherit', overlay: 'alert', text: 'Inherited look' }, 'Inherited look')
  if (!check('an alert that overrides nothing takes the LANE’s font, size and colour', l.text !== '')) return
  check('…the lane’s colour', l.color === 'rgb(0, 255, 0)', l.color)
  check('…the lane’s size', l.fontSize === '44px', l.fontSize)
  check('…and the lane’s font', l.fontFamily.includes('Arial Black'), l.fontFamily)
}

/** …and one alert overriding a SINGLE field keeps the lane's answer for the other three. */
async function stepOverriddenField(main: Page, lane: Page): Promise<void> {
  const req = { id: 'e2e:override', overlay: 'alert', text: 'My own colour', color: '#ff00ff' }
  const l = await sendAndFind(main, lane, req, 'My own colour')
  if (!check('an alert that overrides ONE field gets it', l.text !== '')) return
  check('…its own colour wins', l.color === 'rgb(255, 0, 255)', l.color)
  check('…and the size it never mentioned is still the lane’s', l.fontSize === '44px', l.fontSize)
}

/**
 * THE LANE STRETCHES, and only the real app can show it.
 *
 * `overlaySizeLimits` is pinned in tests/overlayLayout.test.mts, but that asserts what we ASK for.
 * The cap that stopped this was Electron's `maxWidth`, enforced in the OS window rather than in our
 * code — so the claim worth making end to end is that a window told to be 1600px wide comes back
 * 1600px wide. On the old 720 cap it came back 720.
 */
async function stepStretch(app: ElectronApplication): Promise<void> {
  const sized = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('kind=alert'))
    if (!w) return null
    const before = w.getBounds()
    w.setBounds({ ...before, width: 1600 })
    return { before: before.width, after: w.getBounds().width }
  })
  if (!check('the alert window is reachable to resize', sized !== null)) return
  const { before, after } = sized as { before: number; after: number }
  check('an alert lane can be stretched far past the meters’ 720px ceiling', after === 1600, `${before} -> ${after}`)
}

/** A CLOSED overlay is silent: the alert still fired, it just has nowhere to be drawn. */
async function stepClosedIsSilent(app: ElectronApplication, main: Page, lane: Page): Promise<void> {
  await toggleOverlay(main)
  const gone = await settle(() => findAlertWindow(app), (w) => w === null, { timeoutMs: 15_000 })
  if (!check('turning the overlay off closes its window', gone === null)) return
  // The send must be harmless rather than merely invisible — main drops it before any window is
  // asked to draw, which is what makes "off means off" true rather than approximately true.
  await send(main, request('e2e:after-close', 'should never render'))
  const reopened = await toggleOverlay(main)
  const back = await waitForAlertWindow(app)
  if (!check('…and turning it back on reopens it', reopened && back !== null)) return
  const drawn = await settleStable(() => lines(back as Page), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  check('…with nothing queued from while it was closed', drawn.length === 0, `${drawn.length} line(s)`)
  void lane
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-toast.log…')
  const { app, close } = await launchOnFixture('e2e-toast.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })

    await stepDefaultsOff(app)

    const opened = await toggleOverlay(page)
    const lane = opened ? await waitForAlertWindow(app) : null
    if (check('toggling the alert kind spawns a real overlay window', lane !== null)) {
      const l = lane as Page
      check('…which renders nothing at rest', (await countOf(l, '[data-testid="alert-text-card"]')) === 0)
      await stepPreferences(page)
      await stepFirstLine(page, l)
      await stepStacking(page, l)
      await stepRefusal(page, l)
      await stepRepair(page, l)
      await stepInheritedLook(page, l)
      await stepOverriddenField(page, l)
      await stepStretch(app)
      await stepClosedIsSilent(app, page, l)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'alert-overlay-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the alert overlay spec did not complete')
  process.exitCode = 1
})
