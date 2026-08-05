// The Leveling tab's four headline numbers — level, AA earned, AA spent, AA unspent.
//
// Split out of LevelingView (which sits at the measured 400-code-line ceiling) the day the tab
// gained the "New at this level" panel. Pure presentation: every number is computed in the view
// and every caption states the honesty the analytics owe — CURRENT level is the LATEST reported
// one, never max(), because a loadout swap re-reports the level of the new (lowest) class, so the
// peak belongs to a class that may no longer be in the loadout and rides the caption instead.

import { type JSX } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BoltIcon from '@mui/icons-material/Bolt'

function HeroCard({
  icon,
  value,
  label,
  sub,
  accent
}: {
  icon: JSX.Element
  value: string
  label: string
  sub?: string
  accent: string
}): JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, flex: 1, minWidth: 160, borderLeft: `3px solid ${accent}`, display: 'flex', gap: 1.5 }}
    >
      <Box sx={{ color: accent, display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Box>
        <Typography variant="h4" sx={{ lineHeight: 1, color: accent }}>
          {value}
        </Typography>
        <Typography variant="body2">{label}</Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
    </Paper>
  )
}

export interface LevelingHeroesProps {
  currentLevel: number | null
  levelCount: number
  peak: number | null
  swaps: number
  aaEarned: number
  aaSpent: number
  aaUnspent: number | null
  boughtCount: number
}

export function LevelingHeroes({
  currentLevel,
  levelCount,
  peak,
  swaps,
  aaEarned,
  aaSpent,
  aaUnspent,
  boughtCount
}: LevelingHeroesProps): JSX.Element {
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <HeroCard
        icon={<MilitaryTechIcon fontSize="large" />}
        value={currentLevel != null ? String(currentLevel) : '—'}
        label="Character level"
        sub={
          levelCount
            ? `${levelCount} level-ups logged` +
              (swaps > 0 ? ` · peak ${peak} · ${swaps} class swap${swaps === 1 ? '' : 's'}` : '')
            : 'no level-ups in log'
        }
        accent="#d9b25f"
      />
      <HeroCard
        icon={<AutoAwesomeIcon fontSize="large" />}
        value={aaEarned ? aaEarned.toLocaleString() : '—'}
        label="AA points earned"
        sub="spent + unspent"
        accent="#6fb3d2"
      />
      <HeroCard
        icon={<AutoAwesomeIcon fontSize="large" />}
        value={aaSpent ? aaSpent.toLocaleString() : '—'}
        label="AA points spent"
        sub={`${boughtCount} abilities allocated`}
        accent="#b07fd0"
      />
      <HeroCard
        icon={<BoltIcon fontSize="large" />}
        value={aaUnspent != null ? aaUnspent.toLocaleString() : '—'}
        label="AA unspent"
        sub="last reported balance"
        accent="#5fbf72"
      />
    </Stack>
  )
}
