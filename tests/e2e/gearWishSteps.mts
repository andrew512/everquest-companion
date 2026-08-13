/**
 * THE GEAR TAB'S WISH GESTURE (JOS-335) — a search row goes on the wish list, exactly as an
 * Exaltations donor row has since JOS-326.
 *
 * A MODULE RATHER THAN MORE OF `gear.e2e.mts`, the `gearColumnSteps.mts` / `gearFilterSteps.mts`
 * precedent: everything this needs is already standing in the host spec, and that file sits at the
 * repo's 400-code-line factoring ceiling.
 *
 * WHAT NEEDS A REAL APP HERE, given `tests/wishlist.test.mts` owns every fold and
 * `tests/wishSearch.test.mts` owns `wishFromGear` without a DOM: the CHAIN, and nothing else. A
 * click on a windowed table row → `useWishlist.add` → the pure `addWish` → an IPC write → main's
 * validator → electron-store → a SECOND VIEW, on a sibling tab, that unmounted the first one and
 * re-read the document from disk to draw its route. Four of those five links are invisible to a
 * unit test, and the fifth — the dedupe — is only interesting once the document is real: "clicking
 * twice writes one row" is a claim about what came back off the store, not about a fold.
 *
 * THE ROW IS CHOSEN OFF THE SCREEN, NEVER TYPED IN (AGENTS.md, "frozen numbers rot" — and a frozen
 * ITEM NAME rots the same way when the corpus is rescraped). Two properties are wanted and both are
 * read from the table itself:
 *
 *   * IN ERA, so the wish lands in the ROUTE rather than behind the wish list's own era filter.
 *     Guaranteed by WHERE this step runs — before `stepEra` turns the toggle off — so every row on
 *     screen is one the app's own `eraHides` admits, which is the same predicate the wish list uses.
 *   * NEITHER OWNED NOR LOOTED, so the wish is still WANTED. `wishFulfilled` sends a gear wish whose
 *     progress join reports a copy straight to the done strip, which is correct behaviour and the
 *     wrong half of the tab to be asserting a route entry in. An EMPTY Owned cell is the table's own
 *     statement that neither witness has seen the item, so the pick reads it and moves on.
 *
 * THE LIT STATE IS ASSERTED IN BOTH DIRECTIONS, which is the half a "does the add work" spec would
 * skip: it comes ON at the click, and — after the wish is removed on the OTHER tab — it is OFF when
 * this tab is walked back into. A control that could only ever light up would pass a build where
 * the join is a one-way latch.
 */
import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'

const ROW = '[data-testid="gear-row"]'
const OWNED_HEADER = '[data-testid="gear-owned-header"]'
const GEAR_VIEW = '[data-testid="gear-view"]'
const GEAR_TAB = '[data-testid="tab-gear"]'
const WISH_TAB = '[data-testid="tab-wishlist"]'
const WISH_VIEW = '[data-testid="wishlist-view"]'

/** The heart on one row, and the same heart once it is lit. `row.key` is the corpus join key. */
const wishOf = (key: string): string => `${ROW}[data-item-key="${key}"] [data-testid="gear-wish"]`
const litOf = (key: string): string => `${wishOf(key)}[data-wished="true"]`
/** The wish, on the OTHER tab, inside a route group — never merely somewhere on the page. */
const groupRowOf = (key: string): string =>
  `[data-testid="wishlist-group"] [data-testid="wishlist-row"][data-item="${key}"]`
const removeOf = (key: string): string =>
  `[data-testid="wishlist-row"][data-item="${key}"] [data-testid="wishlist-remove"]`

const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

interface Pick {
  key: string
  name: string
}

/**
 * The first mounted row the ownership join says nothing about — see the header for why that is the
 * property this step needs. `null` when every row on screen is owned or looted, which on the
 * committed corpus means something has gone wrong with the filters rather than with this step.
 */
