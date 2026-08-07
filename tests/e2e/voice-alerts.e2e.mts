/**
 * Headless Electron integration test for VOICE ALERTS (docs/plans/voice-alerts.md, wave 2).
 *
 * THERE IS NO MASTER SWITCH ANY MORE, and this spec is where that is proven end to end. It used
 * to drive one: turn on "Speak alerts out loud", check it reached main's store, and only then
 * exercise the rest — which is exactly why the row's ▶ bug survived (owner, 2026-08-04). A user
 * who never found that toggle set a row's output to "Voice (spoken)", pressed play, and heard the
 * old pack sound, because the retired switch degraded every spoken alert to its sound while it was
 * off. The test agreed with the app and both were wrong about the product. So the first thing
 * asserted here now is the ABSENCE of that control, in the panel AND in the stored prefs.
 *
 * WHY IT IS AN E2E SPEC AND NOT A UNIT TEST: every claim this wave makes is a SEAM, and the
 * pure halves are already pinned elsewhere (tests/voiceAlerts.test.mts for the plan/throttle/
 * voice-matching decisions, tests/alertPreview.test.mts for preview == firing,
 * tests/speechText.test.mts for the text). What only the real app can show is that the pieces are
 * actually WIRED:
 *   - the Preferences → Voice section mounts as pure configuration, with no enable switch in it
 *     and none in main's stored blob (electron-store is main-owned; the only honest proof is the
 *     round trip);
 *   - the editor's live preview resolves through `speechTextFor` with NO firing at all — the
 *     whole reason that function takes an optional firing;
 *   - a def saved with `audio:'speech'` makes the firing path reach the ENGINE SEAM, which
 *     crosses the dialog, the store, main, the player and lib/speech;
 *   - a tier with nothing to speak with SAYS SO on the alert row itself, rather than leaving the
 *     user to discover it by pressing play.
 *
 * IT ASSERTS THE SEAM, NEVER THE AUDIO. `lib/speech.ts` records every utterance on
 * `window.__eqSpeech` with an `uttered` flag and returns BEFORE touching any engine whenever
 * `window.eq.isE2E` is true. So this spec reads that ring — which gives it two independent
 * claims from one action: the seam was invoked (the record exists, with the right text) AND
 * the e2e channel stayed SILENT (`uttered === false`).
 *
 * THE SILENCE IS THE POINT, not a convenience. `npm run test:e2e` runs beside the user's live
 * game with no window ever shown (AGENTS.md); a headless test that spoke out loud would be the
 * most intrusive thing in this repo. That is asserted here explicitly, so it cannot regress
 * quietly.
 *
 * Run: `npm run test:e2e` (or `node --import tsx tests/e2e/voice-alerts.e2e.mts`).
 */
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
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const VOICE_PANEL = '[data-testid="pref-voice"]'
/** The RETIRED master switch. Asserted to be absent — see the header. */
const ENABLE = '[data-testid="pref-voice-enabled"]'

/** One utterance as `lib/speech.ts` recorded it. `uttered` is what proves the channel is mute. */
interface Spoken {
  text: string
  engine: string
  voiceId: string | null
  uttered: boolean
}

/** The engine seam's own ring. `[]` when nothing has ever asked to speak. */
function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(
    () => (window as unknown as { __eqSpeech?: { spoken: Spoken[] } }).__eqSpeech?.spoken ?? []
  ) as Promise<Spoken[]>
}

/** The voice prefs as MAIN has them — the only honest read of what is actually stored. */
function storedPrefs(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (window as unknown as { eq: { getVoicePrefs: () => Promise<Record<string, unknown>> } }).eq.getVoicePrefs()
  )
}

function textOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? '',
    selector
  )
}

/** Pick a value out of a MUI Select (its popup renders `li[data-value=…]`). */
async function selectIn(page: Page, selector: string, value: string): Promise<void> {
  await page.click(selector)
  await page.waitForSelector(`li[data-value="${value}"]`, { timeout: 10_000 })
  await page.click(`li[data-value="${value}"]`)
  // MUI's menu animates out; clicking through it while it fades hits the backdrop. Its LEAVING is
  // the condition — waiting for the DOM to lose the listbox, not for 400ms to pass.
  await settleGone(page, '.MuiMenu-root', { timeoutMs: 8_000 })
}

