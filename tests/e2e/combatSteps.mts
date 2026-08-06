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
  settle,
  settleCount,
  settleGone,
  snapshot,
  type Snap
} from './appHarness.mjs'
import { drilled, meterRows } from './drill.mjs'
import { PULL_DAMAGE, PULL_LINES, PULL_TARGET, playPull } from './gameplay.mjs'
import type { FixtureLog } from './logFixture.mjs'

const TOGGLE = '[data-testid="direction-toggle"]'

/**
 * A toggle-button group's selected index, 1-based — the CONDITION a click on one produces.
 *
 * MUI marks the pressed button both ways (`aria-pressed` and `Mui-selected`); reading either keeps
 * a styling-only change from silently passing. Returns 0 when nothing in the group is selected,
 * which is what a group that has not rendered yet looks like.
 */
function selectedIndex(page: Page, testid: string): Promise<number> {
  return page.evaluate((id) => {
    const buttons = [...document.querySelectorAll(`[data-testid="${id}"] button`)]
    return (
      buttons.findIndex(
        (b) => b.getAttribute('aria-pressed') === 'true' || b.classList.contains('Mui-selected')
      ) + 1
    )
  }, testid)
}

/**
 * Click one position of a toggle group and WAIT FOR IT TO BE THE SELECTED ONE.
 *
 * This replaces the suite's most common bet — `click(); sleep(800)` — with the state the click was
 * supposed to produce. Selection here crosses a React state update and, for the scope toggle, a
 * store write and a re-resolved selection, so it is a wait by nature; the old sleep was simply a
 * guess at how long that takes on an unloaded machine.
 */
export async function clickToggle(page: Page, testid: string, index: number): Promise<boolean> {
  await page.click(`[data-testid="${testid}"] button:nth-child(${String(index)})`, { timeout: 15_000 })
  return (await settle(() => selectedIndex(page, testid), (n) => n === index, { timeoutMs: 10_000 })) === index
}

/** Fight | Overall. 1 = Fight, 2 = Overall. */
export const clickScope = (page: Page, index: 1 | 2): Promise<boolean> => clickToggle(page, 'scope-toggle', index)

/** Dashboard | Timeline. 1 = Dashboard, 2 = Timeline. */
export const clickView = (page: Page, index: 1 | 2): Promise<boolean> => clickToggle(page, 'view-toggle', index)

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
  // The condition is the panel having SWAPPED units — the healing list is the whole claim.
  const panel = await settle(() => meterPanelText(page), (t) => /\bhps\b/.test(t), { timeoutMs: 10_000 })
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
  const back = await settle(() => meterPanelText(page), (t) => /\bdps\b/.test(t), { timeoutMs: 10_000 })
  check('…and switching back to Outgoing restores the damage meter', /\bdps\b/.test(back))
}

// ── THE METER DRILL, LEVEL BY LEVEL (JOS-35) ───────────────────────────────────────────
//
// The model is pinned purely in tests/combatPetNesting.test.mts — which level a drill token
// resolves to, what folds into whose bar, what a stale id degrades to. What only the real app
// can show is that the LEVELS ARE REACHABLE with a mouse: that the tab opens zoomed OUT, that
// clicking a bar (INCLUDING YOUR OWN — the click this surface lost) opens that entity's
// breakdown, and that there is a way back from it. Two of those three were the regressions the
// ticket was filed for, and all three are invisible to a unit test.
//
// Floors and identities only (AGENTS.md): the live log decides who is in the fight, so this
// asserts "at least one bar, and the first one drills", never a name or a count.

