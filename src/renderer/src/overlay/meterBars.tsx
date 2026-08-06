// meterBars — the damage overlay's BAR BODY: the ranked entity list and, one click down, the
// breakdown for one entity. Split out of OverlayMeter so that file is the window chrome (header,
// selector, footer) and this one is the meter itself.
//
// IT RENDERS THE SAME METER THE COMBAT TAB DOES (owner ruling, 2026-08-04: "they should be using
// the same underlying api and abstraction — if not, collapse"). It used to build its rows from a
// DIFFERENT fold: the overlay asked the engine for `combinePets`, which returns a synthetic
// "You +pets" source whose lanes are namespaced strings ("Vebarn: Slash") and which has no pet
// LINE at all, while the Combat tab built its rows in petRows.ts over the un-folded sources. Two
// folds, two answers to "what is my damage". The engine fold is deleted; every row on this
// surface now comes out of `petRows.meterPanel`, the same call `SegmentPanel` makes, over the
// same snapshot and honouring the same 'Combine pet into your damage' preference.
//
// MUI-FREE ON PURPOSE: the overlay is its own renderer entry (overlay.html) with no theme and
// no component library — every pixel here is plain React + inline styles. Do not import
// @mui/* into this bundle. petRows/dashboardData/landEvidence are pure TS and import legally.

import { type JSX, useMemo, useState } from 'react'
import type { OverlayDrill } from '@shared/types'
import { CATEGORY_LABEL, type DamageCategory, type SegmentView, type SourceView } from '@shared/combat'
import { formatNum as fmt, formatRate } from '../lib/formatRate'
import { type FlatSkill, type SkillRow } from '../features/combat/dashboardData'
import { laneDps, meterPanel, type OwnRow, type PetRow } from '../features/combat/petRows'
import { useCombinePetRow } from '../features/combat/useCombatPrefs'
import { scopeSources } from '../features/combat/meterScope'
import { landEvidence } from '../features/combat/landEvidence'
import { MeterCrumb } from './meterCrumb'
// The app's ONE `m:ss` spelling, out of the MUI-free primitives module every plain-text and
// plain-React surface already reads it from. The overlay does not get a second one.
import { fmtDur } from '../features/combat/copyTable'
import type { MeterScope, RosterSnap } from '@shared/roster'
import { claimEvidence, claimPrompt, type PetClaimsSnap } from '@shared/petClaims'

// Kept in step with the Combat tab's KIND_COLOR (features/combat/combatShared.tsx) — the overlay
// is MUI-free and cannot import the theme, so the two lists are written out and must move
// together. `member` is a group-mate (docs/plans/group-model.md).
const KIND_COLOR: Record<string, string> = {
  you: '#d9b25f',
  pet: '#6fb3d2',
  member: '#7fbf8f',
  enemy: '#cf6679'
}
// KEEP IN SYNC with the app's CAT_COLOR (features/combat/combatShared.tsx) — the overlay is a
// separate renderer entry with no MUI theme, so it carries its own copy. 'slay' is a radiant
// ivory, deliberately far from melee gold: a Slay Undead proc flattens into a row named after
// its weapon skill, so at the old pale-gold it was invisible next to the plain melee row.
const CAT_COLOR: Record<DamageCategory, string> = {
  melee: '#d9b25f',
  slay: '#f6f0da',
  spell: '#a98fe0',
  dot: '#6fb3d2',
  ds: '#cf6679'
}

/**
 * THE QUESTION ABOVE THE BARS — "<Name> — your pet?" (JOS-47), the overlay's own spelling of the
 * Combat tab's `PetClaimOffer`. Same sentence (shared/petClaims.ts owns the wording, so the two
 * surfaces cannot phrase one question two ways), plain React because this bundle has no MUI.
 *
 * `interactive` mirrors the drill gate: a LOCKED overlay is click-through by law, so the answers
 * are rendered but inert rather than absent — the user can still read the question, and the whole
 * window is one unpin away from being answerable.
 */
