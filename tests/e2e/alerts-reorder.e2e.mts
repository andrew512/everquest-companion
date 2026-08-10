/**
 * Headless Electron spec for JOS-175 / JOS-177 / JOS-178 — THE ALERTS LIST KEEPS THE ORDER YOU PUT
 * IT IN, A LINE SAYS WHERE THE ROW YOU ARE DRAGGING WILL LAND, AND A SEARCH BOX FINDS AN ALERT BY
 * ANYTHING YOU REMEMBER ABOUT IT.
 *
 * WHAT A PLAYER ASKED FOR (0.16.0 report): reorder alerts by dragging. The owner's ruling on
 * 2026-08-09 took the folders half of that ask off the table; this is the reorder half, whole.
 *
 * WHY IT IS AN E2E SPEC AND NOT A UNIT TEST. `tests/alertReorder.test.mts` pins the ordering
 * RULES and the JSON round trip they rest on, which is everything that can be seen without an
 * app. It cannot see the two things the ticket is actually about:
 *
 *   1. THE ORDER ON SCREEN IS THE ORDER IN THE STORE. Three parts have to agree — the row the
 *      gesture moved, the array main wrote, and the list the view re-renders from main's answer —
 *      and each one is on the far side of an IPC round trip from the last.
 *   2. IT SURVIVES A RESTART. The app is QUIT here and relaunched on the SAME userData dir (the
 *      telemetry/overlay-sync pattern), so the second launch reads the order off disk exactly the
 *      way tomorrow's session will. Nothing about that is observable in one process.
 *
 * HOW THE GESTURE IS DRIVEN, honestly. The grip is a drag source AND a button that takes
 * ArrowUp/ArrowDown (useAlertReorder.ts) — the keyboard path exists because a list you can only
 * reorder by dragging is a list some people cannot reorder at all, and it is also the path a
 * headless window can drive as a CONDITION rather than as a bet on a compositor that may never
 * composite. So the arrow keys move the row here, and the drag is exercised in the same run by
 * `page.dragAndDrop`, whose outcome is reported either way: a drag that Chromium declines to
 * synthesize in a hidden window is a note about the harness, never a silent pass and never a
 * failure charged to the app. Both paths end in the same call and the same stored array.
 *
 * JOS-177 ADDS THE THIRD PATH, AND IT IS THE ONE THAT CARRIES THE FIX. The defect was the CURSOR:
 * native drag paints do-not-proceed for every `dragover` nobody cancels, and JOS-175 cancelled it
 * on the rows only — so the gaps between rows, the container padding and the strip under the add
 * button all refused the drag and the cursor flickered once per row on the way down. "Was this
 * dragover cancelled" is not a screenshot question and not a compositor question: it is
 * `event.defaultPrevented`, readable exactly. So this spec DISPATCHES real `DragEvent`s carrying a
 * real `DataTransfer` at three probe points — the middle of a gap, inside a row, and the padding
 * BELOW the last row — through `document.elementFromPoint`, so each one travels from whatever
 * element is genuinely under that pixel up to the handler, and asserts all three were accepted.
 * The same run reads the insertion line's slot at each probe and then drops, which is how "the
 * line tracks the pointer" and "the drop lands where the line was" become one assertion.
 *
 * JOS-178 JOINS THIS SPEC RATHER THAN STARTING ITS OWN, because the two features are one
 * behaviour: a search box that narrows the list also SUSPENDS the gesture this file exists to
 * prove, and "clearing the box gives the drag back" is only a claim if the same run then drags.
 * `tests/alertSearch.test.mts` owns the matcher, facet by facet, and can see none of this:
 * whether a real keystroke narrows the real list, whether the container genuinely stops accepting
 * (`event.defaultPrevented` again — the same exact reading JOS-177 rests on, wanted FALSE this
 * time), and whether the full list comes back in the order it left.
 *
 * Run: `npm run test:e2e -- alerts-reorder`.
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleGone,
  settleStable
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const ROW = '[data-testid="alert-row"]'
const GRIP = '[data-testid="alert-reorder-grip"]'
const LINE = '[data-testid="alert-drop-indicator"]'
const SEARCH = '[data-testid="alerts-search"] input'
const SEARCH_CLEAR = '[data-testid="alerts-search-clear"]'

/** The ids of the alert rows, top to bottom, as the list is rendering them right now. */
function renderedOrder(page: Page): Promise<string[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-alert-id') ?? '?'), ROW)
}

