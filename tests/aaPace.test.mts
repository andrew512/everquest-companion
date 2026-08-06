// AA PACE TESTS — AA/hr, points/hr, the inferred next-AA estimate, and the item-shop potion.
//
// METHODOLOGY (AGENTS.md): the potion model is pinned against a VERBATIM span of the user's
// real log (tests/fixtures/wl2-aa-potion.log, cut by tests/extract-leveling-fixtures.mjs
// through the shared scrub and hand-read line by line) replayed through the REAL parseEvent +
// LevelingModule. The pure seams — `aaEta`, `aaPotionState`, the two new `rangeStats` rates,
// and the tile shaping — are driven over hand-built inputs so each rule has its own failure.
//
// WL2 — THE POTION, END TO END (Tue Jul 28 13:55 → 19:35). Two bottles and the reversion
// between them. Hand-read, the complete AA gain sequence in that window is:
//
//   13:55:42  +1     no bottle running
//   13:56:10         ← quaff #1 ("You are filled with the spirit of alternate adventure.")
//   14:22:18  +2  ┐
//   14:44:57  +2  │
//   15:06:23  +2  ├ five completions, every one doubled — the bottle's five charges
//   15:24:13  +2  │
//   15:41:44  +2  ┘
//   16:28:03         ← quaff #2 (the first bottle paid nothing more, and said nothing)
//   16:32:12  +2  ┐
//   17:32:54  +2  │
//   18:21:12  +2  ├ five again
//   18:45:39  +2  │
//   19:06:36  +2  ┘
//   19:34:48  +1     spent — back to one point, with no line announcing it
//
// THE LOAD-BEARING CLAIM: the log never states the charges, so `AA_POTION_CHARGES` is a MODEL.
// What makes it an honest one is that the stated points re-check it on every completion — a
// gain the model calls charge-covered stated 2, and a gain outside a bottle stated 1, with no
// exception in this window and none in the whole 1.36M-line log.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent } from '../src/main/log/parser'
import { LevelingModule } from '../src/main/modules/leveling'
import { AA_POTION_CHARGES, aaEta, aaPace, aaPotionState } from '../src/shared/aaPace'
import { rangeStats } from '../src/shared/progressionStats'
import type { AAEvent, LevelingSnap, ProgressionSnap } from '../src/shared/types'
// Imported RELATIVELY: node tests run through tsx with no `@shared` / `@renderer` aliases.
import { AA_EST, aaPaceLine, aaPaceTiles, potionText } from '../src/renderer/src/features/leveling/aaPaceRows'
import { NONE, aaRateText } from '../src/renderer/src/features/leveling/rangeStatsRows'
import { readFixture } from './harness.mts'

const T = (stamp: string): number => Date.parse(stamp)
const MIN = 60_000
const HOUR = 3_600_000

/** Replay raw lines through the real parser + LevelingModule → snapshot state. */
function replay(lines: string[]): LevelingSnap {
  const mod = new LevelingModule()
  mod.reset()
  let seq = 0
  for (const raw of lines) {
    const ev = parseEvent(raw, seq++)
    if (ev) mod.onEvent(ev)
  }
  return mod.snapshot().state
}

/** A ProgressionSnap carrying only what `aaEta` reads: the clock and the derived logouts. */
function progWith(lastTs: number, offline: [number, number][] = []): ProgressionSnap {
  return {
    expTs: [], expPct: [], expFlag: [],
    killTs: [], killZone: [], killCredit: [],
    witnessTs: [],
    recentKills: [],
    lootTs: [],
    zoneStart: [], zoneEnd: [], zoneName: [],
    offlineStart: offline.map((o) => o[0]),
    offlineEnd: offline.map((o) => o[1]),
    offlineCamped: offline.map(() => 1),
    levelTs: [], levelValue: [], aaGainTs: [], aaGainAmount: [],
    lastTs,
    windowStart: 0,
    dropped: 0
  }
}

