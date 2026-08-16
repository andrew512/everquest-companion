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
// AND THE CARD NO LONGER WITHHOLDS AN ANSWER (owner ruling, 2026-08-16, landed with JOS-383). The
// n >= 5 floor this spec was first written against is gone: an axis with any observation prints its
// tag, its number, its interval and its count, with a quieter "low samples" caveat below ten, and
// only an empty axis says "no data". `stepThinRow` is where that shows.
//
// AND THE THIRD EVIDENCE FAMILY HAS ITS OWN LINE (JOS-385). Charmed pets and NPC casters are
// folded like any other observation and a preference decides whether the estimator weighs them, so
// the two things this spec has to see are the LINE on the drilldown and the SWITCH that changes
// what it says. The switch is the only claim here no unit test can make: that the preference the
// card reads is the preference the Preferences pane writes.
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

/**
 * THE TWO STATES A ROW CAN BE IN THAT ARE NOT A FULL ANSWER (owner ruling, 2026-08-16, JOS-383).
 *
 * The card used to refuse a number under five observations and print "not enough data (n=2)". It
 * does not any more: an axis with ANY observation reports its tag, its number, its interval and its
 * count, and merely wears a quieter "low samples" caveat below ten. So there are exactly two things
 * to check here, and both are about a row that is drawn rather than omitted:
 *   * an EMPTY axis (nothing ever cast at this mob on it) says "no data" — a real answer, printed
 *     as one, rather than a missing row or a zero;
 *   * a THIN axis keeps its whole answer AND says it is standing on very little.
 * Which of the two this mob offers depends on the committed baseline, so each is checked when it
 * is there and noted when it is not.
 */
async function stepThinRow(page: Page): Promise<void> {
  const empty = await countOf(page, '[data-testid^="resist-empty-"]')
  if (empty === 0) note('every axis on this mob has some evidence - no empty row to check on this build')
  else {
    const text = await textOf(page, '[data-testid^="resist-empty-"]')
    check('an axis nothing was ever cast at says so, in two words', text === 'no data', text)
  }
  const low = await countOf(page, '[data-testid^="resist-low-"]')
  if (low === 0) {
    note('no axis on this mob is under the low-sample line - nothing to caveat on this build')
    return
  }
  const caveat = await textOf(page, '[data-testid^="resist-low-"]')
  check('a thin axis is QUALIFIED, never replaced', /low samples/.test(caveat), caveat)
  // …and the answer it qualifies is still on the row: the whole point of the ruling.
  const axis = (await page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute('data-testid') ?? '',
    '[data-testid^="resist-low-"]'
  )).replace('resist-low-', '')
  const value = await textOf(page, `[data-testid="resist-value-${axis}"]`)
  check(`…with its number and interval still printed (${axis})`, /^R \d+ \(\d+-\d+\)$/.test(value), value)
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

/**
 * THE npc EVIDENCE LINE, AND THE SWITCH THAT DECIDES WHETHER IT COUNTS (JOS-385).
 *
 * A zol ghoul knight's shipped rows carry 131 observations from creatures rather than people —
 * frost daggers, ghoul roots and tainted breaths thrown by other undead in the same rooms — spread
 * across four of the five axes. So this mob can say both halves of the feature on one page.
 *
 * The claim is deliberately about the LINE and not about the number: what a user has to be able to
 * see is how much of a cell came from something that is not a person, and whether it counted. The
 * arithmetic behind it is pinned in tests/resistNpcFamily.test.mts.
 */
async function stepNpcEvidence(page: Page): Promise<string | null> {
  // Cold is the axis whose npc rows are thickest on this mob (two frost dagger rows).
  const line = '[data-testid="resist-npc-cold"]'
  await page.click('[data-testid="resist-expand-cold"]', { timeout: 15_000 })
  if (!(await appears(page, '[data-testid="resist-evidence-cold"]', 10_000))) {
    check('the cold row expands', false)
    return null
  }
  if ((await countOf(page, line)) === 0) {
    note('no creature-cast evidence on cold in this build of the baseline - nothing to check')
    return null
  }
  const text = await textOf(page, line)
  check('the card names what pets and other creatures contributed', /Pets and other creatures: \d+ casts?/.test(text), text)
  check('…and does not say it was left out, because the switch ships ON', !text.includes('not included'), text)
  return await textOf(page, '[data-testid="resist-value-cold"]')
}

/**
 * The switch, end to end: Preferences → Combat → off, back to the mob page, and the SAME line now
 * says the family was not included. This is the one claim no unit test can make — that the
 * preference the card reads is the preference the pane writes.
 */
async function stepSwitchOff(page: Page, before: string | null): Promise<void> {
  await page.click(NAV_MOBS, { timeout: 15_000 }) // leave the page so the card re-reads on return
  await page.click('[data-testid="nav-preferences"]', { timeout: 30_000 })
  if (!(await appears(page, '[data-testid="prefs-rail-combat"]', 20_000))) {
    check('Preferences offers its Combat section', false)
    return
  }
  await page.click('[data-testid="prefs-rail-combat"]')
  const toggle = '[data-testid="pref-resist-npc-casters"] input'
  if (!(await appears(page, toggle, 15_000))) {
    check('the Combat section carries the resist-evidence switch', false)
    return
  }
  check('the switch ships ON', await page.isChecked(toggle))
  await page.click('[data-testid="pref-resist-npc-casters"]', { timeout: 15_000 })
  check('and it can be turned off', !(await page.isChecked(toggle)))

  if (!(await openMobPage(page))) return
  await settle(() => textOf(page, CARD), (t) => !t.includes('Reading what'), { timeoutMs: 30_000 })
  await page.click('[data-testid="resist-expand-cold"]', { timeout: 15_000 })
  if (!(await appears(page, '[data-testid="resist-npc-cold"]', 10_000))) {
    check('the creature-cast line survives the switch', false)
    return
  }
  const text = await textOf(page, '[data-testid="resist-npc-cold"]')
  // DECLINED, NOT DELETED: the count is still there and the parenthesis carries the difference.
  check('with the switch off the same line says the family was not included', text.includes('(not included)'), text)
  check('…and it still states the count, so the user can see what they turned off', /\d+ casts?/.test(text), text)
  if (before === null) return
  const after = await textOf(page, '[data-testid="resist-value-cold"]')
  check(`the cold number is re-derived from the smaller evidence (${before} -> ${after})`, after !== before, `${before} vs ${after}`)
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
      if (populated) {
        const coldBefore = await stepNpcEvidence(page)
        await stepSwitchOff(page, coldBefore)
      }
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
