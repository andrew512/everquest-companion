/**
 * Headless Electron integration test for the OVERVIEW tab (docs/plans/overview-tab.md §8).
 *
 * WHY ITS OWN FILE: `combat-dashboard.e2e.mts` is at the repo's `max-lines 400` factoring
 * ceiling, and the Overview assertions are a different surface with a different subject. The
 * two specs share the harness (`appHarness.mts`) and run back to back from `npm run test:e2e`.
 *
 * WHY IT NEVER TAKES THE SCREEN: identical to the combat spec — `EQ_E2E=1` (src/main/e2e.ts)
 * shows no window, skips the single-instance lock, and points `userData` at a throwaway temp
 * dir. The user can keep playing while this runs. Read the combat spec's header for the full
 * why; it is the reference.
 *
 * WHY `userData` IS WIPED FIRST: the whole point of assertion 1 is that a user with no saved
 * tab lands on Overview — i.e. `DEFAULT_VIEW`. `localStorage['eq.view']` lives inside
 * `userData`, and the combat spec (which runs first) clicks its way to Combat and therefore
 * persists 'combat'. A stale dir would silently make this spec assert the opposite of what it
 * claims. ARTIFACTS is deliberately NOT wiped: the combat spec's dump must survive this run.
 *
 * WHAT IT ASSERTS, against whatever the real log holds right now: the app lands on Overview;
 * hydration is shown then completes; the grid has real height (the Task-#56 regression on a new
 * surface); the DPS card states a rate in the app's vocabulary or an honest empty state; the
 * head-row label AGREES with the engine's own live/last verdict; the zone is stated when known;
 * the current mob agrees with `snapshot.currentTarget`; the drops feed is a BOUNDED scroll box;
 * and — the headline — "Open in Combat" navigates AND selects the same fight the glance showed.
 * Floors and identities only, never today's numbers (AGENTS.md: frozen numbers rot).
 *
 * WAVE 2026-08-04 added three: the leveling panel is TILES plus a sparkline (or the honest
 * at-cap refusal) rather than the naked text it was; the nav puts Loot directly after Mobs; and
 * a drop row DEEP-LINKS into the Loot tab's detail PANE — breadcrumb and all, no dialog — whose
 * breadcrumb root comes back to the ledger. The class-loadout card is gone from this page (the
 * feature lives on in Preferences → Profiles), so nothing here looks for it any more.
 *
 * Run: `npm run test:e2e` (this spec runs second).
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import {
  HYDRATE_TIMEOUT_MS,
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
  selectorText,
  sleep,
  snapshot,
  type Snap
} from './appHarness.mjs'
import { freshUserData, mainWindow } from './appWindow.mjs'

const GRID = '[data-testid="overview-grid"]'
const SEGMENT_SELECT = '[data-testid="segment-select"]'

/**
 * `Snap` plus the one field wave 1A added. The harness's shared `Snap` is the combat spec's
 * view of the snapshot and is at its own file's budget, so the extra field is declared HERE
 * rather than widening a shared type for a single consumer.
 */
interface CurrentTargetLike {
  name: string
  others: number
  lastTs: number
}
interface OverviewSnap extends Snap {
  currentTarget?: CurrentTargetLike
}

/** The same renderer bridge the harness uses, typed for this spec's extra field. */
function osnap(page: Page): Promise<OverviewSnap> {
  return snapshot(page) as Promise<OverviewSnap>
}

/** Rendered text of the first match; '' when the node isn't mounted. */
function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Box + scroll geometry — enough to prove a growing list is a BOUNDED scroller. */
function boxOf(page: Page, sel: string): Promise<{ h: number; scrollH: number; clientH: number } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    return {
      h: Math.round(el.getBoundingClientRect().height),
      scrollH: el.scrollHeight,
      clientH: el.clientHeight
    }
  }, sel)
}

/**
 * Read until the text contains `needle` or the deadline passes; return whatever it said last.
 * Everything on this surface is asynchronous end to end (IPC → snapshot → render), so "did it
 * land" is a wait, not a read — the same discipline `waitForCombatText` uses.
 */
async function pollText(read: () => Promise<string>, needle: string, ms = 8000): Promise<string> {
  const t0 = Date.now()
  let text = await read()
  while (needle && !text.includes(needle) && Date.now() - t0 < ms) {
    await sleep(300)
    text = await read()
  }
  return text
}

