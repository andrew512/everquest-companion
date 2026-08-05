// PET NESTING — a PRESENTATION regrouping of the snapshot's existing source rows. No JSX, no
// MUI, no engine involvement: the engine hands us YOU and each PET as separate, authoritative
// `SourceView`s and this module only decides how they are LAID OUT.
//
// IT IS *THE* METER, NOT ONE METER'S HELPER (owner ruling, 2026-08-04): "the overlay is using a
// different source of data — combat has a breakdown with pet appropriately merged and overlay
// does not — this should not be possible, they should be using the same underlying api and
// abstraction — if not, collapse." They were two folds giving two answers: the Combat tab built
// its rows here, while the floating overlay asked the ENGINE for a `combinePets` fold (a
// synthetic "You +pets" source with namespaced skill lanes and no pet line at all). That engine
// fold is now DELETED — not deprecated, deleted, along with its parameter — and `meterPanel`
// below is the single row builder every damage-meter surface calls: the Combat tab's panel, the
// floating overlay, the Overview card. A second builder has nowhere left to live.
//
// MUI-FREE AND JSX-FREE ON PURPOSE. The overlay is its own renderer entry (overlay.html) with no
// theme and no component library, so the shared abstraction has to be plain TS to be importable
// from both bundles. Keep it that way: colors, bar chrome and crumbs stay in each surface.
//
// WHY (owner direction, 2026-08-03): the game is mostly played solo, so "your damage" and "the
// pet's damage" are two rows of a two-row meter and the interesting list is one level down. The
// default view is therefore YOUR breakdown with the pet as ONE line item inside it, drillable to
// the pet's own skills. A preference ('Show your pet inside your damage') turns the nesting off
// and restores the separate sources.
//
// THE PREFERENCE IS THE ZOOM (owner direction, 2026-08-04). Layout and default LEVEL are one
// choice, not two — see `defaultDrill` below. It used to be two: a second persisted bit
// (`eq.combat.drill`) decided the opening level on its own, so the preference OFF still opened
// on your breakdown (level 2, pet-less) instead of the fully-zoomed-out source list the owner
// asked for, and backing out once quietly re-taught the app to open zoomed out with the
// preference ON. That bit is retired; this module owns the whole rule now.
//
// HONESTY (world-model law 4 — "pet" is presentation, never a data-model class; law 5 —
// aggregates lie, derive from identities):
//   - The pet row is labelled with the pet's REAL display name off its own source row. It is
//     never a coined label ("Pet"), and it is never folded into one of YOUR skill lanes: your
//     per-skill numbers stay exactly the engine's, and the pet's total sits BESIDE them as its
//     own row. Nothing here adds a point of pet damage to a row of yours.
//   - One line item that DRILLS is what the owner asked for, not a merged lane list. The engine's
//     retired `combinePets` fold did the latter, which is why it is gone rather than reused.
//   - `total` here is self + nested pets, which is exactly `SegmentView.outTotal` whenever the
//     only outgoing sources are you and your pets (they are, by construction — the aggregate
//     keys outgoing damage as 'you' or 'pet:<id>'). Every surface that shows a combined headline
//     reads `outTotal`, so the two can't drift.

import { flattenSkills, type Drill, type SkillRow } from './dashboardData'
import type { SourceView } from '@shared/combat'

/** The synthetic line item that stands for ONE pet inside your breakdown. */
export interface PetRow {
  /** `SourceView.id` of the pet — what a drill hands `setDrill({ kind: 'entity', … })`. */
  id: string
  /** the pet's real display name, straight off its source row. */
  name: string
  total: number
  dps: number
  hits: number
  crits: number
  misses: number
  resists: number
}

/**
 * One row of the combined "your damage" list: either a real skill lane of YOURS, or the
 * synthetic aggregate for one pet. `total`/`pct` are lifted to the union so the two kinds sort
 * and size against each other without the caller having to know which it is holding.
 */
export type OwnRow =
  | { kind: 'skill'; total: number; pct: number; skill: SkillRow }
  | { kind: 'pet'; total: number; pct: number; pet: PetRow }

export interface OwnBreakdown {
  /** your source row, or null when this segment has none (a segment with no outgoing damage). */
  self: SourceView | null
  /** the pet sources nested into `rows` — empty when the preference is off, or petless. */
  pets: SourceView[]
  /** your skill lanes + one row per nested pet, ranked by damage desc. */
  rows: OwnRow[]
  /** self + nested pets. Equals `SegmentView.outTotal` for the combined case (see the header). */
  total: number
}

/** Your own source row. Keyed on `kind`, never on the aggregate's 'you' key — the id is the
 *  engine's business and the kind is the model's. */
export function selfSource(entities: SourceView[]): SourceView | null {
  return entities.find((e) => e.kind === 'you') ?? null
}

/** Every pet source in this segment (there is usually exactly one — the single-pet invariant
 *  retires the prior pet — but a segment spanning two pets legitimately carries both). */
export function petSources(entities: SourceView[]): SourceView[] {
  return entities.filter((e) => e.kind === 'pet')
}

