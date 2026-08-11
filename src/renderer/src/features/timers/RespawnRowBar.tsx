// One respawn clock, drawn (JOS-194). Used by the Timers tab; the floating overlay draws the same
// facts with plain divs because that bundle is MUI-free, and both surfaces take the clock's
// WORDING and the provenance line from `shared/respawn.ts` rather than spelling either twice.
//
// WHAT THE ROW IS CAREFUL ABOUT. It never says the mob is up FROM A CLOCK. `due` means the estimate
// elapsed, the label says "due" and not "spawned", and the provenance line under the name states
// which rung of the ladder produced the number and how thin the evidence is ("your kills (2 gaps)").
// A countdown with no provenance is a countdown the user has to trust blindly, and the whole
// argument of this feature is that the number the wiki would have given them does not deserve
// that (shared/respawnWiki.ts).
//
// THE ONE PLACE IT DOES SAY UP IS WHEN THE LOG SAID SO (owner ruling, round 3). A row whose mob has
// been named by a parsed event since its clock started reads UP, in a colour used nowhere else on
// this surface, with the age of that evidence and the family of line that carried it printed
// underneath. That is not the clock changing its mind — the countdown, the bar and the provenance
// are all still there — it is the row leading with the fact instead of the estimate.
//
// AND THE RE-BASE IS A BUTTON, NEVER A RULE. A sighting proves the mob is up and says nothing about
// when it spawned, so nothing here moves the clock on its own. The button appears only on a seen
// row, says what it will do, and is the only path to `basis: 'sighting'` — which the row then
// states out loud, because a number resting on the user's judgement must never look like one
// resting on a line the game printed.
//
// AND THE ROW CARRIES ITS OWN WAY OUT (owner ruling, round 4). Every row here is a mob the user
// asked for by name, so the question "do I still want this clock" is asked AT the clock — not by
// scrolling to a list at the bottom of the page and matching a name against it, which is where the
// only unwatch used to live. It is the same control the Recently-killed entry offers, so the mob
// reads the same wherever you meet it.

import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material'
import type { JSX } from 'react'
import {
  respawnBasisLabel,
  respawnClockLabel,
  respawnFloored,
  respawnReading,
  respawnSeenLabel,
  respawnSourceLabel,
  type RespawnReading,
  type RespawnRow
} from '@shared/respawn'
import Tooltip from '../../lib/Tooltip'
import { fmtDuration } from '../buffs/format'
import { UnwatchButton } from './UnwatchButton'

/** The sentence that explains a LEARNED number, including what a gap does and does not prove. */
function observedSentence(row: RespawnRow): string {
  const gaps = `${String(row.samples)} gap${row.samples === 1 ? '' : 's'}`
  return (
    `Your shortest gap between two deaths of this mob, in one continuous stay in the zone, was ` +
    `${fmtDuration(row.observedMs)} over ${gaps}. A gap is an upper bound - you cannot kill it ` +
    `before it spawns - so the real respawn is at most this.`
  )
}

/** Why this row's number is the number it is. One rung's sentence, then the wiki's own words. */
const RUNG_SENTENCE: Record<RespawnRow['source'], string> = {
  custom: 'You set this number yourself. Nothing overrides it.',
  observed: '',
  wiki: 'No gap of your own yet, so this is the wiki default.',
  none: 'Nothing states a respawn for this mob yet. Kill it twice in one visit, or type a number.'
}

export function respawnProvenance(row: RespawnRow): string {
  const parts = [row.source === 'observed' ? observedSentence(row) : RUNG_SENTENCE[row.source]]
  if (row.wikiText !== undefined) parts.push(`The wiki says: "${row.wikiText}".`)
  if (respawnFloored(row)) {
    parts.push('The wiki floor lifted this estimate - two mobs of one name can die together and drive your gap too low.')
  }
  if (row.basis === 'sighting') {
    parts.push('This clock was re-based on a sighting YOU confirmed, not on a death message. The next kill takes it back.')
  }
  parts.push(`Killed ${String(row.kills)} time${row.kills === 1 ? '' : 's'} here.`)
  return parts.filter((p) => p.length > 0).join(' ')
}

/** What the log said, and what it does not prove — the sentence beside the confirm button. */
const SEEN_TOOLTIP =
  'The log named this mob in this zone after the clock started, so it is up. That is all a ' +
  'sighting proves - it does not say when it spawned, so nothing has been changed. If you are ' +
  'sure this sighting IS the spawn, re-base the clock and it will count from that instant; a ' +
  'death message afterwards takes the clock straight back.'