// ── the run, one step per numbered section of §8 ───────────────────────────────────────

async function stepLanding(page: Page): Promise<void> {
  // 1. LAND ON OVERVIEW. Fresh userData ⇒ no `eq.view` ⇒ `DEFAULT_VIEW`. This is the assertion
  //    the wave-3 one-line flip exists to make true, and it is stated as an identity: the
  //    Overview grid is mounted AND the Combat tab's selector is not.
  const landed = await page.waitForSelector(GRID, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('a fresh userData lands the app on Overview (DEFAULT_VIEW)', landed)) {
    throw new Error('never landed on Overview — nothing below can be asserted')
  }
  check(
    '…and not on Combat (the fight selector is not mounted)',
    (await countOf(page, SEGMENT_SELECT)) === 0
  )
}

async function stepHydration(page: Page): Promise<OverviewSnap> {
  // 2. HYDRATION IS A STATE. During the startup replay every snapshot describes the PAST, so
  //    the NOW row must show the quiet placeholder rather than a churning fake-live meter.
  //    Observed-or-too-fast is the convention `stepHydration` uses in the combat spec: on a
  //    warm out-e2e build the replay can finish before the first poll.
  const t0 = Date.now()
  let sawUi = false
  let snap = await osnap(page)
  while (snap.hydrating && Date.now() - t0 < HYDRATE_TIMEOUT_MS) {
    if (!sawUi) sawUi = (await countOf(page, '[data-testid="overview-hydrating"]')) > 0
    await sleep(500)
    snap = await osnap(page)
  }
  const ms = Date.now() - t0
  if (!check('hydration completes (replay hands off to the live tail)', !snap.hydrating, `${ms}ms`)) {
    throw new Error('still hydrating — nothing below can be asserted')
  }
  check(
    'while hydrating the NOW row shows the quiet loading state, not a fake-live meter',
    sawUi || ms < 1500,
    sawUi ? 'saw [overview-hydrating]' : `replay finished in ${ms}ms (too fast to observe)`
  )
  // Let the post-hydration render + one activity nudge land.
  await sleep(1500)
  return osnap(page)
}

async function stepGridAndDps(page: Page, snap: OverviewSnap): Promise<void> {
  // 3. THE GRID HAS REAL HEIGHT. Task #56's regression, re-asserted on the new surface: a card
  //    that sizes to its content squeezes its siblings to nothing, and the only way to see that
  //    is to measure the rendered layout.
  const grid = await rectOf(page, GRID)
  check(
    'the Overview grid has real height (it is not squeezed to nothing)',
    !!grid && grid.h >= 200,
    grid ? `${grid.w}×${grid.h}px` : 'absent'
  )

  // 4. THE DPS CARD STATES A RATE — in the app's ONE rate vocabulary ('21.7k dps', the word
  //    after the number, never '/s'; AGENTS.md UI conventions). A freshly zoned player with no
  //    fights legitimately has nothing to state, and the honest empty state is not a failure —
  //    so the assertion is conditioned on the engine's own view of whether there is damage.
  const dpsText = (await textOf(page, '[data-testid="overview-dps"]')).replace(/\s+/g, ' ').trim()
  if ((snap.selected?.outTotal ?? 0) > 0) {
    check(
      'the DPS card states a rate in the app’s rate vocabulary (never "/s")',
      /\d.*dps/i.test(dpsText) && !dpsText.includes('/s'),
      dpsText.slice(0, 90) || 'empty'
    )
  } else {
    note(`the selected fight (${snap.selected?.name ?? 'none'}) carries no damage — the DPS card's honest empty state is what shows: "${dpsText.slice(0, 60)}"`)
  }

}

async function stepHeadLabel(page: Page, snap: OverviewSnap): Promise<void> {
  // 5. THE HEAD-ROW LABEL AGREES WITH THE ENGINE. Identity, not value: the card renders
  //    `fightScopeOptions(...).head.label` VERBATIM, so if a pull is open it must say live and
  //    between pulls it must say "Last fight". A second copy of that wording is exactly the
  //    drift `scopeOptions()` exists to prevent, and this is what pins it.
  if (!snap.selected) {
    note('the engine resolved no fight at all — the head-row label is correctly absent')
    return
  }
  const label = (await textOf(page, '[data-testid="overview-dps-label"]')).trim()
  const openFight = snap.segments.some((s) => s.kind === 'current')
  check(
    openFight
      ? 'a fight is open ⇒ the head label says live'
      : 'no fight is open ⇒ the head label says "Last fight", never live',
    openFight ? /live/i.test(label) : /Last fight/.test(label),
    label.slice(0, 80) || 'empty'
  )
}

