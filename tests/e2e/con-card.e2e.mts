/**
 * Headless Electron spec for JOS-383 — A CON PUTS A CARD ON THE SCREEN.
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The pure halves are pinned elsewhere: the chips, the drop
 * ranking, the two refusals and the auto-hide knob in tests/conCard.test.mts, the queue's timing in
 * tests/toastQueue.test.mts, the estimator in tests/resistModel.test.mts, and the "no migration
 * needed" claim in tests/storeMigrationsConCard.test.mts. What no unit test can claim is that THE
 * PIECES ARE WIRED, and the wiring here spans a log file, a parser, three modules, a store and two
 * renderers:
 *
 *   1. A FRESH INSTALL ALREADY HAS THE WINDOW. This kind is the first strip to ship ON, and a
 *      default is a claim about a window that either exists or does not. Every launch gets a fresh
 *      userData dir, so this spec is always a first run — which makes it the only place that can
 *      prove the presence.
 *   2. A `/con` WRITTEN INTO THE LIVE LOG DRAWS THE CARD. The line goes down the whole real path
 *      (chokidar → Tailer → parseWorld → ConsiderModule → main/conCard.ts → the overlay window),
 *      and comes out as a named card with the level the line stated, five resist chips and the
 *      mob's drops. Playing the line is the point: nothing in the fixture's history may draw a
 *      card, because a startup replay of a month of logs must not fire hundreds of them.
 *   3. FIVE CHIPS, ONE ORDER, COLOUR AND WORD AND TAG — and NO ACRONYM anywhere on the card.
 *   4. THE NEXT CON REPLACES IT. One card, never a stack.
 *   5. A PLAYER GETS NO CARD, from a con line that is the same shape on the same faction rung.
 *   6. THE × CLOSES IT, AND A RE-CON DOES NOT PUT IT BACK. The close is local and the suppression
 *      is main's; only a real round trip can show them agreeing.
 *   7. THE PREFERENCE TURNS IT OFF, and the window goes with it.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`, so the card here is created, loaded and driven
 * entirely off-screen. That is also why the DOM is asserted rather than the animation.
 *
 * THE SPELLS CARVE-OUT, exactly as tests/e2e/mob-resists.e2e.mts takes it: the resist estimate joins
 * the client's own `spells_us.txt`, which this repo may not carry, so the harness links the real
 * install's copy in (`{ spells: true }`). On a machine with no EverQuest the chips are still five
 * and still say a word each — they simply say "no data", which is the app's honest degraded branch
 * and a supported configuration in its own right.
 *
 * Run: `npm run test:e2e -- con-card`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import {
  ARTIFACTS,
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleStable,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const CARD = '[data-testid="con-card"]'
const NAME = '[data-testid="con-card-name"]'
const FACTS = '[data-testid="con-card-facts"]'
const DROPS = '[data-testid="con-card-drops"]'
const CLOSE = '[data-testid="con-card-close"]'

/** Always five, always this order — the whole point of a fixed layout is that the eye learns it. */
const AXES = ['magic', 'fire', 'cold', 'poison', 'disease'] as const

/**
 * The mob: a catalog hit with 44 listed drops AND 156 rows in the committed resist baseline, and
 * the same creature tests/e2e/mob-resists.e2e.mts uses for the same reason — the log, the catalog
 * and the ledger all spell it one way, so nothing here depends on the machine it runs on.
 */
const MOB = 'A zol ghoul knight'
const MOB_CON = `${MOB} scowls at you, ready to attack -- what would you like your tombstone to say? (Lvl: 38)`
/** A SECOND creature, to prove the next con replaces the card rather than stacking one. */
const OTHER = 'A wan ghoul knight'
const OTHER_CON = `${OTHER} regards you indifferently -- looks like quite a gamble. (Lvl: 35)`
/**
 * A PLAYER, conned. Verbatim from the committed fixture w24-consider-factions.log, and the reason
 * the ticket's "the ladder knows PC from NPC" was wrong: this line and the mob lines above are the
 * same shape, and two of them share a faction rung.
 */
