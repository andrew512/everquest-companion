/**
 * THE ALERTS AUDIO CUTOVER, PROVEN END TO END (JOS-491, phase 3).
 *
 * Owner ruling 22 made the ENGINE the thing that evaluates the user's alert definitions; owner
 * ruling 9 kept the SPEAKER app-side. JOS-482 wired everything between them and then deliberately
 * stopped one inch short: the fire frames arrived and were logged, never played, because the app's
 * own evaluator was still making the noise and two evaluators means two sounds. This spec is the
 * inch. With `EQC_ENGINE_ALERTS=1` beside `EQC_ENGINE=1` and `EQC_ENGINE_SERVE=1`:
 *
 *   1. THE APP SAYS WHICH WORLD OWNS THE SOUND, once, in the dev log — the arm line. Load-bearing
 *      rather than tidy: everything below is also true of an app that armed nothing and simply
 *      fired its own alert, so without this the whole spec would pass against the feature being off.
 *   2. A MATCHING LIVE LINE MAKES EXACTLY ONE SOUND. The bar of the ticket, and the reason it is an
 *      e2e claim: a doubled alert is invisible to every unit test in the tree.
 *   3. …AND THAT SOUND IS THE ENGINE'S. The fire frame reached the app, was placed against a real
 *      def, and was PLAYED — narrated as such, with the app's own evaluator silent behind it.
 *
 * ── WHY THE COALESCING WINDOW HAD TO BE TAKEN OFF THE PROBE DEF ────────────────────────────────
 *
 * THIS IS THE WHOLE METHODOLOGY OF THE SPEC, and it is JOS-380's lesson applied before the fact.
 * The renderer folds firings with the same audible identity inside 1.5 s into ONE sound
 * (`audioThrottle.ts coalesceAudio`, JOS-347) — which is exactly what a doubled alert looks like.
 * That throttle hid the app-signal double-fire for the entire life of that feature: two firings,
 * one sound, every test green, and only the banner (which is outside the gate by ruling) ever
 * showed it. A spec that counted utterances against a coalescing def would therefore report ONE
 * whether the cutover worked or not, which is the most expensive kind of green there is.
 *
 * So the probe def carries `alwaysPlay: true` — the per-alert opt-out the throttle already honours
 * (`coalesceAudio`'s first line) — and nothing else about it is unusual. With the window off, the
 * TS evaluator and the engine both publishing would produce TWO entries on the speech ring, and the
 * assertion "exactly one" becomes a real measurement instead of a restatement of the throttle.
 *
 * ── WHY IT ASSERTS THROUGH THE SPEECH SEAM ─────────────────────────────────────────────────────
 *
 * `lib/speech.ts` records every utterance on `window.__eqSpeech` with an `uttered` flag and returns
 * BEFORE touching any engine whenever `window.eq.isE2E` — the suite's existing audio observation
 * seam (voice-alerts.e2e.mts owns it). So the probe alert speaks rather than playing a pack sound:
 * the ring is countable, the text identifies the firing, and `uttered === false` proves this run
 * made no noise on a machine the owner may be playing on. A pack sound has no such ring — it is a
 * fresh `<audio>` element and a blob URL — which is why the seam is the speech one.
 *
 * THE PHRASE CARRIES NO `{token}`. A fire frame has four fields and captures are not among them
 * (alertsAudioRules.ts names the gap), so a def whose phrase asked for one would be asserting the
 * gap rather than the cutover.
 *
 * ── WHY IT WAITS FOR THE PARITY LINE ───────────────────────────────────────────────────────────
 *
 * The engine fires on LIVE events only — "replay must never make a sound" is the same boundary law
 * on both sides — so a line appended while its fold is still historical is a line that correctly
 * makes no sound. The parity sentence is the app's own statement that both worlds landed on the
 * same log AND the engine's ingest went live, which is precisely the precondition, and it is the
 * signal `engine-shim.e2e.mts` already waits on rather than a second readiness invented here.
 *
 * Run: `npm run test:e2e -- engine-alert-fires`
 */