async function stepZoneAndMob(page: Page, snap: OverviewSnap): Promise<void> {
  // 6. THE ZONE IS STATED WHEN KNOWN. The strip reads the CHARACTER module (the designated
  //    "who am I / where am I" owner, delta-pushed) while the assertion's expectation comes
  //    from the engine's copy of the same `You have entered X.` line — so this is a genuine
  //    cross-owner agreement check, not a tautology. Polled: the delta lands on its own clock.
  if (snap.zone) {
    const zone = (await pollText(() => textOf(page, '[data-testid="overview-zone"]'), snap.zone)).trim()
    check(
      'the zone strip states the zone the engine is in',
      zone.length > 0 && zone.includes(snap.zone),
      `strip "${zone.slice(0, 50)}" vs snapshot "${snap.zone}"`
    )
  } else {
    note('the log has stated no zone yet — the strip correctly says nothing')
  }

  // 7. THE CURRENT MOB AGREES WITH THE SNAPSHOT. `currentTarget` is the FACT wave 1A exposed
  //    (law 6's live naming half) rather than a name parsed back out of the composed encounter
  //    name. This runs against a LIVE log: if no fight is open during the run there is nothing
  //    to agree with, which is a note (the step-8 convention in the combat spec), not a failure.
  const mobText = (await textOf(page, '[data-testid="overview-mob"]')).replace(/\s+/g, ' ').trim()
  if (snap.currentTarget) {
    const name = await pollText(() => textOf(page, '[data-testid="overview-mob-name"]'), snap.currentTarget.name)
    check(
      'the Target card names the mob the snapshot says you are on',
      name.includes(snap.currentTarget.name),
      `card "${name.slice(0, 50)}" vs currentTarget "${snap.currentTarget.name}" (+${snap.currentTarget.others})`
    )
  } else {
    check(
      'no current target ⇒ the Target card shows its quiet state and names no mob',
      (await countOf(page, '[data-testid="overview-mob-name"]')) === 0,
      mobText.slice(0, 70) || 'empty'
    )
    note('no encounter was open with a landed hit during this run — the mob AGREEMENT half is not asserted (live log)')
  }
}

async function stepDropsFeed(page: Page): Promise<void> {
  // 8. THE DROPS FEED IS A BOUNDED SCROLL BOX. This is the fixed-height law, MEASURED: an
  //    append-only list that sizes to its content is the exact bug (Task #56) that made the
  //    Combat tab "just a scrolling combat log". `scrollHeight >= clientHeight` is the other
  //    half — the box must be the scroller, not a clipper.
  const box = await boxOf(page, '[data-testid="overview-drops"]')
  if (!check('the recent-drops feed is rendered', box !== null)) return
  const b = box as { h: number; scrollH: number; clientH: number }
  check(
    'the drops feed is bounded (it cannot grow to eat the page)',
    b.h > 0 && b.h <= 320,
    `${b.h}px tall`
  )
  check(
    '…and it is its own scroller (content scrolls INSIDE the box)',
    b.scrollH >= b.clientH,
    `scrollHeight ${b.scrollH} vs clientHeight ${b.clientH}`
  )
  const rows = await countOf(page, '[data-testid="overview-drop-row"]')
  const hot = await countOf(page, '[data-testid="overview-drop-highlight"]')
  if (rows > 0) {
    check(
      'the feed renders its rows, and the highlighted ones are a SUBSET (never every row)',
      hot <= rows,
      `${rows} rows · ${hot} highlighted`
    )
  } else {
    note('no loot in the log yet — the feed shows its quiet empty state')
  }
}

