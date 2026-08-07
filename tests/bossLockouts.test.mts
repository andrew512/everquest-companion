// THIS WEEK'S LOCKOUTS (JOS-74) — the lockout window's arithmetic, and a golden over real kill
// history straddling a Tuesday reset.
//
// WHAT IS BEING PINNED. A raid boss's weekly LOOT lockout is per boss per difficulty and resets
// on a Pacific wall clock (the sources are cited in the header of
// src/renderer/src/features/bosses/lockout.ts, along with which of the two constants is
// double-sourced and which still wants verifying in game). Nothing about it is parsed: the app
// already records, per mob and per instance tier, when your most recent CREDITED kill landed, so
// "locked this week" is a comparison and the only hard part is the boundary.
//
// THE BOUNDARY IS THE SUBJECT. It is a PACIFIC WALL-CLOCK instant, so it is 15:00 UTC for half
// the year and 16:00 UTC for the other half, and a user in Tokyo must get the same two instants a
// user in Denver does. Hence: DST in both directions, the exact-boundary kill, a week over a
// month/year edge, and the same `now` recomputed under five machine timezones.
//
// THIS FILE PINS THE PROCESS TIMEZONE (below) because the second half replays REAL log lines, and
// an EQ timestamp parses to a LOCAL epoch (`parseEqTimestamp`) — so "Tue Aug 04 22:55:08" is a
// different instant on a machine in Tokyo, and the golden would be asserting the test machine's
// zone rather than the app's arithmetic. node:test runs each file in its own process, so the pin
// is this file's alone.
//
// Run: `npm test`.

process.env.TZ = 'America/Los_Angeles'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent, parseEqTimestamp } from '../src/main/log/parser'
import { KillsModule } from '../src/main/modules/kills'
import { allStatuses, type TargetStatus } from '../src/renderer/src/features/bosses/bossStatus'
import {
  LOCKOUT_RESET_HOUR,
  LOCKOUT_RESET_WEEKDAY,
  LOCKOUT_TIMEZONE,
  lockoutWindow,
  tierLocks,
  untilReset,
  type LockoutWindow
} from '../src/renderer/src/features/bosses/lockout'
import type { KillTierRun, RaidTarget } from '../src/shared/types'
import { readFixture } from './harness.mts'

const HOUR = 3_600_000

/** The pin took — every real-log assertion below depends on it. */
test('the process timezone is pinned to Pacific for the fixture replays', () => {
  assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), 480, 'January is PST (UTC-8)')
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), 420, 'July is PDT (UTC-7)')
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

const PACIFIC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour12: false,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

/** An instant as a Pacific wall clock, e.g. "Tue 2026-08-04 08:00". */
function pacific(ms: number): string {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of PACIFIC.formatToParts(ms)) p[part.type] = part.value
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

test('the reset day and hour are named constants, editable one at a time', () => {
  assert.equal(LOCKOUT_TIMEZONE, 'America/Los_Angeles')
  assert.equal(LOCKOUT_RESET_WEEKDAY, 2, 'Tuesday — the single-sourced half; VERIFY IN GAME')
  assert.equal(LOCKOUT_RESET_HOUR, 8, '8:00 AM Pacific — the double-sourced half')
})

test('the window is the Tuesday 08:00 Pacific pair either side of now', () => {
  // Wed Aug 05 2026, 10:00 Pacific (PDT, UTC-7).
  const w = lockoutWindow(Date.UTC(2026, 7, 5, 17))
  assert.equal(w.start, Date.UTC(2026, 7, 4, 15), 'Tue Aug 04 08:00 PDT = 15:00 UTC')
  assert.equal(w.next, Date.UTC(2026, 7, 11, 15), 'and the next one a week later')
  assert.equal(pacific(w.start), 'Tue 2026-08-04 08:00')
  assert.equal(pacific(w.next), 'Tue 2026-08-11 08:00')
})

