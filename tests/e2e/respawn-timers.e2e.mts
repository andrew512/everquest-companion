/**
 * Headless Electron smoke test for RESPAWN CLOCKS (JOS-194).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The ladder, the gap rules and the fold are pinned over the
 * committed `wl40-farm-run.log` in tests/respawnTimers.test.mts, and the wiki grammar over its own
 * verbatim table in tests/respawnWiki.test.mts. None of those can claim THE PIECES ARE WIRED — that
 * a death message arriving in the LIVE log travels the entire real path (chokidar → Tailer →
 * parseEvent → RespawnModule → registry flush → `module:delta` → React) and comes out as a
 * countdown; that clicking Watch on a mob you just killed writes the store, reaches the running
 * module and produces a row from the kill ALREADY FOLDED rather than arming the next one; or that
 * the floating window receives the same fold in a second renderer.
 *
 * THE PLAYED LINES ARE THE SUBJECT, and they are played rather than borrowed because
 * e2e-leveling.log's own kills are days old — every clock they would start has been due for days
 * and `RESPAWN_LINGER_MS` has correctly swept it away. So a row appearing here can only have come
 * down the live path. Both names and the sentence shape are real: `a frenzied ghoul` and
 * `a wan ghoul knight` both appear in committed fixtures, and the first is one of the 394 mobs the
 * committed wiki floor states a duration for (9.5 min) while the second is one of the thousands it
 * says nothing about — which is what makes them the two ends of the estimate ladder.
 *
 * NEITHER OF THEM IS CLOCKED UNTIL IT IS ASKED FOR (owner ruling, prototype round 1). Tracking is
 * opt-in per mob, so both steps below play a death, watch it turn up in the Recently-killed panel,
 * and CLICK Watch — the difference between them is only which rung then numbers the clock.
 *
 * AND A COMBAT LINE IS PLAYED (round 3). A line that starts no clock, ends nothing and is not a
 * death still has to travel the whole path and change what both renderers draw — the row flips to
 * UP because the log NAMED the mob. Then the confirm affordance is CLICKED, which is the only
 * thing in this feature that moves a clock with no log line behind it; a build that re-based on the
 * sighting by itself fails the assertion that the clock was untouched before the click.
 *
 * AND UNWATCH IS CLICKED ON THE MOB ITSELF (round 4). The clock row's own control has to take the
 * row off BOTH renderers and out of the store, flip the Recently-killed entry back to offering
 * Watch, and give the identical clock back when it is watched again — and the floating window has
 * to be able to do the same thing, which is where the ruling came from.
 *
 * AND THE ZONE LINE IS PLAYED TOO. The last step walks the character into another zone and asserts
 * the clocks LEAVE both surfaces while the fold keeps them: the tab's all-zones view brings them
 * straight back. That is the second owner ruling, and only the real app can show that a zone line
 * arriving on the live tail moves both windows.
 *
 * DEFAULT OFF for the window, and every launch here gets a fresh userData dir — so this spec is
 * always a first run, which makes it the one place that can prove what a new install gets.
 *
 * NO WINDOW IS EVER SHOWN (`EQ_E2E=1`, src/main/e2e.ts). The MAIN window is a real page and is
 * clicked; the OVERLAY is always-on-top and hidden, so it is read rather than clicked.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read below goes through `settle`.
 *
 * Run: `npm run test:e2e -- respawn`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settle,
  settleStable
} from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'

/** A mob the committed wiki floor states a duration for: `9.5 min` → 570 s. */
const WIKI_MOB = 'a frenzied ghoul'
/** A mob it says nothing about — the 85 % case in the dungeons this ticket targets. */
const OWN_MOB = 'a wan ghoul knight'

/** The main window's overlay bridge — the same one the title-bar menu calls. */
interface OverlayBridge {
  getOverlayState: () => Promise<Record<string, boolean>>
  toggleOverlay: (k: string) => Promise<boolean>
}
function overlayState(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => (window as unknown as { eq: OverlayBridge }).eq.getOverlayState())
}
function toggleOverlay(page: Page, kind: string): Promise<boolean> {
  return page.evaluate((k) => (window as unknown as { eq: OverlayBridge }).eq.toggleOverlay(k), kind)
}

