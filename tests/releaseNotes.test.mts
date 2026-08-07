// What's new (src/shared/releaseNotes.ts) — JOS-73.
//
// TWO CLAIMS ARE UNDER TEST AND THEY ARE DIFFERENT KINDS OF CLAIM.
//
//   THE DATA. `RELEASE_NOTES` is hand-written and grows by one entry per release forever, which
//   makes it exactly the sort of file that acquires a duplicate version, a date typed in the
//   wrong order, or a row inserted in the wrong place — none of which would throw, and all of
//   which would quietly break the ordering every derivation below assumes. `releaseNotesProblems`
//   is the shape check, and it is the SAME function the release job runs
//   (scripts/check-release-notes.mjs), so a tag that ships is a tag whose notes passed this.
//
//   THE DERIVATION. "Which releases are new to this install" is a pure function of one stored
//   string, and every state it can be in is reachable here in a line: the fresh install that must
//   see nothing, the one-release upgrade, and the A→D case — 0.6.3 landing on 0.8.0 marks BOTH
//   0.7.0 and 0.8.0, which is the whole reason the key stores a version instead of a boolean.
//
// No Electron, no store file, no renderer: shared/releaseNotes.ts is a zero-import pure module,
// so this suite is as cheap and as unskippable as graphicsPrefs/overlayLayout.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RELEASE_NOTES,
  compareVersions,
  hasReleaseNote,
  latestReleaseVersion,
  parseVersion,
  releaseNotesProblems,
  variantLastSeen,
  whatsNewState,
  type ReleaseNote
} from '../src/shared/releaseNotes'

// A small fixture list so the derivation tests do not move every time a release ships.
const NOTES: readonly ReleaseNote[] = [
  { version: '0.8.0', date: '2026-08-07', entries: [{ kind: 'new', text: 'Eight.' }] },
  { version: '0.7.0', date: '2026-08-07', entries: [{ kind: 'fixed', text: 'Seven.' }] },
  { version: '0.6.3', date: '2026-08-06', entries: [{ text: 'Six three.' }] },
  { version: '0.6.2', date: '2026-08-05', entries: [{ text: 'Six two.' }] },
  { version: '0.6.1', date: '2026-08-05', entries: [{ text: 'Six one.' }] }
]

// ---------------------------------------------------------------- the data

test('the committed notes are sound: ordering, versions, dates, entries', () => {
  assert.deepEqual(releaseNotesProblems(), [], 'src/shared/releaseNotes.ts has problems')
})

test('the newest note is the head of the list, and that is what an install gets stamped with', () => {
  assert.equal(latestReleaseVersion(), RELEASE_NOTES[0]!.version)
  // The stamp must be a real release, or the next launch would find everything newer than a
  // version that never shipped.
  assert.ok(hasReleaseNote(latestReleaseVersion()))
})

test('releaseNotesProblems CATCHES the mistakes this file will actually acquire', () => {
  const bad = (notes: ReleaseNote[]): string => releaseNotesProblems(notes).join(' | ')

  // Out of order — a row pasted at the bottom instead of the top.
  assert.match(
    bad([
      { version: '0.7.0', date: '2026-08-07', entries: [{ text: 'a' }] },
      { version: '0.8.0', date: '2026-08-07', entries: [{ text: 'b' }] }
    ]),
    /newest first/
  )
  // A duplicated version — "strictly below" is what rejects it.
  assert.match(
    bad([
      { version: '0.8.0', date: '2026-08-07', entries: [{ text: 'a' }] },
      { version: '0.8.0', date: '2026-08-07', entries: [{ text: 'b' }] }
    ]),
    /strictly below/
  )
  // A date in the wrong format, an empty release, an empty line, an invented kind.
  assert.match(bad([{ version: '0.8.0', date: '08/07/2026', entries: [{ text: 'a' }] }]), /YYYY-MM-DD/)
  assert.match(bad([{ version: '0.8.0', date: '2026-08-07', entries: [] }]), /no entries/)
  assert.match(bad([{ version: '0.8.0', date: '2026-08-07', entries: [{ text: '  ' }] }]), /no text/)
  assert.match(
    bad([
      {
        version: '0.8.0',
        date: '2026-08-07',
        entries: [{ kind: 'improved' as 'new', text: 'a' }]
      }
    ]),
    /unknown kind/
  )
  assert.match(bad([]), /empty/)
})

