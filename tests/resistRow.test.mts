// The Resists card's arithmetic and its sentences (JOS-382).
//
// This repo has no jsdom and no React test renderer, so the split is the one `windowedRows` uses:
// the DERIVATION is pure and is tested here, the JSX is asserted by the e2e harness against the
// real app. What is being pinned is the COPY as much as the maths - every string below is
// something a player reads, and the honesty rules apply to all of it.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BAR_MAX,
  DIFFERS_NOTE,
  bandFraction,
  barFraction,
  NOT_OBSERVABLE_NOTE,
  countText,
  estimateText,
  evidenceByFamily,
  evidenceText,
  notEnoughText,
  songSummary,
  spellDisplayName,
  splitText
} from '../src/renderer/src/features/resists/resistRow'
import { RESIST_AXIS_COLORS } from '../src/renderer/src/features/resists/resistColors'
import { RESIST_AXES, RESIST_AXIS_WORDS, type ResistEstimate } from '../src/shared/resistTypes'

function est(spec: Partial<ResistEstimate> = {}): ResistEstimate {
  return {
    R: 126,
    lo: 110,
    hi: 144,
    n: 600,
    fromBaseline: 480,
    fromYou: 120,
    droppedNoLevel: 0,
    byFamily: { cast: { n: 600, resist: 40, land: 560 }, song: { n: 0, resist: 0, land: 0 } },
    perSpell: [],
    baselineWeight: 0,
    userOnly: false,
    droppedUnobservable: 0,
    baselineFit: null,
    userFit: null,
    differsFromShipped: false,
    nearlyImmune: false,
    ...spec
  }
}

test('the bar runs 0 to 200 because that is the whole range of the roll', () => {
  assert.equal(BAR_MAX, 200)
  assert.equal(barFraction(0), 0)
  assert.equal(barFraction(-40), 0)
  assert.equal(barFraction(100), 0.5)
  assert.equal(barFraction(200), 1)
  // Past 200 the bar pins full and the NUMBER carries the rest: an all-or-nothing spell already
  // never lands, and the partial-only band above it is not something a bar can say.
  assert.equal(barFraction(600), 1)
})

test('the interval draws as a band behind the number', () => {
  assert.deepEqual(bandFraction(100, 150), { left: 0.5, width: 0.25 })
  // A point estimate with no width is a zero-width band, not a negative one.
  assert.deepEqual(bandFraction(150, 150), { left: 0.75, width: 0 })
  assert.deepEqual(bandFraction(220, 400), { left: 1, width: 0 })
})

test('THE NUMBER NEVER APPEARS WITHOUT ITS INTERVAL AND ITS COUNT', () => {
  assert.equal(estimateText(est()), 'R 126 (110-144)')
  assert.equal(countText(600), 'n=600')
})

test('a thin cell says how little it has, and never draws a zero', () => {
  assert.equal(notEnoughText(2), 'not enough data (n=2)')
  assert.equal(notEnoughText(0), 'not enough data (n=0)')
})

test('the row states where its evidence came from, per axis', () => {
  assert.equal(splitText(est()), 'baseline 480 + you 120')
  // One-sided is said one-sidedly: "baseline 480 + you 0" is noise.
  assert.equal(splitText(est({ fromYou: 0 })), 'baseline 480')
  assert.equal(splitText(est({ fromBaseline: 0 })), 'you 120')
  assert.equal(splitText(est({ fromBaseline: 0, fromYou: 0 })), null)
})

test('the patch-detector note is a plain sentence with no em dash and no acronym', () => {
  assert.equal(DIFFERS_NOTE, 'differs from shipped data')
  assert.ok(!/[–—]/.test(DIFFERS_NOTE))
})

test('an evidence line prints only the clauses that have a number', () => {
  assert.equal(
    evidenceText({ spellKey: 'chaos flux', family: 'cast', casts: 155, resisted: 17, partial: 61, full: 77, land: 0, fromBaseline: 155, fromYou: 0 }),
    'Chaos Flux: 155 casts, 17 resisted, 61 partial'
  )
  // Zero partials and NO partial information are different things, and only one is worth a word.
  assert.equal(
    evidenceText({ spellKey: 'smiting strike', family: 'cast', casts: 1, resisted: 0, partial: 0, full: 0, land: 1, fromBaseline: 1, fromYou: 0 }),
    'Smiting Strike: 1 cast'
  )
})

