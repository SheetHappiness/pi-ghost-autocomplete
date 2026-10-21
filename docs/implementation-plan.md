# pi-ghost-autocomplete Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task in this chat. Steps use checkboxes. No subagents, commits, pushes, or publication are authorized by this plan itself.

**Goal:** Ship a standalone installable Pi package with local SmolLM2 word completion, leaving upstream Pi unchanged.

**Architecture:** A TypeScript extension installs `GhostTextEditor extends CustomEditor`. A plugin-owned asynchronous controller calls a minimal N-API addon, whose dedicated Rust thread owns the copied SmolLM2 predictor. Node.js downloads and verifies model assets on first eligible use; no daemon, RPC, Bun, or cloud inference.

**Tech stack:** Node.js 22.23.3 / N-API 10 baseline initially; TypeScript; node:test; Rust edition 2024; napi-rs; portable CPU decoder. Windows x64/PowerShell and Linux x64 are release requirements. Linux ARM64/glibc and macOS ARM64/CPU are secondary targets requiring native CI evidence.

**Spec:** The design and acceptance contract in sections 1–5 of this document implements the user's 2026-10-21 request. This document is a plan, not evidence of a working plugin.

## 1. Provenance and current evidence

Fresh reference checkouts exist under `work/pi` and `work/omp`, outside the future plugin:

