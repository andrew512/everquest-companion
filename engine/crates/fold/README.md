# fold — the module fold, in Rust (JOS-459 phase 2)

`eqlog` turns bytes into the canonical event stream. This crate consumes it: the `EqModule`
contract, a registry that preserves wiring order, and one ported module per file under
`src/modules/`. `src/lib.rs`'s header carries the design; this file is the **procedure** — how to
add a module and how to prove it.

## Where the clusters stand

`fold::WIRING_ORDER` is all twenty modules of `src/main/modules/wiring.ts`, in delivery order. What
this crate has registered is `cluster_2a_2b`; everything else is named by `Registry::missing()` and
printed as SKIP on every parity run, green ones included.

| cluster | ticket | modules |
| --- | --- | --- |
| 2a | JOS-471 ✅ | `loot` `turnins` `classUnlocks` `kills` `leveling` `outputFiles` `spellSets` `itemTiers` `observedSpellRanks` |
| 2b | JOS-475 ✅ | `respawn` `progression` `character` `roster` `combo` |
| 2c | — | `alerts` `buffs` `buffTimers` |
| 2d | JOS-477 🟡 | `consider` `resist` `eventFeed` + **the combat engine** (`src/combat/`, partial) |

The combat engine is not in `WIRING_ORDER` — it is not a module. It is the bus subscriber that sits
AFTER all twenty of them (`pipeline.ts:311,326`), and `Fold` carries it in its own `combat` field
for exactly that reason; `src/combat/mod.rs`'s header carries the submodule-vs-crate argument. Its
port is **deliberately partial** and the header says which half is which — as of JOS-477's second
landing the world model, the whole attribution ladder, the encounter lifecycle and the aggregate's
sums/lanes are in, and the VIEW BUILDERS are what is left. Prove it with `--ledger` (below), never
by eye.

The constructor takes a `ClusterDeps` struct (JOS-475). Add a FIELD to it and a `register` line at
your modules' `WIRING_ORDER` positions; do not re-thread the call sites. Rename it again when it
stops being 2a+2b alone.

## Adding a module (the 2b/2c/2d recipe)

1. **Read the TS module's whole header first.** Every one of them carries an argument — a measured
   log span, an owner ruling, a quirk that looks like a bug and is not. Port the argument into the
   Rust file's header, in your own words, so a reader of this crate never has to open the other tree
   to know whether something is deliberate. Do not write "see `foo.ts`".
2. **`src/modules/<snake_name>.rs`**, one file per TS module. Implement `EqModule`:
   - `id()` returns the TS module's `id` **exactly** — it is the golden's join key.
   - `on_event` opens with `self.seq = ev.seq();`, like every TS `onEvent` does, and then matches on
     `ev.kind()`.
   - `snapshot()` returns `json!({ "seq": …, "state": … })`.
   - `flush_delta` stays defaulted. Deltas are phase 3; do not build the transport here.
3. **Register it in `cluster_2a`** (rename the function when it stops being 2a alone) at its
   `WIRING_ORDER` position. The `registration_follows_the_wiring_order…` test fails if you slot it
   wrong, and the SKIP line shrinks by exactly the name you added.
4. **Reach for the existing ports before writing a helper.** `src/jsfn.rs` holds the shared TS
   functions (`zoneTier`, the item-name pair, `memoKey`, `baseName`, `parseSpellRank`),
   `eqlog::names` holds `idKey`/`spellCanonKey`, and `eqlog::jsstr` holds the JS-vs-Rust divergence
   catalogue — `JS_S` for `\s`, `JS_DOT` for `.`, `(?-u:\b)` for `\b`, `[0-9]` for `\d`,
   `js_trim` for `.trim()`. Never re-derive one of those; a second spelling is a second answer.
5. **Unit-test the module's own laws** in `src/lib.rs`'s `tests` module, driving hand-written NDJSON
   through `Fold`. `fold_lines` and `state_of` are there for it. A test per law the header states,
   named after the law.
6. **Prove it against the goldens** (below). Green is not "my tests pass"; green is the comparator
   over all six slices.

### The four traps this cluster actually hit

- **An absent field is ABSENT, never `null`.** The goldens were recorded through `JSON.stringify`,
  which drops a key whose value is `undefined`. Use `Option<T>` plus
  `#[serde(skip_serializing_if = "Option::is_none")]`. `eqlog` writes its own optional fields the
  same way (`s_opt`/`i_opt`), so `Event::str`/`Event::int` answering `None` is exactly the TS's
  `undefined` — the two ends already agree.
- **A JS `Map`'s iteration order is published wherever a snapshot turns it into an array.** Use
  `JsMap` (`src/jsmap.rs`), never a `HashMap`, when `values()` feeds a `Vec`. Object KEY order is
  free (the bar is deep equality); ARRAY order is not.
