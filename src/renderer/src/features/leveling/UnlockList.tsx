// UnlockList — the rows of the "New at this level" panel (docs/plans/levelup-whats-new.md §2).
//
// ONE ROW SHAPE FOR BOTH LISTS. A spell and a discipline answer the same question ("what did this
// level give me") and differ only in what hangs off the name: a spell wears the class chips and a
// hover card built from the DB's own fields; a skill/disc/innate wears a KIND chip and, when the
// wiki contradicts itself about it, an honesty chip quoting the contradiction verbatim.
//
// THE HONESTY CHIP IS NOT DECORATION (law 1). Thirteen discipline rows — BER 2, MNK 10, RNG 1 —
// are stated with levels by their own class page and struck through by the central Disciplines
// page, which says only Rogue poison disciplines are on Legends. Both are the wiki's words. The
// row is drawn AND labeled, never silently shown and never silently dropped; the label's tooltip
// is the disputing sentence itself, copied out of classes.json.
//
// NEITHER FIXED-HEIGHT NOR WINDOWED ANY MORE (JOS-289 — this is the surface the owner NAMED as
// cramped). It was a 120px box with its own `overflow: auto` and `useWindowedRows` behind it: four
// and a half rows of a list that routinely has a dozen, read through a slot, in front of a panel
// whose whole job is "what did this level give me". Both halves are gone, and the second half is
// MEASURED rather than asserted: over all 560 three-class loadouts × 65 levels the longest list
// this join can produce is 41 rows (skills, BRD/MNK/SHD at 1; spells peak at 39, CLR/DRU/WIZ at
// 29), with p95 = 12 spells / 3 skills. That is not the row count `useWindowedRows` exists for —
// the loot ledger's thousands are — so the hook came off rather than being pointed at a container
// with no height to window against. `ROW_H` stays: uniform rows are what make the list scannable.
//
// THE SPELL NAME CARRIES THE FULL CARD (JOS-293, integrated here by JOS-289). This file used to
// draw its own five-field hover out of the four `UnlockSpell` fields the unlock join happens to
// carry. `SpellTooltip` (lib/SpellCard) asks MAIN for the whole record on open — the effect list
// in the wiki's own words, the derived rosters, the rank, the sentences the game prints — so the
// readout answers "should I memorize this" instead of restating the row.
//
// AND THE ROW NOW ANSWERS THE QUESTION WITHOUT THE HOVER (JOS-391). A list of names and class
// chips told a player WHAT unlocked and nothing about whether it was worth the trip to the vendor.
// Four statements were added, and each of them is a fact this app already holds:
//
//   the figures     `dmg 143 · dps 48 · 2.1 dmg/mana`, read off the wiki's own effect lines
//                   (shared/spellMetrics.ts) at the level the spell becomes yours
//   already yours   a class in YOUR loadout bought this six levels ago (shared/levelUnlocks.ts)
//   replaces        the rung below it in that class's upgrade line (the shipped research)
//   memorized       whether the spell it replaces is in your bar right now, and which of your
//                   saved sets would put it back (the spellSets module)
//
// A ROW GROWS A SECOND LINE ONLY WHEN IT HAS SOMETHING TO SAY. `ROW_H` still governs the name
// line, so a list of bare skill rows keeps exactly the rhythm JOS-289 kept it for; a spell with
// figures gets a quiet second line beneath its name rather than a wider first one, because the
// left column is narrow at the app's minimum width and the name is what a reader scans.
//
// NO CAVEATS PER ROW (AGENTS.md, the tooltip and caveat diet). The word `directional` is said ONCE
// in the panel header and nowhere else; no row footnotes where its number came from.

import { type JSX } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { ClassAbbr } from '@shared/classCombo'
import { ownershipPhrase, replacesPhrase, type UnlockRow } from '@shared/levelUnlocks'
import { spellMetricsParts } from '@shared/spellMetrics'
import { memorizedPhrase, type SpellSetsSnap } from '@shared/spellSets'
import { Tooltip } from '../../lib/Tooltip'
import { SpellTooltip } from '../../lib/SpellCard'

/** Row height in px — fixed, which is what keeps a scanned list on a rhythm. */
const ROW_H = 26

const KIND_LABEL: Record<UnlockRow['kind'], string> = {
  spell: 'spell',
  skill: 'skill',
  disc: 'disc',
  innate: 'innate'
}

const KIND_COLOR: Record<UnlockRow['kind'], string> = {
  spell: '#6fb3d2',
  skill: '#5fbf72',
  disc: '#b07fd0',
  innate: '#d9b25f'
}

/** The class chips: FILLED for a class we know is in the loadout, outlined for a candidate. */
function ClassChips({ classes, resolved }: { classes: ClassAbbr[]; resolved: ReadonlySet<string> }): JSX.Element {
  return (
    <>
      {classes.map((c) => (
        <Chip
          key={c}
          size="small"
          label={c}
          data-testid="unlock-class-chip"
          variant={resolved.has(c) ? 'filled' : 'outlined'}
          color="secondary"
          sx={{ height: 17, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }}
        />
      ))}
    </>
  )
}