/**
 * Fire something that should SPEAK, and wait for the seam's own ring to record it.
 *
 * `lib/speech.ts` pushes onto `window.__eqSpeech` before it would touch an engine, so a new entry
 * IS the observable this spec exists to assert — which makes it the right thing to wait for, and
 * the 500–800ms sleeps that used to stand in for it pure guesswork about IPC latency.
 */
async function spokeOnce(page: Page, act: () => Promise<void>): Promise<Spoken[]> {
  const before = (await spoken(page)).length
  await act()
  return settle(() => spoken(page), (all) => all.length > before, { timeoutMs: 10_000 })
}

function selectValue(page: Page, testid: string, value: string): Promise<void> {
  return selectIn(page, `[data-testid="${testid}"]`, value)
}

/** §2: the section exists and is pure CONFIGURATION — no master switch, in the UI or the store. */
async function stepPanel(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-voice"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-voice"]')
  await page.waitForSelector(VOICE_PANEL, { timeout: 15_000 })
  if (!check('Preferences has a Voice section, reachable from the rail', (await countOf(page, VOICE_PANEL)) === 1)) {
    return false
  }

  check(
    'there is NO master switch — an alert’s own output is the whole of "does this speak"',
    (await countOf(page, ENABLE)) === 0
  )
  check(
    '…and the section says so, rather than leaving the user hunting for the toggle they remember',
    (await countOf(page, '[data-testid="pref-voice-intro"]')) === 1
  )

  const stored = await storedPrefs(page)
  check(
    'main agrees: the stored voice blob carries configuration and no permission',
    !('enabled' in stored),
    JSON.stringify(stored)
  )
  check('…and the engine tier defaults to the free, zero-download one', stored.engine === 'system', String(stored.engine))

  // The controls that configure the tier are all present.
  for (const id of ['pref-voice-engine', 'pref-voice-picker', 'pref-voice-preview', 'pref-voice-rate', 'pref-voice-volume']) {
    check(`the Voice section offers ${id.replace('pref-voice-', '')}`, (await countOf(page, `[data-testid="${id}"]`)) === 1)
  }
  return true
}

/** The ▶ preview speaks through the REAL seam — and, in this channel, silently. */
async function stepPreview(page: Page): Promise<void> {
  const before = (await spoken(page)).length
  const all = await spokeOnce(page, () => page.click('[data-testid="pref-voice-preview"]'))
  if (!check('the ▶ preview reaches the speech engine seam', all.length === before + 1, `${String(all.length - before)} utterance(s)`)) {
    return
  }
  const last = all[all.length - 1]
  check('…saying something, through the selected tier', last.text.length > 0 && last.engine === 'system', `${last.engine}: "${last.text}"`)
  check(
    'THE E2E CHANNEL NEVER UTTERS — the seam records and returns before any engine is touched',
    last.uttered === false,
    `uttered=${String(last.uttered)}`
  )
}

/**
 * §2 (W3): the DOWNLOADED tier states its price and its refusal, in the panel.
 *
 * The e2e channel declines to download (a throwaway userData would re-fetch ~120 MB every run),
 * which is exactly what makes this cheap AND worth asserting: clicking Download proves the button
 * reaches main, and the refusal proves the reason lands INLINE instead of vanishing into a
 * promise. The tier is put back to 'system' afterwards so the later steps see the default.
 */
