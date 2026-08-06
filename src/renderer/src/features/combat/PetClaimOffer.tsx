// THE QUESTION ABOVE THE METER — "<Name> — your pet?" (JOS-47).
//
// The user's report was that the DPS meter did not show their pet. It could not: a summoned pet
// that is never ORDERED sends no private tell, so nothing in the log says it is yours, and its
// damage was dropped at admission and invisible at every scope (shared/petClaims.ts has the
// measurements). The honest fix is not a cleverer guess — it is to ask.
//
// UI CONVENTION (AGENTS.md): state, never process. The offer states a QUESTION and two answers;
// no caption explains how pets are detected, and the evidence lives in the tooltip where it
// belongs. It appears only while the entity is unbound and vanishes the moment ANY binding
// signal lands (main-side: EngineState.notePet releases the candidate), so there is never a
// lingering chip beside a pet that is already yours.
//
// The two answers are not symmetric, and the wording says so: YES moves damage (main re-runs
// the replay so the pet's whole history arrives at once, not a total that starts at the click),
// NO only removes the question.

import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Tooltip } from '../../lib/Tooltip'
import { claimEvidence, claimPrompt, type PetCandidate, type PetClaimsSnap } from '@shared/petClaims'

/** One question. Disabled while main is rebuilding, because a claim is a real replay. */
function Offer({ c, busy, answer }: { c: PetCandidate; busy: boolean; answer: (a: 'claim' | 'deny') => void }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Tooltip title={claimEvidence(c)}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {claimPrompt(c)}
        </Typography>
      </Tooltip>
      <Button
        size="small"
        disabled={busy}
        onClick={() => answer('claim')}
        sx={{ fontSize: 11, minWidth: 0, px: 0.75, py: 0 }}
      >
        Yes
      </Button>
      <Button
        size="small"
        color="inherit"
        disabled={busy}
        onClick={() => answer('deny')}
        sx={{ fontSize: 11, minWidth: 0, px: 0.75, py: 0, color: 'text.disabled' }}
      >
        No
      </Button>
    </Stack>
  )
}

/**
 * Every open question, or nothing at all — which is what nearly every player sees, because a pet
 * that sends its tell is bound and never becomes a candidate.
 */
export function PetClaimOffer({ petClaims }: { petClaims: PetClaimsSnap }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  if (petClaims.candidates.length === 0) return null
  const answer = (name: string, action: 'claim' | 'deny'): void => {
    setBusy(true)
    void window.eq
      .setPetClaim({ name, action })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return (
    <Box
      data-testid="pet-claim-offer"
      sx={{ mb: 0.75, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      {petClaims.candidates.map((c) => (
        <Offer key={c.key} c={c} busy={busy} answer={(a) => answer(c.name, a)} />
      ))}
    </Box>
  )
}
