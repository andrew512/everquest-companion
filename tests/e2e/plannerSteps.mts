// STEPS AND SELECTORS OF THE EXALTATIONS SPEC that live next door, because planner.e2e.mts sits
// AT the repo max-lines budget and the rule here is to SPLIT, never ratchet (drill.mts set the
// precedent, combatSteps.mts followed it). The spec still owns the ORDER and the launch.
//
// WHAT LIVES HERE, and why it is a coherent half rather than an overflow bin:
//   * every `planner-*` SELECTOR, so one file names the DOM and the two halves cannot drift into
//     two spellings of the same testid, and
//   * the four steps that measure THE EFFECT LIST — the era filter, the non-equippable escape
//     hatch, the focus-family fold and JOS-42's readability — which are all the same
//     measurement (how tall is the list, what is on its rows) asked four ways, plus the DOM
//     helpers that measurement needs.
//
// Everything downstream of "a donor has been added" — the Inventory tab, the host picker, the
// socket preset, the Farm rollup and the Loot deep link — stays in the spec, because those steps
// navigate between modes and the ordering between them IS the test.

import type { Page } from 'playwright-core'
import { check, countOf, note, sleep } from './appHarness.mjs'

export const NAV = '[data-testid="nav-planner"]'
export const VIEW = '[data-testid="planner-view"]'
export const NEW_SET_EMPTY = '[data-testid="planner-new-set-empty"]'
export const SET_CHIP = '[data-testid="planner-set-chip"]'
export const EFFECT_LIST = '[data-testid="planner-effect-list"]'
export const ERA_TOGGLE = '[data-testid="planner-era-toggle"]'
export const ADD_BUTTON = '[data-testid="planner-add"]:not([disabled])'
export const MODE_BOARD = '[data-testid="planner-mode-inventory"]'
export const MODE_FARM = '[data-testid="planner-mode-farm"]'
export const MODE_EFFECTS = '[data-testid="planner-mode-effects"]'
export const BOARD = '[data-testid="planner-board"]'
export const BOARD_CELL = '[data-testid="planner-board-cell"]'
export const SOCKET_LINE = '[data-testid="planner-socket-line"]'
export const HOST_SEARCH = '[data-testid="planner-host-search"] input'
export const HOST_HIT = '[data-testid="planner-host-hit"]'
export const HOST_NAME = '[data-testid="planner-host-name"]'
export const HOST_WORN = '[data-testid="planner-host-worn"]'
export const INVENTORY_HELP = '[data-testid="planner-inventory-help"]'
export const SOCKET_BROWSE = '[data-testid="planner-socket-browse"]'
export const PRESET_CHIP = '[data-testid="planner-preset-chip"]'
export const EXPLAINER = '[data-testid="planner-explainer"]'
export const EXPLAINER_OPEN = '[data-testid="planner-explainer-open"]'
export const STATE_CHIP = '[data-testid="planner-state-chip"]'
export const FARM_LIST = '[data-testid="planner-farm-list"]'
export const FARM_ROW = '[data-testid="planner-farm-row"]'
export const NONEQUIP_TOGGLE = '[data-testid="planner-nonequip-toggle"]'
export const NOSLOT_CHIP = '[data-testid="planner-noslot-chip"]'
export const DONOR_NAME = '[data-testid="planner-donor-name"]'
/** JOS-42 — the freshness line at the top of the Inventory tab. */
export const INVENTORY_FRESH = '[data-testid="planner-inventory-fresh"]'
/** JOS-42 — the expansion named beside an out-of-era zone in a farm row's "also:" tail. */
export const FARM_ALSO_ERA = '[data-testid="planner-farm-also-era"]'
/** JOS-42 — a farm heading that names a zone from a later expansion. Never present with the
 *  era filter on: that is the whole invariant the refinement installed. */
export const FARM_GROUP_OUT_OF_ERA = '[data-testid="planner-farm-group"][data-out-of-era="true"]'

/**
 * A GROUP HEADER — one per group on whatever axis the tab is grouped by, and expanding it lists
 * that group's donors. The testid predates V4's grouping model and still says "effect" because the
 * effect axis is still what every tab but Focus opens on; `data-axis` is how a spec asks which
 * fold it is actually looking at.
 */
