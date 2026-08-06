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
 * THE UNBOUND PET, SCRIPTED (JOS-49) — an entity the log never says is yours, fighting what you
 * are fighting, which the meter must show NOTHING about until you order it.
 *
 * The blind spot is an accepted, documented non-distinguishable now (AGENTS.md world-model law
 * 6). JOS-47 shipped a question here — "<Name> — your pet?", with Yes/No above the bars — and
 * the owner cut it: "if you just have to pet attack once, this is a lot of work we can get
 * wrong." So this pull exists to be INVISIBLE, and `playPetOrder` below is the cure.
 *
 * EVERY SHAPE IS REAL. The pet's melee lines are Jaber's, verbatim in form
 * (`Jaber slashes a greater kobold for 21 points of damage.` — tests/fixtures/p2-pet-arc-bound.log),
 * the tell is the shape `/pet attack` produces, and `Following you, Master.` is one of the six
 * pet-voiced sentences the whole-log sweep enumerated (shared/logScrub.ts PET_SAY_LINES) — kept
 * here precisely because it must NOT bind anything: `says` is broadcast. Both mobs are ones the
 * owner's log has him fighting in Nagafen's Lair, which is the fixture's own zone.
 *
 * Neither driver writes a killing blow: the fight stays OPEN so the assertions read a live meter.
 */
export const PET_NAME = 'Vebarn'

/** The second mob the pet works on — Nagafen's Lair, like `PULL_TARGET`. */
export const PET_SECOND_TARGET = 'a greater kobold'

/** Every line `playPetPull` writes — stated so the caller asserts a number, not a hope. */
export const PET_PULL_LINES = 6

/** Σ of the pet's UNBOUND hits. Nothing in the app may ever show this number. */
export const PET_UNBOUND_DAMAGE = 21 + 52 + 46

/** Play an unbound pet fighting beside you, and leave the fight open. Returns lines written. */
export function playPetPull(log: FixtureLog): number {
  const now = Date.now()
  const petHit = (verb: string, target: string, amount: number): string =>
    `${PET_NAME} ${verb} ${target} for ${String(amount)} points of damage.`
  let written = 0
  written += log.appendAt(new Date(now - 3000), `You crush ${PET_SECOND_TARGET} for 37 points of damage.`)
  written += log.appendAt(new Date(now - 2000), petHit('slashes', PET_SECOND_TARGET, 21))
  written += log.appendAt(new Date(now - 1000), petHit('cleaves', PET_SECOND_TARGET, 52))
  written += log.appendAt(new Date(now - 1000), `You crush ${PULL_TARGET} for 41 points of damage.`)
  written += log.appendAt(new Date(now), petHit('slashes', PULL_TARGET, 46), `${PET_NAME} says, 'Following you, Master.'`)
  return written
}

/** Every line `playPetOrder` writes. */
export const PET_ORDER_LINES = 2

/** The one hit the pet lands AFTER its tell — and therefore the whole of its meter row, because
 *  a tell binds FORWARD from its own timestamp and never reaches back (measured, JOS-49). */
export const PET_BOUND_DAMAGE = 63

/**
 * ORDER THE PET — `/pet attack`, and the private tell it answers with. This is the entire
 * feature: the one line in this log that says a summoned pet is yours.
 */
export function playPetOrder(log: FixtureLog): number {
  const now = Date.now()
  let written = 0
  written += log.appendAt(new Date(now), `${PET_NAME} told you, 'Attacking ${PULL_TARGET} Master.'`)
  written += log.appendAt(
    new Date(now + 1000),
    `${PET_NAME} slashes ${PULL_TARGET} for ${String(PET_BOUND_DAMAGE)} points of damage.`
  )
  return written
}

/**
 * The self `/who` row — the ONE line the log ever prints that states the class loadout
 * (AGENTS.md: keyed on the tailed character's name, never a constant; the scrub exempts the
 * user's own row for exactly this reason).
 *
 * Played live rather than baked into a fixture because it is EVIDENCE the combo module folds
 * with a timestamp: a row from five days ago competes with everything since, and what the
 * "New at this level" panel needs is a loadout resolved for NOW. The shape is copied verbatim
 * from the real log's own row (`[50 PAL/MNK/ENC] Primitive (Dark Elf)  ZONE: …`).
 */
export function playWho(log: FixtureLog): number {
  return log.append('[50 PAL/MNK/ENC] Primitive (Dark Elf)  ZONE: East Freeport (freportn)')
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