async function stepKokoroInstall(page: Page): Promise<void> {
  await selectValue(page, 'pref-voice-engine', 'kokoro')
  check(
    'choosing the downloaded tier says plainly that it is not installed',
    (await countOf(page, '[data-testid="pref-voice-not-installed"]')) === 1
  )
  // `innerText` is the RENDERED text, and MUI Buttons uppercase it — match case-insensitively
  // rather than pinning a theme decision this spec has no opinion about.
  const label = (await textOf(page, '[data-testid="pref-voice-install"]')).replace(/\s+/g, ' ').trim()
  check(
    '…and offers the download, stating what it costs BEFORE the user pays it',
    /^download natural voice \(~\d+ MB\)$/i.test(label),
    label
  )

  await page.click('[data-testid="pref-voice-install"]')
  await page.waitForSelector('[data-testid="pref-voice-install-error"]', { timeout: 20_000 })
  const failure = (await textOf(page, '[data-testid="pref-voice-install-error"]')).replace(/\s+/g, ' ')
  check(
    'clicking it reaches main, and main’s refusal is rendered inline with its reason',
    failure.includes('disabled in e2e'),
    failure
  )
  await selectValue(page, 'pref-voice-engine', 'system')
}

/**
 * THE ROW'S OWN DROPDOWNS (owner: "the voice vs sound should be integrated into this dropdown
 * instead of having to drill into edit").
 *
 * This is the one claim the pure tests cannot make. audioChoice.ts pins what the selects WRITE;
 * what only the real app can show is that the first select actually offers the voice outputs
 * beside the packs, that choosing one persists through main and comes back as the displayed
 * value, that the SECOND select swaps from sounds to speak-what modes, and that the row's ▶ then
 * SPEAKS — through `playAlertNow`'s existing plan, with no second preview path.
 *
 * THE ▶ ASSERTION IS THE BUG'S TRIPWIRE, and it asserts the RESOLVED ACTION, never audible sound
 * (this channel is mute by construction): the seam's ring must gain exactly one utterance carrying
 * the def's resolved text. Before the master switch was retired this row previewed the PACK SOUND
 * — no utterance at all — so a regression shows up here as `0 utterance(s)`, which is precisely
 * what the user experienced.
 *
 * It runs BEFORE the editor step, while the seeded alert is still sound-only, so the write it
 * makes is a real change rather than a no-op.
 */
const FIRST_ROW = '[data-testid="alert-row"]:first-of-type'

/** The first alert's name, as the row renders it — what a preview of it must say. */
function firstRowName(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '',
    `${FIRST_ROW} .MuiTypography-body2`
  )
}

async function stepRowPicker(page: Page): Promise<void> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
  check(
    'an alert row shows its sound, not a drill-down: two selects, output and sound',
    (await countOf(page, `${FIRST_ROW} [data-testid="alert-output"]`)) === 1 &&
      (await countOf(page, `${FIRST_ROW} [data-testid="alert-sound"]`)) === 1
  )

  await selectIn(page, `${FIRST_ROW} [data-testid="alert-output"]`, 'output:speech')
  // MUI pads a Select's rendered value with a zero-width space (its empty-value placeholder), so
  // it has to come out before this compares text.
  const shown = (await textOf(page, `${FIRST_ROW} [data-testid="alert-output"]`))
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  check('the output select states the channel the def is actually in', shown === 'Voice (spoken)', shown)
  check(
    '…and the second select becomes what to SAY, not which sound to play',
    (await countOf(page, `${FIRST_ROW} [data-testid="alert-say"]`)) === 1 &&
      (await countOf(page, `${FIRST_ROW} [data-testid="alert-sound"]`)) === 0
  )

  const stored = await page.evaluate(() =>
    (window as unknown as { eq: { listAlerts: () => Promise<{ audio?: string }[]> } }).eq.listAlerts()
  )
  check(
    'the row wrote the audio channel onto the stored def (no editor was opened)',
    stored[0]?.audio === 'speech',
    JSON.stringify(stored[0]?.audio)
  )

  // Nothing is wrong with the system tier's voices, so the row wears no setup annotation.
  check(
    'a row whose voice is fine carries no chrome about voices',
    (await countOf(page, `${FIRST_ROW} [data-testid="alert-row-voice-setup"]`)) === 0
  )

  const name = await firstRowName(page)
  const before = (await spoken(page)).length
  const all = await spokeOnce(page, () => page.click(`${FIRST_ROW} [data-testid="alert-test"]`))
  if (
    !check(
      'and the row’s ▶ SPEAKS it — the same firing path, no new preview seam',
      all.length === before + 1,
      `${String(all.length - before)} utterance(s) — 0 means it played the pack sound again`
    )
  ) {
    return
  }
  const last = all[all.length - 1]
  check(
    '…saying the text the def resolves to, not a sound: the RESOLVED ACTION, never audible noise',
    last.text === name,
    `spoke "${last.text}", expected "${name}"`
  )
  check('…and this channel stayed mute while proving it', last.uttered === false, `uttered=${String(last.uttered)}`)
}

