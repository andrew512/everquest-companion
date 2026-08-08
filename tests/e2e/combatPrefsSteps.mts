// DRIVING THE COMBAT PREFERENCES FROM THE REAL UI (JOS-115).
//
// The You / Group / Everyone scope used to be a chip on every combat surface; it is now ONE
// preference in Preferences > Combat, read by the Combat tab, the Overview card and every floating
// overlay. That makes "set it" a two-window act rather than a click on the surface under test, so
// the door is here and every spec that needs it walks through the same one.
//
// IT CLICKS THE ACTUAL CONTROL, never `localStorage.setItem`. The write path is half the claim —
// a preference that persists but does not APPLY is the defect this ticket exists to avoid — and
// the cross-window half (the overlay hearing about it through the DOM's own 'storage' event, no
// IPC involved) can only be exercised by a real write from the main window's document.
//
// Its own module because combatSteps.mts and every e2e spec that would otherwise host it sit at
// or near the repo's max-lines budget: split, never ratchet (drill.mts set the precedent).

import type { Page } from 'playwright-core'
import { settle } from './appHarness.mjs'

/** The three scopes, exactly as `shared/roster.METER_SCOPES` spells them. */
export type Scope = 'you' | 'group' | 'everyone'

/** The Combat tab's read-only scope readout — a WORD, not a control, since JOS-115. */
export const SCOPE_LABEL_SEL = '[data-testid="meter-scope-label"]'
/** The control JOS-115 deleted from every combat surface. Asserted ABSENT, never used. */
export const RETIRED_SCOPE_CHIP = '[data-testid="meter-scope-chip"]'
/** …and its overlay twin. */
export const RETIRED_OVERLAY_CHIP = '[data-testid="overlay-scope-chip"]'
/** The overlay header's read-only twin of SCOPE_LABEL_SEL. */
export const OVERLAY_SCOPE_LABEL = '[data-testid="overlay-scope-label"]'

/**
 * Set the meter scope through Preferences > Combat and return the app to `back`.
 *
 * `back` is a nav testid rather than "wherever we were": a caller always knows which surface it
 * is about to assert on, and guessing would leave the app somewhere the next step did not expect.
 */
export async function setMeterScope(page: Page, scope: Scope, back: string): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 30_000 })
  await page.waitForSelector('[data-testid="prefs-rail-combat"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-combat"]')
  const button = `[data-testid="pref-meter-scope-${scope}"]`
  await page.waitForSelector(button, { timeout: 20_000 })
  await page.click(button)
  // The CONDITION the click produces: MUI marks the chosen ToggleButton selected, and that is the
  // control agreeing it took the value — never a sleep.
  await settle(
    async () => (await page.$$(`${button}.Mui-selected`)).length,
    (n) => n === 1,
    { timeoutMs: 8_000 }
  )
  await page.click(`[data-testid="${back}"]`, { timeout: 30_000 })
}

/**
 * Which scope Preferences shows as CHOSEN, read from the control itself and not from the store,
 * then back to `back`. On a fresh profile this is the answer to "does an absent key resolve to
 * Group" — the half of the default that the meters' own wording cannot distinguish, because
 * `Group (no roster yet)` is what You would never say but Everyone's fallback shares no text with.
 */
export async function scopeFromPrefs(page: Page, back: string): Promise<string> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 30_000 })
  await page.waitForSelector('[data-testid="prefs-rail-combat"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-combat"]')
  await page.waitForSelector('[data-testid="pref-meter-scope"]', { timeout: 20_000 })
  const chosen = await settle(
    () =>
      page.evaluate(() => {
        const on = document.querySelector('[data-testid="pref-meter-scope"] .Mui-selected')
        return on?.getAttribute('data-testid')?.replace('pref-meter-scope-', '') ?? ''
      }),
    (v) => v !== '',
    { timeoutMs: 8_000 }
  )
  await page.click(`[data-testid="${back}"]`, { timeout: 30_000 })
  return chosen
}
