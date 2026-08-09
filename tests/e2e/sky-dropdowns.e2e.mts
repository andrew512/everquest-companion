/**
 * Headless Electron integration test for THE SKY TAB'S DROPDOWNS BEING REACHABLE (JOS-143).
 *
 * THE BUG, as the owner hit it, and it is the SECOND sighting of one defect. On the Loot page a
 * 0.14.0 user could not change the sort (JOS-127); the cause was never the sort's own tooltip but
 * the rows BELOW the toolbar, which anchored `placement="top"`, INTERACTIVE item cards that opened
 * upward across it and kept `pointer-events: auto` while they were up. The Plane of Sky tracker is
 * built to the same plan — `QuestFilterBar` is five dropdowns sitting on top of a scrolling
 * accordion — and every required-item chip in the collapsed summary row anchored exactly such a
 * card (`features/posky/ItemTooltip.tsx`, up to 380px wide). For the first quest in the list those
 * cards land ON the toolbar. The direction was universal removal: no dropdown anywhere wears a
 * popper, and nothing that can open over one may either.
 *
 * WHY THIS NEEDS A BROWSER AT ALL. `tests/tooltipCursor.test.mts` pins the code shape and cannot
 * rot — it derives the rule (every file that renders a dropdown mounts no popper) rather than
 * listing it. But "the code mounts no Tooltip" and "the control takes the click" are different
 * claims, and only the second is what the owner reported. This spec asserts the second, in the
 * order a user meets it: hover the anchors that used to open the card, ask the DOM what is really
 * on top of each dropdown (`elementFromPoint`), then work both dropdowns with real clicks.
 *
 * THE TWO CHECKS ARE NOT REDUNDANT, and this spec was MEASURED against the broken code the way
 * loot-sort.e2e.mts was (2026-08-09, this fixture, this harness): putting a `placement="top"` card
 * back on the required-item chip turns "hovering the first quest's required-item chip opens no
 * tooltip popper at all" red — `poppers=1` — and green again with it removed. The POPPER COUNT is
 * the check that reproduced; `elementFromPoint` passed even with the card up, because where a
 * popper LANDS is a function of the window and this one is a fixed 1280 the owner's is not. So the
 * count is the tripwire that catches the regression at any width, and the geometry is the
 * statement of what the user is owed — their click reaching the control. Neither is the whole
 * guard: `tests/tooltipCursor.test.mts` pins the code shape that makes both true.
 *
 * WHAT IT READS (JOS-29): `tests/fixtures/e2e-copy.log`, a committed fixture. The Sky tab's quest
 * LIST comes from the committed catalog rather than from the log, so the rows and their item chips
 * are there whatever the log said — which is what makes this spec deterministic. Nothing here
 * asserts a quest by name or a count by number (frozen numbers rot); it asserts that a control the
 * user aimed at is the thing their pointer finds.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir minted per launch.
 *
 * Run: `npm run test:e2e -- sky-dropdowns`.
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  hoverAt,
  note,
  reportRun,
  settleCount,
  settleStable
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
/** The toolbar's two `TextField select`s — the controls the owner could not work. */
const SORT = '[data-testid="posky-sort"]'
const COUNT_SOURCE = '[data-testid="posky-count-source"]'
/** The clickable half of a MUI `TextField select` — the div that opens the menu. */
const combo = (sel: string): string => `${sel} [role="combobox"]`
const OPTION = 'li[role="option"]'
/** The chip-select beside them: an Autocomplete, whose list opens into the same band. */
const ISLAND = '[data-testid="posky-island-filter"]'
/** Any MUI tooltip popper, whoever mounted it. This tab must mount none. */
const POPPER = '.MuiTooltip-popper'
/** A required-item chip in the collapsed summary — THE anchor whose card sat on the toolbar. */
const ITEM_CHIP = '[data-testid="posky-item-chip"]'
/** The kill-target caption on the same row: the other `placement="top"` anchor that was here. */
const KILL_TARGET = '[data-testid="posky-kill-target"]'

/**
 * What is REALLY on top of a control right now — the tag `elementFromPoint` finds at its centre,
 * and whether that node belongs to the control.
 *
 * A popper count of zero alone would pass on a card that mounted somewhere harmless. Asking the
 * geometry says the thing the user cares about: that their click reaches the dropdown.
 */
function whatCovers(page: Page, sel: string): Promise<{ tag: string; inside: boolean }> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return { tag: 'none', inside: false }
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    if (!hit) return { tag: 'none', inside: false }
    return { tag: hit.tagName.toLowerCase(), inside: el.contains(hit) || hit === el }
  }, sel)
}

/** What a `TextField select` is showing, as the user reads it. */
function selectValue(page: Page, sel: string): Promise<string> {
  return page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? '',
    combo(sel)
  )
}