/** Gains at fixed spacing from `t0`, each paying `amount` points. */
function gainsEvery(t0: number, spacingMs: number, n: number, amount = 1): AAEvent[] {
  return Array.from({ length: n }, (_, i) => ({ ts: t0 + i * spacingMs, amount, nowHave: i + 1 }))
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PARSER RULE
// ─────────────────────────────────────────────────────────────────────────────

test('the quaff line is claimed as aaPotion, and nothing near it is', () => {
  const quaff = parseEvent('[Tue Jul 28 13:56:10 2026] You are filled with the spirit of alternate adventure.', 0)
  assert.equal(quaff?.kind, 'aaPotion')
  assert.equal(quaff?.ts, T('Jul 28 2026 13:56:10'))

  // The CAST is a cast — a bottle begun is not a bottle landed (2 of the 34 casts in the real
  // log were interrupted and paid nothing).
  assert.equal(parseEvent('[Tue Jul 28 13:56:05 2026] You begin casting Bottle of Alternate Adventure.', 1)?.kind, 'castBegin')
  // Another player's cast is theirs. The landing line is self-only ("You are filled …"), which
  // is why the event carries no name to get wrong.
  assert.notEqual(parseEvent('[Tue Jul 28 13:56:05 2026] Dranix begins casting Bottle of Alternate Adventure.', 2)?.kind, 'aaPotion')
  // The AA gain families are untouched by the new rule.
  assert.equal(parseEvent('[Tue Jul 28 14:22:18 2026] You have gained 2 ability point(s)!  You now have 5 ability point(s).', 3)?.kind, 'aaGain')
})

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN WINDOW WL2 — the potion, end to end
// ─────────────────────────────────────────────────────────────────────────────

const wl2 = readFixture('wl2-aa-potion.log')

test('WL2: both quaffs are folded, at the instants the log stated', () => {
  const snap = replay(wl2)
  assert.deepEqual(
    snap.aaPotions.map((p) => p.ts),
    [T('Jul 28 2026 13:56:10'), T('Jul 28 2026 16:28:03')]
  )
})

test('WL2: the hand-read gain sequence — 1, five 2s, five 2s, 1', () => {
  const snap = replay(wl2)
  assert.deepEqual(
    snap.aaGains.map((g) => g.amount),
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1]
  )
})

test('WL2: the second bottle is spent — five charges burned, every one doubled as printed', () => {
  const snap = replay(wl2)
  const st = aaPotionState(snap.aaGains, snap.aaPotions)
  assert.equal(st.activations, 2)
  assert.equal(st.lastTs, T('Jul 28 2026 16:28:03'))
  assert.equal(st.burned, AA_POTION_CHARGES)
  assert.equal(st.charges, 0)
  // The model's own evidence: what those five completions actually paid, per the game.
  assert.deepEqual(st.burnedPoints, [2, 2, 2, 2, 2])
})

test('WL2: mid-bottle, the charges count down and the payout is still doubled', () => {
  // Cut the window after the FOURTH completion of the first bottle (15:24:13). One charge left.
  const cut = T('Jul 28 2026 15:30:00')
  const snap = replay(wl2.filter((l) => parseEqTs(l) <= cut))
  const st = aaPotionState(snap.aaGains, snap.aaPotions)
  assert.equal(st.lastTs, T('Jul 28 2026 13:56:10'))
  assert.equal(st.burned, 4)
  assert.equal(st.charges, 1)
  assert.deepEqual(st.burnedPoints, [2, 2, 2, 2])
})

test('WL2: the model and the stated points agree on every completion in the window', () => {
  const snap = replay(wl2)
  // Walk the merged stream the way the model does — a quaff arms five charges, a completion
  // burns one — and assert the game printed the doubling exactly where the model expects it.
  let charges = 0
  let quaffAt = 0
  let checked = 0
  const stream = [
    ...snap.aaPotions.map((p) => ({ ts: p.ts, amount: 0 })),
    ...snap.aaGains.map((g) => ({ ts: g.ts, amount: g.amount }))
  ].sort((a, b) => a.ts - b.ts)
  for (const e of stream) {
    if (e.amount === 0) {
      charges = AA_POTION_CHARGES
      quaffAt++
      continue
    }
    assert.equal(e.amount, charges > 0 ? 2 : 1, `completion at ${new Date(e.ts).toISOString()} (charges ${charges})`)
    if (charges > 0) charges--
    checked++
  }
  assert.equal(quaffAt, 2)
  assert.equal(checked, 12)
})

test('WL2: a character who never quaffed one is told nothing about potions', () => {
  const snap = replay(wl2.filter((l) => !l.includes('spirit of alternate adventure')))
  const st = aaPotionState(snap.aaGains, snap.aaPotions)
  assert.equal(st.activations, 0)
  assert.equal(st.lastTs, null)
  assert.equal(st.charges, 0)
  assert.deepEqual(st.burnedPoints, [])
})