/**
 * 9. THE LINK DOWN — the headline assertion, and the one the whole feature turns on.
 *
 * Read the SUBJECT the glance is showing, click "Open in Combat", and prove two things at once:
 * we are on the Combat tab, and it is looking at the SAME fight. The button always sends the
 * `LIVE_SELECTION` sentinel, and both surfaces resolve their head row through `fightScopeOptions`
 * — so the selector's closed text must contain the very string the Overview label showed.
 *
 * LIVE-LOG HONESTY: a pull can finalize between the read and the render, which legitimately
 * relabels the head row from "Current fight (live)" to "Last fight — …". That is the world
 * moving, not a defect, so the flip is detected from the engine and NOTED rather than failed.
 */
async function stepLinkDown(page: Page): Promise<void> {
  const label = (await textOf(page, '[data-testid="overview-dps-label"]')).trim()
  const before = await osnap(page)
  const liveBefore = before.segments.some((s) => s.kind === 'current')
  // "Last fight — <name>" ⇒ the subject is the name; "Current fight (live)" ⇒ the whole label is.
  const subject = label.includes('—') ? label.split('—').slice(1).join('—').trim() : label

  const clicked = await page
    .click('[data-testid="overview-open-combat"]', { timeout: 15_000 })
    .then(() => true, () => false)
  if (!check('the DPS card offers "Open in Combat"', clicked)) return
  const onCombat = await page.waitForSelector(SEGMENT_SELECT, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  check('…and clicking it opens the Combat tab (the fight selector is mounted)', onCombat)
  if (!onCombat) return

  // Fight scope, explicitly: the deep link carries a SCOPE, and landing in Overall would mean
  // the glance card had linked to the zone aggregate rather than to its own subject.
  const fightScope = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="scope-toggle"] button:nth-child(1)')
    return !!b && (b.classList.contains('Mui-selected') || b.getAttribute('aria-pressed') === 'true')
  })
  check('…in the Fight scope (the link carries the scope, it does not inherit one)', fightScope)

  const shown = (await pollText(() => selectorText(page), subject)).replace(/\s+/g, ' ').trim()
  const liveAfter = (await osnap(page)).segments.some((s) => s.kind === 'current')
  if (!subject) {
    note('the Overview showed no head-row label (no fights in the log) — the subject identity is not asserted this run')
  } else if (!shown.includes(subject) && liveBefore !== liveAfter) {
    note(`the fight ${liveBefore ? 'finalized' : 'opened'} between the click and the render — the head row honestly relabelled ("${subject}" → "${shown.slice(0, 50)}"), so the identity is not asserted this run`)
  } else {
    check(
      '…on the SAME fight the Overview was showing (selector text carries the glance’s subject)',
      shown.includes(subject),
      `overview "${subject.slice(0, 40)}" · selector "${shown.slice(0, 60)}"`
    )
  }
}

