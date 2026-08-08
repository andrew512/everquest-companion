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
import { check, countOf, note, settle, settleCount } from './appHarness.mjs'

const BACK = '[data-testid="drill-back"]'
/** The crumb's root link. ONE click from any level, which is what makes this reader bounded. */
const ALL = '[data-testid="drill-all"]'
const ROW = '[data-testid="meter-row"]'
/** One damage TYPE, level 3 (JOS-105): the chip that opens it, and the body it opens. */
const CHIP = '[data-testid="category-chip"]'
const CATEGORY = '[data-testid="category-drill"]'

/** Is a drill open right now? (The Back button exists only at a level below the source list.) */
export async function drilled(page: Page): Promise<boolean> {
  return (await page.$$(BACK)).length > 0
}

/**
 * Un-drill (idempotent — a click on a crumb that isn't there is a no-op, not a failure) and
 * return the level-1 source-row count. Clicking out is also the live check that un-drilling still
 * works: if it stopped working, the row count goes to 0 and the spec says so.
 *
 * IT CLICKS "All", NOT "Back", and that is what keeps it bounded now that the drill has THREE
 * levels (JOS-105: sources → one source's lanes → one damage type of it). Back steps out one
 * level and would need a loop with a condition per level; the crumb's root link goes to level 1
 * from wherever it is, in one click, so "the crumb is gone" stays the whole wait condition.
 */
export async function meterRows(page: Page): Promise<number> {
  if (!(await drilled(page))) return (await page.$$(ROW)).length
  if ((await page.$$(ALL)).length > 0) {
    await page.click(ALL, { timeout: 5_000 }).catch(() => undefined)
  } else {
    // The GLANCE card's compact crumb is a chevron and a label — no root link fits in a card four
    // rows tall — so there it walks out one level at a time, bounded at the number of levels.
    for (let i = 0; i < 2 && (await drilled(page)); i++) {
      await page.click(BACK, { timeout: 5_000 }).catch(() => undefined)
      await page.waitForSelector(CATEGORY, { state: 'detached', timeout: 5_000 }).catch(() => undefined)
    }
  }
  await page.waitForSelector(BACK, { state: 'detached', timeout: 5_000 }).catch(() => undefined)
  return (await page.$$(ROW)).length
}

/**
 * THE SAME DRILL, ON THE GLANCE CARD (JOS-105) — the ticket's first sentence, walked with a mouse.
 *
 * The Overview card's damage panel used to draw its own bars with no `onClick` on them, so a
 * source bar that drilled on the Combat tab was inert here; it also opened DRILLED when the pet
 * preference was on, and held a drill vocabulary of its own. It now renders the Combat tab's
 * components from the Combat tab's builder, with density as a prop — so the three levels have to
 * be reachable HERE by exactly the clicks that reach them there, and that is what this asserts.
 *
 * Floors and identities only: the fixture decides who is in the fight and what they dealt, so
 * this asserts "a bar, and it drills" and notes rather than fails on an empty selection.
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

  const chips = await countOf(page, CHIP)
  check('…into a lane list offering the same damage types the Combat tab offers', chips >= 1, `${chips} types`)
  if (chips > 0) {
    await page.click(CHIP, { timeout: 10_000 })
    const level3 = (await settleCount(page, CATEGORY, 1, { timeoutMs: 10_000 })) >= 1
    check('…and a damage type opens its own level here too, stats and all', level3)
  }

  const back = await meterRows(page)
  check('…and the crumb walks back out to the same source list', back === rows, `${rows} → ${back} rows`)
}
