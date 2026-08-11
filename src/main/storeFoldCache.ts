// storeFoldCache.ts — the persisted CHECKPOINT SWITCH, main-process side (JOS-208).
//
// The settings-accessor half of the fold cache's feature flag, split out of `store.ts` for the
// reason `storeRespawn.ts` gives: that file is AT the repo's 400-code-line factoring ceiling and
// the house answer is a split, not a widened threshold.
//
// NO SCHEMA BUMP. The key is additive and optional, and an absent one reads as the shipped default
// — OFF, because the rollout says off until the owner has run it by hand and the fleet's
// divergence count has stayed at zero. So a store written by an older build loads here unchanged,
// and one written here still opens in a build that predates the feature. The `respawn` /
// `lastSeenNotesVersion` precedent, stated in storeShape.ts.

import { settingsStore } from './store'

/** The stored object, as an object. Two fields live under this key now, so both readers share one
 *  shape check and both writers MERGE — a `set` that replaced the object would silently drop the
 *  other field, which is the classic way two settings under one key eat each other. */
function raw(): { enabled?: unknown; shadowLastMs?: unknown } {
  const value: unknown = settingsStore.get('foldCache')
  return typeof value === 'object' && value !== null ? value : {}
}

/** The stored preference, or undefined when nobody has ever set it. Never throws. */
export function getFoldCacheEnabled(): boolean | undefined {
  const v = raw().enabled
  return typeof v === 'boolean' ? v : undefined
}

/** Store the preference; returns what was stored. Validated here — the renderer may supply it. */
export function setFoldCacheEnabled(next: unknown): boolean {
  const clean = next === true
  settingsStore.set('foldCache', { ...raw(), enabled: clean })
  return clean
}

/**
 * WHEN THE SHADOW VERIFIER LAST RAN (JOS-208 phase 3), or 0 when it never has.
 *
 * Persisted rather than held in memory because its whole job is to space runs across LAUNCHES — the
 * design's "sample, do not always-verify", which exists so the verification's own cold read never
 * lands on top of the cold read it is measuring the absence of.
 */
export function getFoldShadowLastMs(): number {
  const v = raw().shadowLastMs
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

export function setFoldShadowLastMs(atMs: number): void {
  settingsStore.set('foldCache', { ...raw(), shadowLastMs: Math.max(0, Math.round(atMs)) })
}
