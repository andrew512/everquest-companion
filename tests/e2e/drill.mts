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

const BACK = '[data-testid="drill-back"]'
const ROW = '[data-testid="meter-row"]'

/** Is a drill open right now? (The Back button exists only at a level below the source list.) */
export async function drilled(page: Page): Promise<boolean> {
  return (await page.$$(BACK)).length > 0
}

/**
 * Un-drill (idempotent — a click on a crumb that isn't there is a no-op, not a failure) and
 * return the level-1 source-row count. Clicking Back is also the live check that un-drilling
 * still works: if it stopped working, the row count goes to 0 and the spec says so.
 *
 * Bounded on purpose: there are exactly two levels, so ONE click is enough and a Back that
 * doesn't close the crumb must surface as a failed row count, never as a hung run.
 */
export async function meterRows(page: Page): Promise<number> {
  if (await drilled(page)) {
    await page.click(BACK, { timeout: 5_000 }).catch(() => undefined)
    await page.waitForSelector(BACK, { state: 'detached', timeout: 5_000 }).catch(() => undefined)
  }
  return (await page.$$(ROW)).length
}
