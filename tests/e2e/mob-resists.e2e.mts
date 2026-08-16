// THE RESISTS CARD, IN THE REAL APP (JOS-382).
//
// What a fixture replay cannot see: that the card MOUNTS on the mob page, that it draws five axis
// rows whether or not there is anything behind them, that the number and its interval and its
// count are all on screen together, and that no acronym reaches a player's eye. The estimator's
// arithmetic is pinned by tests/resistModel.test.mts against synthetic rolls; this spec is about
// what the screen says.
//
// IT STATES EXACT NUMBERS, and it is allowed to: nothing here is read off the player's live log.
// The rows come from the COMMITTED baseline (src/main/data/resistBaseline.json), the mob comes
// from the committed catalog, and the fixture log is the same one the deep-link spec uses. The one
// thing that is not committed is the client's own `spells_us.txt`, which this repo may not carry —
// the harness symlinks the real install's copy in (`{ spells: true }`, the same carve-out the map
// packs get), and on a machine with no EverQuest installed the spec asserts the app's honest
// degraded branch instead. That branch is a supported configuration in its own right: an
// install-dir override pointed at a folder of logs has no spell data behind it either.
//
// Run: `npm run test:e2e -- mob-resists`

import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const GRID = '[data-testid="overview-grid"]'
const NAV_MOBS = '[data-testid="nav-mobs"]'
const SEARCH = '[data-testid="mobs-search"]'
const RESULT_ROW = '[data-testid="mobs-result-row"]'
const CARD = '[data-testid="resist-card"]'
const ROWS = '[data-testid="resist-rows"]'

/** The mob: the catalog and the owner's log spell it the same way, and it has real evidence. */
const MOB = 'a zol ghoul knight'
/** Always five rows, whatever is behind them. */
const AXES = ['magic', 'fire', 'cold', 'poison', 'disease'] as const

function appears(page: Page, sel: string, ms = 20_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

async function textOf(page: Page, sel: string): Promise<string> {
  const raw = await page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '',
    sel
  )
  return raw.replace(/\s+/g, ' ').trim()
}

async function stepReady(page: Page): Promise<void> {
  if (!check('the app lands on the Overview', await appears(page, GRID, 60_000))) {
    throw new Error('never landed on Overview - nothing below can be asserted')
  }
  const { snap } = await waitHydrated(page)
  if (!check('hydration completes (the replay has finished)', !snap.hydrating)) {
    throw new Error('still hydrating - nothing below can be asserted')
  }
}

async function openMobPage(page: Page): Promise<boolean> {
  await page.click(NAV_MOBS, { timeout: 15_000 })
  if (!(await appears(page, SEARCH))) return check('the Mobs tab offers its catalog search', false)
  await page.fill(SEARCH, MOB, { timeout: 15_000 })
  if (!(await appears(page, RESULT_ROW))) return check(`the catalog finds ${MOB}`, false)
  const first = await textOf(page, RESULT_ROW)
  if (!check(`the top hit is ${MOB}`, first.toLowerCase().startsWith(MOB), first)) return false
  await page.click(RESULT_ROW, { timeout: 15_000 })
  return check('its page opens with a Resists card', await appears(page, CARD, 20_000))
}

/** The degraded branch: no client spell data, so the card says so and draws no rows. */
async function stepNoSpellData(page: Page): Promise<void> {
  const text = await textOf(page, CARD)
  check('the card says the spell data is missing rather than drawing an empty grid', text.includes('Spell data unavailable'), text)
  check('and it draws no axis rows at all', (await countOf(page, ROWS)) === 0)
}

async function stepFiveRows(page: Page): Promise<void> {
  const rows = await settle(() => countOf(page, '[data-testid^="resist-row-"]'), (n) => n === AXES.length, {
    timeoutMs: 15_000
  })
  check(`five axis rows, always (saw ${String(rows)})`, rows === AXES.length, String(rows))
  for (const axis of AXES) {
    check(`  ${axis} has a row`, (await countOf(page, `[data-testid="resist-row-${axis}"]`)) === 1)
  }
}

