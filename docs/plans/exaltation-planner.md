# Exaltation planner (BiS sets) — design

Status: DESIGN. Author: planning session (Fable), 2026-08-04.
Constrained by `AGENTS.md` — wave model, lint ceilings, world-model laws (esp. 1
"messages over inference", 2 "canonicalize at boundaries", 12 "renames are
knowledge, never fuzzy"), UI conventions ("state, never process"). Read that
first; this document only adds what is specific to the planner.

---

## 0. What we are building, in one paragraph

A **Planner** pane where the user assembles named **exaltation sets** (multiple
per character): pick a target class trio (defaulting to the inferred current
combo), then for each equipment slot plan which effects — weapon procs, worn
effects like Improved Healing III, focus effects, clickies — to socket, chosen
from a **class-filtered effect browser** built from the committed wiki item DB.
Every donor item shows **where it drops** (mob → zone, quest, crafted), **what
tier it must be merged to** before its effect extracts (+1 focus / +2 click /
+3 worn / +4 proc), and **how far along you already are** (inventory dump
counts + observed merge tiers + loot history — decoration, never a
prerequisite). A **farm rollup** groups everything a set still needs by zone,
so the output is literally "here is where to go and what to camp."

## 1. The rules of the game (verified 2026-08-04)

Sources: eqlwiki.com/Exaltations + Item_Upgrade_System, eqlegendstools.com,
official 7/14/2026 patch notes (which renamed the Augmentation tab to
Exaltation). The mechanics research block at `src/main/itemLookupParse.ts:62`
and the encoded rules at `src/shared/itemStats.ts:361-427` already agree with
all of this; the planner REUSES those exports and never re-declares a number.

- R1 — Slot unlocks by item upgrade tier: Ornamentation @+0, **Focus @+1,
  Click @+2, Worn @+3, Proc @+4** (`EXALTATION_SLOT_TYPES`,
  `unlockedExaltationSlots`). One socket of each type per item. The same
  threshold is the EXTRACTION threshold on the donor side: a proc donor must
  be merged to +4 before its proc can be pulled.
- R2 — Transfer restrictions: destination must share the donor's **equipment
  slot** (2H → PRIMARY-only; weapon procs weapon-to-weapon) and at least one
  **class**; socketing NARROWS the host item's class list to the overlap.
  Wide-class donors are therefore the valuable ones.
- R3 — **Haste cannot travel as an exaltation** (explicit FAQ rule). Worn
  haste items are still BiS *as worn items*; the planner flags haste effects
  as non-transferable rather than hiding them.
- R4 — Cost is merge XP, not currency: `expToNextTier(t) = 2^t`, so +4 costs
  15 cumulative XP. Difficulty tiers multiply a copy's merge value (D0=1,
  D1=2, D2=4, D3=8, D4=16) and D-tier drops arrive pre-plussed. "≈15 D0
  copies, or 1 D4 copy" is the honest farm estimate shape.
- R5 — Sockets persist across loadout swaps; no documented failure chance;
  extract/insert cost undocumented (assumed free). Ornamentation tokens are
  not yet in game — the planner ignores the cosmetic slot entirely.
- R6 — Era scoping is **by construction**: the item/mob DBs are scraped from
  eqlwiki, which documents only EQL (classic era, level 50, Fear/Hate/Sky).
  No era field is added anywhere; Kunark arrives by rescrape, not by flag.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Effect index is built in MAIN** (items.json already inlined there) and served over ONE new IPC call; the renderer joins drop sources from its local mobs.json | items.json is 7.14 MB — importing it into the renderer doubles the bundle; the effect-bearing subset (~1.6k items) is a few hundred KB over IPC, fetched once and cached (§4) |