function PetClaimOffer({
  petClaims,
  interactive
}: {
  petClaims: PetClaimsSnap
  interactive: boolean
}): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  if (petClaims.candidates.length === 0) return null
  const answer = (name: string, action: 'claim' | 'deny'): void => {
    if (!interactive || busy) return
    setBusy(true)
    void window.eqOverlay
      .setPetClaim({ name, action })
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  const btn = (label: string, name: string, action: 'claim' | 'deny', color: string): JSX.Element => (
    <span
      onClick={() => answer(name, action)}
      style={{
        color,
        cursor: interactive && !busy ? 'pointer' : 'default',
        opacity: busy ? 0.4 : 1,
        marginLeft: 6,
        fontWeight: 600
      }}
    >
      {label}
    </span>
  )
  return (
    <div data-testid="overlay-pet-claim" style={{ marginBottom: 3 }}>
      {petClaims.candidates.map((c) => (
        <div
          key={c.key}
          title={claimEvidence(c)}
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 11,
            lineHeight: '15px',
            color: '#9aa0a6',
            whiteSpace: 'nowrap',
            overflow: 'hidden'
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {claimPrompt(c)}
          </span>
          {/* The pet colour, because that is the colour of the row saying yes creates. */}
          {btn('Yes', c.name, 'claim', KIND_COLOR.pet)}
          {btn('No', c.name, 'deny', '#767b80')}
        </div>
      ))}
    </div>
  )
}

