/**
 * Headless Electron smoke test for the BUFFS/TIMER OVERLAY (JOS-89,
 * docs/plans/buff-timer-overlay.md).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The entry model is pinned on real fixture bytes in
 * tests/buffTimers.test.mts (the chain-mez, the honesty law, the death clear); the ≤25 % geometry
 * over every work area is pinned in tests/overlayLayout.test.mts; the text-scale seam in
 * tests/overlayTextScale.test.mts. What no unit test can claim is that the PIECES ARE WIRED —
 * that the kind ships OFF, that toggling it spawns a window with labelled chrome and a close
 * affordance, and above all that a mez cast into the LIVE LOG travels the whole real path
 * (chokidar → Tailer → parseEvent → BuffTimersModule → registry flush → `module:delta` → the
 * overlay's own fan-out in pipeline.ts → React) and comes out as a NAMED, PER-TARGET COUNTDOWN.
 *
 * That last one is the ticket. Ten user reports asked to chain-mez four or five enemies and see a
 * countdown per enemy; this spec casts one AE mez at two mobs in the running app and reads the
 * two rows back out of the DOM.
 *
 * IT SHIPS DEFAULT OFF, and every launch here gets a fresh userData dir — so this spec is always
 * a first run, which makes it the one place that can prove "off" is what a new install gets. That
 * is asserted BEFORE anything is toggled.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`. So this spec drives the app's own bridges rather
 * than clicking — a hidden, always-on-top window has no pointer — and reads geometry out of the
 * MAIN process, because "it covered my screen" is a claim about bounds.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read below goes through `settle`.
 *
 * Run: `npm run test:e2e -- buffs` (or `node --import tsx tests/e2e/buffs-overlay.e2e.mts`).
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
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import type { FixtureLog } from './logFixture.mjs'

/** The main window's overlay bridge — the same one the title-bar menu calls. */
interface OverlayBridge {
  getOverlayState: () => Promise<Record<string, boolean>>
  toggleOverlay: (k: string) => Promise<boolean>
}
function bridge(page: Page): {
  state: () => Promise<Record<string, boolean>>
  toggle: (k: string) => Promise<boolean>
} {
  return {
    state: () => page.evaluate(() => (window as unknown as { eq: OverlayBridge }).eq.getOverlayState()),
    toggle: (k: string) =>
      page.evaluate((kind) => (window as unknown as { eq: OverlayBridge }).eq.toggleOverlay(kind), k)
  }
}

/** The rows currently on the overlay: name + the time column + the mode the row is in. */
async function rows(overlay: Page): Promise<{ name: string; time: string; mode: string }[]> {
  return overlay.evaluate(() =>
    [...document.querySelectorAll('[data-testid="buff-timer-row"]')].map((el) => ({
      name: el.querySelector('[data-testid="buff-timer-name"]')?.textContent?.trim() ?? '',
      time: el.querySelector('[data-testid="buff-timer-time"]')?.textContent?.trim() ?? '',
      mode: el.getAttribute('data-timer-mode') ?? ''
    }))
  )
}

/** The target headings currently on the overlay (one block per entity). */
async function groups(overlay: Page): Promise<string[]> {
  return overlay.evaluate(() =>
    [...document.querySelectorAll('[data-testid="buff-timer-group"]')].map(
      (el) => el.firstElementChild?.textContent?.trim() ?? ''
    )
  )
}

/**
 * THE CHAIN-MEZ, played into the live log.
 *
 * These are the real sentences, in the real shapes, conjugated exactly as the owner's own
 * `w10-cazic-slow.log` prints them — one `You begin casting Mesmerization III.` followed by the
 * per-mob landing broadcasts in the same second. The two mob names are ordinary Plane of Fear
 * trash from that same window. Stamped at ONE instant so the model's 10 s own-cast window is
 * satisfied exactly as it is in the log.
 */
function castChainMez(log: FixtureLog): void {
  const at = new Date()
  log.appendAt(at, 'You begin casting Mesmerization III.')
  log.appendAt(new Date(at.getTime() + 1000), 'a turmoil toad has been mesmerized.', 'a scareling has been mesmerized.')
}

