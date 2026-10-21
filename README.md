# pi-ghost-autocomplete

Standalone Pi extension with a CPU SmolLM2-135M predictor on a dedicated native
thread. Pi core is unchanged. Tested host: Pi 1.3.0, source reference
02726086d11c2911aa872959e308b90d69182392.

Type prose at the end of a line. After at least two letters, a dim suffix may
appear one cell after the caret. Tab or Right accepts the whole suffix without
adding a space. Escape dismisses it. Enter submits only actual editor text.
Slash commands and file completion keep priority. Undo reverses one acceptance.
Hints that cannot fit completely are hidden. At terminal widths 1–2 the editor
temporarily shows a blank frame to avoid a Pi 1.3.0 Unicode wrapping recursion.

Commands: `/ghost on`, `/ghost off`, `/ghost status`, `/ghost retry`.
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
is retained locally, bounded by the predictor's 2,500 UTF-16 unit memory limit,
in a directory keyed by the current session ID. No history bootstrap occurs.

Default data location is `<Pi agent directory>/ghost-autocomplete/`.
`PI_GHOST_CACHE_DIR` and `PI_GHOST_STATE_DIR` override model/state roots.
`PI_GHOST_NATIVE_PATH` is an explicit absolute development artifact override.

Native packages are **not published to npm**. A plain `pi install` from this
repository does not supply the native binary yet. Build locally with Node.js

> =22.19.0, Rust 1.90.0, and the Windows MSVC SDK/linker (or GNU/Linux tools):

```powershell
npm ci --ignore-scripts
node scripts/build-native.mjs
node scripts/assemble-platform.mjs win32-x64-msvc artifacts/ghost-native.node
npm pack --ignore-scripts --pack-destination artifacts
node scripts/install-local.mjs artifacts
# On Windows, run the pi install command printed by the installer.
```

On Linux x64 use `linux-x64-gnu` instead of `win32-x64-msvc`. GitHub Actions also
builds downloadable package archives; ARM64 targets remain experimental.
If you already have both parent and matching native archives, install them with:

```powershell
node scripts/install-local.mjs artifacts
# On Windows, run the printed pi install command after this finishes.
```

The installer honors `PI_CODING_AGENT_DIR`; otherwise it uses `~/.pi/agent`.
A parent-only tarball installed
against the public registry cannot obtain unpublished native packages.

Development (Node >=22.19, Rust 1.90.0, Windows MSVC SDK/linker or GNU/Linux):

```powershell
npm ci --ignore-scripts
npm test
npm run check
cargo test --manifest-path native/Cargo.toml --locked
cargo clippy --manifest-path native/Cargo.toml --locked --all-targets -- -D warnings
node scripts/build-native.mjs
node scripts/assemble-platform.mjs win32-x64-msvc artifacts/ghost-native.node
node scripts/verify-package.mjs
```

Build Linux/macOS packages on their native runner, changing the platform argument.
Linux packages require glibc; musl, Android/Termux and Windows ARM64 are excluded.
Linux ARM64 and macOS ARM64 are configured targets, unverified until their native
CI gates run. See docs/verification.md for exact evidence and remaining checks.

| Target            | Local evidence                                                   |
| ----------------- | ---------------------------------------------------------------- |
| Windows x64 MSVC  | Rust/TS tests, real-model inference, Pi install, native terminal |
| Linux x64 glibc   | Rust/TS tests, real-model inference, Pi install under WSL        |
| Linux ARM64 glibc | CI configuration only                                            |
| macOS ARM64       | CI configuration only                                            |

The supplied Linux binary references GLIBC_2.34 symbols and was tested on glibc
2.44. An older-runtime compatibility run remains outstanding. Remote CI and
human-operated GUI resize checks have not been executed. Offline cold-start
failure is tested with local fixtures; verified warm assets need no network.

OMP code is pinned to 45c35e40c46166dc726ccc52f5d27f40f2449f99.
See vendor/omp/PROVENANCE.md, THIRD_PARTY_NOTICES.md and licenses/.
