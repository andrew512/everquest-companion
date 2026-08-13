// ZoneScopeBar — WHICH TIERS OF THIS ZONE THE NUMBERS ARE ABOUT (JOS-291).
//
// The third control of the scope sentence, and a third one rather than a row of buttons inside
// `SliceBar` for `RateBasisBar`'s reason: the slice answers "which stretch of play", the basis
// answers "per hour of what", and this answers "which visits of the camp count". Folding them into
// one group would offer `every tier` beside `Session` as if a reader had to choose between them.
//
// IT IS DRAWN ONLY WHILE THE SLICE CARRIES A ZONE. `All`, `Session`, a duration rung and a custom
// range say nothing about where, so the membership would be a setting with no subject — and a
// control that is always visible but only sometimes means anything is the thing `SliceBar`'s
// "a short history loses the buttons" rule already refuses. The choice itself SURVIVES the slice
// (it lives in `useTimeslice`'s store), so switching to `All` and back does not silently reset it.
//
// IT SAYS WHAT YOU ARE LOOKING AT AND NOTHING ABOUT HOW, and it carries NO TOOLTIP — both are
// SliceBar's rules, inherited for its measured reason (a popper over a control eats the click aimed
// at it). What the two words MEAN is stated where it cannot cover anything: in the slice caption
// beside it, which names the membership in force on every read.

import { type JSX } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { ZONE_SCOPES, ZONE_SCOPE_LABEL, type ZoneScope } from '@shared/zoneScope'
import { useZoneScope } from './useTimeslice'

export interface ZoneScopeBarProps {
  /**
   * Prefix for this surface's testids: `<prefix>` and `<prefix>-<scope>`. Per surface for
   * `SliceBarProps.testId`'s reason — tabs stay mounted, so two of these can exist at once.
   */
  testId: string
}

export function ZoneScopeBar({ testId }: ZoneScopeBarProps): JSX.Element {
  const { zoneScope: scope, setZoneScope: onPick } = useZoneScope()
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      data-scope={scope}
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
      useFlexGap
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={scope}
        onChange={(_e, next: ZoneScope | null) => {
          // MUI reports null when the active button is clicked again. Some membership is always in
          // force, so that is a no-op rather than an empty selection (SliceBar's rule, same reason).
          if (next) onPick(next)
        }}
      >
        {ZONE_SCOPES.map((id) => (
          <ToggleButton
            key={id}
            value={id}
            data-testid={`${testId}-${id}`}
            sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4, textTransform: 'none' }}
          >
            {ZONE_SCOPE_LABEL[id]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  )
}
