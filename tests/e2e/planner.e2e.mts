/**
 * Headless Electron integration test for the PLANNER tab (docs/plans/exaltation-planner.md §9,
 * wave 3).
 *
 * WHY ITS OWN FILE: one spec per surface, all of them sharing `appHarness.mts` and running back
 * to back from `npm run test:e2e`. `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock and points `userData` at a throwaway temp dir, so this runs invisibly
 * beside the user's game and dev app.
 *
 * WHY `userData` IS WIPED FIRST: the first assertion is the EMPTY STATE — a character with no
 * saved sets is invited to create one. The sets live in the store and the selected set/mode live
 * in `localStorage`, both inside `userData`, so a dir left behind by an earlier run would make
 * that assertion vacuous (and would land the pane in whichever mode the last run left open).
 *
 * WHAT IT ASSERTS, against the REAL committed item DB: the nav row mounts the pane on its empty
 * state; creating a set from the UI produces a set chip and a toolbar; the effect browser lists
 * at least one effect row and expands it into at least one donor (the corpus is committed data,
 * so this is deterministic — but it is asserted as a FLOOR, never as today's count); adding that
 * donor to the set writes a socket that BOTH other modes can see — the Board draws it in a cell
 * with a state chip, and the Farm rollup lists it under some heading; the two growing lists are
 * BOUNDED scroll boxes (the Task-#56 law); and the era filter is ON by default and actually
 * removes rows when it is switched off (the corpus is majority Kunark/Velious, so "off shows
 * more" is an identity, not a number).
 *
 * The one thing it deliberately does NOT assert is which effects or donors are on screen: a
 * rescrape may re-word an effect, and a spec that pins today's proc names would rot (AGENTS.md:
 * frozen numbers rot).
 *
 * Run: `npm run test:e2e`.
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { rmSync } from 'node:fs'
import {
  MAIN_ENTRY,
  ROOT,
  USER_DATA,
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  electronBinary,
  failures,
  note,
  pageOverflow,
  rectOf,
  reportRun,
  sleep
} from './appHarness.mjs'

const NAV = '[data-testid="nav-planner"]'
const VIEW = '[data-testid="planner-view"]'
const NEW_SET_EMPTY = '[data-testid="planner-new-set-empty"]'
const SET_CHIP = '[data-testid="planner-set-chip"]'
const EFFECT_LIST = '[data-testid="planner-effect-list"]'
const ERA_TOGGLE = '[data-testid="planner-era-toggle"]'
const ADD_BUTTON = '[data-testid="planner-add"]:not([disabled])'
const MODE_BOARD = '[data-testid="planner-mode-board"]'
const MODE_FARM = '[data-testid="planner-mode-farm"]'
const BOARD = '[data-testid="planner-board"]'
const BOARD_CELL = '[data-testid="planner-board-cell"]'
const SOCKET_LINE = '[data-testid="planner-socket-line"]'
const HOST_SEARCH = '[data-testid="planner-host-search"] input'
const HOST_HIT = '[data-testid="planner-host-hit"]'
const HOST_NAME = '[data-testid="planner-host-name"]'
const STATE_CHIP = '[data-testid="planner-state-chip"]'
const FARM_LIST = '[data-testid="planner-farm-list"]'
const FARM_ROW = '[data-testid="planner-farm-row"]'
const MODE_EFFECTS = '[data-testid="planner-mode-effects"]'
const NONEQUIP_TOGGLE = '[data-testid="planner-nonequip-toggle"]'
const NOSLOT_CHIP = '[data-testid="planner-noslot-chip"]'
const DONOR_NAME = '[data-testid="planner-donor-name"]'

/** The Loot tab's drill-down, where a donor name deep-links to. */
const LOOT_DETAIL = '[data-testid="loot-detail"]'
const LOOT_TITLE = '[data-testid="loot-detail-title"]'
const LOOT_DB_SOURCES = '[data-testid="loot-db-sources"]'

/** An effect group header — the browser lists one per effect, and expanding it lists its donors. */
const EFFECT_ROW = '[data-testid="planner-effect-row"]'

/** Rendered text of the first match; '' when the node isn't mounted. */
function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Box + scroll geometry — enough to prove a growing list is a BOUNDED scroller. */
function boxOf(page: Page, sel: string): Promise<{ h: number; scrollH: number; clientH: number } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    return { h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }, sel)
}

/** Poll a predicate until it holds or the deadline passes. */
async function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    if (await fn()) return true
    if (Date.now() - t0 >= ms) return false
    await sleep(300)
  }
}

