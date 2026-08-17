// JOS-391 — WHAT A SPELL IS WORTH, pinned shape by shape.
//
// THE CLAIM UNDER TEST: every hitpoint line the committed catalog prints can be read into a
// number at a stated level, and the arithmetic on top of those numbers (per mana, per second,
// ticks) is the one the Leveling rows draw.
//
// THE NINE SHAPES IN R1 ARE NOT A SAMPLE. They are the nine the ticket named, each of them lifted
// verbatim out of `src/main/data/spells.json` with the spell it came from written beside it — a
// constant, a two-point ramp, a per-tick constant, a per-tick ramp, a THREE-point non-monotonic
// ramp, and the four increase-side twins including the two families that count their own ticks.
// A re-scrape that changes one of these strings fails here by name rather than drifting a figure
// on screen by a factor of the tick count.
//
// R6 IS THE EXCLUSION HALF and it matters as much as the inclusions: a max-HP buff is not a heal,
// and `HP when cast` is the same magnitude written twice (Armor of Protection states 202→225 as
// both). Reading either would inflate every figure it touched.
//
// R7 sweeps the WHOLE committed catalog, which is what makes "measured" mean measured: no line
// this reader accepts may produce a NaN, a negative or an infinity, and the shapes it declines
// are counted so a re-scrape that introduces a new one is visible.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import spellsJson from '../src/main/data/spells.json' with { type: 'json' }
import type { SpellDbFile } from '../src/shared/types.ts'
import {
  parseHpLine,
  spellMetricsAt,
  spellMetricsParts,
  ticksOf,
  type SpellMetricsInput
} from '../src/shared/spellMetrics.ts'

const FILE = spellsJson as unknown as SpellDbFile

/** The catalog row by name, so a shape test can be checked against the real entry beside it. */
function entry(name: string): SpellMetricsInput {
  const s = FILE.spells.find((x) => x.name === name)
  assert.ok(s, `spells.json carries ${name}`)
  return s
}

test('R1 the nine pinned shapes read to the right magnitude at a stated level', () => {
  // 1. the bare constant (160 rows; Asp Venom Strike states exactly this)
  assert.deepEqual(parseHpLine('Decrease Hitpoints by 100', 1), {
    amount: 100,
    direction: 'down',
    perTick: false
  })

  // 2. the two-point ramp (161 rows) — linear inside, clamped outside
  const ramp = 'Decrease Hitpoints by 1 (L1) to 51 (L100)'
  assert.equal(parseHpLine(ramp, 1)?.amount, 1)
  assert.equal(parseHpLine(ramp, 100)?.amount, 51)
  assert.equal(parseHpLine(ramp, 199)?.amount, 51, 'clamped above the last breakpoint')
  assert.equal(parseHpLine(ramp, 0)?.amount, 1, 'clamped below the first')
  // (100-1) levels carry (51-1) points, so L50 is 1 + 49*(50/99)
  assert.equal(Math.round((parseHpLine(ramp, 50)?.amount ?? 0) * 100) / 100, 25.75)

  // 3. the per-tick constant (116 rows; Acid Jet)
  assert.deepEqual(parseHpLine('Decrease Hitpoints by 10 per tick', 40), {
    amount: 10,
    direction: 'down',
    perTick: true
  })

  // 4. the per-tick ramp with the marker OUTSIDE the range clause (17 rows; Blood of Pain)
  const dotRamp = 'Decrease Hitpoints by 10 (L1) to 22 (L50) per tick'
  assert.equal(parseHpLine(dotRamp, 50)?.amount, 22)
  assert.equal(parseHpLine(dotRamp, 50)?.perTick, true)

  // 5. THREE breakpoints, NON-MONOTONIC (Stone Spider Stun) — the value falls to 0 at 70 and
  //    climbs again to 110, so the reader may not assume the values ascend, only the levels.
  const three = 'Decrease Hitpoints by 10 (L1) to 0 (L70) to 65 (L110)'
  assert.equal(parseHpLine(three, 1)?.amount, 10)
  assert.equal(parseHpLine(three, 70)?.amount, 0)
  assert.equal(parseHpLine(three, 110)?.amount, 65)
  // L36 is 35/69 of the way down the first leg: 10 - 10*(35/69)
  assert.equal(Math.round((parseHpLine(three, 36)?.amount ?? 0) * 100) / 100, 4.93)
  assert.equal(parseHpLine(three, 90)?.amount, 32.5, 'halfway up the second leg')

  // 6. the increase-side per-tick constant (37 rows; Aura of Battle)
  assert.deepEqual(parseHpLine('Increase Hitpoints by 1 per tick', 10), {
    amount: 1,
    direction: 'up',
    perTick: true
  })

  // 7. the increase-side per-tick ramp (Chloroplast)
  const hotRamp = 'Increase Hitpoints by 10 (L39) to 16 (L50) per tick'
  assert.equal(parseHpLine(hotRamp, 39)?.amount, 10)
  assert.equal(parseHpLine(hotRamp, 50)?.amount, 16)
  assert.equal(parseHpLine(hotRamp, 39)?.direction, 'up')

  // 8. per-tick INSIDE the range clause, with a trailing parenthetical (Sebilite Pox)
  const inside = 'Increase Hitpoints by 1 per tick (L1) to 22 per tick (L65) (effect decreases over time)'
  assert.equal(parseHpLine(inside, 65)?.amount, 22)
  assert.equal(parseHpLine(inside, 65)?.perTick, true)

  // 9. the cleric Echo tail — a RANGE read at its midpoint, and a line that counts its own ticks
  const echo = parseHpLine('Increase Hitpoints between 165 and 190 for two additional ticks.', 50)
  assert.equal(echo?.amount, 177.5)
  assert.equal(echo?.perTick, true)
  assert.equal(echo?.statedTicks, 2)
})

