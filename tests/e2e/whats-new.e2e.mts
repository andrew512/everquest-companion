/**
 * WHAT'S NEW, driven through the real app (JOS-73).
 *
 * `tests/releaseNotes.test.mts` pins the derivation as pure logic, which is most of the feature.
 * What a unit test structurally cannot see is the part this spec exists for: the whole promise
 * rests on a STORE KEY that main owns, read once at launch, and the two most load-bearing claims
 * are about a launch rather than about a function.
 *
 *   1. A FRESH INSTALL IS NOT TOLD IT WAS UPDATED. The e2e channel gives every launch its own
 *      temp userData (src/main/channel.ts), so this run IS a fresh install — no stub, no seeded
 *      state, no flag. The teaser strip must be absent, and the panel must mark nothing new. If
 *      the absent-key case ever reads as "everything is new", this is where it shows up, and it
 *      would show up as the first sentence the app ever says to a new user.
 *   2. …AND AN UPGRADED INSTALL IS. The stamp is written through the same bridge method the
 *      panel and the teaser's dismiss use, the window is RELOADED (the state is read once per
 *      launch, on purpose — features/whatsnew/session.ts), and the strip has to come back naming
 *      the newest release with the right releases marked behind it.
 *
 * It also asserts the DEV variant control is ABSENT here, for the same reason the feedback spec
 * asserts `nav-triage` is: this build is production-shaped, and "compiled out" is a claim about
 * bytes that only a build can answer.
 *
 * Run: `npm run test:e2e -- whats-new`
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settleCount,
  settleStable
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { RELEASE_NOTES, variantLastSeen } from '../../src/shared/releaseNotes'

const TEASER = '[data-testid="whats-new-teaser"]'
const PANEL = '[data-testid="whats-new-panel"]'
const RAIL = '[data-testid="prefs-rail-whatsnew"]'
const DEV_ROW = '[data-testid="whats-new-dev"]'

const NEWEST = RELEASE_NOTES[0]!.version
/** The state a one-release upgrade leaves behind — exactly what the DEV control's second button
 *  writes, so the hand test and this spec are driving the same configuration. */
const PREVIOUS = variantLastSeen('previous')

/** Write the last-seen stamp through the very bridge method the app's own surfaces call. */
function setSeen(page: Page, version: string | null): Promise<string | null> {
  return page.evaluate(
    (v) =>
      (
        window as unknown as {
          eq: { setReleaseNotesSeen: (x: string | null) => Promise<string | null> }
        }
      ).eq.setReleaseNotesSeen(v),
    version
  )
}

/** Open Preferences → What's new and read the panel back. */
async function openPanel(page: Page): Promise<{ releases: number; marked: string[] }> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector(RAIL, { timeout: 20_000 })
  await page.click(RAIL)
  await page.waitForSelector(PANEL, { timeout: 20_000 })
  return page.evaluate(() => ({
    releases: document.querySelectorAll('[data-testid^="whats-new-release-"]').length,
    marked: [...document.querySelectorAll('[data-testid^="whats-new-release-"][data-new="true"]')].map(
      (el) => el.getAttribute('data-testid')?.replace('whats-new-release-', '') ?? ''
    )
  }))
}

/** The one line the strip says, or '' when there is no strip. */
function teaserText(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-testid="whats-new-teaser-text"]')?.textContent?.trim() ?? ''
  )
}

async function main(): Promise<void> {
  buildIfStale()

  const launched = await launchOnFixture('e2e-overview.log')
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

    // ---- 1. a fresh install ------------------------------------------------
    // The ABSENCE is asserted the lawful way: wait for the reading to STOP CHANGING, then assert
    // nothing is there. A bare check here would pass while the state was still in flight.
    const settled = await settleStable(() => countOf(page as Page, TEASER))
    check(
      'A FRESH INSTALL IS NEVER TOLD IT WAS UPDATED — no teaser strip at all',
      settled === 0,
      `teasers=${String(settled)}`
    )

    const fresh = await openPanel(page)
    check(
      'the full history is browsable anyway — every release renders',
      fresh.releases === RELEASE_NOTES.length,
      `rendered=${String(fresh.releases)} expected=${String(RELEASE_NOTES.length)}`
    )
    check(
      '…and NOTHING is marked new, because a new user has no changes',
      fresh.marked.length === 0,
      `marked=${fresh.marked.join(',') || 'none'}`
    )
    check(
      'the DEV variant control is compiled OUT of a production-shaped build',
      (await countOf(page, DEV_ROW)) === 0
    )

    // ---- 2. an upgraded install -------------------------------------------
    // The state is read ONCE per launch, so the reload is not a shortcut around anything: it is
    // the second launch, which is exactly when a real upgrade's teaser appears.
    const stored = await setSeen(page, PREVIOUS)
    check('the stamp round-trips through main', stored === PREVIOUS, `stored=${stored ?? 'null'}`)

    await page.reload({ timeout: 60_000 })
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

    const shown = await settleCount(page, TEASER, 1)
    check('…and the next launch says so, in one quiet line', shown === 1, `teasers=${String(shown)}`)
    const line = await teaserText(page)
    check(
      '…naming the NEWEST release and only it',
      line === `Updated to v${NEWEST}`,
      `line="${line}"`
    )

    const upgraded = await openPanel(page)
    check(
      'the panel marks every release since the one this install had seen',
      upgraded.marked.length > 0 && upgraded.marked[0] === NEWEST,
      `marked=${upgraded.marked.join(',') || 'none'}`
    )
    check(
      '…and nothing at or below the stamp',
      !upgraded.marked.includes(PREVIOUS ?? ''),
      `stamp=${PREVIOUS ?? 'null'} marked=${upgraded.marked.join(',')}`
    )

    if (failures.length) await dumpArtifacts(page, 'whats-new-FAIL')
  } finally {
    await launched.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
