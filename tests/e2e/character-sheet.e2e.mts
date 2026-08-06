/**
 * THE FLAG'S PROOF — the character sheet (JOS-45) must be UNREACHABLE in a shipped build.
 *
 * The owner's review gate says this module may land on main provided a packaged user cannot get
 * to it. That promise is not a code comment; it is a property of the emitted bundle, and this
 * spec is where it is measured. `npm run test:e2e` builds PRODUCTION-SHAPED (`electron-vite
 * build` into `out-e2e/`), which is exactly the compilation an installer ships — so
 * `import.meta.env.DEV` is a literal `false` here and `UNRELEASED` folds with it.
 *
 * WHY THIS SPEC LAUNCHES TWICE. An absence assertion is the weakest kind of test: it passes just
 * as happily when the feature was never wired up at all, when a testid was misspelled, or when
 * the whole module was deleted. So the second launch sets `EQ_UNRELEASED=1` and watches the SAME
 * IPC channel — which is refused in the first run — answer. Absent, then present, on ONE build:
 * that is a gate, and the first run's silence means something.
 *
 * WHAT STAYS ABSENT IN BOTH RUNS: the nav row and the whole renderer tree. The override is a
 * MAIN-side door only, and deliberately so — the renderer half is a compile-time strip, so
 * there is nothing in these bytes for any environment variable to reveal. A run that found
 * `nav-character` under the override would mean the strip had stopped working.
 *
 * Run: `npm run test:e2e -- character-sheet` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun } from './appHarness.mjs'
import { launchApp, mainWindow } from './appWindow.mjs'

const NAV = '[data-testid="nav-character"]'

/** Does `window.eq.characterSheet()` resolve in this build? Never throws out of the page. */
function sheetReachable(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const call = (window as unknown as { eq: Record<string, unknown> }).eq.characterSheet
    if (typeof call !== 'function') return false
    try {
      await (call as () => Promise<unknown>)()
      return true
    } catch {
      return false
    }
  })
}

/** The sheet itself, when the door is open and this machine has a dump. */
function readSheet(page: Page): Promise<{ cells: number; worn: number; counted: number; unknown: number } | null> {
  return page.evaluate(async () => {
    const eq = (window as unknown as { eq: { characterSheet: () => Promise<unknown> } }).eq
    const sheet = (await eq.characterSheet()) as {
      cells: { item: unknown }[]
      totals: { counted: number; unknown: number }
    } | null
    if (!sheet) return null
    return {
      cells: sheet.cells.length,
      worn: sheet.cells.filter((c) => c.item !== null).length,
      counted: sheet.totals.counted,
      unknown: sheet.totals.unknown
    }
  })
}

async function stepStripped(page: Page): Promise<void> {
  check(
    'the unreleased Character tab is STRIPPED from a production-shaped build (no nav row)',
    (await countOf(page, NAV)) === 0
  )
  const reachable = await sheetReachable(page)
  check(
    '…and its IPC handler is not registered in this build either',
    reachable === false,
    `character:sheet ${reachable ? 'ANSWERED' : 'rejected, as designed'}`
  )
}

/**
 * The polarity check. The renderer is still stripped — that is the compile-time half and no env
 * var can undo it — but main's door opens, so the channel answers.
 */
async function stepForced(page: Page): Promise<void> {
  check(
    'EQ_UNRELEASED=1 does NOT resurrect the nav row — the renderer strip is compile-time',
    (await countOf(page, NAV)) === 0
  )
  const reachable = await sheetReachable(page)
  check(
    'EQ_UNRELEASED=1 DOES open main’s door — so the first run’s refusal was the gate, not a missing feature',
    reachable === true,
    reachable ? '' : 'character:sheet still refused — the gate may be inverted or the handler missing'
  )
  if (!reachable) return

  const sheet = await readSheet(page)
  if (!sheet) {
    note('no /outputfile inventory dump on this machine — the shape assertions are skipped')
    return
  }
  // Identities, never today's gear: the grid is a fixed set of cells, and every worn item is
  // either summed or counted as unknown, with none falling between the two.
  check('the sheet draws every slot cell, filled or not', sheet.cells === 24, `${String(sheet.cells)} cells`)
  check(
    'every worn item is either summed or counted as unknown',
    sheet.counted + sheet.unknown === sheet.worn,
    `${String(sheet.counted)} + ${String(sheet.unknown)} vs ${String(sheet.worn)} worn`
  )
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch 1: production-shaped build, no override — the module must be absent…')
  const first = await launchApp()
  let page: Page | null = null
  try {
    page = await mainWindow(first.app)
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })
    await stepStripped(page)
    if (failures.length) await dumpArtifacts(page, 'character-sheet-stripped-FAIL')
  } finally {
    await first.close()
  }

  console.log('launch 2: the SAME build with EQ_UNRELEASED=1 — main’s door must open…')
  const second = await launchApp({ env: { EQ_UNRELEASED: '1' } })
  let forced: Page | null = null
  try {
    forced = await mainWindow(second.app)
    await forced.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })
    await stepForced(forced)
    if (failures.length) await dumpArtifacts(forced, 'character-sheet-forced-FAIL')
  } finally {
    await second.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