export async function stepMeterDrill(page: Page): Promise<void> {
  // 1. LEVEL 1 IS WHERE IT OPENS. No crumb, no Back — nothing has been drilled yet.
  //    (Every step before this one leaves the meter un-drilled; `meterRows` guarantees it.)
  const rows = await meterRows(page)
  check('the Combat tab opens ZOOMED OUT — one bar per combatant, no auto-drill', !(await drilled(page)))
  if (rows === 0) {
    note('the selection has no outgoing damage right now — there is no bar to click')
    return
  }

  // 2. CLICKING A BAR DRILLS IT. The first row is the biggest source, which on this log is you
  //    (or your bar with the pet folded in) — the exact bar whose click went missing.
  await page.click('[data-testid="meter-row"]', { timeout: 15_000 })
  const opened = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  check('…and clicking a source bar — your own included — opens that entity’s breakdown', opened)

  // 3. AND THERE IS A WAY BACK. The meter used to withhold Back on precisely the view it had
  //    opened on, which with the pet preference on was every view there was.
  const back = await inMeterPanel(page, '[data-testid="drill-back"]')
  check('…with the zoom-out affordance on that level', back === 1, `${back} back control(s)`)
  const after = await meterRows(page)
  check('…and Back returns to the same source list it came from', after === rows, `${rows} → ${after} rows`)
}

// ── THE MULTI-ATTACK PANEL (JOS-37; the engine half is docs/plans/attack-round-stats.md) ──
//
// The grouper and the tiers are pinned in tests/combatRoundStats.test.mts, and the words in
// tests/multiAttackRows.test.mts, against real log windows. What only the real app can show is
// that the panel MOUNTS inside the drill and states something: it lives one level down (the
// drilled source's breakdown), so a wiring mistake would leave it invisible with every unit
// test still green. It stays in the drill on purpose — the JOS-37 arrangement note in
// CombatView.tsx says why — so this step is also what proves it did not drift up into a cell.
//
// FLOORS ONLY (AGENTS.md: frozen numbers rot). The live log decides how many verbs the
// selected fight used, so this asserts "at least one stated lane, with its denominator on
// screen" and notes rather than fails when the selection has no swings at all.

const MULTI = '[data-testid="multi-attack-panel"]'
const MULTI_LANE = '[data-testid="multi-attack-lane"]'

export async function stepMultiAttackPanel(page: Page): Promise<void> {
  // The dashboard opens on LEVEL 1 (JOS-35), so this step drills itself — `stepMeterDrill` above
  // left it un-drilled on purpose, and the multi-attack panel lives one level down.
  if ((await inMeterPanel(page, MULTI)) === 0 && !(await drilled(page))) {
    await page.click('[data-testid="meter-row"]', { timeout: 15_000 }).catch(() => undefined)
    await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  }
  const lanes = await inMeterPanel(page, MULTI_LANE)
  if ((await inMeterPanel(page, MULTI)) === 0) {
    note('the drilled source landed no swings in this selection — the multi-attack panel correctly renders nothing')
    return
  }
  check('the multi-attack panel mounts inside the combat drill', true)
  check('…with at least one attack-type lane', lanes >= 1, `${lanes} lanes`)
  const text = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return (el as HTMLElement | null)?.innerText ?? ''
  }, MULTI)
  // The denominator is on screen, in rounds — law 11's spirit, and the one thing the design
  // insists the panel can never omit.
  check('…and its denominator is visible, in ROUNDS', /\brounds\b/i.test(text), text.slice(0, 120).replace(/\s+/g, ' '))
  // Every lane states its multi-attack reading — a rate, or the honest "it never did".
  check(
    '…and every lane states how often it multi-attacked',
    /%\s*doubled|never multi-attacked/i.test(text),
    text.slice(0, 160).replace(/\s+/g, ' ')
  )
  // The whole stated-vs-inferred tier is ONE word now (TOOLTIP AND CAVEAT DIET) — the old
  // panel's four hover paragraphs are gone, and so is the `inferred` chip they explained.
  check('…and the old Rounds block’s chips are gone', !/inferred|riposte|rampage|excluded/i.test(text), text.slice(0, 160).replace(/\s+/g, ' '))
}

// ── THE OPEN FIGHT LIST IS FROZEN (Task #61) ───────────────────────────────────────────

