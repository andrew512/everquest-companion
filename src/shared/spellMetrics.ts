// WHAT A SPELL IS WORTH, READ OFF THE WIKI'S OWN EFFECT LINES (JOS-391).
//
// `spellEffectClass.ts` classifies an effect line and deliberately reads no MAGNITUDES — its
// header says so, and says why: nobody had asked for them and inventing a taxonomy nobody has
// checked is how the name-stem era shipped four defects. Somebody has now asked. The Leveling
// tab's "New at this level" rows are a buying decision ("is this nuke worth the 99 mana"), and
// the only honest input to it is the number the page prints.
//
// So this is the magnitude reader, and it is a SEPARATE, DELETABLE layer for the same reason the
// classifier is: `spells.json` records what the wiki said, and everything derived from it lives
// where it can be deleted without taking the scrape with it. Pure over its arguments, no imports,
// no Electron - main computes it once at fold time (src/main/data/levelUnlocks.ts) and the numbers
// cross IPC while the effect strings stay behind.
//
// ── WHAT THESE NUMBERS ARE, AND WHAT THEY ARE NOT ──────────────────────────────────────────────
//
// They are the spell's BASE figures at a stated level: no critical hits, no focus items, no AA
// multipliers, no spell-damage bonus, no resist. They are DIRECTIONAL - the right instrument for
// comparing two spells you are choosing between, not a damage meter.
//
// AND RECAST IS NOT IN THE CATALOG AT ALL. `SpellEntry` carries `castTimeMs` and `durationMs` and
// no recast/refresh field, so a `dps` here is damage over the CAST plus (for a DoT) its duration,
// never over a real casting cycle. A wizard nuke's true sustained dps is lower than the number
// this file produces and a fast-recast spell's is higher. Stated here rather than in the UI on
// purpose: the caveat diet (AGENTS.md) - the panel says one quiet `directional` and stops.
//
// ── THE SHAPES, MEASURED ───────────────────────────────────────────────────────────────────────
//
// 664 hitpoint lines over the committed catalog in 51 distinct shapes. Every one of them is one
// of: a constant, a LEVEL RAMP stated as breakpoints, a RANGE stated as two bounds, or one of
// those marked per-tick. `tests/spellMetrics.test.mts` pins the nine the ticket named plus the
// exclusions below.
//
// WHAT IS EXCLUDED, AND WHY EACH EXCLUSION IS EVIDENCE-BACKED:
//
//   * `Increase Max Hitpoints by 202 (L34) to 225 (L42)` - a MAX-HP BUFF is not a heal. The head
//     test refuses it because `Max` sits between the verb and the noun (39 rows, plus 12 more
//     spelled `Max HP` / `Max Hit Points`).
//   * `Decrease HP when cast by 50` (67 rows) and `Increase HP when cast by ...` (42) - the
//     abbreviated spelling, and it is a DUPLICATE RENDERING rather than a second effect:
//     `Armor of Protection` states `Increase Max Hitpoints by 202 (L34) to 225 (L42)` and
//     `Increase HP when cast by 202 (L34) to 225 (L42)`, the same numbers twice. Reading both
//     would double every figure it touches, so this reader answers to the `Hit Points` spelling
//     only and says so here rather than guessing which of a pair is the real one.
//   * `Stacking: Block new spell if slot 3 is effect 'Max Hitpoints' and < 1100` and
//     `UNKNOWN CALC 118 base 406 max 446 attrib Max Hitpoints` - neither is an effect magnitude;
//     both fail the head test for free.

/** A hitpoint line, read: how much, per tick or not, and over how many ticks the line states. */
interface HpLine {
  /** Positive magnitude at the evaluation level. */
  amount: number
  /** `Increase` (a heal) or `Decrease` (damage). */
  direction: 'up' | 'down'
  /** True when the amount lands EVERY tick rather than once. */
  perTick: boolean
  /**
   * The tick count the LINE ITSELF states, when it states one.
   *
   * Two families do: `Increase Hitpoints between 165 and 190 for two additional ticks.` (the
   * cleric Echo tail - per tick, for exactly two) and `Increase Hitpoints by 300 after 4 ticks`
   * (Blooming Heal - the whole amount, once, after a delay). Where a line counts its own ticks
   * that count wins over the duration, because the line is the more specific evidence.
   */
  statedTicks?: number
}

