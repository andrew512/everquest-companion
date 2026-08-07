// MANUAL LOADOUT OVERRIDE — the precedence rules (JOS-87).
//
// The report behind this ticket: a user who plays SHD/ROG/DRU had the app deciding SHD/NEC, and
// said there was no way to correct it. A correction surface already shipped; what did not exist
// was a control that speaks in the present tense ("these are my classes"), and — measured here —
// what did not HOLD was the override itself, because the rule that applied it looked at exactly
// one instant and the intervals under it move.
//
// SO THIS FILE PINS THE PRECEDENCE, not the wording and not the inference. Four claims:
//
//   1. AN OVERRIDE BEATS AUTODETECTION. Same observations, same everything, one correction:
//      the slots come back stated rather than scored, and `userLocked` says re-inference will
//      not touch them.
//   2. AN OVERRIDE SURVIVES THE BOUNDARY IT WAS ANCHORED TO. This is the regression. A
//      correction is written against the interval the user was looking at (`startTs` = that
//      interval's cut), and intervals are rebuilt from scratch on every fold — the boundary can
//      be gone one event later, and then the slice covering *now* begins BEFORE the correction.
//      Under the old point-in-time rule the override silently vanished and inference reclaimed
//      the display with no UI event at all: precisely "autodetect overwrote my override".
//      `correctionForSlice`'s greatest-overlap fallback is the repair, and the two builds below
//      differ ONLY in whether that boundary exists.
//   3. A `/who` ROW STILL OUTRANKS AN OVERRIDE — and is no longer silent about it. `/who` is
//      the game stating the loadout, not autodetection, so § 4.4's order stands; what changed is
//      that the interval carries `userOverruled` so the surface can say a manual setting is not
//      in effect here instead of just showing different classes.
//   4. RESTART. The module holds no durable combo state (intervals are re-derived from the log
//      every replay), so a restart IS: fresh module, corrections handed back by the store's
//      provider, every event replayed. Asserted as that, because that is what the app does.
//      The on-disk half — `byCharacter[*].combo.corrections` surviving a version bump — is
//      pinned by tests/storeMigrations.test.mts and deliberately not re-asserted here.
//
// PURE AND UNSKIPPABLE. Everything below is synthetic observations through `buildIntervals` and
// `ComboModule`; no fixture, no log, no Electron. Fixture-backed behaviour of the same code
// lives in tests/comboWindows.test.mts and is untouched by this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIntervals, correctionForSlice } from '../src/main/modules/comboIntervals'
import { ComboModule } from '../src/main/modules/combo'
import { LAUNCH_MS } from '../src/main/log/epochDetector'
import { parseEvent } from '../src/main/log/parser'
import { installCharacterName, installSpellDb } from '../src/main/log/rulesets'
import { loadSpellDb } from '../src/main/data/spellDb'
import {
  resolvedClasses,
  type ClassAbbr,
  type ClassObservation,
  type ComboCorrection,
  type ComboInterval
} from '../src/shared/classCombo'
import { readFixture } from './harness.mts'

const HOUR = 3_600_000

/** Well clear of the launch epoch, so nothing here is dropped as beta-character state. */
const T0 = LAUNCH_MS + 240 * HOUR

/** The cut a level ding puts in, 6 h after the log starts. Interval 2 opens here. */
const CUT = T0 + 6 * HOUR

let seq = 0

/**
 * One observation. `skillUp` because it is the source with the cleanest semantics for a test —
 * a class skill naming exactly one class — and the WEIGHT is irrelevant to every assertion
 * here: nothing below asserts what inference concluded, only that it was inference.
 */
function obs(ts: number, label: string, candidates: ClassAbbr[]): ClassObservation {
  return { ts, seq: seq++, source: 'skillUp', label, candidates, weight: 3 }
}

/**
 * Two hours of evidence for one class, two distinct hourly buckets and two distinct labels —
 * the bar `exclusiveSpans` and `scoreSlots` both use for "this class was actually present".
 */
function present(start: number, cls: ClassAbbr): ClassObservation[] {
  return [
    obs(start, `${cls}-a`, [cls]),
    obs(start + HOUR, `${cls}-b`, [cls]),
    obs(start + HOUR + 60_000, `${cls}-c`, [cls])
  ]
}

/** MNK+NEC before the cut, MNK+WIZ after it — a shape autodetection has an opinion about. */
function observations(): ClassObservation[] {
  seq = 0
  return [
    ...present(T0, 'MNK'),
    ...present(T0 + 2 * HOUR, 'NEC'),
    ...present(CUT, 'MNK'),
    ...present(CUT + 2 * HOUR, 'WIZ')
  ].sort((a, b) => a.seq - b.seq)
}