/** One clock as a surface draws it, from either the tab or the floating window. */
interface Clock {
  mob: string
  source: string
  due: string
  /** Round 3: the log has NAMED this mob since the clock started. */
  seen: string
  /** Round 3: what the clock counts from — 'death', or a sighting the user confirmed. */
  basis: string
  text: string
}

function clocks(page: Page, testid: string): Promise<Clock[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => ({
        mob: e.getAttribute('data-respawn-mob') ?? '',
        source: e.getAttribute('data-respawn-source') ?? '',
        due: e.getAttribute('data-respawn-due') ?? '',
        seen: e.getAttribute('data-respawn-seen') ?? '',
        basis: e.getAttribute('data-respawn-basis') ?? '',
        text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      })),
    testid
  )
}

const find = (rows: Clock[], mob: string): Clock | undefined => rows.find((r) => r.mob === mob)

/** The watch-list bridge, i.e. what the tab's Watch button lands on. Used only to READ here. */
function readWatches(page: Page): Promise<{ watches: { key: string }[] }> {
  return page.evaluate(() =>
    (window as unknown as { eq: { getRespawn: () => Promise<{ watches: { key: string }[] }> } }).eq.getRespawn()
  )
}

/** Click Watch on a mob offered in the Recently-killed panel. The only way a clock ever exists. */
async function clickWatch(page: Page, mob: string): Promise<void> {
  await page.click(`[data-testid="respawn-candidate"][data-respawn-mob="${mob}"] [data-testid="respawn-watch"]`, {
    timeout: 15_000
  })
}

async function stepFreshInstall(page: Page, app: ElectronApplication): Promise<void> {
  await page.click('[data-testid="nav-timers"]', { timeout: 30_000 })
  const mounted = await settle(() => countOf(page, '[data-testid="timers-view"]'), (n) => n === 1, {
    timeoutMs: 30_000
  })
  check('the Timers tab mounts', mounted === 1)

  // A log whose kills are all days old starts NO clocks — the sweep, in the real app.
  const empty = await settle(() => countOf(page, '[data-testid="respawn-empty"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('a log with only long-elapsed kills shows no clocks, and says why', empty === 1)

  const prefs = await readWatches(page)
  check('a fresh install watches nothing at all', prefs.watches.length === 0, JSON.stringify(prefs))
  check(
    '…and says so where the watches would be listed',
    (await countOf(page, '[data-testid="respawn-watches-empty"]')) === 1
  )

  const state = await overlayState(page)
  check('…and the floating window is OFF until asked for', state.respawn === false, JSON.stringify(state))
  check('…with no window spawned at startup', (await windowsOfKind(app, 'respawn')) === 0)
}

/** How many windows the app has open on a given `?kind=` (exact, never a substring). */
async function windowsOfKind(app: ElectronApplication, kind: string): Promise<number> {
  let hit = 0
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (new URLSearchParams(search).get('kind') === kind) hit++
  }
  return hit
}

/**
 * A KILL IN THE LIVE LOG IS OFFERED, NOT CLOCKED — and watching it numbers the clock from the wiki.
 *
 * The opt-in ruling, down the live path. The mob is one of the 394 the committed floor gives a
 * duration for, which under the prototype was enough to put a countdown on screen unasked; now the
 * death only makes it a CANDIDATE, and the row appears when the button is clicked. The wiki's job
 * afterwards is unchanged: it numbers a watched mob you have no gap of your own for.
 */
async function stepLiveKillIsOfferedThenWatched(page: Page, log: FixtureLog): Promise<void> {
  log.append(`You have slain ${WIKI_MOB}!`)
  const offered = await settle(() => clocks(page, 'respawn-candidate'), (r) => find(r, WIKI_MOB) !== undefined, {
    timeoutMs: 30_000
  })
  if (!check('a death message in the LIVE log offers the mob', find(offered, WIKI_MOB) !== undefined, JSON.stringify(offered))) {
    return
  }
  // THE RULING, ASSERTED: the wiki knows this mob's respawn and that is STILL not a reason to clock
  // it. `settleStable` is how an absence is asserted (wave E3) — wait for the reading to stop
  // moving, then assert nothing is there.
  const rows = await settleStable(() => clocks(page, 'respawn-row'))
  check('…and clocks NOTHING, though the wiki states its respawn', find(rows, WIKI_MOB) === undefined, JSON.stringify(rows))

  await clickWatch(page, WIKI_MOB)
  const clocked = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, WIKI_MOB) !== undefined, {
    timeoutMs: 30_000
  })
  const row = find(clocked, WIKI_MOB)
  if (!check('clicking Watch starts the clock', row !== undefined, JSON.stringify(clocked))) return
  check('…numbered from the wiki, because you have no gap of your own yet', row.source === 'wiki', JSON.stringify(row))
  check('…and it says so rather than presenting the number bare', row.text.includes('wiki default'), row.text)
  check('…counting down, not already due', row.due === 'false', JSON.stringify(row))
  // The ESTIMATE, printed beside the countdown: 570 s, which is what the committed floor reads out
  // of the page's "9.5 min". The number the wiki actually states, on screen, in the real app.
  check('…for the duration the wiki actually states', row.text.includes('9m 30s'), row.text)
}

