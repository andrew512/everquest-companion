// OBSERVED-FIRST DURATION PRECEDENCE for the buffs/timer overlay (JOS-114).
//
// The overlay used to count down from the DB base whenever the DB knew a duration, so a buff the
// player's own AAs/focus had extended read short: the owner cast Swift Like the Wind on self and
// the overlay said ~16m while the real timer ran ~33m. This ticket REVERSES JOS-89's DB-only rule
// for the ActiveBuff path — the MOST-RECENT clean observed sample wins over the DB base — made
// safe by the clean-sample rule (a sample is minted only from a genuine wear-off; every censoring
// boundary clears the instance without minting).
//
// These drive the REAL modules — parser-free, constructing the typed LogEvents the parser would
// emit — because the whole point is the buffs model's sample minting + censoring + projection, not
// the message grammar (that is pinned elsewhere). Every duration below is the committed
// spells.json's own number for the named spell (verified: Swift Like the Wind 960_000 ms / 16m,
// Shiftless Deeds 150_000 ms / 2m30s).

import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSpellDb } from '../src/main/data/spellDb.ts'
import { installSpellDb } from '../src/main/log/rulesets.ts'
import { BuffsModule } from '../src/main/modules/buffs.ts'
import { SpellStats } from '../src/main/modules/buffsStats.ts'
import { PetEntities } from '../src/main/modules/buffsEntities.ts'
import { buildActive } from '../src/main/modules/buffsView.ts'
import { SELF_KEY } from '../src/main/modules/buffsShapes.ts'
import { buildTimerRows, type BuffTimerRow } from '../src/shared/buffTimers.ts'
import type { LogEvent } from '../src/shared/logEvents.ts'
import type { BuffsSnap } from '../src/shared/types.ts'

const SWIFT = 'Swift Like the Wind'
const SWIFT_DB_MS = 960_000 // 16m — the DB base
const SWIFT_OBSERVED_MS = 1_980_000 // 33m — this character's AA/focus-extended truth

const SD = 'Shiftless Deeds'
const SD_DB_MS = 150_000 // 2m30s — the DB base
const SD_OBSERVED_MS = 180_000 // 3m — an AA/focus-extended slow

/** A fresh DB-backed buffs module, plus a monotonic event feeder. */
function makeModule(): { mod: BuffsModule; feed: (ev: Omit<LogEvent, 'seq'>) => void } {
  const db = loadSpellDb()
  installSpellDb(db)
  const mod = new BuffsModule(db)
  mod.reset()
  let seq = 0
  const feed = (ev: Omit<LogEvent, 'seq'>): void => {
    mod.onEvent({ ...ev, seq: seq++ } as LogEvent)
  }
  return { mod, feed }
}

/** `You begin casting <spell>.` */
function castBegin(spell: string, ts: number): Omit<LogEvent, 'seq'> {
  return { kind: 'castBegin', ts, raw: `[x] You begin casting ${spell}.`, spell }
}
/** A message-driven landing (own cast already in history), on self or a named target. */
function buffApply(spell: string, target: string, durationMs: number, ts: number): Omit<LogEvent, 'seq'> {
  return {
    kind: 'buffApply',
    ts,
    raw: `[x] ${spell} landed on ${target}.`,
    spell,
    target,
    illusion: false,
    durationMs,
    candidates: [{ name: spell, durationMs, illusion: false }]
  }
}
/** A genuine wear-off — the ONLY thing that mints a duration sample. Targetless ⇒ self. */
function buffFade(spell: string, ts: number, target?: string): Omit<LogEvent, 'seq'> {
  return { kind: 'buffFade', ts, raw: `[x] ${spell} wore off.`, spell, ...(target != null ? { target } : {}) }
}
/**
 * An inert event that only advances the module's event clock — an activated AA that is NOT Quick
 * Buff touches no buff instance. Needed because a buff genuinely up for >30 min has real combat in
 * between; without a keep-alive the single 33-min jump between two synthetic events would trip the
 * module's SESSION_GAP_MS logout clear and wipe the open cast before its wear-off (as it should).
 */
function keepAlive(ts: number): Omit<LogEvent, 'seq'> {
  return { kind: 'aaActivate', ts, raw: '[x] You activate Mend.', name: 'Mend' }
}