export const EFFECT_ROW = '[data-testid="planner-effect-row"]'
export const FAMILY_ROW = '[data-testid="planner-effect-row"][data-axis="family"]'
export const GROUPBY = '[data-testid="planner-groupby"]'
export const SOCKET_FOCUS = '[data-testid="planner-socket-focus"]'
export const SOCKET_PROC = '[data-testid="planner-socket-proc"]'
export const BEST_CHIP = '[data-testid="planner-best-chip"]'
export const DONOR_ROW = '[data-testid="planner-donor-row"]'
export const EFFECT_SAYS = '[data-testid="planner-effect-says"]'
/** JOS-42 — the family header's copy of the line every row under it shares. */
export const GROUP_SAYS = '[data-testid="planner-group-says"]'
/** JOS-42 — the effect name ON a donor row (drawn on every axis but `effect`). */
export const DONOR_EFFECT = '[data-testid="planner-donor-effect"]'

// ---- DOM measurements ------------------------------------------------------------------

/** Rendered text of the first match; '' when the node isn't mounted. */
export function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Box + scroll geometry — enough to prove a growing list is a BOUNDED scroller. */
export function boxOf(
  page: Page,
  sel: string
): Promise<{ h: number; scrollH: number; clientH: number } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    return { h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }, sel)
}

/**
 * How many matching nodes are ELLIPSIZED — `scrollWidth` past `clientWidth` on a `noWrap` line.
 *
 * The measurement JOS-42 turns on: the owner's screenshot showed "Burning Af…" and "String
 * Resonan…" on every donor of a focus family, and the fix is a layout one (the row stopped
 * repeating the family's one-liner, and the source text now shrinks ~99% before the effect name
 * gives up a pixel). Only a browser can say whether text fits, so only the e2e can assert it.
 * The 1px slack is sub-pixel rounding, not tolerance for a truncated word.
 */
export function truncated(page: Page, sel: string): Promise<{ total: number; clipped: string[] }> {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s))
    return {
      total: els.length,
      clipped: els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e as HTMLElement).innerText)
    }
  }, sel)
}

/** Poll a predicate until it holds or the deadline passes. */
export async function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    if (await fn()) return true
    if (Date.now() - t0 >= ms) return false
    await sleep(300)
  }
}

/**
 * The effect list's SCROLL HEIGHT — the total row count, in pixels.
 *
 * Not a count of rows in the DOM: the list is windowed, so the number of mounted rows says how
 * tall the viewport is, not how many rows exist. And it POLLS for the element, because the view
 * legitimately remounts while the app is still reading the log (App keys the view on the
 * character), and a measurement taken inside that gap would read as "the list vanished".
 */
export async function listHeight(page: Page): Promise<number> {
  let last = 0
  await until(async () => {
    last = (await boxOf(page, EFFECT_LIST))?.scrollH ?? 0
    return last > 0
  }, 20_000)
  return last
}

/** Poll until the list's height settles at something other than `was` (or give up and report). */
async function heightAfterToggle(page: Page, was: number): Promise<number> {
  let now = was
  await until(async () => {
    now = await listHeight(page)
    return now !== was
  }, 15_000)
  return now
}

// ---- the four steps that measure the effect list ----------------------------------------

/**
 * 4. THE ERA FILTER IS ON BY DEFAULT, AND TURNING IT OFF REVEALS MORE.
 *
 * This is an identity, not a number: the committed corpus documents every expansion, so a filter
 * that is genuinely hiding out-of-era donors must have a SHORTER list than the same filter off,
 * and switching it back must land on exactly the height it started at.
 */
export async function stepEra(page: Page): Promise<void> {
  if (!check('the effect browser offers the current-era filter', (await countOf(page, ERA_TOGGLE)) > 0)) return
  const filtered = await listHeight(page)

  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const unfiltered = await heightAfterToggle(page, filtered)
  check(
    'the era filter is ON by default and hides out-of-era donors (turning it off can only reveal more)',
    unfiltered > filtered,
    `list ${String(filtered)}px filtered → ${String(unfiltered)}px unfiltered`
  )

  // Put it back: the rest of the run should see the default surface.
  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, unfiltered)
  check('…and switching it back on restores exactly the filtered list', again === filtered, `${String(again)}px`)
}