function pickUnowned(page: Page): Promise<Pick | null> {
  return page.evaluate((sel) => {
    for (const row of document.querySelectorAll(sel)) {
      const owned = row.querySelector('[data-testid="gear-cell-owned"]')
      if (owned !== null && (owned as HTMLElement).innerText.trim() !== '') continue
      const key = row.getAttribute('data-item-key')
      const cell = row.querySelector('td')
      if (key === null || cell === null) continue
      return { key, name: (cell as HTMLElement).innerText.split('\n')[0].trim() }
    }
    return null
  }, ROW)
}

/**
 * ADD FROM A SEARCH ROW → THE ROUTE → REMOVE → THE ROW GOES DARK.
 *
 * Runs on a table narrowed by NOTHING: the class picker has just been cleared by
 * `stepGearClassFilter`, the era toggle is still at its default ON, and the search box is empty.
 * It hands the tab back in exactly that state — the trip to the Wish list tab and back remounts the
 * view, and JOS-329's area memory is what makes the return a no-op rather than a reset.
 */
export async function stepGearWish(page: Page): Promise<void> {
  // The Owned column is the instrument the pick reads, so wait for the join rather than racing it.
  // It is a staged dump on disk at launch (the host spec's `/outputfile` carve-out), so it arrives.
  if (!check('the gear table has its ownership column before the wish step reads it', await until(async () => (await countOf(page, OWNED_HEADER)) > 0, 30_000))) {
    return
  }
  const pick = await pickUnowned(page)
  check('an in-era row that neither the dump nor the log has seen is on screen to want', pick !== null)
  if (pick === null) return
  const { key, name } = pick
  note(`wishing "${name}" (${key})`)

  // 1. THE CONTROL EXISTS AT ALL — the parity this ticket is: the donor rows have had one since
  //    JOS-326 and the 6,766 rows of the corpus had none.
  const present = await until(async () => (await countOf(page, wishOf(key))) === 1, 20_000)
  if (!check('every gear search row carries an add-to-wish-list control', present)) return
  check('…and it starts dark, because nothing is wished yet', (await countOf(page, litOf(key))) === 0)

  // 2. ONE CLICK, NO DIALOG. The lit state is the whole acknowledgement.
  await page.click(wishOf(key), { timeout: 15_000 })
  check('clicking it lights the row up on the spot', await until(async () => (await countOf(page, litOf(key))) === 1, 15_000))

  // 3. …AND CLICKING IT AGAIN IS NOTHING. Proven on the other tab, where a second entry would show:
  //    the model dedupes by `itemKey`, so the store cannot be holding two.
  await page.click(wishOf(key), { timeout: 15_000 })
  check('a second click leaves it lit rather than toggling the wish away', (await countOf(page, litOf(key))) === 1)

  // 4. THE OTHER TAB. A sibling of this one, so the trip is a click — and it unmounts this view,
  //    which is what makes the row it draws a fact about the STORE rather than about React state.
  await page.click(WISH_TAB, { timeout: 15_000 })
  if (!check('the Wish list tab mounts', await until(async () => (await countOf(page, WISH_VIEW)) > 0, 30_000))) return
  const routed = await until(async () => (await countOf(page, groupRowOf(key))) === 1, 20_000)
  check(
    'the wish written from a gear row arrives in the wish list`s zone groups',
    routed,
    `${String(await countOf(page, groupRowOf(key)))} route rows for ${key}`
  )
  check('…exactly once, whatever the second click did', (await countOf(page, `[data-testid="wishlist-row"][data-item="${key}"]`)) === 1)

  // 5. REMOVE IT HERE, and the lit state on the OTHER tab has to follow.
  if (routed) {
    await page.click(removeOf(key), { timeout: 15_000 })
    check('removing it from the wish list takes the row off the route', await until(async () => (await countOf(page, removeOf(key))) === 0, 15_000))
  }

  await page.click(GEAR_TAB, { timeout: 15_000 })
  if (!check('the Gear tab comes back', await until(async () => (await countOf(page, GEAR_VIEW)) > 0, 30_000))) return
  const back = await until(async () => (await countOf(page, wishOf(key))) === 1, 20_000)
  check('…with the row it was left on', back, `looking for ${key}`)
  check(
    'and the control is dark again, because the wish it was reporting is gone',
    back && (await countOf(page, litOf(key))) === 0
  )
}