/** The figures a row draws. Absent fields mean "this spell has no such line", never zero. */
export interface SpellMetrics {
  /** Total base damage at the evaluation level, DoT ticks included. */
  damage?: number
  /** Total base healing at the evaluation level, HoT ticks included. */
  heal?: number
  /** damage / mana. Absent when the catalog states no mana, or states 0. */
  damagePerMana?: number
  /** heal / mana, same rule. */
  healPerMana?: number
  /** damage over cast time plus, for a DoT, its whole duration. */
  dps?: number
  /** the same for healing. */
  hps?: number
  /** True when any damage arrives per tick - the row marks it `over Ns`. */
  dot?: boolean
  /** True when any healing arrives per tick. */
  hot?: boolean
  /** The duration the ticks run over, in whole seconds. Present only with `dot`/`hot`. */
  overSec?: number
}

/** The catalog fields this reader needs. A subset of `SpellEntry`, so a caller can pass one. */
export interface SpellMetricsInput {
  effects?: string[]
  mana?: number
  castTimeMs?: number
  durationMs?: number | null
  /** `target_type` verbatim. `Lifetap` changes what the Increase line means - see below. */
  targetType?: string
}

/** One EQ tick. */
const TICK_MS = 6000

/** The tick counts the two self-counting families spell out in words. */
const TICK_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

/**
 * The head of a hitpoint line: an increase or a decrease OF HIT POINTS, and nothing between the
 * verb and the noun but an optional `Current`.
 *
 * The gap is the whole point (the `spellEffectClass.ts` anchor argument, one noun further in):
 * `Increase Max Hitpoints` states a bigger HP POOL and `Increase Hitpoints` states hit points
 * arriving, and the only thing telling them apart is the word in between. The `v\d` tail is
 * Torpor's and Celestial Cleansing's spelling (`Increase Hitpoints v2 by 300 per tick`), and the
 * trailing `s` is `Increases hitpoints by 2 per tick` (Extended Regeneration).
 */
const HP_HEAD_RE = /^(increase|decrease)s?\s+(?:current\s+)?hit\s?points?(?:\s+v\d+)?\b/i

/**
 * `@L44` is the same statement as `(L44)`, and a `per tick` sitting BETWEEN a value and its
 * breakpoint is a rate marker rather than part of the ramp.
 *
 * The second half is what Sebilite Pox needs: `by 1 per tick (L1) to 22 per tick (L65)` states
 * the same two-point ramp as `by 1 (L1) to 22 (L65) per tick`, with the marker repeated inside
 * each clause. Reading it whole yields the value at L1 for every level. The rate is detected on
 * the untouched tail, so removing the words here costs nothing.
 */
function normalizeBreakpoints(s: string): string {
  return s.replace(/@\s*l(\d+)/gi, '(L$1)').replace(/\s*\bper\s+tick\b/gi, '')
}

/** A stated (level, value) breakpoint, e.g. the `22 (L50)` of a ramp. */
interface Breakpoint {
  level: number
  value: number
}

/** Every `N (LM)` the tail states, ascending by level. */
function breakpointsOf(tail: string): Breakpoint[] {
  const out: Breakpoint[] = []
  const re = /(-?\d+)\s*\(L(\d+)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(tail)) !== null) out.push({ value: Number(m[1]), level: Number(m[2]) })
  return out.sort((a, b) => a.level - b.level)
}

/**
 * A ramp read at `level`: linear between the two breakpoints it falls between, CLAMPED outside.
 *
 * Clamped rather than extrapolated because the wiki's ramp is a statement about a band, not a
 * formula - `Decrease Hitpoints by 10 (L1) to 0 (L70) to 65 (L110)` extrapolated below 1 or above
 * 110 produces numbers the page never claimed. Non-monotonic ramps like that one are handled for
 * free: nothing here assumes the values ascend, only that the LEVELS do.
 */
function rampAt(points: readonly Breakpoint[], level: number): number {
  const first = points[0]
  const last = points[points.length - 1]
  if (level <= first.level) return first.value
  if (level >= last.level) return last.value
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (level > b.level) continue
    const span = b.level - a.level
    if (span <= 0) return b.value
    return a.value + ((b.value - a.value) * (level - a.level)) / span
  }
  return last.value
}