/**
 * WATCH A MOB THE WIKI HAS NEVER HEARD OF, AND THE CLOCK STARTS FROM THE KILL YOU ALREADY MADE.
 *
 * The discoverability story, clicked rather than described. Two deaths are played three minutes
 * apart so the fold has a real same-stay gap to learn from BEFORE anything is watched; then the
 * Watch button in the Recently killed panel is clicked, and a row has to appear immediately —
 * carrying that learned gap. A build whose IPC setter forgot `flushNow`, or whose module reported
 * a log seq instead of its own revision, passes every unit test and fails right here.
 */
async function stepWatchFromRecentKills(page: Page, log: FixtureLog): Promise<void> {
  const earlier = new Date(Date.now() - 3 * 60_000)
  log.appendAt(earlier, `You have slain ${OWN_MOB}!`)
  log.append(`You have slain ${OWN_MOB}!`)

  const offered = await settle(
    () => clocks(page, 'respawn-candidate'),
    (r) => find(r, OWN_MOB) !== undefined,
    { timeoutMs: 30_000 }
  )
  const cand = find(offered, OWN_MOB)
  if (!check('a mob nobody watches is still OFFERED, having died', cand !== undefined, JSON.stringify(offered))) {
    return
  }
  check('…and is not clocked until asked for', find(await clocks(page, 'respawn-row'), OWN_MOB) === undefined)

  await clickWatch(page, OWN_MOB)

  const rows = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, OWN_MOB) !== undefined, {
    timeoutMs: 30_000
  })
  const row = find(rows, OWN_MOB)
  if (!check('clicking Watch produces a clock at once', row !== undefined, JSON.stringify(rows))) return
  // FROM THE KILL ALREADY FOLDED, and numbered by the gap already learned — not from the next death.
  check('…numbered from YOUR kills, not from the wiki', row.source === 'observed', JSON.stringify(row))
  check('…stating how thin that evidence is', row.text.includes('your kills (1 gap)'), row.text)
  // The two deaths were played three minutes apart, so the learned bound is 3m — printed with the
  // "<=" that says it is a bound and not a measurement.
  check('…and the gap it learned is the one that was played', row.text.includes('<= 3m 00s'), row.text)

  const prefs = await readWatches(page)
  check(
    '…and the choice was PERSISTED, not held in the component',
    prefs.watches.some((w) => w.key === OWN_MOB),
    JSON.stringify(prefs)
  )
}

/**
 * THE FOLD REACHES THE SECOND RENDERER — the claim `MODULE_READING_OVERLAYS` exists for.
 *
 * The window is created in the same `whenReady` turn that starts the historical fold, so a window
 * riding only `module:delta` would sit at an empty snapshot on a quiet log. Both clocks are already
 * in the model by the time it opens, so both have to be in the window (JOS-172).
 */