/** The ids main has stored, in stored order — the answer that has to survive the restart. */
function storedOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { eq: { listAlerts: () => Promise<{ id: string }[]> } }).eq
      .listAlerts()
      .then((defs) => defs.map((d) => d.id))
  ) as Promise<string[]>
}

/** Open the Alerts tab and wait for the list to have rows. */
async function openAlerts(page: Page): Promise<string[]> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector(ROW, { timeout: 30_000 })
  return settle(() => renderedOrder(page), (ids) => ids.length > 0, { timeoutMs: 20_000 })
}

/** Wait for the rendered order to become `want` (the write is a round trip through main). */
function settleOrder(page: Page, want: string[]): Promise<string[]> {
  return settle(
    () => renderedOrder(page),
    (ids) => ids.join('>') === want.join('>'),
    { timeoutMs: 15_000 }
  )
}

/**
 * THE KEYBOARD PATH: focus one row's grip and nudge it one place down.
 *
 * Focused through the DOM rather than by tabbing to it — the row carries two Selects and five
 * icon buttons, so a tab count would be a layout assertion in disguise.
 */
async function nudgeDown(page: Page, id: string): Promise<void> {
  await page.focus(`[data-alert-id="${id}"] ${GRIP}`)
  await page.keyboard.press('ArrowDown')
}

/** The claim the whole feature rests on: what is on screen is what is stored. */
async function checkScreenMatchesStore(page: Page, tag: string): Promise<string[]> {
  const shown = await renderedOrder(page)
  const stored = await settle(
    () => storedOrder(page),
    (ids) => ids.join('>') === shown.join('>'),
    { timeoutMs: 10_000 }
  )
  check(
    `[${tag}] the order on screen is the order main has stored`,
    shown.join('>') === stored.join('>'),
    `screen ${shown.join(' > ')} · store ${stored.join(' > ')}`
  )
  return shown
}

/** Move the first row down one with the arrow keys, and prove the whole chain moved with it. */
async function checkKeyboardReorder(page: Page, before: string[]): Promise<string[]> {
  const want = [before[1], before[0], ...before.slice(2)]
  await nudgeDown(page, before[0])
  const after = await settleOrder(page, want)
  if (
    !check(
      'pressing the down arrow on a row’s grip moves it one place down the list',
      after.join('>') === want.join('>'),
      `was ${before.join(' > ')} · now ${after.join(' > ')} · wanted ${want.join(' > ')}`
    )
  ) {
    return after
  }
  check(
    'nothing is lost by a reorder — the same alerts, rearranged',
    [...after].sort().join('|') === [...before].sort().join('|'),
    `${String(before.length)} before, ${String(after.length)} after`
  )
  return checkScreenMatchesStore(page, 'after the keyboard nudge')
}

// ─────────────────────────── JOS-177: the cursor, and the line ───────────────────────────────
//
// One probe of the drag at one point in the list: was the drag ACCEPTED there (the cursor
// question), and where did the line say the row would land.
interface DragProbe {
  label: string
  /** `event.defaultPrevented` — false is a frame of the do-not-proceed cursor. */
  accepted: boolean
  /**
   * What the transfer reports after the handler set it — REPORTED, NOT ASSERTED, and here is the
   * honest reason: Chromium's `dropEffect` setter is a no-op on a `DataTransfer` that was
   * constructed rather than handed over by a real drag (it is created in copy-and-paste mode, and
   * the setter early-returns unless the store is a drag store). It reads `none` here however the
   * app behaves, so it cannot distinguish anything. `tests/alertReorder.test.mts` source-pins the
   * assignment instead; `defaultPrevented` is the reading that carries the ticket.
   */
  dropEffect: string
  /** The slot the indicator is reporting, or null when there is no line at all. */
  slot: number | null
  want: number
  /** What was genuinely under that pixel, so a failure says which element refused. */
  under: string
  /** The line's own top edge in client coordinates — is it drawn where it says it is. */
  lineTop: number | null
}