/**
 * A TIER WITH NOTHING TO SPEAK WITH SAYS SO, ON THE ROW.
 *
 * The retired master switch used to be annotated in the output dropdown ("voice is off —
 * Preferences → Voice"): a sentence naming a place, about a switch that overruled the row. What is
 * left is a real, checkable condition — the natural voice is not downloaded — and the row states
 * it where the choice was made. In the app proper it carries a "Set up in Preferences" LINK
 * (AlertsView's optional `onOpenVoicePrefs`, wired by App.tsx); the NOTE is this file's to assert,
 * since it renders with or without a router.
 *
 * The e2e channel never downloads the Kokoro pack, so selecting that tier is a genuine
 * not-installed state rather than a simulated one. The tier is put back afterwards.
 */
async function stepRowSetupNote(page: Page): Promise<void> {
  const gotoVoicePrefs = async (): Promise<void> => {
    await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
    await page.waitForSelector('[data-testid="prefs-rail-voice"]', { timeout: 20_000 })
    await page.click('[data-testid="prefs-rail-voice"]')
    await page.waitForSelector(VOICE_PANEL, { timeout: 15_000 })
  }
  const gotoAlerts = async (): Promise<void> => {
    await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
    await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
    // The annotation this step is about is derived from the stored voice tier, which the row
    // reads over IPC — so the settled ROW is what has to be waited for, not a fixed beat.
    await settle(() => countOf(page, `${FIRST_ROW} [data-testid="alert-output"]`), (n) => n === 1, {
      timeoutMs: 10_000
    })
  }

  await gotoVoicePrefs()
  await selectValue(page, 'pref-voice-engine', 'kokoro')
  await gotoAlerts()
  check(
    'a speaking row whose tier is not installed says so, on the row itself',
    (await countOf(page, `${FIRST_ROW} [data-testid="alert-row-voice-setup"]`)) === 1
  )
  const note = (await textOf(page, `${FIRST_ROW} [data-testid="alert-row-voice-setup"]`)).replace(/\s+/g, ' ')
  check('…naming what is missing, not naming a switch that no longer exists', /downloaded/i.test(note), note)
  noteLink(await countOf(page, `${FIRST_ROW} [data-testid="voice-setup-link"]`))

  await gotoVoicePrefs()
  await selectValue(page, 'pref-voice-engine', 'system')
  await gotoAlerts()
  check(
    '…and the annotation disappears the moment the tier can speak again',
    (await countOf(page, `${FIRST_ROW} [data-testid="alert-row-voice-setup"]`)) === 0
  )
}

/** The link half needs App.tsx's `onOpenVoicePrefs`; report what was found without gating on it. */
function noteLink(count: number): void {
  note(
    count === 1
      ? 'the annotation carries the "Set up in Preferences" link (App passes onOpenVoicePrefs)'
      : 'the annotation renders without its link — App is not passing onOpenVoicePrefs yet'
  )
}

/** The alert name the dialog is editing, read off its own title ("Edit alert — <name>"). */
async function editingName(page: Page): Promise<string> {
  const title = (await textOf(page, '[data-testid="alert-dialog"] .MuiDialogTitle-root')).replace(/\s+/g, ' ').trim()
  const dash = title.indexOf('—')
  return dash === -1 ? '' : title.slice(dash + 1).trim()
}