const PLAYER_CON = 'Lasershark regards you indifferently -- looks like quite a gamble. (Lvl: 50)'
/** Where the character is standing. Played, so the zone on the card can only be the live one. */
const ZONE = 'Lower Guk'

/** The con card overlay's page, identified by the `?kind=` query its window was opened with. */
async function findCardWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=conCard')) return w
  }
  return null
}

/** Every card on screen, as flattened text. There is never supposed to be more than one. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    CARD
  )
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '', sel)
}

/** Play one line into the log the app is tailing, then wait for the card to say what it should. */
async function conAndWait(log: FixtureLog, card: Page, line: string, expect: string): Promise<string> {
  log.append(line)
  return settle(() => textOf(card, NAME), (n) => n === expect, { timeoutMs: 30_000 })
}

/** A FRESH INSTALL HAS THE WINDOW — this kind is the first strip to ship ON (owner, 2026-08-16). */
async function stepShipsOn(app: ElectronApplication): Promise<Page | null> {
  const card = await settle(() => findCardWindow(app), (w) => w !== null, { timeoutMs: 30_000 })
  check('a fresh install spawns the con card window — the kind ships ON', card !== null)
  if (card) {
    // …and it is EMPTY until something is conned. The window existing is not the card existing.
    const idle = await settleStable(() => cardTexts(card), { timeoutMs: 6_000, stable: 4, pollMs: 200 })
    check('…and it draws nothing until a con happens', idle.length === 0, `${String(idle.length)} card(s)`)
  }
  return card
}

/** A REPLAY DRAWS NOTHING. The fixture's own history is folded before any of this runs. */
async function stepReplayIsSilent(page: Page, card: Page): Promise<void> {
  const { snap } = await waitHydrated(page)
  if (!check('hydration completes (the historical replay has finished)', !snap.hydrating)) return
  const after = await cardTexts(card)
  check('the replay of a month of log draws no card at all', after.length === 0, `${String(after.length)} card(s)`)
}

/** THE LIVE `/con`: one line in the log, one card on the screen, carrying what the line said. */
async function stepConDrawsTheCard(log: FixtureLog, card: Page): Promise<void> {
  // The zone is played too, on the line before: the card reports where the player IS, which is a
  // fact the con line never states and only the running world model can answer.
  log.append(`You have entered ${ZONE}.`)
  const name = await conAndWait(log, card, MOB_CON, MOB)
  if (!check('a `/con` written into the live log draws a card naming the creature', name === MOB, name)) return
  const facts = await textOf(card, FACTS)
  check('…carrying the LEVEL the con line stated', facts.includes('Level 38'), facts)
  check('…and the zone the character walked into on the line before it', facts.includes(ZONE), facts)
  const cards = await cardTexts(card)
  check('…and exactly one card, never a stack', cards.length === 1, `${String(cards.length)} card(s)`)
}

/**
 * FIVE CHIPS, ONE ORDER, EACH SAYING A WORD. And no acronym anywhere on the card.
 *
 * IT RUNS AFTER THE DROPS STEP, and that ordering is a finding rather than a preference: the card
 * arrives in TWO passes and the client's 38 MB `spells_us.txt` is read on a worker, so the first
 * pass genuinely has no resist table behind it and draws five honest "no data" chips. Reading the
 * chips before the second pass lands is reading a state the app is only in for a second.
 */
