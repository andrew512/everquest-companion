// wishlist/WishToggle.tsx — ONE CONTROL, BOTH SURFACES: add this thing to the wish list, click it
// again to take it off (JOS-343, owner ruling 2026-08-13).
//
// WHY THIS FILE EXISTS AT ALL. Until this ticket there were two controls that meant the same thing
// and agreed about none of it. The Exaltations donor row had a TEXT button reading "Add to wish
// list" that went DISABLED and read "Wished" once the item was on (JOS-326); the gear search row —
// added one day earlier — had a HEART that lit up and, lit, did nothing (JOS-335). The owner ruled
// the same day the heart shipped: the gear row gets the donor row's control, and BOTH of them
// toggle. Two components that must stay word-for-word identical is a rule nobody can enforce, so
// there is one component and the two surfaces differ by a prop.
//
// THE OVERRULED ARGUMENTS, NAMED, because both were written down as reasoning and both are now
// wrong — a revision that leaves its predecessor's case standing is how a file starts lying:
//
//   * "THE GEAR ROW MUST BE AN ICON" (JOS-335, GearTable.tsx `WishButton`). The case was width: a
//     `tableLayout: fixed` name column against a ~130px text button on 6,766 rows. OVERRULED for
//     parity — the two surfaces are one feature and must read as one. The width was real, so it is
//     handled honestly rather than denied: `compact` states a shorter pair of words for the dense
//     table, MEASURED in `tests/e2e/gearWishSteps.mts` against the column it shares, and the words
//     it drops are the ones the native `title` says in full anyway.
//   * "LIT IS A NO-OP" / "WISHED IS DISABLED". Both surfaces used to answer a second click with
//     nothing — the donor row by refusing it, the gear row by swallowing it. OVERRULED: a second
//     click REMOVES the wish, through `useWishlist.remove`, which is the same `removeWish` fold the
//     Wish list tab's own per-row remove calls. There is exactly one deletion shape in the app.
//
// THE TITLE STATES THE ACTION FOR THE STATE THE CONTROL IS IN, never the state itself. "Add to the
// wish list" when it is off, "Remove from the wish list" when it is on — a caption on a toggle is
// read as a prediction of the click, and one that reported status instead ("Already on your wish
// list") is what made the old heart's second click feel broken.
//
// NATIVE `title`, NEVER A POPPER (JOS-143). Both hosts are dense scrolling rows under a toolbar of
// dropdowns, and GearTable.tsx's header holds the full argument plus the one narrow exception the
// owner granted it (the hover compare card, which is not interactive and never opens upward).

import { type JSX } from 'react'
import { Button } from '@mui/material'

/**
 * The two sentences, in ONE place, so the parity the owner ruled for cannot drift apart again.
 * They are the whole explanation on either surface — no popper, no helper text, no chip carrying
 * half the meaning.
 */
export const WISH_ADD_TITLE = 'Add to the wish list, where it joins the route grouped by where it drops.'
export const WISH_REMOVE_TITLE = 'Remove from the wish list. It comes off the route with it.'

/**
 * The words on the button. FULL is the browse row's, which has the space; COMPACT is the gear
 * table's, which does not (see the width note in the header and the measurement in the e2e step).
 *
 * COMPACT KEEPS THE NOUN AND DROPS THE PREPOSITIONS. A bare "Add" was rejected: on a table of
 * 6,766 candidate items it does not say add to WHAT, and the point of the ruling is that a reader
 * recognises this as the control the Exaltations tab has. "Wish" is the noun that list is named
 * for, so the word survives the cut; the `title` says the sentence in full either way.
 */
const LABEL = {
  full: { add: 'Add to wish list', remove: 'Remove from wish list' },
  compact: { add: 'Wish', remove: 'Remove' }
} as const

export interface WishToggleProps {
  /** the item's name — the accessible label says which row this control belongs to */
  name: string
  /** already on the wish list; the control reads its added state, and a click REMOVES */
  wished: boolean
  /** the dense-table wording (see `LABEL`) */
  compact?: boolean
  /**
   * The control cannot act at all — the Exaltations donor with no equipment slot, which can never
   * donate (R2) and is chipped `no slot` beside this button saying so. NOT used for "already
   * wished": that state is now the REMOVE half of a toggle, not a dead end.
   */
  disabled?: boolean
  /** `gear-wish` on the search row, `planner-add` on the donor row — both predate this file */
  testId: string
  /** add when off, remove when on. The host owns which door; this control owns the reading. */
  onToggle: () => void
}

/**
 * ADD / REMOVE, in the state it is in. `data-wished` is the machine-readable half of the same
 * statement the words make, and both e2e steps read it rather than the label — the wording is a
 * product decision and a spec pinned to it would fail on the next one.
 */
export default function WishToggle({
  name,
  wished,
  compact = false,
  disabled = false,
  testId,
  onToggle
}: WishToggleProps): JSX.Element {
  const words = LABEL[compact ? 'compact' : 'full']
  return (
    <Button
      size="small"
      data-testid={testId}
      data-wished={wished ? 'true' : undefined}
      color={wished ? 'success' : 'primary'}
      disabled={disabled}
      aria-label={wished ? `Remove ${name} from your wish list` : `Add ${name} to your wish list`}
      title={wished ? WISH_REMOVE_TITLE : WISH_ADD_TITLE}
      onClick={onToggle}
      // `minWidth` is stated so the button does not RESIZE when it is clicked: both surfaces sit in
      // a `nowrap` row where a control that grew mid-click would shove the text beside it. The two
      // numbers are the wider label of each pair, measured in the browser (gearWishSteps.mts).
      sx={{ flexShrink: 0, minWidth: compact ? 72 : 168, px: compact ? 0.5 : undefined }}
    >
      {wished ? words.remove : words.add}
    </Button>
  )
}
