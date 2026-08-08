// DRILL-AWARE readers for the combat e2e.
//
// The Combat dashboard OPENS ON LEVEL 1 again (owner ruling, 2026-08-05 — JOS-35: a meter that
// auto-drilled into your own breakdown hid every group-mate's row behind a chevron nobody knew
// to press). So the source rows are normally already on screen — but a spec step that ran after
// an earlier step drilled would still be looking at a level-2 list, and every assertion here
// that counts `meter-row` is about "the meter renders the sources it has": a claim about the
// DATA, not about which level happens to be open. Hence a reader that un-drills first, and is a
// no-op in the ordinary case.
//
// It lives in its own module rather than in the spec or in appHarness.mts because both of those
// files sit within a handful of lines of the repo's max-lines budget, and a helper is not worth
// spending a refactor wave's worth of budget in someone else's file.

import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'

const BACK = '[data-testid="drill-back"]'
/** The crumb's root link. ONE click from any level, which is what makes this reader bounded. */
const ALL = '[data-testid="drill-all"]'
const ROW = '[data-testid="meter-row"]'
/** One ability bar in a level-2 list, and the per-ability stats it expands inline (JOS-113). */
const SKILL = '[data-testid="skill-bar"]'
const STATS = '[data-testid="ability-stats"]'
/** The rejected JOS-105 chip — asserted ABSENT now (JOS-113: no category grouping layer). */
const CHIP = '[data-testid="category-chip"]'

/** Is a drill open right now? (The Back button exists only at a level below the source list.) */
export async function drilled(page: Page): Promise<boolean> {
  return (await page.$$(BACK)).length > 0
}

/**
 * Un-drill (idempotent — a click on a crumb that isn't there is a no-op, not a failure) and
 * return the level-1 source-row count. Clicking out is also the live check that un-drilling still
 * works: if it stopped working, the row count goes to 0 and the spec says so.
 *
 * IT CLICKS "All", NOT "Back", and that is what keeps it bounded now the drill has TWO levels
 * (JOS-113: sources → one source's ability list; a stat-bearing ability expands INLINE, it is not
 * a level). The crumb's root link goes to level 1 from wherever it is, in one click, so "the crumb
 * is gone" stays the whole wait condition.
 */
export async function meterRows(page: Page): Promise<number> {
  if (!(await drilled(page))) return (await page.$$(ROW)).length
  if ((await page.$$(ALL)).length > 0) {
    await page.click(ALL, { timeout: 5_000 }).catch(() => undefined)
  } else {
    // The GLANCE card's compact crumb is a chevron and a label — no root link fits in a card four
    // rows tall — so there it walks out one level at a time, bounded at the number of levels
    // (a nested pet is a level-2 subject inside your level-2 row, so at most two Backs to level 1).
    for (let i = 0; i < 2 && (await drilled(page)); i++) {
      await page.click(BACK, { timeout: 5_000 }).catch(() => undefined)
    }
  }
  await page.waitForSelector(BACK, { state: 'detached', timeout: 5_000 }).catch(() => undefined)
  return (await page.$$(ROW)).length
}

/**
 * THE SAME DRILL, ON THE GLANCE CARD (JOS-105/JOS-113) — the ticket's first sentence, walked with
 * a mouse.
 *
 * The Overview card's damage panel used to draw its own bars with no `onClick` on them, so a
 * source bar that drilled on the Combat tab was inert here; it also opened DRILLED when the pet
 * preference was on, and held a drill vocabulary of its own. It now renders the Combat tab's
 * components from the Combat tab's builder, with density as a prop — so the levels and the inline
 * per-ability stats have to be reachable HERE by exactly the clicks that reach them there.
 *
 * JOS-113: the card drills to ONE BAR PER ABILITY (no category chip), and clicking a stat-bearing
 * ability expands its crit/double/triple/miss inline. This asserts the chip is gone and a bar's
 * click opens the stats. Floors and identities only: the fixture decides who is in the fight and
 * what they dealt, so this notes rather than fails on an empty selection.
 */
export async function stepGlanceDrill(page: Page): Promise<void> {
  const rows = await meterRows(page)
  if (rows === 0) {
    note('the glance card has no damage to rank right now — there is no bar to click')
    return
  }
  check('the Overview damage card opens ZOOMED OUT, like every other meter (JOS-35)', !(await drilled(page)))

  await page.click(ROW, { timeout: 15_000 })
  const opened = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  check('…and clicking a bar DRILLS — the click this card used to lack entirely', opened)
  if (!opened) return

  // The category chip the owner rejected must NOT be here — one bar per ability, flat (JOS-113).
  check('…into a FLAT ability list with no category chip (JOS-113)', (await countOf(page, CHIP)) === 0)
  const inCard = page.locator(`[data-testid="overview-dps"] ${SKILL}`)
  const bars = await inCard.count()
  if (bars === 0) {
    note('the drilled source dealt no damage in this selection — no ability bar to expand')
  } else {
    // A stat-bearing ability expands its stats inline, here exactly as on the Combat tab. A
    // positional click at the BAR row (so React re-renders between awaits), on each ability until
    // one opens its readout — most are melee/slay swings and so expandable.
    let ok = false
    for (let i = 0; i < bars && !ok; i++) {
      await inCard.nth(i).click({ position: { x: 12, y: 8 }, timeout: 5_000 }).catch(() => undefined)
      ok = (await countOf(page, STATS)) >= 1
    }
    check('…and clicking a stat-bearing ability expands its stats inline, on the card too', ok)
  }

  const back = await meterRows(page)
  check('…and the crumb walks back out to the same source list', back === rows, `${rows} → ${back} rows`)
}