/** The classes the reporter actually plays — never inferable from the observations above. */
const MINE: ClassAbbr[] = ['SHD', 'ROG', 'DRU']

const override = (startTs: number, classes = MINE): ComboCorrection => ({
  startTs,
  endTs: null,
  classes,
  setAt: T0 + 100 * HOUR
})

/** A non-increasing ding pair, which is the only thing that says "a swap happened" here. */
const DINGS = [
  { ts: T0 + 30 * 60_000, level: 42 },
  { ts: CUT, level: 42 }
]

const build = (opts: {
  corrections?: ComboCorrection[]
  levels?: { ts: number; level: number }[]
  whoRows?: { ts: number; seq: number; classes: ClassAbbr[]; level: number }[]
}): ComboInterval[] =>
  buildIntervals({
    observations: observations(),
    whoRows: opts.whoRows ?? [],
    levels: opts.levels ?? DINGS,
    corrections: opts.corrections ?? []
  })

const last = (intervals: ComboInterval[]): ComboInterval => intervals[intervals.length - 1]
const codes = (interval: ComboInterval): string[] => interval.slots.map((s) => s.candidates.join('|'))

// ---------------------------------------------------------------------------
// correctionForSlice — the rule itself, in isolation.
// ---------------------------------------------------------------------------

test('correctionForSlice: covering wins, then greatest overlap, then latest setAt', () => {
  const covering: ComboCorrection = { startTs: 100, endTs: 400, classes: ['PAL'], setAt: 1 }
  const overlapping: ComboCorrection = { startTs: 250, endTs: 900, classes: ['ROG'], setAt: 99 }

  // Rule 1 is unchanged and is checked FIRST — a later correction that merely overlaps does not
  // displace one that actually covers the slice's start.
  assert.equal(correctionForSlice([covering, overlapping], 200, 500), covering)

  // Rule 2: nothing covers 500, so the one with the most claim on [500, 800) governs. Without
  // it this slice falls through to inference, which is the whole defect.
  assert.equal(correctionForSlice([covering, overlapping], 500, 800), overlapping)

  // An OPEN-ENDED correction reaches every later slice, covering or not — that is what "from
  // here onward" has to mean for an override the user expects to stay set.
  const open: ComboCorrection = { startTs: 1_000, endTs: null, classes: ['DRU'], setAt: 5 }
  assert.equal(correctionForSlice([open], 500, null), open, 'overlaps [500, ∞)')
  assert.equal(correctionForSlice([open], 2_000, null), open, 'covers 2000')

  // Equal overlap ⇒ the later statement wins, the same tie-break the covering branch uses.
  const a: ComboCorrection = { startTs: 0, endTs: 1_000, classes: ['WAR'], setAt: 1 }
  const b: ComboCorrection = { startTs: 0, endTs: 1_000, classes: ['BER'], setAt: 2 }
  assert.equal(correctionForSlice([a, b], 2_000, 3_000), null, 'no overlap is no correction')
  assert.equal(correctionForSlice([a, b], 500, 800), b)

  assert.equal(correctionForSlice([], 0, null), null)
})

// ---------------------------------------------------------------------------
// Claim 1 — the override beats autodetection.
// ---------------------------------------------------------------------------

test('a manual override replaces the autodetected loadout and locks it', () => {
  const detected = last(build({}))
  assert.ok(
    detected.slots.every((s) => s.provenance === 'inferred'),
    'without an override the current loadout is inference'
  )
  assert.equal(detected.userLocked, false)
  assert.notDeepEqual(codes(detected), MINE, 'and it is not what the user actually plays')

  const set = last(build({ corrections: [override(CUT)] }))
  assert.deepEqual(codes(set), MINE)
  for (const slot of set.slots) {
    assert.equal(slot.provenance, 'user')
    assert.equal(slot.confidence, 1, 'a stated loadout is not a probability')
  }
  assert.equal(set.userLocked, true, 're-inference must not touch a slot the user set')
  assert.equal(set.userOverruled, undefined, 'nothing overrode it')
  assert.equal(set.expectedSlots, 3, 'arity comes from what the user picked')

  // A two-class override is a two-slot loadout, not three with a hole.
  const pair = last(build({ corrections: [override(CUT, ['SHD', 'ROG'])] }))
  assert.deepEqual(codes(pair), ['SHD', 'ROG'])
  assert.equal(pair.expectedSlots, 2)
})

// ---------------------------------------------------------------------------
// Claim 2 — THE REGRESSION. The boundary the override was anchored to disappears.
// ---------------------------------------------------------------------------