import type { Page } from 'playwright-core'
import { buildEngineIfStale, buildIfStale, check, failures, note, reportRun } from './appHarness.mjs'
import { closeWindows, mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { settleParity, tapOutput, type AppOutput } from './engineSteps.mjs'
import { settle, sleep } from './settle.mjs'

/** The same staged fixture the other two engine specs fold — a committed log, privately copied,
 *  which this spec then APPENDS to (they do not). Every fight in it is dated Aug 2026, so the
 *  historical fold is finite and the line this spec writes is unambiguously the live one. */
const FIXTURE = 'e2e-overlay.log'

const PROBE_ID = 'e2e:engine-fire-probe'
/** The def's LABEL, which is what a fire frame names it by (`FireMessage.rule`). */
const PROBE_NAME = 'Engine fire probe'
/** What the alert says. No `{token}`: a fire frame carries no captures — see the header. */
const PHRASE = 'Engine fire probe heard it'

/**
 * THE LINE, and it is the owner's own — verbatim from eqlog_Primitive_freeport.txt (a shaman named
 * Fail casting Spirit of the Puma in Freeport, 2026-08-01), the same one voice-alerts.e2e.mts
 * drives its live-tail step with. Restamped to now by the append driver, because both evaluators
 * fire on LIVE events and the harness owns the clock.
 *
 * REUSED RATHER THAN INVENTED so this spec is not also a bet on whether two independent parsers
 * agree about a sentence nobody has measured: this one is already proven to reach the TypeScript
 * alerts module through the whole chain, and the engine's parser is held byte-identical to it by
 * the equivalence oracle.
 */
const LINE = 'Fail growls with the spirit of the puma.'
/** `ev.raw` carries EQ's own `[timestamp] ` prefix, so the pattern is written unanchored — the
 *  same shape the shipped suggestion templates use. */
const REGEX = 'growls with the spirit of the puma'

/** The app's arm line, verbatim enough to be unmistakable and loose enough to survive a reword of
 *  the tail. `alertsAudioRules.ts armVerdict` is where it is written. */
const ARMED = 'the ENGINE now plays alert audio'
const REFUSED = 'EQC_ENGINE_ALERTS refuses to arm'

interface Spoken {
  text: string
  uttered: boolean
}

/** The speech seam's own ring. `[]` when nothing has ever asked to speak. */
function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(
    () => (window as unknown as { __eqSpeech?: { spoken: Spoken[] } }).__eqSpeech?.spoken ?? []
  ) as Promise<Spoken[]>
}

/** How many times the app said it PLAYED a fire for this rule (engineClientHost.ts `noteFire`). */
function playedLines(out: AppOutput, rule: string): number {
  return out
    .text()
    .split('\n')
    .filter((l) => l.includes('data-server fire:') && l.includes(rule) && l.includes('PLAYED from the engine'))
    .length
}

/**
 * Store the probe def through the app's OWN IPC — the exact call `AlertDialog` makes on save, so
 * this exercises the real store path (and, with it, `pushAppKnowledge('alerts.define')`, which is
 * what hands the engine this def) without driving a five-control form.
 */
async function saveProbe(page: Page): Promise<number> {
  return page.evaluate(
    async ({ id, name, phrase, regex }) => {
      const eq = (window as unknown as { eq: { saveAlert: (d: unknown) => Promise<unknown[]> } }).eq
      const defs = await eq.saveAlert({
        id,
        name,
        enabled: true,
        trigger: { type: 'raw', regex },
        sound: { packId: 'alan-rickman', soundId: 'task-acknowledge-task-acknowledge-05' },
        cooldownMs: 0,
        // THE THROTTLE, OFF FOR THIS DEF ONLY — the header's whole argument. A coalescing def would
        // report one sound whether the cutover worked or not.
        alwaysPlay: true,
        audio: 'speech',
        speech: { mode: 'custom', phrase }
      })
      return defs.length
    },
    { id: PROBE_ID, name: PROBE_NAME, phrase: PHRASE, regex: REGEX }
  )
}

/**
 * Make the renderer's player re-read the defs.
 *
 * It holds its own copy, refreshed on mount and on window FOCUS — and a hidden e2e window is never
 * focused, so a def stored straight through the IPC would be evaluated in main and find no def on
 * the other side. Dispatching the app's own focus event is the honest way to say "re-read now": it
 * is the listener a returning user trips, not a test-only back door. (voice-alerts.e2e.mts does
 * exactly this, for exactly this reason.)
 */
async function refreshPlayer(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  return settle(
    () =>
      page.evaluate(
        (id) =>
          (window as unknown as { eq: { listAlerts: () => Promise<{ id: string }[]> } }).eq
            .listAlerts()
            .then((d) => d.some((a) => a.id === id)),
        PROBE_ID
      ),
    (present) => present,
    { timeoutMs: 15_000 }
  ).catch(() => false)
}

/**
 * THE MEASUREMENT — one appended line, and everything that must and must not follow it.
 *
 * `append` is passed in rather than the whole launch because this step's only power over the world
 * should be to write ONE line into the tailed log; a step holding the launch could restart things
 * between the two readings of the ring and quietly change what "exactly one" was counting.
 */
