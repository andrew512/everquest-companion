// THE TIMERS TAB — respawn clocks started by death messages (JOS-194).
//
// Two panels, and the second one is why the feature is usable on the first kill of a fresh
// install rather than after a configuration session:
//
//   LEFT   the live clocks. One row per watched mob that has died, counting down.
//   RIGHT  what you just killed. Every mob whose death this fold has seen recently, each with a
//          one-click Watch. Clicking it does not merely arm the FUTURE — the module already holds
//          the death, so the clock starts from the kill you already made. That is the whole
//          discoverability story: kill something, look at this tab, click Watch, see a clock.
//
// NOTHING IS CLOCKED UNTIL YOU SAY SO (owner ruling, 2026-08-10 — argued in shared/respawn.ts).
// The right-hand panel is therefore the ONLY way a row ever appears on the left, which makes the
// two panels a single flow rather than a list and its settings: the empty state on the left points
// at the panel on the right, and the panel on the right is a list of things that have actually
// died rather than a catalog to go shopping in.
//
// AND THE PAGE IS SCOPED TO ONE ZONE (same ruling). The scope switch at the top defaults to the
// zone the fold is in and the whole page obeys it — clocks AND recently-killed — because "what can
// I do about this right now" is a question about where you are standing. All zones is one click
// away and is what you want when you are setting up a camp you are not in yet; the counts on the
// switch say how much is hiding either way, so the default never silently swallows anything.
//
// AND UNWATCHING IS ON THE MOB, NOT IN A LIST (owner ruling, round 4). Watch was always a per-mob
// click; stopping used to mean finding the name again in "Your watches" at the bottom of this page.
// Now the clock row and the Recently-killed entry each carry the same Unwatch control — in the
// candidate's case in the exact place its Watch button sits, so the pair is one toggle — and every
// one of them lands on the same one-mob IPC call. The list below keeps its editor, because typing a
// number is genuinely list work; it is no longer the only way out.
//
// The number in the box beside a watched mob is rung 1 of the ladder — your own respawn, in
// seconds — and it outranks everything, including what this app learned. A player camping a spot
// knows more about it than the wiki and more than a handful of gaps.
//
// AND THE PAGE STOPPED EXPLAINING ITSELF (owner ruling, round 5). Each of the four rounds above
// left its ruling written out in prose at the top of this file's render, and the result was a
// thirteen-line paragraph over a page whose every control is one word. It is gone, not moved: the
// facts it recited are each already stated by something the user is looking at — the rung on a
// clock row, `wiki default`, `UP`, the zone chip and the scope switch, the Watch/Unwatch pair —
// and the sentences behind them live on those things' hovers (`respawnProvenance`,
// `respawnUnwatchTitle`, `RESPAWN_CONFIRM_TITLE`, all in shared/respawn.ts). One caption survives,
// under the seconds box, because a control's own limits are not state any label states.

import { useState, type JSX } from 'react'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  RESPAWN_CUSTOM_MAX_SEC,
  RESPAWN_CUSTOM_MIN_SEC,
  respawnInZone,
  type RespawnCandidate,
  type RespawnPrefs,
  type RespawnRow
} from '@shared/respawn'
import { fmtDuration } from '../buffs/format'
import { RespawnRowBar } from './RespawnRowBar'
import { RESPAWN_TOGGLE_SX, UnwatchButton } from './UnwatchButton'
import {
  useConfirmSighting,
  useRespawnSnap,
  useSecondsClock,
  useSetRespawnPrefs,
  useUnwatch
} from './useRespawn'

/** Which zone the page is showing. Component state: a view mode, not a preference. */
type Scope = 'zone' | 'all'

/** Add or update one watch, leaving the rest of the list alone. */
function withWatch(prefs: RespawnPrefs, key: string, display: string, customSec?: number): RespawnPrefs {
  const rest = prefs.watches.filter((w) => w.key !== key)
  const entry = customSec === undefined ? { key, display } : { key, display, customSec }
  return { ...prefs, watches: [...rest, entry] }
}

