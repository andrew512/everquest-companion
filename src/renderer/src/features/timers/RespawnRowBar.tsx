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
// AND IT SAYS ALL OF THAT IN LABELS (owner ruling, round 5: too much explanatory text). Rounds 1-4
// each left a sentence behind on this row — what a gap proves, what the floor did, what a sighting
// does not prove — until the row was three lines of prose under a countdown. Every one of those
// facts now lives on the HOVER (`respawnProvenance`, in shared/respawn.ts so the floating window's
// native title is the same string) and the row itself prints only state: the name, the number, the
// rung, the zone, and the age of any sighting.
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
// AND THE HOVER IS NOW THE MOB'S CARD (owner ruling, round 6). A countdown says when; the question
// a player standing on a spawn point is asking is whether to keep standing there, which is a
// question about loot. So pointing at a row reveals the SAME card the `/con` hover has always
// drawn — the wiki drop table with your own loot counts riding on it, and anything only your
// history knows underneath — with round 5's provenance sentence as its leading block. No second
// drops source, no second card, and the sentence is still the one string both surfaces read.
//
// AND THE ROW CARRIES ITS OWN WAY OUT (owner ruling, round 4). Every row here is a mob the user
// asked for by name, so the question "do I still want this clock" is asked AT the clock — not by
// scrolling to a list at the bottom of the page and matching a name against it, which is where the
// only unwatch used to live. It is the same control the Recently-killed entry offers, so the mob
// reads the same wherever you meet it.
//
// AND ROUND 7 FINISHED THAT MOVE. "Your watches" — the list at the bottom of the tab that round 4
// left standing — is gone, so the OTHER thing it held is here too: the seconds box that is rung 1
// of the ladder. It is on the row because that is where the player is standing when they decide the
// number is wrong, and it is the only control on this row that types rather than clicks, which is
// why the page keeps one caption stating its limits (a tooltip on an input is against the house
// rules, and an out-of-range number silently clears).
//
// AND THE ROW EXISTS EVEN WHEN THE CLOCK IS LONG GONE (owner ruling, round 8). A watched mob always
// has a row, so this component now draws one whose estimate elapsed hours ago — and it must not do
// that by shouting. A STALE row says the honest thing instead of a number that grows forever
// (`respawnClockLabel`: "due long ago", or "awaiting next death" where there was never an estimate),
// drops the progress bar because there is no estimate left running to draw, and goes grey so the
// clock actually ticking in front of you is still the loudest thing on the page. Everything else on
// it is unchanged: the hover, the gaps, the seconds box and Unwatch are all still there, because the
// row is still a mob the user is watching.
//
// AND THE ROW SHOWS ITS WORKING. Under the countdown it now prints the GAPS this fold measured for
// this mob in this zone — the samples `<= 3m 00s` is the minimum of — newest first. They are not a
// new claim and not a new source: the same numbers, un-minimised, said plainly, so "where did that
// estimate come from" is answerable without opening the hover. What they are NOT is spawns
// observed; see `respawnGapsLabel` in shared/respawn.ts for why that wording is load-bearing.

