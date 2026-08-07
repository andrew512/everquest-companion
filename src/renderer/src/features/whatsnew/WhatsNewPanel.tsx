// ============================================================================
// What's new — the browsable release history, and the app's own home for it (JOS-73).
// ============================================================================
//
// WHERE IT LIVES, AND WHY. Preferences → What's new, its own row in the section rail, directly
// under Updates. Three candidates were on the table and this one wins on both counts that
// matter:
//
//   * DISCOVERABILITY. The teaser strip is a one-launch affordance that a user can dismiss
//     forever in half a second, so it cannot be the only door. A named row in a rail somebody
//     already scans is a door you can find on purpose, months later, without remembering that a
//     strip once existed. Version already lives one row up in Updates, so this is where a person
//     looking for "what version am I on, and what changed" is already standing.
//   * IT IS A READING SURFACE WITH NO CONTROLS. That is exactly the argument this repo already
//     made twice — Performance and Usage analytics are SECTIONS rather than lines under
//     something else because a diagnostic/readable surface does not belong tucked inside a card
//     about switches (PreferencesView.tsx). Release history is the same shape, only more so.
//
// …and the Version row up in Updates carries a "What's new" link straight to it, so the version
// number itself is clickable in the way the ticket asked for, without a second copy of the panel.
//
// A GROWING LIST IN A FIXED-HEIGHT SCROLL BOX (AGENTS.md UI conventions). Fifteen releases today
// and one more every time we ship; letting it size to its content would push the rest of the
// Preferences column off the screen the way the combat log once did.
//
// STATE, NEVER PROCESS: the panel says what changed. It does not explain where notes come from,
// how "new" is computed, or that anything is stored — the NEW chip is the whole disclosure.

import { type JSX, useEffect, useMemo } from 'react'
import { Box, Chip, Divider, Stack, Typography } from '@mui/material'
import NewReleasesIcon from '@mui/icons-material/NewReleases'
import { RELEASE_NOTES, type ReleaseEntryKind, type ReleaseNote } from '@shared/releaseNotes'
import { DEV_TOOLS } from '../../devFlags'
import { formatCalendarDate } from '../../lib/formatDate'
import type { PrefSection } from '../preferences/PreferencesView'
import { markReleaseNotesSeen, useWhatsNew } from './session'
import { WhatsNewDevRow } from './WhatsNewDevRow'

/** How tall the history box is before it scrolls. Roughly two releases of detail — enough that
 *  the newest one is never cut off mid-thought, short enough to leave the rail's other rows
 *  reachable without scrolling the page. */
const HISTORY_MAX_HEIGHT = 420

/** What each `kind` is called in front of a person. Entries with no kind get no sub-header at
 *  all — that is the shape of the one-line historical headlines. */
const KIND_LABEL: Record<ReleaseEntryKind, string> = {
  new: 'New',
  fixed: 'Fixed',
  changed: 'Changed'
}

/** Sub-header order. Fixed before Changed because "what stopped being wrong" is the thing people
 *  scan a release for; New leads because it is why they would want the release at all. */
const KIND_ORDER: readonly ReleaseEntryKind[] = ['new', 'fixed', 'changed']

/** One group of lines under its sub-header, or a bare list when the entries carry no kind. */
function EntryGroup({ label, texts }: { label: string | null; texts: readonly string[] }): JSX.Element {
  return (
    <Stack spacing={0.25}>
      {label !== null && (
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.5 }} color="text.secondary">
          {label}
        </Typography>
      )}
      {texts.map((t) => (
        <Typography key={t} variant="body2" sx={{ pl: label === null ? 0 : 1 }}>
          {t}
        </Typography>
      ))}
    </Stack>
  )
}

/** One release: its version, its date, a NEW chip when it postdates what this install had seen,
 *  and its lines grouped by kind. */
function ReleaseBlock({ note, isNew }: { note: ReleaseNote; isNew: boolean }): JSX.Element {
  const unkinded = note.entries.filter((e) => e.kind === undefined).map((e) => e.text)
  return (
    <Stack spacing={0.75} data-testid={`whats-new-release-${note.version}`} data-new={isNew ? 'true' : undefined}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          v{note.version}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatCalendarDate(note.date)}
        </Typography>
        {isNew && (
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label="new"
            data-testid={`whats-new-chip-${note.version}`}
            sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
          />
        )}
      </Stack>
      {KIND_ORDER.map((kind) => {
        const texts = note.entries.filter((e) => e.kind === kind).map((e) => e.text)
        return texts.length === 0 ? null : <EntryGroup key={kind} label={KIND_LABEL[kind]} texts={texts} />
      })}
      {unkinded.length > 0 && <EntryGroup label={null} texts={unkinded} />}
    </Stack>
  )
}

/**
 * The section descriptor, co-located with the card the way `perfSection` and `graphicsSection`
 * are — PreferencesView.tsx sits at the 400-code-line factoring ceiling, and the words somebody
 * types to find a setting belong beside the setting.
 */
export function whatsNewSection(): PrefSection {
  return {
    id: 'whatsnew',
    label: "What's new",
    icon: <NewReleasesIcon fontSize="small" />,
    items: [
      {
        id: 'release-notes',
        label: 'Release notes',
        keywords:
          'whats new release notes changelog changes history updates version fixed added changed news log recent',
        content: <WhatsNewPanel />
      }
    ]
  }
}

export function WhatsNewPanel(): JSX.Element {
  const state = useWhatsNew()

  // OPENING THE PANEL IS SEEING THE NOTES. It runs once the state has actually arrived, and it
  // does not disturb what is on screen: `markReleaseNotesSeen` writes the store and leaves this
  // launch's derived state alone (features/whatsnew/session.ts), so the NEW chips the user came
  // here to read stay up until the next launch.
  const arrived = state !== null
  useEffect(() => {
    if (arrived) markReleaseNotesSeen()
  }, [arrived])

  const isNew = useMemo(() => new Set(state?.newVersions ?? []), [state])

  return (
    <Stack spacing={1.5} data-testid="whats-new-panel">
      <Box
        sx={{
          maxHeight: HISTORY_MAX_HEIGHT,
          overflowY: 'auto',
          pr: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5
        }}
      >
        {RELEASE_NOTES.map((note, i) => (
          <Box key={note.version}>
            {i > 0 && <Divider sx={{ mb: 1.5 }} />}
            <ReleaseBlock note={note} isNew={isNew.has(note.version)} />
          </Box>
        ))}
      </Box>
      {/* DEV-only, and it lives on THIS card rather than beside the dev restart button for the
          reason that button's own comment gives: a hand-test control belongs on the card holding
          the readout it drives. Clicking a variant here re-derives the panel you are looking at
          and the teaser strip below it, live — from the Performance section it would need a rail
          switch, which remounts this panel and stamps it seen on the way. `DEV_TOOLS` folds to a
          literal in every build, so the row and its imported component are deleted by rollup. */}
      {DEV_TOOLS && <WhatsNewDevRow />}
    </Stack>
  )
}