function CandidateRow({
  cand,
  prefs,
  onSet,
  onUnwatch
}: {
  cand: RespawnCandidate
  prefs: RespawnPrefs
  onSet: (next: RespawnPrefs) => void
  onUnwatch: (key: string) => void
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="respawn-candidate"
      data-respawn-mob={cand.key}
      sx={{ py: 0.5 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {cand.display}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {cand.zone.length > 0 ? cand.zone : 'unknown zone'} · {cand.kills} kill
          {cand.kills === 1 ? '' : 's'}
          {cand.wikiText !== undefined ? ` · wiki: ${cand.wikiText}` : ''}
        </Typography>
      </Box>
      {/* `watched` is the MODULE's answer, not a second one worked out here from the same
          snapshot's prefs — one fact, one owner. The two states are ONE TOGGLE (round 4): the same
          size of button in the same place, saying the opposite thing. */}
      {cand.watched ? (
        <UnwatchButton
          mobKey={cand.key}
          display={cand.display}
          testId="respawn-unwatch"
          onUnwatch={onUnwatch}
        />
      ) : (
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          data-testid="respawn-watch"
          // The SAME shape as its opposite (RESPAWN_TOGGLE_SX) — one control with two states, not
          // two buttons that happen to share a slot.
          sx={RESPAWN_TOGGLE_SX}
          onClick={() => {
            onSet(withWatch(prefs, cand.key, cand.display))
          }}
        >
          Watch
        </Button>
      )}
    </Stack>
  )
}

function WatchEditorRow({
  watch,
  prefs,
  onSet,
  onUnwatch
}: {
  watch: { key: string; display: string; customSec?: number }
  prefs: RespawnPrefs
  onSet: (next: RespawnPrefs) => void
  /** The same one-mob removal every other surface calls — one write path, not a second list edit. */
  onUnwatch: (key: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(watch.customSec === undefined ? '' : String(watch.customSec))
  return (
    <Stack direction="row" spacing={1} alignItems="center" data-testid="respawn-watch-row" sx={{ py: 0.5 }}>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
        {watch.display}
      </Typography>
      <TextField
        size="small"
        label="seconds"
        value={draft}
        data-testid="respawn-custom"
        sx={{ width: 110 }}
        onChange={(e) => {
          setDraft(e.target.value)
        }}
        onBlur={() => {
          const n = Number(draft.trim())
          const ok = Number.isFinite(n) && n >= RESPAWN_CUSTOM_MIN_SEC && n <= RESPAWN_CUSTOM_MAX_SEC
          // An unreadable or out-of-range entry CLEARS the custom number rather than keeping a
          // half-typed one: the ladder then falls back to your kills, which is a real answer.
          onSet(withWatch(prefs, watch.key, watch.display, ok ? Math.round(n) : undefined))
        }}
      />
      <IconButton
        size="small"
        aria-label={`Stop watching ${watch.display}`}
        onClick={() => {
          onUnwatch(watch.key)
        }}
      >
        <DeleteOutlineIcon fontSize="inherit" />
      </IconButton>
    </Stack>
  )
}

function ClocksPanel({
  rows,
  nowMs,
  elsewhere,
  zoneName,
  onConfirmSighting,
  onUnwatch
}: {
  rows: RespawnRow[]
  nowMs: number
  /** How many clocks the scope is hiding. Stated, never silently dropped. */
  elsewhere: number
  zoneName: string
  onConfirmSighting: (rowId: string) => void
  /** Round 4: the row's own way out, handed down so the clock carries it instead of a list. */
  onUnwatch: (key: string) => void
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="respawn-empty" sx={{ py: 2 }}>
        {elsewhere > 0
          ? `No clocks in ${zoneName}. ${elsewhere} running in other zones.`
          : 'No clocks running. Watch a mob from Recently killed.'}
      </Typography>
    )
  }
  return (
    <Stack spacing={0.75} data-testid="respawn-rows">
      {rows.map((row) => (
        <RespawnRowBar
          key={row.id}
          row={row}
          nowMs={nowMs}
          onConfirmSighting={onConfirmSighting}
          onUnwatch={onUnwatch}
        />
      ))}
    </Stack>
  )
}

/** The scope switch, and the counts that say what each side is holding. */
function ScopeSwitch({
  scope,
  onScope,
  zoneName,
  here,
  total
}: {
  scope: Scope
  onScope: (s: Scope) => void
  zoneName: string
  here: number
  total: number
}): JSX.Element {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      data-testid="respawn-scope"
      value={scope}
      onChange={(_e, v: Scope | null) => {
        // MUI hands back null when the pressed button was already selected; a scope must always
        // have a value, so that click is a no-op rather than an unscoped page.
        if (v !== null) onScope(v)
      }}
    >
      <ToggleButton data-testid="respawn-scope-zone" value="zone">
        {zoneName} ({here})
      </ToggleButton>
      <ToggleButton data-testid="respawn-scope-all" value="all">
        All zones ({total})
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

/**
 * THE RIGHT-HAND COLUMN: what you killed, and what you are watching.
 *
 * Its own component because the page reached the repo's `max-lines-per-function` ceiling when round
 * 4 wired the removal writer through it, and the answer to that is a split rather than a widened
 * threshold. The seam is the honest one anyway — the left column is the running clocks and this is
 * where they are ADMITTED and retired.
 */
function DiscoveryPanel({
  recent,
  anyRecent,
  scoped,
  zoneName,
  prefs,
  onSet,
  onUnwatch
}: {
  recent: RespawnCandidate[]
  /** How many candidates the fold holds in total, so the scoped empty state can say where they are. */
  anyRecent: number
  scoped: boolean
  zoneName: string
  prefs: RespawnPrefs
  onSet: (next: RespawnPrefs) => void
  onUnwatch: (key: string) => void
}): JSX.Element {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Recently killed
      </Typography>
      {recent.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="respawn-recent-empty">
          {scoped && anyRecent > 0
            ? `Nothing has died in ${zoneName} yet. ${anyRecent} elsewhere.`
            : 'Nothing has died yet in this log.'}
        </Typography>
      ) : (
        <Stack data-testid="respawn-recent" divider={<Divider flexItem />}>
          {recent.map((c) => (
            <CandidateRow key={`${c.zone}::${c.key}`} cand={c} prefs={prefs} onSet={onSet} onUnwatch={onUnwatch} />
          ))}
        </Stack>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Your watches
      </Typography>
      {prefs.watches.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="respawn-watches-empty">
          None yet.
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {prefs.watches.map((w) => (
            <WatchEditorRow key={w.key} watch={w} prefs={prefs} onSet={onSet} onUnwatch={onUnwatch} />
          ))}
        </Stack>
      )}
      {/* The ONLY caption left on this page (round 5), and it is here because the seconds box is
          the one control whose limits are stated nowhere else - a tooltip on an input the user
          types into is against the house rules, and an out-of-range number silently clears. The
          watch-follows-the-name and zone-scope sentences that used to sit here are on the Unwatch
          hover and on the scope switch respectively. */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Custom: {fmtDuration(RESPAWN_CUSTOM_MIN_SEC * 1000)} to{' '}
        {fmtDuration(RESPAWN_CUSTOM_MAX_SEC * 1000)}. Empty uses your kills.
      </Typography>
    </Box>
  )
}

export default function TimersView(): JSX.Element {
  const snap = useRespawnSnap()
  const nowMs = useSecondsClock()
  const setPrefs = useSetRespawnPrefs()
  const confirmSighting = useConfirmSighting()
  const unwatch = useUnwatch()
  const prefs = snap.prefs
  const [scope, setScope] = useState<Scope>('zone')

  // The zone name as the switch and the empty states say it. The fold has no zone before the log
  // states one, and "this zone" is then a claim it cannot make.
  const zoneName = snap.zone.length > 0 ? snap.zone : 'Unknown zone'
  const hereRows = respawnInZone(snap.rows, snap.zone)
  const hereRecent = respawnInZone(snap.recent, snap.zone)
  const rows = scope === 'zone' ? hereRows : snap.rows
  const recent = scope === 'zone' ? hereRecent : snap.recent

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }} data-testid="timers-view">
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.5 }}>
        <Typography variant="h6">Respawn clocks</Typography>
        {snap.zone.length > 0 && <Chip size="small" label={snap.zone} variant="outlined" />}
      </Stack>
      <Box sx={{ mb: 2, mt: 1.5 }}>
        <ScopeSwitch
          scope={scope}
          onScope={setScope}
          zoneName={zoneName}
          here={hereRows.length}
          total={snap.rows.length}
        />
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Running
          </Typography>
          <ClocksPanel
            rows={rows}
            nowMs={nowMs}
            elsewhere={scope === 'zone' ? snap.rows.length - hereRows.length : 0}
            zoneName={zoneName}
            onConfirmSighting={confirmSighting}
            onUnwatch={unwatch}
          />
        </Box>

        <DiscoveryPanel
          recent={recent}
          anyRecent={snap.recent.length}
          scoped={scope === 'zone'}
          zoneName={zoneName}
          prefs={prefs}
          onSet={setPrefs}
          onUnwatch={unwatch}
        />
      </Stack>
    </Box>
  )
}