async function stepOverlay(page: Page, app: ElectronApplication): Promise<Page | null> {
  const open = await toggleOverlay(page, 'respawn')
  if (!check('toggling Respawn from the overlay menu reports it OPEN', open === true)) return null

  const overlay = await overlayWindow(app, 'respawn')
  if (!check('…and a window for kind=respawn really exists', overlay !== null)) return null
  const o = overlay

  const mounted = await settle(() => countOf(o, '[data-testid="respawn-overlay"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('the respawn surface mounts', mounted === 1)
  check('…with a visible close control', (await countOf(o, 'button[aria-label="Close overlay"]')) === 1)
  check('…and the lock (click-through) control beside it', (await countOf(o, 'button[aria-label^="Lock"]')) === 1)

  const rows = await settle(
    () => clocks(o, 'respawn-overlay-row'),
    (r) => find(r, WIKI_MOB) !== undefined && find(r, OWN_MOB) !== undefined,
    { timeoutMs: 30_000 }
  )
  check(
    'a window opened AFTER the fold shows the clocks the fold already holds',
    find(rows, WIKI_MOB) !== undefined && find(rows, OWN_MOB) !== undefined,
    JSON.stringify(rows)
  )
  // ROUND 5 MOVED IT TO THE HOVER, and this still has to find it. The two claims this window makes
  // (a clock at zero is our estimate elapsing, UP is the game naming the mob) used to be a standing
  // legend line under the rows; the owner cut the explanatory text, so the sentence now rides the
  // header count's title. Read as a TITLE rather than as body text - if it had merely been deleted,
  // this fails.
  const titles = await o.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[title]')].map((e) => e.title)
  )
  check(
    '…and never claims the mob is standing there',
    titles.some((t) => t.includes('estimate elapsed, not a sighting')),
    JSON.stringify(titles)
  )
  const body = await o.evaluate(() => document.body.innerText)
  check(
    '…without spending a line of a 300px window saying it',
    !body.includes('estimate elapsed'),
    body.slice(0, 200)
  )
  return o
}

/**
 * SEEN ON LOG EVIDENCE, AND THE RE-BASE THAT IS NEVER AUTOMATIC (owner ruling, round 3).
 *
 * The defect came from live play: the owner was being hit by a watched mob and the row still read
 * due-in-the-past. Only the real app can show the fix, because the claim is that a line arriving on
 * the LIVE tail — one that starts no clock and is not a death — travels the whole path and changes
 * what TWO renderers draw.
 *
 * The played line is a real shape (`<Mob> hits YOU for N points of damage.`, verbatim from
 * e2e-combat.log with the mob name swapped) and the mob is the one this spec already watches.
 *
 * IT IS DELIBERATELY THE STRICTER CASE. The owner's row was overdue; this one's countdown is still
 * running, because an e2e cannot wait out a three-minute estimate. Evidence overriding a LIVE
 * countdown is the same rule applied where it has more to prove — a seen row leads with the fact
 * whether or not the clock agrees, and that is exactly what shared/respawn.ts argues.
 */
async function stepSeenOnLogEvidence(page: Page, overlay: Page, log: FixtureLog): Promise<void> {
  log.append(`A wan ghoul knight hits YOU for 106 points of damage.`)

  const seen = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, OWN_MOB)?.seen === 'true', {
    timeoutMs: 30_000
  })
  const row = find(seen, OWN_MOB)
  if (!check('a combat line naming a watched mob flips its row UP', row?.seen === 'true', JSON.stringify(seen))) {
    return
  }
  check('…and the clock says UP rather than reciting its estimate', row.text.includes('UP'), row.text)
  check('…stating what saw it, and how long ago', row.text.includes('seen') && row.text.includes('combat line'), row.text)
  check('…without touching the clock: it is still counting from the death', row.basis === 'death', JSON.stringify(row))

  const overlayRows = await settle(
    () => clocks(overlay, 'respawn-overlay-row'),
    (r) => find(r, OWN_MOB)?.seen === 'true',
    { timeoutMs: 30_000 }
  )
  check(
    '…and the floating window — where the ruling came from — says UP too',
    find(overlayRows, OWN_MOB)?.text.includes('UP') === true,
    JSON.stringify(overlayRows)
  )
  check(
    '…with its own confirm affordance, because it is unlocked',
    (await countOf(overlay, '[data-testid="respawn-overlay-confirm"]')) >= 1
  )

  // THE SECOND RULING: nothing above moved a clock. This click is the only thing that can.
  await page.click(`[data-testid="respawn-row"][data-respawn-mob="${OWN_MOB}"] [data-testid="respawn-confirm-sighting"]`, {
    timeout: 15_000
  })
  const rebased = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, OWN_MOB)?.basis === 'sighting', {
    timeoutMs: 30_000
  })
  const after = find(rebased, OWN_MOB)
  if (!check('confirming the sighting re-bases the clock', after?.basis === 'sighting', JSON.stringify(rebased))) return
  check('…and says the number came from your judgement, not from a death line', after.text.includes('from your sighting'), after.text)
  check('…leaving the seen state, because the evidence is now the base', after.seen === 'false', JSON.stringify(after))
  check('…counting down again rather than sitting due', after.due === 'false', JSON.stringify(after))
}