/**
 * THE DEFAULT ZOOM — which level the dashboard OPENS on, decided by the same preference that
 * decides the pet's layout (owner direction, 2026-08-04):
 *
 *   ON  ⇒ your breakdown (level 2), with each pet nested inside it as one line item ranked
 *         among your skills. Clicking the pet line drills to JUST that pet; Back returns to
 *         this combined view (the crumb spells the hierarchy out).
 *   OFF ⇒ fully zoomed out (level 1): one bar per source — you, your pet. Clicking the pet bar
 *         drills to the pet's skills, clicking yours drills to your skills with NO pet line
 *         (nothing is nested while the preference is off); Back returns to the two-bar list.
 *
 * Both directions of the loop (in → out → in) are ordinary navigation and DO NOT write the
 * preference — a fight you happened to back out of must not redefine what the next one opens on.
 *
 * Takes the self row's ID rather than the row (or the whole source list) on purpose: every
 * snapshot tick rebuilds those objects, and the caller memoizes this on a value that only
 * changes when the answer can — so a live fight doesn't hand the view a new drill object every
 * second. `null` (a segment with no outgoing damage of yours) has no "your breakdown" to open,
 * so the source list is the only honest default there whatever the preference says.
 *
 * TWO SPELLINGS, ONE RULE. The Combat tab's drill is a union that can also name a MOB
 * (`dashboardData.Drill`); the overlay's persisted drill is the bare `{ entityId }` of
 * `OverlayConfig`. `defaultEntityId` is the rule itself, and each surface wraps it in its own
 * token — so the two can never open on different levels for the same preference.
 */
export function defaultEntityId(selfId: string | null, combine: boolean): string | null {
  return combine ? selfId : null
}

/** `defaultEntityId` in the Combat tab's drill spelling. */
export function defaultDrill(selfId: string | null, combine: boolean): Drill | null {
  const id = defaultEntityId(selfId, combine)
  return id ? { kind: 'entity', entityId: id } : null
}

function toPetRow(p: SourceView): PetRow {
  return {
    id: p.id,
    name: p.name,
    total: p.total,
    dps: p.dps,
    hits: p.hits,
    crits: p.crits,
    misses: p.misses,
    resists: p.resists
  }
}

function rowLabel(r: OwnRow): string {
  return r.kind === 'pet' ? r.pet.name : r.skill.name
}

/**
 * ONE source's flat skill list with `pets` nested into it as line items, ranked together.
 * Pass no pets and this is exactly `flattenSkills` — which is what a drill into the PET itself
 * (or into any non-self source) uses, so there is one row builder for every level-2 list.
 *
 * Bar widths are re-based on the MERGED maximum — the pet is often the largest row, and a list
 * where two rows both render full-width would be lying about the ranking. A grouped row's
 * children keep their own (group-relative) pct: that expansion is its own ranking.
 */
export function nestedRows(source: SourceView | null, pets: SourceView[]): OwnRow[] {
  const skills: OwnRow[] = source
    ? flattenSkills(source).map((s) => ({ kind: 'skill' as const, total: s.total, pct: 0, skill: s }))
    : []
  const petRows: OwnRow[] = pets.map((p) => ({ kind: 'pet' as const, total: p.total, pct: 0, pet: toPetRow(p) }))
  const merged = [...skills, ...petRows].sort((a, b) => b.total - a.total || rowLabel(a).localeCompare(rowLabel(b)))
  const max = Math.max(1, ...merged.map((r) => r.total))
  return merged.map((r) => {
    const pct = (r.total / max) * 100
    return r.kind === 'skill' ? { ...r, pct, skill: { ...r.skill, pct } } : { ...r, pct }
  })
}

/**
 * YOUR breakdown for a whole segment: your skill lanes with every pet nested in. `combine` off
 * ⇒ pets are left out entirely (they stay separate source rows at level 1, exactly as today).
 */
export function ownBreakdown(entities: SourceView[], combine: boolean): OwnBreakdown {
  const self = selfSource(entities)
  const pets = combine ? petSources(entities) : []
  return {
    self,
    pets,
    rows: nestedRows(self, pets),
    total: (self?.total ?? 0) + pets.reduce((n, p) => n + p.total, 0)
  }
}

/**
 * WHAT ONE DAMAGE METER IS SHOWING — the whole answer, for every surface that shows one.
 *
 * Level 1 is the ranked source list (you, your pets, and in Incoming the enemies). Level 2 is ONE
 * source's breakdown: its skill lanes, with the pets nested in as line items when the subject is
 * YOU and the preference is on. `parent` is the source the subject is currently being shown as a
 * line item OF — non-null only for a nested pet — and it is what lets a Back button return to the
 * view the pet was clicked FROM instead of pretending the pet was ever a top-level bar.
 *
 * A drill id that resolves to nothing (a `pet:<instanceId>` from a past session, a fight that
 * moved on, a 'you' that blinks out between fights) yields LEVEL 1 for this render — the caller's
 * stored value is never touched, so the drill re-applies the moment the entity is back.
 */
export type MeterPanel =
  | { level: 1; sources: SourceView[] }
  | {
      level: 2
      subject: SourceView
      /** the source `subject` is nested inside right now (a pet's owner), else null. */
      parent: SourceView | null
      /** the pets nested into `rows` — empty unless `subject` is you and the preference is on. */
      pets: SourceView[]
      rows: OwnRow[]
    }

/**
 * THE ROW BUILDER. Both damage meters call exactly this, with exactly their own drill id: the
 * Combat tab passes `drill.kind === 'entity' ? drill.entityId : null`, the overlay passes its
 * persisted `drill?.entityId ?? defaultEntityId(...)`. Everything downstream — nesting, ranking,
 * bar widths, the pet's real name, the parent for the crumb — is decided here, once.
 */
export function meterPanel(entities: SourceView[], combine: boolean, entityId: string | null): MeterPanel {
  const subject = entityId === null ? undefined : entities.find((e) => e.id === entityId)
  if (!subject) return { level: 1, sources: entities }
  // Pets nest into YOUR row only: a pet inside a pet would be a fiction, and an enemy's row in
  // the Incoming direction has no pets of yours in it at all.
  const nestable = combine ? petSources(entities) : []
  const pets = subject.kind === 'you' ? nestable : []
  const parent = subject.kind === 'pet' && nestable.some((p) => p.id === subject.id) ? selfSource(entities) : null
  return { level: 2, subject, parent, pets, rows: nestedRows(subject, pets) }
}