/**
 * §4: the editor's Speech block, on a REAL stored def — and the live preview, which resolves
 * with no firing at all (that is what `speechTextFor`'s optional firing exists for).
 */
async function stepEditor(page: Page): Promise<string> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
  await page.click('[data-testid="alert-row"]:first-of-type [data-testid="alert-edit"]')
  await page.waitForSelector('[data-testid="alert-dialog"]', { timeout: 15_000 })
  const name = await editingName(page)
  check(
    'the audio channel is a sound/speech/both choice, and the throttle opt-out is beside it',
    (await countOf(page, '[data-testid="alert-audio-action"]')) === 1 &&
      (await countOf(page, '[data-testid="alert-always-play"]')) === 1
  )

  // THE CHANNEL GOVERNS WHICH SECTIONS EXIST AT ALL — the whole of "the Sound options may not be
  // relevant". Asserted by walking all three values rather than by trusting one, because the
  // failure this guards against is a section that renders for a channel that will never use it.
  // The def arrives as `audio:'speech'` — stepRowPicker set it from the row a moment ago.
  const sections = async (): Promise<[number, number]> => [
    await countOf(page, '[data-testid="alert-sound-section"]'),
    await countOf(page, '[data-testid="alert-speech-block"]')
  ]
  check('“Speak it” shows the Voice section and hides Sound', String(await sections()) === '0,1')
  await selectValue(page, 'alert-audio-action', 'sound')
  check('“Play a sound” shows Sound and hides Voice', String(await sections()) === '1,0')
  await selectValue(page, 'alert-audio-action', 'both')
  check('“Sound, then speak” shows both', String(await sections()) === '1,1')
  await selectValue(page, 'alert-audio-action', 'speech')
  const preview = (await textOf(page, '[data-testid="alert-speech-preview"]')).replace(/\s+/g, ' ')
  check(
    'the mode preview resolves LIVE, before anything has fired — and defaults to the alert’s name',
    !!name && preview.includes(name),
    `${preview.slice(0, 80)} (editing “${name}”)`
  )
  check('the mode picker and the per-alert voice override are offered', (await countOf(page, '[data-testid="alert-speech-mode"]')) === 1 && (await countOf(page, '[data-testid="alert-speech-voice"]')) === 1)

  await page.click('[data-testid="alert-save"]')
  await page.waitForSelector('[data-testid="alert-dialog"]', { state: 'detached', timeout: 15_000 })
  // The save writes through main; the row that will be test-fired next has to be back on screen
  // before it can be clicked, which is a condition the list itself answers.
  await settle(() => countOf(page, '[data-testid="alert-row"]'), (n) => n > 0, { timeoutMs: 10_000 })
  return name
}

/**
 * THE WIRING, end to end: a def stored with `audio:'speech'`, fired through the player's own
 * path (the list's Test button), reaches the engine seam saying the resolved text.
 */
async function stepFire(page: Page, name: string): Promise<void> {
  const before = (await spoken(page)).length
  const all = await spokeOnce(page, () =>
    page.click('[data-testid="alert-row"]:first-of-type [data-testid="alert-test"]')
  )
  if (!check('test-firing a speech alert invokes the engine seam', all.length === before + 1, `${String(all.length - before)} utterance(s)`)) {
    return
  }
  const last = all[all.length - 1]
  check(
    '…saying exactly what `speechTextFor` resolved for that def',
    last.text === name,
    `spoke "${last.text}", expected "${name}"`
  )
  check('…and still without uttering a sound in this channel', last.uttered === false, `uttered=${String(last.uttered)}`)
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-voice.log…')
  const { app, close } = await launchOnFixture('e2e-voice.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
    if (await stepPanel(page)) {
      await stepPreview(page)
      await stepKokoroInstall(page)
      await stepRowPicker(page)
      await stepRowSetupNote(page)
      const name = await stepEditor(page)
      if (name) await stepFire(page, name)
      else note('no seeded alert to edit this run — the firing path is not asserted')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'voice-alerts-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
