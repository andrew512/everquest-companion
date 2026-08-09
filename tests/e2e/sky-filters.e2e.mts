/**
 * Headless Electron integration test for THE SKY TAB'S STICKY FILTERS (JOS-90, JOS-124).
 *
 * THE BUG, in the reporter's words: tick "Hide completed" on the Plane of Sky tab to see exactly
 * what is left, click away to any other tab, come back — and every quest you have already turned
 * in is on the screen again. Hiding completed steps is not a momentary filter, it is how a user
 * says "show me what is left", and the app forgot it the moment the view unmounted.
 *
 * WHY THE ROUND TRIP HAS TO BE DRIVEN BY A REAL APP. The unit-testable half of this is one line —
 * a `useState` initialiser reading localStorage — and a test of THAT would pass while the feature
 * stayed broken, because the bug was never in the read. It was in the LIFECYCLE: `App`'s
 * `ViewContent` mounts exactly one feature view at a time, so leaving the Sky tab destroys
 * `useQuestList` and everything it was holding. Only a spec that actually leaves the tab can
 * distinguish "the state is stored" from "the state survives being thrown away", which is why
 * every assertion below is bracketed by a NAVIGATION, and why the trip out asserts the filter bar
 * is GONE first — an unmount that never happened would make the rest of this spec a tautology.
 *
 * TWO LAUNCHES, ONE userData DIR. The tab round trip and the RESTART are different promises, and
 * a spec that only proved the first would leave "preferred, if that is where other view toggles
 * live" untested. `makeUserData()` hands both launches the same dir (the telemetry/overlay-sync
 * pattern), so launch 2 reads the localStorage launch 1 wrote — through a real process exit, not
 * a simulated one.
 *
 * WHAT IT DOES NOT ASSERT: which quests the tick removes from the list. That is
 * `selectQuests`'s filter, pinned without a browser in tests/questSort.test.mts, and repeating it
 * here would only make this spec depend on the committed quest data staying the shape it is.
 * The subject here is the STATE, and the state is what the box says.
 *
 * JOS-124 ADDS THE BOSS AND ISLAND FACETS to the same subject, because they make the same promise
 * for a control with more to lose: a pick is a chip in a picker, and a picker that comes back empty
 * looks like the app forgot rather than like a filter cleared. Their step DOES read the counts line
 * ("N of M quests") — not to pin which quests survive (questFacets.test.mts owns that against the
 * committed data) but because a filter whose state persists while its EFFECT does not would pass
 * every localStorage assertion in this file. So the step asserts the relations only: picking
 * narrows, a second dimension narrows again, and clearing restores the number it started from.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir minted per launch.
 *
 * Run: `npm run test:e2e -- sky-filters` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settle,
  settleGone
} from './appHarness.mjs'
import { launchApp, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
/** The checkbox under test. MUI renders the real `<input>` inside this node — see `boxState`. */
const BOX = '[data-testid="posky-hide-completed"]'
/** The preference itself, as `useQuestList` stores it. Read back so the spec pins the KEY too:
 *  a rename that kept the round trip working would still break an existing user's saved choice. */
const KEY = 'eq.posky.hideCompleted'
/** The two JOS-124 pickers, and the keys their picks are stored under. */
const ISLAND = '[data-testid="posky-island-filter"]'
const BOSS = '[data-testid="posky-boss-filter"]'
const ISLANDS_KEY = 'eq.posky.islands'
const BOSSES_KEY = 'eq.posky.bosses'
/** "N of M quests · counting from …" — where a narrowing filter becomes visible. */
const COUNTS = '[data-testid="posky-counts"]'

/** Is the box ticked? `null` when it is not mounted — never confused with "unticked". */
function boxState(page: Page): Promise<boolean | null> {
  return page.evaluate(
    (sel) => (document.querySelector(`${sel} input`) as HTMLInputElement | null)?.checked ?? null,
    BOX
  )
}