import { Box, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material'
import { useState, type JSX } from 'react'
import {
  RESPAWN_CONFIRM_TITLE,
  RESPAWN_CUSTOM_MAX_SEC,
  RESPAWN_CUSTOM_MIN_SEC,
  respawnBasisLabel,
  respawnCardNote,
  respawnClockLabel,
  respawnGapsLabel,
  respawnReading,
  respawnSeenLabel,
  respawnSourceLabel,
  type RespawnReading,
  type RespawnRow
} from '@shared/respawn'
import Tooltip from '../../lib/Tooltip'
import { MOB_CARD_SLOT_PROPS, MobCard } from '../../lib/hoverCards'
import { fmtDuration } from '../buffs/format'
import { mainMobLookup } from './mobLookup'
import { UnwatchButton } from './UnwatchButton'

/**
 * THE ROW'S TONE, one function for the accent, the clock text and the bar.
 *
 * Red when the log says it is UP, green once the clock ran out, blue while it runs. Every row on
 * screen is a mob the user asked for (tracking is opt-in), so there is no second class of ROW to
 * colour apart — only a second kind of FACT, and it is the one that outranks the countdown.
 *
 * AND GREY WHEN THE CLOCK STOPPED MEANING ANYTHING (round 8). A row whose estimate elapsed hours
 * ago is not "go and look" — painting it the same green as a clock that ran out ninety seconds ago
 * would make the loudest thing on the page the least useful one. It is dimmed rather than removed:
 * the ruling is that a watched mob is always visible.
 */
type RowTone = 'error' | 'success' | 'info' | 'stale'

function tone(r: RespawnReading): RowTone {
  if (r.seen) return 'error'
  if (r.stale) return 'stale'
  return r.due ? 'success' : 'info'
}

/** The clock's own colour. Blue is the resting state, so a running number is plain text. */
const CLOCK_COLOR: Record<RowTone, string> = {
  error: 'error.main',
  success: 'success.main',
  info: 'text.primary',
  stale: 'text.disabled'
}

/** The stripe down the left edge, which is the row's accent at a glance. */
const EDGE_COLOR: Record<RowTone, string> = {
  error: 'error.main',
  success: 'success.main',
  info: 'info.main',
  stale: 'divider'
}

/** The bar's palette colour. No entry for `stale`: a stale row draws no bar (see the render). */
const BAR_COLOR = { error: 'error', success: 'success', info: 'info' } as const

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
        <Tooltip title={RESPAWN_CONFIRM_TITLE}>
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

/**
 * RUNG 1 OF THE LADDER, EDITABLE ON THE MOB (owner ruling, round 7).
 *
 * The number you typed outranks everything, including what this app learned — a player camping a
 * spot knows more about it than the wiki and more than a handful of gaps — and until this round the
 * only place to type it was a list at the bottom of the page. Now it is on the clock it changes.
 *
 * IT OWNS ITS DRAFT and commits on BLUR, which is the behaviour the retired editor had and the
 * reason it is a component rather than a controlled field on the row: this row re-renders once a
 * second forever (it is a countdown), and a field reading the module's number every tick would
 * fight anybody halfway through typing one.
 *
 * AN UNREADABLE OR OUT-OF-RANGE ENTRY CLEARS the custom number rather than keeping a half-typed
 * one — the ladder then falls back to your kills, which is a real answer. And a blur that changed
 * nothing writes nothing: `setPrefs` bumps the module revision and pushes a snapshot to two
 * renderers, so tabbing through a row must not cost that.
 */
function CustomSeconds({
  row,
  onSetCustom
}: {
  row: RespawnRow
  onSetCustom: (key: string, display: string, sec?: number) => void
}): JSX.Element {
  const current = row.customMs === undefined ? undefined : Math.round(row.customMs / 1000)
  const [draft, setDraft] = useState(current === undefined ? '' : String(current))
  return (
    <TextField
      size="small"
      label="sec"
      value={draft}
      data-testid="respawn-custom"
      sx={{ width: 96, flexShrink: 0 }}
      onChange={(e) => {
        setDraft(e.target.value)
      }}
      onBlur={() => {
        const n = Number(draft.trim())
        const ok = Number.isFinite(n) && n >= RESPAWN_CUSTOM_MIN_SEC && n <= RESPAWN_CUSTOM_MAX_SEC
        const next = ok ? Math.round(n) : undefined
        if (next === current) return
        onSetCustom(row.key, row.display, next)
      }}
    />
  )
}

/**
 * THE ROW'S WORKING: the gaps it measured, and the number that overrides them.
 *
 * One line because they are one thought — "here is what I learned, and here is where you tell me I
 * am wrong". The gaps half is absent when there are none (a row numbered by the wiki, or by a kill
 * with nothing to pair it with), and the box half is absent on a surface with no way to write, the
 * same contract every other control on this row is under.
 */
function WorkingLine({
  row,
  onSetCustom
}: {
  row: RespawnRow
  onSetCustom?: (key: string, display: string, sec?: number) => void
}): JSX.Element | null {
  const gaps = respawnGapsLabel(row, fmtDuration)
  if (gaps.length === 0 && onSetCustom === undefined) return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, minWidth: 0 }}>
      {gaps.length > 0 && (
        <Typography
          variant="caption"
          data-testid="respawn-gaps"
          sx={{
            flex: 1,
            minWidth: 0,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {gaps}
        </Typography>
      )}
      {onSetCustom !== undefined && (
        <Box sx={{ ml: 'auto' }}>
          <CustomSeconds row={row} onSetCustom={onSetCustom} />
        </Box>
      )}
    </Stack>
  )
}

