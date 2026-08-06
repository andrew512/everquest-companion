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
  countOf,
  listedValues,
  note,
  openPicker,
  sleep,
  snapshot
} from './appHarness.mjs'
import { meterRows } from './drill.mjs'

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

// ── THE ROUNDS PANEL (docs/plans/attack-round-stats.md) ────────────────────────────────
//
// The grouper, the tiers and every word of the tooltips are pinned in
// tests/combatRoundStats.test.mts + tests/roundRows.test.mts against real log windows. What
// only the real app can show is that the panel MOUNTS inside the drill and states something:
// it lives one level down (the drilled source's breakdown), so a wiring mistake would leave it
// invisible with every unit test still green.
//
// FLOORS ONLY (AGENTS.md: frozen numbers rot). The live log decides how many verbs the
// selected fight used, so this asserts "at least one stated lane, with its denominator on
// screen" and notes rather than fails when the selection has no swings at all.

const ROUNDS = '[data-testid="rounds-panel"]'
const ROUNDS_LANE = '[data-testid="rounds-lane"]'

export async function stepRoundsPanel(page: Page): Promise<void> {
  // The dashboard opens on your breakdown, but a run that arrives here un-drilled (no fight of
  // yours in the selection) has to drill itself before the panel can exist at all.
  if ((await inMeterPanel(page, ROUNDS)) === 0 && (await inMeterPanel(page, '[data-testid="drill-back"]')) === 0) {
    await page.click('[data-testid="meter-row"]', { timeout: 15_000 }).catch(() => undefined)
    await sleep(600)
  }
  const lanes = await inMeterPanel(page, ROUNDS_LANE)
  if ((await inMeterPanel(page, ROUNDS)) === 0) {
    note('the drilled source landed no swings in this selection — the Rounds panel correctly renders nothing')
    return
  }
  check('the Rounds panel mounts inside the combat drill', true)
  check('…with at least one stated round lane', lanes >= 1, `${lanes} lanes`)
  const text = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return (el as HTMLElement | null)?.innerText ?? ''
  }, ROUNDS)
  // The denominator is on screen, in rounds — law 11's spirit, and the one thing the design
  // insists the panel can never omit.
  check('…and its denominator is visible, in ROUNDS', /\brounds\b/i.test(text), text.slice(0, 120).replace(/\s+/g, ' '))
  check('…and it states a multi-swing rate for its lanes', /%\s*multi/i.test(text), text.slice(0, 160).replace(/\s+/g, ' '))
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

/**
 * 6b. THE METER SCOPE — You / Group / Everyone (docs/plans/group-model.md §2), a different axis
 * from the Fight|Overall toggle: that one says WHICH segment, this one says WHOSE damage in it.
 *
 * THE ROSTER STATE IS NOT ASSERTED, because it belongs to whatever the live log happens to
 * contain: a log with group lines in it leaves `seen: true`, one without leaves `seen: false`,
 * and both are correct. What IS asserted is that the chip and the popover AGREE about which of
 * the two it is — the pairing is the identity, and it is the one that can actually break. They
 * are separate sentences derived from one flag, and a Group scope silently narrowing while the
 * popover says it is showing everyone is precisely the lie this surface exists to prevent.
 */
export async function stepMeterScope(page: Page): Promise<void> {
  const chip = '[data-testid="meter-scope-chip"]'
  check('the meter scope chip is on the combat toolbar', (await countOf(page, chip)) === 1)

  const label = async (): Promise<string> => (await page.textContent(chip))?.trim() ?? ''

  // The default is Group either way — any fallback shows up in the chip's own words, never as a
  // different scope silently selected for you.
  const first = await label()
  const noRoster = first === 'Group (no roster yet)'
  check('it defaults to Group', first === 'Group' || noRoster, first)
  const baseline = await meterRows(page)

  // One click per scope, all the way round. The cycle is the whole control on this surface.
  await page.click(chip)
  await sleep(300)
  check('clicking cycles Group to Everyone', (await label()) === 'Everyone', await label())
  const everyone = await meterRows(page)
  check('Everyone shows at least what Group did', everyone >= baseline, `${everyone} vs ${baseline}`)

  await page.click(chip)
  await sleep(300)
  check('clicking again cycles Everyone to You', (await label()) === 'You', await label())
  // NO SCOPE EVER HIDES YOU OR YOUR PETS. The live log is the owner's own, so the rows here are
  // his and his pets' — they must survive every scope, and only a member row may ever go.
  const you = await meterRows(page)
  check('You scope keeps your own rows — only a member is ever filtered', you >= 1 && you <= everyone, `${you} of ${everyone}`)

  // PERSISTED PER SURFACE: the choice survives leaving the tab and coming back, because it is a
  // stored preference and not component state.
  await page.click('[data-testid="nav-overview"]')
  await sleep(400)
  await page.click('[data-testid="nav-combat"]')
  await sleep(1200)
  check('the scope is remembered across a tab round trip', (await label()) === 'You', await label())

  // The roster popover (G3) — the answer to "who does the app think is with me, and why".
  await page.click('[data-testid="roster-open"]')
  await sleep(400)
  check('the roster popover opens from the chip', (await countOf(page, '[data-testid="roster-popover"]')) === 1)
  const popover = (await page.textContent('[data-testid="roster-popover"]'))?.toLowerCase() ?? ''
  check('…and offers the add box for the join line the log never carried', popover.includes('add'))
  if (popover.includes('nobody on the roster') || popover.includes('no group signal')) {
    // THE PAIRING. An empty roster says which KIND of empty it is, and the sentence has to match
    // the chip: `seen: false` falls back to Everyone (law 1), `seen: true` means the group ended
    // and Group really is narrowing to you and your pets.
    check(
      'the empty roster and the chip tell the same story',
      noRoster ? popover.includes('no group signal') : popover.includes('nobody on the roster'),
      `chip=${first} · popover=${popover.slice(0, 70)}`
    )
    check(
      '…and only the law-1 fallback claims to be showing everyone',
      noRoster ? popover.includes('showing everyone') : !popover.includes('showing everyone'),
      popover.slice(0, 90)
    )
  } else {
    note('the live log left real members on the roster — the empty-state wording was not exercised')
  }

  // Close the popover and leave the surface on its default, so nothing downstream inherits a
  // narrowed meter. Bounded: three clicks is a full cycle, whatever it is on now.
  await page.keyboard.press('Escape')
  await sleep(200)
  for (let i = 0; i < 3 && !(await label()).startsWith('Group'); i++) {
    await page.click(chip)
    await sleep(250)
  }
  check('the meter is left on its Group default', (await label()).startsWith('Group'), await label())
}
