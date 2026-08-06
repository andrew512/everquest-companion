/**
 * Headless Electron test for the two CROSS-WINDOW rulings of
 * docs/plans/combat-overlay-parity.md — P4/P5/P6 (fight selection is GLOBAL) and P3 (a LOCKED
 * overlay keeps its selector).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The pure halves are pinned elsewhere: the value model and the
 * one-seam wiring in tests/fightSelection.test.mts, the locked-selector mechanism in
 * tests/overlayLockedSelector.test.mts. What no unit test can claim is that the PIECES ARE WIRED
 * ACROSS PROCESSES — that a pick in the Combat tab crosses main and lands in a floating overlay's
 * own renderer, that the reverse works, that a zone-session id offered to the same door is
 * REFUSED, and that a locked overlay still renders a working selector while its bars do not.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`, so the fight overlay here is created, loaded and
 * driven entirely off-screen while the user plays.
 *
 * IT DRIVES THE BRIDGES, NOT A CURSOR. A hidden, always-on-top window has no pointer, so the
 * selection half goes through the REAL `window.eq` / `window.eqOverlay` calls the selectors
 * themselves make — the same channels, the same validation in main. For the LOCKED half the
 * honest limit is stated in the assertions: this harness cannot make Windows deliver a forwarded
 * mouse event to a hidden window, so it asserts the two things it CAN see — that the selector is
 * rendered and interactive while locked, and that the header's hover sensor really does flip the
 * window's capture state (the lock/close controls reveal only when it has) — and it asserts the
 * click-through half NEGATIVELY, by checking the meter's bars offer no pointer at all.
 *
 * Assertions are identities/floors against whatever the live log contains right now — never
 * today's numbers (AGENTS.md: frozen numbers rot).
 *
 * Run: `npm run test:e2e` (or `node --import tsx tests/e2e/overlay-sync.e2e.mts`).
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  HYDRATE_TIMEOUT_MS,
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  sleep,
  snapshot
} from './appHarness.mjs'
import { launchApp, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'

/** The overlay open-state this spec's second launch runs against (`overlays.fight` in the store). */
interface OverlayBridge {
  getOverlayState: () => Promise<Record<string, boolean>>
  toggleOverlay: (k: string) => Promise<boolean>
}

function overlayState(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() =>
    (window as unknown as { eq: OverlayBridge }).eq.getOverlayState()
  )
}

/** The sentinel every fight-scoped surface starts on (shared/fightSelection.ts). */
const LIVE = '__live__'

interface FightBridge {
  getFightSelection: () => Promise<string>
  setFightSelection: (id: string) => void
}

/** Read the global selection through a window's own bridge — main app or overlay alike. */
function readSelection(page: Page, bridge: 'eq' | 'eqOverlay'): Promise<string> {
  return page.evaluate(
    (b) => (window as unknown as Record<string, FightBridge>)[b].getFightSelection(),
    bridge
  )
}

/** Write it through a window's own bridge, exactly as that window's selector does. */
function writeSelection(page: Page, bridge: 'eq' | 'eqOverlay', id: string): Promise<void> {
  return page.evaluate(
    ([b, v]) => {
      ;(window as unknown as Record<string, FightBridge>)[b].setFightSelection(v)
    },
    [bridge, id] as const
  )
}

/** The overlay page for one kind, identified by the `?kind=` query its window was opened with. */
async function findOverlay(app: ElectronApplication, kind: string): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes(`kind=${kind}`)) return w
  }
  return null
}

async function waitForOverlay(app: ElectronApplication, kind: string, timeoutMs = 30_000): Promise<Page | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const w = await findOverlay(app, kind)
    // The window can exist a beat before its preload has run; the bridge is the real signal.
    if (w) {
      const ready = await w
        .evaluate(() => typeof (window as unknown as { eqOverlay?: FightBridge }).eqOverlay?.getFightSelection === 'function')
        .catch(() => false)
      if (ready) return w
    }
    await sleep(400)
  }
  return null
}

/** Hydration has to finish before any fight id exists to select. */
async function waitHydrated(page: Page): Promise<boolean> {
  const t0 = Date.now()
  let snap = await snapshot(page)
  while (snap.hydrating && Date.now() - t0 < HYDRATE_TIMEOUT_MS) {
    await sleep(1500)
    snap = await snapshot(page)
  }
  return !snap.hydrating
}

/** A real finalized fight id from the live log, or null when the log holds none. */
async function someFinalizedFight(page: Page): Promise<string | null> {
  const snap = await snapshot(page)
  return snap.segments.find((s) => s.kind === 'fight')?.id ?? null
}