/** A single horizontal bar: label + right-text + pct-fill. Dense + high-contrast. Clickable to drill. */
function Bar({
  color,
  pct,
  rank,
  label,
  right,
  onClick,
  accent,
  title
}: {
  color: string
  pct: number
  rank?: number
  label: React.ReactNode
  right: string
  onClick?: () => void
  /** Full-height left stripe — keeps a skill row's category readable at any bar width. */
  accent?: string
  /** Native hover tooltip spelling out the compacted right-hand stats (interactive mode only —
   *  a locked overlay is click-through, so nothing hovers it). */
  title?: string
}): JSX.Element {
  return (
    <div
      // The e2e's only anchor into the bar body: a hidden always-on-top window has no cursor, so
      // the overlay drill spec drives these rows by selector (tests/e2e/overlay-sync.e2e.mts).
      data-testid="overlay-bar"
      onClick={onClick}
      title={title}
      style={{
        position: 'relative',
        height: 18,
        borderRadius: 3,
        marginBottom: 2,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        background: 'rgba(255,255,255,0.06)'
      }}
    >
      <div style={{ position: 'absolute', inset: 0, width: `${Math.max(2, pct)}%`, background: color, opacity: 0.55 }} />
      {accent && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          padding: accent ? '0 6px 0 9px' : '0 6px',
          gap: 6,
          fontSize: 11,
          lineHeight: 1,
          textShadow: '0 1px 2px rgba(0,0,0,0.9)'
        }}
      >
        {rank != null && (
          <span style={{ color: 'rgba(255,255,255,0.55)', width: 12, textAlign: 'right' }}>{rank}</span>
        )}
        <span style={{ fontWeight: 600, flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
        <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{right}</span>
      </div>
    </div>
  )
}

// Mini drill-down (Task #54): {entityId} = level 2, ONE ranked list for that source — its
// skill/spell lanes (color = category, no legend — the overlay is too dense for one) plus, when
// the subject is YOU and the preference is on, one line item per pet ranked among them.
//
// The drill lives in the PERSISTED config (`overlays.<kind>.drill`), not component state, so it
// survives a restart exactly like window position does — the user plays pinned with a "damage by
// type" breakdown up and expects to find it there again. Locked mode RENDERS it (read-only,
// static crumb, zero affordances, still fully click-through); only interactive mode can change it.
//
// `null` (or absent) IS LEVEL 1 — the ranked source list — and it means exactly that on the
// Combat tab too (JOS-35). It used to mean "no drill of your own", with the pet preference then
// picking the opening level; that made "picking a different fight undrills" land somewhere
// different on each surface and, with the preference on, left the meter with no way back out at
// all. One spelling, one level, both surfaces.
export type Drill = OverlayDrill

// The row shaping — the flatten, the Slay Undead grouping, the pet nesting, the ranking and the
// re-based bar widths — is all `petRows.meterPanel`. What is duplicated here is only the CHROME
// (colors, bar geometry, the crumb), because this bundle has no MUI theme to read them from.

/**
 * The overlay's per-skill stat run, embedded INSIDE the bar after the name — identical form to
 * the main view's bars (features/combat/combatShared.tsx skillStatText):
 *   `12% miss · 3 - 145dmg`
 * Density here comes from carrying FEWER stats, never from compressing labels (`12%m` / `145/3`
 * are unreadable in a glance-and-forget overlay). The counts the main view puts one click down
 * in its expanded readout live in this row's hover `title` instead — the overlay has no room
 * for an expansion, and in locked (click-through) mode there would be no way to collapse one.
 * The row TOTAL is not here — it owns the right end of the bar.
 */
function skillStat(s: FlatSkill): string {
  // A lane with no damage line of its own — an effect proc counted from its landing emotes, or a
  // spell that only ever resisted. `landEvidence` is the ONE spelling of that row (see its
  // header): the main view's bar renders the identical string, and neither surface manufactures
  // a 100% resist rate out of resists alone.
  if (s.hits === 0) return landEvidence(s).text
  const misses = s.misses ?? 0
  const swings = s.hits + misses
  const parts: string[] = []
  if (misses > 0 && swings > 0) parts.push(`${Math.round((misses / swings) * 100)}% miss`)
  const min = s.min ?? 0
  parts.push(min > 0 && min !== s.max ? `${fmt(min)} - ${fmt(s.max)}dmg` : `${fmt(s.max)}dmg`)
  return parts.join(' · ')
}

/** The labeled stat run for one row, shared by the row title and its children lines. */
function skillFacts(s: FlatSkill): string {
  const land = landEvidence(s)
  // The overlay has no expansion, so the damage-less row's hover carries the BASIS too — where
  // the landings came from, or why a resist rate is being withheld.
  if (s.hits === 0) return `${land.text} · ${land.hint}`
  const misses = s.misses ?? 0
  const swings = s.hits + misses
  const resists = s.resists ?? 0
  const bits = [
    `total ${fmt(s.total)}`,
    `${s.hits} hits`,
    `avg per hit ${fmt(Math.round(s.total / s.hits))}`,
    `${s.crits} crits (${Math.round((s.crits / s.hits) * 100)}% crit)`
  ]
  if (misses > 0) bits.push(`${Math.round((misses / swings) * 100)}% miss (${misses} of ${swings} swings avoided)`)
  if (resists > 0) bits.push(land.resistText)
  const min = s.min ?? 0
  bits.push(min > 0 && min !== s.max ? `damage range ${fmt(min)} - ${fmt(s.max)}` : `damage range ${fmt(s.max)}`)
  return bits.join(' · ')
}

/**
 * The overlay's stand-in for the main view's expanded per-ability readout: the same figures,
 * fully labeled, as the row's hover title (interactive mode — a locked overlay is
 * click-through, so it neither hovers nor could collapse an inline expansion).
 * For the GROUPED Slay Undead row this title also carries what the main view puts in the
 * expansion — the per-weapon-skill split, one labeled line each. The overlay's 18px rows have
 * no room for an inline breakdown and locked mode could never collapse one, so the hover title
 * is where that detail lives here.
 */
function skillTitle(s: SkillRow, catLabel: string): string {
  const head = `${s.name} (${catLabel}) — ${skillFacts(s)}`
  if (!s.children || s.children.length === 0) return head
  const lines = s.children.map((c) => `  ${c.name} — ${skillFacts(c)}`)
  return `${head}\nBy skill:\n${lines.join('\n')}`
}

/** ONE skill/spell lane of the drilled source — category-colored, stats inside the bar, and its
 *  OWN rate at the right end beside its total (petRows.laneDps; owner ruling 2026-08-05). Every
 *  row in a level-2 list therefore ends `rate · total`, exactly like the pet line and like a
 *  level-1 source bar, so the three levels read as one column. */
function SkillLine({ s, activeSec }: { s: SkillRow; activeSec: number }): JSX.Element {
  return (
    <Bar
      color={CAT_COLOR[s.category]}
      accent={CAT_COLOR[s.category]}
      pct={s.pct}
      label={
        <>
          {s.name}
          {/* A lone Slay Undead proc flattens into a row named after its weapon skill, so
              without this tag it is a duplicate of the plain melee row. The category has
              to be readable from the ROW; the overlay has no legend to fall back on.
              A GROUP row is already named "Slay Undead" — tagging it would stutter — and
              instead says how many weapon skills it merges; the split is in its title. */}
          {s.category === 'slay' && !s.children && (
            <span style={{ color: CAT_COLOR.slay, fontWeight: 600 }}> · Slay Undead</span>
          )}
          {s.children && s.children.length > 0 && (
            <span style={{ color: 'rgba(255,255,255,0.62)', fontWeight: 400 }}> · {s.children.length} skills</span>
          )}
          {/* Labeled stats ride inside the bar, dimmed against the name; the right end
              of every row stays the total alone so the list scans as a ranking. */}
          <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.62)', fontWeight: 400 }}>{skillStat(s)}</span>
        </>
      }
      right={`${formatRate(laneDps(s.total, activeSec))} · ${fmt(s.total)}`}
      title={skillTitle(s, CATEGORY_LABEL[s.category])}
    />
  )
}