async function stepOneSound(page: Page, out: AppOutput, append: (at: Date) => void): Promise<void> {
  const before = (await spoken(page)).length
  const playedBefore = playedLines(out, PROBE_NAME)
  append(new Date())

  const ring = await settle(
    () => spoken(page),
    (list) => list.slice(before).some((s) => s.text === PHRASE),
    { timeoutMs: 30_000 }
  ).catch(() => null)
  const heard = ring === null ? [] : ring.slice(before).filter((s) => s.text === PHRASE)
  if (
    !check(
      'a matching LIVE line reaches the speaker — one append, one alert',
      heard.length > 0,
      heard.length === 0 ? `never spoke "${PHRASE}"` : `${String(heard.length)} utterance(s)`
    )
  ) {
    return
  }
  check('…and this channel stayed mute doing it', heard.every((s) => !s.uttered))

  // THE SINGLE-AUDIO BAR. A second publisher's firing lands within milliseconds of the first — the
  // two worlds are reading the same file — but "milliseconds" is not a claim worth resting a
  // regression test on, so the ring is re-read after a real pause. With `alwaysPlay` on this def
  // nothing folds a second sound away, so a count of one is a count of one PUBLISHER.
  await sleep(3_000)
  const after = (await spoken(page)).slice(before).filter((s) => s.text === PHRASE)
  check(
    'EXACTLY ONE SOUND for one matching line — the TS evaluator is silent, not merely coalesced',
    after.length === 1,
    `${String(after.length)} utterance(s) with the throttle off for this def`
  )

  const playedNow = playedLines(out, PROBE_NAME) - playedBefore
  check(
    '…and the sound is ENGINE-ATTRIBUTED: the app placed the fire frame and played it',
    playedNow === 1,
    `${String(playedNow)} "PLAYED from the engine" line(s) for "${PROBE_NAME}"`
  )
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  buildIfStale()
  buildEngineIfStale()

  const launch = await launchOnFixture(FIXTURE, {
    env: { EQC_ENGINE: '1', EQC_ENGINE_SERVE: '1', EQC_ENGINE_ALERTS: '1' }
  })
  const out = tapOutput(launch.app)
  try {
    const page = await mainWindow(launch.app)

    // ── CLAIM 1: the app armed, and said so ────────────────────────────────────────────────────
    //
    // The arm happens inside `startEngineSupervisor`, before the supervisor can reach READY, so by
    // the time a window exists the line is already in the tap. A REFUSAL is reported separately
    // rather than folded into "not armed": the gate refusing is correct behaviour over a store
    // holding an early-warning def, and a run that hit it must say so instead of looking broken.
    const text = out.text()
    if (text.includes(REFUSED)) {
      check(
        'the flag armed on a freshly-seeded store',
        false,
        'the early-warning gate refused — the seeded def set has grown an earlyWarnSec def'
      )
      return
    }
    if (!check('the app hands alert audio to the ENGINE, and narrates the swap', text.includes(ARMED))) {
      return
    }

    // ── the precondition: both worlds on the same log, the engine's ingest live ────────────────
    const parity = await settleParity(out)
    if (
      !check(
        'both worlds landed on the same log and the engine went live — the fire path’s readiness',
        parity !== null,
        parity?.line ?? 'the app never reported a parity run'
      )
    ) {
      return
    }

    // ── the probe def, through the app's own door ──────────────────────────────────────────────
    const stored = await saveProbe(page)
    if (!check('the probe alert saves through the app’s own IPC', stored > 0, `${String(stored)} defs stored`)) {
      return
    }
    if (!check('…and the renderer’s player has re-read the def set', await refreshPlayer(page))) return

    // THE DEFINE IS A ROUND TRIP THE SAVE DOES NOT WAIT ON. `pushAppKnowledge` is voided by design
    // (a preference write is answered by the app's own state, never by the engine), so the ack is
    // what says the engine is now holding this def — and appending before it lands would be a race
    // this spec would lose intermittently rather than a claim it could make.
    const defined = await settle(
      () => Promise.resolve(out.text().includes('data-server define: alerts.define')),
      (seen) => seen,
      { timeoutMs: 20_000 }
    ).catch(() => false)
    if (!check('the engine acknowledged the def push', defined)) return

    // ── CLAIM 2 + 3: one line in, exactly one sound out, and it is the engine's ────────────────
    await stepOneSound(page, out, (at) => launch.log.appendAt(at, LINE))

    await closeWindows(launch.app)
  } finally {
    await launch.close()
  }

  if (failures.length === 0) {
    note('one live line under EQC_ENGINE_ALERTS=1 produced exactly one sound, and the engine made it')
    note('the app-side evaluator still matched and still spent its cooldown clock — it simply published nothing')
  }
}

await main()
reportRun()
