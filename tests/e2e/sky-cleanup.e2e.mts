/**
 * Headless Electron integration test for THE CLEANUP TAB (JOS-389) — the fifth Sky tab, which
 * lists the quest items no un-turned-in quest still wants, says where they are sitting, and argues
 * the other way before you throw them out.
 *
 * THE OWNER'S ASK, 2026-08-16: after a long Plane of Sky campaign a player is carrying dozens of
 * quest items in bags, bank, shared bank, personal depot and the Dragon Hoard for quests they
 * finished months ago, and nothing in the app has ever said which are safe to destroy. Nothing
 * should say "destroy this" either: a Sky quest can be run AGAIN, a second turn-in is a second copy
 * of the reward, and two copies merge into a +1. So the row carries both halves.
 *
 * WHY THIS NEEDS A REAL APP. The arithmetic is pure and pinned without a browser
 * (tests/skyCleanup.test.mts drives the five cases, including the ones this spec cannot stage).
 * What no unit test can see is the WIRING, and almost all of it is new here: the turn-in ledger →
 * `reconcile` → the cleanup model → a tab whose COUNT is computed above the pane it labels; the
 * `/outputfile inventory` dump → main's `character:sheet` → `carryAll` → the place on the row; and
 * the destroyed override, which is a full round trip through IPC, the store, the sanitizer and
 * back into two different tabs' numbers.
 *
 * THE FIXTURE IS THE POINT, and it was measured rather than invented. The committed dump
 * (tests/fixtures/Primitive_freeport-Inventory.txt, a real `/outputfile inventory`) contains
 * EXACTLY ONE Plane of Sky quest item — `Azarack Skin`, one copy, in `General 5-Slot7` — and that
 * item is required by exactly ONE quest in the committed data, `Beastlord Test of Azarack`. So a
 * single recorded turn-in flips one item from "still wanted" to "spare", and every number below is
 * caused by that one act. The log fixture `e2e-copy.log` carries ZERO loot lines, so nothing else
 * can be in the way.
 *
 * (It also means the dump ANSWERS the count after the turn-in, which is `reconcile`'s rule doing
 * its job in public: a dump is an observation of what you are HOLDING, so it owes no turn-in
 * subtraction — the file was written after all of them. The row reads 1 because the file says 1.)
 *
 * THE ARC, in five steps:
 *   1. the tab is there, with the caveat up and NOTHING listed — the quest has not been run, so
 *      the skin in the bag is not spare. This is the membership rule, asserted as an absence.
 *   2. record one turn-in on the quest → the item is listed, with its quantity, the place the dump
 *      put it, and the turn-in line: who takes it, how many times, what it pays, and the gap.
 *   3. "I destroyed these" → the row leaves, and an Undo takes its place.
 *   4. Undo → the statement is taken back and the row comes back with it.
 *   5. destroy again, and the QUEST tab agrees: the item's Have cell reads 0/1 and carries the
 *      provenance chip, because there is ONE override ledger and every Sky surface reads it.
 *      Clearing it from that chip puts the Cleanup row back — the same seam, driven the other way
 *      — and proves the undo strip's scope is deliberate: it is component state, so leaving the
 *      tab ends it, and the statement is still reachable where every other one is.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- sky-cleanup`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const SEARCH = '[data-testid="posky-search"]'
const COUNTS = '[data-testid="posky-counts"]'
const QUEST_ROW = '[data-testid="posky-quest-row"]'
const SUMMARY = `${QUEST_ROW} .MuiAccordionSummary-root`
const RECORD_TURNIN = '[data-testid="posky-record-turnin"]'

const TAB_QUESTS = '[data-testid="posky-tab-quests"]'
const TAB_CLEANUP = '[data-testid="posky-tab-cleanup"]'
const CLEANUP = '[data-testid="posky-cleanup"]'
const CAVEAT = '[data-testid="posky-cleanup-caveat"]'
const EMPTY = '[data-testid="posky-cleanup-empty"]'
const ROW = '[data-testid="posky-cleanup-row"]'
const DESTROY = `${ROW} [data-testid="posky-cleanup-destroy"]`
const DESTROYED = '[data-testid="posky-cleanup-destroyed"]'
const UNDO = `${DESTROYED} [data-testid="posky-cleanup-undo"]`
const REFRESH = '[data-testid="posky-cleanup-refresh"]'
/** The provenance chip the statement leaves on the QUEST row, and its take-back (JOS-186). */
const CHIP = '[data-testid="posky-item-override"]'
const CHIP_CLEAR = `${CHIP} .MuiChip-deleteIcon`

