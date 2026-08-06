# Group model — who you're with, and what you're battling

Status: DESIGN. Author: planning session (Fable), 2026-08-05. Owner-requested
same day ("definitely make a group model if possible — then we can allowlist
those members… who you're with and what you're battling should be the focus").
Triggered by feedback 01KZA9BVNYDKN9FDVT2N6ZVYPS (group member missing from
meters); the PARSE half of that report is a separate fix already in flight —
this model is the presentation-layer half, and neither depends on the other.

## 0. The one rule that protects everything else

THE ROSTER NEVER TOUCHES THE PARSER. The combat engine records every entity's
damage exactly as today — pets, charm pets, bystanders, NPC-vs-NPC. The group
model is a separate module whose snapshot the METERS consult when choosing
which rows to show. A wrong roster can therefore hide a row, never corrupt a
number; switching scope re-filters the same recorded truth. This is what
"shouldn't interfere with other parser accuracy" means structurally.

## 1. Membership truth (messages, law 1 — never proximity inference)

Fold, in one main-process module (registry pattern, beside combo/buffs):

- `Soandso has joined the group.` / `You have joined the group.` → add
- `Soandso has left the group.` / `You remove Soandso…` / disband shapes → remove
- `Soandso tells the group, '…'` / `You tell your party, '…'` → CONFIRM
  (re-assert membership; also the recovery path when a join predates the log)
- EQ Legends instance roster: `X has been added to/removed from <instance> - Group.`
  → add/remove with `source: instance` (these even survive the slice scrubber)
- Explicit user edits (see §3) → `source: user`, which outranks everything —
  same provenance ladder the class combo already uses (user > stated > inferred).

Per-member record: `{name, source, sinceTs, lastConfirmedTs}`. Epoch boundary
clears the roster (same contract as every character-scoped module). An
`offlineGap` does NOT clear it — EQ drops groups silently on camp, so the
post-login roster is marked STALE (rendered dimmed) until any confirm signal
lands; stale members still pass the allowlist (hiding a real member is the
worse error — it is literally the bug that started this).

Fixture reality check before building: sweep the committed log corpus for the
exact join/leave/tell shapes (the fixtures extractor family is the tool). Any
shape not found in the corpus ships behind a test written from the wiki text
and is labeled unverified in a comment.

## 2. Scopes — the meter question this answers

Three, on the combat dashboard AND each damage/heal overlay:

- **You** — you + your pets (today's drill default, unchanged)
- **Group** (NEW DEFAULT when a roster exists) — you + roster members + pets
  ATTRIBUTED BY THE EXISTING pet-ownership logic (petRows) to any of those.
  Charm pets follow whatever attribution already decides; this plan changes
  no attribution.
- **Everyone** — every recorded source (today's behavior; "open it up to all
  the people around you" is this one click)

Defaulting: if the roster is EMPTY or the model has seen no signal this
session, Group scope is not silently wrong — it falls back to rendering as
Everyone with the scope chip showing `Group (no roster yet)`. Law 1: an empty
roster means unknown, and unknown must not hide people. The moment a signal
lands, the allowlist engages.

"What you're battling" needs no new model — fights/targets are already
segmented; scope only filters SOURCES, never targets.

## 3. UI

- Scope control: compact three-state chip on the combat toolbar + overlay
  headers (persisted per surface — overlay config field, combat pref).
- Roster visibility: a small popover from the scope chip listing members with
  provenance (joined · confirmed · instance · added by you · stale), each
  removable; an add box (name entry) for the member whose join message the log
  never carried. User edits persist per character until epoch.
- Nothing about the roster is ever transmitted: names stay local (same law as
  everything else; telemetry carries no names, slices already scrub group
  social lines).

## 3.5 Root cause of the triggering report (verified by slice replay, 2026-08-05)

The reporter's slice replayed through the real parser and engine settles it:
every damage-shaped line parses (0 unmatched shapes; `reaves`, `Reaving
Strike`, damage-shield credits all covered), and the group member still appears
in ZERO fights — because `classify()` (src/main/combat/routing.ts:48) is the
single admission gate and its last rule is `attacker not you/pet, target not
you → ignore`. 2,224 parsed events fell through that line. Deliberate solo
scoping (Task #65's protections against strangers entering the model), not a
regression.

So G2's exact surface is: `classify()` grows a roster parameter and an
`out-member` attribution; `outSource()` grows a `member` SourceKind (per-member
rows, same instance discipline as pets); `engageHostile()` already refuses
known players and MUST also refuse roster members (a member's TARGET engages,
the member never does — the 214-second-merged-pull failure is the cautionary
tale); lifecycle liveness must never read member presence as hostile presence.
Incoming-on-members (mobs hitting your group) stays OUT of scope for G2 —
sources first, one wave at a time.

- **G1 — the module**: shapes swept from corpus, roster module + deltas +
  tests (join/leave/confirm/instance/stale/epoch), no UI. Ships dark.
- **G2 — scope filtering**: meters + overlays consume the snapshot; scope
  chip + persistence; Group default with the no-roster fallback; e2e coverage
  via the E2 fixture-append driver (write join lines into the tailed fixture,
  assert the allowlist engages live).
- **G3 — roster popover + user edits** (provenance ladder, add/remove).

G1 must not start until the in-flight combat parse fix lands (its verdict
table may add verb shapes the sweep should include); G2 depends on e2e wave
E2 only for its e2e, not for shipping.