interface DragReport {
  error: string | null
  probes: DragProbe[]
}

/**
 * Dispatch a whole drag over the list and report what each point of it did.
 *
 * REAL EVENTS AT REAL PIXELS. Each probe finds what is actually under the point with
 * `elementFromPoint` and dispatches there, so a gap probe travels from the container's own box up
 * to the handler exactly the way a pointer's dragover would — the thing JOS-175 had no handler
 * for. One `DataTransfer` carries the whole gesture, as a real drag does.
 *
 * The drop is delivered at the LAST probe — the padding below the last row, which is the slot a
 * row-shaped drop target cannot express, since there is no row down there to aim at.
 *
 * NOT ONE NAMED INNER FUNCTION, on purpose. `page.evaluate` ships this body to the page as SOURCE,
 * and tsx compiles it with esbuild's keepNames — which wraps every function that gets an inferred
 * name in a `__name(…)` helper that exists in the bundle and not in the page. A tidy
 * `const readLine = () => …` is therefore a `ReferenceError: __name is not defined` in Chromium
 * and nothing else. Anonymous callbacks (the `setTimeout` promise) are untouched and fine.
 */
function probeDrag(page: Page, movedId: string): Promise<DragReport> {
  return page.evaluate(async (id: string): Promise<DragReport> => {
    const out: DragReport = { error: null, probes: [] }
    const list = document.querySelector('[data-testid="alerts-list"]')
    const rows = [...document.querySelectorAll('[data-alert-id]')]
    const grip = document.querySelector(`[data-alert-id="${id}"] [data-testid="alert-reorder-grip"]`)
    if (!(list instanceof HTMLElement) || rows.length < 3 || !(grip instanceof HTMLElement)) {
      out.error = `list ${String(list !== null)} · rows ${String(rows.length)} · grip ${String(grip !== null)}`
      return out
    }

    const first = rows[0].getBoundingClientRect()
    const second = rows[1].getBoundingClientRect()
    const last = rows[rows.length - 1].getBoundingClientRect()
    const x = Math.round(first.left + Math.min(24, first.width / 2))
    const points = [
      {
        label: 'the gap between the first two rows',
        y: Math.round((first.bottom + second.top) / 2),
        want: 1
      },
      { label: 'the upper half of the last row', y: Math.round(last.top + 2), want: rows.length - 1 },
      { label: 'the padding below the last row', y: Math.round(last.bottom + 8), want: rows.length }
    ]

    const dt = new DataTransfer()
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))

    for (const p of points) {
      const el = document.elementFromPoint(x, p.y)
      if (el === null || !list.contains(el)) {
        out.probes.push({ label: p.label, accepted: false, dropEffect: '', slot: null, want: p.want, under: 'nothing inside the list', lineTop: null })
        continue
      }
      const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: p.y })
      el.dispatchEvent(ev)
      // React flushes a dragover's state in a task of its own, so the line is WAITED FOR by
      // CONDITION rather than sampled once — bounded turns, no clock.
      let slot: number | null = null
      let lineTop: number | null = null
      for (let i = 0; i < 200; i += 1) {
        const line = list.querySelector('[data-testid="alert-drop-indicator"]')
        slot = null
        lineTop = null
        if (line instanceof HTMLElement) {
          slot = Number(line.dataset.dropIndex)
          lineTop = line.getBoundingClientRect().top
        }
        if (slot === p.want) break
        await new Promise((r) => setTimeout(r, 0))
      }
      out.probes.push({ label: p.label, accepted: ev.defaultPrevented, dropEffect: dt.dropEffect, slot, want: p.want, under: el.tagName.toLowerCase(), lineTop })
    }

    const drop = points[points.length - 1]
    const target = document.elementFromPoint(x, drop.y) ?? list
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: drop.y }))
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }))
    return out
  }, movedId)
}

