// The Maps tab's ZONE SELECTOR, minus the DOM: what a stem is called, which queries reach it,
// and the auto-switch seam it shares with the log.
//
// TWO CLAIMS, AND THE SECOND IS THE ONE THAT COSTS SOMETHING WHEN IT BREAKS:
//
//   1. BOTH SPELLINGS ARE SEARCHABLE. The stem on disk and the long name the table gives it
//      rarely resemble each other — `soldungb` is Nagafen's Lair, `airplane` is The Plane of
//      Sky — so a selector that filtered on one of them would hide half the corpus from whichever
//      name the user happens to know. Neither spelling is the "real" one.
//   2. THE ZONE→MAP HOP IS `zoneShortName` AND NOTHING ELSE. Zoning re-points the viewer by
//      folding the log's raw long name to a stem through the hand-authored table; a name the
//      table does not carry yields `null`, which must mean NO SWITCH, never a nearest guess
//      (world-model law 1). This asserts that on the real log names, including the deliberately
//      ambiguous ones, and that whatever the fold DOES produce is a stem the selector can label
//      and reach — a resolved zone that the control could not offer would be an auto-switch to a
//      row the user can never get back to by hand.
//
// Pure string work over the committed table — no React, no DOM, no Electron — so it never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ZONES, zoneShortName } from '../src/shared/zones'
import {
  ZONE_OPTIONS_MAX,
  filterZones,
  zoneLabel,
  zoneMatches,
  zoneOptions
} from '../src/renderer/src/features/maps/zoneOptions'

/** A stand-in corpus in the shape `listMapZones` returns: stems, ascending. */
const CORPUS = [...new Set(ZONES.map((z) => z.short))].sort()

test('a stem is labelled by the table, and an unknown stem is shown raw', () => {
  assert.equal(zoneLabel('airplane'), 'The Plane of Sky')
  assert.equal(zoneLabel('soldungb'), "Nagafen's Lair")
  // A pack may ship a stem the hand-authored table has never heard of. It is still selectable,
  // and it is NOT prettified into a name nobody verified.
  assert.equal(zoneLabel('notazoneatall'), 'notazoneatall')
})

test('either spelling reaches the zone — the stem or the long name', () => {
  assert.ok(zoneMatches('airplane', 'airplane'))
  assert.ok(zoneMatches('airplane', 'plane of sky'))
  assert.ok(zoneMatches('soldungb', 'nagafen'))
  assert.ok(!zoneMatches('airplane', 'nagafen'))
})

test('the filter narrows on both spellings and is capped', () => {
  assert.deepEqual(filterZones(CORPUS, 'plane of sky'), ['airplane'])
  assert.deepEqual(filterZones(CORPUS, '  AIRPLANE  '), ['airplane'])
  // An empty query offers the corpus itself, in the order it arrived.
  assert.deepEqual(filterZones(CORPUS, '', CORPUS.length), CORPUS)
  assert.equal(filterZones(CORPUS, '', 3).length, 3)
  assert.ok(ZONE_OPTIONS_MAX > 0)
  assert.equal(filterZones(CORPUS, 'no-such-zone-anywhere').length, 0)
})

test('the current selection is always offered, even from a pack that is gone', () => {
  // A remembered `eq.maps.zone` can outlive the pack that provided it; a value MUI cannot find
  // renders as an empty box, which reads as "no zone open" while a map is on screen.
  assert.deepEqual(zoneOptions(['a', 'b'], 'c'), ['c', 'a', 'b'])
  assert.deepEqual(zoneOptions(['a', 'b'], 'b'), ['a', 'b'])
  assert.deepEqual(zoneOptions(['a', 'b'], null), ['a', 'b'])
})

test('zoning auto-switches only to a stem the selector can offer, and never guesses', () => {
  // Every long name the table carries folds back to its own stem — the hop the maps tab makes on
  // every `You have entered X.` line.
  for (const entry of ZONES) {
    assert.equal(zoneShortName(entry.name), entry.short, entry.name)
    const stem = zoneShortName(entry.name)
    // Uncapped on purpose: reachability is the claim, not where the row lands in a long list.
    assert.ok(
      stem != null && filterZones(CORPUS, zoneLabel(stem), CORPUS.length).includes(stem),
      entry.name
    )
  }
  // Ambiguous and unseen names resolve to nothing at all. `null` is what makes an unmatched zone
  // a no-op at the boundary rather than a confidently wrong map.
  for (const raw of ['Freeport', 'Kaladim', 'Neriak', 'Qeynos', 'EQL Tutorial', '']) {
    assert.equal(zoneShortName(raw), null, raw)
  }
  assert.equal(zoneShortName(undefined), null)
})