const QUEST = 'Beastlord Test of Azarack'
const ITEM = 'Azarack Skin'
/** The dump that holds exactly one Sky item — see the header. */
const DUMP = 'Primitive_freeport-Inventory.txt'
/** The owner's caveat, in his own words. "There is a warning" is not the assertion; this is. */
const CAVEAT_TEXT =
  'Cleanup lists items you could destroy because every Sky quest that needs them has been turned in. Destroying is permanent and happens in the game, not here. If you delete something you wanted, that is on you.'
/** What a row says when no loaded dump names the item - the state the place read starts in. */
const NO_PLACE = 'location not in the inventory dump'

/**
 * A PICTURE OF THE TAB — OPT-IN, and off in every ordinary run.
 *
 * THIS SUITE CANNOT PHOTOGRAPH ITSELF, and that is by design rather than by defect. `EQ_E2E=1`
 * never shows the window (src/main/e2e.ts), so `page.screenshot` waits for a frame an uncomposited
 * surface will never produce — the shared `dumpArtifacts` gives it a 3 s budget and reports the
 * lapse — and `webContents.capturePage()` on a hidden window was MEASURED here to return a blank
 * 924-byte frame, which is worse than no artifact because it looks like one.
 *
 * The only way to a real picture is to put the window on screen, which is exactly the property the
 * suite promises not to break. So it is behind `EQ_E2E_SHOT=1`: unset (every CI and local run) the
 * spec behaves identically to every other spec and takes no screen at all; set, it shows the
 * window inactive for one capture and hides it again, which is how a human gets a picture of a
 * surface to review without hand-driving the app.
 *
 * A failure to capture is logged and never a check. The HTML dump is still what a failing run is
 * read from.
 */
async function captureTab(app: ElectronApplication, tag: string): Promise<void> {
  if (process.env.EQ_E2E_SHOT !== '1') return
  try {
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      // The MAIN window by its own document, not `getAllWindows()[0]` — the overlays and the
      // cursor ring are windows too, and they are all hidden, so an index-based pick photographs
      // whichever blank one the array happened to start with.
      const win = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')
      )
      if (!win) return null
      // Inactive: the point is a frame, never the focus. Hidden again before anything else runs.
      win.showInactive()
      await new Promise((r) => setTimeout(r, 750))
      const shot = (await win.capturePage()).toPNG().toString('base64')
      win.hide()
      return shot
    })
    if (png === null) return
    mkdirSync(ARTIFACTS, { recursive: true })
    const at = join(ARTIFACTS, `${tag}.png`)
    writeFileSync(at, Buffer.from(png, 'base64'))
    console.log(`artifact: ${at}`)
  } catch (err) {
    console.log(`artifact: capturePage unavailable - ${String(err)}`)
  }
}

/** One Cleanup row as the player reads it: the item, how many, where, and every turn-in line. */
interface Row {
  item: string
  count: number
  where: string
  turnIns: string[]
}

function rows(page: Page): Promise<Row[]> {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => ({
      item: el.getAttribute('data-item') ?? '',
      count: Number(el.getAttribute('data-count')),
      where: (el.querySelector('[data-testid="posky-cleanup-where"]') as HTMLElement | null)?.innerText.trim() ?? '',
      turnIns: [...el.querySelectorAll('[data-testid="posky-cleanup-turnin"]')].map((t) =>
        (t as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      )
    }))
  }, ROW)
}

/**
 * The tab's own label, which carries the row count — the number that decides whether to look.
 *
 * `textContent`, not `innerText`: MUI upper-cases tab labels in CSS, and `innerText` reports the
 * TRANSFORMED text ("CLEANUP"). The claim here is about the words the component renders, so it is
 * read from the DOM rather than from the theme's typography.
 */