async function stepDefaultOff(page: Page, app: ElectronApplication): Promise<void> {
  const state = await bridge(page).state()
  check('a fresh install has the buff/timer overlay OFF (owner: validate internally first)', state.buffs === false, JSON.stringify(state))
  // …and no window for it exists, which is the part a stored flag alone could lie about.
  const spawned = app.windows().length
  let found = false
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=buffs')) found = true
  }
  check('…and no buffs overlay window was spawned at startup', !found, `${spawned} window(s) open`)
}

async function stepOpenAndChrome(page: Page, app: ElectronApplication): Promise<Page | null> {
  const open = await bridge(page).toggle('buffs')
  if (!check('toggling it from the overlay menu reports it OPEN', open === true)) return null

  const overlay = await overlayWindow(app, 'buffs')
  if (!check('…and a window for kind=buffs really exists', overlay !== null)) return null
  const o = overlay

  // LABELLED CHROME + A CLOSE AFFORDANCE — the JOS-83 conventions, in the DOM.
  const surface = await settle(() => countOf(o, '[data-testid="buffs-overlay"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('the surface mounts', surface === 1)
  const tag = await o.evaluate(() => document.body.innerText)
  check('…with the labelled BUFFS chrome', tag.includes('BUFFS'), tag.slice(0, 120))
  check('…and its title', tag.includes('Buffs & timers'))
  // Unlocked (this kind's default), so the header's controls are real and reachable. The close
  // affordance is selected by the aria-label the shared IconButton already carries.
  check('…and a visible close control', (await countOf(o, 'button[aria-label="Close overlay"]')) === 1)
  check('…and the lock (click-through) control beside it', (await countOf(o, 'button[aria-label^="Lock"]')) === 1)

  // IT HYDRATES FROM THE REPLAY, and that is worth pinning on its own: opening the window mid
  // session must show what the model already holds, not an empty pane waiting for the next cast.
  // (The fixture's replay leaves real buffs standing, so the quiet empty state is the OTHER
  // branch here — asserted as an either/or so this step states a fact about both.)
  // settleStable, not settle: there is no single condition to wait FOR here (either branch is a
  // pass), so the honest wait is "until the reading stops changing" — wave E3's rule for
  // asserting a steady state rather than betting on a clock.
  const first = await settleStable(() => rows(o), { timeoutMs: 20_000 })
  check(
    'the window shows what the model already holds, or says it is watching — never a blank pane',
    first.length > 0 || tag.includes('Watching for buffs'),
    `${first.length} row(s)`
  )
  if (first.length > 0) {
    // PER-TARGET, out of the replay alone: the fixture's debuffs are grouped under the enemy they
    // are on, which is the first half of what the reports asked for.
    const g = await groups(o)
    check(
      '…and a debuff you landed is filed under the enemy it is on',
      g.some((x) => x !== 'Your buffs'),
      JSON.stringify(g)
    )
  }
  return o
}

async function stepGeometry(app: ElectronApplication, overlay: Page): Promise<void> {
  // Read from MAIN — the answer to "it covered my whole screen". The pure invariant is pinned per
  // work area in tests/overlayLayout.test.mts; this is the real window on the real display.
  const win = await app.browserWindow(overlay)
  const bounds = await win.evaluate((w) => w.getBounds())
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  const share = (bounds.width * bounds.height) / (area.width * area.height)
  check(
    'the first-open buff overlay is a small window, not a screen-filling one (≤25%)',
    share < 0.25 && bounds.width < area.width && bounds.height < area.height,
    `${JSON.stringify(bounds)} on ${JSON.stringify(area)} (${(share * 100).toFixed(1)}%)`
  )
  check(
    '…and it starts on-screen',
    bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width,
    JSON.stringify(bounds)
  )
}

async function stepChainMez(overlay: Page, log: FixtureLog): Promise<void> {
  castChainMez(log)

  // THE WHOLE POINT: one cast, two enemies, two rows. Wait for the MEZ rows specifically — the
  // window already carries the replay's buffs, so "some rows exist" would settle instantly and
  // assert nothing (it did, the first time this spec ran).
  const seen = await settle(
    () => rows(overlay),
    (r) => r.filter((x) => x.name.startsWith('Mesmerization')).length >= 2,
    { timeoutMs: 30_000 }
  )
  const cc = seen.filter((r) => r.name.startsWith('Mesmerization'))
  if (!check('one AE mez cast raises a row PER ENEMY', cc.length === 2, JSON.stringify(seen))) return

  // NAMED, not a family: "has been mesmerized." is four spells in the DB and the player's own
  // cast is what narrows it (JOS-84's law, end to end through the real parser).
  check('…each row NAMES the spell rather than the family', cc.every((r) => r.name === 'Mesmerization'), JSON.stringify(cc))

  // COUNTING DOWN, because spells.json states Mesmerization at 24s.
  check('…and each counts DOWN from the stated duration', cc.every((r) => r.mode === 'countdown'), JSON.stringify(cc))
  check(
    '…showing a real remaining, never a negative or a blank',
    cc.every((r) => /^\d+s$/.test(r.time)),
    JSON.stringify(cc.map((r) => r.time))
  )
  check('…with a receding bar beside it', (await countOf(overlay, '[data-testid="buff-timer-fill"]')) >= 2)

  // PER-TARGET, and the targets are named — the reports asked to see WHICH enemy.
  const g = await groups(overlay)
  check(
    '…grouped under each enemy by name',
    g.some((x) => x.includes('a turmoil toad')) && g.some((x) => x.includes('a scareling')),
    JSON.stringify(g)
  )
}

async function stepBreakClearsOneTarget(overlay: Page, log: FixtureLog): Promise<void> {
  // The break line for ONE of the two. The other must be untouched — that is the difference
  // between a per-target model and a single "mez is up" flag.
  log.append('Your Mesmerization spell has worn off of a scareling.')
  const after = await settle(
    () => rows(overlay),
    (r) => r.filter((x) => x.name.startsWith('Mesmerization')).length === 1,
    { timeoutMs: 30_000 }
  )
  const g = await groups(overlay)
  check('a break line clears ONLY its own target', !g.some((x) => x.includes('a scareling')), JSON.stringify(g))
  check(
    '…and the other enemy keeps its countdown',
    after.some((r) => r.name === 'Mesmerization' && r.mode === 'countdown'),
    JSON.stringify(after)
  )
}

/** Close it the way a user would — its own ✕ — not by toggling the menu again. */
async function stepClose(page: Page, app: ElectronApplication, overlay: Page | null): Promise<void> {
  if (overlay) {
    await overlay.evaluate(() => {
      ;(document.querySelector('button[aria-label="Close overlay"]') as HTMLElement | null)?.click()
    })
  } else {
    await bridge(page).toggle('buffs')
  }
  const gone = await settle(
    async () => {
      let hit = 0
      for (const w of app.windows()) {
        const search = await w.evaluate(() => window.location.search).catch(() => '')
        if (search.includes('kind=buffs')) hit++
      }
      return hit
    },
    (n) => n === 0,
    { timeoutMs: 20_000 }
  )
  check('the close affordance actually closes the window', gone === 0, `${gone} still open`)
  // …and main recorded it, so the next launch does not bring it back uninvited.
  const state = await settle(() => bridge(page).state(), (s) => s.buffs === false, { timeoutMs: 10_000 })
  check('…and the app records it as closed', state.buffs === false, JSON.stringify(state))
}

async function main(): Promise<void> {
  await buildIfStale()
  const { app, close, log } = await launchOnFixture('e2e-overlay.log')
  const page = await mainWindow(app)
  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  try {
    await stepDefaultOff(page, app)
    const overlay = await stepOpenAndChrome(page, app)
    if (overlay) {
      overlay.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`overlay: ${m.text()}`)
      })
      await stepGeometry(app, overlay)
      await stepChainMez(overlay, log)
      await stepBreakClearsOneTarget(overlay, log)
    } else {
      note('the overlay window never appeared — the render assertions could not run')
    }
    await stepClose(page, app, overlay)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'buffs-overlay-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the buffs overlay spec did not complete')
  process.exitCode = 1
})
