/**
 * Headless Electron regression test for THE ALERT EDITOR'S TYPED STATE — it must survive a
 * window focus.
 *
 * THE BUG THIS PINS (2026-08-07). `useAlertForm`'s hydrate effect listed `packs` as a
 * dependency, and `packs` changes IDENTITY on every store reload: the always-mounted
 * AlertPlayer refreshes the shared store on window `focus` (player.tsx), `useAlertsStore`
 * re-`reload()`s on that notification, and `listSoundPacks()` hands back a fresh array over IPC
 * even when the installed packs are byte-for-byte the same. So alt-tabbing out of the app and
 * back — to read a spell name off the wiki, to look at the game — silently re-hydrated an OPEN
 * dialog: the name, the trigger, the sound, the volume and the cooldown all went back to blank.
 * The Speech sub-form does NOT depend on `packs`, so it survived, and the form was left in a
 * half-reset state that pressing Save would then persist.
 *
 * WHY IT IS AN E2E SPEC. Every part of this lives in the WIRING and nothing else: a React
 * effect's dependency array, a module-level pub/sub in player.tsx, a real IPC round trip that
 * returns a new array each call, and a DOM `focus` event. There is no pure function here to
 * unit-test — the old code and the new code are identical in every way a unit test could see.
 * What the real app can show, and only the real app, is that the fields still hold what was
 * typed after the window is focused.
 *
 * `window.dispatchEvent(new Event('focus'))` IS the real signal, not a stand-in: it is the same
 * event Chromium delivers to the renderer when the OS gives the window back, and it is what
 * `AlertPlayer` listens for. Driving it directly is also the only option available — under
 * EQ_E2E no window is ever shown (AGENTS.md), so there is nothing to click away from. The other
 * known trigger (a sound-pack set change arriving on `sounds:changed` while the dialog is open)
 * converges on the very same `reload()`, so it is covered by the same assertion.
 *
 * Run: `npm run test:e2e` (or `node --import tsx tests/e2e/alert-editor.e2e.mts`).
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
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const DIALOG = '[data-testid="alert-dialog"]'
const NAME = `${DIALOG} [data-testid="alert-name"] input`
const COOLDOWN = `${DIALOG} [data-testid="alert-cooldown"] input`
const REGEX = `${DIALOG} [data-testid="alert-condition-regex"] input`
const PHRASE = `${DIALOG} [data-testid="alert-speech-phrase"] input`
const DISMISS_NOTICE = '[data-testid="telemetry-notice-dismiss"]'

/** What a user would have typed: one value per half of the form, none of them a default. */
const TYPED = {
  name: 'Zlandicar is up',
  regex: 'Zlandicar begins to cast',
  cooldown: '9999',
  phrase: 'up: $<spell>'
}

/** Pick a value out of one of the dialog's MUI selects. */
async function selectValue(page: Page, testid: string, value: string): Promise<void> {
  await page.click(`${DIALOG} [data-testid="${testid}"] [role="combobox"]`)
  await page.click(`li[data-value="${value}"]`)
  await settleGone(page, '.MuiMenu-root', { timeoutMs: 8_000 })
}

/** The event Chromium delivers when the OS hands the window back — see the header. */
async function refocusWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // The reset was asynchronous (IPC round trip → setState → effect), so a synchronous read
  // right after the event would pass even against the bug. Outlast the round trip.
  await page.waitForTimeout(1_500)
}

/**
 * One field's value, or `<gone>` when it is not on screen.
 *
 * The absent case is not defensive padding — it is exactly what the bug produced: a reset drops
 * the trigger back to `event` and the output back to sound-only, which UNMOUNTS the regex and
 * phrase fields. Reading them blind would kill the run with a locator timeout, and a spec that
 * crashes reports nothing; this one reports which field went and what it held.
 */
async function valueOf(page: Page, sel: string): Promise<string> {
  return (await countOf(page, sel)) === 0 ? '<gone>' : page.inputValue(sel)
}

/** Every field the dialog is holding right now. */
async function formState(page: Page): Promise<Record<string, string>> {
  return {
    name: await valueOf(page, NAME),
    regex: await valueOf(page, REGEX),
    cooldown: await valueOf(page, COOLDOWN),
    phrase: await valueOf(page, PHRASE)
  }
}

async function openAddDialog(page: Page): Promise<void> {
  await page.click('button:has-text("Add from suggestion")')
  await page.click('button:has-text("Create manually")')
  await page.waitForSelector(DIALOG, { timeout: 15_000 })
}

async function cancelDialog(page: Page): Promise<void> {
  await page.click(`${DIALOG} button:has-text("Cancel")`)
  await settleGone(page, DIALOG, { timeoutMs: 8_000 })
}

