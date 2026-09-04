# Running EQ Legends Companion on macOS

**Fork-local.** Upstream targets and tests Windows; this file is the macOS half, kept out of
`AGENTS.md` because that file sits ~10 words under the 20,000-word ceiling its own test enforces
(`tests/agentsDoc.test.mts`), and the JOS-252 protocol reserves distillation for the integrator.
`AGENTS.md` carries a one-line pointer here instead.

macOS is a SECOND-CLASS BUT WORKING target. The app runs, the engine builds clean on arm64, and
the packaged `.app` launches. What follows is the setup, the platform config, and — the part worth
reading before filing a bug — what genuinely does not work here.

## First-run setup

Three steps, in order. Only the first is obvious from the repo.

1. **`npm run deps:electron`** — `.npmrc` sets `ignore-scripts=true`, so `npm install` never runs
   Electron's postinstall and `node_modules/electron/dist` stays empty. It downloads the binary for
   the HOST platform, so a checkout moved between a Windows box and a Mac needs it run again.
2. **A Rust toolchain**, because the engine is compiled from source and is no longer optional
   (below).
3. **`npm run build:engine`** — produces `engine/target/release/engined`.

### The Rust toolchain

`rustup` is the right installer, not Homebrew's `rust`: `engine/rust-toolchain.toml` PINS 1.98.0
with rustfmt+clippy, rustup honours that file automatically, and CI depends on the same mechanism.
The pin is load-bearing — protocol generation ends in rustfmt, so a different rustfmt version fails
the `generated.rs` staleness test on a schema nobody touched.

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --no-modify-path --default-toolchain none
```

`--default-toolchain none` lets the repo's pin drive the install; the first cargo invocation inside
`engine/` fetches exactly 1.98.0. `--no-modify-path` leaves your shell profile alone and still
works, because `scripts/build-engine.mts cargoBinary()` probes `~/.cargo/bin/cargo` directly.

Measured on an M-series Mac: a cold release build is ~15 s and produces a 27 MB arm64 Mach-O.

## THE ENGINE IS MANDATORY — a missing one is the "cannot find its data engine" banner

Since the deletion release (`AGENTS.md`: the world model was "ported to Rust and proven deep-equal
on six slices of the real log before the TypeScript copy was deleted"), the Rust `engined` process
is the ONLY source of world data. `src/main/dataServer/README.md` states it: *"THERE IS NO SECOND
ARM AND NO FLAG. The handlers live in `src/main/ipc/world.ts` and ask the engine unconditionally."*

So a checkout with no `engine/target/release/engined` shows the `no-binary` fault card
(`src/shared/engineLaunch.ts failureWords`) and this in the dev log:

```
data-server shim: N unserved reads answered with the empty shape — no engine client on this launch
```

The remedy is `npm run build:engine`, never a code change. The banner's own prose blames antivirus
quarantine, which is the likeliest cause on Windows and never the cause here.

**One `unserved read` line at startup is NORMAL** — `the engine is still folding ×1` is one of the
seven benign reasons the shim enumerates. The failure state is specifically `no engine client`.

## Platform portability of the engine

The engine is genuinely portable, not merely compiling: no Windows-only crates in the workspace,
and the single `#[cfg(windows)]` in the tree (`engine/crates/eqlog/src/tail.rs`, positional reads)
already carries its `#[cfg(unix)]` arm. Nothing was patched to build here.

## What does NOT work on macOS

- **Log auto-discovery.** Nothing probes a Wine prefix; the default probed is a literal `C:\` path.
  EQ Legends on a Mac runs under Wine, so set the log path by hand in Settings — `config.ts` takes
  it. A configured path is per channel, so the dev app and a packaged build each need their own.
- **The registry install probe.** `native-reg` has no darwin prebuild by its nature. It degrades to
  the drive sweep, exactly as on a Windows machine with no Daybreak keys. The load is guarded —
  `require`d in a try/catch inside `log/discovery.ts` — so it is a missing capability, not a crash.
- **The presence watcher's Win32 calls.** koffi loads on darwin; `user32.dll` does not exist. This
  is the module's one designed failure and it parks fail-open (`observed:false`, overlays visible).
- **Auto-update.** mac builds are unsigned (see `identity: null` below), and macOS will not apply an
  update to an app whose signature it cannot verify.
- **`npm test` is not green.** ~26 failures remain, all Windows-shaped: CRLF dump formats,
  `ERR_DLOPEN_FAILED` from the onnxruntime speech engine, GPU/utility process-loss reporting,
  quarantine drain. Verified against a pristine checkout — they are upstream's, not this fork's.
  The suite is validated on Windows.

## Packaging

`npm run dist:mac` (dmg + zip, arm64 + x64) or `npm run dist:mac:dir` for a fast host-arch build.
The `mac:` block in `electron-builder.yml` carries the detail; three parts are worth knowing:

- **`icon: build/icon-1024.png`, not `build/icon.png`.** app-builder-lib refuses an app icon under
  512x512, and the shared icon is 256 — the size Windows and the tray want. `scripts/gen-icon.mts`
  draws a second master at 1024 from the same glyph; `npm run gen:icon` regenerates both, and the
  Windows art comes out byte-identical.
- **`identity: null` is WRITTEN, not omitted.** Without it app-builder-lib searches the keychain and
  the build's outcome depends on what the developer happens to have installed. `null` makes the
  ad-hoc signature the answer rather than the fallback, which is what arm64 macOS requires to launch
  a modified `.app` at all. A real signed release needs an Apple Developer ID, `notarize`, and this
  key removed.
- **Per-platform binary pruning lives in `win.files` / `mac.files`, never in the shared `files`
  list.** onnxruntime-node, koffi and native-reg each ship every platform's prebuilt N-API binary in
  one tarball, so each target keeps a different set. The Windows list names `{darwin,linux}` among
  its exclusions — written once in the shared list, it prunes the mac build's own dylibs out of it.
  app-builder-lib APPENDS `<platform>.files` to the shared list rather than replacing it
  (`fileMatcher.getFileMatchers`), so the split costs nothing.

The engine ships through a SECOND `extraResources` matcher under `mac:`, filtering for `engined` —
cargo writes no `.exe` here, and the top-level matcher's filter is the Windows spelling. Both run on
every build; the one whose filter matches nothing copies nothing.
`tests/enginePackaging.test.mts` asks about the set and picks the host's by `ENGINE_BIN_NAME`.

## `ELECTRON_RUN_AS_NODE` kills `npm run dev` and names nothing

Symptom: `TypeError: Cannot read properties of undefined (reading 'isPackaged')` at the first `app.`
in the main bundle, with a plain `Node.js vNN` footer under it. The variable makes the Electron
binary behave as bare Node — no `app`, no windows — so `require('electron')` hands back the npm shim
(a path string) and every read off it is undefined.

Nobody sets it on purpose: VS Code is itself an Electron app and exports it into its integrated
terminal, so the same checkout works in a normal terminal two windows over — which is exactly what
makes it read as "broken on my machine".

`electron.vite.config.ts` and `tests/e2e/appWindow.mts` each `delete` it before they spawn anything,
so dev/preview/e2e no longer depend on which terminal started them. A bare `electron .` still would.

This one is not macOS-specific — it bites any editor-launched terminal on any platform — but it is
where a Mac setup hits it first.
