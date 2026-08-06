// lib/outputFreshness.ts — the words on the right-hand end of an `/outputfile` line (JOS-44).
//
// `OutputFileLine` renders three states in ONE slot, and this is the whole rule for which:
//
//   never run  — no file exists, so there is no age to claim and we say that in words.
//   fresh      — "updated just now" / "updated 12m ago".
//   stale      — "updated 3d ago", which is the SAME rendering. There is deliberately no
//                staleness threshold: EverQuest does not define one (a dump is stale the moment
//                you swap an item and fine for a week if you do not), so inventing "⚠ stale after
//                6h" would be the app asserting a game fact nobody measured. The number is the
//                warning, and it is coarse on purpose.
//
// Pure and React-free so the three states are pinned by `tests/outputsFreshness.test.mts` without
// a DOM, and so the component stays a layout.

import { formatAge } from './formatDate'

/** ISO → epoch millis, or undefined when the string is absent or unparseable (never `0`). */
export function outputUpdatedMillis(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const t = Date.parse(iso)
  return Number.isNaN(t) ? undefined : t
}

/** The age slot's text for a dump last written at `at` (epoch millis), or never. */
export function outputAgeLabel(at: number | undefined, now: number = Date.now()): string {
  if (at === undefined) return 'not yet run'
  return `updated ${formatAge(at, now)}`
}
