// ============================================================================
// releaseNotes — what changed, release by release, and who has not read it yet (JOS-73).
// ============================================================================
//
// THE NOTES ARE COMMITTED SOURCE, not a fetch. Three reasons, in order of weight:
//
//   1. The app must be able to say what changed while offline, in a game session, with no
//      network and no GitHub. A release note that needs a request is a release note that is
//      sometimes absent, which is worse than none at all.
//   2. The bundler INLINES this module into the renderer exactly the way it inlines spells.json
//      and the mob catalog, so the notes ship with the build that they describe. A build can
//      never show a newer release's notes, and never lose its own.
//   3. It is reviewable in the diff that ships it. The owner reads the sentence in the pull
//      request, not on a web page afterwards.
//
// THE STORE KEY IS A VERSION, NOT A BOOLEAN. `lastSeenNotesVersion` (src/main/store.ts) holds
// the newest release whose notes this install has been SHOWN. That is what makes the A→D case
// work without bookkeeping: somebody who was on 0.6.3 and lands on 0.8.0 has TWO releases of
// news, and the panel marks both, because "new" is a comparison and not a flag somebody had to
// remember to set per release.
//
// AND AN ABSENT KEY MEANS A FRESH INSTALL, WHICH HAS NO NEWS. Nothing is marked, and the teaser
// strip never appears — a person who installed the app twenty minutes ago did not live through
// any of these changes, and telling them "Updated to v0.8.0" on their first launch would be a
// small lie in the first sentence the app ever says to them. The panel is still there to browse;
// it is history, and history is available to everyone.
//
// WHY THE STAMP IS THE NEWEST NOTE VERSION AND NOT `app.getVersion()`. package.json carries
// `0.1.0` forever — CI stamps the real version FROM THE TAG and never commits it (AGENTS.md,
// Shipping), so `app.getVersion()` reads 0.1.0 on every dev run. Stamping that would make every
// release look new on every launch in dev, and comparing against it would blank the whole
// feature there. The newest entry in this list IS the running version in every published build
// (the release job refuses a tag with no entry — scripts/check-release-notes.mjs), so reading it
// from the data is both honest and testable from a checkout.
//
// VOICE: player-centric and plain. What YOU can now do, or what stopped being wrong. Not wave
// names, not module names, not ticket ids. `kind` is the only structure — the panel groups by it
// into "New" / "Fixed" / "Changed" sub-headers, and a release whose entries carry no kind (the
// one-line historical headlines below) renders as a bare line with no sub-header at all.

/** Which sub-header an entry sits under. Absent ⇒ the entry is a bare headline line. */
export type ReleaseEntryKind = 'new' | 'fixed' | 'changed'

/** One line of a release's notes. */
export interface ReleaseEntry {
  readonly kind?: ReleaseEntryKind
  readonly text: string
}

/** One release. `date` is an ISO calendar date (YYYY-MM-DD), rendered through the app's own
 *  local-date formatter — never parsed for arithmetic. */
export interface ReleaseNote {
  readonly version: string
  readonly date: string
  readonly entries: readonly ReleaseEntry[]
}