/**
 * THE TICKET'S ACCEPTANCE: no refusal anywhere in the list, a line that follows the pointer, and a
 * drop that lands where the line was.
 */
async function checkInsertionLine(page: Page, before: string[]): Promise<string[]> {
  const moved = before[0]
  const report = await probeDrag(page, moved)
  if (report.error !== null) {
    check('the drag probe found a list to drag in', false, report.error)
    return before
  }
  note('dropEffect is reported, not asserted, in these probes — see DragProbe.dropEffect for why')
  for (const p of report.probes) {
    check(
      `the drag is accepted over ${p.label} — nothing there says do-not-proceed`,
      p.accepted,
      `defaultPrevented ${String(p.accepted)} · dropEffect ${p.dropEffect || '(unset)'} · under the pointer: ${p.under}`
    )
    check(
      `the insertion line follows the pointer to ${p.label}`,
      p.slot === p.want,
      `line at slot ${String(p.slot)} · wanted ${String(p.want)} · drawn at y ${String(p.lineTop)}`
    )
  }
  const want = [...before.slice(1), moved]
  const after = await settleOrder(page, want)
  check(
    'dropping below the last row puts the alert at the bottom — the landing a row-shaped target could never name',
    after.join('>') === want.join('>'),
    `was ${before.join(' > ')} · now ${after.join(' > ')} · wanted ${want.join(' > ')}`
  )
  check('the line goes away when the drag does', await settleGone(page, LINE, { timeoutMs: 10_000 }))
  return checkScreenMatchesStore(page, 'after the indicated drop')
}

/**
 * THE DRAG PATH, exercised for real and reported honestly.
 *
 * `page.dragAndDrop` synthesizes the pointer sequence Chromium turns into HTML5 drag events. In a
 * window that is never shown it may decline to start a drag at all — which says something about
 * the harness, not about the app — so a drag that produces no movement is a NOTE. A drag that
 * moves the list to the WRONG place is still a failure.
 */
async function checkDragReorder(page: Page, before: string[]): Promise<string[]> {
  const moved = before[before.length - 1]
  const target = before[0]
  const want = [moved, ...before.filter((id) => id !== moved)]
  try {
    // AIMED AT THE ROW'S TOP EDGE, not its centre (JOS-177). The landing is now the GAP the
    // pointer is nearest, so the centre of a row is the boundary between "above it" and "below
    // it" — an honest ambiguity to drop a test on. Four pixels in from the top of the first row
    // is unambiguously the slot above it.
    await page.dragAndDrop(`[data-alert-id="${moved}"] ${GRIP}`, `[data-alert-id="${target}"]`, {
      targetPosition: { x: 24, y: 4 },
      timeout: 10_000
    })
  } catch (err) {
    note(`the harness could not synthesize a drag in this window — ${String(err).slice(0, 90)}`)
    return before
  }
  const after = await settleOrder(page, want)
  if (after.join('>') === before.join('>')) {
    note('a synthesized drag started but moved nothing in this hidden window; the keyboard path above carries the assertion')
    return before
  }
  check(
    'dragging the bottom row onto the top row puts it at the top',
    after.join('>') === want.join('>'),
    `was ${before.join(' > ')} · now ${after.join(' > ')} · wanted ${want.join(' > ')}`
  )
  return checkScreenMatchesStore(page, 'after the drag')
}

/** THE TICKET'S ACCEPTANCE: quit, relaunch on the same userData, and read the order back. */
async function checkSurvivesRestart(
  log: FixtureLog,
  userData: string,
  want: string[]
): Promise<void> {
  const { app, close } = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(app)
    const after = await openAlerts(page)
    check(
      'the order you left the app in is the order it opens in',
      after.join('>') === want.join('>'),
      `left ${want.join(' > ')} · reopened ${after.join(' > ')}`
    )
    await checkScreenMatchesStore(page, 'after the restart')
    if (failures.length) await dumpArtifacts(page, 'alerts-reorder-restart-FAIL')
  } finally {
    await close()
  }
}