/**
 * UNWATCH IS ON THE MOB, WHEREVER YOU MEET IT (owner ruling, round 4).
 *
 * Watch was always a per-mob click; stopping used to mean scrolling to the global watch list at the
 * bottom of the tab and matching a name against it. This step exercises the two ends of the new
 * symmetry on the mob the spec has been clocking from the wiki:
 *
 *   1. CLICK Unwatch ON ITS CLOCK ROW. The row has to leave the tab AND the floating window, the
 *      Recently-killed entry has to flip straight back to offering Watch (the toggle), the OTHER
 *      watched mob must be untouched, and the store must no longer hold it — a build that only
 *      hid the row locally fails all four.
 *   2. WATCH IT AGAIN, and the same clock comes back numbered the same way. That is the promise
 *      the control's own tooltip makes and the reason it needs no confirmation step: nothing but
 *      the preference was ever thrown away, because everything else is re-derived from the log.
 *
 * Then the FLOATING WINDOW's own path is driven, because that is where the ruling came from: a row
 * about the wrong duplicate-named mob is worth removing without alt-tabbing out of the fight. The
 * button's presence is asserted in the overlay DOM (it exists only because the window is unlocked —
 * a locked one is click-through by law), and the call itself goes through that window's bridge
 * rather than a synthetic click, for the reason stated at the top of this file: the overlay is
 * hidden here, so it is read rather than clicked.
 */
async function stepUnwatchOnTheMob(page: Page, overlay: Page, app: ElectronApplication): Promise<void> {
  check(
    'an unlocked floating window offers Unwatch on its rows',
    (await countOf(overlay, '[data-testid="respawn-overlay-unwatch"]')) >= 1
  )

  await page.click(`[data-testid="respawn-row"][data-respawn-mob="${WIKI_MOB}"] [data-testid="respawn-row-unwatch"]`, {
    timeout: 15_000
  })
  const left = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, WIKI_MOB) === undefined, {
    timeoutMs: 30_000
  })
  if (!check('Unwatch on the clock row takes the clock away', find(left, WIKI_MOB) === undefined, JSON.stringify(left))) {
    return
  }
  check('…and leaves the other watched mob alone', find(left, OWN_MOB) !== undefined, JSON.stringify(left))
  const overlayLeft = await settle(
    () => clocks(overlay, 'respawn-overlay-row'),
    (r) => find(r, WIKI_MOB) === undefined,
    { timeoutMs: 30_000 }
  )
  check('…on the floating window too, off the one fold', find(overlayLeft, WIKI_MOB) === undefined, JSON.stringify(overlayLeft))
  check(
    '…and the choice was PERSISTED, not held in the component',
    (await readWatches(page)).watches.every((w) => w.key !== WIKI_MOB)
  )
  const offersWatch = await settle(
    () => countOf(page, `[data-testid="respawn-candidate"][data-respawn-mob="${WIKI_MOB}"] [data-testid="respawn-watch"]`),
    (n) => n === 1,
    { timeoutMs: 20_000 }
  )
  check('…while the mob itself is offered again, the same control saying the opposite thing', offersWatch === 1)

  // NOTHING BUT THE PREFERENCE WENT AWAY: one click and the clock is back, numbered as before.
  await clickWatch(page, WIKI_MOB)
  const back = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, WIKI_MOB) !== undefined, {
    timeoutMs: 30_000
  })
  check('watching it again brings back the same clock', find(back, WIKI_MOB)?.source === 'wiki', JSON.stringify(back))
  check('…still the duration the wiki states, so the fold kept everything', find(back, WIKI_MOB)?.text.includes('9m 30s') === true)

  // AND THE WINDOW OVER THE GAME CAN DO IT, which is the half of the ruling the tab cannot show.
  await unwatchFromOverlay(overlay, WIKI_MOB)
  const goneAgain = await settle(
    () => clocks(overlay, 'respawn-overlay-row'),
    (r) => find(r, WIKI_MOB) === undefined,
    { timeoutMs: 30_000 }
  )
  check('the floating window can stop a clock on its own', find(goneAgain, WIKI_MOB) === undefined, JSON.stringify(goneAgain))
  const tabToo = await settle(() => clocks(page, 'respawn-row'), (r) => find(r, WIKI_MOB) === undefined, {
    timeoutMs: 30_000
  })
  check('…and the tab agrees, because both read one fold', find(tabToo, WIKI_MOB) === undefined, JSON.stringify(tabToo))
  check('…with no extra window spawned or lost along the way', (await windowsOfKind(app, 'respawn')) === 1)
}

