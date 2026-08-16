// THE RESISTS CARD (JOS-382). Reusable on purpose: the mob page mounts it today and the con
// tooltip mounts the same component in the follow-up, so a resist row reads identically wherever
// a player meets it.
//
// FIVE ROWS, ALWAYS, IN ONE ORDER. Magic, fire, cold, poison, disease - every time, whether or not
// there is anything behind them. A row is never omitted: "we have not seen fire cast on this" and
// "fire is fine" are different statements, and a missing row says neither (world-model law 1).
//
// AND THE ANSWER IS ALWAYS SHOWN (owner ruling, 2026-08-16, replacing the first cut's n >= 5
// floor). A cell with ONE observation draws the same things a cell with six hundred does - the tag,
// the bar, `R 126 (110-144)` and `n=1` - and adds the quieter caveat `low samples` beside the tag
// while it is under `LOW_SAMPLE_BELOW`. It does NOT print "not enough data" in place of the answer:
// the prior keeps a thin estimate sane, the interval comes out wide, and THE WIDE INTERVAL IS THE
// HONEST DISPLAY. Only a cell with nothing at all behind it says "no data".
//
// THE NUMBER NEVER APPEARS WITHOUT ITS INTERVAL AND ITS COUNT. `R 126 (110-144)` and `n=600`
// travel together, because the whole feature is an estimate off somebody's log and the width of
// that interval is the difference between "nuke cold" and "we have no idea yet". Owner ruling on
// confidence, 2026-08-16: simple counts, no big minimums, never hide what we know.
//
// WHERE THE EVIDENCE CAME FROM IS ON THE ROW. `baseline 480 + you 120`, per axis, because it
// differs per axis and a card-level legend would be wrong for four rows out of five. Once your own
// log stands alone the row says so, and where your log and the shipped data are both well
// populated and disagree outright, the row says THAT - the patch detector, stated and not acted on.

import { type JSX, useEffect, useState } from 'react'
import { Box, Collapse, Divider, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { MobResistAxis, MobResistProfile, ResistAxis } from '@shared/resistTypes'
import { RESIST_AXIS_WORDS } from '@shared/resistTypes'
import { RESIST_AXIS_COLORS, RESIST_UNKNOWN_COLOR } from './resistColors'
import { lowSamples } from '@shared/resistModel'
import {
  DIFFERS_NOTE,
  LOW_SAMPLE_NOTE,
  NO_DATA_TEXT,
  USER_ONLY_NOTE,
  bandFraction,
  barFraction,
  countText,
  estimateText,
  evidenceByFamily,
  evidenceText,
  npcCasterSummary,
  songSummary,
  splitText,
} from './resistRow'

const BAR_H = 8

function Quiet({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Typography variant="caption" color="text.disabled" display="block">
      {children}
    </Typography>
  )
}

/** The colour swatch. Always beside the word, never instead of it. */
function Swatch({ color }: { color: string }): JSX.Element {
  return (
    <Box
      sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color, flex: '0 0 auto' }}
      aria-hidden
    />
  )
}

/** R on a 0..200 scale, with the 95% interval drawn as a lighter band behind it. */
function ResistBar({ axis, R, lo, hi }: { axis: ResistAxis; R: number; lo: number; hi: number }): JSX.Element {
  const color = RESIST_AXIS_COLORS[axis]
  const band = bandFraction(lo, hi)
  return (
    <Box sx={{ position: 'relative', height: BAR_H, borderRadius: 1, bgcolor: 'action.hover', flex: 1, minWidth: 60 }}>
      <Box
        sx={{
          position: 'absolute',
          left: `${String(band.left * 100)}%`,
          width: `${String(band.width * 100)}%`,
          top: 0,
          bottom: 0,
          bgcolor: color,
          opacity: 0.28,
          borderRadius: 1,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: `calc(${String(barFraction(R) * 100)}% - 1px)`,
          width: 2,
          top: -1,
          bottom: -1,
          bgcolor: color,
        }}
      />
    </Box>
  )
}

function AxisNotes({ row }: { row: MobResistAxis }): JSX.Element | null {
  const est = row.estimate
  if (!est) return null
  const split = splitText(est)
  const notes = [split, est.userOnly && est.fromBaseline > 0 ? USER_ONLY_NOTE : null, est.differsFromShipped ? DIFFERS_NOTE : null]
  const text = notes.filter((n): n is string => n !== null).join(' · ')
  if (!text) return null
  return (
    <Typography
      variant="caption"
      color={est.differsFromShipped ? 'warning.main' : 'text.disabled'}
      data-testid={`resist-note-${row.axis}`}
    >
      {text}
    </Typography>
  )
}