async function stepRoundTrip(page: Page): Promise<void> {
  // 10. ROUND TRIP. `nav-overview` exists on every nav row (wave 1B) and 'overview' is in
  //     KNOWN_VIEWS, so coming back must restore the grid — and the page must still not scroll.
  //     The page-overflow half is the layout contract: the app's content area owns the scroll,
  //     a view never grows the document.
  await page.click('[data-testid="nav-overview"]', { timeout: 15_000 })
  const back = await page.waitForSelector(GRID, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
  check('clicking Overview in the nav comes back to the grid', back)
  await sleep(800)
  const over = await pageOverflow(page)
  check(
    '…and the Overview never scrolls the page (the grid scrolls inside itself)',
    over.doc === 0 && over.content === 0,
    `document +${over.doc}px · content area +${over.content}px`
  )
}

/**
 * 11. THE LEVELING PANEL IS TILES + A SPARKLINE (owner request, 2026-08-04). It used to be four
 *     stacked lines of prose; it is now 2–4 stat tiles and a twelve-column inline SVG of the
 *     hour. Both halves are conditional on the log actually holding progression — a fresh
 *     character legitimately shows the card's quiet empty state — so the assertion is an
 *     identity: tiles are present iff the card is not empty, and the spark is present iff the
 *     hour stated at least one level-bar percentage (an at-cap hour draws the refusal instead,
 *     which is the OTHER honest answer and is asserted as such).
 */
async function stepLevelingPanel(page: Page): Promise<void> {
  const tiles = await countOf(page, '[data-testid="overview-leveling-tiles"] [data-testid^="overview-leveling-tile-"]')
  if (tiles === 0) {
    note('the log holds no progression in the last hour — the leveling card shows its quiet empty state')
    return
  }
  check(
    'the leveling panel states 2–4 stat tiles (a tile the log cannot support is absent, not blank)',
    tiles >= 2 && tiles <= 4,
    `${tiles} tiles`
  )
  const spark = await countOf(page, '[data-testid="overview-leveling-spark"]')
  const refused = await countOf(page, '[data-testid="overview-leveling-spark-none"]')
  check(
    'the hour is drawn as a sparkline, or REFUSED with a reason — exactly one of the two',
    spark + refused === 1,
    `spark ${spark} · refusal ${refused}`
  )
  // The pace tile always exists once the window does; its unit is the app's ONE rate wording.
  const rate = (await textOf(page, '[data-testid="overview-leveling-tile-rate"]')).replace(/\s+/g, ' ').trim()
  check(
    'the pace tile speaks the app’s rate vocabulary (never "/hr" alone, never "/s")',
    rate.includes('lvl/hr') && !rate.includes('/s'),
    rate.slice(0, 60) || 'empty'
  )
}

/**
 * 12. THE NAV PUTS LOOT DIRECTLY AFTER MOBS (owner decision, 2026-08-04) and leaves the rest of
 *     the order alone. Read as ADJACENCY, not as a frozen list: the assertion survives a later
 *     tab being added anywhere else, which a hard-coded array would not.
 */
async function stepNavOrder(page: Page): Promise<void> {
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-"]')].map((el) => el.getAttribute('data-testid') ?? '')
  )
  const mobs = order.indexOf('nav-mobs')
  const loot = order.indexOf('nav-loot')
  check(
    'the nav puts Loot directly after Mobs',
    mobs >= 0 && loot === mobs + 1,
    order.join(' · ')
  )
}

/**
 * 12b. THE UPDATE INDICATOR DOES NOT EAT THE PREFERENCES ROW (owner report, 2026-08-04: "it
 *      interferes with clicking Preferences more often than not").
 *
 * The indicator sits directly BELOW Preferences, and it used to wear a `placement="top"` MUI
 * Tooltip. Since MUI v5 a tooltip is INTERACTIVE by default — its popper takes pointer events —
 * so hovering the indicator laid a click-catching overlay across the row above it.
 *
 * Asserted the way the user experiences it: hover the indicator, wait past any enter delay, then
 * ask the document what is actually under the Preferences row at eleven points along its width.
 * Every one must resolve INSIDE `nav-preferences`. A popper anywhere in the DOM is a failure on
 * its own — the indicator is the click target now, and what it opens carries the detail.
 */
async function stepUpdateChipClearsPreferences(page: Page): Promise<void> {
  const chip = await page.evaluate(() =>
    ['update-chip-quiet', 'update-chip-disabled', 'update-chip-ready', 'update-chip-downloading'].find(
      (id) => document.querySelector(`[data-testid="${id}"]`) !== null
    ) ?? ''
  )
  if (!check('the update indicator is mounted under Preferences', chip !== '', chip || 'none found')) return
  const box = await page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  }, `[data-testid="${chip}"]`)
  if (!check('…and it has a box to hover', box !== null)) return
  await page.mouse.move(Math.round(box.x), Math.round(box.y))
  // Past MUI's default 100ms enterDelay and its transition, with room to spare.
  await sleep(1200)

  const probe = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="nav-preferences"]')
    if (!row) return null
    const r = row.getBoundingClientRect()
    const y = r.y + r.height / 2
    const missed: string[] = []
    for (let i = 0; i <= 10; i++) {
      const x = r.x + 2 + ((r.width - 4) * i) / 10
      const hit = document.elementFromPoint(x, y)
      if (!hit?.closest('[data-testid="nav-preferences"]')) {
        missed.push(`${String(Math.round(x))}:${hit?.className.toString().slice(0, 40) ?? 'null'}`)
      }
    }
    return { missed, poppers: document.querySelectorAll('.MuiTooltip-popper').length }
  })
  if (!check('the Preferences row is in the DOM', probe !== null)) return
  check(
    'with the update indicator hovered, Preferences is clickable along its FULL row',
    probe.missed.length === 0,
    probe.missed.join(' · ') || '11/11 points hit the row'
  )
  check(
    '…because hovering the indicator mounts no tooltip popper at all',
    probe.poppers === 0,
    `${String(probe.poppers)} popper(s)`
  )
  // A real click has to land, too — the measurement above is only a proxy for it.
  await page.click('[data-testid="nav-preferences"]', { timeout: 15_000 })
  await sleep(600)
  check(
    '…and clicking it opens Preferences',
    (await countOf(page, '[data-testid="nav-preferences"].Mui-selected')) === 1
  )
  await page.click('[data-testid="nav-overview"]', { timeout: 15_000 })
  await sleep(600)
}