/** The overlay's active row for a spell, by name. */
function rowFor(snap: BuffsSnap, spell: string): BuffTimerRow | undefined {
  return buildTimerRows(snap, { holds: [], ends: [] }).find((r) => r.name === spell)
}

// ---------------------------------------------------------------------------------------------
// ACCEPTANCE 1 — Swift Like the Wind: one clean self cast→wear-off cycle, then the NEXT cast
// counts down from the OBSERVED ~33m, not the DB ~16m.
// ---------------------------------------------------------------------------------------------

test('a clean self cycle makes the next cast count down from the OBSERVED duration, not the DB base', () => {
  const { mod, feed } = makeModule()
  const t0 = 1_000_000_000_000
  // Cast, land, and wear off cleanly 33m later — this mints one observed sample.
  feed(castBegin(SWIFT, t0))
  feed(buffApply(SWIFT, 'self', SWIFT_DB_MS, t0 + 1_000))
  feed(keepAlive(t0 + 1_000 + SWIFT_OBSERVED_MS / 2)) // combat mid-buff keeps the event clock alive
  feed(buffFade(SWIFT, t0 + 1_000 + SWIFT_OBSERVED_MS))

  // The next cast.
  const t1 = t0 + 1_000 + SWIFT_OBSERVED_MS + 5_000
  feed(castBegin(SWIFT, t1))
  const snap = mod.snapshot().state

  const active = snap.active.find((a) => a.spell === SWIFT)
  assert.ok(active, 'Swift should be active after the recast')
  assert.equal(active.overlayDurationMs, SWIFT_OBSERVED_MS, 'overlay uses the OBSERVED 33m')
  assert.equal(active.overlaySource, 'observed', 'and says so')

  // The Buffs TAB fields are UNCHANGED — DB-first, so still the 16m base.
  assert.equal(active.durationSource, 'db', 'the tab estimate is still DB-provenanced')
  assert.equal(active.estimatedMs, SWIFT_DB_MS, 'and still the 16m DB base — the tab is untouched')

  const row = rowFor(snap, SWIFT)
  assert.ok(row)
  assert.equal(row.mode, 'countdown')
  assert.equal(row.durationMs, SWIFT_OBSERVED_MS, 'the overlay counts down from the observed 33m')
})

// ---------------------------------------------------------------------------------------------
// ACCEPTANCE 2 — a censored instance mints NO sample, so the next cast still uses the DB base.
// ---------------------------------------------------------------------------------------------

test('a player-death-censored self buff mints no sample — the next cast falls back to the DB base', () => {
  const { mod, feed } = makeModule()
  const t0 = 1_000_000_000_000
  feed(castBegin(SWIFT, t0))
  feed(buffApply(SWIFT, 'self', SWIFT_DB_MS, t0 + 1_000))
  // Death strips the self buff BEFORE any wear-off — the instance ends without minting a sample.
  feed({ kind: 'playerDeath', ts: t0 + 60_000, raw: '[x] You have been slain.' } as Omit<LogEvent, 'seq'>)

  const t1 = t0 + 120_000
  feed(castBegin(SWIFT, t1))
  const snap = mod.snapshot().state

  const active = snap.active.find((a) => a.spell === SWIFT)
  assert.ok(active)
  assert.equal(active.overlayDurationMs, SWIFT_DB_MS, 'no clean sample ⇒ the DB base, not a truncated value')
  assert.equal(active.overlaySource, 'db')
  const row = rowFor(snap, SWIFT)
  assert.ok(row)
  assert.equal(row.mode, 'countdown')
  assert.equal(row.durationMs, SWIFT_DB_MS)
})

test('a zone-censored debuff on a mob mints no sample — the next cast falls back to the DB base', () => {
  const { mod, feed } = makeModule()
  const t0 = 1_000_000_000_000
  feed(castBegin(SD, t0))
  feed(buffApply(SD, 'a fire giant warrior', SD_DB_MS, t0 + 1_000))
  // Zone — the mob is left behind (world-model law 4), the debuff instance censored, no sample.
  feed({ kind: 'zone', ts: t0 + 30_000, raw: '[x] You have entered somewhere.', zone: 'somewhere' } as Omit<LogEvent, 'seq'>)

  const t1 = t0 + 60_000
  feed(castBegin(SD, t1))
  feed(buffApply(SD, 'a fire giant warrior', SD_DB_MS, t1 + 1_000))
  const snap = mod.snapshot().state

  const active = snap.active.find((a) => a.spell === SD)
  assert.ok(active, 'the recast debuff should be active on the mob')
  assert.equal(active.overlayDurationMs, SD_DB_MS, 'the zone censored the first instance — no observed value exists')
  assert.equal(active.overlaySource, 'db')
})