test('R2 the casing and spelling variants the thirteen scrape passes left behind', () => {
  assert.equal(parseHpLine('Increase Current Hit Points by 60 per Tick', 1)?.amount, 60)
  assert.equal(parseHpLine('Increase Hitpoints v2 by 175 per tick', 1)?.direction, 'up')
  assert.equal(parseHpLine('Increases hitpoints by 4 per tick', 1)?.perTick, true)
  assert.equal(parseHpLine('Decrease Hit Points by 154', 1)?.amount, 154)
  assert.equal(parseHpLine('Decrease hitpoints by 20 per tick', 1)?.amount, 20)
  // `@L` is the same statement as `(L…)`
  assert.equal(parseHpLine('Decrease Hitpoints by 6 @L1 to 70 @L60', 60)?.amount, 70)
  // a bare range (Lifespike) reads at its midpoint, like `between … and …`
  assert.equal(parseHpLine('Decrease Hitpoints by 7 to 12', 1)?.amount, 9.5)
  // `after N ticks` is a DELAY, not a rate: Blooming Heal heals 300 once
  const delayed = parseHpLine('Increase Hitpoints by 300 after 4 ticks', 1)
  assert.equal(delayed?.amount, 300)
  assert.equal(delayed?.perTick, false)
  assert.equal(parseHpLine('Increase Hitpoints by 5000 after three ticks.', 1)?.perTick, false)
})

test('R3 ticks come from the duration, and a rate with no duration states no total', () => {
  assert.equal(ticksOf(null), 0)
  assert.equal(ticksOf(undefined), 0)
  assert.equal(ticksOf(0), 0)
  assert.equal(ticksOf(126_000), 21)
  assert.equal(ticksOf(20_000), 3, 'rounded, not floored')

  // A per-tick line on an instant spell contributes nothing: the catalog stated a rate and not
  // how long it runs, and multiplying by a guess would invent the total.
  const rateOnly = spellMetricsAt(
    { effects: ['Decrease Hitpoints by 10 per tick'], mana: 50, castTimeMs: 2000, durationMs: null },
    30
  )
  assert.equal(rateOnly, undefined)
})

test('R4 the metrics arithmetic — damage, dps and per mana, on the real rows', () => {
  // Anarchy: 273 (L34) to 288 (L39), 99 mana, 3.5s cast, instant.
  const anarchy = spellMetricsAt(entry('Anarchy'), 39)
  assert.equal(anarchy?.damage, 288)
  assert.equal(anarchy?.damagePerMana, 2.9) // 288/99 = 2.909…
  assert.equal(anarchy?.dps, 82.3) // 288 / 3.5
  assert.equal(anarchy?.dot, undefined)
  assert.equal(anarchy?.heal, undefined)

  // Blood of Pain: 56 (L41) to 65 (L50) per tick over its stated duration.
  const dot = spellMetricsAt(
    { effects: ['Decrease Hitpoints by 56 (L41) to 65 (L50) per tick'], mana: 100, castTimeMs: 3000, durationMs: 60_000 },
    50
  )
  assert.equal(dot?.damage, 650, '65 per tick x 10 ticks')
  assert.equal(dot?.dot, true)
  assert.equal(dot?.overSec, 60)
  assert.equal(dot?.dps, 10.3) // 650 / (3 + 60)
  assert.equal(dot?.damagePerMana, 6.5)

  // Chloroplast: a pure HoT — 16 per tick at L50 over 16 minutes, 200 mana, 6s cast.
  const hot = spellMetricsAt(entry('Chloroplast'), 50)
  assert.equal(hot?.heal, 2560, '16 x 160 ticks')
  assert.equal(hot?.hot, true)
  assert.equal(hot?.overSec, 960)
  assert.equal(hot?.healPerMana, 12.8)
  assert.equal(hot?.damage, undefined)
})

test('R5 the Echo family sums its direct heal and its self-counted tail', () => {
  // Celestial Echo: `Increase Hitpoints by 262 (L34) to 310 (L50)` then
  // `Increase Hitpoints between 165 and 190 for two additional ticks.` — 310 + 177.5*2.
  const echo = spellMetricsAt(entry('Celestial Echo'), 50)
  assert.equal(echo?.heal, 665)
  assert.equal(echo?.hot, true)
  // 245 mana
  assert.equal(echo?.healPerMana, 2.7)
})