test('the exact boundary belongs to the week it opens, not the one it closes', () => {
  const reset = Date.UTC(2026, 7, 4, 15)
  assert.equal(lockoutWindow(reset).start, reset, 'at 08:00:00 sharp the new week has begun')
  assert.equal(
    lockoutWindow(reset - 1).start,
    Date.UTC(2026, 6, 28, 15),
    'one millisecond earlier is still last week'
  )
  assert.equal(lockoutWindow(reset - 1).next, reset, '…whose next reset is that same instant')
})

test('on reset day before the hour, this week began seven days ago', () => {
  // Tue Aug 04 2026, 07:59 Pacific.
  const w = lockoutWindow(Date.UTC(2026, 7, 4, 14, 59))
  assert.equal(pacific(w.start), 'Tue 2026-07-28 08:00')
  assert.equal(pacific(w.next), 'Tue 2026-08-04 08:00')
})

test('DST spring forward: the week that loses an hour is 167 hours long', () => {
  // 2026 DST begins Sun Mar 08. The week Tue Mar 03 → Tue Mar 10 contains it.
  // Thu Mar 05 2026, 12:00 Pacific (PST, UTC-8).
  const w = lockoutWindow(Date.UTC(2026, 2, 5, 20))
  assert.equal(w.start, Date.UTC(2026, 2, 3, 16), 'Tue Mar 03 08:00 PST = 16:00 UTC')
  assert.equal(w.next, Date.UTC(2026, 2, 10, 15), 'Tue Mar 10 08:00 PDT = 15:00 UTC')
  // The wall clock is 08:00 at BOTH ends — which is the whole point, and is exactly what a
  // fixed -7h/-8h offset gets wrong at one end or the other.
  assert.equal(pacific(w.start), 'Tue 2026-03-03 08:00')
  assert.equal(pacific(w.next), 'Tue 2026-03-10 08:00')
  assert.equal((w.next - w.start) / HOUR, 167, 'seven days minus the hour spring forward ate')
})

test('DST fall back: the week that gains an hour is 169 hours long', () => {
  // 2026 DST ends Sun Nov 01. The week Tue Oct 27 → Tue Nov 03 contains it.
  // Thu Oct 29 2026, 12:00 Pacific (PDT, UTC-7).
  const w = lockoutWindow(Date.UTC(2026, 9, 29, 19))
  assert.equal(w.start, Date.UTC(2026, 9, 27, 15), 'Tue Oct 27 08:00 PDT = 15:00 UTC')
  assert.equal(w.next, Date.UTC(2026, 10, 3, 16), 'Tue Nov 03 08:00 PST = 16:00 UTC')
  assert.equal(pacific(w.start), 'Tue 2026-10-27 08:00')
  assert.equal(pacific(w.next), 'Tue 2026-11-03 08:00')
  assert.equal((w.next - w.start) / HOUR, 169, 'seven days plus the hour fall back returned')
})

test('a week that spans a month and a year edge needs no special case', () => {
  // Fri Jan 01 2027, 12:00 Pacific — the week began in the previous month AND year.
  const w = lockoutWindow(Date.UTC(2027, 0, 1, 20))
  assert.equal(pacific(w.start), 'Tue 2026-12-29 08:00')
  assert.equal(pacific(w.next), 'Tue 2027-01-05 08:00')
  assert.equal(w.start, Date.UTC(2026, 11, 29, 16), 'PST, so 16:00 UTC')
})