/** What the renderer has actually stored, verbatim. `null` when the key was never written. */
function storedValue(page: Page, key: string = KEY): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key)
}

/** How many quests the filters leave, off the counts line itself. `null` when it is not mounted. */
function filteredCount(page: Page): Promise<number | null> {
  return page.evaluate((sel) => {
    const text = document.querySelector(sel)?.textContent ?? ''
    const m = /(\d+) of (\d+) quests/.exec(text)
    return m ? Number(m[1]) : null
  }, COUNTS)
}

/** The chips a picker is showing, in order — what the user SEES their filter to be. */
function chipsIn(page: Page, picker: string): Promise<string[]> {
  return page.evaluate(
    (sel) => [...document.querySelectorAll(`${sel} .MuiChip-label`)].map((n) => n.textContent ?? ''),
    picker
  )
}

/**
 * Pick one option out of a ChipMultiSelect by TYPING it and taking the highlighted hit.
 *
 * Typing rather than clicking a `li[role="option"]`: the listbox is a portal with its own
 * geometry, and a click into it is a bet about layout that has nothing to do with what this spec
 * is testing. ArrowDown is what highlights (MUI does not auto-highlight), and Escape closes the
 * popup afterwards — a popup left open is an overlay the next `page.click` on the nav would have
 * to fight.
 */
async function pick(page: Page, picker: string, typed: string): Promise<void> {
  await page.click(`${picker} input`, { timeout: 15_000 })
  await page.fill(`${picker} input`, typed)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
}

/** Clear a picker the way a user does: focus its (now empty) input and backspace the chip off. */
async function clearPick(page: Page, picker: string): Promise<void> {
  await page.click(`${picker} input`, { timeout: 15_000 })
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
}

/** Open the Sky tab and wait for its toolbar. Safe when the tab is already the open one. */
async function openSky(page: Page, timeoutMs = 60_000): Promise<boolean> {
  await page.click(NAV_SKY, { timeout: 30_000 })
  return page.waitForSelector(BOX, { timeout: timeoutMs }).then(
    () => true,
    () => false
  )
}

/**
 * Leave for another tab, and confirm the Sky view is really gone. This is the step the bug lived
 * in: the assertion after it means nothing unless `useQuestList` was actually unmounted here.
 */
async function leaveSky(page: Page): Promise<boolean> {
  await page.click(NAV_OVERVIEW, { timeout: 30_000 })
  return settleGone(page, BOX, { timeoutMs: 15_000 })
}

/** Click the box and wait for the tick to reach the state we asked for. */
async function setBox(page: Page, want: boolean): Promise<boolean | null> {
  await page.click(BOX, { timeout: 15_000 })
  return settle(() => boxState(page), (v) => v === want, { timeoutMs: 8_000 })
}

/** Away to the Overview and back to Sky, with the unmount actually asserted in between. */
async function awayAndBack(page: Page): Promise<boolean> {
  if (!check('leaving the Sky tab unmounts it (the filter bar is gone)', await leaveSky(page))) {
    return false
  }
  return check('…and the Sky tab comes back', await openSky(page))
}

/** A tab round trip: away to the Overview, back to Sky, then read the box. */
async function roundTrip(page: Page): Promise<boolean | null> {
  if (!(await awayAndBack(page))) return null
  return settle(() => boxState(page), (v) => v !== null, { timeoutMs: 8_000 })
}

/** A fresh install shows everything — the pref is absent, and absence is the default, not `false`. */
async function stepDefault(page: Page): Promise<void> {
  check('a fresh install opens the Sky tab with "Hide completed" UNTICKED', (await boxState(page)) === false)
  check('…and mounts exactly one such box', (await countOf(page, BOX)) === 1)
}