/** The fixture's own timestamps, for the mid-window cut above. */
function parseEqTs(line: string): number {
  const m = /^\[(.+?)\]/.exec(line)
  return m ? Date.parse(m[1].replace(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\S+)\s+(\d{4})$/, '$1 $2 $4 $3')) : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INFERRED ESTIMATE
// ─────────────────────────────────────────────────────────────────────────────

const T0 = T('Jul 28 2026 12:00:00')

/**
 * The pure ETA over a synthetic hour: `n` completions inside `[T0, T0+1h]`, observed at
 * `sinceLastMin` minutes after the last one. The window is a real `rangeStats` so the mean gap
 * is measured over the same online wall the panel would use.
 */
function etaOverHour(n: number, sinceLastMin: number, offline: [number, number][] = []): ReturnType<typeof aaEta> {
  const t1 = T0 + HOUR
  const gains = n > 0 ? gainsEvery(T0 + 5 * MIN, 10 * MIN, n) : []
  const snap = progWithGains(gains, T0, t1, offline)
  const lastTs = gains.length > 0 ? gains[gains.length - 1].ts + sinceLastMin * MIN : t1
  snap.lastTs = lastTs
  return aaEta(
    rangeStats({ snap, range: { t0: lastTs - HOUR, t1: lastTs } }),
    gains.length > 0 ? gains[gains.length - 1].ts : null,
    snap,
    lastTs
  )
}

test('a window with fewer than two completions states no rhythm — refused, not guessed', () => {
  assert.deepEqual(etaOverHour(1, 5), { blocked: 'no-pace' })
  assert.deepEqual(etaOverHour(0, 0), { blocked: 'no-pace' })
})

test('the estimate is the window mean gap minus the wait already served', () => {
  // Six completions inside the hour ⇒ a mean gap of 10 minutes of online wall, whatever their
  // individual spacing was. Observed 4 minutes after the last one.
  const eta = etaOverHour(6, 4)
  assert.equal(eta.blocked, null)
  if (eta.blocked !== null) return
  assert.equal(eta.samples, 6)
  assert.equal(eta.meanIntervalMs, 10 * MIN)
  assert.equal(eta.sinceLastMs, 4 * MIN)
  assert.equal(eta.ms, 6 * MIN)
  assert.equal(eta.overdue, false)
})

test('past the mean gap the next one is DUE — floored at 0 and flagged, never a negative wait', () => {
  const eta = etaOverHour(6, 14)
  assert.equal(eta.blocked, null)
  if (eta.blocked !== null) return
  assert.equal(eta.ms, 0)
  assert.equal(eta.overdue, true)
})

test('long past the rhythm the estimate is REFUSED — a stale model must not read "due now" forever', () => {
  // Four completions in a two-minute burst, then three quarters of an hour of nothing. The
  // window still holds four samples, so the mean gap reads 15 minutes — and the 46 minutes
  // already waited is three of them. The rhythm stopped describing anything; say so.
  const gains = gainsEvery(T0, 2 * MIN, 4)
  const now = T0 + 52 * MIN
  const snap = progWithGains(gains, T0 - 8 * MIN, now)
  snap.lastTs = now
  const w = rangeStats({ snap, range: { t0: now - HOUR, t1: now } })
  assert.equal(w.aaGainEvents, 4)
  assert.deepEqual(aaEta(w, gains[3].ts, snap, now), { blocked: 'stale' })
})

test('a logout inside the window is taken OUT of the denominator — an overnight is not slow AA', () => {
  // Two completions in an hour that also holds a 30-minute logout. The mean gap must be over
  // the 30 minutes the log says you were THERE, not the 60 the clock ran.
  const t1 = T0 + HOUR
  const gains = gainsEvery(T0 + 5 * MIN, 10 * MIN, 2)
  const snap = progWithGains(gains, T0, t1, [[T0 + 25 * MIN, T0 + 55 * MIN]])
  snap.lastTs = t1
  const w = rangeStats({ snap, range: { t0: T0, t1 } })
  assert.equal(w.offlineMs, 30 * MIN)
  const eta = aaEta(w, gains[1].ts, snap, t1)
  assert.equal(eta.blocked, null)
  if (eta.blocked !== null) return
  assert.equal(eta.meanIntervalMs, 15 * MIN)
  // The wait already served is online too: 45 minutes of clock since the last completion, of
  // which 30 were a logout.
  assert.equal(eta.sinceLastMs, 15 * MIN)
  assert.equal(eta.ms, 0)
})