/**
 * THE ROW'S TONE, one function for the accent, the clock text and the bar.
 *
 * Red when the log says it is UP, green once the clock ran out, blue while it runs. Every row on
 * screen is a mob the user asked for (tracking is opt-in), so there is no second class of ROW to
 * colour apart — only a second kind of FACT, and it is the one that outranks the countdown.
 */
function tone(r: RespawnReading): 'error' | 'success' | 'info' {
  if (r.seen) return 'error'
  return r.due ? 'success' : 'info'
}

/**
 * THE SEEN LINE AND THE ONLY AFFORDANCE THAT MOVES A CLOCK WITHOUT A LOG LINE BEHIND IT.
 *
 * The two live together and appear only while the row is seen: the button is meaningless without
 * the evidence, and the evidence is the thing the button is confirming.
 */
function SeenRow({
  row,
  nowMs,
  onConfirmSighting
}: {
  row: RespawnRow
  nowMs: number
  onConfirmSighting?: (rowId: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, minWidth: 0 }}>
      <Typography variant="caption" data-testid="respawn-seen" sx={{ flex: 1, minWidth: 0, color: 'error.main' }}>
        {respawnSeenLabel(row, nowMs, fmtDuration)}
      </Typography>
      {onConfirmSighting !== undefined && (
        <Tooltip title={SEEN_TOOLTIP}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            data-testid="respawn-confirm-sighting"
            sx={{ py: 0, minWidth: 0, fontSize: 11, textTransform: 'none' }}
            onClick={(e) => {
              // The row itself carries a tooltip; a click on the button is about the button.
              e.stopPropagation()
              onConfirmSighting(row.id)
            }}
          >
            Start clock here
          </Button>
        </Tooltip>
      )}
    </Stack>
  )
}

export function RespawnRowBar({
  row,
  nowMs,
  onConfirmSighting,
  onUnwatch
}: {
  row: RespawnRow
  nowMs: number
  /** Absent on a surface with no way to write (nothing today) — the button then does not exist. */
  onConfirmSighting?: (rowId: string) => void
  /** Same contract: no writer, no control. Round 4's affordance, on the mob rather than in a list. */
  onUnwatch?: (key: string) => void
}): JSX.Element {
  const r = respawnReading(row, nowMs)
  const hasEstimate = row.estimateMs !== undefined
  const basis = respawnBasisLabel(row)
  const t = tone(r)
  return (
    <Tooltip title={respawnProvenance(row)} placement="top-start">
      <Box
        data-testid="respawn-row"
        data-respawn-mob={row.key}
        data-respawn-source={row.source}
        data-respawn-due={r.due ? 'true' : 'false'}
        data-respawn-seen={r.seen ? 'true' : 'false'}
        data-respawn-basis={row.basis}
        sx={{
          px: 1,
          py: 0.75,
          borderLeft: 3,
          borderColor: `${t}.main`,
          bgcolor: 'action.hover',
          borderRadius: 0.5
        }}
      >
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {row.display}
          </Typography>
          <Typography
            variant="body2"
            data-testid="respawn-clock"
            sx={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: r.seen ? 700 : 400,
              // Blue is the resting state and would read as an alert on a number that is simply
              // counting; the two facts worth colouring are UP and due.
              color: t === 'info' ? 'text.primary' : `${t}.main`
            }}
          >
            {respawnClockLabel(row, nowMs, fmtDuration)}
          </Typography>
          {/* Last, so the countdown keeps its place on every row and the control never sits
              between the name and the number the eye is looking for. */}
          {onUnwatch !== undefined && (
            <UnwatchButton
              mobKey={row.key}
              display={row.display}
              testId="respawn-row-unwatch"
              onUnwatch={onUnwatch}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="caption" sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }}>
            {row.zone.length > 0 ? row.zone : 'unknown zone'} · {respawnSourceLabel(row)}
            {basis.length > 0 ? ` · ${basis}` : ''}
          </Typography>
          {hasEstimate && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {row.source === 'observed' ? '<= ' : ''}
              {fmtDuration(row.estimateMs)}
            </Typography>
          )}
        </Stack>
        {r.seen && <SeenRow row={row} nowMs={nowMs} onConfirmSighting={onConfirmSighting} />}
        {/* The bar is the estimate running down. Absent entirely when there is no estimate rather
            than drawn empty - an empty bar reads as "nearly up", which would be a lie. */}
        {hasEstimate && (
          <LinearProgress
            variant="determinate"
            value={(1 - r.fraction) * 100}
            color={t}
            sx={{ mt: 0.5, height: 3, borderRadius: 2 }}
          />
        )}
      </Box>
    </Tooltip>
  )
}