/**
 * The magnitude the tail states at `level`, or null when it states none.
 *
 * The order is specific-to-general and each arm is a measured family:
 *   breakpoints  `by 273 (L34) to 288 (L39)`, `by 10 (L1) to 0 (L70) to 65 (L110)`, `by 360 (L50)`
 *   between/and  `between 165 and 190` (the Echo tail, and `Decrease Hitpoints between 40 and 90.`)
 *   bare range   `by 7 to 12` (Lifespike)
 *   constant     `by 100`
 * A range is read at its MIDPOINT: the page states two bounds and no distribution, and the
 * midpoint is the only summary that does not prefer one end of a claim the wiki did not make.
 */
function magnitudeAt(tailRaw: string, level: number): number | null {
  const tail = normalizeBreakpoints(tailRaw)
  const points = breakpointsOf(tail)
  if (points.length > 0) return rampAt(points, level)
  const between = /\bbetween\s+(-?\d+)\s+and\s+(-?\d+)/i.exec(tail)
  if (between) return (Number(between[1]) + Number(between[2])) / 2
  const range = /\bby\s+(-?\d+)\s+to\s+(-?\d+)/i.exec(tail)
  if (range) return (Number(range[1]) + Number(range[2])) / 2
  const flat = /\bby\s+(-?\d+)/i.exec(tail)
  return flat ? Number(flat[1]) : null
}