test('the estimate reads the LOG clock, never the wall clock', () => {
  const t1 = T0 + HOUR
  const gains = gainsEvery(T0 + 5 * MIN, 10 * MIN, 6)
  const prog = progWithGains(gains, T0, t1)
  // A snapshot whose log stopped at the last completion has served no wait at all, however
  // long ago that was in real time — `aaPace` passes `prog.lastTs`, not `Date.now()`.
  prog.lastTs = gains[gains.length - 1].ts
  const pace = aaPace({
    leveling: { aaGains: gains, aaPotions: [] },
    prog,
    window: rangeStats({ snap: prog, range: { t0: prog.lastTs - HOUR, t1: prog.lastTs } })
  })
  assert.equal(pace.eta.blocked, null)
  if (pace.eta.blocked !== null) return
  assert.equal(pace.eta.sinceLastMs, 0)
  assert.equal(pace.eta.ms, pace.eta.meanIntervalMs)
})

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO RATES — and the one place they diverge
// ─────────────────────────────────────────────────────────────────────────────

/** A snapshot with AA gains and enough activity that the whole span counts as active. */
function progWithGains(
  gains: AAEvent[],
  t0: number,
  t1: number,
  offline: [number, number][] = []
): ProgressionSnap {
  const snap = progWith(t1, offline)
  snap.aaGainTs = gains.map((g) => g.ts)
  snap.aaGainAmount = gains.map((g) => g.amount)
  // A kill each minute keeps the idle classifier quiet, so `activeMs` is the whole span and the
  // rates below are arithmetic a reader can check by hand.
  for (let t = t0; t <= t1; t += MIN) snap.killTs.push(t)
  snap.killZone = snap.killTs.map(() => -1)
  snap.killCredit = snap.killTs.map(() => 0)
  return snap
}

test('AA/hr counts completions and points/hr counts points — equal until a bottle runs', () => {
  const t0 = T0
  const t1 = T0 + HOUR
  const plain = progWithGains(gainsEvery(t0 + MIN, 20 * MIN, 3, 1), t0, t1)
  const r = rangeStats({ snap: plain, range: { t0, t1 } })
  assert.equal(r.aaGainEvents, 3)
  assert.equal(r.aaGained, 3)
  assert.equal(r.aaPerHourActive, r.aaPointsPerHourActive)

  // The same three completions with a bottle running: the game states 2 per line, so the POINTS
  // rate doubles and the COMPLETION rate does not move at all. That asymmetry is the potion.
  const potion = progWithGains(gainsEvery(t0 + MIN, 20 * MIN, 3, 2), t0, t1)
  const p = rangeStats({ snap: potion, range: { t0, t1 } })
  assert.equal(p.aaGainEvents, 3)
  assert.equal(p.aaGained, 6)
  assert.equal(p.aaPerHourActive, r.aaPerHourActive)
  assert.equal(p.aaPointsPerHourActive, (r.aaPointsPerHourActive ?? 0) * 2)
})

test('no active time ⇒ the AA rates are null, never 0.0', () => {
  const snap = progWith(T0)
  const r = rangeStats({ snap, range: { t0: T0, t1: T0 } })
  assert.equal(r.aaPerHourActive, null)
  assert.equal(r.aaPointsPerHourActive, null)
})

test('a measured zero IS a number — an active window with no AA reports 0, not an em-dash', () => {
  const t1 = T0 + HOUR
  const snap = progWithGains([], T0, t1)
  const r = rangeStats({ snap, range: { t0: T0, t1 } })
  assert.equal(r.aaGainEvents, 0)
  assert.equal(r.aaPerHourActive, 0)
  assert.equal(r.aaPointsPerHourActive, 0)
})

test('the range panel prints both AA rates together, and nothing when the range holds no AA', () => {
  const t1 = T0 + HOUR
  const with2 = rangeStats({ snap: progWithGains(gainsEvery(T0 + MIN, 20 * MIN, 3, 2), T0, t1), range: { t0: T0, t1 } })
  assert.equal(aaRateText(with2), '3.00 AA/hr · 6.00 pts/hr')
  assert.equal(aaRateText(rangeStats({ snap: progWithGains([], T0, t1), range: { t0: T0, t1 } })), null)
})

// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPING — which numbers wear the `inferred` chip
// ─────────────────────────────────────────────────────────────────────────────