| D2 | **`kind:'combat'` IS the proc family.** Measured: proc 0, combat 453 — wiki pages spell procs `Combat Effect:` | §4.1; a proc planner that filters `kind==='proc'` shows nothing |
| D3 | Slot & class token cleanup is a **hand-authored normalization table** in shared code, unit-tested (`FINGERS→FINGER`, `SECONDAY→SECONDARY`, `ALL except MNK` → 15 classes, …) — never fuzzy matching | Law 12; the dirt is enumerable (measured: ~20 variant tokens) |
| D4 | Sets persist **per character** in `ProgressState` under a new optional key `exaltPlans` | Character-scoped like kills/loot; private by default under the share schema (not whitelisted); additive key — old stores load unchanged (readers default), no migration transform needed, pinned by a store fixture test |
| D5 | Each set carries its own target classes (≤3, `ClassAbbr[]`), **defaulting to the current inferred combo** (`resolvedClasses(current)`); editable via the existing ClassPicker chip pattern | The user plans for loadouts they don't currently run; combos are the compatibility filter (R2) |
| D6 | Inventory dump / loot history / observed item tiers are **decoration** (have-badges, tier meters), never a gate — the planner is fully functional with zero dumps | Owner requirement: "compatible with the inventory dump, but not rely on it" |
| D7 | Validation is a **pure shared module** (node-tested, relative imports per the mobSearch precedent): slot compatibility, class overlap + resulting narrowed class list, haste exclusion, extraction tier, merge-XP arithmetic | Same testing law as every engine in this repo |
| D8 | The pane ships in the standard shell: `View` union + `KNOWN_VIEWS` + NavDrawer row + `features/planner/` | `appViews.ts:31` law — the two lists edit together |

## 3. Data model

### 3.1 Shared types — `src/shared/planner/types.ts` (new)

```ts
// Canonical equipment slots (normalized from the dirty wiki tokens).
export type EquipSlot =
  | 'PRIMARY' | 'SECONDARY' | 'RANGE' | 'AMMO'
  | 'HEAD' | 'FACE' | 'EAR' | 'NECK' | 'SHOULDERS' | 'BACK'
  | 'CHEST' | 'ARMS' | 'WRIST' | 'HANDS' | 'FINGER'
  | 'WAIST' | 'LEGS' | 'FEET' | 'CHARM'

export type SocketType = 'focus' | 'click' | 'worn' | 'proc'   // ornamentation ignored (R5)

// One effect as it exists on one donor item (denormalized row served by main).
export interface PlannerDonor {
  key: string                 // itemKey(name)
  name: string
  iconId?: number
  slots: EquipSlot[]          // normalized; [] = non-equippable (held/quest oddities)
  classes: ClassAbbr[]        // normalized; empty = unknown, 16 = ALL
  effect: string              // effect name as written ("Improved Healing III")
  detail?: string
  socket: SocketType          // combat→proc folded here (D2)
  tierRequired: 1 | 2 | 3 | 4 // from EXALTATION_SLOT_TYPES (R1)
  hasteLocked: boolean        // R3 — matched from the effect name/detail
  quest: boolean
  playerCrafted: boolean
  reqLevel?: number
}

// A planned socket inside a set.
export interface PlanSocket {
  effect: string
  donorKey: string            // which donor item the user chose to farm
}

export interface PlanSlot {
  hostKey?: string            // optional host item (itemKey)
  hostName?: string
  sockets: Partial<Record<SocketType, PlanSocket>>
}

export interface ExaltPlan {
  id: string                  // crypto.randomUUID()
  name: string
  classes: ClassAbbr[]        // target trio (D5); may be 1-3
  createdAt: number
  updatedAt: number
  slots: Partial<Record<EquipSlot, PlanSlot>>
}
```

`ProgressState.exaltPlans?: ExaltPlan[]` (D4). Slot identity note: FINGER/EAR/
WRIST are worn in pairs in game, but compatibility is per-slot-TYPE (R2), so
the plan models one PlanSlot per slot type; a user wanting two ring plans makes
two entries via a second set or the same slot in another set — deliberate v1
simplification, recorded in §8 open questions.

### 3.2 Normalization — `src/shared/planner/normalize.ts` (new)

- `normalizeSlotTokens(slot?: string): EquipSlot[]` — splits the space-joined
  verbatim string, maps through the hand-authored variant table, drops noise
  tokens (`BACK,`, `/`). Unknown tokens are dropped AND surfaced via a
  `warnings` return for the test to pin the full variant inventory.
- `normalizeClasses(classes?: string[]): ClassAbbr[]` — `ALL` → all 16;
  `ALL except X Y` prose → complement; `NONE`/`None` → `[]`; unknown tokens
  dropped. The wiki's 3-letter tokens already match `ClassAbbr`.
- `socketTypeOf(kind: ItemEffectKind): SocketType | null` — combat→proc,
  effect→null-unless-detail-disambiguates (v1: `'effect'` rows are EXCLUDED
  and counted; measured 131 of them — revisit if the count says otherwise).
- `isHasteEffect(name, detail?)` — the R3 lock.

### 3.3 Validation — `src/shared/planner/rules.ts` (new)

Pure functions over the types above + `itemStats.ts` exports:

- `socketCompatibility(donor, hostSlots, planClasses)` →
  `{ok} | {ok:false, reason: 'slot'|'class'|'haste'}`.