/**
 * ONE PET, nested inside your breakdown as a single line item ranked among your lanes — the row
 * the overlay simply did not have while it was rendering the engine's merged fold.
 *
 * It wears the PET colour, not a category colour, because it is not a lane of yours (world-model
 * law 4: "pet" is presentation, and the engine's attribution has to survive the layout), and it
 * is labelled with the pet's own display name off its source row, never a coined "Pet" (law 2).
 * Its right-hand text is a rate + total, exactly like a level-1 source bar, because that is what
 * it stands for — a whole source, folded to one line.
 */
function PetLine({ pet, pct, onDrill }: { pet: PetRow; pct: number; onDrill?: () => void }): JSX.Element {
  const swings = pet.hits + pet.misses
  const facts = [`total ${fmt(pet.total)}`, `${pet.hits} hits`]
  if (pet.crits > 0) facts.push(`${pet.crits} crits`)
  if (pet.misses > 0) facts.push(`${Math.round((pet.misses / swings) * 100)}% miss (${pet.misses} of ${swings} swings)`)
  if (pet.resists > 0) facts.push(`${pet.resists} resisted`)
  return (
    <Bar
      color={KIND_COLOR.pet}
      accent={KIND_COLOR.pet}
      pct={pct}
      label={
        <>
          {pet.name}
          <span style={{ color: 'rgba(255,255,255,0.62)', fontWeight: 400 }}> ·pet</span>
        </>
      }
      right={`${formatRate(pet.dps)} · ${fmt(pet.total)}`}
      onClick={onDrill}
      title={`${pet.name} (your pet) — ${facts.join(' · ')}`}
    />
  )
}

/** Nothing to show yet — quiet, and honest about which kind of nothing it is. */
function MeterEmpty({ live }: { live: boolean }): JSX.Element {
  return (
    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '8px 2px' }}>
      {live ? 'Engaging…' : 'Waiting for combat…'}
    </div>
  )
}

/** The level-1 ranked source list: one bar per entity, EVERY entity. There is no row budget any
 *  more (owner feedback 2026-08-05) — the content pane scrolls instead of the meter deciding for
 *  you which of your group is worth seeing. */
function SourceLines({
  sources,
  setDrill
}: {
  sources: SourceView[]
  setDrill: ((d: Drill | null) => void) | null
}): JSX.Element {
  return (
    <>
      {sources.map((e, i) => (
        <Bar
          key={e.id}
          color={KIND_COLOR[e.kind] ?? '#888'}
          pct={e.pct}
          rank={i + 1}
          label={
            <>
              {e.name}
              {e.kind === 'pet' ? ' ·pet' : e.kind === 'member' ? ' ·group' : ''}
            </>
          }
          right={`${formatRate(e.dps)} · ${fmt(e.total)}`}
          onClick={setDrill ? () => setDrill({ entityId: e.id }) : undefined}
        />
      ))}
    </>
  )
}