// ── P4/P5/P6: the selection crosses windows ─────────────────────────────────────────────

async function stepBothStartLive(app: Page, overlay: Page): Promise<void> {
  check('the app starts on the LIVE sentinel (ephemeral — a fresh launch pins nothing)',
    (await readSelection(app, 'eq')) === LIVE)
  check('…and an overlay opened afterwards HYDRATES to the same value',
    (await readSelection(overlay, 'eqOverlay')) === LIVE)
}

async function stepPanelMovesOverlay(app: Page, overlay: Page, fightId: string): Promise<void> {
  await writeSelection(app, 'eq', fightId)
  await sleep(600)
  check(
    'picking a fight in the COMBAT PANEL moves the fight overlay (ruling 4)',
    (await readSelection(overlay, 'eqOverlay')) === fightId,
    await readSelection(overlay, 'eqOverlay')
  )
  // …and the overlay actually RENDERS that fight, not just knows about it: its header title is
  // the selected segment's own name, so a stuck header would mean the selection never reached
  // the meter. The name itself is log-dependent, so the claim is "not the empty state".
  const title = await overlay.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())
  check('…and the overlay renders a fight rather than its empty state', !title.includes('No fight'), title.slice(0, 120))
}

async function stepOverlayMovesPanel(app: Page, overlay: Page): Promise<void> {
  await writeSelection(overlay, 'eqOverlay', LIVE)
  await sleep(600)
  check(
    'and the reverse: picking in the OVERLAY moves the combat panel',
    (await readSelection(app, 'eq')) === LIVE,
    await readSelection(app, 'eq')
  )
}

/**
 * THE CARVE-OUT, at the seam. "Overall (zone-session) selection stays per-overlay" is only true
 * if a zone id physically cannot become the global — main validates rather than trusting the
 * renderer, so offering one here must change nothing at all.
 */
async function stepZoneIdRefused(app: Page, overlay: Page, fightId: string): Promise<void> {
  await writeSelection(app, 'eq', fightId)
  await sleep(400)
  for (const bogus of ['zone', 'zs1', '', 'not-a-fight']) {
    await writeSelection(overlay, 'eqOverlay', bogus)
  }
  await sleep(600)
  check(
    'a ZONE-SESSION id offered to the global selection is refused — the fight stays put',
    (await readSelection(app, 'eq')) === fightId && (await readSelection(overlay, 'eqOverlay')) === fightId,
    `${await readSelection(app, 'eq')} / ${await readSelection(overlay, 'eqOverlay')}`
  )
}

/** P6: a well-formed id the engine has never heard of must degrade, not blank the surface. */
async function stepStaleId(app: Page, overlay: Page): Promise<void> {
  await writeSelection(app, 'eq', 'e999999')
  await sleep(800)
  check('a STALE fight id is kept (P6 — the global is never cleared by a surface)',
    (await readSelection(overlay, 'eqOverlay')) === 'e999999')
  const title = await overlay.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())
  check(
    '…and the overlay degrades to the engine’s default rather than going blank',
    title.length > 0 && !title.includes('No fight'),
    title.slice(0, 120)
  )
}

// ── P3: a locked overlay keeps its selector ─────────────────────────────────────────────

/** The selector trigger, by the ARIA contract OverlayHeader renders. */
const TRIGGER = '[aria-haspopup="listbox"]'