test('the same instant gives the same window in every machine timezone', () => {
  const now = Date.UTC(2026, 7, 5, 17)
  const expected = lockoutWindow(now)
  const original = process.env.TZ
  try {
    for (const tz of ['Asia/Tokyo', 'America/New_York', 'UTC', 'Australia/Sydney', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      assert.deepEqual(lockoutWindow(now), expected, `${tz} reads the same Pacific reset`)
    }
  } finally {
    process.env.TZ = original
  }
  // …and the pin is back, for the fixture replays below.
  assert.equal(new Date(2026, 6, 15).getTimezoneOffset(), 420)
})

test('the countdown is coarse and never negative', () => {
  const w = (msLeft: number): LockoutWindow => ({ start: 0, now: 0, next: msLeft })
  assert.equal(untilReset(w(3 * 24 * HOUR + 4 * HOUR + 30 * 60_000)), '3d 4h')
  assert.equal(untilReset(w(4 * HOUR + 12 * 60_000)), '4h 12m')
  assert.equal(untilReset(w(12 * 60_000)), '12m')
  assert.equal(untilReset(w(-HOUR)), '0m', 'a stale clock reads empty, never "-1h"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PREDICATE — per tier, and credited only
// ─────────────────────────────────────────────────────────────────────────────

const WEEK = lockoutWindow(Date.UTC(2026, 7, 5, 17)) // Tue Aug 04 08:00 PDT → Tue Aug 11 08:00

/** A tier run whose credited kill landed at `ts` (0 = none of its kills were yours). */
function run(ts: number, extra?: Partial<KillTierRun>): KillTierRun {
  return { count: 1, firstTs: ts, lastTs: ts, credited: ts ? 1 : 0, lastCreditedTs: ts, ...extra }
}

test('a kill exactly on the reset instant is inside the week it opens', () => {
  assert.deepEqual(tierLocks({ 2: run(WEEK.start) }, WEEK), [{ tier: 2, ts: WEEK.start }])
  assert.deepEqual(tierLocks({ 2: run(WEEK.start - 1) }, WEEK), [], 'one ms earlier is last week')
  assert.deepEqual(tierLocks({ 2: run(WEEK.next) }, WEEK), [], 'and the next reset closes it')
})

test('difficulties lock independently — the lockout is per boss PER DIFFICULTY', () => {
  const locks = tierLocks(
    {
      0: run(WEEK.start - 30 * 24 * HOUR), // a month ago
      2: run(WEEK.start + HOUR), // this week
      4: run(WEEK.start + 3 * 24 * HOUR) // also this week
    },
    WEEK
  )
  assert.deepEqual(locks, [
    { tier: 2, ts: WEEK.start + HOUR },
    { tier: 4, ts: WEEK.start + 3 * 24 * HOUR }
  ])
  assert.deepEqual(locks.map((l) => l.tier), [2, 4], 'lowest tier first, so the card reads in order')
})

test('a kill you merely WITNESSED locks nothing', () => {
  // The stranger's open-world kill: counted for the mob, credited to nobody. `lastTs` is inside
  // the window and `lastCreditedTs` is 0 — reading the wrong one would report a lockout on loot
  // the player never had a roll at.
  const witnessed: KillTierRun = {
    count: 1,
    firstTs: WEEK.start + HOUR,
    lastTs: WEEK.start + HOUR,
    credited: 0,
    lastCreditedTs: 0
  }
  assert.deepEqual(tierLocks({ 0: witnessed }, WEEK), [])
})

test('an old credited kill plus a fresh witnessed one is still open', () => {
  const mixed: KillTierRun = {
    count: 2,
    firstTs: WEEK.start - 20 * 24 * HOUR,
    lastTs: WEEK.start + HOUR,
    credited: 1,
    lastCreditedTs: WEEK.start - 20 * 24 * HOUR
  }
  assert.deepEqual(tierLocks({ 3: mixed }, WEEK), [], 'yours was three weeks ago')
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GOLDEN — real kill history straddling one Tuesday reset
// ─────────────────────────────────────────────────────────────────────────────
//
// Two committed fixtures, replayed in chronological order into ONE kills module, give a history
// that sits on both sides of Tue Aug 04 2026 08:00 Pacific:
//
//   Sat Aug 01 16:09:29  Lord of Ire, d4 (The Plane of Hate - Solo 4 (Refined)) — credited
//   Mon Aug 03 23:02:44  Lord of Ire, d0 (The Plane of Hate)                    — credited
//   ── Tue Aug 04 08:00 Pacific: the reset ──
//   Tue Aug 04 22:55:08  a thunder spirit princess, d0 (The Plane of Sky)       — credited
//   Wed Aug 05 00:33:45  a thunder spirit princess, killed by Pesmerga          — witnessed
//
// So the SAME record must read three different ways depending only on which side of the boundary
// `now` is standing.

const IRE: RaidTarget = { name: 'Lord of Ire', category: 'Plane of Hate', match: ['Lord of Ire'] }
const PRINCESS: RaidTarget = {
  name: 'Thunder Spirit Princess',
  category: 'Plane of Sky',
  match: ['Thunder Spirit Princess']
}

const IRE_D4 = parseEqTimestamp('Sat Aug 01 16:09:29 2026')
const IRE_D0 = parseEqTimestamp('Mon Aug 03 23:02:44 2026')
const PRINCESS_MINE = parseEqTimestamp('Tue Aug 04 22:55:08 2026')

/** Both fixtures through the REAL parser into one kills module, oldest first. */
function history(): TargetStatus[] {
  const mod = new KillsModule()
  mod.reset()
  let seq = 0
  for (const name of ['bosstier-lord-of-ire.log', 'boss-credit-open-world.log']) {
    for (const raw of readFixture(name)) {
      const ev = parseEvent(raw, seq++)
      if (ev) mod.onEvent(ev)
    }
  }
  return allStatuses([IRE, PRINCESS], mod.snapshot().state.mobs)
}

const byName = (list: TargetStatus[], name: string): TargetStatus =>
  list.find((s) => s.target.name === name)!

test('golden: standing before the reset, both of the week\'s kills are locked', () => {
  // Mon Aug 03 2026, 23:30 Pacific — half an hour after the d0 kill.
  const w = lockoutWindow(parseEqTimestamp('Mon Aug 03 23:30:00 2026'))
  assert.equal(pacific(w.start), 'Tue 2026-07-28 08:00')
  assert.equal(pacific(w.next), 'Tue 2026-08-04 08:00')

  const list = history()
  assert.deepEqual(
    tierLocks(byName(list, 'Lord of Ire').tiers, w),
    [
      { tier: 0, ts: IRE_D0 },
      { tier: 4, ts: IRE_D4 }
    ],
    'two difficulties, two kills, two locks — each dated by its own kill'
  )
  // Her kill is still in the future of this window, and the record already holds it: the
  // window is what excludes it, not the order the fixture was folded in.
  assert.deepEqual(tierLocks(byName(list, 'Thunder Spirit Princess').tiers, w), [])
})

test('golden: one Tuesday later the same record reads the other way round', () => {
  // Wed Aug 05 2026, 12:00 Pacific — the reset has been and gone.
  const w = lockoutWindow(parseEqTimestamp('Wed Aug 05 12:00:00 2026'))
  assert.equal(pacific(w.start), 'Tue 2026-08-04 08:00')

  const list = history()
  const ire = byName(list, 'Lord of Ire')
  assert.deepEqual(tierLocks(ire.tiers, w), [], 'last week\'s kills lock nothing this week')
  assert.equal(ire.killed, true, 'the ROSTER is unchanged — overall progression is not a lockout')
  assert.equal(ire.count, 2)

  const princess = byName(list, 'Thunder Spirit Princess')
  assert.deepEqual(
    tierLocks(princess.tiers, w),
    [{ tier: 0, ts: PRINCESS_MINE }],
    'locked at d0 by YOUR kill'
  )
  // Pesmerga's kill 98 minutes later is inside the same window and moved `lastTs`; it is not
  // what the lock is dated by, and on its own it would not have produced one at all.
  assert.equal(princess.tiers[0].lastTs > PRINCESS_MINE, true, 'a later kill did happen')
  assert.equal(princess.tiers[0].count, 2)
  assert.equal(princess.tiers[0].credited, 1)
})

test('golden: two Tuesdays later everything is open again', () => {
  const w = lockoutWindow(parseEqTimestamp('Wed Aug 12 12:00:00 2026'))
  assert.equal(pacific(w.start), 'Tue 2026-08-11 08:00')
  const list = history()
  for (const s of list) assert.deepEqual(tierLocks(s.tiers, w), [], `${s.target.name} is open`)
  assert.equal(list.every((s) => s.killed), true, 'and every one of them is still defeated')
})