async function stepFiveChips(card: Page): Promise<void> {
  for (const axis of AXES) {
    const present = (await countOf(card, `[data-testid="con-chip-${axis}"]`)) === 1
    if (!check(`the ${axis} chip is on the card, whatever is behind it`, present)) continue
    const tag = await textOf(card, `[data-testid="con-chip-tag-${axis}"]`)
    check(`…and says its state in WORDS (${axis}: ${tag})`, tag.length > 0 && /[a-z]/.test(tag), tag)
  }
  const text = (await cardTexts(card))[0] ?? ''
  // The axis words themselves, in order, with nothing between them but their own chips.
  const order = AXES.map((a) => text.indexOf(a)).filter((i) => i >= 0)
  check('the five axes read in ONE fixed order, so the eye learns the positions',
    order.length === AXES.length && order.every((v, i) => i === 0 || v > order[i - 1]), text.slice(0, 200))
  // NO ACRONYMS, EVER (owner ruling, 2026-08-16) — the whole reason the words are the labels.
  check('no acronym reaches the card', !/\b(MR|FR|CR|DR|PR)\b/.test(text), text.slice(0, 200))
  // Whatever the machine has, a chip either reports its answer or says it has none — never the
  // withheld "not enough data" the owner overruled on 2026-08-16.
  check('and no chip withholds an answer it has', !/not enough data/i.test(text), text.slice(0, 200))

  // THE ESTIMATE ITSELF, on the machine that can join the client table. `a zol ghoul knight` has
  // 156 rows in the COMMITTED baseline, so on any machine with EverQuest installed this is exact
  // and not a floor; without one, the spec asserts the app's stated degraded branch instead — the
  // same carve-out tests/e2e/mob-resists.e2e.mts takes, for the same file this repo may not carry.
  if (/spells_us\.txt/.test(text)) {
    note('no client spell data on this machine - the chips took their stated degraded branch')
    check('…and the card SAYS the spell data is missing rather than implying the mob is unknown',
      /Resists need your EverQuest install/.test(text), text.slice(0, 200))
    return
  }
  const detail = await textOf(card, '[data-testid="con-chip-detail-magic"]')
  check('a chip with evidence behind it prints R, its interval and its count',
    /R \d+ \(\d+-\d+\) n=\d+/.test(detail), detail)
  const tag = await textOf(card, '[data-testid="con-chip-tag-magic"]')
  check('…and the plain-language tag beside them', /(weak|normal|resistant|nearly immune)/.test(tag), tag)
}

/** THE DROPS: the catalog's table for this mob, at most five lines of it. */
async function stepDrops(card: Page): Promise<void> {
  const drops = await settle(
    () => textOf(card, DROPS),
    (t) => t.length > 0 && !/Looking up/.test(t),
    { timeoutMs: 30_000 }
  ).catch(() => '')
  if (!check('the card answers what it drops once the lookup lands', drops.length > 0, drops)) return
  const lines = await countOf(card, '[data-testid="con-card-drop"]')
  check('…as at most five lines', lines > 0 && lines <= 5, `${String(lines)} line(s)`)
  check('…and it COUNTS the ones that did not fit rather than truncating in silence',
    /\+\d+ more/.test(drops), drops.slice(0, 160))
}

/**
 * WHAT IT LOOKS LIKE, saved as a picture.
 *
 * This overlay's whole subject is APPEARANCE — colour, contrast and density over a running game —
 * and no assertion in this file can carry that. One PNG of the settled card, into the run's own
 * artifacts, is what a reviewer actually needs; it costs a few hundred milliseconds and it is the
 * only way this spec can hand over the thing the ticket asks to be judged.
 *
 * The overlay window is TRANSPARENT, so the image is the card on nothing — which is exactly the
 * layer that goes over the game.
 *
 * IT HAS TO SHOW THE WINDOW FIRST, and that is JOS-120's law arriving from the other side: a hidden
 * BrowserWindow produces no frames, so a screenshot of one never resolves. `EQ_E2E=1` skips every
 * `showInactive`, so this step asks MAIN to show the card window for the moment it takes to
 * capture and puts it back. Everything here is best-effort and reports through `note`, never a
 * check: a machine with no display owes this spec nothing.
 */
async function stepScreenshot(app: ElectronApplication, card: Page): Promise<void> {
  const path = join(ARTIFACTS, 'con-card.png')
  const setShown = (shown: boolean): Promise<void> =>
    app.evaluate(({ BrowserWindow }, show) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.getURL().includes('kind=conCard')) continue
        if (show) w.showInactive()
        else w.hide()
      }
    }, shown)
  try {
    mkdirSync(ARTIFACTS, { recursive: true })
    await setShown(true)
    await card.screenshot({ path, omitBackground: true, timeout: 20_000 })
    note(`card screenshot: ${path}`)
  } catch (err: unknown) {
    note(`card screenshot unavailable — ${String(err)}`)
  } finally {
    await setShown(false).catch(() => undefined)
  }
}

