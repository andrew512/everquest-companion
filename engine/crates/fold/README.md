# fold — the module fold, in Rust (JOS-459 phase 2)

`eqlog` turns bytes into the canonical event stream. This crate consumes it: the `EqModule`
contract, a registry that preserves wiring order, and one ported module per file under
`src/modules/`. `src/lib.rs`'s header carries the design; this file is the **procedure** — how to
add a module and how to prove it.

## Where the clusters stand

`fold::WIRING_ORDER` is all twenty modules of `src/main/modules/wiring.ts`, in delivery order. What
this crate has registered is `cluster_2a`; everything else is named by `Registry::missing()` and
printed as SKIP on every parity run, green ones included.

| cluster | ticket | modules |
| --- | --- | --- |
| 2a | JOS-471 ✅ | `loot` `turnins` `classUnlocks` `kills` `leveling` `outputFiles` `spellSets` `itemTiers` `observedSpellRanks` |
| 2b | — | `respawn` `progression` `character` `roster` `combo` |
| 2c | — | `alerts` `buffs` `buffTimers` |
| 2d | — | `consider` `resist` `eventFeed` |

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
  synthesized here (`src/epoch.rs`) because nine modules reset on it. **2c owes the other two**:
  `buffs` derives `buffExpired` while folding, and the offline-gap detector derives `offlineGap` —
  neither exists yet, and `alerts`/`buffs`/`buffTimers` cannot be proven without them. Both stamp
  themselves with the current primary event's `seq`/`ts`, which is why omitting them is provably
  harmless for 2a and is not for 2c. The producer must be queued into `Fold::derived` and drained
  through the same dispatch loop, after the primary event — that is `LogBus.emit`.

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
each failure, and a SKIP line naming every module not compared — on green runs too, because "nine of
twenty agreed" and "the fold agrees" are different sentences.

**Check the harness still bites** after changing it. Two one-line faults are enough: bump
`KILLS_SHAPE_VERSION` and change `SETTLE_MS`, rebuild, run one slice, and confirm you get
`FAIL kills at .state.v` and a `FAIL spellSets at .state.sets.<name>.observedAt`. Then revert.

House rules for the whole crate: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D
warnings`, `cargo test -p fold`, and the Node side's `npm run typecheck && npm run lint && npm test`.
Heavy runs go at BelowNormal — the harness sets it on itself and the Rust child inherits it.
