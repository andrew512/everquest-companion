// THE PER-BOSS DIFFICULTY LADDER (JOS-152) — five rungs on a THIS WEEK card, one per instance
// difficulty, grey while the week still has it and green once a credited kill has taken it.
//
// The derivation is `tierLadder` (lockout.ts), which also carries the whole argument for what the
// log can and cannot state about a difficulty. This file is the drawing, and it makes exactly
// three decisions of its own:
//
// 1. ONE GREEN, NOT THE TIER PALETTE. Every other tier surface in the app paints d0..d4 in their
//    own colours (lib/tierChip.ts), and reusing them here would be actively wrong: D0's swatch
//    IS grey, so a cleared base difficulty would render as the open state. A rung's identity is
//    its position and its label; its colour is a yes/no. The reporter asked for exactly that
//    ("1 2 3 4 5 in gray, green when defeated this week") and the palette collision makes it the
//    only readable option, so the labels still come from `tierStyle` and nothing else does.
//
// 2. THE BASE RUNG IS DRAWN DIFFERENTLY WHEN CLEARED — an outline rather than a fill. d1..d4 are
//    each named by an adjective the game printed on the zone line; d0 is the ABSENCE of one, and
//    an open-world kill (which carries no lockout at all) reads identically. `LadderRung.stated`
//    is that fact travelling out of the derivation, and honouring it costs one border. Painting
//    five identical rungs would be the app claiming a lockout it cannot see.
//
// 3. NATIVE `title`, NEVER A POPPER. These rungs sit in a scrolling grid directly beneath the
//    view's toolbar, which is the geometry that produced JOS-127 and JOS-143: a `placement="top"`
//    card anchored here opens up across the controls the user was aiming at. An OS tooltip is not
//    in the DOM and has no hit area, so it cannot eat a click. The SENTENCE it shows lives in
//    lockout.ts (`rungTitle`) rather than here, so the base rung's caveat is reachable from a
//    node test instead of stranded behind an MUI import.

import type { JSX } from 'react'
import { Box, Stack } from '@mui/material'
import { rungTitle, type LadderRung } from './lockout'
import { tierStyle } from '../../lib/tierChip'

function Rung({ rung, size }: { rung: LadderRung; size: number }): JSX.Element {
  const label = tierStyle(rung.tier).label
  const filled = rung.cleared && rung.stated
  return (
    <Box
      data-testid={`boss-rung-d${String(rung.tier)}`}
      data-cleared={rung.cleared ? '1' : '0'}
      title={rungTitle(rung)}
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        height: size,
        lineHeight: `${String(size - 2)}px`,
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: rung.cleared ? 'success.main' : 'divider',
        bgcolor: filled ? 'success.main' : 'transparent',
        color: filled ? 'background.default' : rung.cleared ? 'success.main' : 'text.disabled',
        fontWeight: 700,
        fontSize: size > 15 ? 10 : 9,
        textAlign: 'center',
        letterSpacing: '-0.02em',
        userSelect: 'none'
      }}
    >
      {label}
    </Box>
  )
}

/**
 * The ladder. `compact` is the card density the roster is already drawing at, so the rungs shrink
 * with everything else rather than forcing the compact card wider.
 */
export default function DifficultyLadder({
  rungs,
  compact
}: {
  rungs: LadderRung[]
  compact: boolean
}): JSX.Element {
  return (
    <Stack
      data-testid="boss-difficulty-ladder"
      direction="row"
      spacing={0.25}
      sx={{ mt: 0.25, mb: 0.25 }}
    >
      {rungs.map((rung) => (
        <Rung key={rung.tier} rung={rung} size={compact ? 14 : 18} />
      ))}
    </Stack>
  )
}