test('an override survives the boundary it was anchored to disappearing', () => {
  // The user sees two intervals and corrects the current one, so the correction is written at
  // CUT — the only anchor the UI has.
  const anchored = build({ corrections: [override(CUT)] })
  assert.ok(anchored.length >= 2, 'the ding pair cut the timeline in two')
  assert.equal(anchored[anchored.length - 1].startTs, CUT)
  assert.deepEqual(codes(last(anchored)), MINE)

  // Now the same evidence with that ding gone — a recompute in which the boundary the
  // correction names is no longer where an interval starts. The slice covering "now" begins at
  // T0, BEFORE the correction, so the old point-in-time lookup returned null here and the
  // display quietly reverted to inference.
  const moved = build({ corrections: [override(CUT)], levels: [DINGS[0]] })
  assert.equal(moved.length, 1, 'the boundary really is gone in this build')
  assert.equal(moved[0].startTs, T0)
  assert.deepEqual(codes(moved[0]), MINE, 'the override still governs the span it overlaps')
  assert.equal(moved[0].userLocked, true)

  // The control it is measured against: same build, no correction, and inference wins.
  const bare = build({ levels: [DINGS[0]] })
  assert.ok(bare[0].slots.every((s) => s.provenance === 'inferred'))
  assert.notDeepEqual(codes(bare[0]), MINE)
})

test('an override reaches a swap detected AFTER it was set', () => {
  // `endTs: null` means "from here onward": a boundary that opens later is still the user's
  // loadout until they say otherwise. An override that expired at the next inferred swap would
  // hand the display straight back to the detection that was wrong.
  const built = build({ corrections: [override(T0)] })
  for (const interval of built) {
    assert.deepEqual(codes(interval), MINE)
    assert.equal(interval.userLocked, true)
  }
})

// ---------------------------------------------------------------------------
// Claim 3 — /who still wins, and says so.
// ---------------------------------------------------------------------------

test('a /who row outranks an override and the interval carries the notice', () => {
  const row = { ts: CUT + HOUR, seq: 10_000, classes: ['PAL', 'MNK', 'ENC'] as ClassAbbr[], level: 42 }
  const built = build({ corrections: [override(CUT)], whoRows: [row] })
  const current = last(built)

  assert.deepEqual(codes(current), ['PAL', 'MNK', 'ENC'], 'the game stated it (§ 4.4)')
  for (const slot of current.slots) assert.equal(slot.provenance, 'who')
  assert.equal(current.userLocked, false)
  assert.equal(current.userOverruled, true, 'the loss is in the model, not swallowed')

  // A /who row that AGREES is not an overrule — there is nothing to tell the user about.
  const agreeing = { ...row, classes: MINE }
  const agreed = last(build({ corrections: [override(CUT)], whoRows: [agreeing] }))
  assert.deepEqual(codes(agreed), MINE)
  assert.equal(agreed.userOverruled, undefined)

  // And an interval nobody overrode never grows the field at all — the delta transport diffs
  // intervals by JSON.stringify, so an unconditional `false` would re-send every interval.
  assert.equal(
    Object.prototype.hasOwnProperty.call(last(build({})), 'userOverruled'),
    false,
    'absent, not false'
  )
})

// ---------------------------------------------------------------------------
// Claim 4 — restart, and "back to autodetect".
// ---------------------------------------------------------------------------

/**
 * A whole module life: fresh instance, the store's provider installed, REAL log bytes replayed
 * through the REAL parser. That is what a restart is — the module keeps nothing durable of its
 * own (§ 7: intervals are re-derived every replay, corrections are the only persisted state),
 * so "does the override come back" is exactly "does a new module built this way show it".
 *
 * The fixture is the Aug 2 loadout swap comboWindows already pins, chosen because inference has
 * a strong and DIFFERENT opinion about it (MNK out, ROG+BER in) — an override that matched what
 * detection was going to say anyway would prove nothing.
 */
function restart(stored: () => readonly ComboCorrection[]): ComboInterval {
  installSpellDb(loadSpellDb())
  installCharacterName('Primitive')
  const mod = new ComboModule()
  mod.reset()
  mod.setCorrectionsProvider(stored)
  let n = 0
  for (const raw of readFixture('cw2-loadout-swap-aug2.log')) {
    const ev = parseEvent(raw, n++)
    if (ev) mod.onEvent(ev)
  }
  const current = mod.snapshot().state.current
  assert.ok(current, 'the fixture produced a current loadout')
  return current
}