// ---------------------------------------------------------------------------------------------
// ACCEPTANCE 3 — the DEBUFF exemplar: observed land→worn-off drives the per-target countdown.
// ---------------------------------------------------------------------------------------------

test('a debuff (Shiftless Deeds) observed on a mob drives the per-target countdown from the observation', () => {
  const { mod, feed } = makeModule()
  const t0 = 1_000_000_000_000
  feed(castBegin(SD, t0))
  feed(buffApply(SD, 'a fire giant warrior', SD_DB_MS, t0 + 1_000))
  feed(buffFade(SD, t0 + 1_000 + SD_OBSERVED_MS, 'a fire giant warrior'))

  const t1 = t0 + 1_000 + SD_OBSERVED_MS + 5_000
  feed(castBegin(SD, t1))
  feed(buffApply(SD, 'another fire giant warrior', SD_DB_MS, t1 + 1_000))
  const snap = mod.snapshot().state

  const row = rowFor(snap, SD)
  assert.ok(row, 'the debuff should project a row')
  assert.equal(row.group, 'target', 'a debuff is filed under the mob it is on')
  assert.equal(row.mode, 'countdown')
  assert.equal(row.durationMs, SD_OBSERVED_MS, 'the per-target countdown uses the observed 3m, not the DB 2m30s')
})

// ---------------------------------------------------------------------------------------------
// ACCEPTANCE 4 — "MOST RECENT" not "max": two clean samples (older longer, newer shorter) ⇒ the
// NEWER is what the overlay counts down from, WHILE the Buffs tab's distribution stats stand.
// ---------------------------------------------------------------------------------------------

test('two clean samples: the overlay uses the NEWER, the Buffs tab keeps its distribution (max/median/min)', () => {
  // A spell the DB has NO duration for, so estimateFor (the tab) genuinely uses the recency-
  // weighted MAX — which is the whole contrast: overlay = newest, tab = max, and here they differ.
  const stats = new SpellStats() // no DB
  const key = 'made up spell'
  stats.everFaded.add(key)
  const OLDER_LONGER = 2_400_000 // 40m, observed first
  const NEWER_SHORTER = 1_980_000 // 33m, observed second (focus removed — still the truth)
  stats.pushSample(key, 'Made Up Spell', OLDER_LONGER)
  stats.pushSample(key, 'Made Up Spell', NEWER_SHORTER)

  // The two accessors diverge deliberately.
  assert.equal(stats.lastObservedFor(key), NEWER_SHORTER, 'overlay input = the NEWEST sample')
  assert.equal(stats.estimateFor(key).ms, OLDER_LONGER, 'tab estimate = the MAX of recent samples')
  assert.equal(stats.estimateFor(key).source, 'observed')

  const active = buildActive(
    { spell: 'Made Up Spell', key, entityKey: SELF_KEY, startedTs: 1_000 },
    stats,
    new PetEntities()
  )
  assert.equal(active.overlayDurationMs, NEWER_SHORTER, 'the overlay counts down from the NEWER sample')
  assert.equal(active.overlaySource, 'observed')
  assert.equal(active.estimatedMs, OLDER_LONGER, 'the tab estimate is still the MAX — unchanged')

  const row = buildTimerRows({ active: [active], stats: {} }, { holds: [], ends: [] })[0]
  assert.equal(row.mode, 'countdown')
  assert.equal(row.durationMs, NEWER_SHORTER)

  // The distribution stats the Buffs tab renders are byte-identical to before this ticket.
  const stat = stats.statFor(key)
  assert.ok(stat)
  assert.equal(stat.n, 2)
  assert.equal(stat.minMs, NEWER_SHORTER, 'min sample')
  assert.equal(stat.maxMs, OLDER_LONGER, 'max sample')
  assert.equal(stat.medianMs, (OLDER_LONGER + NEWER_SHORTER) / 2, 'median across the two')
})
