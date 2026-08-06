// WHERE THE PET QUESTION MAY BE ASKED (JOS-49) — the SURFACE half of "the question is only about
// the fight in front of you".
//
// Main's currency gate (tests/petCandidates.test.mts, tests/petClaimWindows.test.mts) decides
// WHETHER there is a live question at all. This suite is the other half: WHERE the two meter
// surfaces are allowed to put it. The owner's report was a streamer's meter showing a wall of
// "your pet?" rows, and half of what made that possible was that `SegmentPanel` rendered the
// offer unconditionally on the outgoing dimension — including above a finalized fight and above
// a zone session left days ago, where there is nothing for the user to look up at and answer.
//
// TWO THINGS ARE PINNED, because there is no React render harness in this repo and a predicate
// nobody calls proves nothing:
//
//   THE PREDICATE — `isLiveSelection` over the REAL `scopeOptions` output, in both scopes, for
//   every selection the selector can actually produce. It is the same predicate the DPS curve
//   already used to decide whether its window follows `now`; JOS-49 moved it into dashboardData
//   so the overlay could read it too, rather than growing a second opinion about "live".
//
//   THE WIRING — that both surfaces gate on it, by SOURCE, the way tests/fightSelection.test.mts
//   pins the three fight selectors onto one seam. Panel/overlay parity is house law and it is
//   exactly the kind of law that rots silently: a renderer prop quietly dropped on one of two
//   surfaces typechecks perfectly and ships a question the other window refuses to ask.
//
// No Electron, no fixtures, no DOM — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  LIVE_SELECTION,
  defaultSelection,
  isLiveSelection,
  scopeOptions
} from '../src/renderer/src/features/combat/dashboardData'
import type { SegmentSummary, ZoneSessionSummary } from '../src/shared/combat'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const src = (...p: string[]): string => readFileSync(join(SRC, ...p), 'utf8')

const fight = (id: string, kind: SegmentSummary['kind']): SegmentSummary => ({
  id,
  kind,
  name: `a fire giant warrior (${id})`,
  durationSec: 30,
  total: 4000,
  dps: 133,
  activeSec: 25,
  activeDps: 160,
  startTs: 1_000_000,
  active: kind === 'current',
  enemyHealTotal: 0
})

const zoneSession = (id: string, live: boolean): ZoneSessionSummary => ({
  id,
  zone: id === 'zone' ? "Nagafen's Lair" : 'Nektulos Forest',
  startTs: 1_000_000,
  endTs: live ? 0 : 1_600_000,
  total: 40_000,
  dps: 90,
  live
})

// ── the predicate: which selections are the live one ───────────────────────────────────────

test('FIGHT scope: the head row is live only while a pull is actually open', () => {
  const open = scopeOptions('fight', [fight('e9', 'current'), fight('e8', 'fight')], [])
  assert.equal(isLiveSelection(open.head, LIVE_SELECTION), true)
  // …and between pulls the very same head row is a FINALIZED encounter. The selector already
  // says so out loud ("Last fight — X"); this is that sentence as a boolean.
  const between = scopeOptions('fight', [fight('e8', 'fight'), fight('e7', 'fight')], [])
  assert.match(between.head?.label ?? '', /^Last fight/)
  assert.equal(isLiveSelection(between.head, LIVE_SELECTION), false)
})

test('FIGHT scope: a fight picked out of history is never live, open pull or not', () => {
  const opts = scopeOptions('fight', [fight('e9', 'current'), fight('e8', 'fight')], [])
  assert.equal(isLiveSelection(opts.head, 'e8'), false)
  assert.equal(isLiveSelection(opts.head, 'e7'), false, 'nor one that has aged out of the window')
})

test('OVERALL scope: the running zone session is live; every `zs<n>` you left is not', () => {
  const opts = scopeOptions('overall', [], [zoneSession('zone', true), zoneSession('zs2', false)])
  assert.equal(opts.head?.value, 'zone')
  assert.equal(isLiveSelection(opts.head, defaultSelection('overall')), true)
  assert.equal(isLiveSelection(opts.head, 'zs2'), false)
})