/** THE NEXT CON REPLACES IT. One card, always — the queue is one deep by design. */
async function stepNextConReplaces(log: FixtureLog, card: Page): Promise<void> {
  const name = await conAndWait(log, card, OTHER_CON, OTHER)
  if (!check('conning something else REPLACES the card', name === OTHER, name)) return
  const cards = await cardTexts(card)
  check('…rather than stacking a second one', cards.length === 1, `${String(cards.length)} card(s)`)
}

/** A PLAYER IS NOT A MOB, and the con line is no help — the refusal is the shape plus the catalog. */
async function stepPlayerGetsNothing(log: FixtureLog, card: Page): Promise<void> {
  const before = await textOf(card, NAME)
  log.append(PLAYER_CON)
  // Nothing is supposed to happen, so the positive signal is the card HOLDING STILL.
  const after = await settleStable(() => textOf(card, NAME), { timeoutMs: 8_000, stable: 5, pollMs: 200 })
  check('conning a PLAYER draws no card (the name on screen never changed)', after === before, `${before} -> ${after}`)
  check('…and never names the player', !after.includes('Lasershark'), after)
}

/** THE × CLOSES IT, AND THE SAME MOB DOES NOT COME BACK FOR A MINUTE. */
async function stepCloseAndSuppress(log: FixtureLog, card: Page): Promise<void> {
  await card.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.click(), CLOSE)
  const gone = await settle(() => cardTexts(card), (c) => c.length === 0, { timeoutMs: 10_000 })
  if (!check('clicking the card’s own × closes it', gone.length === 0, `${String(gone.length)} card(s)`)) return
  // The mob whose card was just closed is the one that must not come back.
  log.append(OTHER_CON)
  const still = await settleStable(() => cardTexts(card), { timeoutMs: 8_000, stable: 5, pollMs: 200 })
  check('…and re-conning that same creature does NOT put it back up', still.length === 0, `${String(still.length)} card(s)`)
  // A DIFFERENT creature still gets its card: the suppression is per mob, not a mute switch.
  const name = await conAndWait(log, card, MOB_CON, MOB).catch(() => '')
  check('…while a different creature still draws one — the suppression is per mob', name === MOB, name)
}

/** THE PREFERENCE: off means off, and the window goes with it. */
async function stepPreferenceTurnsItOff(app: ElectronApplication, page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-overlays"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-overlays"]')
  await page.waitForSelector('[data-testid="pref-con-card"]', { timeout: 15_000 })
  const on = await settleStable(
    () => page.evaluate((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.checked, '[data-testid="pref-con-card-enabled"] input'),
    { timeoutMs: 8_000, stable: 4, pollMs: 150 }
  )
  check('Preferences agrees the card is ON, matching the window that already exists', on === true, String(on))
  await page.click('[data-testid="pref-con-card-enabled"] input')
  const closed = await settle(() => findCardWindow(app), (w) => w === null, { timeoutMs: 20_000 })
  check('turning it off closes the window — off means off', closed === null)
}

async function main(): Promise<void> {
  buildIfStale()

  // The spells link is the resist half's only machine dependency; the card is asserted either way.
  const log = stageFixture('e2e-overlay.log', { spells: true })
  const userData = makeUserData()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-overlay.log…')
  const { app, close } = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })

    const card = await stepShipsOn(app)
    if (card) {
      await stepReplayIsSilent(page, card)
      await stepConDrawsTheCard(log, card)
      // The drops step is what WAITS for the second pass; the chips are read after it, so they are
      // read from a settled card rather than from the moment before the spell table landed.
      await stepDrops(card)
      await stepFiveChips(card)
      await stepScreenshot(app, card)
      await stepNextConReplaces(log, card)
      await stepPlayerGetsNothing(log, card)
      await stepCloseAndSuppress(log, card)
      await stepPreferenceTurnsItOff(app, page)
    } else {
      note('no con card window — every claim below it was skipped')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'con-card-FAIL')
  } finally {
    await close()
  }

  await removeUserData(userData)
  await log.dispose()
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