// ───────────────────── JOS-178: the search box, and the reorder it suspends ──────────────────
//
// THE SEEDED SET IS THE CORPUS (src/main/store.ts SEED_ALERTS), so the queries below are chosen
// against facets that are ALWAYS there — a def's own name, trigger and note. Deliberately NOT the
// sound pack's labels: the default pack self-provisions over the network on first run, so a query
// leaning on a label would pass or fail on whether this machine could reach GitHub.
//
//   'confetti'  appears in exactly ONE place in the whole seeded set — the NOTE of "Raid target
//               defeated". A name-only search finds nothing for it, which is the entire point of
//               the wide match set.
//   'app'       is the trigger badge's own shape word, and two of the three seeded alerts fire on
//               an app signal. It therefore leaves MORE THAN ONE row, which is what makes "the
//               arrow keys move nothing" a real assertion rather than an arithmetic one.

/** Type into the box and let the list settle at whatever it narrowed to. */
async function typeSearch(page: Page, q: string): Promise<string[]> {
  await page.fill(SEARCH, q)
  return settleStable(() => renderedOrder(page), { timeoutMs: 10_000 })
}

interface FilteredDrag {
  error: string | null
  grips: { draggable: string | null; ariaDisabled: string | null }[]
  /** `event.defaultPrevented` on a dragover over a filtered row — wanted FALSE this time. */
  accepted: boolean
  line: boolean
}

/**
 * Drive a drag at a list that is currently filtered, and report what it did.
 *
 * The SAME reading JOS-177 rests on, asked for the opposite answer: a filtered list carries no
 * container handler at all, so nobody cancels the dragover and the browser's own refusal stands.
 * No named inner functions here either — see probeDrag above for why that is load-bearing.
 */
function probeFilteredDrag(page: Page): Promise<FilteredDrag> {
  return page.evaluate(async (): Promise<FilteredDrag> => {
    const out: FilteredDrag = { error: null, grips: [], accepted: false, line: false }
    const list = document.querySelector('[data-testid="alerts-list"]')
    const rows = [...document.querySelectorAll('[data-alert-id]')]
    const grips = [...document.querySelectorAll('[data-testid="alert-reorder-grip"]')]
    if (!(list instanceof HTMLElement) || rows.length < 2 || grips.length !== rows.length) {
      out.error = `list ${String(list !== null)} · rows ${String(rows.length)} · grips ${String(grips.length)}`
      return out
    }
    out.grips = grips.map((g) => ({
      draggable: g.getAttribute('draggable'),
      ariaDisabled: g.getAttribute('aria-disabled')
    }))

    const dt = new DataTransfer()
    grips[0].dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    )
    const box = rows[0].getBoundingClientRect()
    const ev = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: Math.round(box.left + 24),
      clientY: Math.round(box.top + box.height / 2)
    })
    rows[0].dispatchEvent(ev)
    out.accepted = ev.defaultPrevented
    // An ABSENCE, so the reading is given every chance to appear before it is called absent.
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setTimeout(r, 0))
    out.line = list.querySelector('[data-testid="alert-drop-indicator"]') !== null
    grips[0].dispatchEvent(
      new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt })
    )
    return out
  })
}

/** A word that lives in ONE alert's note finds that alert - the wide match set, end to end. */
async function checkSearchFindsANote(page: Page, start: string[]): Promise<void> {
  const shown = await typeSearch(page, 'confetti')
  check(
    'a word that appears only in one alert’s NOTE finds that alert, and narrows the list to it',
    shown.length < start.length && shown.includes('boss-defeat') && !shown.includes('charm-break'),
    `${String(start.length)} rows before · now ${shown.join(' > ') || '(none)'}`
  )
}