/** 1. THE NAV ROW MOUNTS THE PANE. False on the no-logs machine, where no feature view mounts. */
async function stepMount(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the nav drawer has a Planner row', hasRow)) return false
  await page.click(NAV, { timeout: 15_000 })

  // A character with no sets gets the invitation; one with sets gets the toolbar. Either is a
  // mounted pane — on a wiped userData it is always the first.
  const mounted = await until(
    async () => (await countOf(page, NEW_SET_EMPTY)) > 0 || (await countOf(page, VIEW)) > 0,
    30_000
  )
  if (!mounted) {
    const noLogs = (await textOf(page, 'main')).includes('No EverQuest logs found')
    check('clicking Planner mounts the pane (or the no-logs empty state explains why not)', noLogs)
    if (noLogs) note('no character logs on this machine — the app shows its fresh-machine empty state')
    return false
  }
  check(
    'clicking the Planner nav row mounts the pane on its create-a-set empty state',
    (await countOf(page, NEW_SET_EMPTY)) > 0,
    `${String(await countOf(page, SET_CHIP))} sets already stored`
  )
  return true
}

/** 2. CREATING A SET FROM THE UI GIVES THE PANE ITS TOOLBAR. */
async function stepCreateSet(page: Page): Promise<boolean> {
  if ((await countOf(page, NEW_SET_EMPTY)) > 0) await page.click(NEW_SET_EMPTY, { timeout: 15_000 })
  const made = await until(async () => (await countOf(page, SET_CHIP)) > 0, 15_000)
  check('creating a set from the empty state produces a set chip and the toolbar', made)
  return made
}

/** 3. THE EFFECT BROWSER LISTS THE COMMITTED CORPUS, in a bounded box. */
async function stepEffects(page: Page): Promise<boolean> {
  const listed = await until(async () => (await countOf(page, EFFECT_ROW)) > 0, 60_000)
  const box = await boxOf(page, EFFECT_LIST)
  check('the effect browser renders rows from the committed item DB', listed, `${String(await countOf(page, EFFECT_ROW))} rows`)
  check(
    'the effect list is its own scroller (a growing list never grows the page)',
    box !== null && box.h > 0 && box.scrollH >= box.clientH,
    box ? `${String(box.h)}px tall · scrollHeight ${String(box.scrollH)} vs clientHeight ${String(box.clientH)}` : 'absent'
  )
  return listed
}

/**
 * The effect list's SCROLL HEIGHT — the total row count, in pixels.
 *
 * Not a count of rows in the DOM: the list is windowed, so the number of mounted rows says how
 * tall the viewport is, not how many rows exist. And it POLLS for the element, because the view
 * legitimately remounts while the app is still reading the log (App keys the view on the
 * character), and a measurement taken inside that gap would read as "the list vanished".
 */
async function listHeight(page: Page): Promise<number> {
  let last = 0
  await until(async () => {
    last = (await boxOf(page, EFFECT_LIST))?.scrollH ?? 0
    return last > 0
  }, 20_000)
  return last
}

/** Poll until the list's height settles at something other than `was` (or give up and report). */
async function heightAfterToggle(page: Page, was: number): Promise<number> {
  let now = was
  await until(async () => {
    now = await listHeight(page)
    return now !== was
  }, 15_000)
  return now
}

/**
 * 4. THE ERA FILTER IS ON BY DEFAULT, AND TURNING IT OFF REVEALS MORE.
 *
 * This is an identity, not a number: the committed corpus documents every expansion, so a filter
 * that is genuinely hiding out-of-era donors must have a SHORTER list than the same filter off,
 * and switching it back must land on exactly the height it started at.
 */
async function stepEra(page: Page): Promise<void> {
  if (!check('the effect browser offers the current-era filter', (await countOf(page, ERA_TOGGLE)) > 0)) return
  const filtered = await listHeight(page)

  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const unfiltered = await heightAfterToggle(page, filtered)
  check(
    'the era filter is ON by default and hides out-of-era donors (turning it off can only reveal more)',
    unfiltered > filtered,
    `list ${String(filtered)}px filtered → ${String(unfiltered)}px unfiltered`
  )

  // Put it back: the rest of the run should see the default surface.
  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, unfiltered)
  check('…and switching it back on restores exactly the filtered list', again === filtered, `${String(again)}px`)
}

/**
 * 4b. THE NON-EQUIPPABLE FILTER IS OFF BY DEFAULT, AND TURNING IT ON REVEALS MORE.
 *
 * The mirror image of the era check, and an identity for the same reason: R2 only lets an
 * exaltation move between items sharing an equipment slot, so the 287 slotless donor rows in the
 * committed corpus (the potion aisle, plus poisons on the Proc tab) can never legally donate and
 * are hidden by default. Switching the escape hatch on can therefore only ADD rows — and each one
 * it adds must carry the `no slot` chip that says why it was hidden.
 */