- **`camelCase`.** `#[serde(rename_all = "camelCase")]` on every published struct.
- **Derived events are not in the phase-1 goldens and you may still need them.** `epoch` is
  synthesized here (`src/epoch.rs`) because nine modules reset on it, and `offlineGap` is
  (`src/session.rs`) because `progression` publishes every gap's instants verbatim in three columns
  and `roster` marks members stale across one. **2c owes the LAST one**: `buffs` derives
  `buffExpired` while folding, and `alerts`/`buffs`/`buffTimers` cannot be proven without it. The
  producer must be queued into `Fold::derived` and drained through the same dispatch loop, after the
  primary event — that is `LogBus.emit`.
  **CHECK THE GOLDENS BEFORE BELIEVING A CLUSTER DOES NOT NEED ONE.** This bullet said "2c owes the
  other two" until JOS-475, which was true of cluster 2a and false of 2b — the argument for omitting
  a derived event (it stamps itself with the current primary event's `seq`/`ts`, so it can only move
  the `seq` every module carries over unchanged) only holds for modules that do not READ the event.
  Grep the TS module for the kind, then read the golden's own numbers: the six slices carry
  4 / 7 / 6 / 0 / 3 / 2 offline intervals and they are right there in `progression.offlineStart`.

### Adding to the COMBAT engine (2d), and the order the ledger says to do it in

The engine is not a module and does not follow the recipe above — it is `src/combat/`, one file per
`src/main/combat/*.ts`, subscribed behind the registry. What it owes is stated by measurement rather
than by opinion: run `--ledger` over all six slices and the classes it prints ARE the worklist.

JOS-477 opened with the `combat` section agreeing on **48–60% of leaves** per slice, and the
divergences falling into five groups. GROUPS 1–3 HAVE LANDED and the ledger now reads:

| slice | `combat` leaves | `scopes` leaves |
| --- | --- | --- |
| early-leveling | 4202 / 4204 (100.0%) | 720 / 1080 (66.7%) |
| mid-grind | 9750 / 9759 (99.9%) | 1638 / 2457 (66.7%) |
| sky-era | 6525 / 6527 (100.0%) | 1100 / 1650 (66.7%) |
| patch-week | 1149 / 1151 (99.8%) | 204 / 306 (66.7%) |
| hate-pets | 2648 / 2650 (99.9%) | 444 / 666 (66.7%) |
| current | 7821 / 7823 (100.0%) | 1316 / 1974 (66.7%) |

So the worklist below is the same five groups with the first three struck out — the order was
argued and it held:

1. ~~**`world.ts` — instance identity.**~~ **LANDED** (`world.rs`). One caution for anyone touching
   it: the TS installs an `onRetire` CLOSURE from `EngineState`, which Rust will not take, so
   retirement is ANNOUNCED on a queue that `EngineState` drains at every call site that can retire.
   Add a world call and you must drain after it, or a mez'd mob aged out by staleness goes on
   vetoing the death-close.
2. ~~**The attribution ladder**~~ **LANDED WHOLE** (`charm.rs`, `ally.rs`, `others.rs`, `routing.rs`,
   `spellfacts.rs`) — `classify` still pure, and the two doors an `'ignore'` verdict is offered to
   still aggregate-only.
3. ~~**The encounter lifecycle**~~ **LANDED** (`lifecycle.rs`). `.segments.length` and `.selectedId`
   agree on all six.
4. **The aggregate's other half** — what is left of it is the ROUND grouper (`rounds.ts`), the
   minute-WINDOW ledger (`procWindows.ts`), the modifier tallies and the meter-grade HEALING
   accumulator (`healing.ts`). `aggregate.rs` now carries the per-skill and per-category
   breakdowns, the accuracy and resist counters and the target/heal ledgers; the four above are
   read ONLY by a view builder, so they land WITH group 5 rather than before it.
5. **The view builders** — `segmentViews.ts`, `sourceViews.ts`, `healing.ts`, `procViews.ts`,
   `defenseViews.ts`, `roundViews.ts`, and behind them `procDetect.ts` / `procRouting.ts` /
   `stateTimeline.ts` / `coatClass.ts`. These are `.combat.selected`, `.combat.timeline` and the
   whole of `scopes` — ~92% of the section's byte weight, and now the whole of what is red.

**THE THREE CLASSES THAT REMAIN, and nothing else is red on any slice:**

- `.selected` — one per slice, plus every `scopes[].selected`. Group 5.
- `.timeline` — one per slice. Group 5 (`buildTimeline` plus the per-encounter event ring, which
  `routing.rs` does not push today).
- `.poison.slow.*` on `mid-grind` ALONE — seven fields. The BLADE COATS (`procRouting.ts routeCoat`
  / `routeDry`, `shared/poisons.isSlowCapable`) plus the proc ledger's `firstSlowTs`. The gate is
  `enc.coatAtEngage && isSlowCapable(...)`, so with no coat model no pull can qualify;
  `lifecycle.rs finalize_current` states that at the site the sample would be pushed rather than
  writing a branch that provably never runs.