test('R6 a lifetap is damage, and max-HP / HP-when-cast lines are not hit points arriving', () => {
  // Siphon: `Decrease Hitpoints by 80` + `Increase Hitpoints by 80 (Self)`, targetType Lifetap.
  const siphon = spellMetricsAt(entry('Siphon'), 30)
  assert.equal(siphon?.damage, 80)
  assert.equal(siphon?.heal, undefined, 'the increase side is the same 80 written from the other end')

  // The same two lines WITHOUT the Lifetap target type still read as both — the exclusion is a
  // claim about the catalog's own filing, not a guess from the strings.
  const notATap = spellMetricsAt(
    { effects: ['Decrease Hitpoints by 80', 'Increase Hitpoints by 80'], mana: 40, castTimeMs: 1000 },
    30
  )
  assert.equal(notATap?.damage, 80)
  assert.equal(notATap?.heal, 80)

  // A MAX-HP buff is not a heal, however it is spelled.
  assert.equal(parseHpLine('Increase Max Hitpoints by 202 (L34) to 225 (L42)', 42), null)
  assert.equal(parseHpLine('Increase Max Hit Points by 251', 42), null)
  assert.equal(parseHpLine('Increase Max HP by 800', 42), null)
  // `HP when cast` is the SAME magnitude written a second way (Armor of Protection states
  // 202→225 as both a Max Hitpoints line and an HP-when-cast line) — reading it would double.
  assert.equal(parseHpLine('Increase HP when cast by 202 (L34) to 225 (L42)', 42), null)
  assert.equal(parseHpLine('Decrease HP when cast by 50', 42), null)
  // Neither of these is an effect magnitude at all.
  assert.equal(parseHpLine("Stacking: Block new spell if slot 3 is effect 'Max Hitpoints' and < 1100", 1), null)
  assert.equal(parseHpLine('UNKNOWN CALC 118 base 406 max 446 attrib Max Hitpoints', 1), null)
  assert.equal(parseHpLine('Charm (up to L37)', 1), null)
})

test('R7 the whole committed catalog reads without producing a number nobody can hold', () => {
  let withMetrics = 0
  let hpLinesRead = 0
  let hpLinesDeclined = 0
  const declined = new Set<string>()
  for (const s of FILE.spells) {
    const m = spellMetricsAt(s, 50)
    if (m) withMetrics++
    for (const raw of s.effects ?? []) {
      const isHpShaped = /hit\s?points?/i.test(raw)
      const read = parseHpLine(raw, 50)
      if (read) {
        hpLinesRead++
        assert.ok(Number.isFinite(read.amount), `${s.name}: ${raw}`)
        assert.ok(read.amount >= 0, `${s.name}: ${raw}`)
      } else if (isHpShaped) {
        hpLinesDeclined++
        declined.add(raw.replace(/-?\d+(\.\d+)?/g, 'N'))
      }
    }
    for (const v of [m?.damage, m?.heal, m?.dps, m?.hps, m?.damagePerMana, m?.healPerMana]) {
      if (v !== undefined) assert.ok(Number.isFinite(v) && v > 0, `${s.name}: ${String(v)}`)
    }
  }
  // FLOORS, not exact counts — a re-scrape may add spells. The declined SHAPES are pinned
  // exactly, because a new unread shape is the thing worth noticing.
  assert.ok(hpLinesRead > 500, `read ${String(hpLinesRead)} hitpoint lines`)
  assert.ok(withMetrics > 300, `${String(withMetrics)} spells carry figures`)
  assert.ok(hpLinesDeclined > 0, 'the max-HP family is declined rather than silently absent')
  // Every declined shape is a max-HP statement, a stacking blocker or an uncomputed calc.
  for (const shape of declined) {
    assert.match(
      shape,
      /max\s+hit\s?points?|Stacking:|UNKNOWN CALC|\(pet_level\)/i,
      `unread hitpoint shape: ${shape}`
    )
  }
})

test('R8 the row parts read the way the panel prints them, with no em dash', () => {
  const dmg = spellMetricsParts({ damage: 143, dps: 48, damagePerMana: 2.1 })
  assert.deepEqual(dmg, ['dmg 143', 'dps 48', '2.1 dmg/mana'])
  const heal = spellMetricsParts({ heal: 250, hps: 83, healPerMana: 3.6 })
  assert.deepEqual(heal, ['heal 250', 'hps 83', '3.6 heal/mana'])
  const dot = spellMetricsParts({ damage: 650, dps: 10.3, damagePerMana: 6.5, dot: true, overSec: 60 })
  assert.equal(dot[dot.length - 1], 'over 60s')
  for (const p of [...dmg, ...heal, ...dot]) assert.ok(!/[—–]/.test(p), p)
  // Nothing at all for a spell with no hitpoint line.
  assert.deepEqual(spellMetricsParts({}), [])
})
