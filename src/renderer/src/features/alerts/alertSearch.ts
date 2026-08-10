// alertSearch — FIND AN ALERT BY ANYTHING YOU REMEMBER ABOUT IT (JOS-178).
//
// WHAT THE USER GETS: one box above the alerts list. Type into it and the list narrows to the
// alerts that answer. What you can type is deliberately WIDE, because what a person remembers
// about an alert a month later is rarely its name — it is the spell it watches, or the line it
// speaks, or "the one that plays the Rickman sting". So the haystack is every facet the alert
// carries:
//
//   name            the display name, which is the only facet a narrow search would have had
//   trigger         the SAME badge the row prints (`triggerBadge`) — so the kind (`buffExpired`),
//                   the shape word (`event` / `raw` / `app` / `any` / `all`), the app signal, the
//                   raw pattern's own text, and every `where` key AND value, `spell` included
//   sound pack      the pack's id and its display name
//   sound           the sound's id and the pack's own label for it
//   speech          the custom phrase a speaking alert says
//   note            the freeform provenance note (seeded defaults and agent-authored defs carry
//                   one, and it is often the most memorable sentence about an alert)
//
// SEARCHING THE BADGE RATHER THAN RE-WALKING THE TRIGGER is the load-bearing choice here. The
// badge is what the row already shows, so "search what you see" is true by construction rather
// than by two functions agreeing today; and a composite trigger, a `where` matcher this module
// has never heard of, and any future primitive shape all arrive already spelled out. One string,
// one source.
//
// THE HOUSE TOKENIZER, NOT A SUBSTRING TEST. `shared/fuzzy.ts` is the scorer behind fight search,
// the Mobs tab and the map/zone pickers (JOS-9, JOS-135), and it is what makes "reckles" find
// Reckless Strength and "buff" find `buffExpired`. Every query token must match SOMETHING (the
// scorer's own exclusion rule), so two words narrow rather than widen.
//
// FILTER, NEVER RANK — AND THAT IS THE WHOLE REASON THIS MODULE RETURNS A SUBSET INSTEAD OF A
// SORTED LIST. The alerts list is in the user's OWN order (JOS-175/JOS-177): they dragged it into
// that shape and it persists. Re-sorting the visible rows by match score would quietly overwrite
// the one thing that list is about, and worse, it would make the filtered view a DIFFERENT list
// than the one the rows came out of — so a filtered list is the stored sequence with rows
// removed, and nothing else. (Reorder itself is off while a filter is live; a drop position in a
// list with holes in it names no gap in the stored order. That half lives in useAlertReorder.ts.)
//
// Pure + RELATIVE value imports (the mobSearch.ts precedent), so tests/alertSearch.test.mts drives
// it under tsx with no renderer at all.

import type { AlertDef, PackSound, SoundPack } from '@shared/types'
import { scoreQuery, tokenize } from '../../../../shared/fuzzy'
import { triggerBadge } from './conditionDraft'

/** Packs by id, so a list of alerts resolves its pack names without a scan per row. */
export type PackIndex = ReadonlyMap<string, SoundPack>

export function indexPacks(packs: readonly SoundPack[]): PackIndex {
  return new Map(packs.map((p) => [p.id, p]))
}

/**
 * The pack's own label for `soundId`, or ''.
 *
 * The widened type is not decoration: `SoundPack.sounds` is a `Record<string, PackSound>`, which
 * TypeScript reads as TOTAL, and an alert may well point at a sound the installed pack no longer
 * has (a pack updated under it, a share string from someone with a different library).
 */
function soundLabel(pack: SoundPack | undefined, soundId: string): string {
  if (pack === undefined) return ''
  const sounds: Record<string, PackSound | undefined> = pack.sounds
  return sounds[soundId]?.label ?? ''
}

/**
 * Every searchable facet of one alert, in the order the header lists them. Exported because the
 * tests assert facet by facet — "the phrase is searchable" is a claim about this list, and a
 * dropped facet should fail as a missing string rather than as a mysterious non-match.
 */
export function alertFacets(def: AlertDef, packs: PackIndex): string[] {
  const pack = packs.get(def.sound.packId)
  return [
    def.name,
    triggerBadge(def.trigger),
    def.sound.packId,
    pack === undefined ? '' : pack.name,
    def.sound.soundId,
    soundLabel(pack, def.sound.soundId),
    def.speech?.phrase ?? '',
    def.note ?? ''
  ].filter((s) => s !== '')
}

/** One alert's facets as lowercase tokens — computed once per list change, never per keystroke. */
export function alertHaystack(def: AlertDef, packs: PackIndex): string[] {
  return tokenize(alertFacets(def, packs).join(' '))
}

/** Does this alert answer an already-tokenized query? An empty query answers "yes, everything". */
export function matchesAlert(queryTokens: readonly string[], haystack: string[]): boolean {
  if (queryTokens.length === 0) return true
  return scoreQuery([...queryTokens], haystack) !== null
}

/**
 * The whole filter, for callers that have no reason to memoize the pieces (the tests, and any
 * future non-React reader). The renderer's hook splits it so the haystacks survive a keystroke.
 *
 * Returns the SAME array when the query says nothing, so "clearing the search restores the full
 * list" is identity rather than a rebuild.
 */
export function filterAlerts(
  alerts: readonly AlertDef[],
  packs: readonly SoundPack[],
  query: string
): readonly AlertDef[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return alerts
  const index = indexPacks(packs)
  return alerts.filter((def) => matchesAlert(tokens, alertHaystack(def, index)))
}
