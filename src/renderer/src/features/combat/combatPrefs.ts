// COMBAT VIEW PREFERENCES — the VOCABULARY, with no DOM and no React in it.
//
// `useCombatPrefs.ts` is the storage half (localStorage + the cross-window subscription); this is
// the half that decides what a stored string MEANS. Splitting them is what makes the rules below
// testable at all: a default, a guard and a degrade are exactly the things that break silently,
// and `tests/combatPrefs.test.mts` runs every one of them under plain node with no window object
// anywhere.
//
// MUI-FREE, JSX-FREE, REACT-FREE, and its value imports are RELATIVE — the meterScope.ts /
// useGlobalFight.ts rule, for the same two reasons: the overlay is a second renderer entry that
// reads these same keys, and the node tests resolve no `@shared/*` alias for values.
//
// THE ONE RULE BOTH HALVES SHARE: an absent or unreadable value is the DEFAULT, never an error and
// never an empty surface. Every reader here takes `string | null` (what `localStorage.getItem`
// actually returns) and answers with something a meter can render.

import { isMeterScope } from '../../../../shared/roster'
import type { MeterScope } from '@shared/roster'

// ── whose damage (JOS-115) ───────────────────────────────────────────────────────────────

/**
 * ONE KEY FOR EVERY COMBAT SURFACE. It used to take a per-surface suffix
 * (`eq.combat.meterScope.combat`, `.overlay.fight`, …) written by a chip on each surface; JOS-115
 * retired the chips and the suffix with them. The old keys are left INERT rather than migrated —
 * three stale answers give no honest way to pick the "real" one, and this is a preference a user
 * restates in one click.
 */
export const METER_SCOPE_KEY = 'eq.combat.meterScope'

/**
 * DEFAULT GROUP, for a fresh install and for an absent key alike (owner, JOS-115).
 *
 * Safe by construction: with no roster, Group resolves to Everyone and the surfaces label
 * themselves `Group (no roster yet)` (shared/roster.ts effectiveScope / chipLabel), so a solo
 * player sees what they always saw and a grouped player sees their group without hunting for a
 * control.
 */
export const DEFAULT_METER_SCOPE: MeterScope = 'group'

/** The stored scope, or the default — for absent, empty, misspelled or hand-edited values alike. */
export function readMeterScope(raw: string | null): MeterScope {
  return isMeterScope(raw) ? raw : DEFAULT_METER_SCOPE
}
