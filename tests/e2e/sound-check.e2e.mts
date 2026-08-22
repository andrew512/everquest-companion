/**
 * Headless Electron integration test for THE SOUND CHECK (JOS-442).
 *
 * WHY IT IS AN E2E SPEC. The rules this feature reports by are pure and are pinned next door
 * (tests/audioCheck.test.mts); what a unit test cannot reach is the SEAM, and this feature is
 * almost entirely seam. `readAudioSession` crosses the preload bridge into a main-process handler
 * that loads koffi, opens ole32, and walks a COM vtable by hand — five things, any one of which
 * can be fine in a `tsx` script and wrong inside a packaged Electron main process. The whole
 * value of the card is that it answers when everything else has stopped answering, so "the
 * native read works in the REAL app" is the assertion, and only the real app can make it.
 *
 * THE DEFECT IT GUARDS. The ticket exists because a silent failure looked exactly like success:
 * `playSound` swallowed every rejection and the app's error log was empty for the whole failure
 * window. So the strict assertion here is not "a sound played" — a hidden window on a CI box is
 * entitled to make no noise — it is that THE APP SAYS WHICH. A verdict must appear, it must be
 * one of the four honest statuses, and it must carry a sentence. A card that came back blank
 * would be the original bug wearing new paint.
 *
 * WHAT IS REPORTED RATHER THAN REQUIRED: whether the native readout was available, and what it
 * found. This suite has to pass on a machine with no sound card and on a future non-Windows
 * runner, so the readout's CONTENT is noted (and asserted only for internal consistency), never
 * frozen. The one thing asserted strictly about it is that asking never throws — `available:false`
 * with a reason is a legal answer and a rejected promise is not.
 *
 * Run: `node --import tsx tests/e2e/sound-check.e2e.mts` (it is also in tests/e2e/run-all.mts).
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
  settle
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import type { AudioSessionReadout } from '../../src/shared/audioCheck'

const RAIL = '[data-testid="prefs-rail-sound"]'
const RUN = '[data-testid="sound-check-run"]'
const VERDICT = '[data-testid="sound-check-verdict"]'
const DETAIL = '[data-testid="sound-check-detail"]'

function textOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? '',
    selector
  )
}

/** The bridge the card itself uses, so the spec observes exactly what the app observes. */
function readout(page: Page): Promise<AudioSessionReadout> {
  return page.evaluate(() =>
    (
      window as unknown as { eq: { readAudioSession: () => Promise<AudioSessionReadout> } }
    ).eq.readAudioSession()
  )
}

/** Preferences has a Sound section, and it shows the machine's audio facts before you press anything. */
async function stepPaneOpens(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.click(RAIL, { timeout: 20_000 })
  await page.waitForSelector(RUN, { timeout: 20_000 })
  check('Preferences has a Sound section with a test button', (await countOf(page, RUN)) === 1)
  // The facts arrive over IPC after the card mounts, so the CONDITION is that they arrived.
  const facts = await settle(() => textOf(page, DETAIL), (t) => t.trim().length > 0, {
    timeoutMs: 20_000
  })
  check(
    'it shows what it knows before you press anything — the card is a readout, not just a button',
    facts.includes('A sound last played:'),
    facts.replace(/\s+/g, ' ').slice(0, 160)
  )
}

/**
 * THE NATIVE READ, THROUGH THE REAL BRIDGE — koffi loaded inside a running Electron main process,
 * ole32 opened, and a COM vtable walked. Asking must never throw; what it FINDS is noted.
 */