function appears(page: Page, sel: string, ms = 20_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

/** Land, then open the Sky tab on a toolbar with quest rows under it. */
async function stepReady(page: Page): Promise<void> {
  if (!check('the app lands on the nav', await appears(page, NAV_OVERVIEW, 60_000))) {
    throw new Error('never landed — nothing below can be asserted')
  }
  await page.click(NAV_SKY, { timeout: 30_000 })
  if (!check('the Sky tab opens on its filter bar', await appears(page, SORT, 60_000))) {
    throw new Error('no Sky toolbar — nothing below can be asserted')
  }
  const rows = await settleCount(page, ITEM_CHIP, 1, { timeoutMs: 20_000 })
  check('…with quest rows under it, carrying required-item chips', rows > 0, `chips=${String(rows)}`)
}

/**
 * HOVER AN ANCHOR THAT USED TO EAT THE CLICK, then look at what is over each dropdown.
 *
 * `settleStable` on the popper count is how an ABSENCE is asserted (wave E3's law): wait for the
 * reading to stop moving — which covers the shared Tooltip's `enterDelay` several times over —
 * and only then claim nothing is there.
 */
async function stepNothingCovers(page: Page, sel: string, what: string): Promise<void> {
  if ((await countOf(page, sel)) === 0) {
    note(`no ${what} in this run — that anchor could not be hovered`)
    return
  }
  if (!(await hoverAt(page, sel, 0.5, 0.5))) {
    note(`could not put the pointer on the ${what}`)
    return
  }
  const poppers = await settleStable(() => countOf(page, POPPER), { timeoutMs: 4000 })
  check(`hovering the ${what} opens no tooltip popper at all`, poppers === 0, `poppers=${String(poppers)}`)
  for (const [control, name] of [
    [SORT, 'Sort'],
    [COUNT_SOURCE, 'Count items from'],
    [ISLAND, 'island filter']
  ] as const) {
    const cover = await whatCovers(page, control)
    check(
      `…and ${name} is still the topmost thing at its own centre (${what} hovered)`,
      cover.inside,
      `elementFromPoint hit <${cover.tag}>`
    )
  }
}

/**
 * THE USER'S SENTENCE, END TO END: open a dropdown and change what it says.
 *
 * Asserted by NAME rather than by index, and the value has to actually BECOME the other one —
 * "the menu opened" is not the report, "I cannot change it" is.
 */
async function stepSelectChanges(page: Page, sel: string, what: string): Promise<void> {
  const before = await selectValue(page, sel)
  if (!check(`the ${what} control states a value to begin with`, before.length > 0, before)) return
  await page.click(combo(sel), { timeout: 15_000 })
  const options = await settleCount(page, OPTION, 2, { timeoutMs: 10_000 })
  if (!check(`clicking ${what} opens its menu`, options >= 2, `options=${String(options)}`)) return

  const labels = await page.evaluate(
    (s) => [...document.querySelectorAll(s)].map((o) => (o as HTMLElement).innerText.trim()),
    OPTION
  )
  const other = labels.find((l) => l !== before)
  if (!check(`…offering a value other than the one already chosen (${what})`, other != null, labels.join(' | '))) {
    return
  }

  await page.click(`${OPTION} >> text="${other ?? ''}"`, { timeout: 15_000 })
  const after = await settleStable(() => selectValue(page, sel), { timeoutMs: 6000 })
  check(`…and picking it actually changes ${what}`, after === other, `${before} -> ${after}`)
}

/**
 * The chip-select on the same row, which is a different control with the same exposure: an
 * Autocomplete's listbox is a portal that opens straight down into the band a card used to fill.
 * Typing rather than clicking an option, for the reason sky-filters states: a click into a portal
 * is a bet about layout that has nothing to do with what is being tested here.
 */
async function stepChipSelectOpens(page: Page): Promise<void> {
  await page.click(`${ISLAND} input`, { timeout: 15_000 })
  const options = await settleCount(page, OPTION, 1, { timeoutMs: 10_000 })
  check('the island chip-select opens its list on a click', options > 0, `options=${String(options)}`)
  await page.keyboard.press('Escape')
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-copy.log…')
  const { app, close } = await launchOnFixture('e2e-copy.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepReady(page)
    await stepNothingCovers(page, ITEM_CHIP, 'first quest’s required-item chip')
    await stepNothingCovers(page, KILL_TARGET, 'kill-target caption')
    await stepSelectChanges(page, SORT, 'Sort')
    await stepSelectChanges(page, COUNT_SOURCE, 'Count items from')
    await stepChipSelectOpens(page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    await dumpArtifacts(page, failures.length ? 'sky-dropdowns-FAIL' : 'sky-dropdowns-pass')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