test('OVERALL scope: with no live session the head is a PAST one, and it is not live either', () => {
  // This is the state after a zone change with no damage yet in the new zone.
  const opts = scopeOptions('overall', [], [zoneSession('zs2', false), zoneSession('zs1', false)])
  assert.equal(opts.head?.live, false)
  assert.equal(isLiveSelection(opts.head, opts.head?.value ?? ''), false)
})

test('a scope with nothing in it has no live selection to speak of', () => {
  assert.equal(isLiveSelection(scopeOptions('fight', [], []).head, LIVE_SELECTION), false)
  assert.equal(isLiveSelection(scopeOptions('overall', [], []).head, 'zone'), false)
})

test('the two scopes never call each other live: a fight id in the overall scope is nothing', () => {
  // The scopes are disjoint by construction (Task #60), and the predicate must not launder a
  // selection across them — a fight id arriving while the zone selector is up is not a match.
  const overall = scopeOptions('overall', [], [zoneSession('zone', true)])
  assert.equal(isLiveSelection(overall.head, LIVE_SELECTION), false)
  const fights = scopeOptions('fight', [fight('e9', 'current')], [])
  assert.equal(isLiveSelection(fights.head, 'zone'), false)
})

// ── the wiring: BOTH surfaces gate on it, and neither grew its own opinion ──────────────────

test('ONE PREDICATE: `isLiveSelection` lives in dashboardData and both surfaces import it', () => {
  assert.match(
    src('renderer', 'src', 'features', 'combat', 'dashboardData.ts'),
    /export function isLiveSelection\(/,
    'the shared module owns it'
  )
  for (const file of [
    ['renderer', 'src', 'features', 'combat', 'CombatView.tsx'],
    ['renderer', 'src', 'overlay', 'OverlayMeter.tsx']
  ]) {
    const text = src(...file)
    assert.match(text, /isLiveSelection/, `${file.join('/')} must read the shared predicate`)
    assert.doesNotMatch(
      text,
      /function isLiveSelection\(/,
      `${file.join('/')} must not define a second opinion about "live"`
    )
  }
})

test('THE COMBAT TAB asks only on a live selection', () => {
  const panel = src('renderer', 'src', 'features', 'combat', 'SegmentPanel.tsx')
  const offers = [...panel.matchAll(/\{[^\n]*<PetClaimOffer/g)]
  assert.equal(offers.length, 1, 'exactly one place asks the question')
  assert.match(offers[0][0], /askPetClaim\(mode, live\) &&/)
  assert.match(
    panel,
    /function askPetClaim\(mode: MeterMode, live: boolean\): boolean \{\s*return mode === 'out' && live\s*\}/,
    'outgoing dimension AND live selection — the two conditions, and only those two'
  )
  // …and `live` reaches it from the view, not from something local to the panel.
  assert.match(panel, /live: boolean/)
  assert.match(src('renderer', 'src', 'features', 'combat', 'CombatView.tsx'), /live=\{live\}/)
})

test('THE OVERLAY METER asks only on a live selection — parity, not coincidence', () => {
  const bars = src('renderer', 'src', 'overlay', 'meterBars.tsx')
  const offers = [...bars.matchAll(/\{[^\n]*<PetClaimOffer/g)]
  assert.equal(offers.length, 1, 'exactly one place asks the question')
  assert.match(offers[0][0], /liveSelection &&/)
  assert.match(bars, /liveSelection: boolean/)
  assert.match(src('renderer', 'src', 'overlay', 'OverlayMeter.tsx'), /liveSelection=\{liveSelection\}/)
})

test('the overlay does NOT gate the question on "are you in combat" — that is a different word', () => {
  // `live` in the overlay is `snap.inCombat`: you can be swinging at something while this window
  // is showing Tuesday's zone session. Gating the offer on that would ask about the wrong fight.
  const overlay = src('renderer', 'src', 'overlay', 'OverlayMeter.tsx')
  assert.match(overlay, /live: !hydrating && !!snap\?\.inCombat/, 'the two meanings still differ')
  assert.match(overlay, /liveSelection: isLiveSelection\(head, selection\)/)
})