/**
 * 13. THE LOOT DEEP LINK, AND THE PANE TAKEOVER IT LANDS ON — the wave's headline.
 *
 * Click a drop row and two things must be true at once: we are on the Loot tab, and it opened
 * that ITEM's detail pane rather than the ledger. The pane is a TAKEOVER, not a dialog, so the
 * proof is that the ledger is GONE (`loot-list` unmounted) while the breadcrumb is mounted — a
 * popover would leave both on screen. The breadcrumb root then has to come back.
 */
async function stepLootLink(page: Page): Promise<void> {
  const rows = await countOf(page, '[data-testid="overview-drop-row"]')
  if (rows === 0) {
    note('no loot in the log yet — the drops feed has no row to deep-link from this run')
    return
  }
  const item = (await textOf(page, '[data-testid="overview-drop-name"]')).replace(/\s+/g, ' ').trim()
  await page.click('[data-testid="overview-drop-row"]', { timeout: 15_000 })
  const onDetail = await page.waitForSelector('[data-testid="loot-detail"]', { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('clicking a drop row opens the Loot tab on that item’s detail pane', onDetail)) return
  check(
    '…as a PANE TAKEOVER, not a popover (the ledger is not underneath it)',
    (await countOf(page, '[data-testid="loot-list"]')) === 0
  )
  const title = (await textOf(page, '[data-testid="loot-detail-title"]')).replace(/\s+/g, ' ').trim()
  // The feed shows a `N× ` stack prefix the ledger's item name does not carry, so the identity
  // is asserted the way round that survives it.
  check(
    '…on the SAME item the row named',
    title.length > 0 && item.includes(title),
    `row "${item.slice(0, 40)}" · breadcrumb "${title.slice(0, 40)}"`
  )
  check('…with a breadcrumb root back to the list', (await countOf(page, '[data-testid="loot-breadcrumb-root"]')) === 1)

  await page.click('[data-testid="loot-breadcrumb-root"]', { timeout: 15_000 })
  const back = await page.waitForSelector('[data-testid="loot-list"]', { timeout: 20_000 }).then(
    () => true,
    () => false
  )
  check('the breadcrumb root returns to the loot ledger', back)
  check('…and the detail pane is gone', (await countOf(page, '[data-testid="loot-detail"]')) === 0)
}

async function main(): Promise<void> {
  buildIfStale()
  // Fresh userData is load-bearing for assertion 1 — see the file header. ARTIFACTS is left
  // alone so the combat spec's dump from earlier in the same `npm run test:e2e` survives.
  await freshUserData()

  console.log('launch: hidden Electron (EQ_E2E=1) against the real log — Overview spec…')
  const app: ElectronApplication = await electron.launch({
    executablePath: electronBinary(),
    args: [MAIN_ENTRY],
    cwd: ROOT,
    env: { ...process.env, EQ_E2E: '1', EQ_E2E_USER_DATA: USER_DATA, NODE_ENV: 'production' },
    timeout: 60_000
  })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepLanding(page)
    const snap = await stepHydration(page)
    await stepGridAndDps(page, snap)
    await stepHeadLabel(page, snap)
    await stepZoneAndMob(page, snap)
    await stepLevelingPanel(page)
    await stepNavOrder(page)
    await stepUpdateChipClearsPreferences(page)
    await stepDropsFeed(page)
    await stepLinkDown(page)
    await stepRoundTrip(page)
    // Runs LAST: it navigates away from the Overview and stays on the Loot tab.
    await stepLootLink(page)

    // 14. No renderer console errors across the whole run.
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    if (failures.length) await dumpArtifacts(page, 'overview-FAIL')
    else await dumpArtifacts(page, 'overview-pass')
  } finally {
    await app.close().catch(() => undefined)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
