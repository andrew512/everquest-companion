// placeholders — the `$<name>` half of the alert editor: which names a trigger offers, the chips
// that insert them, and the stand-in values a preview resolves against.
//
// Extracted from SpeechBlock.tsx when TEXT OVERLAYS became the second field that takes a template
// (docs/plans/alert-text-overlays.md §9). Nothing here knows about speech any more: the chips take
// a phrase and an inserter rather than a `SpeechForm`, so the Voice section and the Show-on-screen
// section drive the same component instead of owning two that look alike. The shared model beneath
// them is shared/captures.ts — one namespace, one syntax, and now one editor affordance.
//
// SpeechBlock re-exports `CaptureHints` so nothing downstream had to move.

import type { JSX } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import { placeholdersIn } from '@shared/speechText'

/**
 * WHICH `$<name>` PLACEHOLDERS THIS TRIGGER OFFERS — computed by AlertDialog from the condition
 * drafts the user is editing (shared/captureNames.ts) and handed down, because the trigger and
 * the template live in two different halves of the same dialog.
 *
 * `partial` is set when any condition is a raw regex: such a match ALSO carries the fields of
 * whatever event the line parsed to, and which event that is is unknowable until a line arrives.
 * The UI says so in words rather than listing a kind it would be guessing at.
 */
export interface CaptureHints {
  names: string[]
  partial: boolean
}

export const NO_CAPTURES: CaptureHints = { names: [], partial: false }

/**
 * Stand-in values for the editor's preview, so it shows the SENTENCE that will be used rather
 * than the holes a firing has not filled in yet.
 *
 * The stand-in is the NAME ITSELF, bare — not a bracketed marker. The ▶ button speaks this exact
 * string through the real engine, and a marker character would be read aloud as punctuation.
 * "attacker hit you for amount" is a sentence; "‹attacker› hit you for ‹amount›" is a noise.
 */
export function sampleCaptures(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, n]))
}

/**
 * Placeholders a template names that this trigger cannot fill — a typo, or a group left behind
 * after the trigger was edited. Empty for a raw trigger with `partial` hints: the event half of
 * its namespace is unknown at edit time, so calling a name "unknown" there would be a false alarm.
 *
 * Takes the TEXT rather than a form: each caller decides for itself whether its field is even
 * accepting a template right now (the Voice section only does in 'custom' mode).
 */
export function unknownPlaceholders(text: string, hints: CaptureHints): string[] {
  if (hints.partial) return []
  const offered = new Set(hints.names)
  return placeholdersIn(text).filter((n) => !offered.has(n))
}

/** The helper text a field shows for its unknown placeholders, or null when there are none. */
export function unknownPlaceholderNote(unknown: readonly string[]): string | null {
  if (unknown.length === 0) return null
  return `${unknown.map((n) => `$<${n}>`).join(', ')} — this trigger does not offer that; it will be left out.`
}

/**
 * The `$<name>` values this trigger offers, as chips that INSERT rather than merely inform —
 * clicking one appends it to the field, so the syntax never has to be typed from memory or
 * learned from a tooltip.
 *
 * Renders nothing when the trigger offers nothing AND there is no raw condition to explain: an
 * empty "you can use:" row is dead state (AGENTS.md: state, never process).
 */
export function PlaceholderChips({
  text,
  onInsert,
  hints,
  testId
}: {
  /** the field's current value — read only to decide whether an inserted name needs a space */
  text: string
  onInsert: (next: string) => void
  hints: CaptureHints
  testId: string
}): JSX.Element | null {
  if (hints.names.length === 0 && !hints.partial) return null
  const insert = (n: string): void => onInsert(`${text}${text ? ' ' : ''}$<${n}>`)
  return (
    <Box data-testid={testId}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        This trigger can say:
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {hints.names.map((n) => (
          <Chip
            key={n}
            size="small"
            variant="outlined"
            label={`$<${n}>`}
            onClick={() => insert(n)}
            sx={{ fontFamily: 'monospace' }}
          />
        ))}
      </Stack>
      {hints.partial && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          A raw trigger can also say any field of the event the matched line turns out to be —
          <code> $&lt;target&gt;</code>, <code>$&lt;amount&gt;</code> and so on.
        </Typography>
      )}
    </Box>
  )
}
