// ScopeBar — WHICH STRETCH, WHICH TIERS OF IT, AND PER HOUR OF WHAT (JOS-288, JOS-291).
//
// The halves of one sentence, composed in one place so a surface cannot mount part of it. The
// SLICE (`SliceBar`, JOS-130) says which stretch of play the numbers are about; the ZONE SCOPE
// (`ZoneScopeBar`, JOS-291) says which tiers of the camp that stretch admits; the BASIS
// (`RateBasisBar`) says which of the two honest denominators its rates are divided by. They are
// separate CONTROLS on purpose — a reader does not choose between `Session` and `active` — and one
// COMPONENT on purpose, because every exp surface needs them and a page carrying only the first
// would show rates over an hour it never named.
//
// THE MIDDLE ONE IS CONDITIONAL, and that is the only asymmetry: a membership is meaningless on a
// slice with no zone in it, so it is drawn exactly while the slice carries one (`ZoneScopeBar`'s
// header states the whole rule). The other two always apply.
//
// IT IS NOT THE LOOT LEDGER'S CONTROL. That tab mounts `SliceBar` alone: its rate line prints BOTH
// readings side by side (JOS-261) precisely so neither can pass for the other, and a toggle there
// would replace a complete answer with half of one. The ledger still FOLLOWS the memberships
// chosen here, because the pick is app-wide and its caption names what it admitted — the same
// arrangement the slice pick itself has had since JOS-130.

import { type JSX } from 'react'
import type { SliceId, SliceRange, Timeslice } from '@shared/timeslice'
import { RateBasisBar } from './RateBasisBar'
import { SliceBar } from './SliceBar'
import { ZoneScopeBar } from './ZoneScopeBar'

export interface ScopeBarProps {
  available: readonly SliceId[]
  slice: Timeslice
  onPick: (id: SliceId) => void
  onCustom: (range: SliceRange) => void
  /** Prefix for the controls' testids: `<prefix>-slice…`, `<prefix>-tier…`, `<prefix>-basis…`. */
  testId: string
}

export function ScopeBar({ available, slice, onPick, onCustom, testId }: ScopeBarProps): JSX.Element {
  return (
    <>
      <SliceBar
        available={available}
        slice={slice}
        onPick={onPick}
        onCustom={onCustom}
        testId={`${testId}-slice`}
      />
      {slice.zoneKey !== null && <ZoneScopeBar testId={`${testId}-tier`} />}
      <RateBasisBar testId={`${testId}-basis`} />
    </>
  )
}
