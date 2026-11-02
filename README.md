# pi-autocomplete

Standalone Pi extension with dictionary-first word completion and a CPU
SmolLM2-135M fallback on a dedicated native thread. Pi core is unchanged. Tested host: Pi 1.3.0, source reference
02726086d11c2911aa872959e308b90d69182392.

Type prose at the end of a line. After at least two letters, a dim suffix may
appear one cell after the caret. Tab or Right accepts the whole suffix without
adding a space. Escape dismisses it. Enter submits only actual editor text.
Slash commands and file completion keep priority. Undo reverses one acceptance.
Hints that cannot fit completely are hidden. At terminal widths 1–2 the editor
temporarily shows a blank frame to avoid a Pi 1.3.0 Unicode wrapping recursion.

Commands: `/ghost on`, `/ghost off`, `/ghost status`, `/ghost retry`,
`/ghost dictionary clear`. Status reports dictionary and model readiness separately.
Dictionary hits work while the model loads or if the native predictor fails.
Prediction failures leave normal editing usable; retry is explicit.
The extension uses Pi's single custom-editor slot; the previous editor factory
is restored on disable/shutdown if this extension still owns the slot. It does
not compose the previous editor's behavior with ghost editing.

Starting an interactive Pi session prepares the model in the background, before
the first input. A cold cache downloads 146,915,724 bytes from immutable Hugging Face
revisions. Use `/ghost status` to check preparation or readiness; no footer indicator is shown.
Each file is checked for exact size and SHA-256 before native loading.
Warm caches are rehashed. No download or Rust build occurs during installation
or import. Prompt text is never sent to a model service. Recent submitted prose
is retained locally, bounded by the predictor's 1,500 UTF-16 unit memory limit,
in a directory keyed by the current session ID. No history bootstrap occurs.

A packaged English frequency dictionary (20,000 words) and a personal Unicode
dictionary handle confident prefixes of at least three letters without model
inference. Ambiguous prefixes use SmolLM2. Ranking combines corpus frequency,
personal prompt frequency, recency (30-day half-life), and explicit acceptance
for a particular prefix. This is a heuristic, not a calibrated probability.
Completion still appends one word suffix and does not correct existing text.

Personal vocabulary learns from submitted interactive prose and accepted hints;
repeated words count once per submitted prompt. Code, paths, slash commands and
paste markers are excluded. New dictionary files contain words/counts/timestamps,
not full prompts; the model's separate recent-prompt memory still contains prose.
Personal learning is shared across sessions in
`<Pi agent directory>/ghost-autocomplete/dictionary/personal-v1.json`, or
`$PI_GHOST_STATE_DIR/dictionary/personal-v1.json` when overridden. Writes debounce
for two seconds, merge under an exclusive lock, and flush on shutdown.
`/ghost dictionary clear` clears this personal dictionary, including pending
observations in the current process. Other running Pi processes may subsequently
add their own pending observations. It does not clear the model's session memory.
Save failures retain pending changes in memory; shutdown warns if they remain
unsaved. A lock left by a crashed process is not removed automatically: after
checking that no writer is running, remove the adjacent `personal-v1.json.lock`
directory and use `/ghost retry`. Learning pauses with a warning if 4,096 pending
events accumulate while storage is inaccessible.

The English frequency asset is adapted from wordfreq 3.1.1 by Robyn Speer and
licensed CC BY-SA 4.0, separately from plugin code. See
[dictionary provenance](src/dictionary/PROVENANCE.md) and the bundled licenses.

Default data location is `<Pi agent directory>/ghost-autocomplete/`.
`PI_GHOST_CACHE_DIR` and `PI_GHOST_STATE_DIR` override model/state roots.
`PI_GHOST_NATIVE_PATH` is an explicit absolute development artifact override.

Install the published npm package:

```powershell
pi install npm:pi-autocomplete
```

npm selects the matching native package automatically. No Rust toolchain is
needed. Version 0.1.0 is published for Windows x64, Linux x64/glibc,
Linux ARM64/glibc and macOS ARM64.
Public-registry installation was verified in a clean Windows Pi profile,
including automatic native resolution and model readiness before input.

To build locally, use Node.js >=22.19.0, Rust 1.90.0, and the Windows MSVC
SDK/linker (or GNU/Linux tools):

```powershell
npm ci --ignore-scripts
node scripts/build-native.mjs
node scripts/assemble-platform.mjs win32-x64-msvc artifacts/ghost-native.node
npm pack --ignore-scripts --pack-destination artifacts
node scripts/install-local.mjs artifacts
# On Windows, run the pi install command printed by the installer.
```

On Linux x64 use `linux-x64-gnu` instead of `win32-x64-msvc`. GitHub Actions also
builds downloadable package archives and validates all four targets before
assembling a release candidate. See [release instructions](docs/releasing.md).
If you already have both parent and matching native archives, install them with:

```powershell
node scripts/install-local.mjs artifacts
# On Windows, run the printed pi install command after this finishes.
```

The installer honors `PI_CODING_AGENT_DIR`; otherwise it uses `~/.pi/agent`.
A parent-only tarball can resolve its matching native package from npm.

Development (Node >=22.19, Rust 1.90.0, Windows MSVC SDK/linker or GNU/Linux):

```powershell
npm ci --ignore-scripts
npm test
npm run check
node --experimental-strip-types scripts/evaluate-dictionary.mjs
cargo test --manifest-path native/Cargo.toml --locked
cargo clippy --manifest-path native/Cargo.toml --locked --all-targets -- -D warnings
node scripts/build-native.mjs
node scripts/assemble-platform.mjs win32-x64-msvc artifacts/ghost-native.node
node scripts/verify-package.mjs
```

Build Linux/macOS packages on their native runner, changing the platform argument.
Linux packages require glibc; musl, Android/Termux and Windows ARM64 are excluded.
All four targets passed native CI, including real-model inference and Pi package
installation. [Verified release build](https://github.com/SheetHappiness/pi-ghost-autocomplete/actions/runs/39703141565).

| Target            | Verification                                                     |
| ----------------- | ---------------------------------------------------------------- |
| Windows x64 MSVC  | Rust/TS tests, real-model inference, Pi install, native terminal |
| Linux x64 glibc   | Rust/TS tests, real-model inference, Pi install under WSL        |
| Linux ARM64 glibc | Native CI: Rust/TS tests, real-model inference, Pi install       |
| macOS ARM64       | Native CI: Rust/TS tests, real-model inference, Pi install       |

The supplied Linux binary references GLIBC_2.34 symbols and was tested on glibc
2.44. An older-runtime compatibility run remains outstanding.
Human-operated GUI resize checks have not been executed. Offline cold-start
failure is tested with local fixtures; verified warm assets need no network.

OMP code is pinned to 45c35e40c46166dc726ccc52f5d27f40f2449f99.
See vendor/omp/PROVENANCE.md, THIRD_PARTY_NOTICES.md and licenses/.