**One divergence was NOT 2d's to fix and is now closed:** ~~`.roster.seen` / `.roster.lastSignalTs`
on the `current` slice~~ — **CLOSED by JOS-475**. Cluster 2b's `roster` module arrived at
`EqModule::as_roster` and answers all three of `RosterSource`'s methods.

The regression surface a later shift must not break is now most of the section: `zone`, `stance`,
`hydrating`, `recent`, `inCombat`, `poison.coat`, `roster`, `selectedId`, `currentTarget`, every
field of `segments[]` and every field of `zoneSessions[]`, on all six slices.

**THE TRAP THIS STAGE ACTUALLY HIT**, because it will catch the view-builder shift too: a function
whose RETURN VALUE feeds only an unported view can still be load-bearing for a ported number.
`st.defenderLabel(...)` looked like pure serialization — its result goes to the timeline instant and
the processing line — but it resolves through the world model, and `resolve()` retires stale
instances and ADOPTS the sighting's casing as the instance display. `bumpTarget` freezes the label it
is handed (first write wins), so skipping the call left 25/71/2/1/53 FIGHT NAMES per slice
sentence-capitalized (`A Teir\`Dal ranger (9) +1` for `a Teir\`Dal ranger (9) +1`). Before deciding a
call is view-only, check what it MUTATES on the way to its return.

### Two rules that are not style

- **No module reads a wall clock, ever** (cache transparency, ruling 18). A time-based rule advances
  off log timestamps during a fold; `on_tick` is the live tail's and `Fold` never calls it. The
  `respawn` module (2b) seeds an ordering clock from `Date.now()` at `reset()`, and the golden was
  recorded under a PINNED construction clock (`WorldOpts.constructionNowMs`, taken from the last
  timestamped LINE of the slice). Whoever ports it must take that instant as a parameter, from the
  same place, or the golden will not re-check tomorrow.
- **Never fix a golden.** If a divergence class looks like a TS-side bug, STOP and report it. The
  goldens are the definition of the bar, not a suggestion.

## Proving it

```
npm run oracle:rust-fold -- [slice...] [--snapshots=<module,module>] [--ledger] [--no-build]
                            [--keep-going] [--slices=<dir>] [--goldens=<dir>] [--tz=<zone>]
```

`--snapshots=<list>` accepts the two COMBAT sections by name as well — `--snapshots=combat,scopes`
narrows a run to the engine, and `--snapshots=kills` narrows it away from one.

`--ledger` swaps the first-divergence report for a full walk that buckets every disagreement by
class (`.combat.segments[].total`, indices erased), prints the count per class with one worked
example, and states the agreement rate. It exists because the combat engine will be red for several
shifts and "it diverged at `.combat.selected`" is equally true on the first shift and the fifth.
**It is not a second bar and it cannot turn a red run green** — the exit code is still decided by
whether anything diverged at all (`tests/bench/parityLedger.mts` carries the argument).

The slices and goldens are gitignored and machine-local, so a **worktree** run needs the two
directory flags pointing at the main checkout, plus `--tz` matching the zone the goldens were
recorded in (`goldens/manifest.json` records it):

```
npm run oracle:rust-fold -- --keep-going \
  --slices=C:\Users\jmoye\everquest-companion\tests\bench\fixtures\slices \
  --goldens=C:\Users\jmoye\everquest-companion\tests\bench\fixtures\goldens \
  --tz=America/Los_Angeles
```

It prints PASS per module per slice, the first divergence (dotted path, both values, truncated) for
each failure, and a SKIP line naming every module not compared — on green runs too, because "nine of
twenty agreed" and "the fold agrees" are different sentences.

**Check the harness still bites** after changing it. Two one-line faults are enough: bump
`KILLS_SHAPE_VERSION` and change `SETTLE_MS`, rebuild, run one slice, and confirm you get
`FAIL kills at .state.v` and a `FAIL spellSets at .state.sets.<name>.observedAt`. Then revert.

**AND INJECT ONE INTO EACH MODULE YOU ADDED, ON A SLICE THAT EXERCISES IT.** A fault that does not
bite proves nothing about the comparator and everything about the slice you picked: `patch-week`
carries no `group` line and no `level` line, so a roster fault and a character fault both PASS there
while biting on `current` and `hate-pets`. The 2b run that was accepted: `.state.v` (respawn),
`.state.recentKills.length` (progression), `.state.intervals[0].slots[0].confidence` (combo),
`.state.lastSignalTs` (roster) and `.state.level.source` (character), across three slices.

House rules for the whole crate: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D
warnings`, `cargo test -p fold`, and the Node side's `npm run typecheck && npm run lint && npm test`.
Heavy runs go at BelowNormal — the harness sets it on itself and the Rust child inherits it.