function tabLabel(page: Page): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? '', TAB_CLEANUP)
}

/**
 * The `have/need` pair in the QUEST tab's item table — `sky-item-override.e2e.mts`'s reader,
 * because step 4 asserts the exact thing that spec asserts from the other end: there is one
 * override ledger and both tabs read it.
 */
function haveText(page: Page, item: string): Promise<string | null> {
  return page.evaluate((name) => {
    const row = [...document.querySelectorAll('tr')].find((tr) =>
      (tr.cells[1]?.textContent ?? '').trim().startsWith(name)
    )
    if (!row) return null
    return /^\s*(\d+\/\d+)/.exec(row.cells[2]?.textContent ?? '')?.[1] ?? null
  }, item)
}

/** How many quests the filters leave, off the counts line. `null` when it is not mounted. */
function filteredCount(page: Page): Promise<number | null> {
  return page.evaluate((sel) => {
    const m = /(\d+) of (\d+) quests/.exec(document.querySelector(sel)?.textContent ?? '')
    return m ? Number(m[1]) : null
  }, COUNTS)
}

/** Open the Sky tab and narrow the Quests list to the one quest, expanded. */
async function openTheQuest(page: Page): Promise<boolean> {
  await page.click(NAV_SKY, { timeout: 30_000 })
  const bar = await page.waitForSelector(SEARCH, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Sky tab opens on its filter bar', bar)) return false
  await page.fill(`${SEARCH} input`, QUEST)
  const only = await settle(() => filteredCount(page), (n) => n === 1, { timeoutMs: 30_000 })
  if (!check(`the search narrows to ${QUEST} alone`, only === 1, `filtered=${String(only)}`)) return false
  await page.click(SUMMARY, { timeout: 15_000 })
  const have = await settle(() => haveText(page, ITEM), (v) => v !== null, { timeoutMs: 20_000 })
  return check('…and expanding it draws the item table', have !== null, String(have))
}

/**
 * Back to the Quests tab, with the one quest's panel open again.
 *
 * The accordion has to be re-expanded every time: a tab switch UNMOUNTS the pane (AGENTS.md's
 * "a view unmounts on every tab switch"), and `QuestAccordion` is deliberately uncontrolled, so a
 * remount is a collapsed row. The search box is not re-typed for the opposite reason — the filter
 * state lives in `useQuestList`, above the tab switch, and survives.
 */
async function reopenTheQuestPanel(page: Page): Promise<boolean> {
  await page.click(TAB_QUESTS, { timeout: 15_000 })
  await page.waitForSelector(SUMMARY, { timeout: 20_000 })
  await page.click(SUMMARY, { timeout: 15_000 })
  const have = await settle(() => haveText(page, ITEM), (v) => v !== null, { timeoutMs: 20_000 })
  return check('the quest panel opens again on the Quests tab', have !== null, String(have))
}

async function openCleanup(page: Page): Promise<boolean> {
  await page.click(TAB_CLEANUP, { timeout: 15_000 })
  const up = await page.waitForSelector(CLEANUP, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
  return check('the Cleanup tab opens', up)
}

/**
 * STEP 1 — THE MEMBERSHIP RULE, ASSERTED AS AN ABSENCE.
 *
 * The dump says this character is holding an Azarack Skin and the app counts it (the Quests tab
 * reads 1/1 for it). It is still not on this tab, because the quest that wants it has never been
 * handed in. An item any un-turned-in quest still needs is not spare, and that is the entire rule.
 */
async function stepNothingSpareYet(page: Page): Promise<boolean> {
  const held = await haveText(page, ITEM)
  check('the dump makes the app count the skin in the first place', held === '1/1', String(held))
  if (!(await openCleanup(page))) return false

  const caveat = await page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? '',
    CAVEAT
  )
  check('the caveat is up before anything is listed, in the owner`s words', caveat === CAVEAT_TEXT, caveat)
  // Not dismissible: an Alert with a close action renders one, and this one must never have it.
  check(
    '…and it cannot be dismissed - this screen is destructive advice by design',
    (await countOf(page, `${CAVEAT} .MuiAlert-action`)) === 0
  )
  check('the tab offers the reload the Sky tab has not had since JOS-268', (await countOf(page, REFRESH)) === 1)

  const listed = await rows(page)
  check(
    'AN ITEM AN UN-TURNED-IN QUEST STILL NEEDS IS NOT LISTED',
    listed.length === 0,
    listed.map((r) => r.item).join(', ')
  )
  check('…so is the empty state, rather than a bare pane', (await countOf(page, EMPTY)) === 1)
  return check('…and the tab wears no count', (await tabLabel(page)) === 'Cleanup', await tabLabel(page))
}

/**
 * STEP 2 — ONE TURN-IN FLIPS IT, and the row states everything the decision needs.
 *
 * The count does NOT drop to zero with the turn-in, and that is `reconcile`'s dump rule in public:
 * a dump is an observation of what you are holding, written after every turn-in, so it owes no
 * subtraction. The player really is still carrying the skin, which is exactly why this screen
 * exists.
 */
async function stepTurnInMakesItSpare(page: Page): Promise<boolean> {
  if (!(await reopenTheQuestPanel(page))) return false
  await page.click(RECORD_TURNIN, { timeout: 15_000 })
  if (!(await openCleanup(page))) return false
  const listed = await settle(() => rows(page), (r) => r.length === 1, { timeoutMs: 30_000 })
  if (
    !check(
      'RECORDING THE TURN-IN PUTS THE ITEM ON THE TAB — every quest that wants it is now done',
      listed.length === 1,
      `${String(listed.length)} rows`
    )
  ) {
    return false
  }
  check(
    '…named, and counted with the tab`s own held count',
    listed[0].item === ITEM && listed[0].count === 1,
    `${listed[0].item} x${String(listed[0].count)}`
  )
  // MEMBERSHIP AND PLACE SETTLE SEPARATELY, and that is not padding. The row exists the moment the
  // turn-in lands; where it SITS is a second read (`character:sheet` → the dump → `carryAll`) that
  // resolves on its own clock, so waiting on the row and then reading the place is a race the row
  // wins. Each claim waits for itself.
  const placed = await settle(
    () => rows(page),
    (r) => r.length === 1 && r[0].where !== NO_PLACE,
    { timeoutMs: 20_000 }
  )
  const [row] = placed
  check('…and placed where the DUMP says it is sitting', row.where === 'General 1', row.where)
  check(
    '…with the turn-in it feeds spelled out: who, how many times, and what it pays',
    row.turnIns.length === 1 &&
      row.turnIns[0].startsWith('Animist Kratho - Beastlord Test of Azarack (Beastlord) · turned in 1 time · reward: Azarack Skin Wristwraps'),
    row.turnIns.join(' | ')
  )
  // The other half of the decision. One skin and no wind rune is not another set, so the row says
  // what it would take rather than arguing to keep something that cannot be handed in yet.
  check(
    '…and the decision line states the gap toward running it again',
    row.turnIns[0].endsWith('you hold 1 of the 2 needed for another turn-in'),
    row.turnIns[0]
  )
  return check('the tab now carries the count', (await tabLabel(page)) === 'Cleanup (1)', await tabLabel(page))
}

/** STEP 3 — the destruction the log can never see, stated by hand. */
async function stepDestroyed(page: Page): Promise<boolean> {
  await page.click(DESTROY, { timeout: 15_000 })
  const gone = await settle(() => rows(page), (r) => r.length === 0, { timeoutMs: 30_000 })
  if (
    !check(
      'SAYING IT IS DESTROYED TAKES THE ROW OFF THE TAB — through IPC, the store and back',
      gone.length === 0,
      `${String(gone.length)} rows`
    )
  ) {
    return false
  }
  check('…and the tab`s count goes with it', (await tabLabel(page)) === 'Cleanup', await tabLabel(page))
  return check('…leaving the way back beside it', (await countOf(page, UNDO)) === 1)
}

/** STEP 4 — the take-back, off the row that made the statement. */
async function stepUndo(page: Page): Promise<boolean> {
  await page.click(UNDO, { timeout: 15_000 })
  const back = await settle(() => rows(page), (r) => r.length === 1, { timeoutMs: 30_000 })
  if (
    !check(
      'UNDO TAKES THE STATEMENT BACK AND THE ROW RETURNS',
      back.length === 1 && back[0].item === ITEM && back[0].count === 1,
      back.map((r) => `${r.item} x${String(r.count)}`).join(', ')
    )
  ) {
    return false
  }
  return check('…and the strip of destroyed items empties with it', (await countOf(page, DESTROYED)) === 0)
}

/**
 * STEP 5 — THE OTHER TAB AGREES, IN BOTH DIRECTIONS. One override ledger, every Sky surface
 * reading it: destroy the skin again, and the quest that needed it says you hold none — which is
 * the whole point of writing a statement rather than hiding a row. Then clear the statement from
 * THAT row's own chip and the Cleanup row comes back, which is the same seam driven the other way.
 *
 * It also pins the undo's SCOPE, which is a deliberate design and not an oversight: the strip is
 * component state, so leaving the tab ends it. The way back after that is the provenance chip on
 * the quest row, where every other hand-stated count is taken back (JOS-186) — so the statement is
 * never stranded, and the tab does not grow a second, permanent ledger of its own.
 */
async function stepOneLedgerBothWays(page: Page): Promise<void> {
  await page.click(DESTROY, { timeout: 15_000 })
  const gone = await settle(() => rows(page), (r) => r.length === 0, { timeoutMs: 30_000 })
  if (!check('saying it again takes the row away again', gone.length === 0, `${String(gone.length)} rows`)) return

  if (!(await reopenTheQuestPanel(page))) return
  const have = await settle(() => haveText(page, ITEM), (v) => v === '0/1', { timeoutMs: 20_000 })
  if (!check('THE QUEST THAT NEEDS IT READS 0 FOR THE ITEM TOO', have === '0/1', String(have))) return
  check('…and says out loud that the number is the user`s', (await countOf(page, CHIP)) === 1)

  await page.click(CHIP_CLEAR, { timeout: 15_000 })
  if (!(await openCleanup(page))) return
  const back = await settle(() => rows(page), (r) => r.length === 1, { timeoutMs: 30_000 })
  check(
    'CLEARING THE STATEMENT ON THE QUEST ROW PUTS THE CLEANUP ROW BACK',
    back.length === 1 && back[0].item === ITEM,
    back.map((r) => r.item).join(', ')
  )
  check(
    '…and the undo strip did NOT survive leaving the tab, which is its documented scope',
    (await countOf(page, DESTROYED)) === 0
  )
}

/**
 * The five steps, each gating the next — written as early returns rather than as nested ifs, which
 * is also what keeps this file inside the measured `max-depth`. A step that could not establish its
 * own precondition has already said so through `check`; there is nothing to add here.
 */
async function arc(page: Page, app: ElectronApplication): Promise<void> {
  if (!(await stepNothingSpareYet(page))) return
  if (!(await stepTurnInMakesItSpare(page))) return
  // The tab at its most interesting: caveat, toolbar, one row with its place and its decision
  // line. Taken before anything is destroyed, so the artifact shows the screen a player decides
  // from. Opt-in (see `captureTab`) - an ordinary run takes no screen and writes no PNG.
  await captureTab(app, 'sky-cleanup-tab')
  if (!(await stepDestroyed(page))) return
  if (!(await stepUndo(page))) return
  await stepOneLedgerBothWays(page)
}

async function main(): Promise<void> {
  buildIfStale()

  // The dump is staged AT LAUNCH: this spec is about a player who already ran the command, and the
  // watcher's appear-then-arm path is `sky-inventory-autoload.e2e.mts`'s subject, not this one.
  const launched = await launchOnFixture('e2e-copy.log', { inventory: DUMP })
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    if (!(await openTheQuest(page))) {
      throw new Error('never reached the expanded Sky quest — nothing below can be asserted')
    }
    await arc(page, launched.app)
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    await dumpArtifacts(page, failures.length ? 'sky-cleanup-FAIL' : 'sky-cleanup-pass')
  } finally {
    await launched.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
