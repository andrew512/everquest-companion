// BARD SONG PULSES: the reconstruction, and the four rules it obeys (JOS-382).
//
// `SongPulses` is a state machine over timestamps and nothing else, so it is driven here directly
// rather than through a log fixture — and it HAS to be, because the owner's log contains exactly
// five `You begin singing` lines in two million, all of one song inside one twenty-second window,
// with no resist or landing for it anywhere near them. There is no committed window that exercises
// interpolation, and inventing one would be authoring a shape no log has printed. What the tests
// below assert are the RULES, stated in the units the rules are stated in.
//
// The bias direction is what makes the rules safe, and it is asserted too: nothing is extrapolated
// past the edges of a run, and a restart inside a gap forfeits the interpolation before it. Both
// under-count, which biases R upward - toward "more resistant", the direction whose cost is being
// told to use a different spell rather than being told a hard mob is easy.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SONG_PULSE_MS,
  SONG_RUN_GAP_MS,
  SongPulses,
  type SongPulse
} from '../src/main/resist/songs'

function collect(): { pulses: SongPulse[]; songs: SongPulses } {
  const pulses: SongPulse[] = []
  const songs = new SongPulses((p) => pulses.push(p))
  return { pulses, songs }
}

const at = (pulses: readonly SongPulse[]): number[] => pulses.map((p) => p.ts)

test('RULE 1: a pulse the log printed something for is witnessed, once', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 1000, 'a kodiak')
  // Everything inside a second of the first line is the SAME pulse: a point-blank song that
  // resists on three mobs prints three lines for one roll each, at one instant.
  songs.witness('lullaby', 1400, 'a young kodiak')
  songs.witness('lullaby', 1900, null)
  songs.flush()
  assert.equal(pulses.length, 1)
  assert.equal(pulses[0].witnessed, true)
  assert.deepEqual([...pulses[0].resisted].sort(), ['a kodiak', 'a young kodiak'])
})

test('RULE 2: interior pulses between two witnesses under 30 s apart are counted', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 0, 'a kodiak')
  songs.witness('lullaby', 4 * SONG_PULSE_MS, 'a kodiak')
  songs.flush()
  // Two witnessed pulses 24 s apart: the three at 6, 12 and 18 s demonstrably happened.
  assert.deepEqual(at(pulses), [0, SONG_PULSE_MS, 2 * SONG_PULSE_MS, 3 * SONG_PULSE_MS, 4 * SONG_PULSE_MS])
  assert.deepEqual(
    pulses.map((p) => p.witnessed),
    [true, false, false, false, true]
  )
  // An interpolated pulse names nobody: the log said nothing about it, so it resisted nobody.
  for (const p of pulses) {
    if (!p.witnessed) assert.equal(p.resisted.size, 0)
  }
})

test('RULE 2: a gap wider than 30 s is TWO runs, and nothing spans it', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 0, 'a kodiak')
  songs.witness('lullaby', SONG_RUN_GAP_MS + SONG_PULSE_MS, 'a kodiak')
  songs.flush()
  // The song may simply have stopped. Extrapolating across the gap is the one way this
  // reconstruction could OVER-count, so it does not.
  assert.deepEqual(at(pulses), [0, SONG_RUN_GAP_MS + SONG_PULSE_MS])
})

test('RULE 2: nothing is extrapolated before the first or after the last witness', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 60_000, 'a kodiak')
  songs.flush()
  // One witness is one pulse. The edges of a run are exactly where "it might have stopped" lives.
  assert.deepEqual(at(pulses), [60_000])
})

test('RULE 2: a restart inside the gap re-anchors, and drops what came before it', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 0, 'a kodiak')
  // `You begin singing Kelin's Lucid Lullaby.` at 15 s: whatever ran before it, this run began
  // here, so the pulses at 6 and 12 s are forfeited and only the one at 18 s is interpolated.
  songs.noteSing('lullaby', 15_000)
  songs.witness('lullaby', 4 * SONG_PULSE_MS, 'a kodiak')
  songs.flush()
  assert.deepEqual(at(pulses), [0, 3 * SONG_PULSE_MS, 4 * SONG_PULSE_MS])
})

test('two songs twist independently - a bard runs four at once', () => {
  const { pulses, songs } = collect()
  songs.witness('lullaby', 0, 'a kodiak')
  songs.witness('chords', 3000, 'a kodiak')
  songs.witness('lullaby', 2 * SONG_PULSE_MS, 'a kodiak')
  songs.flush()
  const lullaby = pulses.filter((p) => p.spellKey === 'lullaby')
  const chords = pulses.filter((p) => p.spellKey === 'chords')
  // Starting another song does NOT end the previous one, so one song's run must never close
  // another's - which is exactly why "still singing" cannot be read off the cast lines.
  assert.deepEqual(at(lullaby), [0, SONG_PULSE_MS, 2 * SONG_PULSE_MS])
  assert.deepEqual(at(chords), [3000])
})

test('SETTLE closes a pulse without ending its run; FLUSH ends both', () => {
  const settled = collect()
  settled.songs.witness('lullaby', 0, 'a kodiak')
  // The live tail's heartbeat, one second later: the pulse can gain no more witnesses and is
  // decided, but the bard is mid-rotation and the run is still open.
  settled.songs.settle(2000)
  assert.deepEqual(at(settled.pulses), [0])
  settled.songs.witness('lullaby', 2 * SONG_PULSE_MS, 'a kodiak')
  settled.songs.settle(2 * SONG_PULSE_MS + 2000)
  assert.deepEqual(at(settled.pulses), [0, SONG_PULSE_MS, 2 * SONG_PULSE_MS], 'the run survived the tick')

  const flushed = collect()
  flushed.songs.witness('lullaby', 0, 'a kodiak')
  flushed.songs.flush()
  flushed.songs.witness('lullaby', 2 * SONG_PULSE_MS, 'a kodiak')
  flushed.songs.flush()
  // A zone change is a real discontinuity: the run ended, so no interpolation crosses it.
  assert.deepEqual(at(flushed.pulses), [0, 2 * SONG_PULSE_MS])
})

test('the pulse interval is the measured one, and the run gap is the stated one', () => {
  // Guarded because both numbers are MEASUREMENTS, not preferences: consecutive song resists on
  // one mob in the owner's log are 6, 12, 18 and 24 s apart. Changing either changes what the
  // reconstruction claims, and should be a measurement too.
  assert.equal(SONG_PULSE_MS, 6_000)
  assert.equal(SONG_RUN_GAP_MS, 30_000)
})