- `narrowedClasses(hostClasses, donorClasses)` — the R2 side effect, shown in
  the UI whenever a socket is planned onto a host.
- `extractionCost(tierRequired)` → `{xp, d0Copies, d4Copies}` from
  `expToNextTier` (R4) — d0Copies = 2^tier − 1, d4 arithmetic uses the ×16
  multiplier and pre-plussed drops (encode the worked example in the test).
- `planWarnings(plan, donorsByKey)` — set-level lint: unreachable donors
  (class-incompatible with the trio), haste locks, missing hosts.

## 4. Indices and IPC

### 4.1 Effect index (main) — `src/main/planner/effectIndex.ts` (new)

Pure builder `buildPlannerDonors(file: ItemDbFile): PlannerDonor[]` — walk
`items.json` entries, keep items whose `stats.effects` is non-empty, emit one
`PlannerDonor` per (item, effect) after normalization. Skip alias keys
(`|itemname` duplicates) by page identity. Node-tested against the REAL
committed items.json with floor assertions (≥400 proc donors, ≥100 worn, ≥140
focus, ≥800 click — floors, never today's exact counts).

IPC: `IPC.plannerDonors = 'planner:donors'` → handler in a new
`src/main/ipc/planner.ts` (registered in `ipc/index.ts`), built lazily on
first call and memoized (module-scope let, like the itemLookup index). Preload:
`window.eq.plannerDonors(): Promise<PlannerDonor[]>`.

Item search for host picking reuses the EXISTING per-name lookup
(`window.eq.lookupItem`) plus a new lightweight
`IPC.plannerSearchItems = 'planner:searchItems'` (substring over the db index
keys, top 50, returns `{key, name, slots, classes, iconId}`) — same handler
file.

### 4.2 Source index (renderer) — `features/planner/sourceIndex.ts` (new)

mobs.json is already in the renderer bundle. Lazy singleton (mobSearch
precedent, `mobSearch.ts:59`): first use builds
`Map<itemKey, PlannerSource[]>` from `MobEntry.drops` —
`{mob, mobPage, levelText, zones}` — ~33k links, ~30 ms, built off-path.
Quest rewards and crafted flags come with the donor row itself (items.json
carries `questUses`/`playerCrafted`); drop links come from this index; an item
with neither renders an honest "no known source" chip (law 1).

### 4.3 Progress join (renderer) — decoration per D6

- Have-count: `ProgressState.inventory` HeldCounts (name-lowercased — same
  `itemKey` family) via the existing `useProgress`.
- Observed merge tier: `useItemTiers()` / `observedTierOf` — "your Ghoulbane
  is +2 of the +4 needed".
- Loot history: `LootSnap` for "you looted one on 7/30".

## 5. UX / UI

### 5.1 Shell

New view `'planner'` — nav label **Planner**, icon `AutoAwesome` (socketing
sparkle), row placed after Loot. `features/planner/PlannerView.tsx`.

Toolbar (one `nowrap` row, controls never shrink): **set switcher** (chip per
set + "+ New set"; rename/duplicate/delete behind a small menu), the set's
**class trio** (compact chips, click opens the ClassPicker-pattern editor),
and a **mode toggle**: `Effects | Board | Farm`.

### 5.2 Effects mode — the browser (the heart of the feature)

Filter bar: socket-type toggle (Proc/Worn/Focus/Click — Proc default),
search input (instant echo, `useDeferredValue` filter, precomputed lowercase
`searchKey` — the standing search law), equip-slot filter, and a
**"usable by <trio>" filter ON by default** (donor classes ∩ set classes ≠ ∅).

Rows grouped BY EFFECT (one effect, N donors), windowed via
`useWindowedRows`. An effect row shows: name, socket-type chip, donor count,
haste-lock chip when R3 applies. Expanding lists donors: icon, name,
slots, class chips (trio-compatible ones lit), tier-required chip (`+4 to
extract`), source summary ("Ghoulbane — froglok shin lord, Upper Guk" / quest
/ crafted / "no known source"), and the progress badges (§4.3). Donor click →
the existing `ItemWindow` popup. **Add to set** button per donor: picks the
target equip slot (donor's slots, one-click when unambiguous) and writes the
`PlanSocket`.

### 5.3 Board mode — the set at a glance

Equipment grid (the 19 canonical slots, character-sheet order), each cell a
card: host item (optional; "pick host" opens the search over
`plannerSearchItems` filtered to slot+trio), and up to four socket lines
(focus/click/worn/proc) each showing planned effect + donor + a state chip —
`planned` / `have donor` / `donor +N/+M` / `ready to extract`, derived from
§4.3 joins, all law-1 honest (observed tier only, never a guessed one).
Narrowed-class readout on the host line when sockets are planned (R2).
Empty cells render quiet, not as errors.

### 5.4 Farm mode — where to go

The rollup the whole feature exists for: every planned donor not yet
satisfied, grouped by **zone** (via the source index; multi-zone donors listed
under each with a "also drops in…" note), each row: donor, effect it carries,
mob to camp, tier math ("needs +4 ≈ 15 D0 or 1 D4 copy" via
`extractionCost`), progress badges. Zones sort by how many needed donors they
hold — "go to Lower Guk, it feeds 4 sockets" falls out naturally. Questable
and crafted donors group under their own headings after the zones.

### 5.5 File layout (lint ceilings shape this)

```
src/shared/planner/{types.ts, normalize.ts, rules.ts}
src/main/planner/effectIndex.ts
src/main/ipc/planner.ts
src/renderer/src/features/planner/
  PlannerView.tsx      — shell + toolbar + mode switch
  EffectBrowser.tsx    — §5.2
  PlanBoard.tsx        — §5.3
  FarmList.tsx         — §5.4
  plannerData.ts       — donor fetch/caching hook, filter model, progress joins
  sourceIndex.ts       — §4.2
  usePlans.ts          — plan CRUD over IPC, set selection (localStorage ui pref)
tests/{plannerNormalize,plannerRules,plannerEffectIndex,plannerStore}.test.mts
```

## 6. Persistence & IPC summary

- `store.ts`: `getExaltPlans(charId)` / `setExaltPlans(charId, plans)` on
  `ProgressState.exaltPlans` (D4). Whole-array writes (plans are small);
  main re-validates shape (ids strings, classes via `isClassAbbr`) — renderer
  input is never trusted (IPC convention).
- New channels in `shared/ipc.ts`: `plannerDonors`, `plannerSearchItems`,
  `plannerGetPlans`, `plannerSetPlans`.
- Selected set id + mode + filters: renderer `localStorage` ui prefs
  (`eq.planner.*`), machine-class, not shared.

## 7. What the planner never does (scope fences)

- No damage simulation / stat-weight math. BiS here means "the effects you
  chose, sourced" — the user is the judge of best. (Future: PPM data from the
  proc-analytics module could rank proc donors; out of scope v1.)
- No ornamentation (R5), no augment-era leftovers, no expansion flag (R6).
- No equipped-slot inference from the inventory dump (Location column is
  discarded today; a future parser extension could add "currently equipped"
  badges — §8).
- Never blocks on network: everything renders from committed DBs; the wiki
  fallback only enriches ItemWindow popups as it already does.

## 8. Open questions (owner)

1. Paired slots (two rings/ears/wrists): v1 plans one per slot type. Worth a
   `FINGER×2` cell pair in Board mode later?
2. Should "add to set" from the Loot pane exist (deep link nonce à la
   `openMob`)? Cheap once the pane exists; not in v1 waves.
3. Inventory Location column (equipped-vs-bag) — extend `parseInventory` in a
   later wave to power an "equipped now" board overlay?

## 9. Wave plan (Opus executors, disjoint ownership)

- **Wave 1 — A (foundations, solo):** `src/shared/planner/*` (types,
  normalize, rules) + tests. No hot files. Re-derives every measured count
  (slot variants, class dirt, effect-kind split) from items.json fresh; the
  brief's numbers are hypotheses, not law.
- **Wave 2 — B (backend) ∥ C (renderer shell):**
  - B: `src/main/planner/effectIndex.ts`, `src/main/ipc/planner.ts`, store
    accessors, channel names, preload bridge + tests. Hot files: `shared/ipc.ts`,
    `preload/index.ts`, `store.ts`, `ipc/index.ts` (re-read immediately before
    each surgical edit).
  - C: view registration + `PlannerView` shell + `sourceIndex` + `usePlans`
    stub against B's channel names (stub-first so the tree stays buildable) +
    `EffectBrowser`. Hot files: `appViews.ts`, `NavDrawer.tsx`, `App.tsx`.
- **Wave 3 — D:** `PlanBoard` + `FarmList` + progress joins + polish;
  e2e assertion that the pane mounts with a set created.
- Gauntlet per wave: `npm run typecheck` + `npm run lint` + `npm test`;
  e2e when main/renderer changed. Integrator commits per wave, path-scoped.