/**
 * 4b. THE NON-EQUIPPABLE FILTER IS OFF BY DEFAULT, AND TURNING IT ON REVEALS MORE.
 *
 * The mirror image of the era check, and an identity for the same reason: R2 only lets an
 * exaltation move between items sharing an equipment slot, so the 284 slotless donor rows in the
 * committed corpus (the potion aisle, plus poisons on the Proc tab) can never legally donate and
 * are hidden by default. Switching the escape hatch on can therefore only ADD rows — and each one
 * it adds must carry the `no slot` chip that says why it was hidden.
 */
export async function stepNonEquip(page: Page): Promise<void> {
  if (!check('the effect browser offers the non-equippable escape toggle', (await countOf(page, NONEQUIP_TOGGLE)) > 0)) {
    return
  }
  const hidden = await listHeight(page)
  check('slotless donors are hidden by default, so no row claims "no slot"', (await countOf(page, NOSLOT_CHIP)) === 0)

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const shown = await heightAfterToggle(page, hidden)
  check(
    'turning non-equippable ON can only reveal more donors (R2 hides them, it never invents them)',
    shown > hidden,
    `list ${String(hidden)}px equippable-only → ${String(shown)}px with consumables`
  )

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, shown)
  check('…and switching it back off restores exactly the equippable list', again === hidden, `${String(again)}px`)
}

/**
 * 4c-ii. A FAMILY'S ROWS ARE READABLE — the effect NAME always fits (JOS-42 refinement 2).
 *
 * Two halves of one fix, and both are identities rather than numbers. The one-liner every rank of
 * a family shares moves UP to the header, so with a family open exactly one of the two carries it
 * — never both, which is the duplication that was eating the row. And with that width handed back,
 * no effect name on screen may be ellipsized: "Improved Healing III" is not "Improved Healing I",
 * and a row that truncates it is a row you cannot read.
 */
async function stepFamilyReadability(page: Page): Promise<void> {
  const header = await countOf(page, GROUP_SAYS)
  const rows = await countOf(page, EFFECT_SAYS)
  check(
    'the family header states the line its rows share, and then the rows do not repeat it',
    header === 0 || rows === 0,
    `${String(header)} header lines · ${String(rows)} row lines`
  )
  const names = await truncated(page, DONOR_EFFECT)
  check(
    'every effect name under a family header renders whole (it outranks the source text now)',
    names.total > 0 && names.clipped.length === 0,
    names.clipped.length > 0
      ? `${String(names.clipped.length)} of ${String(names.total)} clipped — e.g. "${names.clipped[0]}"`
      : `${String(names.total)} names, none clipped`
  )
}

/**
 * 4c. THE FOCUS TAB OPENS ON FAMILIES, AND THE BEST OF EACH IS CROWNED (V4 + V5).
 *
 * Two facts in one trip. The GROUPING is a per-socket default, not a global one: Proc opens on
 * effects (the browser's original fold) and Focus opens on families, because "the best Improved
 * Healing I can reach" is the question that tab exists to answer. And the CROWN is derived from
 * what survived the filters, so it can be asserted as an identity — every family header has at
 * least one donor, therefore expanding one must produce at least one crowned row.
 *
 * Skipped, with a note, when this set's classes leave the Focus tab empty: focus effects are
 * caster gear, and a melee trio filtering the tab down to nothing is a correct answer, not a
 * failure. Ends back on the Proc tab so every step after it sees the surface it expects.
 */
export async function stepFocusFamilies(page: Page): Promise<void> {
  if (!check('the effect browser offers a group-by control', (await countOf(page, GROUPBY)) > 0)) return
  await page.click(SOCKET_FOCUS, { timeout: 15_000 })
  const grouped = await until(async () => (await countOf(page, FAMILY_ROW)) > 0, 20_000)
  if (grouped) {
    check(
      'the Focus tab groups by focus family without being asked (the per-socket default)',
      (await textOf(page, GROUPBY)).includes('Focus family'),
      `${String(await countOf(page, FAMILY_ROW))} family headers`
    )
    await page.click(FAMILY_ROW, { timeout: 15_000 })
    check(
      'expanding a family crowns the best tier it can currently see',
      await until(async () => (await countOf(page, BEST_CHIP)) > 0, 10_000)
    )
    await stepFamilyReadability(page)
  } else {
    note('no focus donor survives this set’s class filter — the family grouping step is skipped this run')
  }
  await page.click(SOCKET_PROC, { timeout: 15_000 })
  await until(async () => (await countOf(page, `${EFFECT_ROW}[data-axis="effect"]`)) > 0, 20_000)
}
