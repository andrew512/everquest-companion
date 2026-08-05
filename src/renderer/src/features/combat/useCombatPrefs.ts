// Renderer-local COMBAT view preferences — the same idiom as `eq.combat.scope` in useCombat.ts
// (localStorage, renderer-side, no store/IPC round trip), with one addition it needs and that
// one didn't: these prefs are read by surfaces that never share a mount.
//
// The Preferences tab writes them; the Combat tab, the Overview card AND the floating overlay
// meters read them. App.tsx's `ViewContent` mounts exactly ONE feature view at a time, so a plain
// `useState` initialised from localStorage would already be correct on the next mount — but a
// same-document `localStorage.setItem` fires no 'storage' event, so anything that IS mounted
// alongside the writer (a preference and its own live example, today or tomorrow) would go
// stale. The tiny subscription below closes that: one write notifies every reader in this
// window, so "changing it applies live" is structural instead of incidental.
//
// AND ACROSS WINDOWS, WHICH IS WHY THE OVERLAY MAY READ IT (measured, 2026-08-04). The overlay is
// a second renderer entry in a second BrowserWindow, so the in-window `listeners` set below can
// never reach it. It doesn't have to: every window of this app is ONE ORIGIN, so localStorage is
// literally the same store and the cross-document 'storage' event does the notifying. Verified in
// this Electron rather than assumed, on the case that could plausibly have differed — two
// `file://` documents (the packaged app's `index.html` and `overlay.html`, loaded by path, no
// dev server): both report `location.origin === 'file://'`, a write in one is readable in the
// other, and the other receives a `storage` event carrying the new value. So the overlay reads
// the SAME key by the SAME hook, and no copy of this preference is ever routed over IPC.

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Nest the pet as ONE line item inside your damage breakdown (drillable to the pet's own
 * skills) instead of listing it as a separate source. Default ON: the game is mostly played
 * solo, so "you and your pet" is the shape of nearly every fight (owner direction, 2026-08-03).
 *
 * It is also the DEFAULT ZOOM (owner direction, 2026-08-04): on ⇒ the dashboard opens on your
 * breakdown with the pet nested in it, off ⇒ it opens fully zoomed out on the source list. One
 * choice, one key — `petRows.defaultDrill` is the rule, and `eq.combat.drill` (a second bit
 * that used to decide the opening level on its own, and that plain navigation rewrote) is
 * RETIRED. Nothing reads that key any more; a stale one in localStorage is inert.
 */
export const COMBINE_PET_ROW_KEY = 'eq.combat.petRow'

const listeners = new Set<() => void>()

function notifyAll(): void {
  for (const l of [...listeners]) l()
}

/**
 * One 'storage' listener for the whole module, attached while anything is subscribed. That event
 * fires ONLY for writes made in ANOTHER document of this origin (the spec excludes the writer),
 * which is exactly the cross-window half: Preferences flips the switch in the main window and the
 * floating overlay re-renders without a poll, a patch or an IPC channel of its own.
 */
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) window.addEventListener('storage', notifyAll)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('storage', notifyAll)
  }
}

/** '1'/'0' rather than JSON: these are one-bit view prefs and the value should be readable in
 *  devtools at a glance. An absent key is the DEFAULT, never `false` — a user who has never
 *  touched the setting has not turned it off. */
function read(key: string, dflt: boolean): boolean {
  const v = localStorage.getItem(key)
  return v === null ? dflt : v === '1'
}

function write(key: string, v: boolean): void {
  localStorage.setItem(key, v ? '1' : '0')
  // The writing document gets no 'storage' event of its own, so notify it directly. Other
  // windows are served by the listener above — hence exactly one notification each, never two.
  notifyAll()
}

/** One persisted boolean view pref, live across every mounted reader in this window. */
export function useBoolPref(key: string, dflt: boolean): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, dflt),
    () => dflt
  )
  const set = useCallback((v: boolean) => write(key, v), [key])
  return [value, set]
}

/** See COMBINE_PET_ROW_KEY. Read by the Combat dashboard, the Overview DPS card AND the floating
 *  overlay meters — all of them take their layout and their opening level from it, and only the
 *  Preferences tab ever writes it. */
export function useCombinePetRow(): [boolean, (v: boolean) => void] {
  return useBoolPref(COMBINE_PET_ROW_KEY, true)
}