/**
 * Every release, NEWEST FIRST — the order the panel renders and the order every derivation
 * below assumes (`releaseNotesProblems` pins it, so the assumption is checked rather than
 * trusted).
 *
 * The releases before 0.7.0 carry ONE headline each. They are backfilled from the tag dates and
 * the commits in each tag's range, and a headline is the honest resolution for them: nobody was
 * writing player-facing notes at the time, so reconstructing a six-bullet changelog per patch
 * would be inventing detail rather than recovering it.
 *
 * v0.3.3 is deliberately ABSENT: its tag points at the same commit as v0.3.2, so there is
 * nothing it changed. The comparison is by version, not by row, so an install stamped 0.3.3
 * still sees exactly the releases above it.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.8.0',
    date: '2026-08-07',
    entries: [
      { kind: 'new', text: 'Suggested alerts for slows wearing off, mote drops, and receiving tells.' },
      {
        kind: 'new',
        text: 'The exaltation planner has ear, wrist and finger slots — plan two ring effects at once.'
      },
      { kind: 'fixed', text: 'Maps render north correctly (north and south were mirrored).' },
      {
        kind: 'fixed',
        text: 'Plane of Sky items on your Equipment keyring now count as owned.'
      },
      {
        kind: 'fixed',
        text: 'Items whose wiki pages hide their slot (like the Golem Metal Wand) can donate their effects, and an empty planner result now says which filters are hiding rows.'
      },
      { text: 'Plus: the log engine is faster again.' }
    ]
  },
  {
    version: '0.7.0',
    date: '2026-08-07',
    entries: [
      {
        kind: 'changed',
        text: 'The meter no longer asks “your pet?” — order your pet once (/pet attack) or use /pet who leader and it is yours from that moment; re-summoning retires the old pet.'
      },
      {
        kind: 'fixed',
        text: 'Raid mobs that lifetap are never misfiled as players, so your pet’s damage against them counts.'
      },
      {
        kind: 'fixed',
        text: 'Loading no longer pegs a CPU core, and the overlays and cursor ring stay out of the way — and off your mouse — until parsing finishes.'
      },
      { kind: 'fixed', text: 'Switching characters no longer replays old alerts and celebrations.' },
      {
        kind: 'fixed',
        text: 'The game-folder setting works pointed at the install folder, the Logs folder, or a log file.'
      },
      {
        kind: 'changed',
        text: 'The exaltation teaching card opens from the ? button instead of appearing on its own.'
      }
    ]
  },
  {
    version: '0.6.3',
    date: '2026-08-06',
    entries: [
      {
        text: 'The planner tab is called Exaltations, Back returns you where you came from, every /outputfile export says how to run it, and two graphics switches arrive for cards that dislike the overlays.'
      }
    ]
  },
  {
    version: '0.6.2',
    date: '2026-08-05',
    entries: [
      {
        text: 'Your group appears in the meters, overlay text can be sized, the Maps sidebar becomes one search box, and the planner learns to teach.'
      }
    ]
  },
  {
    version: '0.6.1',
    date: '2026-08-05',
    entries: [
      {
        text: 'Closing the app really closes it — a failed teardown could leave the process running with no window.'
      }
    ]
  },
  {
    version: '0.6.0',
    date: '2026-08-05',
    entries: [
      {
        text: 'Attack-round stats say what the log states and what it infers, picking your EverQuest folder attaches to the log right away, and the installer runs under Wine.'
      }
    ]
  },
  {
    version: '0.5.0',
    date: '2026-08-05',
    entries: [
      {
        text: 'Monk special attacks get their real names, your /outputfile dumps are read on sight, and AA purchases read as ladders instead of a flat list.'
      }
    ]
  },
  {
    version: '0.4.0',
    date: '2026-08-05',
    entries: [
      {
        text: 'The exaltation planner arrives, celebration cards appear over the game, healing joins the meters, and only kills credited to you celebrate.'
      }
    ]
  },
  {
    version: '0.3.5',
    date: '2026-08-04',
    entries: [
      {
        text: 'Maps gain a zone pane that says what lives there, Overview tiles link where you would click, and four rough edges around the timeline and Preferences are gone.'
      }
    ]
  },
  {
    version: '0.3.4',
    date: '2026-08-04',
    entries: [{ text: 'A stranger’s charmed pet no longer turns up in your damage meter.' }]
  },
  {
    version: '0.3.2',
    date: '2026-08-04',
    entries: [{ text: 'The app’s source code is public, under FSL-1.1-MIT.' }]
  },
  {
    version: '0.3.1',
    date: '2026-08-04',
    entries: [
      {
        text: 'Reading your log history no longer blocks the app, and the pet setting stops folding your pet permanently into your own row.'
      }
    ]
  },
  {
    version: '0.3.0',
    date: '2026-08-04',
    entries: [
      {
        text: 'Alerts learn to speak, a cursor ring finds your mouse over EverQuest, poison and slow alerts arrive, and you can send feedback from inside the app.'
      }
    ]
  },
  {
    version: '0.2.1',
    date: '2026-08-03',
    entries: [{ text: 'Copy on the combat meter puts the numbers on your clipboard again.' }]
  },
  {
    version: '0.2.0',
    date: '2026-08-03',
    entries: [
      {
        text: 'The first stable release: an Overview landing tab, the Maps tab, proc analytics, class-loadout inference and leveling range stats.'
      }
    ]
  }
]

// ---------------------------------------------------------------- versions

interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** The `-rc.1` half of a prerelease tag, or '' for a plain release. */
  readonly pre: string
}

/**
 * `v0.8.0` / `0.8.0` / `0.8.0-main.3` → its parts. Anything unparseable reads as 0.0.0, which
 * sorts below every real release — the safe direction: an unreadable stored value makes
 * everything look new rather than silently hiding a release.
 */
export function parseVersion(value: string): ParsedVersion {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim())
  if (!m) return { major: 0, minor: 0, patch: 0, pre: '' }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? '' }
}

/**
 * Semver ordering, enough of it: numeric triple first, then semver's own rule that a release
 * outranks its own prereleases (`0.8.0` > `0.8.0-main.3`). The prerelease tail itself is
 * compared as text, which is not the full spec — it is right for the only prerelease shapes this
 * repo has ever tagged (`-main.N`, `-sign.N`) and it is never the deciding factor for anything
 * the user sees, because every entry above is a plain release.
 */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (x.major !== y.major) return x.major < y.major ? -1 : 1
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1
  if (x.pre === y.pre) return 0
  if (x.pre === '') return 1
  if (y.pre === '') return -1
  return x.pre < y.pre ? -1 : 1
}

