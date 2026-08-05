# Planner v2 — owner feedback round, 2026-08-05

Status: DESIGN, waves not started. Author: planning session (Fable), 2026-08-05.
Builds ON `exaltation-planner.md` (rules R1–R6, decisions D1–D8, the shipped
v0.4.0 planner) — read that first; nothing there is restated except where this
round OVERTURNS it. Constrained by `AGENTS.md` as usual: 400-line ceiling, one
nowrap toolbar row, search law, world-model law 1 (empty = unknown, never
none), law 12 (renames are knowledge, never fuzzy).

## 0. What this round is, in one paragraph

The owner used the shipped planner in anger and came back with a list. Two
themes: **trust** (the class trio is a stale one-time seed; Kunark epics leak
through the era filter; summoned/GM items don't belong in the browser at all)
and **scannability** (grouping is hardcoded to effect-name; focus effects
should self-organize into "best Improved Healing, best Burning Affliction…";
every proc/worn row should say what the effect *does* without a wiki trip; a
host item should be browsable slot-by-slot like the in-game item window).
Plus: Board becomes **Inventory** and learns to fill itself from an inventory
dump, and the module grows a collapsible teacher for the exaltation rules.

## 1. Corrections of record (owner, 2026-08-05)

- The inferred trio can be WRONG and there is no way to say so in the planner
  (owner's live case: shows `rog pal ber`, truth is `pal enc mnk` after a
  loadout switch + Sky clear). Provenance exists (`classCombo.ts`
  `user > who > inferred`) — the planner just never surfaces or rebinds it
  (`PlannerView.tsx` seeds once at set creation, then the set's `classes`
  array is orphaned).
- Ragebringer and the Beastlord epic render CLEAN (no era chip) with the
  era filter ON. Root cause measured: `shared/planner/era.ts` maps
  `epics: 'classic'` / `epicquests: 'classic'`, and quest-reward epics have
  zero droppers, so the zone layer (R6's layer 1) never fires. Epics are a
  KUNARK system; 188 pages carry those two tags.
- Summoned items (mage-conjured) appear as donors. No effect can be pulled
  off a summoned item (owner assertion — encode as R7 after a one-source
  verification, same bar as R1–R6).
- GM-event items appear. They should not.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| V1 | `epics`/`epicquests` eraTag → **kunark**, one line in `era.ts` + test pinning Ragebringer out-of-era | Epics shipped with Kunark; the tag IS the era signal the zone layer can't provide for dropperless quest rewards |
| V2 | Class trio becomes a **binding with provenance**, not a seed: new sets follow live detection until the user edits; an edited set is pinned (`provenance: user`) and shows a one-click "detected: X Y Z — apply" chip when detection disagrees | The stale-seed bug class disappears structurally instead of being patched with a refresh button |
| V3 | The class picker is the **Sky tracker's chip multi-select autocomplete**, extracted into a shared component first (it is 9 inline MUI lines in `PoskyView.tsx`, the only Autocomplete in the renderer), capped at `MAX_COMBO_SLOTS` | One idiom for "pick several from a closed list" everywhere; the extraction is its own commit so Posky provably does not change |
| V4 | Grouping becomes a **declared model, not a fold**: `groupBy: effect \| slot \| socket \| era` (persisted per socket type in the existing `DonorView` object), rendered as header rows in the SAME two-variant windowed row union (headers are 44px rows too — `useWindowedRows` survives) | The one hardcoded `groupByEffect()` is the ceiling on every request in this round; headers-as-rows keeps the windowing law |
| V5 | **Focus family + tier are parsed once, in main, at index build** (`effectIndex.ts`): `Improved Healing III` → `{family: 'Improved Healing', tier: 3}`; focus default view groups by family, sorts tier-desc, crowns the best row per family | The Roman numeral is the ONLY magnitude signal in the corpus (no percent field exists anywhere — measured); parsing at the boundary, once, is law 2 |
| V6 | **Effect one-liners join `spells.json` by case-folded name at index build** (94.4% of 1,523 effect rows match) and ship on `PlannerDonor` as 2–3 new fields (target/type/duration composed renderer-side); misses render nothing, never a guess | The join is measured and cheap; the donor payload is already a one-shot cached IPC fetch. Damage/heal magnitudes are NOT in the corpus — that gap belongs to the additive layer (§4), not to synthesis |
| V7 | Board → **Inventory**. Auto-fill: `InventoryDump`'s closed `EQUIP_LOCATIONS` set joins the planner's `EquipSlot` via a **hand-authored table** (law 12 — `Fingers` vs `FINGER`; `Any Slot` maps to nothing), fills each cell's host from what is equipped, hand-picked hosts win over auto-fill, and an instructions card teaches `/output inventory` (the discovery/watch/reload plumbing already exists) | The shared-outputs header explicitly demands the hand join; no renderer code consumes `InventoryDump` yet, so this is greenfield with the parser already paid for |
| V8 | **Host slot view**: selecting a host shows its unlocked sockets R1-style (Focus @+1 … Proc @+4) with current plan contents; clicking a socket opens the effect browser pre-filtered to that socket + the host's slot/classes | The item-window mental model from the game (owner's screenshot); it is a FILTER PRESET over the existing browser, not a second browser |
| V9 | **Exclusions are knowledge, not heuristics**: a committed curated list (additive layer §4) seeds `summoned` and `gm-event` flags; the `Summoned:` name prefix is the only automatic rule (it is the item's own name, not an inference). Excluded items are dropped from the DONOR index only — they stay in item lookup | 8 name-prefix hits are safe; everything else (GM one-offs) is unknowable from the corpus and guessing violates law 1 |
| V10 | The **explainer** is a collapsible card above the browser rendering R1–R6 from `rules.ts` exports (never restating numbers), dismissed state persisted, re-opened from a permanent `?` in the toolbar | Teaching the system was always §5's intent; dismiss-without-loss is the owner's explicit ask |
| V11 | Bard instrument grouping is **deferred to the additive layer**: no instrument field exists (measured: 9 incidental mentions, all tradeskill components). When the layer carries `instrument: wind \| string \| brass \| percussion \| singing`, V4's grouping model picks it up as one more axis for free | Building the axis now with no data would render empty groups; the grouping model is designed so the data's arrival is the whole diff |

## 3. Waves (post-v0.6.1; order is dependency order, not priority)

- **W-A (trust, small, ships first)**: V1 era fix + test; V9 `Summoned:`
  prefix exclusion + the additive-layer file stub with the first curated
  entries (BL epic, Ragebringer already covered by V1; GM list starts empty);
  R7 verification note in `exaltation-planner.md` §1.
- **W-B (class binding)**: V3 extraction commit, then V2 in the planner —
  binding semantics in `usePlans.ts` (a `classesProvenance` field per set),
  the disagree-chip, `ClassPickerDialog` replaced by the shared autocomplete.
- **W-C (grouping engine)**: V4 model + V5 focus families. Rewrites
  `flatten()`/`groupByEffect()`; `EffectFilterBar` gains the group-by
  control; per-socket defaults: focus → family, everything else → effect.
  The 400-line ceiling WILL bite `EffectBrowser.tsx` — plan the split
  (grouping model → `plannerGroups.ts`) before writing, not after.
- **W-D (one-liners)**: V6 fields through `effectIndex.ts` → `PlannerDonor`
  → a muted second line… no — SAME 44px row, appended muted inline text after
  the effect name (windowing law); truncated with title-attr overflow.
- **W-E (inventory)**: V7 rename + join table + auto-fill + instructions
  card + manual override precedence.
- **W-F (host view)**: V8 socket pane + browser filter presets.
- **W-G (explainer)**: V10.
- **W-H (additive layer, owner-gated)**: §4 built out — only on the owner's
  explicit go.

## 4. The additive item-knowledge layer (and the agentic research loop)

The corpus keeps proving the same shape of gap: facts that exist in the world
but not in any parseable wiki field (focus percentages, damage/heal magnitudes,
bard instrument types, GM-event provenance, summoned-item status beyond the
name prefix). The owner's proposal — an agentic loop that researches known
items one at a time and writes STRUCTURED findings — fits the codebase's
existing overlay pattern (messageOverlay): a committed
`src/main/data/itemsResearch.json` keyed by the same `itemKey()`, carrying
only fields the scrape can never produce, each with `{value, source, checkedAt}`
provenance, merged in `itemsDb.ts` AFTER the wiki record so a rescrape stays
idempotent and the two layers never fight. `effectIndex.ts` reads the merged
view and every consumer above it is unchanged.

Status: **shape agreed, loop NOT commissioned** (owner: "not sure we're
reaching for this yet"). W-A creates the file and the merge point with curated
hand entries only — which is exactly the schema the loop would later fill, so
commissioning it becomes a data decision, not a code change.

## 5. Open questions for the owner

- Q1 — V2 default: should EXISTING sets (created before this round) adopt
  follow-detection, or stay pinned as-authored? (Plan assumes: stay pinned,
  chip offers the update.)
- Q2 — R7 verification source: FAQ/patch notes say summoned items can't
  donate, or is it owner testing? One citation and it graduates to the rules.
- Q3 — GM-event curation: is there a wiki category page worth scraping once
  (`Category:GM Event Items` or similar), or is this purely hand-curated?