export async function stepFrozenList(page: Page, log: FixtureLog): Promise<void> {
  // 10b. FROZEN WHILE OPEN (Task #61, the churn fix). The snapshot ticks ~4x/sec while the
  //      user is fighting, and every tick rebuilds the option rows: a fight finalizes, the head
  //      row relabels itself from "Current fight (live)" to "Last fight — …", the old head drops
  //      into the history under its own id, and every row below shifts down one. That is what
  //      "it gets all confused as it's switching" was. The contract now is that the OPEN list is
  //      a snapshot taken at open time — no reorder, no insert, no removal — so what is under
  //      your pointer stays under your pointer.
  //
  //      IT USED TO BE VACUOUS HALF THE TIME. The claim only means something while the world is
  //      actually moving under the open list, so the step slept three seconds and hoped the owner
  //      was fighting; when he was not, it noted and asserted nothing. Now the HARNESS plays the
  //      fight (gameplay.mts) into the tailed fixture while the list is open, so "busy" is
  //      something this step CAUSES rather than something it waits to be lucky about.
  await openPicker(page)
  const frozenBefore = await listedValues(page)
  const churnA = await snapshot(page)

  // The pull is written with the picker OPEN — that is the whole scenario.
  const written = await playPull(log, () =>
    settle(() => snapshot(page), (s) => s.recent.length !== churnA.recent.length, { timeoutMs: 8_000 })
  )
  // …and the churn we wait for is the engine's own view of the world moving: a fight opened, or
  // the selection's damage grew. Either is enough to have rebuilt the rows underneath.
  const churnB = await settle(
    () => snapshot(page),
    (s) =>
      !!s.segments.find((seg) => seg.kind === 'current') ||
      (s.selected?.outTotal ?? 0) !== (churnA.selected?.outTotal ?? 0),
    { timeoutMs: 15_000 }
  )
  const frozenAfter = await listedValues(page)
  const busy =
    !!churnB.segments.find((s) => s.kind === 'current') ||
    churnA.segments.length !== churnB.segments.length ||
    (churnA.selected?.outTotal ?? 0) !== (churnB.selected?.outTotal ?? 0)
  const sameList =
    frozenBefore.length === frozenAfter.length && frozenBefore.every((v, i) => v === frozenAfter[i])
  check(
    'the world moved under the open list — the harness played a fight into the tailed log',
    busy,
    `${String(written)} lines written · ${String(churnA.recent.length)} → ${String(churnB.recent.length)} in the ring`
  )
  check(
    'the OPEN fight list is frozen — a live fight changes neither its rows nor their order',
    sameList,
    `${frozenBefore.length} rows → ${frozenAfter.length} rows${sameList ? '' : ` (was ${frozenBefore.slice(0, 4).join(',')} · now ${frozenAfter.slice(0, 4).join(',')})`}`
  )
  await closePicker(page)
}

/**
 * THE LIVE TAIL, SCRIPTED (step 8 of the combat spec, rewritten in wave E2).
 *
 * It used to poll for 45 seconds hoping the owner was mid-fight, then assert a floor. Now the
 * harness plays a pull whose damage it STATES (gameplay.mts: ten hits, 442 points, four seconds)
 * and asserts the engine's arithmetic exactly.
 *
 * The pre-condition matters and is asserted rather than assumed: no fight may be OPEN when the
 * pull starts, or the scripted swings would join the fixture's last encounter as a second target
 * and the total would be that fight's, not this one's.
 */
