// respawnRound7Steps — THE TWO TAB-ONLY RULINGS OF JOS-194 ROUND 7.
//
// Its own module for the reason `buffRestartSteps.mts` and `buffTimerSteps.mts` are: the spec that
// uses it (`respawn-timers.e2e.mts`) is at the repo's 400-code-line factoring ceiling, and these
// two steps are a narrative of their own — they need no second renderer at all.
//
// WHAT THEY ARE FOR. The owner killed "Your watches", the list at the bottom of the Timers tab, and
// moved both of the things it held onto the mob's Running entry; and he asked for Recently killed to
// become searchable. The pure halves are pinned in tests/respawnWorking.test.mts. What only the real
// app can show is that both are WIRED:
//
//   * TYPING A NUMBER ON A CLOCK ROW travels the whole path — the field writes over IPC, main
//     normalizes and PERSISTS it, the module re-numbers the row from rung 1 and pushes its own
//     revision, and the row the box sits on comes back saying the number is yours. A build that
//     kept the value in the component passes every unit test and fails here.
//   * TYPING IN THE SEARCH narrows the list the module published, and a query matching nothing says
//     so rather than reading as an empty log.
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read goes through `settle`.

import type { Page } from 'playwright-core'
import { check, countOf, settle } from './appHarness.mjs'

/** The seconds box that moved onto the clock row when "Your watches" died. */
function customBox(mob: string): string {
  return `[data-testid="respawn-row"][data-respawn-mob="${mob}"] [data-testid="respawn-custom"] input`
}

/**
 * Commit the seconds box the way a user does — by leaving it. Driven rather than clicked somewhere
 * else on purpose: a click would move the POINTER onto whatever it landed on, and the hover-card
 * step that runs later asserts no card is open before it points at anything.
 */
function blurActive(page: Page): Promise<void> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()
  })
}

/** One clock as the tab draws it — the spec's own reading, narrowed to what these steps assert. */
interface RowRead {
  mob: string
  source: string
  text: string
}

function rows(page: Page, testid: string): Promise<RowRead[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => ({
        mob: e.getAttribute('data-respawn-mob') ?? '',
        source: e.getAttribute('data-respawn-source') ?? '',
        text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      })),
    testid
  )
}

const find = (list: RowRead[], mob: string): RowRead | undefined => list.find((r) => r.mob === mob)

/**
 * RUNG 1 IS TYPED ON THE MOB (ruling 2).
 *
 * IT IS CLEARED AGAIN at the end, which is both the documented behaviour of an empty box (the
 * ladder falls back to your kills) and what leaves the mob numbered as the steps after it expect.
 */
export async function stepCustomOnTheMob(
  page: Page,
  mob: string,
  readWatches: (p: Page) => Promise<{ watches: { key: string; customSec?: number }[] }>
): Promise<void> {
  check('a running clock carries its own seconds box', (await countOf(page, customBox(mob))) === 1)

  await page.fill(customBox(mob), '90')
  // Blur is what commits — the same contract the retired editor had, and the reason a half-typed
  // number never reaches the store.
  await blurActive(page)
  const custom = await settle(() => rows(page, 'respawn-row'), (r) => find(r, mob)?.source === 'custom', {
    timeoutMs: 30_000
  })
  const row = find(custom, mob)
  if (!check('typing a number on the row re-numbers its clock', row?.source === 'custom', JSON.stringify(custom))) {
    return
  }
  check('…and says the number is yours rather than the wiki’s or the fold’s', row.text.includes('your number'), row.text)
  check('…for the duration that was typed', row.text.includes('1m 30s'), row.text)
  const prefs = await readWatches(page)
  check(
    '…and it was PERSISTED through the same door the retired list used',
    prefs.watches.some((w) => w.key === mob && w.customSec === 90),
    JSON.stringify(prefs)
  )

  // EMPTY CLEARS IT, and the ladder falls back to the gap this fold measured.
  await page.fill(customBox(mob), '')
  await blurActive(page)
  const back = await settle(() => rows(page, 'respawn-row'), (r) => find(r, mob)?.source === 'observed', {
    timeoutMs: 30_000
  })
  check('clearing it falls back to your kills', find(back, mob)?.source === 'observed', JSON.stringify(back))
}

/** Type into the Recently-killed search. `fill` sets the value without moving the pointer. */
function search(page: Page, text: string): Promise<void> {
  return page.fill('[data-testid="respawn-search"] input', text, { timeout: 15_000 })
}

/**
 * RECENTLY KILLED IS SEARCHABLE (ruling 4).
 *
 * It leaves the box EMPTY, because the steps after it click Watch on candidates this one can hide.
 */
export async function stepSearchRecentlyKilled(page: Page, keep: string, drop: string): Promise<void> {
  const all = await settle(() => countOf(page, '[data-testid="respawn-candidate"]'), (n) => n >= 2, {
    timeoutMs: 20_000
  })

  await search(page, 'wan ghoul')
  const narrowed = await settle(() => rows(page, 'respawn-candidate'), (r) => r.length < all, { timeoutMs: 20_000 })
  check('typing narrows Recently killed', narrowed.length < all, JSON.stringify({ all, narrowed }))
  check('…to the mob that was typed', find(narrowed, keep) !== undefined, JSON.stringify(narrowed))
  check('…and the one that was not is gone', find(narrowed, drop) === undefined, JSON.stringify(narrowed))

  await search(page, 'zzzznothing')
  const empty = await settle(
    () => page.evaluate(() => document.querySelector('[data-testid="respawn-recent-empty"]')?.textContent ?? ''),
    (t) => t.length > 0,
    { timeoutMs: 20_000 }
  )
  check('a query that matches nothing says so, rather than reading as an empty log', empty.includes('No kills match'), empty)

  await search(page, '')
  const restored = await settle(() => countOf(page, '[data-testid="respawn-candidate"]'), (n) => n === all, {
    timeoutMs: 20_000
  })
  check('clearing the box brings every candidate back', restored === all)
}