/** The newest release these notes describe — the value an install is stamped with once it has
 *  been shown them. See the header for why this, and not `app.getVersion()`. */
export function latestReleaseVersion(notes: readonly ReleaseNote[] = RELEASE_NOTES): string {
  return notes[0]?.version ?? '0.0.0'
}

/** Does `version` (a tag name is fine — the leading `v` and any prerelease tail are ignored)
 *  have an entry? The release job's gate; see scripts/check-release-notes.mjs. */
export function hasReleaseNote(
  version: string,
  notes: readonly ReleaseNote[] = RELEASE_NOTES
): boolean {
  const want = parseVersion(version)
  return notes.some((n) => {
    const got = parseVersion(n.version)
    return got.major === want.major && got.minor === want.minor && got.patch === want.patch
  })
}

// ---------------------------------------------------------------- the state

/** What the teaser strip and the What's new panel both render from. */
export interface WhatsNewState {
  /** No stored last-seen version: a fresh install, which has no news. */
  readonly fresh: boolean
  /** Every release newer than the stored last-seen version, NEWEST FIRST. Marked "new" in the
   *  panel — all of them, which is the A→D case: 0.6.3 → 0.8.0 marks 0.7.0 and 0.8.0. */
  readonly newVersions: readonly string[]
  /** The one version the teaser strip names, or null for no teaser. The NEWEST — one line
   *  saying where you landed, never a list of everything you missed. */
  readonly teaserVersion: string | null
}

/**
 * The whole derivation, and it is a pure function of two values so it can be unit-tested and
 * driven by hand (the DEV variant control writes the store key and nothing else).
 *
 * `lastSeen` is whatever the store held: a version string, or null/undefined/'' for absent.
 */
export function whatsNewState(
  lastSeen: string | null | undefined,
  notes: readonly ReleaseNote[] = RELEASE_NOTES
): WhatsNewState {
  if (typeof lastSeen !== 'string' || lastSeen.trim() === '') {
    return { fresh: true, newVersions: [], teaserVersion: null }
  }
  const newVersions = notes
    .filter((n) => compareVersions(n.version, lastSeen) > 0)
    .map((n) => n.version)
  return { fresh: false, newVersions, teaserVersion: newVersions[0] ?? null }
}

/**
 * The three states the DEV variant control can put an install into (JOS-73's hand-test brief).
 * Pure and derived from the notes themselves, so the buttons never name a version that has been
 * deleted from the list:
 *
 *   'fresh'    — no stored key at all. No teaser, nothing marked.
 *   'previous' — stamped at the release before the newest. One release of news.
 *   'several'  — stamped several back, which is the A→D case the marking exists for.
 *
 * The fourth variant, "reset to real", is not here: it restores the value this session STARTED
 * with, which is a fact about the running app and not about the data.
 */
export type WhatsNewVariant = 'fresh' | 'previous' | 'several'

/** How far back 'several' reaches. Five releases in, so the marking has to hold a list. */
const SEVERAL_BACK = 4

export function variantLastSeen(
  variant: WhatsNewVariant,
  notes: readonly ReleaseNote[] = RELEASE_NOTES
): string | null {
  if (variant === 'fresh' || notes.length === 0) return null
  const idx = variant === 'previous' ? 1 : SEVERAL_BACK
  return notes[Math.min(idx, notes.length - 1)]?.version ?? null
}

// ---------------------------------------------------------------- validity

const VERSION_RE = /^\d+\.\d+\.\d+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KINDS: readonly string[] = ['new', 'fixed', 'changed']

/**
 * Everything wrong with a notes list, as sentences — [] means it is sound.
 *
 * A function rather than a test body because it has TWO callers that must agree: the unit suite
 * (tests/releaseNotes.test.mts) and the release job's gate (scripts/check-release-notes.mjs).
 * A tag that ships is a tag whose notes passed the same check the suite runs.
 */
export function releaseNotesProblems(notes: readonly ReleaseNote[] = RELEASE_NOTES): string[] {
  const problems: string[] = []
  if (notes.length === 0) problems.push('the notes list is empty')
  notes.forEach((n, i) => {
    if (!VERSION_RE.test(n.version)) problems.push(`${n.version}: not a plain MAJOR.MINOR.PATCH version`)
    if (!DATE_RE.test(n.date)) problems.push(`${n.version}: date "${n.date}" is not YYYY-MM-DD`)
    if (n.entries.length === 0) problems.push(`${n.version}: no entries`)
    for (const e of n.entries) {
      if (e.text.trim() === '') problems.push(`${n.version}: an entry has no text`)
      if (e.kind !== undefined && !KINDS.includes(e.kind)) problems.push(`${n.version}: unknown kind "${e.kind}"`)
    }
    const prev = notes[i - 1]
    if (prev && compareVersions(prev.version, n.version) <= 0) {
      problems.push(`${n.version} must sort strictly below ${prev.version} — the list is newest first`)
    }
  })
  return problems
}