/** One row of a level-2 list: a lane of the subject's, or a whole pet folded into one line. */
function ownLine(r: OwnRow, activeSec: number, setDrill: ((d: Drill | null) => void) | null): JSX.Element {
  return r.kind === 'pet' ? (
    <PetLine
      key={r.pet.id}
      pet={r.pet}
      pct={r.pct}
      onDrill={setDrill ? () => setDrill({ entityId: r.pet.id }) : undefined}
    />
  ) : (
    <SkillLine key={`${r.skill.category}|${r.skill.name}`} s={r.skill} activeSec={activeSec} />
  )
}

/**
 * The bar body: the source list, or ONE source's breakdown — whichever `petRows.meterPanel` says,
 * from the persisted drill and the shared preference. `setDrill` is null in locked mode: the same
 * levels render, minus every affordance.
 */
export function MeterBars({
  seg,
  scope,
  roster,
  petClaims,
  drill,
  setDrill,
  live
}: {
  seg: SegmentView | undefined
  scope: MeterScope
  roster: RosterSnap
  petClaims: PetClaimsSnap
  drill: Drill | null
  setDrill: ((d: Drill | null) => void) | null
  live: boolean
}): JSX.Element {
  // The SAME preference the Combat tab reads, out of the same localStorage key — one origin, one
  // store, and a 'storage' event when the other window's Preferences tab writes it.
  const [combine] = useCombinePetRow()
  // …and the SAME scope filter, out of the same shared module (features/combat/meterScope). It
  // returns the identical array by reference when nothing is filtered out, so a solo session
  // pays nothing and this memo does not churn.
  const entities = useMemo(() => scopeSources(seg?.entities ?? [], scope, roster), [seg, scope, roster])
  // No drill of our own ⇒ LEVEL 1, the ranked source list — the same thing `null` means on the
  // Combat tab (JOS-35). A drill that resolves to nothing renders level 1 for THIS render only:
  // `meterPanel` never touches the stored value, so a restored `pet:<instanceId>` from a past
  // session, a fight that moved on, or a 'you' that blinks out between fights all re-drill
  // silently the moment the entity is back in the segment.
  const panel = useMemo(
    () => meterPanel(entities, combine, drill?.entityId ?? null),
    [entities, combine, drill]
  )
  const dur = fmtDur(seg?.durationSec ?? 0)

  if (!seg || (panel.level === 1 && panel.sources.length === 0)) return <MeterEmpty live={live} />

  if (panel.level === 2) {
    // Back goes to the row this one was opened FROM — a nested pet's owner (your breakdown), else
    // all the way out to the source list. It is offered at EVERY level-2 view there is: the
    // meter no longer opens drilled, so there is no view that is its own home and no reason to
    // withhold the way out (the `canLeave` gate this replaces is JOS-35's zoom-out regression).
    const out: Drill | null = panel.parent ? { entityId: panel.parent.id } : null
    return (
      <MeterCrumb name={panel.subject.name} dur={dur} onBack={setDrill ? () => setDrill(out) : null}>
        {panel.rows.map((r) => ownLine(r, seg.activeSec, setDrill))}
      </MeterCrumb>
    )
  }

  return (
    <MeterCrumb name={null} dur={dur} onBack={null}>
      {/* "IS THIS YOURS?" (JOS-47) — ABOVE the bars, at level 1 only. This window is where the
          report came from ("Dps overlay meter is not showing my pet dps"), so it is where the
          question has to be answerable; the drilled level is a breakdown of ONE source and a
          question about a different entity has no business inside it. */}
      <PetClaimOffer petClaims={petClaims} interactive={setDrill !== null} />
      <SourceLines sources={panel.sources} setDrill={setDrill} />
    </MeterCrumb>
  )
}