| Source | Pinned revision | Evidence |
|---|---|---|
| [earendil-works/pi](https://github.com/earendil-works/pi/tree/02726086d11c2911aa872959e308b90d69182392) | `02726086d11c2911aa872959e308b90d69182392` | Fresh shallow clone; coding-agent manifest version `1.3.0`; clean tracked worktree |
| [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99) | `45c35e40c46166dc726ccc52f5d27f40f2449f99` | Exact commit fetched and checked out detached |

Verified in Pi source: public `CustomEditor`, `ctx.ui.setEditorComponent`, `isShowingAutocomplete`, `getLines`, `getCursor`, `insertTextAtCursor`, `getText`, `getExpandedText`, exported `CURSOR_MARKER`, ANSI/width helpers, and configurable keybinding managers. Host wiring copies autocomplete provider, callbacks, appearance, and app action handlers onto the custom editor.

Pinned host references:

- [CustomEditor and app key handling](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/src/modes/interactive/components/custom-editor.ts)
- [Editor implementation and public methods](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/tui/src/components/editor.ts)
- [Custom editor factory wiring](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [Extension types and lifecycle](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/src/core/extensions/types.ts)
- [Modal editor example](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/examples/extensions/modal-editor.ts)
- [Package manifest, peers, installation rules](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/docs/packages.md)
- [Actual package installer](https://github.com/earendil-works/pi/blob/02726086d11c2911aa872959e308b90d69182392/packages/coding-agent/src/core/package-manager.ts)

**Unproven:** render decoration robustness, inference performance on this PC, addon portability, installed-package loading. These are explicit gates below. Local Node is `v22.23.3`, npm `10.9.9`, and `process.versions.napi` is `10`; `rustc` and `cargo` were not found in PATH. Do not interpret this as proof Rust is absent everywhere.

## 2. Global constraints and interaction contract

- All implementation lives in a separate `work/pi-ghost-autocomplete/` project. Neither reference repository receives source changes. No Pi fork, monkey patches, private-field access, or imports of Pi internals.
- Use only public imports from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. Declare both as `peerDependencies: "*"`, per host documentation; use exact `1.3.0` dev dependencies for the pinned compatibility suite. Do not bundle physical host copies.
- v0.1 has one engine, SmolLM2-135M Q8_0 on CPU, default threshold `0.15`. Remove ngram, Apple, daemon/RPC, whole-message prediction, spelling, and web prior. Do not add CUDA or Metal in this release.
- Only complete a prose word at the logical line end, with at least two Unicode letters/marks/apostrophes. Keep OMP prose/code gating, buffer cap 20,000 UTF-16 units, line cap 1,000, and context tail cap 2,000 without cutting a surrogate pair.
- Visible slash/file autocomplete wins over ghost display and keys. Also suppress ghost in command, path, file-reference, fenced/inline code and paste-marker contexts while asynchronous autocomplete may still be pending. Never replace the host provider.
- Tab and Right accept exactly the displayed full suffix, with **no appended space**. This deliberately omits OMP's provisional trailing-space feature. Enter submits typed text without accepting ghost. Escape dismisses ghost and consumes that press only when ghost is visible and host autocomplete is absent; otherwise normal host behavior runs.
- Respect configured `tui.input.tab`, `tui.editor.cursorRight`, and the app interrupt binding, with Escape as its normal default. Preserve extension shortcut and app-action precedence. Use host keybinding APIs rather than raw escape-string matching.
- Ghost is separate state. Never call `setText` or insert text during render, even temporarily. `getText`, `getExpandedText`, history, callbacks, external-editor text, and submission contain only committed input until acceptance. Acceptance uses one `insertTextAtCursor` operation and one undo unit.
- Cursor changes, deletion, incompatible typing, history navigation, paste, mouse movement, programmatic text changes, session changes, editor replacement, and disposal invalidate displayed/queued suggestions. Escape records the dismissed snapshot so the same late answer cannot resurrect it.
- One in-flight prediction and one replaceable newest queued query. Validate generation plus exact text/cursor/session snapshot before display. In-flight CPU inference need not be forcibly interrupted; stale output is ignored.
- No network at package install or extension import for weights. First eligible query starts one background model preparation. Offline/failure keeps the editor usable, reports one status, and waits for explicit retry via `/ghost retry`; no keystroke-driven retry loop.
- `/ghost on`, `/ghost off`, `/ghost status`, `/ghost retry` manage this instance. Default on in interactive mode. Headless/RPC mode does not create the editor, load native code, or download weights.
- v0.1 does not import full historical sessions. Observe only live interactive user submissions once, in order. Persist SmolLM's own bounded recent-prompt memory in a session-specific directory; same-session reload restores it, another session does not inherit it. Do not claim this is model fine-tuning. No global OMP state directories are reused.
- Only one custom editor slot exists. Document coexistence limits with other editor-replacing extensions; do not claim automatic composition. Disposal cancels plugin work; do not blindly reset the slot after another extension replaces it.

## 3. Exact extraction map

Every OMP link below uses commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. Preserve source headers, embedded tests and comments; document modifications in `vendor/omp/PROVENANCE.md` with original path, commit, source SHA-256 and destination. New Rust crates have independent manifests and lockfile; do not copy the OMP workspace.

| Exact source | Destination relative to plugin | Action |
|---|---|---|
| [crates/pi-predict/src/lib.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/lib.rs) | `native/predictor/src/lib.rs` | Retain `Config`, `Query`, `Suggestion`, `Predictor`; replace multi-engine `Method/open` with SmolLM-only `open(&Config)`; update daemon documentation |
| [smollm/config.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/config.rs) | `native/predictor/src/smollm/config.rs` | Copy loader, tensor/decoder interfaces and tests |
| [smollm/cpu.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/cpu.rs) | `native/predictor/src/smollm/cpu.rs` | Copy portable decoder and tests; preserve parallel safety invariants; no machine-specific `target-cpu=native` release builds |
| [smollm/gguf.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/gguf.rs) | `native/predictor/src/smollm/gguf.rs` | Copy Q8_0 parsing/conversion and tests |
| [smollm/mod.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/mod.rs) | `native/predictor/src/smollm/mod.rs` | Copy inference, memory, threshold, exclusion behavior; make decoder selection CPU-only on every OS; remove Metal imports/selection and OMP environment switch |
| [smollm/search.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/search.rs) | `native/predictor/src/smollm/search.rs` | Copy token-healed constrained search and tests |
| [smollm/session.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/session.rs) | `native/predictor/src/smollm/session.rs` | Copy inference KV-cache management and tests |
| [smollm/tokenizer.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/tokenizer.rs) | `native/predictor/src/smollm/tokenizer.rs` | Copy tokenizer and tests |
| [smollm/preamble.txt](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/smollm/preamble.txt) | `native/predictor/src/smollm/preamble.txt` | Copy verbatim and include in Cargo package |
| [crates/pi-predict/src/prose.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/src/prose.rs) | `native/predictor/src/prose.rs` | Copy typed/prose filtering and tests |
| [crates/pi-predict/Cargo.toml](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-predict/Cargo.toml) | `native/predictor/Cargo.toml` | Reference dependency inventory only: anyhow, rayon, regex, serde, serde_json. No zstd, Candle, objc2 or Apple stack for CPU-only SmolLM |
| [crates/pi-natives/src/predict.rs](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-natives/src/predict.rs) | `native/addon/src/predict.rs` | Adapt only `TextPredictor`, job thread, async replies, ready/complete/observe/feedback/persist. SmolLM-only options; add explicit close; no remaining pi-natives modules |
| [packages/tui/src/prompt/word-completion.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/src/prompt/word-completion.ts) | `src/completion/query.ts`, `src/completion/controller.ts` | Adapt query construction, Unicode-safe context tail, projection, cache and latest-query scheduling. Remove global host resolver/method list and OMP logger/editor interface dependencies |
| [packages/tui/src/prompt/prose-gate.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/src/prompt/prose-gate.ts) | `src/completion/prose-gate.ts` | Necessary transitive dependency: retain `isProseWord`, `lineContext`, `ProseSource`; replace spelling-only context with plugin's minimal context; omit optional TypingWord field/import |
| [packages/tui/src/prompt/markdown-prose.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/src/prompt/markdown-prose.ts) | `src/completion/markdown-prose.ts` | Copy `maskNonProse` and local helpers; omit `keywordInProse`; inline only `FENCE_RE = /^( {0,3})([`~]{3,})/` from [render-utils.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/src/render/render-utils.ts), not the renderer module |
| [packages/tui/src/components/editor.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/src/components/editor.ts) | `src/editor/ghost-text-editor.ts`, `src/editor/render-ghost.ts` | Algorithm reference only: `#acceptWordCompletion`, `#getInlineHint`, `#getWordCompletion`, `#getShownWordCompletion`, `#wordCompletionTypedPast`, end-of-line hint painting. Adapt behavior to public host APIs; never copy whole class/private state/layout |
| [packages/coding-agent/src/predict/smollm-weights.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/predict/smollm-weights.ts) | `src/model/manifest.ts`, `src/model/weights.ts` | Copy pinned manifest and verified-download strategy; replace Bun, pi-utils, download HUD, global cache and daemon/ngram fallback with Node APIs and plugin status |
| [LICENSE](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/LICENSE) | `licenses/OMP-MIT.txt` | Preserve complete MIT text and all copyright holders |

Reference and adapt relevant cases from [word-completion.test.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/test/word-completion.test.ts) and [markdown-prose.test.ts](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/tui/test/markdown-prose.test.ts), replacing OMP runtime/editor imports.

**Explicit exclusions:** `smollm/metal.rs`, `apple/`, `ngram/`, `data/`, `scripts/build-web-prior.ts`, all daemon/socket/RPC code, OMP settings/CLI/download framework, entire editor, entire pi-natives, and vendored napi tree. OMP patches its `napi` dependency ([patch rationale](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/vendor/napi/README.md)); the minimal addon must pass lifetime/close tests with registry napi before deciding any patch is needed. Do not silently vendor it.

## 4. Model manifest, storage and notices

Use exactly these source URLs, expected byte lengths and SHA-256 values from the pinned OMP downloader. The large weights have **not** been downloaded or hashed in this planning session; these are expected digests, verified by the implementation at runtime.

| File / pinned download URL | Bytes | SHA-256 |
|---|---:|---|
| [config.json](https://huggingface.co/HuggingFaceTB/SmolLM2-135M/resolve/93efa2f097d58c2a74874c7e644dbc9b0cee75a2/config.json) | 704 | `1d556eab73b69c7f11f64c557a2f9c6f440bd4c6b89bb2584a6b498c92603843` |
| [tokenizer.json](https://huggingface.co/HuggingFaceTB/SmolLM2-135M/resolve/93efa2f097d58c2a74874c7e644dbc9b0cee75a2/tokenizer.json) | 2,104,556 | `9ca9acddb6525a194ec8ac7a87f24fbba7232a9a15ffa1af0c1224fcd888e47c` |
| [SmolLM2-135M.Q8_0.gguf](https://huggingface.co/QuantFactory/SmolLM2-135M-GGUF/resolve/d948db3614be18259a175aafd7689a70f1cb4e2f/SmolLM2-135M.Q8_0.gguf) | 144,810,464 | `b761d9ccdfce67726e41ca2ef30e9dfbcf6a32ca2aaef47df5c049ec362d04cd` |

Total transfer: **146,915,724 bytes**, excluding HTTP overhead. Model cards: [upstream Apache-2.0](https://huggingface.co/HuggingFaceTB/SmolLM2-135M/blob/93efa2f097d58c2a74874c7e644dbc9b0cee75a2/README.md), [quantization provenance](https://huggingface.co/QuantFactory/SmolLM2-135M-GGUF/blob/d948db3614be18259a175aafd7689a70f1cb4e2f/README.md). HF API confirmed the quantization revision and Apache-2.0 metadata during planning. Preserve actual license files and any supplied NOTICE from these revisions in `licenses/`; record absence of NOTICE rather than inventing one. Generate runtime dependency notices from the final Cargo/npm locks. Do not state all dependencies are MIT.

`src/paths.ts` owns platform paths: Windows `%LOCALAPPDATA%/pi-ghost-autocomplete/{cache,state}` (fallback under the user's local app data path); Linux `$XDG_CACHE_HOME/pi-ghost-autocomplete` and `$XDG_STATE_HOME/pi-ghost-autocomplete` with standard home fallbacks; macOS `~/Library/Caches/pi-ghost-autocomplete` and `~/Library/Application Support/pi-ghost-autocomplete`. Tests inject a temporary root. Cache directory includes both pinned model revisions. State is partitioned by a hash of the public session identity.

Use a cross-process lock (exact pinned `proper-lockfile` release), unique `.part` files, streamed fetch, abort/30-minute transfer timeout, size and hash checks before rename, and atomic ready metadata. Reverify cached files once per process before native load, including when a marker exists; a marker alone cannot establish integrity. Do not delete unrelated older caches. Hold the model-install lock during repair; Windows rename/locked-file failures leave existing verified assets usable or return a clear failure, never partially rewrite them. Never feed user text into network requests.

## 5. File boundaries and interfaces

New plugin files:

```text
package.json, package-lock.json, tsconfig.json, README.md, LICENSE
src/extension.ts, src/paths.ts
src/editor/ghost-text-editor.ts, src/editor/render-ghost.ts
src/completion/types.ts, query.ts, controller.ts, prose-gate.ts, markdown-prose.ts
src/model/manifest.ts, weights.ts
src/native/load.ts, types.ts
native/Cargo.toml, Cargo.lock, rust-toolchain.toml
native/predictor/Cargo.toml, src/{lib.rs,prose.rs,smollm/*}
native/addon/Cargo.toml, build.rs, src/{lib.rs,predict.rs}
platforms/{win32-x64-msvc,linux-x64-gnu,linux-arm64-gnu,darwin-arm64}/package.json
scripts/{build-native,assemble-platform,verify-package,install-smoke}.mjs
test/{query,controller,render-ghost,ghost-text-editor,weights,extension,native-loader,package}.test.ts
test/native-smoke.test.ts, test/fixtures/*
.github/workflows/ci.yml
licenses/*, THIRD_PARTY_NOTICES.md, vendor/omp/PROVENANCE.md
```

Contracts (all plugin-owned, no new host contract):

```ts
interface Query { before: string; prefix: string }
interface Snapshot { text: string; line: number; col: number; session: string }
interface Suggestion { suffix: string; confidence: number }
interface Predictor {
  ready(): Promise<void>;
  complete(before: string, prefix: string): Promise<Suggestion | null>;
  observe(prompts: string[]): Promise<void>;
  feedback(before: string, prefix: string, suffix: string, accepted: boolean): Promise<void>;
  persist(): Promise<void>;
  close(): Promise<void>;
}
// load.ts: loadPredictor(options: { modelDir: string; stateDir: string }): Predictor
// query.ts: queryFor(lines: readonly string[], line: number, col: number): Query | undefined
// weights.ts: ensureWeights(options: { cacheRoot: string; signal?: AbortSignal;
//   onProgress?: (loaded: number, total: number) => void }): Promise<string>
// render-ghost.ts: renderGhost(rows: readonly string[], width: number, suffix: string): string[]
```

`GhostController` in `controller.ts` exposes `update(snapshot, query | undefined)`, `visible(snapshot): string | null`, `dismiss(snapshot)`, `accepted(snapshot)`, `reset()`, and `dispose()`. Constructor receives `Predictor` and `onUpdate: () => void`; it owns projection, cache, generations and scheduling. Errors yield no suggestion and a separate status notification. Reject control characters, multiline, empty and non-word suffixes before display/insertion. Keep confidence for validation/status; retain native threshold gating.

`GhostTextEditor` stores the factory keybinding manager, controller and repaint callback. Override `handleInput`, `handleMouse`, `setText`, `insertTextAtCursor`, `render` and `invalidate` only as necessary. Do not take ownership of host `onChange`/`onSubmit` callbacks: the host overwrites them when installing the editor. Reconcile after delegated input and public mutators, before render, and on invalidation. Plugin state may change during reconciliation; host text never changes during render.

**Render decision:** Call `super.render(width)` on real text, then decorate only its cursor row, identified by the exported `CURSOR_MARKER`. Preserve exactly one marker at its original position and preserve the host fake cursor. Put the dim suffix after that cursor cell, replacing blank padding; measure it with public ANSI/grapheme helpers. Thus v0.1 displays the hint one cell after the caret and does not add visual lines. Show only when the entire suffix fits in the available terminal cells: no partial hint whose unseen remainder would be accepted. If the marker is absent/ambiguous or the suffix does not fit, display and acceptance are disabled for that frame. No parser of private editor state or transient text insertion. Task 1 proves this compromise before porting the native engine.

**Packaging decision:** Parent package `pi-ghost-autocomplete@0.1.0` declares `pi.extensions: ["./src/extension.ts"]`, keyword `pi-package`, and exact-version optional dependencies `@sheethappiness/pi-ghost-autocomplete-<platform>@0.1.0`. Each platform package contains one `.node` plus notices, and has matching `os`/`cpu` constraints. Keep this scope provisional until registry ownership is checked; no account creation/publication during implementation. The parent loader uses `createRequire(import.meta.url)` and a platform allowlist; no native build or binary download install hook. Local development may load a deliberately specified local artifact, never a silent Rust fallback.

Git installs consume those published optional dependencies, so the promised git URL cannot be called verified until that exact release route is tested. For prepublication testing, generate platform and parent tarballs and install from a temporary local registry fixture, with normal package names/versions. A local-path install alone is insufficient. Unsupported/missing native modules disable prediction with a clear status while Pi stays usable. GNU ARM64 support does not imply Android/Termux/Bionic support.

## Review focus

1. Pending slash/file autocomplete, not merely a visible menu, must not lose Tab to ghost (Task 1).
2. Unicode combining marks, CJK/emoji, resized/scrolled lines and terminal cursor escapes must stay intact (Task 1).
3. Late results after Escape, session changes, replacement or shutdown must never reappear or leak work (Tasks 2, 4, 6).
4. Concurrent downloads, corrupt warm caches, offline starts and Windows locked files must never load unverified weights (Task 5).
5. A successful dev load must not hide omitted binaries/notices, duplicate Pi packages or source-build requirements in a real install (Tasks 7–8).

## 6. Ordered TDD implementation tasks

For every task: write assertions first, run the focused test and record the expected behavioral failure, implement minimally, rerun to green, then refactor while green. Do not count an accidental missing dependency/fixture failure as the intended red test. Capture evidence in `docs/verification.md`. Do not commit without an explicit request.

### Task 1 — Prove public custom-editor integration before native porting

**Files:** `package.json`, lockfile, tsconfig; `src/editor/{ghost-text-editor,render-ghost}.ts`; `src/completion/types.ts`; `test/{ghost-text-editor,render-ghost}.test.ts`; fake terminal/backend fixtures. Only development dependencies initially; no model or native build.

**Consumes:** pinned public Pi APIs. **Produces:** tested `GhostTextEditor` and `renderGhost` boundary from section 5, initially with a deterministic fake suggestion provider.

- [ ] Write tests against real pinned `CustomEditor`: typed `hel`, fake suffix `lo`; repeat render; assert `getText() === "hel"`, `getExpandedText() === "hel"`, callbacks unchanged; Enter submits `hel`; Tab and Right independently produce `hello`; undo restores `hel`; no trailing space.
- [ ] Add slash and file providers, including delayed results: menus/command/path contexts retain normal Tab, Right and Esc behavior. Assert identical delegated behavior with ghost disabled.
- [ ] Test Escape dismissal, ordinary Esc when no ghost, host extension shortcut first, configured bindings, paste and mouse changes, `setText`, external insertion, history and redo. Host callback wiring must survive editor installation.
- [ ] Test render widths 1/2/20/80, padding, logical/visual line wrap boundaries, long scrolled buffers, emoji/CJK/combining accents, focus loss, resize, one cursor marker and unchanged row widths. No space means no accepted invisible suggestion.
- [ ] Run `node --experimental-strip-types --test test/ghost-text-editor.test.ts test/render-ghost.test.ts` and confirm expected behavioral reds using explicit incomplete stubs.
- [ ] Implement public-API decorator, key dispatch and atomic acceptance; rerun to green; run `npx tsc --noEmit`.
- [ ] Gate: if the public render boundary cannot pass these cases, stop and revise the plugin rendering design. Never fix it by editing Pi core or copying the OMP editor.

### Task 2 — Port query gates and asynchronous controller

**Files:** `src/completion/{query,controller,prose-gate,markdown-prose}.ts`; `test/{query,controller}.test.ts`; extraction provenance.

**Consumes:** section 5 `Predictor`, `Snapshot`, `Query`. **Produces:** `queryFor` and `GhostController` consumed by the editor.

- [ ] Write gate tests for two-letter minimum, apostrophes/combining marks, middle-of-line exclusion, slash/@/Windows and Unix paths, camelCase/digits, inline/fenced code across lines, paste markers, exact size caps and surrogate-safe context truncation.
- [ ] Write deferred-backend tests: one active plus newest queued request; exact snapshot validation; stale answers after delete/move/Esc/session reset ignored; dismissed snapshot remains dismissed; compatible typing projects the remaining suffix; divergence reports rejection once.
- [ ] Test rejected/malformed/multiline/control-character results, cache reset after observe/feedback, duplicate render/query calls and dispose while awaiting a result.
- [ ] Run `node --experimental-strip-types --test test/query.test.ts test/controller.test.ts` for reds, adapt listed OMP helpers, rerun green. Keep the editor tests green.

### Task 3 — Extract CPU-only predictor with its original tests

**Files:** `native/{Cargo.toml,Cargo.lock,rust-toolchain.toml}`, `native/predictor/**`; `vendor/omp/PROVENANCE.md`, `licenses/OMP-MIT.txt`.

**Consumes:** exact extraction list and local model directory. **Produces:** napi-free `ghost_predictor::{Config,Query,Suggestion,Predictor,open}`.

- [ ] Locate available Rust/MSVC tools first; document missing components. Use a pinned stable Rust toolchain that compiles the edition-2024 CPU subset; do not inherit OMP's nightly solely because the whole workspace uses it. Verify minimum support for `as_chunks` and `is_multiple_of` in copied source.
- [ ] Write contract tests for absent/corrupt assets, SmolLM-only construction and state-version errors; retain original embedded tests for loader, Q8 math, tokenizer, search, KV/session and memory/prose rules.
- [ ] Run `cargo test --manifest-path native/Cargo.toml -p ghost-predictor` for red, copy/adapt only listed files, resolve exact dependency versions to a new lock, rerun green with `--locked`.
- [ ] Remove macOS GPU selection and OMP-only imports; verify Cargo tree contains no zstd, ngram assets, Candle, objc2 or other pi-natives subsystems. Run formatting and clippy on this workspace only.

### Task 4 — Minimal N-API addon and bounded lifetime

**Files:** `native/addon/**`, `src/native/{load,types}.ts`, `test/{native-loader,native-smoke}.test.ts`, build-native script.

**Consumes:** Task 3 engine. **Produces:** section 5 `Predictor` contract. `TextPredictor` options are only modelDir/stateDir; threshold stays `0.15`.

- [ ] Write Rust fake-engine job tests for serialized calls/order, startup errors, dropped replies, repeated close, close while prediction runs, reject after close, persistence before stop, and no thread left alive. Write Node loader tests for supported platform, missing binary and Node ABI mismatch.
- [ ] Run focused tests for reds, adapt only `predict.rs`, add small addon entry/build files. Start with registry napi 3.14.2 / napi-derive 3.6.12 / napi-build 2.6.0 if available and compatible (values inspected in OMP lock); otherwise explicitly resolve and record the replacement lock versions. Use N-API 10 with async runtime, no vendored patches unless a reproduced failure justifies review.
- [ ] Bound work through controller serialization and addon lifecycle; never use a blocking bounded-channel send on the JS thread. Close stops accepting work, waits for queued accepted operations, persists, ends and joins the worker asynchronously. UI shutdown awaits a bounded grace period and reports failure without claiming cancellation of CPU work.
- [ ] Run `cargo test --manifest-path native/Cargo.toml --locked`, build the Windows addon, then `node --experimental-strip-types --test test/native-loader.test.ts test/native-smoke.test.ts`. Initially smoke tests cover load errors/close without real weights; real-model completion is mandatory in Task 8.

### Task 5 — Node-only verified model preparation

**Files:** `src/model/{manifest,weights}.ts`, `src/paths.ts`, `test/weights.test.ts`, pinned license artifacts.

**Consumes:** manifest in section 4. **Produces:** `ensureWeights` from section 5.

- [ ] Write local-HTTP-fixture tests for pinned URL construction, correct bytes, wrong size/hash, HTTP failure, abort/timeout, partial cleanup, concurrent processes, lock recovery, ready-marker corruption, corrupt cached asset despite correct marker, Windows rename contention and progress totals. Test pinned production manifest independently from small download fixtures.
- [ ] Run `node --experimental-strip-types --test test/weights.test.ts` for reds. Implement streaming Node fetch/fs/crypto, lock, atomic readiness and startup revalidation. No Bun or OMP helpers remain.
- [ ] Rerun green. Fetch actual license/NOTICE materials from pinned HF revisions, preserve attribution, and record source URLs and content hashes. Do not download weights merely to run downloader unit tests.

### Task 6 — Extension lifecycle and live integration

**Files:** `src/extension.ts`; editor/controller integration; `test/extension.test.ts`; README command/configuration section.

**Consumes:** Tasks 1–5. **Produces:** loadable interactive Pi extension and `/ghost` command family.

- [ ] Write lifecycle tests: interactive start registers editor, noninteractive start does nothing; first eligible query starts one model preparation; multiple keystrokes do not duplicate load/download; failure leaves ordinary editor operational; retry is explicit; off cancels pending work; session switch and shutdown reset generations and close old engines.
- [ ] Write tests for host-installed callbacks, once-only observation of interactive submissions, no observation of RPC/extension input, session-specific state, no full-history bootstrap, and no duplicate observation after reload.
- [ ] Run `node --experimental-strip-types --test test/extension.test.ts` for reds. Implement lifecycle/status/commands and lazy native creation using top-level module imports plus `createRequire` for the actual native load.
- [ ] Rerun all focused TS tests and typecheck. Exercise against the actual host factory wiring; a mocked ExtensionAPI test alone is insufficient.

### Task 7 — Build/package platform artifacts and notices

**Files:** parent manifest, platform manifests, `scripts/{build-native,assemble-platform,verify-package}.mjs`, CI workflow, notices, `test/package.test.ts`.

**Consumes:** working addon and extension. **Produces:** parent tarball and matching platform tarballs; release commands remain local until publication is requested.

- [ ] Write package assertions first: declared extension exists; runtime TypeScript imports resolve; no host package in runtime dependencies or bundle; correct binary package for platform/arch/libc; notices/source provenance/preamble present; no weights, `.part`, private state or reference checkout included; no Rust or network install hook.
- [ ] Run `node --experimental-strip-types --test test/package.test.ts` for reds. Implement exact-version optional platform dependencies, allowlisted loader and portable Node-based build/assembly scripts. Pin dev/runtime tooling and locks; no shell-specific `cp`, `rm`, or bash-only pipelines.
- [ ] CI required: Windows `x86_64-pc-windows-msvc` in pwsh and Linux `x86_64-unknown-linux-gnu`. Secondary runners: `aarch64-unknown-linux-gnu` and `aarch64-apple-darwin`, CPU only. Test on native runners; cross-compilation alone does not certify support. State Linux glibc floor from build runner and test it; do not advertise musl/Android.
- [ ] Run package test, typecheck, Cargo tests/clippy, platform Node load tests, and `npm pack --dry-run --json`; then make actual tarballs and inspect their contents. Produce dependency/license inventories from final locks and include them in artifacts.

### Task 8 — Actual Pi installation and real-model acceptance gates

**Files:** `scripts/install-smoke.mjs`, isolated settings/workdirs, `docs/verification.md`, README compatibility table.

**Consumes:** Task 7 tarballs, unchanged pinned host, verified real model. **Produces:** evidence for standalone installability and platform support.

- [ ] Write an isolated install smoke harness: temporary `PI_CODING_AGENT_DIR`, clean project directory, no real account keys/providers, local registry serving generated parent/platform tarballs. Assert package listing, resource discovery, native resolution and clean uninstall. No writes to the user's personal Pi settings.
- [ ] Run harness for red before completing install wiring; then install via actual Pi CLI `pi install npm:pi-ghost-autocomplete@0.1.0` against that fixture, run `pi list`, load interactively and remove. Also test local-path installation. Do not treat `npm pack --dry-run` as installed-package proof.
- [ ] Download the three real pinned assets once through `ensureWeights`; verify byte lengths/hashes. Run native `ready`, complete, observe, feedback, persist, close, reopen; verify bounded single-word suggestions and state isolation. Capture completion latency/RSS locally without inheriting OMP M4 benchmark claims.
- [ ] In native Windows terminal launched from PowerShell, verify visible ghost, Tab/Right, Esc, Enter without ghost acceptance, undo, slash/file precedence, resize, Unicode, paste and offline warm/cold behavior. Repeat required Linux x64 smoke. Record automated vs manual/native evidence separately; leave unrun checks explicitly unverified.
- [ ] Verify both reference repositories remain clean at their pinned revisions; execute the final plugin TS tests/typecheck, Rust tests/clippy and installed-package checks. No broad unrelated host test suite is needed when no host code changed.
- [ ] For a later authorized public release, publish platform packages before parent, then test actual npm install and the real git package URL at its immutable release tag. Until then label npm/git public install examples as planned, not available.

## 7. Completion and stop conditions

v0.1 is complete only after required Windows x64 and Linux x64 native CI/install evidence, real verified model inference, editor purity/precedence tests, packaged notices, and unchanged host sources. Secondary platforms stay marked unverified until their native gates pass. Source availability alone is not platform support.

Stop and report a concrete design/toolchain blocker if public rendering cannot satisfy Task 1, required Windows tools cannot be provisioned within authorization, registry napi requires an unexplained vendor patch, a pinned model digest differs, or package/native loading requires editing Pi. Do not replace SmolLM with a fake predictor to claim completion.

**Planning handoff:** Review this plan before product implementation. Recommended execution is native/inline, starting with Task 1's public-editor feasibility gate, then following the ordered TDD tasks. No product code, dependency installation, model download, addon build, commit or publication has been performed during planning.