/** Round 4's write, from the floating window's OWN bridge — the path a click there would take. */
function unwatchFromOverlay(overlay: Page, mob: string): Promise<boolean> {
  return overlay.evaluate(
    (k) => (window as unknown as { eqOverlay: { unwatchRespawn: (key: string) => Promise<boolean> } }).eqOverlay.unwatchRespawn(k),
    mob
  )
}

/** A zone the fixture is NOT in, played onto the live tail. Real name, real sentence shape. */
const OTHER_ZONE = 'Befallen'

/**
 * ZONING AWAY EMPTIES BOTH SURFACES, AND THE FOLD KEEPS EVERYTHING (owner ruling, round 1).
 *
 * Only the real app can show this: a `You have entered` line arriving on the live tail has to move
 * TWO renderers at once — the floating window (which now shows the zone you are in and nothing
 * else) and the tab (which defaults to it) — off one piece of module state. The all-zones switch
 * then proves the data was never thrown away, which is the half of the ruling that is easy to
 * implement wrongly by simply dropping the rows.
 */
async function stepZoneScope(page: Page, overlay: Page, log: FixtureLog): Promise<void> {
  const before = await clocks(page, 'respawn-row')
  log.append(`You have entered ${OTHER_ZONE}.`)

  const gone = await settle(() => clocks(page, 'respawn-row'), (r) => r.length === 0, { timeoutMs: 30_000 })
  check('walking into another zone takes the clocks off the tab', gone.length === 0, JSON.stringify(gone))
  const empty = await settle(
    () => page.evaluate(() => document.querySelector('[data-testid="respawn-empty"]')?.textContent ?? ''),
    (t) => t.length > 0,
    { timeoutMs: 20_000 }
  )
  check('…and says where they went rather than looking broken', empty.includes('running in other zones'), empty)

  const overlayRows = await settle(() => clocks(overlay, 'respawn-overlay-row'), (r) => r.length === 0, {
    timeoutMs: 30_000
  })
  check('…and the floating window empties with it', overlayRows.length === 0, JSON.stringify(overlayRows))
  const overlayText = await overlay.evaluate(() => document.body.innerText)
  check('…saying the clocks are running elsewhere, not that they are gone', overlayText.includes('running elsewhere'), overlayText)

  // THE DATA IS KEPT. One click, and every clock the fold holds is back — same rows, same numbers.
  await page.click('[data-testid="respawn-scope-all"]', { timeout: 15_000 })
  const all = await settle(() => clocks(page, 'respawn-row'), (r) => r.length === before.length, { timeoutMs: 20_000 })
  check(
    'the all-zones view still holds every clock the fold learned',
    all.length === before.length && before.every((b) => find(all, b.mob) !== undefined),
    JSON.stringify({ before, all })
  )
}

async function main(): Promise<void> {
  buildIfStale()
  const launched = await launchOnFixture('e2e-leveling.log')
  const fixture = launched.log
  const page = await mainWindow(launched.app)
  await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

  await stepFreshInstall(page, launched.app)
  await stepLiveKillIsOfferedThenWatched(page, fixture)
  await stepWatchFromRecentKills(page, fixture)
  // The zone step needs the window the overlay step opened — it is the second half of the same
  // claim (one piece of zone state, two renderers), so it rides the same window rather than
  // toggling a fresh one.
  const overlay = await stepOverlay(page, launched.app)
  if (overlay) {
    // Round 3 rides the same window for the same reason the zone step does: the claim is that ONE
    // piece of module state moves two renderers. It runs BEFORE the zone step, which walks the
    // character out and empties both surfaces.
    await stepSeenOnLogEvidence(page, overlay, fixture)
    // Round 4 rides the same window again, and runs before the zone step for the same reason round
    // 3 does: the zone step walks the character out and empties both surfaces. It deliberately
    // leaves ONE clock watched, so what follows still has something to take away.
    await stepUnwatchOnTheMob(page, overlay, launched.app)
    await stepZoneScope(page, overlay, fixture)
  }

  if (failures.length) await dumpArtifacts(page, 'respawn-timers-FAIL')
  await launched.close()
  await fixture.dispose()
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
