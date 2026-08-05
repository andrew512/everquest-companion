// STEPS OF THE COMBAT-DASHBOARD SPEC that live next door, because combat-dashboard.e2e.mts sits
// AT the repo max-lines budget and the rule here is to split, never ratchet (drill.mts set the
// precedent). Each function below is one numbered step of that run, moved verbatim except where
// noted; the spec still owns the ORDER.
//
// ── THE COMBAT TAB'S HEALING DIMENSION, end to end (P2 of docs/plans/combat-overlay-parity.md —
// owner ruling: "the combat panel lacks the overlay's HEAL functionality — parity").
//
// The builder and every word it prints are pinned purely in tests/healRows.test.mts, including
// the one-builder seam that keeps the panel and the floating heal overlays rendering from the
// same function. What only the real app can show is that the third position of the direction
// filter is WIRED: the panel swaps to a healing list, its headline switches units to `hps` (a
// heal rate must never be readable as dps), and the copy affordance — which serializes damage
// tables only — stands down rather than putting the wrong view on the clipboard.
//
// The CONTENT is log-dependent (a session with no heals legitimately renders the quiet empty
// state), so nothing here asserts rows — only that the dimension exists and behaves.

import type { Page } from 'playwright-core'
import {
  check,
  closePicker,
  listedValues,
  note,
  openPicker,
  sleep,
  snapshot
} from './appHarness.mjs'

const TOGGLE = '[data-testid="direction-toggle"]'

/**
 * The METER panel alone. TWO cards share the `dash-panel` testid, and the tab header carries an
 * outgoing-dps headline of its own — so a whole-page read could never tell a heal panel from a
 * damage one. The meter body is the unambiguous anchor; its enclosing panel is the subject.
 */
function meterPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="meter-body"]')?.closest('[data-testid="dash-panel"]')
    return (el as HTMLElement | null)?.innerText ?? ''
  })
}

/** How many of `sel` live inside that same panel. */
function inMeterPanel(page: Page, sel: string): Promise<number> {
  return page.evaluate(
    (s) =>
      document
        .querySelector('[data-testid="meter-body"]')
        ?.closest('[data-testid="dash-panel"]')
        ?.querySelectorAll(s).length ?? 0,
    sel
  )
}

export async function stepHealingDimension(page: Page): Promise<void> {
  await page.click(`${TOGGLE} button[value="heal"]`, { timeout: 15_000 })
  await sleep(600)
  const panel = await meterPanelText(page)
  check('the meter panel offers a HEALING dimension beside Outgoing/Incoming', panel.length > 0)
  check(
    '…whose headline is an hps rate, never a dps one (one formatter, its own unit word)',
    /\bhps\b/.test(panel) && !/\bdps\b/.test(panel),
    panel.slice(0, 140).replace(/\s+/g, ' ')
  )
  check(
    '…and which offers no copy button (copyText serializes damage tables only)',
    (await inMeterPanel(page, '[data-testid="copy-view"]')) === 0
  )

  // Back to Outgoing so every later step sees the panel it expects — and so the switch is proved
  // to work in both directions rather than being a one-way trip.
  await page.click(`${TOGGLE} button[value="out"]`, { timeout: 15_000 })
  await sleep(500)
  check('…and switching back to Outgoing restores the damage meter', /\bdps\b/.test(await meterPanelText(page)))
}

// ── THE OPEN FIGHT LIST IS FROZEN (Task #61) ───────────────────────────────────────────

export async function stepFrozenList(page: Page): Promise<void> {
  // 10b. FROZEN WHILE OPEN (Task #61, the churn fix). The snapshot ticks ~4x/sec while the
  //      user is fighting, and every tick rebuilds the option rows: a fight finalizes, the head
  //      row relabels itself from "Current fight (live)" to "Last fight — …", the old head drops
  //      into the history under its own id, and every row below shifts down one. That is what
  //      "it gets all confused as it's switching" was. The contract now is that the OPEN list is
  //      a snapshot taken at open time — no reorder, no insert, no removal — so what is under
  //      your pointer stays under your pointer.
  //
  //      This can only PROVE anything while the log is actually moving (a quiet log churns
  //      nothing, so an unchanged list is vacuous), hence: assert when busy, note when quiet —
  //      the same convention step 8 uses for the live tail.
  await openPicker(page)
  const frozenBefore = await listedValues(page)
  const churnA = await snapshot(page)
  await sleep(3000)
  const frozenAfter = await listedValues(page)
  const churnB = await snapshot(page)
  // "Busy" = the engine's own view of the world moved underneath the open list: a fight is
  // open, the fight count changed, or the selected segment's damage grew.
  const busy =
    !!churnB.segments.find((s) => s.kind === 'current') ||
    churnA.segments.length !== churnB.segments.length ||
    (churnA.selected?.outTotal ?? 0) !== (churnB.selected?.outTotal ?? 0)
  const sameList =
    frozenBefore.length === frozenAfter.length && frozenBefore.every((v, i) => v === frozenAfter[i])
  if (busy) {
    check(
      'the OPEN fight list is frozen — 3s of live ticks change neither its rows nor their order',
      sameList,
      `${frozenBefore.length} rows → ${frozenAfter.length} rows${sameList ? '' : ` (was ${frozenBefore.slice(0, 4).join(',')} · now ${frozenAfter.slice(0, 4).join(',')})`}`
    )
  } else {
    note(
      `the log was quiet across the 3s freeze window (${frozenBefore.length} rows, unchanged) — nothing could have churned, so the freeze is not asserted this run`
    )
  }
  await closePicker(page)
}
