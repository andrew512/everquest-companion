# fold — the module fold, in Rust (JOS-459 phase 2)

`eqlog` turns bytes into the canonical event stream. This crate consumes it: the `EqModule`
contract, a registry that preserves wiring order, and one ported module per file under
`src/modules/`. `src/lib.rs`'s header carries the design; this file is the **procedure** — how to
add a module and how to prove it.

## Where the clusters stand

`fold::WIRING_ORDER` is all twenty modules of `src/main/modules/wiring.ts`, in delivery order. What
this crate has registered is what `registered()` builds; everything else is named by
`Registry::missing()` and printed as SKIP on every parity run, green ones included.

| cluster | ticket | modules |
| --- | --- | --- |
| 2a | JOS-471 ✅ | `loot` `turnins` `classUnlocks` `kills` `leveling` `outputFiles` `spellSets` `itemTiers` `observedSpellRanks` |
| 2b | — | `respawn` `progression` `character` `roster` `combo` |
| 2c | JOS-476 ✅ | `alerts` `buffs` `buffTimers` `consider` `resist` `eventFeed` |

The cluster table was RE-CUT between JOS-471 and JOS-476: 2c and 2d were merged into one ticket of
six, because the three modules 2d held turned out to be the two cheapest in the whole registry
(`eventFeed` admits nothing historical; `consider` is a fifty-row ring) and the one — `resist` —
whose two published integers need the entire fold to be exact. Splitting the hard one away from the
hard one bought nothing. `registered()` was `cluster_2a` while nine modules were all there was; a
registry named after one ticket is a registry a reader has to date.

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

### The traps the two landed clusters actually hit

- **An absent field is ABSENT, never `null`.** The goldens were recorded through `JSON.stringify`,
  which drops a key whose value is `undefined`. Use `Option<T>` plus
  `#[serde(skip_serializing_if = "Option::is_none")]`. `eqlog` writes its own optional fields the
  same way (`s_opt`/`i_opt`), so `Event::str`/`Event::int` answering `None` is exactly the TS's
  `undefined` — the two ends already agree.
- **A JS `Map`'s iteration order is published wherever a snapshot turns it into an array.** Use
  `JsMap` (`src/jsmap.rs`), never a `HashMap`, when `values()` feeds a `Vec`. Object KEY order is
  free (the bar is deep equality); ARRAY order is not.
- **`camelCase`.** `#[serde(rename_all = "camelCase")]` on every published struct.
- **Derived events are not in the phase-1 goldens and you still need them.** All three exist now:
  `epoch` (`src/epoch.rs`, 2a) because nine modules reset on it, `offlineGap` (`src/session.rs`, 2c)
  because `buffs` folds it to PAUSE every beneficial buff by the length of an absence, and
  `buffExpired`, which `buffs` synthesizes WHILE FOLDING and hands back through
  `EqModule::take_derived`. All three stamp themselves with the current primary event's `seq`/`ts`
  and are queued into `Fold::derived`, then drained through the same dispatch loop after the primary
  event — which is `LogBus.emit` exactly. A module 2b adds that reads one of them needs nothing new;
  `progression` and `roster` both read `offlineGap` and it will be there.
- **A published `seq` is not always `ev.seq`.** `buffTimers` publishes its own REVISION counter
  (JOS-87) because `onTick` moves its state on an idle log; the goldens record 0 for three of the six
  slices and 6 / 106 / 145 for the others. Read the TS's `snapshot()` before assuming.
- **A JS `Map`'s iteration order can be published without appearing in the snapshot at all.** The
  buffs model's `active` map is sorted by `startedTs` before publication — but its ITERATION order
  decides which duration samples are pushed in which order and which `buffExpired` events leave the
  module, and both of those reach the golden by another route.

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
npm run oracle:rust-fold -- [slice...] [--snapshots=<module,module>] [--no-build] [--keep-going]
                            [--slices=<dir>] [--goldens=<dir>] [--tz=<zone>]
```

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
each failure, and a SKIP line naming every module not compared — on green runs too, because "fifteen
of twenty agreed" and "the fold agrees" are different sentences.

**Check the harness still bites** after changing it. Two one-line faults are enough: bump
`KILLS_SHAPE_VERSION` and change `SETTLE_MS`, rebuild, run one slice, and confirm you get
`FAIL kills at .state.v` and a `FAIL spellSets at .state.sets.<name>.observedAt`. Then revert.

**Aim the fault at the number your module actually publishes**, and check that it MOVED. JOS-476 ran
four injections and only two bit: `RECENT_SAMPLE_WINDOW` 5→4 (`FAIL buffs at
.state.stats.<line>.estimateMs`) and an extra `rev += 1` in `buffTimers`' `end()` (`FAIL buffTimers
at .seq`). The other two — `WAKE_CENSOR_MS` 1 s→2 s and `CC_END_MEMORY_MS` 60 s→30 s — are INERT on
all six slices, because nothing in this corpus exercises either constant in a way that reaches a
published field. An inert injection proves nothing about the harness; it is a fact about the corpus,
and worth writing down rather than mistaking for a pass.

House rules for the whole crate: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D
warnings`, `cargo test -p fold`, and the Node side's `npm run typecheck && npm run lint && npm test`.
Heavy runs go at BelowNormal — the harness sets it on itself and the Rust child inherits it.