test("a canonical key reads back as a name, apostrophes and small words and all", () => {
  assert.equal(spellDisplayName('chaos flux'), 'Chaos Flux')
  assert.equal(spellDisplayName("denon's disruptive discord"), "Denon's Disruptive Discord")
  assert.equal(spellDisplayName("largo's absonant binding"), "Largo's Absonant Binding")
  // EQ writes "Condemnation of Nife", never "Condemnation Of Nife".
  assert.equal(spellDisplayName('condemnation of nife'), 'Condemnation of Nife')
  assert.equal(spellDisplayName('strength of stone'), 'Strength of Stone')
  // …unless the small word leads, where it is still the start of the name.
  assert.equal(spellDisplayName('of the sky'), 'Of the Sky')
})

test('an evidence line says WHY a spell is not in the number', () => {
  const ev = {
    spellKey: "largo's melodic binding",
    family: 'song' as const,
    casts: 400,
    resisted: 400,
    partial: 0,
    full: 0,
    land: 0,
    fromBaseline: 400,
    fromYou: 0,
    landingsNotObservable: true,
  }
  assert.equal(
    evidenceText(ev),
    "Largo's Melodic Binding: 400 casts, 400 resisted, landings not observable"
  )
  assert.equal(NOT_OBSERVABLE_NOTE, 'landings not observable')
  assert.ok(!/[–—]/.test(NOT_OBSERVABLE_NOTE))
})

test('songs get their own line, and only when there are any', () => {
  assert.equal(songSummary(est()), null)
  assert.equal(
    songSummary(est({ byFamily: { cast: { n: 10, resist: 1, land: 9 }, song: { n: 42, resist: 7, land: 35 } } })),
    'Songs: 42 pulses, 7 resisted'
  )
})

test('the evidence list separates the two families', () => {
  const split = evidenceByFamily(
    est({
      perSpell: [
        { spellKey: 'chaos flux', family: 'cast', casts: 100, resisted: 4, partial: 20, full: 76, land: 0, fromBaseline: 100, fromYou: 0 },
        { spellKey: 'chords of dissonance', family: 'song', casts: 40, resisted: 6, partial: 0, full: 0, land: 34, fromBaseline: 0, fromYou: 40 }
      ]
    })
  )
  assert.deepEqual(
    split.casts.map((e) => e.spellKey),
    ['chaos flux']
  )
  assert.deepEqual(
    split.songs.map((e) => e.spellKey),
    ['chords of dissonance']
  )
})

test('NO ACRONYMS: every axis label is the word, and every axis has a colour', () => {
  for (const axis of RESIST_AXES) {
    assert.equal(RESIST_AXIS_WORDS[axis], axis, 'the label is the word itself')
    assert.match(RESIST_AXIS_COLORS[axis], /^#[0-9a-f]{6}$/, 'and a colour travels with it')
  }
  // Five axes, five distinct colours: a repeated hue would say two axes are one thing.
  assert.equal(new Set(Object.values(RESIST_AXIS_COLORS)).size, RESIST_AXES.length)
})

test('the five axis colours clear WCAG AA against the app paper background', () => {
  // The app is dark-only (`theme/theme.ts` builds one theme and there is no light variant), so
  // this is the ONE ground that has to work. Re-measure, do not re-pick, if a light theme lands.
  const paper = [0x17, 0x1a, 0x21]
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const lum = (rgb: number[]): number => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  for (const axis of RESIST_AXES) {
    const hex = RESIST_AXIS_COLORS[axis]
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [hi, lo] = [lum(rgb), lum(paper)].sort((a, b) => b - a)
    const ratio = (hi + 0.05) / (lo + 0.05)
    assert.ok(ratio >= 4.5, `${axis} ${hex} contrast ${ratio.toFixed(2)} against the paper background`)
  }
})