test('an override comes back after a restart, and clearing it returns to autodetect', () => {
  const detected = restart(() => [])
  assert.ok(
    detected.slots.every((s) => s.provenance === 'inferred'),
    'the fixture is inferred when nothing is stored'
  )
  assert.notDeepEqual(codes(detected), MINE)

  // The user sets their classes against the interval they can see. `endTs: null` — "from the
  // start of the span I am in, onward" — is what the control writes.
  const set: ComboCorrection[] = [
    { startTs: detected.startTs, endTs: null, classes: MINE, setAt: Date.now() }
  ]
  const first = restart(() => set)
  assert.deepEqual(codes(first), MINE)
  assert.equal(first.userLocked, true)

  // Restart again on the same store contents: same answer. Nothing about it lived in RAM.
  assert.deepEqual(codes(restart(() => set)), MINE)

  // "Back to autodetect" is a store write; the next module simply finds no correction.
  const cleared = restart(() => [])
  assert.ok(cleared.slots.every((s) => s.provenance === 'inferred'))
  assert.equal(cleared.userLocked, false)
  assert.notDeepEqual(codes(cleared), MINE)
})

test('a correction pushes a delta the renderer will ACCEPT, on a log that has gone quiet', () => {
  // MEASURED IN THE RUNNING APP (tests/e2e/loadout-override.e2e.mts caught this; before the
  // fix the store had the override, the model had it, and the panel kept showing the detection
  // that was wrong). `useModule` dedupes with `if (d.seq <= knownSeq) return`, and `knownSeq` is
  // the hydration snapshot's seq. When the module reported the last LOG EVENT's seq, a
  // correction — which advances no log seq whatsoever — produced a delta that was silently
  // dropped as a duplicate. A user fixing their loadout in Preferences is, by definition, not
  // generating log lines, so nothing ever came along to unstick it.
  installSpellDb(loadSpellDb())
  installCharacterName('Primitive')
  const mod = new ComboModule()
  mod.reset()
  let stored: ComboCorrection[] = []
  mod.setCorrectionsProvider(() => stored)
  let n = 0
  for (const raw of readFixture('cw2-loadout-swap-aug2.log')) {
    const ev = parseEvent(raw, n++)
    if (ev) mod.onEvent(ev)
  }

  // Hydration is the renderer's baseline, and it drains the delta bookkeeping with it.
  const hydrated = mod.snapshot()
  assert.equal(mod.flushDelta(), null, 'nothing moved since the snapshot')

  // Not one more log line arrives. The user just presses Save.
  stored = [
    { startTs: hydrated.state.current?.startTs ?? 0, endTs: null, classes: MINE, setAt: Date.now() }
  ]
  mod.invalidate()
  const pushed = mod.flushDelta()
  assert.ok(pushed, 'the correction produced a delta')
  assert.ok(
    pushed.seq > hydrated.seq,
    `the delta must outrank the baseline or the renderer drops it (${pushed.seq} vs ${hydrated.seq})`
  )
  assert.ok(
    pushed.delta.changed.some((i) => resolvedClasses(i).join('/') === MINE.join('/')),
    'and it carries the override, not just a bumped number'
  )

  // Monotonic across a reset too: a re-hydration after a character switch must not be able to
  // hand back a seq that later deltas fail to beat.
  const before = mod.snapshot().seq
  mod.reset()
  assert.ok(mod.snapshot().seq > before, 'the revision never goes backwards')
})

test('a write takes effect without waiting for another log event, and pre-launch ones never load', () => {
  installSpellDb(loadSpellDb())
  installCharacterName('Primitive')
  const mod = new ComboModule()
  mod.reset()
  let stored: ComboCorrection[] = []
  mod.setCorrectionsProvider(() => stored)
  let n = 0
  for (const raw of readFixture('cw2-loadout-swap-aug2.log')) {
    const ev = parseEvent(raw, n++)
    if (ev) mod.onEvent(ev)
  }

  const before = mod.snapshot().state.current
  assert.ok(before)
  assert.equal(before.userLocked, false)

  // `invalidate()` is what ipc/combo.ts calls after a write. A user who is not fighting at that
  // moment must still see their setting land, so the next snapshot has to rebuild.
  stored = [{ startTs: before.startTs, endTs: null, classes: MINE, setAt: Date.now() }]
  mod.invalidate()
  const after = mod.snapshot().state.current
  assert.ok(after)
  assert.deepEqual(codes(after), MINE)

  // A correction dated before the launch epoch describes the wiped beta character that shares
  // this log file, and is refused however it arrives.
  stored = [{ startTs: LAUNCH_MS - HOUR, endTs: null, classes: MINE, setAt: 1 }]
  mod.invalidate()
  assert.ok(mod.snapshot().state.current?.slots.every((s) => s.provenance === 'inferred'))
})
