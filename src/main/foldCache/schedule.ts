// ============================================================================
// schedule.ts — WHEN A CHECKPOINT IS WRITTEN (JOS-208 phase 3).
// ============================================================================
//
// PHASE 1 WROTE ONLY ON THE CLEAN-QUIT PATHS, and that was a real defect rather than a tuning
// choice. The owner turned the preference on, restarted his dev app several times over a day, and
// got no speedup and no file — because electron-vite's watcher KILLS its child and relaunches it,
// so neither `window-all-closed` nor `before-quit` ever fires. The same hole swallows a crash, an
// OS kill, and a machine losing power. A feature whose entire payoff depends on a graceful exit is
// a feature that is off on exactly the launches that hurt most.
//
// SO THERE ARE THREE WRITES NOW, and each answers a different failure:
//
//   'replay' — moments after the historical fold finishes. The fold has just been computed, so it
//              is remembered RIGHT THERE. This is the write that survives being killed: from here
//              on, this launch has already left the next one a checkpoint.
//   'quiet'  — periodically, at idle moments, once enough has happened to be worth rewriting. A
//              six-hour session would otherwise leave the next launch a six-hour tail.
//   'quit'   — unchanged, synchronous, the freshest possible final word (attach.ts `saveFold`).
//
// THE WRITE TIMING IS STILL A PRAGMATIC, NOT A CORRECTNESS NEED. The design's uniform-state ruling
// says a checkpoint at any byte position is as valid as one at any other, so nothing below can make
// the app WRONG — the worst a bad schedule can do is write too often (cost) or too rarely (a longer
// tail). That is what lets the policy be this simple.
//
// "IDLE" IS MEASURED WITHOUT A CLOCK IN THE FOLD. The obvious idleness test — "no event for N
// seconds" — would need a `Date.now()` on the per-event path, which is both the app's hottest loop
// and a wall-clock read inside a fold path (the determinism audit's subject). So idleness is read
// from the TAILER'S OFFSET instead: if the end of the last complete line has not moved between two
// checks a whole interval apart, nothing has been logged for a whole interval, and that is an idle
// moment by any definition worth having. It costs nothing and reads a number that already exists.

import { logError } from '../errorLog'
import { foldCacheEnabled, saveFoldAsync } from './attach'
import { CHECKPOINT_AFTER_REPLAY_MS, QUIET_CHECK_INTERVAL_MS, quietWriteDue } from './policy'
import type { CharacterRef } from '../../shared/types'

/**
 * WHERE THE FOLD IS RIGHT NOW, asked rather than imported.
 *
 * `session.ts` owns the tailer, the character and the seq counter, and it already imports this
 * feature — so the dependency runs one way and this module never learns what a Tailer is. It is
 * also what makes the schedule testable: three functions is the whole surface.
 */
export interface CheckpointSource {
  /** The character being tailed, or null when there is none. */
  ref: () => CharacterRef | null
  /** `Tailer.checkpointOffset()` — the end of the last COMPLETE line the live tail emitted. */
  offset: () => number
  /** The fold's `seq` at that offset. Read in the same turn as `offset`. */
  seq: () => number
}

let source: CheckpointSource | null = null
let quietTimer: ReturnType<typeof setInterval> | null = null
let replayTimer: ReturnType<typeof setTimeout> | null = null
/** The tail's offset at the previous quiet check — the idleness test's other half. */
let previousOffset = -1
/** The offset and instant of the last checkpoint this session wrote. */
let writtenOffset = 0
let lastWriteMs = 0
/** One write at a time: a slow disk must not queue a second serialization behind the first. */
let writing = false

/**
 * Install the schedule for a session. Idempotent per source; a character switch calls it again with
 * the same accessors and the bookkeeping starts over, which is correct — the new character's cache
 * is a different file and has never been written this session.
 *
 * NOTHING RUNS WHEN THE FLAG IS OFF — not a timer, not a `stat`. Same rule attach.ts states for the
 * event probe: a feature that is off by default must cost nothing by default.
 */
export function startCheckpointSchedule(src: CheckpointSource): void {
  stopCheckpointSchedule()
  if (!foldCacheEnabled()) return
  source = src
  previousOffset = -1
  writtenOffset = 0
  lastWriteMs = Date.now()
  // The write that makes this survive being killed. A timer rather than a straight call, so the
  // renderer's first paint owns the milliseconds right after the fold.
  replayTimer = setTimeout(() => {
    replayTimer = null
    void write('replay')
  }, CHECKPOINT_AFTER_REPLAY_MS)
  replayTimer.unref()
  quietTimer = setInterval(() => {
    void quietTick()
  }, QUIET_CHECK_INTERVAL_MS)
  quietTimer.unref()
}

/** Tear the schedule down — a character switch, or the way out. Safe to call more than once. */
export function stopCheckpointSchedule(): void {
  if (replayTimer !== null) clearTimeout(replayTimer)
  if (quietTimer !== null) clearInterval(quietTimer)
  replayTimer = null
  quietTimer = null
  source = null
}

/** One evaluation of the quiet-point rule. */
async function quietTick(): Promise<void> {
  const src = source
  if (src === null || writing) return
  const offset = src.offset()
  const due = quietWriteDue({
    offset,
    previousOffset,
    writtenOffset,
    nowMs: Date.now(),
    lastWriteMs
  })
  previousOffset = offset
  if (due) await write('quiet')
}

/**
 * One write. Reads the offset and the seq in the SAME turn it hands them to `saveFoldAsync`, which
 * serializes the modules before its first `await` — so the container's three claims (this state, at
 * this byte, at this seq) describe one instant.
 */
async function write(origin: 'replay' | 'quiet'): Promise<void> {
  const src = source
  if (src === null || writing) return
  const ref = src.ref()
  const offset = src.offset()
  const seq = src.seq()
  if (ref === null || offset <= 0) return
  writing = true
  try {
    if (await saveFoldAsync(ref, offset, seq, origin)) {
      writtenOffset = offset
      lastWriteMs = Date.now()
    }
  } catch (err) {
    // A checkpoint that cannot be written is never a reason to disturb a running session — the
    // next launch simply cold-reads, which is the app this repo shipped for a year.
    logError('main:foldCheckpoint', { message: `${origin} checkpoint write failed`, err })
  } finally {
    writing = false
  }
}