/** Fill all four fields of a freshly opened ADD dialog. */
async function fillEveryHalf(page: Page): Promise<void> {
  await page.fill(NAME, TYPED.name)
  // A hand-written regex is the most expensive thing in this dialog to lose.
  await selectValue(page, 'alert-condition-type', 'raw')
  await page.fill(REGEX, TYPED.regex)
  await page.fill(COOLDOWN, TYPED.cooldown)
  // The Speech block is its own sub-form (useSpeechForm) and reset independently of the rest —
  // which is what made the old failure a HALF reset. Assert both halves together.
  await selectValue(page, 'alert-audio-action', 'speech')
  await selectValue(page, 'alert-speech-mode', 'custom')
  await page.fill(PHRASE, TYPED.phrase)
}

/** ADD: a form filled from blank keeps every field across a focus. */
async function stepAdd(page: Page): Promise<void> {
  await openAddDialog(page)
  await fillEveryHalf(page)
  await refocusWindow(page)

  const after = await formState(page)
  check('the dialog is still open after the window is focused', (await countOf(page, DIALOG)) === 1)
  check(
    'ADD: every typed field survives a window focus',
    after.name === TYPED.name &&
      after.regex === TYPED.regex &&
      after.cooldown === TYPED.cooldown &&
      after.phrase === TYPED.phrase,
    JSON.stringify(after)
  )
}

/**
 * …and the guard does not overshoot into STALE state: Cancel then Add again must blank the
 * form. Hydration is skipped while one opening lasts, never across two.
 */
async function stepReopenAdd(page: Page): Promise<void> {
  await cancelDialog(page)
  await openAddDialog(page)
  const name = await page.inputValue(NAME)
  const cooldown = await page.inputValue(COOLDOWN)
  // A blank form is back on the EVENT trigger type and back on sound-only output, so the regex
  // and phrase fields are not merely empty — they are not rendered at all.
  const carried = (await countOf(page, REGEX)) + (await countOf(page, PHRASE))
  check(
    'ADD re-opened after Cancel is blank again, not the last draft',
    name === '' && cooldown === '2000' && carried === 0,
    `name=${JSON.stringify(name)} cooldown=${cooldown} carriedFields=${String(carried)}`
  )
  await cancelDialog(page)
}

/**
 * EDIT: the same, on a stored def. The old failure was quieter here — the fields reverted to the
 * STORED values while the Speech block kept its unsaved edits, so Save wrote a def the user had
 * not asked for.
 */
async function stepEdit(page: Page): Promise<void> {
  await page.click('[data-testid="alert-row"]:first-of-type [data-testid="alert-edit"]')
  await page.waitForSelector(DIALOG, { timeout: 15_000 })
  const stored = await page.inputValue(NAME)
  await page.fill(NAME, `${stored} EDITED`)
  await page.fill(COOLDOWN, TYPED.cooldown)
  await refocusWindow(page)

  const name = await page.inputValue(NAME)
  const cooldown = await page.inputValue(COOLDOWN)
  check(
    'EDIT: unsaved edits survive a window focus (they do not revert to the stored def)',
    name === `${stored} EDITED` && cooldown === TYPED.cooldown,
    `name=${name} cooldown=${cooldown} stored=${stored}`
  )

  // And re-opening the SAME row still shows what is stored — the edits were abandoned, not kept.
  await cancelDialog(page)
  await page.click('[data-testid="alert-row"]:first-of-type [data-testid="alert-edit"]')
  await page.waitForSelector(DIALOG, { timeout: 15_000 })
  const reopened = await page.inputValue(NAME)
  check('EDIT re-opened after Cancel shows the STORED def, not the abandoned draft', reopened === stored, reopened)
  await cancelDialog(page)
}

async function main(): Promise<void> {
  buildIfStale()
  const { app, close } = await launchOnFixture('e2e-alert-editor.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
    await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
    // The first-run analytics bar sits over the dialog's lower half and swallows its clicks.
    // Every launch here gets a fresh userData, so it is always raised — but it is waited for
    // rather than assumed, so a run that somehow starts without one still gets to the point.
    const noticeShown = await settleCount(page, DISMISS_NOTICE, 1, { timeoutMs: 10_000 })
    if (noticeShown > 0) {
      await page.click(DISMISS_NOTICE)
      await settleGone(page, '[data-testid="telemetry-notice"]', { timeoutMs: 8_000 })
    }

    await stepAdd(page)
    await stepReopenAdd(page)
    await stepEdit(page)

    if (failures.length) await dumpArtifacts(page, 'alert-editor-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