/** While a filter is live the gesture is GONE — no drag source, no drop target, no arrow keys. */
async function checkFilteredListRefusesReorder(page: Page): Promise<void> {
  const shown = await typeSearch(page, 'app')
  if (
    !check(
      'a trigger word narrows the list to the alerts whose trigger says it',
      shown.length >= 2 && !shown.includes('charm-break'),
      `now ${shown.join(' > ') || '(none)'}`
    )
  ) {
    return
  }

  const probe = await probeFilteredDrag(page)
  if (probe.error !== null) {
    check('the filtered list still has rows to probe', false, probe.error)
    return
  }
  check(
    'every grip greys out while the search is on — none of them is a drag source any more',
    probe.grips.every((g) => g.draggable === 'false' && g.ariaDisabled === 'true'),
    JSON.stringify(probe.grips)
  )
  check(
    'the filtered list REFUSES the drag — the browser’s own no, because no handler cancels it',
    !probe.accepted,
    `defaultPrevented ${String(probe.accepted)}`
  )
  check('…and no insertion line is drawn, because there is no slot it could honestly name', !probe.line)

  const before = await renderedOrder(page)
  await page.focus(`[data-alert-id="${before[0]}"] ${GRIP}`)
  await page.keyboard.press('ArrowDown')
  const after = await settleStable(() => renderedOrder(page), { timeoutMs: 6_000 })
  check(
    'the arrow keys move nothing while the list is filtered',
    after.join('>') === before.join('>'),
    `was ${before.join(' > ')} · now ${after.join(' > ')}`
  )
}

/** Clearing the box hands back the whole list, in the order it left, with the gesture on it. */
async function checkClearRestores(page: Page, start: string[]): Promise<void> {
  await page.click(SEARCH_CLEAR)
  const shown = await settle(
    () => renderedOrder(page),
    (ids) => ids.join('>') === start.join('>'),
    { timeoutMs: 10_000 }
  )
  check(
    'clearing the search brings the whole list back, in the order it left',
    shown.join('>') === start.join('>'),
    `left ${start.join(' > ')} · back ${shown.join(' > ')}`
  )
  const grips = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((g) => g.getAttribute('draggable')),
    GRIP
  )
  check(
    '…and every grip is a drag source again',
    grips.length === start.length && grips.every((d) => d === 'true'),
    `${String(grips.length)} grips: ${grips.join(', ')}`
  )
}

/**
 * The ticket's acceptance, in order: type, filter, clear. "Reorder works again" is then carried by
 * the keyboard/line/drag checks that run AFTER this on the restored list — the same three
 * assertions that carry JOS-175 and JOS-177, which is exactly the point.
 */
async function checkSearch(page: Page, start: string[]): Promise<void> {
  await checkSearchFindsANote(page, start)
  await checkFilteredListRefusesReorder(page)
  await checkClearRestores(page, start)
}

async function main(): Promise<void> {
  buildIfStale()

  // ONE staged install and ONE userData dir across BOTH launches — that pair is what makes the
  // second launch a restart of the same app rather than a fresh install with no order to keep.
  const log = stageFixture('e2e-voice.log')
  const userData = makeUserData()
  let left: string[] = []

  console.log('launch 1: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-voice.log…')
  const first = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    page = await mainWindow(first.app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    const start = await openAlerts(page)
    if (
      check(
        'the alerts list renders the seeded alerts, and a grip on every row',
        start.length >= 3 && (await page.$$(GRIP)).length === start.length,
        `${String(start.length)} rows: ${start.join(' > ')}`
      )
    ) {
      await checkScreenMatchesStore(page, 'at rest')
      // JOS-178 runs FIRST and leaves the list exactly as it found it, so everything below is
      // both the reorder suite and the proof that clearing the box gave the gesture back.
      await checkSearch(page, start)
      const nudged = await checkKeyboardReorder(page, start)
      const indicated = await checkInsertionLine(page, nudged)
      left = await checkDragReorder(page, indicated)
      check(
        'the list is genuinely in a different order than it started in',
        left.join('>') !== start.join('>'),
        `started ${start.join(' > ')} · left ${left.join(' > ')}`
      )
    }
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'alerts-reorder-FAIL')
  } finally {
    await first.close()
  }

  if (left.length > 0) {
    console.log('launch 2: the same userData dir, to read the order back off disk…')
    await checkSurvivesRestart(log, userData, left)
  } else {
    check('the first launch left an order to restart onto', false)
  }

  await removeUserData(userData)
  await log.dispose()
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
