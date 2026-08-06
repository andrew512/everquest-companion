/**
 * gameplay.mts — THE SCRIPTED PULL: live play, written by the harness, in the log's own words.
 *
 * WHY (docs/plans/e2e-parallel.md, wave E2). The combat spec used to wait up to 45 SECONDS for the
 * owner to happen to be fighting something (`LIVE_LINE_WAIT_MS`), and then asserted a floor —
 * "some lines arrived" — because nobody can say in advance what a real player is about to do. With
 * a fixture the harness owns the log file, so it can simply PLAY: append whole timestamped lines
 * to the file the app is tailing and watch them travel the real path (chokidar → Tailer →
 * parseEvent → LogBus → engine → IPC → render). Nothing is mocked and nothing is skipped.
 *
 * WHAT THAT BUYS: EXACT NUMBERS. The pull below lands ten stated hits over four stated seconds, so
 * the fight it opens has a damage total this file can name (442) and a duration the engine can
 * divide by. An assertion can say `outTotal === PULL_DAMAGE` instead of `outTotal > 0`.
 *
 * EVERY LINE SHAPE IS COPIED FROM THE REAL LOG, never invented (AGENTS.md's awaiting-sample law):
 *   `You crush a fire giant warrior for 37 points of damage.`
 *   `You try to slash a fire giant warrior, but a fire giant warrior parries!`
 *   `You gain experience! (1.23%)`
 *   `You have slain a fire giant warrior!`
 * The MOB is one the fixtures' own zone contains, and the exp line PRECEDES the slain line in the
 * same burst because that is the order the game prints them in (AGENTS.md log-format reference —
 * the join consumes the pending exp line at the next credited kill and never searches forward).
 */

import type { FixtureLog } from './logFixture.mjs'

/** The mob every scripted pull is against. */
export const PULL_TARGET = 'a fire giant warrior'

/** The ten hits, in order. Stated here so an assertion can state their sum. */
export const PULL_HITS = [37, 41, 53, 29, 61, 44, 58, 33, 47, 39] as const

/** Σ PULL_HITS — the fight's outgoing damage total, exactly. */
export const PULL_DAMAGE = PULL_HITS.reduce((n, d) => n + d, 0)

/** How many seconds of log time the pull spans (first swing to killing blow). */
export const PULL_SECONDS = 4

const swing = (verb: string, amount: number): string =>
  `You ${verb} ${PULL_TARGET} for ${String(amount)} points of damage.`

/**
 * The three bursts, and the offset (in seconds BEFORE `now`) each is stamped at. Past stamps, so
 * the fight has a real duration the instant it is written; the tail delivers them live either way
 * (liveness is where a line arrived from, not what its clock says).
 */
function bursts(): { back: number; lines: string[] }[] {
  const hits = [...PULL_HITS]
  return [
    {
      back: PULL_SECONDS,
      lines: [
        swing('crush', hits[0]),
        swing('slash', hits[1]),
        // A swing that lands NOTHING: misses are first-class and damage-free (world-model law 8),
        // so this must move the hit-rate and leave every damage total byte-identical.
        `You try to slash ${PULL_TARGET}, but ${PULL_TARGET} parries!`,
        swing('crush', hits[2])
      ]
    },
    {
      back: 2,
      lines: [swing('slash', hits[3]), swing('crush', hits[4]), swing('slash', hits[5]), swing('crush', hits[6])]
    },
    {
      back: 0,
      lines: [
        swing('slash', hits[7]),
        swing('crush', hits[8]),
        swing('slash', hits[9]),
        'You gain experience!  (1.23%)',
        `You have slain ${PULL_TARGET}!`
      ]
    }
  ]
}

/** Every line the pull writes — the number an assertion counts the combat ring against. */
export const PULL_LINES = bursts().reduce((n, b) => n + b.lines.length, 0)

/**
 * Play the pull into `log`, and hand back how many lines were written.
 *
 * `settleBetween` is awaited between bursts: the caller passes the condition it wants observed
 * (usually "the ring grew"), so the driver never sleeps on its own behalf.
 */
export async function playPull(
  log: FixtureLog,
  settleBetween: () => Promise<unknown> = async () => undefined
): Promise<number> {
  const now = Date.now()
  let written = 0
  for (const b of bursts()) {
    written += log.appendAt(new Date(now - b.back * 1000), ...b.lines)
    await settleBetween()
  }
  return written
}

/**
 * A credited kill and nothing else — the smallest thing that fills a progression window.
 *
 * The Overview's leveling tiles read the LAST HOUR of log time, and a fixture cut from last
 * night's play has none: this puts a real, dated kill inside the window so the panel's tiles are
 * ASSERTED rather than noted.
 */
export function playKill(log: FixtureLog): number {
  return log.append('You gain experience!  (2.50%)', `You have slain ${PULL_TARGET}!`)
}
