// WHAT THE ROUND-6 HOVER CARD IS MADE OF (JOS-194) — the one drops fold, and the one timer string.
//
// The owner asked a respawn row to answer two questions on mouseover: what the mob DROPS (the wiki
// table plus what we have looted off it ourselves) and what we know about its RESPAWN. Both halves
// are things this app already had, and the ruling was explicit that neither may be rebuilt — so
// both are pinned here, at the seam where a round 7 would start growing a second of either.
//
// PART ONE: THE DROPS FOLD — `shared/mobDrops.ts`.
//
// Three surfaces now answer "what does this drop, and how much of it have I seen myself" off one
// `MobKnowledge`: the consider strip's inline tail, the event overlay's mob hover card, and the
// respawn row's hover card. They used to hold two hand-written copies of the same merge, and the
// round-6 brief was explicit that a second drops source is the thing not to build — so this pins
// the shape they all read, and in particular the ORDERING CLAIM behind it: the wiki's table is the
// definitive statement and leads; your own history is corroboration riding ON a listed row; and
// only items the page does NOT list get a second, secondary block.
//
// Pure units — no UI, no Electron. Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mobDropNames, splitMobDrops } from '../src/shared/mobDrops'
import { RESPAWN_CARD_LABEL, respawnCardNote, respawnProvenance, type RespawnRow } from '../src/shared/respawn'
import type { MobKnowledge } from '../src/shared/mobTypes'

const T = 1_754_000_000_000

function knowledge(over: Partial<MobKnowledge> = {}): MobKnowledge {
  return { name: 'a frenzied ghoul', cached: true, ...over }
}

test('the wiki table leads, in the page order, and your counts ride on its rows', () => {
  const k = knowledge({
    dropsWiki: [{ item: 'Ghoulbane' }, { item: 'Rusty Dagger', rarity: 'Common' }],
    dropsSeen: [{ item: 'rusty dagger', count: 4, lastTs: T }]
  })
  const split = splitMobDrops(k)
  assert.deepEqual(split.wiki, [
    { item: 'Ghoulbane' },
    // Rarity is carried EXACTLY as the page stated it, and the count is yours, joined
    // case-insensitively (law 2) while both sides display raw.
    { item: 'Rusty Dagger', rarity: 'Common', seenCount: 4 }
  ])
  // Corroboration never becomes a second row.
  assert.deepEqual(split.extraSeen, [])
})

test('an item only YOUR history knows is secondary, never mixed into the table', () => {
  const split = splitMobDrops(
    knowledge({
      dropsWiki: [{ item: 'Ghoulbane' }],
      dropsSeen: [
        { item: 'Bone Chips', count: 12, lastTs: T },
        { item: 'Ghoulbane', count: 1, lastTs: T }
      ]
    })
  )
  assert.deepEqual(split.wiki, [{ item: 'Ghoulbane', seenCount: 1 }])
  assert.deepEqual(split.extraSeen, [{ item: 'Bone Chips', count: 12, lastTs: T }])
  // …and the flattened name list keeps that authority order for the inline surfaces.
  assert.deepEqual(mobDropNames(split), ['Ghoulbane', 'Bone Chips'])
})

test('a source that said nothing produces nothing — never an empty table dressed up as a claim', () => {
  // A page with no `known_loot` (a merchant), a mob you have never looted, and a lookup that
  // failed outright are three different silences and all three yield the same empty answer; the
  // CARD is what says which silence it was (law 1).
  for (const k of [null, undefined, knowledge(), knowledge({ dropsWiki: [] })]) {
    const split = splitMobDrops(k)
    assert.deepEqual(split.wiki, [])
    assert.deepEqual(split.extraSeen, [])
    assert.deepEqual(mobDropNames(split), [])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// PART TWO: THE TIMER BLOCK — and it is round 5's string, not a second one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round 5 cut the row's hover to the facts the row does not print and CAPPED it by test
 * (tests/respawnTimers.test.mts). Round 6 gave that sentence a home — a titled block leading the
 * mob card — and the whole point of the composition is that it is the SAME string: a card-only
 * spelling would drift straight back into the paragraph round 5 deleted, and the cap would not be
 * watching it. This asserts the identity, so that drift is not expressible.
 */
test('the hover CARD states the timer knowledge in the one provenance string', () => {
  const fmt = (ms: number | null | undefined): string => (ms == null ? '-' : `${String(Math.round(ms / 1000))}s`)
  const r: RespawnRow = {
    id: 'z::m',
    key: 'm',
    display: 'M',
    zone: 'Z',
    baseTs: 0,
    basis: 'death',
    source: 'observed',
    samples: 2,
    kills: 3,
    observedMs: 300_000,
    estimateMs: 300_000
  }
  const note = respawnCardNote(r, fmt)
  assert.equal(note.text, respawnProvenance(r, fmt), 'the card block is the provenance, not a second spelling')
  assert.equal(note.label, RESPAWN_CARD_LABEL)
  // A section TITLE inside a floating card, never a sentence of its own.
  assert.ok(note.label.length <= 16, note.label)
})

test('a page that lists an item twice still joins your count onto each listing', () => {
  // The scrape carries the page's rows verbatim, duplicates included; the fold must not silently
  // de-duplicate a table it does not own (a `+1` and its base are separate items — JOS-196).
  const split = splitMobDrops(
    knowledge({
      dropsWiki: [{ item: 'Bone Chips' }, { item: 'Bone Chips', rarity: '18.4%' }],
      dropsSeen: [{ item: 'Bone Chips', count: 7, lastTs: T }]
    })
  )
  assert.deepEqual(split.wiki, [
    { item: 'Bone Chips', seenCount: 7 },
    { item: 'Bone Chips', rarity: '18.4%', seenCount: 7 }
  ])
  assert.deepEqual(split.extraSeen, [])
})