// ---------------------------------------------------------------- versions

test('version comparison orders the triple, and a release outranks its own prereleases', () => {
  assert.equal(compareVersions('0.8.0', '0.7.0'), 1)
  assert.equal(compareVersions('0.6.3', '0.6.10'), -1, 'patch is numeric, not lexical')
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, 'minor is numeric, not lexical')
  assert.equal(compareVersions('0.8.0', '0.8.0'), 0)
  assert.equal(compareVersions('v0.8.0', '0.8.0'), 0, 'a tag name and a version are the same value')
  assert.equal(compareVersions('0.8.0', '0.8.0-main.3'), 1)
  assert.equal(compareVersions('0.8.0-main.3', '0.8.0'), -1)
  // Unparseable reads as 0.0.0 — the SAFE direction: a junk stored value makes every release
  // look new rather than silently hiding one.
  assert.deepEqual(parseVersion('nonsense'), { major: 0, minor: 0, patch: 0, pre: '' })
  assert.equal(compareVersions('0.2.0', 'nonsense'), 1)
})

test('hasReleaseNote answers a TAG, prerelease tail and leading v included', () => {
  assert.ok(hasReleaseNote('v0.8.0', NOTES))
  assert.ok(hasReleaseNote('0.8.0-main.7', NOTES), 'a prerelease of a release that has notes')
  assert.ok(!hasReleaseNote('v0.9.0', NOTES), 'a version with no entry is the CI gate firing')
})

// ---------------------------------------------------------------- the state

test('A FRESH INSTALL HAS NO NEWS — no teaser, nothing marked', () => {
  for (const absent of [null, undefined, '', '   ']) {
    const s = whatsNewState(absent, NOTES)
    assert.equal(s.fresh, true)
    assert.deepEqual(s.newVersions, [])
    assert.equal(s.teaserVersion, null, 'a person who installed today did not live through 0.8.0')
  }
})

test('a one-release upgrade marks one release and names it', () => {
  const s = whatsNewState('0.7.0', NOTES)
  assert.equal(s.fresh, false)
  assert.deepEqual(s.newVersions, ['0.8.0'])
  assert.equal(s.teaserVersion, '0.8.0')
})

test('A→D: 0.6.3 landing on 0.8.0 marks BOTH 0.7.0 and 0.8.0, and the teaser names only the newest', () => {
  const s = whatsNewState('0.6.3', NOTES)
  assert.deepEqual(s.newVersions, ['0.8.0', '0.7.0'], 'newest first, everything since last seen')
  assert.equal(s.teaserVersion, '0.8.0', 'one line about where you landed, not a list of what you missed')
})

test('an install already on the newest release has nothing new and no teaser', () => {
  const s = whatsNewState('0.8.0', NOTES)
  assert.equal(s.fresh, false, 'dismissed is NOT the same state as never-installed')
  assert.deepEqual(s.newVersions, [])
  assert.equal(s.teaserVersion, null)
})

test('a store from a NEWER build (downgrade) claims no news rather than inventing some', () => {
  const s = whatsNewState('9.9.9', NOTES)
  assert.deepEqual(s.newVersions, [])
  assert.equal(s.teaserVersion, null)
})

// ------------------------------------------------------------ dev variants

test('the DEV variant control drives exactly the three states, from the notes themselves', () => {
  assert.equal(variantLastSeen('fresh', NOTES), null)
  assert.equal(variantLastSeen('previous', NOTES), '0.7.0')
  assert.equal(variantLastSeen('several', NOTES), '0.6.1')

  // …and each one lands the state it is named for.
  assert.deepEqual(whatsNewState(variantLastSeen('fresh', NOTES), NOTES).newVersions, [])
  assert.deepEqual(whatsNewState(variantLastSeen('previous', NOTES), NOTES).newVersions, ['0.8.0'])
  assert.deepEqual(whatsNewState(variantLastSeen('several', NOTES), NOTES).newVersions, [
    '0.8.0',
    '0.7.0',
    '0.6.3',
    '0.6.2'
  ])
})

test('the variants never name a version off the end of a short list', () => {
  const one: readonly ReleaseNote[] = [NOTES[0]!]
  assert.equal(variantLastSeen('previous', one), '0.8.0')
  assert.equal(variantLastSeen('several', one), '0.8.0')
  assert.equal(variantLastSeen('previous', []), null)
  assert.equal(variantLastSeen('several', []), null)
})