/** `for two additional ticks` / `after 4 ticks` - the count, when the line counts for itself. */
function statedTicksOf(tail: string): number | undefined {
  const m = /\b(?:for|after)\s+(\d+|one|two|three|four|five|six)\s+(?:additional\s+)?ticks?\b/i.exec(tail)
  if (!m) return undefined
  const word = m[1].toLowerCase()
  const n = TICK_WORDS[word] ?? Number(word)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Read ONE effect line, or null when it is not a hitpoint line.
 *
 * `after N ticks` is a DELAY, not a rate (`Increase Hitpoints by 300 after 4 ticks` heals 300
 * once, four ticks late), so it is deliberately NOT `perTick`; `for N additional ticks` IS a rate
 * and carries its own count. Everything else marked `per tick` takes its count from the duration.
 */
export function parseHpLine(line: string, level: number): HpLine | null {
  const s = line.trim()
  const head = HP_HEAD_RE.exec(s)
  if (!head) return null
  const tail = s.slice(head[0].length)
  const amount = magnitudeAt(tail, level)
  if (amount === null) return null
  const statedTicks = statedTicksOf(tail)
  const perTick = /\bper\s+tick\b/i.test(tail) || /\bfor\s+\S+\s+additional\s+ticks?\b/i.test(tail)
  const out: HpLine = {
    amount: Math.abs(amount),
    direction: head[1].toLowerCase() === 'increase' ? 'up' : 'down',
    perTick
  }
  if (statedTicks !== undefined) out.statedTicks = statedTicks
  return out
}

/** Whole ticks the duration covers. 0 when the catalog states no duration (an instant spell). */
export function ticksOf(durationMs: number | null | undefined): number {
  return typeof durationMs === 'number' && durationMs > 0 ? Math.round(durationMs / TICK_MS) : 0
}

/** Round to one decimal, and drop a trailing `.0` by returning a number rather than a string. */
function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/** One side's running totals while the lines are folded. */
interface Side {
  total: number
  /** True when any of it arrives per tick. */
  overTime: boolean
}

/**
 * Fold one read line into the damage/heal totals.
 *
 * A per-tick line contributes `amount x ticks`, where the ticks are the line's own count when it
 * states one and the duration's otherwise. A per-tick line on a spell with NO duration and no
 * stated count contributes NOTHING - the catalog has told us a rate and not how long it runs, and
 * multiplying by a guess would put a made-up total in front of a player.
 */
function foldLine(side: Side, line: HpLine, durationTicks: number): void {
  if (!line.perTick) {
    side.total += line.amount
    return
  }
  const ticks = line.statedTicks ?? durationTicks
  if (ticks <= 0) return
  side.total += line.amount * ticks
  side.overTime = true
}

/**
 * THE FIGURES FOR ONE SPELL AT ONE LEVEL. Returns undefined when the spell has no hitpoint line
 * at all, which is most of the catalog and is a row that simply shows no figures.
 *
 * `level` is the evaluation level: the level the class GAINS the spell at for an unlock row, the
 * level being viewed for a browsing one. Every ramp is read there and nowhere else.
 *
 * LIFETAPS COUNT AS DAMAGE, AND THE TARGET TYPE IS WHAT SAYS SO. `Lifetap` and `Siphon` state the
 * same magnitude twice - `Decrease Hitpoints by 80` then `Increase Hitpoints by 80 (Self)` - which
 * is one transfer written from both ends. Counting the second as healing would credit the spell
 * with a heal it does not perform on anybody but the caster and would put a `heal/mana` on a
 * detrimental spell. The catalog files all 28 such rows under `targetType: 'Lifetap'`, so the
 * increase side is dropped there and the damage side stands alone.
 */
export function spellMetricsAt(spell: SpellMetricsInput, level: number): SpellMetrics | undefined {
  const lifetap = spell.targetType === 'Lifetap'
  const durationTicks = ticksOf(spell.durationMs)
  const dmg: Side = { total: 0, overTime: false }
  const heal: Side = { total: 0, overTime: false }
  let any = false
  for (const raw of spell.effects ?? []) {
    const line = parseHpLine(raw, level)
    if (!line) continue
    if (lifetap && line.direction === 'up') continue
    any = true
    foldLine(line.direction === 'down' ? dmg : heal, line, durationTicks)
  }
  if (!any) return undefined
  return assemble(dmg, heal, spell, durationTicks)
}

/** The per-mana and per-second derivations, once both sides are totalled. */
function assemble(
  dmg: Side,
  heal: Side,
  spell: SpellMetricsInput,
  durationTicks: number
): SpellMetrics | undefined {
  const mana = typeof spell.mana === 'number' && spell.mana > 0 ? spell.mana : null
  const castSec = (spell.castTimeMs ?? 0) / 1000
  const overSec = durationTicks * (TICK_MS / 1000)
  const out: SpellMetrics = {}
  if (dmg.total > 0) {
    out.damage = r1(dmg.total)
    if (mana !== null) out.damagePerMana = r1(dmg.total / mana)
    const window = castSec + (dmg.overTime ? overSec : 0)
    if (window > 0) out.dps = r1(dmg.total / window)
    if (dmg.overTime) out.dot = true
  }
  if (heal.total > 0) {
    out.heal = r1(heal.total)
    if (mana !== null) out.healPerMana = r1(heal.total / mana)
    const window = castSec + (heal.overTime ? overSec : 0)
    if (window > 0) out.hps = r1(heal.total / window)
    if (heal.overTime) out.hot = true
  }
  if ((out.dot === true || out.hot === true) && overSec > 0) out.overSec = Math.round(overSec)
  return out.damage === undefined && out.heal === undefined ? undefined : out
}

/**
 * The row's compact figures, in the order the panel prints them:
 * `dmg 143 · dps 48 · 2.1 dmg/mana`, `heal 250 · hps 83 · 3.6 heal/mana`, `over 24s`.
 *
 * ONE FORMATTER, shared by the unlock row and (by design) the spell search that reuses these
 * rows - two components formatting the same figures is two opinions about what `2.1` means.
 * No em dashes; the separator is the middle dot the rest of the app already uses.
 */
export function spellMetricsParts(m: SpellMetrics): string[] {
  const parts: string[] = []
  if (m.damage !== undefined) {
    parts.push(`dmg ${String(Math.round(m.damage))}`)
    if (m.dps !== undefined) parts.push(`dps ${String(Math.round(m.dps))}`)
    if (m.damagePerMana !== undefined) parts.push(`${String(m.damagePerMana)} dmg/mana`)
  }
  if (m.heal !== undefined) {
    parts.push(`heal ${String(Math.round(m.heal))}`)
    if (m.hps !== undefined) parts.push(`hps ${String(Math.round(m.hps))}`)
    if (m.healPerMana !== undefined) parts.push(`${String(m.healPerMana)} heal/mana`)
  }
  if (m.overSec !== undefined) parts.push(`over ${String(m.overSec)}s`)
  return parts
}
