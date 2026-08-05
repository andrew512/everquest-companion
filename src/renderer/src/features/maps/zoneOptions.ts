// The two spellings a map stem answers to, and the filter the zone selector runs over them.
//
// SEPARATE FROM THE CONTROL because it is the only part of zone selection that can be tested
// without a DOM: a stem's display name and whether a query reaches it are string facts. The
// component beside it (MapZoneSelect.tsx) is then a rendering of these three functions and
// nothing else.
//
// A STEM THE TABLE DOES NOT CARRY IS SHOWN RAW. `src/shared/zones.ts` is hand-authored — there is
// no algorithm from `airplane` to `The Plane of Sky` — so a pack that provides a stem the table
// has never heard of is offered under its own name rather than a guessed prettification
// (world-model law 1). It is still selectable, and its map still draws.
//
// RELATIVE value import, the repo-wide rule for node-tested pure modules (mobPins.ts:38).

import type { ZoneShort } from '@shared/maps'
import { ZONES } from '../../../../shared/zones'

/**
 * Cap on offered rows.
 *
 * The installed corpus is ~600 stems (measured: 580 in the shipped Brewall pack, 133 in the
 * game's own set) and MUI renders every option in an open popup, so an unfiltered list is a
 * rendering cost with no reader on the far end. Typing is how you reach row 201.
 */
export const ZONE_OPTIONS_MAX = 200

/** Stem -> the long name the zone table knows it by. Built once; the table is ~130 rows. */
const NAMES = new Map<ZoneShort, string>(ZONES.map((z) => [z.short, z.name]))

/**
 * What to call a map stem in the UI.
 *
 * The stem is the truth on disk (`airplane`) and the long name is what the player calls it
 * (`The Plane of Sky`), so both are shown wherever there is room.
 */
export function zoneLabel(short: ZoneShort): string {
  return NAMES.get(short) ?? short
}

/** Either spelling matches. `q` is already trimmed and lowercased; stems are lowercase on disk. */
export function zoneMatches(short: ZoneShort, q: string): boolean {
  return short.includes(q) || zoneLabel(short).toLowerCase().includes(q)
}

/** The offered rows for a query: every stem when it is empty, matches otherwise, capped. */
export function filterZones(
  zones: readonly ZoneShort[],
  query: string,
  limit = ZONE_OPTIONS_MAX
): ZoneShort[] {
  const q = query.trim().toLowerCase()
  const hits = q.length === 0 ? zones : zones.filter((z) => zoneMatches(z, q))
  return hits.slice(0, limit)
}

/**
 * The options list, guaranteed to contain the current selection.
 *
 * A remembered stem (`eq.maps.zone`) can outlive the pack that provided it, and a value MUI
 * cannot find among its options renders as an empty box — which reads as "no zone is open" while
 * a map is plainly on screen. The stem stays offered instead, under its own name.
 */
export function zoneOptions(zones: readonly ZoneShort[], zone: ZoneShort | null): ZoneShort[] {
  if (zone == null || zones.includes(zone)) return [...zones]
  return [zone, ...zones]
}