/** THE HEADLINE: tick it, leave the tab, come back — it is still ticked. */
async function stepSticksAcrossTabs(page: Page): Promise<void> {
  const ticked = await setBox(page, true)
  if (!check('the box ticks when clicked', ticked === true, String(ticked))) return
  const stored = await settle(() => storedValue(page), (v) => v === '1', { timeoutMs: 8_000 })
  check(`the tick is stored under ${KEY}`, stored === '1', `stored ${String(stored)}`)

  const after = await roundTrip(page)
  check('HIDE COMPLETED SURVIVES LEAVING AND RETURNING TO THE SKY TAB', after === true, String(after))
}

/**
 * The other direction, and the reason this is a PREFERENCE rather than a latch: un-ticking has to
 * survive the same round trip. A "sticky" implementation that only ever remembered `true` (an
 * absent-means-default read paired with a write that skipped `false`) would pass the step above
 * and strand a user who changed their mind on the far side of one tab switch.
 */
async function stepUntickSticksToo(page: Page): Promise<void> {
  const unticked = await setBox(page, false)
  if (!check('the box un-ticks when clicked again', unticked === false, String(unticked))) return
  const stored = await settle(() => storedValue(page), (v) => v === '0', { timeoutMs: 8_000 })
  check('…and the un-tick is stored too, not merely un-remembered', stored === '0', `stored ${String(stored)}`)

  const after = await roundTrip(page)
  check('…so the box comes back UNTICKED, the way it was left', after === false, String(after))
}

/**
 * THE JOS-124 ASK, in the reporter's words: a filter for Sky by boss/island. Pick an island, and
 * the list is the quests that island holds; pick a boss on top of it and it is the quests that
 * boss stands in front of ON that island — the two facets AND, so one more chip always narrows.
 *
 * Returns the UNFILTERED count so the clearing step can prove it came back, or null when the
 * counts line never appeared (in which case nothing below it is assertable).
 */
async function stepFacetsNarrow(page: Page): Promise<number | null> {
  const all = await settle(() => filteredCount(page), (n) => n !== null && n > 0, { timeoutMs: 30_000 })
  if (!check('the counts line states how many quests the filters leave', all !== null && all > 0, String(all))) {
    return null
  }

  await pick(page, ISLAND, 'Island 7')
  const kept = await settle(() => storedValue(page, ISLANDS_KEY), (v) => v === '["Island 7"]', { timeoutMs: 8_000 })
  if (!check(`the island pick is stored under ${ISLANDS_KEY}`, kept === '["Island 7"]', String(kept))) return null
  const island = await settle(() => filteredCount(page), (n) => n !== null && n < all, { timeoutMs: 8_000 })
  check('PICKING AN ISLAND NARROWS THE LIST', island !== null && island > 0 && island < all, `${String(all)} -> ${String(island)}`)

  await pick(page, BOSS, 'Spiroc')
  const boss = await settle(() => storedValue(page, BOSSES_KEY), (v) => v === '["The Spiroc Lord"]', { timeoutMs: 8_000 })
  check(`the boss pick is stored under ${BOSSES_KEY}`, boss === '["The Spiroc Lord"]', String(boss))
  const narrower = island ?? all
  const both = await settle(() => filteredCount(page), (n) => n !== null && n < narrower, { timeoutMs: 8_000 })
  check(
    'A BOSS ON TOP OF THE ISLAND NARROWS AGAIN (the two facets are AND, not OR)',
    both !== null && both > 0 && both < narrower,
    `${String(island)} -> ${String(both)}`
  )

  if (!(await awayAndBack(page))) return null
  check(
    'THE ISLAND AND BOSS PICKS SURVIVE LEAVING AND RETURNING TO THE SKY TAB',
    (await settle(() => chipsIn(page, ISLAND), (c) => c.length > 0, { timeoutMs: 8_000 })).join() === 'Island 7' &&
      (await chipsIn(page, BOSS)).join() === 'The Spiroc Lord',
    `${(await chipsIn(page, ISLAND)).join()} / ${(await chipsIn(page, BOSS)).join()}`
  )
  const after = await settle(() => filteredCount(page), (n) => n === both, { timeoutMs: 8_000 })
  check('…and so does the narrowing they were doing', after === both, `${String(both)} -> ${String(after)}`)
  return all
}