async function stepNonEquip(page: Page): Promise<void> {
  if (!check('the effect browser offers the non-equippable escape toggle', (await countOf(page, NONEQUIP_TOGGLE)) > 0)) return
  const hidden = await listHeight(page)
  check('slotless donors are hidden by default, so no row claims "no slot"', (await countOf(page, NOSLOT_CHIP)) === 0)

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const shown = await heightAfterToggle(page, hidden)
  check(
    'turning non-equippable ON can only reveal more donors (R2 hides them, it never invents them)',
    shown > hidden,
    `list ${String(hidden)}px equippable-only → ${String(shown)}px with consumables`
  )

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, shown)
  check('…and switching it back off restores exactly the equippable list', again === hidden, `${String(again)}px`)
}

/**
 * Expand an effect group so its donors are on screen. Retried once: the view remounts while the
 * app is still reading the log (App keys it on the character), and a remount collapses the tree —
 * which is correct behaviour for a fresh mount, and must not be read as "effects have no donors".
 */
async function ensureDonorRow(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await countOf(page, ADD_BUTTON)) > 0) return true
    await page.click(EFFECT_ROW, { timeout: 15_000 })
    if (await until(async () => (await countOf(page, ADD_BUTTON)) > 0, 8000)) return true
  }
  return false
}

/** 5. ADDING A DONOR WRITES A SOCKET THE BOARD DRAWS. */
async function stepAddAndBoard(page: Page): Promise<boolean> {
  if (!check('an effect row expands into at least one donor', await ensureDonorRow(page), `${String(await countOf(page, ADD_BUTTON))} donors`)) {
    return false
  }
  await page.click(ADD_BUTTON, { timeout: 15_000 })
  await sleep(400)
  // A donor that occupies more than one slot opens a slot menu instead of writing directly.
  if ((await countOf(page, '.MuiMenu-root .MuiMenuItem-root')) > 0) {
    await page.click('.MuiMenu-root .MuiMenuItem-root', { timeout: 15_000 })
    await sleep(400)
  }

  await page.click(MODE_BOARD, { timeout: 15_000 })
  const drawn = await until(async () => (await countOf(page, SOCKET_LINE)) > 0, 15_000)
  const cells = await countOf(page, BOARD_CELL)
  check('the Board draws every equipment slot, planned or not', cells >= 18, `${String(cells)} cells`)
  check('adding a donor from the browser writes a socket the Board draws', drawn, `${String(await countOf(page, SOCKET_LINE))} socket lines`)
  check(
    'each planned socket carries exactly one state chip',
    (await countOf(page, STATE_CHIP)) === (await countOf(page, SOCKET_LINE)),
    `${String(await countOf(page, STATE_CHIP))} chips for ${String(await countOf(page, SOCKET_LINE))} sockets`
  )
  const rect = await rectOf(page, BOARD)
  check('the board has real height', !!rect && rect.h > 0, rect ? `${String(rect.w)}×${String(rect.h)}px` : 'absent')
  return drawn
}

/**
 * 6. THE HOST PICKER SEARCHES MAIN'S ITEM INDEX AND NARROWS IT TO THE CELL.
 *
 * Both outcomes are correct: a query that yields a slot- and class-compatible item picks it, and
 * one that does not says so in a sentence. Only a picker that opens onto nothing is a failure.
 */
async function stepHostPicker(page: Page): Promise<void> {
  const cell = `${BOARD_CELL}[data-slot="PRIMARY"] [data-testid="planner-host-pick"]`
  if ((await countOf(page, cell)) === 0) {
    note('the PRIMARY cell already has a host — the picker step is skipped this run')
    return
  }
  await page.click(cell, { timeout: 15_000 })
  const opened = await until(async () => (await countOf(page, HOST_SEARCH)) > 0, 10_000)
  if (!check('the host line opens a search popover', opened)) return

  await page.fill(HOST_SEARCH, 'sword', { timeout: 15_000 })
  await until(async () => (await countOf(page, HOST_HIT)) > 0, 8000)
  const hits = await countOf(page, HOST_HIT)
  if (hits === 0) {
    note('no item matching "sword" can go in PRIMARY for this set — the picker states that, which is the correct answer')
    await page.keyboard.press('Escape')
    return
  }
  await page.click(HOST_HIT, { timeout: 15_000 })
  const named = await until(async () => (await countOf(page, HOST_NAME)) > 0, 8000)
  check('picking a hit sets that cell’s host item', named, `${String(hits)} compatible hits`)
}