/** One clause of the detail line. `dim` is for the ones that are context rather than the answer. */
function Note({ text, testid, dim }: { text: string; testid: string; dim?: boolean }): JSX.Element {
  return (
    <Typography
      variant="caption"
      data-testid={testid}
      sx={{ fontSize: 10.5, color: dim === true ? 'text.disabled' : 'text.secondary' }}
      noWrap
    >
      {text}
    </Typography>
  )
}

/**
 * Where the spell THIS row replaces currently lives, or null.
 *
 * The replaced spell is the one this row's own classes retire — a trio row can carry two, and the
 * first is the one the note is about, because the alternative is a sentence that names two bars.
 */
function memorizedNote(row: UnlockRow, sets: SpellSetsSnap): string | null {
  const mine = (row.spell?.replaces ?? []).find((r) => row.classes.includes(r.cls))
  return mine === undefined ? null : memorizedPhrase(sets, mine.name)
}

/**
 * THE SECOND LINE: figures, ownership, what it replaces, and where that replaced spell is.
 *
 * The order is the order a buying decision reads in — what it does, whether you already have it,
 * what it retires, and whether the thing it retires is loaded right now. Returns null when the row
 * has none of them, and the row stays exactly the height JOS-289 gave it.
 *
 * THE MEMORIZED CLAUSE HANGS OFF THE REPLACED SPELL, not this one — you cannot have memorized a
 * spell you unlock at this level. It appears only when the log has WATCHED that spell go into a
 * gem (shared/spellSets.ts rule 1: presence only, never a claim of absence), so a fresh log says
 * nothing here rather than telling a player their bar is empty.
 */
function RowDetail({
  row,
  resolved,
  sets
}: {
  row: UnlockRow
  resolved: ReadonlySet<string>
  sets: SpellSetsSnap
}): JSX.Element | null {
  const metrics = row.spell?.metrics
  const figures = metrics === undefined ? [] : spellMetricsParts(metrics)
  const owned = ownershipPhrase(row, resolved)
  const replaces = replacesPhrase(row)
  const memorized = memorizedNote(row, sets)
  if (figures.length === 0 && owned === null && replaces === null && memorized === null) return null
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      data-testid="unlock-detail"
      sx={{ pl: 0.25, mt: -0.5, mb: 0.25, minWidth: 0 }}
    >
      {figures.length > 0 && <Note text={figures.join(' · ')} testid="unlock-figures" />}
      {owned !== null && <Note text={owned} testid="unlock-already-yours" />}
      {replaces !== null && <Note text={replaces} testid="unlock-replaces" dim />}
      {memorized !== null && <Note text={memorized} testid="unlock-memorized" dim />}
    </Stack>
  )
}

function Row({
  row,
  resolved,
  sets
}: {
  row: UnlockRow
  resolved: ReadonlySet<string>
  sets: SpellSetsSnap
}): JSX.Element {
  const name =
    row.kind === 'spell' ? (
      <SpellTooltip name={row.name}>
        <Typography variant="caption" data-testid="unlock-spell-name" sx={{ fontWeight: 600 }} noWrap>
          {row.name}
        </Typography>
      </SpellTooltip>
    ) : (
      <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
        {row.name}
      </Typography>
    )
  return (
    <Box data-testid="unlock-row" data-kind={row.kind} sx={{ minWidth: 0 }}>
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{ height: ROW_H, minWidth: 0 }}
    >
      {row.kind !== 'spell' && (
        <Chip
          size="small"
          label={KIND_LABEL[row.kind]}
          sx={{
            height: 17,
            fontSize: 10,
            bgcolor: `${KIND_COLOR[row.kind]}22`,
            color: KIND_COLOR[row.kind],
            '& .MuiChip-label': { px: 0.6 }
          }}
        />
      )}
      <Box sx={{ minWidth: 0, flexShrink: 1 }}>{name}</Box>
      <Box sx={{ flexGrow: 1 }} />
      {row.dispute && (
        <Tooltip title={row.dispute}>
          <Chip
            size="small"
            label="disputed"
            data-testid="unlock-disputed"
            color="warning"
            variant="outlined"
            sx={{ height: 17, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }}
          />
        </Tooltip>
      )}
      <ClassChips classes={row.classes} resolved={resolved} />
    </Stack>
      <RowDetail row={row} resolved={resolved} sets={sets} />
    </Box>
  )
}

/**
 * One titled list, AS TALL AS ITS ROWS. `empty` is the sentence to print when there is nothing —
 * for BER/MNK/WAR the spells list is legitimately empty at EVERY level (they have no
 * Template:Spellpage spells at all), so an empty list is a stated fact here, never an error.
 */
export function UnlockList({
  title,
  rows,
  resolved,
  empty,
  sets
}: {
  title: string
  rows: UnlockRow[]
  resolved: ReadonlySet<string>
  empty: string
  /** The live gem/spell-set state, for the "is what this replaces loaded right now" clause. */
  sets: SpellSetsSnap
}): JSX.Element {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }} data-testid="unlock-list">
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25 }}>
        {title} ({rows.length})
      </Typography>
      <Box>
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            {empty}
          </Typography>
        ) : (
          rows.map((r) => <Row key={`${r.kind}:${r.name}`} row={r} resolved={resolved} sets={sets} />)
        )}
      </Box>
    </Box>
  )
}