async function stepLockedSelector(overlay: Page): Promise<void> {
  // The lock is PERSISTED per kind, so start from a known mode rather than from whatever the
  // last run (or the user's own dev app) left behind.
  await overlay.evaluate(() => {
    ;(window as unknown as { eqOverlay: { setLocked: (b: boolean) => void } }).eqOverlay.setLocked(false)
  })
  await sleep(500)
  check('an INTERACTIVE overlay offers its selector', (await countOf(overlay, TRIGGER)) === 1)

  await overlay.evaluate(() => {
    ;(window as unknown as { eqOverlay: { setLocked: (b: boolean) => void } }).eqOverlay.setLocked(true)
  })
  await sleep(700)

  // THE RULING: locked, and the top selector row is still there. Before P3 this was 0.
  check('a LOCKED overlay STILL offers its selector (ruling 3)', (await countOf(overlay, TRIGGER)) === 1)

  // …and the rest is click-through: with no drill setter the BARS render no pointer at all, which
  // is the DOM-visible half of "everything else stays click-through". Measured on the bars box
  // alone, because the selector row above it is SUPPOSED to be a pointer — that is the ruling.
  // The window-level half (setIgnoreMouseEvents) cannot be observed from a hidden window; the
  // next assertion is the closest proxy this harness can honestly get to it.
  const pointers = await overlay.evaluate(() =>
    [...document.querySelectorAll('[data-testid="overlay-bars"] *')].filter(
      (el) => getComputedStyle(el).cursor === 'pointer'
    ).length
  )
  check('…while its BARS offer no click target at all (locked stays click-through)', pointers === 0, `${pointers} pointer element(s)`)

  // The hover sensor: entering the HEADER ROW is what asks main to stop ignoring mouse events,
  // and the lock/close controls reveal only once that capture has been taken. So their appearance
  // is the observable proof the P3 path ran — on the header, and only there.
  //
  // It is dispatched as a BUBBLING `mouseover` from outside, not as `mouseenter`: React 17+
  // synthesises enter/leave at the root from mouseover/mouseout, so a directly-dispatched
  // non-bubbling `mouseenter` reaches no handler at all (it silently did nothing here first).
  const before = await overlay.evaluate(() => document.querySelectorAll('button').length)
  await overlay.evaluate(() => {
    const row = document.querySelector('[aria-haspopup="listbox"]')?.parentElement
    row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
  })
  await sleep(400)
  const after = await overlay.evaluate(() => document.querySelectorAll('button').length)
  check(
    '…and hovering the selector ROW captures the mouse (its controls reveal)',
    before === 0 && after > 0,
    `${before} → ${after} control(s)`
  )

  await overlay.evaluate(() => {
    ;(window as unknown as { eqOverlay: { setLocked: (b: boolean) => void } }).eqOverlay.setLocked(false)
  })
  await sleep(500)
}

/**
 * LAUNCH 1 EXISTS TO LEAVE STATE BEHIND. This spec is written against an install that already
 * has an overlay open — its ask-first toggle below is exactly that assumption — and it used to
 * get one by inheriting whatever the previous spec left in the shared userData dir. That is not
 * inheritance, it is luck. So the spec now MAKES its own history: open the fight overlay through
 * the app's own door, quit, and hand launch 2 the same dir.
 */
async function seedOverlayOpen(userData: string): Promise<void> {
  console.log('launch 1: opening the fight overlay, so launch 2 starts from an install that has one…')
  const { app, close } = await launchApp({ userData })
  try {
    const page = await mainWindow(app)
    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
    await page.evaluate(async () => {
      const eq = (window as unknown as { eq: OverlayBridge }).eq
      const state = await eq.getOverlayState()
      if (!state.fight) await eq.toggleOverlay('fight')
    })
    // The open-state is written by main when the window is created; give that write its beat.
    await sleep(1_000)
  } finally {
    await close()
  }
}

async function main(): Promise<void> {
  buildIfStale()
  // A dir shared by this spec's TWO launches and nothing else: the overlay's open-state is
  // PERSISTED, and running against an install that already carries one is the point (see
  // seedOverlayOpen). The fight SELECTION is ephemeral by design and needs nothing from disk.
  const userData = makeUserData()
  await seedOverlayOpen(userData)

  console.log('launch 2: hidden Electron (EQ_E2E=1) — overlay/panel sync spec…')
  const { app, close } = await launchApp({ userData })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
    if (!check('hydration completes (replay hands off to the live tail)', await waitHydrated(page))) {
      throw new Error('still hydrating — nothing below can be asserted')
    }

    // ASK, NEVER TOGGLE BLIND. `overlay:toggle` is a toggle and the open-state is PERSISTED, so a
    // spec that toggled unconditionally would close the very window launch 1 opened for it.
    check(
      'the overlay launch 1 opened is still open in launch 2 — the open-state persists',
      (await overlayState(page)).fight === true
    )
    await page.evaluate(async () => {
      const eq = (window as unknown as { eq: OverlayBridge }).eq
      const state = await eq.getOverlayState()
      if (!state.fight) await eq.toggleOverlay('fight')
    })
    const overlay = await waitForOverlay(app, 'fight')
    if (!check('the fight overlay window opens and its bridge is live', overlay !== null)) {
      throw new Error('no fight overlay window')
    }
    const ov = overlay as Page

    await stepBothStartLive(page, ov)

    const fightId = await someFinalizedFight(page)
    if (fightId) {
      await stepPanelMovesOverlay(page, ov, fightId)
      await stepOverlayMovesPanel(page, ov)
      await stepZoneIdRefused(page, ov, fightId)
    } else {
      note('the live log holds no finalized fight right now — the cross-window selection steps were skipped')
    }
    await stepStaleId(page, ov)
    await stepLockedSelector(ov)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'overlay-sync-FAIL')
  } finally {
    await close()
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the overlay-sync spec did not complete')
  process.exitCode = 1
})