/** 7. THE FARM ROLLUP LISTS WHAT IS LEFT — or says, honestly, that nothing is. */
async function stepFarm(page: Page): Promise<void> {
  await page.click(MODE_FARM, { timeout: 15_000 })
  const mounted = await until(async () => (await countOf(page, FARM_LIST)) > 0, 15_000)
  if (!check('the Farm mode mounts its rollup', mounted)) return

  const rows = await countOf(page, FARM_ROW)
  const text = (await textOf(page, FARM_LIST)).replace(/\s+/g, ' ').trim()
  check(
    'the rollup either lists the planned donor under a heading, or states why it lists nothing',
    rows > 0 || text.length > 0,
    rows > 0 ? `${String(rows)} rows` : text.slice(0, 120)
  )
  if (rows === 0) {
    note('the planned donor is out of era (or already merged to its extraction tier), so the rollup is legitimately empty')
    return
  }
  const box = await boxOf(page, FARM_LIST)
  check(
    'the farm list is its own scroller',
    box !== null && box.h > 0 && box.scrollH >= box.clientH,
    box ? `${String(box.h)}px tall` : 'absent'
  )
  check(
    'every farm row states the merge cost in the shared vocabulary ("needs +N — ≈X D0 merges")',
    /needs \+\d+ — ≈\d+ D0 merges/.test(text),
    text.slice(0, 140)
  )
}

/**
 * 8. A DONOR NAME DEEP-LINKS INTO THE LOOT DRILL-DOWN — and the drill is worth the trip.
 *
 * The click is the app's standing link idiom (`openLoot`, appRouting.ts): it takes the Loot pane
 * over with that item's detail. The second half of the check is the one that matters — the drill
 * used to build "Dropped by / Zones" from OBSERVED loot events alone, so a donor you have never
 * looted answered "No source recorded" one click after the planner told you which mob drops it.
 * `loot-db-sources` is the section that closes that contradiction, so its presence is the actual
 * contract this link depends on.
 *
 * Runs LAST: it leaves the app on the Loot tab, so every planner-scoped measurement above it must
 * already have been taken.
 */
async function stepDeepLink(page: Page): Promise<void> {
  await page.click(MODE_EFFECTS, { timeout: 15_000 })
  if (!(await ensureDonorRow(page))) {
    note('no donor row on screen to click through — the deep-link step is skipped this run')
    return
  }
  const name = (await textOf(page, DONOR_NAME)).trim()
  await page.click(DONOR_NAME, { timeout: 15_000 })

  const landed = await until(async () => (await countOf(page, LOOT_DETAIL)) > 0, 20_000)
  if (!check('clicking a donor name opens the Loot tab’s item drill-down', landed, `donor "${name}"`)) return
  const title = (await textOf(page, LOOT_TITLE)).replace(/\s+/g, ' ').trim()
  check('…on the item that was clicked, not on the ledger', title === name, `"${title}" vs "${name}"`)
  check(
    'the drill states what the committed DBs know about where it drops (never-looted items included)',
    (await countOf(page, LOOT_DB_SOURCES)) > 0
  )
}

/** Everything downstream of "there is a set to plan into", in order. */
async function steps(page: Page): Promise<void> {
  if (await stepEffects(page)) {
    await stepEra(page)
    await stepNonEquip(page)
    if (await stepAddAndBoard(page)) {
      await stepHostPicker(page)
      await stepFarm(page)
    }
  }
  const over = await pageOverflow(page)
  check(
    'the Planner never scrolls the page (its lists clip inside their own boxes)',
    over.doc === 0 && over.content === 0,
    `document +${String(over.doc)}px · content area +${String(over.content)}px`
  )
  await stepDeepLink(page)
}

async function main(): Promise<void> {
  buildIfStale()
  // See the header: a stored set (or a remembered mode) would make the empty-state assertion
  // vacuous. ARTIFACTS is deliberately not wiped.
  rmSync(USER_DATA, { recursive: true, force: true })

  console.log('launch: hidden Electron (EQ_E2E=1) against the real log — Planner spec…')
  const app: ElectronApplication = await electron.launch({
    executablePath: electronBinary(),
    args: [MAIN_ENTRY],
    cwd: ROOT,
    env: { ...process.env, EQ_E2E: '1', EQ_E2E_USER_DATA: USER_DATA, NODE_ENV: 'production' },
    timeout: 60_000
  })

  let page: Page | null = null
  try {
    page = await app.firstWindow({ timeout: 60_000 })
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    if ((await stepMount(page)) && (await stepCreateSet(page))) await steps(page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    if (failures.length) await dumpArtifacts(page, 'planner-FAIL')
    else await dumpArtifacts(page, 'planner-pass')
  } finally {
    await app.close().catch(() => undefined)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