async function stepNativeRead(page: Page): Promise<void> {
  let r: AudioSessionReadout
  try {
    r = await readout(page)
  } catch (err) {
    check('asking Windows about our own audio never throws', false, String(err))
    return
  }
  check('asking Windows about our own audio never throws', true)
  if (!r.available) {
    note(`native audio readout unavailable on this machine: ${r.reason}`)
    check('…and an unavailable readout still carries a reason a person can read', r.reason.length > 0)
    return
  }
  note(
    `native audio readout: ${r.deviceName} (${r.deviceState}), device ${r.endpointMuted ? 'MUTED' : 'unmuted'} ` +
      `at ${String(Math.round(r.endpointVolume * 100))}%, this app ${
        r.session ? `${r.session.muted ? 'MUTED' : 'unmuted'} (${r.session.state})` : 'has no session'
      }${r.sessionOnOtherDevice === null ? '' : ` on ${r.sessionOnOtherDevice}`}`
  )
  // Identities, never today's values: this must pass on any machine, so what is asserted is that
  // the readout is internally coherent rather than that this box has a particular sound card.
  check(
    'an available readout names a device state the app knows and a volume in range',
    ['active', 'disabled', 'notpresent', 'unplugged', 'unknown'].includes(r.deviceState) &&
      r.endpointVolume >= 0 &&
      r.endpointVolume <= 1,
    JSON.stringify({ state: r.deviceState, vol: r.endpointVolume })
  )
  check(
    '…and a session it found is a real session: a known state and a volume in range',
    r.session === null ||
      (['inactive', 'active', 'expired', 'unknown'].includes(r.session.state) &&
        r.session.volume >= 0 &&
        r.session.volume <= 1),
    JSON.stringify(r.session)
  )
  // Reading twice must work. It did NOT during the build: `koffi.proto` registers a named type
  // process-wide, so the second call threw `duplicate type name` and the button reported that
  // Windows was broken. A diagnostic that works once is not a diagnostic.
  const again = await readout(page)
  check(
    'reading twice in one process works — the button is pressable more than once',
    again.available === r.available,
    `${String(r.available)} then ${String(again.available)}`
  )
}

/**
 * THE ACCEPTANCE CRITERION: press it, and it REPORTS. Not "it played" — a hidden window is
 * allowed to be silent — but that the app says which of the honest outcomes happened, in a
 * sentence, instead of doing what it used to do, which was nothing at all.
 */
async function stepReports(page: Page): Promise<void> {
  await page.click(RUN, { timeout: 15_000 })
  const said = await settle(() => textOf(page, VERDICT), (t) => t.trim().length > 0, {
    timeoutMs: 30_000
  })
  check('pressing Test sound produces a verdict, never silence', said.trim().length > 0, said)
  note(`verdict on this machine: ${said.replace(/\s+/g, ' ')}`)
  // Every sentence `soundCheckVerdict` can return matches one of these. A verdict that matched
  // none of them would mean the card had invented copy of its own, which is the thing the pure
  // module exists to prevent.
  const HONEST =
    /(Played .+|could not read .+|was refused .+|MUTED in the Windows volume mixer|is muted\.|at zero volume|volume slider in the Windows mixer is at zero|never opened an audio stream|still attached to .+|never advanced|No sound is set up)/
  check(
    '…and the sentence is one the shared verdict can actually produce',
    HONEST.test(said),
    said.replace(/\s+/g, ' ').slice(0, 200)
  )
  // The evidence stays under it — a verdict with no facts beneath is an opinion.
  const facts = await textOf(page, DETAIL)
  check('…with the evidence it rests on printed underneath', facts.trim().length > 0, facts.slice(0, 120))
  check(
    '…including when a sound last played, which the app had no notion of before this ticket',
    facts.includes('A sound last played:'),
    facts.replace(/\s+/g, ' ').slice(0, 160)
  )
}

async function main(): Promise<void> {
  buildIfStale()
  const consoleErrors: string[] = []
  const log = stageFixture('e2e-voice.log')
  const { app, close } = await launchOnFixture(log, {})
  try {
    const page = await mainWindow(app)
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepPaneOpens(page)
    await stepNativeRead(page)
    await stepReports(page)
    if (failures.length) await dumpArtifacts(page, 'sound-check-FAIL')
  } finally {
    await close()
    await log.dispose()
  }

  // A missing IPC handler surfaces here first: `invoke` on an unregistered channel rejects into
  // an unhandled rejection rather than into anything the card would render.
  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