/**
 * THE ESTIMATE RUNNING DOWN — and the two states that draw NO bar at all.
 *
 * A row with no estimate would draw an empty one, which reads as "nearly up" and would be a lie. A
 * STALE row (round 8) would draw a full one, which claims the moment it filled is still worth
 * knowing — it is not, which is the whole reason that row stopped printing a countdown.
 *
 * Its own component because `RespawnRowBar` is at the repo's factoring ceiling, the same reason
 * `SeenRow` and `WorkingLine` above are.
 */
function ClockBar({ hasEstimate, r, t }: { hasEstimate: boolean; r: RespawnReading; t: RowTone }): JSX.Element | null {
  if (!hasEstimate || t === 'stale') return null
  return (
    <LinearProgress
      variant="determinate"
      value={(1 - r.fraction) * 100}
      color={BAR_COLOR[t]}
      sx={{ mt: 0.5, height: 3, borderRadius: 2 }}
    />
  )
}

export function RespawnRowBar({
  row,
  nowMs,
  onConfirmSighting,
  onUnwatch,
  onSetCustom
}: {
  row: RespawnRow
  nowMs: number
  /** Absent on a surface with no way to write (nothing today) — the button then does not exist. */
  onConfirmSighting?: (rowId: string) => void
  /** Same contract: no writer, no control. Round 4's affordance, on the mob rather than in a list. */
  onUnwatch?: (key: string) => void
  /** Round 7's: rung 1, typed on the clock it changes. Same contract again — no writer, no box. */
  onSetCustom?: (key: string, display: string, sec?: number) => void
}): JSX.Element {
  const r = respawnReading(row, nowMs)
  const hasEstimate = row.estimateMs !== undefined
  const basis = respawnBasisLabel(row)
  const t = tone(r)
  return (
    <Tooltip
      // ROUND 6: the hover is the mob's CARD — its drop table (wiki, plus what you have looted off
      // it yourself) under what we know about its respawn. The timer half is round 5's provenance
      // string unchanged, carried in as the card's leading block rather than duplicated beside it.
      title={
        <MobCard mob={row.display} note={respawnCardNote(row, fmtDuration)} lookup={mainMobLookup} />
      }
      slotProps={MOB_CARD_SLOT_PROPS}
      // The card has nothing to click — item names are plain text on it by design — so it takes no
      // pointer at all, which is the same law the floating window's card was drawn under while it
      // had one (a card that took the pointer while overlapping a row could swallow the Unwatch
      // beneath it, or fire the row's own mouseleave and flicker).
      disableInteractive
      // ROUND 7: the row now contains a text field, and MUI opens a tooltip on the ANCHOR's focus by
      // default — so tabbing into the seconds box would throw a 300px card over the row you are
      // typing into. This card is a mouse affordance and says so.
      disableFocusListener
      placement="top-start"
    >
      <Box
        data-testid="respawn-row"
        data-respawn-mob={row.key}
        data-respawn-source={row.source}
        data-respawn-due={r.due ? 'true' : 'false'}
        data-respawn-seen={r.seen ? 'true' : 'false'}
        data-respawn-stale={r.stale ? 'true' : 'false'}
        data-respawn-basis={row.basis}
        sx={{
          px: 1,
          py: 0.75,
          borderLeft: 3,
          borderColor: EDGE_COLOR[t],
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
              // counting; the facts worth colouring are UP, due, and long gone.
              color: CLOCK_COLOR[t]
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
        <WorkingLine row={row} onSetCustom={onSetCustom} />
        {r.seen && <SeenRow row={row} nowMs={nowMs} onConfirmSighting={onConfirmSighting} />}
        <ClockBar hasEstimate={hasEstimate} r={r} t={t} />
      </Box>
    </Tooltip>
  )
}