/** An `AaPace` built straight from the WL2 fixture plus a chosen observation instant. */
function paceAt(lines: string[], nowTs: number): ReturnType<typeof aaPace> {
  const leveling = replay(lines)
  const prog = progWithGains(leveling.aaGains, leveling.aaGains[0].ts, nowTs)
  return aaPace({ leveling, prog, window: rangeStats({ snap: prog, range: { t0: prog.killTs[0], t1: nowTs } }) })
}

test('the two rate tiles are measurements; the estimate and the charge count are not', () => {
  const tiles = aaPaceTiles(paceAt(wl2, T('Jul 28 2026 19:36:00')))
  assert.deepEqual(
    tiles.map((t) => [t.id, t.inferred]),
    [['rate', false], ['points', false], ['eta', true], ['potion', true]]
  )
  // Every tile names what it measures.
  for (const t of tiles) assert.ok(t.title.length > 0, `${t.id} has a hover sentence`)
  // …in ONE CLAUSE. The `inferred` chip is the whole stated-vs-inferred disclosure — the tooltip
  // diet (AGENTS.md UI conventions) bans the paragraph that used to ride here.
  for (const t of tiles) {
    assert.ok(t.title.split(/\s+/).length <= 16, `${t.id} tooltip is a caveat again: ${t.title}`)
    assert.ok(!/INFERRED/.test(t.title), `${t.id} footnotes its own provenance: ${t.title}`)
  }
})

test('the potion tile is absent for a character who has never quaffed one', () => {
  const lines = wl2.filter((l) => !l.includes('spirit of alternate adventure'))
  const tiles = aaPaceTiles(paceAt(lines, T('Jul 28 2026 19:36:00')))
  assert.deepEqual(tiles.map((t) => t.id), ['rate', 'points', 'eta'])
  assert.equal(potionText(aaPotionState(replay(lines).aaGains, [])), null)
})

test('the potion tile shows the charges left and quotes the points the game printed', () => {
  const cut = T('Jul 28 2026 15:30:00')
  const pace = paceAt(wl2.filter((l) => parseEqTs(l) <= cut), cut)
  const tile = aaPaceTiles(pace).find((t) => t.id === 'potion')
  assert.equal(tile?.value, '1')
  assert.equal(tile?.unit, `of ${AA_POTION_CHARGES}`)
  // The model's evidence rides in the tooltip: what those charges actually paid.
  assert.match(tile?.title ?? '', /2, 2, 2, 2/)
  assert.equal(potionText(pace.potion), '1 of 5 charges · 1 quaffed')
})

test('the COMPACT line says the same thing in one line, and labels the model in one word', () => {
  // The same window the tiles above shape, on a surface that has a caption instead of a row.
  const t1 = T0 + HOUR
  const gains = gainsEvery(T0 + 15 * MIN, 15 * MIN, 3, 2)
  const prog = progWithGains(gains, T0, t1)
  prog.lastTs = t1
  const w = rangeStats({ snap: prog, range: { t0: T0, t1 } })
  const line = aaPaceLine(w, aaEta(w, gains[2].ts, prog, t1))
  // Both rates first and ADJACENT — they diverge only while a bottle runs, and that comparison
  // is the reading. The doubled points say a bottle is running here.
  assert.equal(line, `3.00 AA/hr · 6.00 pts/hr · next in ~5m ${AA_EST}`)
  // The tile carries the chip and the two numbers behind the estimate; the line carries one word.
  const tiles = aaPaceTiles({ events: w.aaGainEvents, points: w.aaGained, perHourActive: w.aaPerHourActive, pointsPerHourActive: w.aaPointsPerHourActive, eta: aaEta(w, gains[2].ts, prog, t1), potion: aaPotionState(gains, []) })
  assert.match(tiles.find((t) => t.id === 'eta')?.title ?? '', /Mean gap over/)
  assert.ok(!/Mean gap/.test(line ?? ''), 'a caption states the estimate, never its method')

  // No completion in the window ⇒ no line at all, the same rule `aaRateText` already obeys.
  const bare = rangeStats({ snap: progWithGains([], T0, t1), range: { t0: T0, t1 } })
  assert.equal(aaPaceLine(bare, aaEta(bare, null, prog, t1)), null)
})

test('a refused estimate still prints a reason, and an em-dash rather than a number', () => {
  // Observed a day later: the hour before that instant holds no completion at all.
  const tile = aaPaceTiles(paceAt(wl2, T('Jul 29 2026 19:36:00'))).find((t) => t.id === 'eta')
  assert.equal(tile?.value, NONE)
  assert.match(tile?.title ?? '', /far older than this window/)
})
