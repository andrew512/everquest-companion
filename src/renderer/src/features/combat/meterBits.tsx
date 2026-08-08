// Two presentational atoms that outgrew `combatShared.tsx`.
//
// That file is the meter's primitives module and sits at the measured line ceiling — the rule
// there is to SPLIT rather than ratchet a threshold (the CopyButton precedent, same header). Both
// of these are now read from outside it as well as inside it, so they live here:
//
//   StatItem  — one labeled figure in a readout (the per-ability expansion, the category drill's
//               stat strip).
//   MoreRows  — the honest tail when a GLANCE cap is truncating a list. Shared because all three
//               levels of the Overview card cap at the same five rows and must say so identically
//               (JOS-105).

import { Box, Typography } from '@mui/material'

/** One labeled figure in a readout: a small uppercase caption over the value. */
export function StatItem({ label, value, color }: { label: string; value: string; color?: string }): React.JSX.Element {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        noWrap
        sx={{
          display: 'block',
          fontSize: 9,
          lineHeight: 1.4,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'text.disabled'
        }}
      >
        {label}
      </Typography>
      <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600, color: color ?? 'text.primary' }}>
        {value}
      </Typography>
    </Box>
  )
}

/**
 * `+3 more` — what a capped list says about the rows it is not showing, and (when the surface
 * offers one) the way to the full list. A cap that stays silent is the one thing a glance card
 * may not do.
 */
export function MoreRows({ n, onMore }: { n: number; onMore?: () => void }): React.JSX.Element {
  return (
    <Typography
      variant="caption"
      color="text.disabled"
      data-testid="meter-more"
      onClick={onMore}
      sx={onMore ? { cursor: 'pointer', '&:hover': { color: 'text.secondary' } } : undefined}
    >
      +{n} more
    </Typography>
  )
}