/**
 * Clearing restores everything — the other half of the ask, and the half a "sticky" filter gets
 * wrong: a pick that survives a tab switch but leaves a chip nothing can remove is a trap rather
 * than a filter. Cleared by backspace, the way the picker itself offers.
 */
async function stepFacetsClear(page: Page, all: number): Promise<void> {
  await clearPick(page, BOSS)
  await clearPick(page, ISLAND)
  const stored = await settle(
    () => Promise.all([storedValue(page, ISLANDS_KEY), storedValue(page, BOSSES_KEY)]),
    ([i, b]) => i === '[]' && b === '[]',
    { timeoutMs: 8_000 }
  )
  check('clearing both pickers empties both stored picks', stored.join('|') === '[]|[]', stored.join('|'))
  const back = await settle(() => filteredCount(page), (n) => n === all, { timeoutMs: 8_000 })
  check('CLEARING RESTORES EVERY QUEST THE OTHER FILTERS ALLOW', back === all, `${String(all)} -> ${String(back)}`)
}

/** Leave the box ticked and an island picked for launch 2 — the restart half reads what this
 *  launch wrote, and both kinds of preference (a bit, a list) make the same promise. */
async function stepArmRestart(page: Page): Promise<boolean> {
  const ticked = await setBox(page, true)
  await pick(page, ISLAND, 'Island 3')
  return check('the box is left ticked for the restart check', ticked === true, String(ticked))
}

/** THE RESTART: a second process, the same userData dir, the same answer. */
async function stepSurvivesRestart(page: Page): Promise<void> {
  if (!check('the Sky tab opens after a restart', await openSky(page))) return
  const after = await settle(() => boxState(page), (v) => v !== null, { timeoutMs: 8_000 })
  check('HIDE COMPLETED SURVIVES A FULL RESTART', after === true, String(after))
  check('…and the stored pref crossed the process boundary intact', (await storedValue(page)) === '1')
  const chips = await settle(() => chipsIn(page, ISLAND), (c) => c.length > 0, { timeoutMs: 8_000 })
  check('THE ISLAND FILTER SURVIVES A FULL RESTART, chip and all', chips.join() === 'Island 3', chips.join())
}

async function main(): Promise<void> {
  buildIfStale()

  // OWNED BY THIS SPEC, not by either launch: the restart assertion IS the dir outliving a
  // process, so `launchApp` must not delete what it did not create.
  const userData = makeUserData()
  try {
    console.log('launch 1: a fresh install — default, tab round trip, the un-tick, and the facets…')
    const first = await launchApp({ userData })
    let page: Page | null = null
    try {
      page = await mainWindow(first.app)
      await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      if (!check('the Sky tab opens', await openSky(page))) {
        throw new Error('never reached the Plane of Sky tab — nothing below can be asserted')
      }
      await stepDefault(page)
      await stepSticksAcrossTabs(page)
      await stepUntickSticksToo(page)
      const all = await stepFacetsNarrow(page)
      if (all !== null) await stepFacetsClear(page, all)
      await stepArmRestart(page)
      if (failures.length) await dumpArtifacts(page, 'sky-filters-FAIL')
    } finally {
      await first.close()
    }

    console.log('launch 2: the SAME userData dir, a new process — the tick must still be there…')
    const second = await launchApp({ userData })
    let restarted: Page | null = null
    try {
      restarted = await mainWindow(second.app)
      await restarted.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      await stepSurvivesRestart(restarted)
      if (failures.length) await dumpArtifacts(restarted, 'sky-filters-restart-FAIL')
    } finally {
      await second.close()
    }
  } finally {
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