export async function stepScriptedPull(page: Page, log: FixtureLog): Promise<Snap> {
  const quiet = await settle(() => snapshot(page), (s) => !s.segments.some((x) => x.kind === 'current'), {
    timeoutMs: 90_000,
    pollMs: 500
  })
  if (
    !check(
      'the fixture’s own fights have all closed before the scripted pull opens one',
      !quiet.segments.some((s) => s.kind === 'current'),
      quiet.segments.find((s) => s.kind === 'current')?.name ?? 'none open'
    )
  ) {
    return quiet
  }
  const before = quiet.recent.length
  const written = await playPull(log, () =>
    settle(() => snapshot(page), (s) => s.recent.length > before, { timeoutMs: 8_000 })
  )
  check('the harness wrote the whole pull into the tailed log', written === PULL_LINES, `${String(written)} lines`)

  // The ring is capped, so its LENGTH is not the claim — that it GREW from the live tail is.
  const after = await settle(() => snapshot(page), (s) => s.recent.length > before, { timeoutMs: 15_000 })
  check(
    'the live tail carried the scripted lines into the classification ring',
    after.recent.length > before,
    `${String(before)} → ${String(after.recent.length)} lines in the ring`
  )
  const rendered = await countOf(page, '[data-testid="combat-log"] > div')
  check('…and the combat log renders them', rendered >= 1, `${String(rendered)} rendered`)

  // THE POINT OF ALL OF IT: an EXACT number. The pull states its own damage, so the engine's
  // total is not a floor to be satisfied — it is an arithmetic identity to be checked.
  const exact = await settle(() => snapshot(page), (s) => (s.selected?.outTotal ?? 0) === PULL_DAMAGE, {
    timeoutMs: 20_000
  })
  check(
    'the scripted pull’s damage lands EXACTLY, not approximately',
    Math.round(exact.selected?.outTotal ?? -1) === PULL_DAMAGE,
    `${String(Math.round(exact.selected?.outTotal ?? -1))} of ${String(PULL_DAMAGE)} points`
  )
  check(
    '…on a fight named after the mob the harness pulled',
    (exact.selected?.name ?? '').includes(PULL_TARGET.replace(/^a /, '')),
    exact.selected?.name ?? 'no selection'
  )
  return exact
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

  // One click per scope, all the way round. The cycle is the whole control on this surface, and
  // the CONDITION each click produces is the chip's own next word.
  const cycleTo = async (want: string): Promise<string> => {
    await page.click(chip)
    return settle(label, (t) => t === want, { timeoutMs: 8_000 })
  }

  check('clicking cycles Group to Everyone', (await cycleTo('Everyone')) === 'Everyone', await label())
  const everyone = await meterRows(page)
  check('Everyone shows at least what Group did', everyone >= baseline, `${everyone} vs ${baseline}`)

  check('clicking again cycles Everyone to You', (await cycleTo('You')) === 'You', await label())
  // NO SCOPE EVER HIDES YOU OR YOUR PETS. The live log is the owner's own, so the rows here are
  // his and his pets' — they must survive every scope, and only a member row may ever go.
  const you = await meterRows(page)
  check('You scope keeps your own rows — only a member is ever filtered', you >= 1 && you <= everyone, `${you} of ${everyone}`)

  // PERSISTED PER SURFACE: the choice survives leaving the tab and coming back, because it is a
  // stored preference and not component state.
  await page.click('[data-testid="nav-overview"]')
  await settleCount(page, '[data-testid="overview-grid"]')
  await page.click('[data-testid="nav-combat"]')
  await settleCount(page, chip)
  check('the scope is remembered across a tab round trip', (await settle(label, (t) => t === 'You')) === 'You', await label())

  // The roster popover (G3) — the answer to "who does the app think is with me, and why".
  await page.click('[data-testid="roster-open"]')
  const opened = await settleCount(page, '[data-testid="roster-popover"]')
  check('the roster popover opens from the chip', opened === 1)
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
  await settleGone(page, '[data-testid="roster-popover"]', { timeoutMs: 8_000 })
  for (let i = 0; i < 3 && !(await label()).startsWith('Group'); i++) {
    const was = await label()
    await page.click(chip)
    await settle(label, (t) => t !== was, { timeoutMs: 8_000 })
  }
  check('the meter is left on its Group default', (await label()).startsWith('Group'), await label())
}