async function stepNumbers(page: Page): Promise<void> {
  // Magic is the best-observed axis on this mob by an order of magnitude: over a thousand
  // observations in the shipped baseline, all of them the tailed character's own casts.
  const magic = await textOf(page, '[data-testid="resist-value-magic"]')
  check('magic prints its number WITH its interval', /^R \d+ \(-?\d+-\d+\)$/.test(magic), magic)
  const tag = await textOf(page, '[data-testid="resist-tag-magic"]')
  check(
    'and a plain-language tag beside it',
    ['weak', 'normal', 'resistant', 'very resistant', 'nearly immune'].includes(tag),
    tag
  )
  const row = await textOf(page, '[data-testid="resist-row-magic"]')
  check('and the count it rests on', /n=\d+/.test(row), row)
  check('and where the evidence came from', /baseline \d+/.test(row), row)

  // THE HEADLINE: this mob resists cold noticeably more than magic, and the card shows it.
  const cold = await textOf(page, '[data-testid="resist-value-cold"]')
  const magicR = Number(/^R (\d+)/.exec(magic)?.[1] ?? '0')
  const coldR = Number(/^R (\d+)/.exec(cold)?.[1] ?? '0')
  check(`cold (${cold}) reads above magic (${magic})`, coldR > magicR, `${cold} vs ${magic}`)
}

async function stepThinRow(page: Page): Promise<void> {
  // Disease: the tailed character never cast a disease spell at this mob. That is a real answer
  // and the card prints it as one, rather than omitting the row or drawing a zero.
  const thin = await countOf(page, '[data-testid^="resist-thin-"]')
  if (thin === 0) {
    note('every axis on this mob has data - no thin row to check on this build')
    return
  }
  const text = await textOf(page, '[data-testid^="resist-thin-"]')
  check('a thin cell says how little it has', /^not enough data \(n=\d+\)$/.test(text), text)
}

async function stepEvidence(page: Page): Promise<void> {
  if (!(await appears(page, '[data-testid="resist-expand-magic"]', 5_000))) {
    check('the magic row is expandable', false)
    return
  }
  await page.click('[data-testid="resist-expand-magic"]', { timeout: 15_000 })
  if (!check('the magic row expands', await appears(page, '[data-testid="resist-evidence-magic"]', 10_000))) return
  const text = await textOf(page, '[data-testid="resist-evidence-magic"]')
  check('and lists per-spell evidence', /: \d+ casts?/.test(text), text.slice(0, 120))
}

async function stepNoAcronyms(page: Page, populated: boolean): Promise<void> {
  const text = await textOf(page, CARD)
  // Owner ruling, 2026-08-16: the axis WORD, always, and never `MR` / `FR` / `CR` / `DR` / `PR`.
  const acronym = /\b(MR|FR|CR|DR|PR)\b/.exec(text)
  check('NO ACRONYMS anywhere on the card', acronym === null, acronym?.[0] ?? '')
  // No em dashes in copy a player reads (JOS-106).
  check('no em dash in the card copy', !/[–—]/.test(text), text.slice(0, 120))
  if (!populated) return
  for (const axis of AXES) {
    check(`  the word "${axis}" is on the card`, text.toLowerCase().includes(axis))
  }
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-deep-link.log…')
  const { app, close } = await launchOnFixture('e2e-deep-link.log', { spells: true })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepReady(page)
    if (await openMobPage(page)) {
      // Give the client spell table its one-off parse before reading the card.
      await settle(() => textOf(page, CARD), (t) => !t.includes('Reading what'), { timeoutMs: 30_000 })
      const card = await textOf(page, CARD)
      note(`card: ${card.slice(0, 200)}`)
      const populated = !card.includes('Spell data unavailable')
      if (!populated) {
        note('no client spells_us.txt on this machine - asserting the degraded branch instead')
        await stepNoSpellData(page)
      } else {
        await stepFiveRows(page)
        await stepNumbers(page)
        await stepThinRow(page)
        await stepEvidence(page)
      }
      await stepNoAcronyms(page, populated)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    await dumpArtifacts(page, failures.length ? 'mob-resists-FAIL' : 'mob-resists-pass')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