function EvidencePanel({ row }: { row: MobResistAxis }): JSX.Element {
  const est = row.estimate
  if (!est) return <Quiet>Nothing observed on this axis yet.</Quiet>
  const { casts, songs } = evidenceByFamily(est)
  const song = songSummary(est)
  const npc = npcCasterSummary(est)
  return (
    <Box sx={{ pl: 2.5, pb: 1 }} data-testid={`resist-evidence-${row.axis}`}>
      {casts.length === 0 && <Quiet>Nothing observed on this axis yet.</Quiet>}
      {casts.map((ev) => (
        <Typography key={ev.spellKey} variant="caption" color="text.secondary" display="block">
          {evidenceText(ev)}
        </Typography>
      ))}
      {song !== null && (
        <>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
            {song}
          </Typography>
          {songs.map((ev) => (
            <Typography key={ev.spellKey} variant="caption" color="text.secondary" display="block">
              {evidenceText(ev)}
            </Typography>
          ))}
        </>
      )}
      {/* Its own line rather than a per-spell one, because the question it answers is about the
          WHOLE axis: how much of what is behind this number was cast by something that is not a
          person, and did it count. */}
      {npc !== null && (
        <Typography
          variant="caption"
          color="text.disabled"
          display="block"
          sx={{ mt: 0.5 }}
          data-testid={`resist-npc-${row.axis}`}
        >
          {npc}
        </Typography>
      )}
      {est.droppedNoLevel > 0 && (
        <Quiet>
          {est.droppedNoLevel} observation{est.droppedNoLevel === 1 ? '' : 's'} from other players, whose level the
          log never stated - counted here, not in the number.
        </Quiet>
      )}
    </Box>
  )
}

function AxisRow({ row }: { row: MobResistAxis }): JSX.Element {
  const [open, setOpen] = useState(false)
  const est = row.estimate
  // EMPTY, not "thin": the only cell that draws no answer is the one with nothing behind it.
  const empty = est === null || row.tag === null
  const color = empty ? RESIST_UNKNOWN_COLOR : RESIST_AXIS_COLORS[row.axis]
  return (
    <Box data-testid={`resist-row-${row.axis}`}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(!open)
        }}
        data-testid={`resist-expand-${row.axis}`}
        sx={{ cursor: 'pointer', py: 0.4, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Swatch color={color} />
        <Typography variant="body2" sx={{ color, width: 62, flex: '0 0 auto' }}>
          {RESIST_AXIS_WORDS[row.axis]}
        </Typography>
        {empty || !est ? (
          <Typography variant="caption" color="text.disabled" data-testid={`resist-empty-${row.axis}`} sx={{ flex: 1 }}>
            {NO_DATA_TEXT}
          </Typography>
        ) : (
          <>
            <ResistBar axis={row.axis} R={est.R} lo={est.lo} hi={est.hi} />
            <Typography variant="caption" sx={{ width: 116, flex: '0 0 auto' }} data-testid={`resist-value-${row.axis}`}>
              {estimateText(est)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 62, flex: '0 0 auto' }}>
              {countText(est.n)}
            </Typography>
            {/* The tag and its caveat share one cell, because they are one sentence: the caveat
                qualifies the tag and would be a different claim sitting anywhere else. The count is
                already in the column to the left, so it is not repeated here. */}
            <Typography variant="caption" sx={{ color, width: 96, flex: '0 0 auto' }} data-testid={`resist-tag-${row.axis}`}>
              {row.tag}
              {lowSamples(est.n) && (
                <Typography component="span" variant="caption" color="text.disabled" data-testid={`resist-low-${row.axis}`}>
                  {` · ${LOW_SAMPLE_NOTE}`}
                </Typography>
              )}
            </Typography>
          </>
        )}
        <ExpandMoreIcon
          fontSize="inherit"
          sx={{ color: 'text.disabled', transition: 'transform 120ms', transform: open ? 'rotate(180deg)' : undefined }}
        />
      </Stack>
      <Box sx={{ pl: 2.5 }}>
        <AxisNotes row={row} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <EvidencePanel row={row} />
      </Collapse>
    </Box>
  )
}

/** The card body, given an already-loaded profile. Split out so the e2e can drive it directly. */
export function ResistProfileBody({ profile }: { profile: MobResistProfile }): JSX.Element {
  if (!profile.spellDataAvailable) {
    // TWO STATES, AND MAIN NAMES WHICH ONE (JOS-385). This used to be one sentence for both, and
    // it blamed the player's install for the case where the file was exactly where it belongs and
    // our own load had failed. The sentence is built in main/resist/profile.ts, because only main
    // knows the resolved path and both surfaces have to say the same thing.
    return (
      <Quiet>
        <span data-testid="resist-no-spell-data">{profile.spellDataNote ?? 'Spell data unavailable.'}</span>
      </Quiet>
    )
  }
  return (
    <Box data-testid="resist-rows">
      {profile.axes.map((row) => (
        <AxisRow key={row.axis} row={row} />
      ))}
    </Box>
  )
}

/**
 * The whole card, including its own read. Main never rejects (see preload/resist.ts), so the only
 * states are "asking" and "answered", and "asking" is never collapsed with "there is nothing".
 */
export function ResistProfile({ mob }: { mob: string }): JSX.Element {
  const [profile, setProfile] = useState<MobResistProfile | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void window.eq
      .resistProfile(mob)
      .then((p) => {
        if (alive) setProfile(p)
      })
      .catch(() => {
        /* main never rejects; a null profile renders the honest empty state */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [mob])

  return (
    <Box data-testid="resist-card">
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2" gutterBottom>
        Resists{' '}
        <Typography component="span" variant="caption" color="text.secondary">
          (mined from logs)
        </Typography>
      </Typography>
      {loading && !profile && <Quiet>Reading what your logs have seen&hellip;</Quiet>}
      {profile && <ResistProfileBody profile={profile} />}
      {!loading && !profile && <Quiet>Nothing observed about this mob yet.</Quiet>}
    </Box>
  )
}
