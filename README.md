<div align="center">

# pi-autocomplete

**Ghost text autocomplete for Pi. Local, fast, unobtrusive.**

[![npm](https://img.shields.io/npm/v/pi-autocomplete?style=flat&colorA=18181b&colorB=cb3837)](https://www.npmjs.com/package/pi-autocomplete)
[![CI](https://img.shields.io/github/actions/workflow/status/SheetHappiness/pi-ghost-autocomplete/ci.yml?branch=main&style=flat&colorA=18181b)](https://github.com/SheetHappiness/pi-ghost-autocomplete/actions)
[![License](https://img.shields.io/github/license/SheetHappiness/pi-ghost-autocomplete?style=flat&colorA=18181b)](LICENSE)

<br>

<img src="./32.gif" alt="pi-autocomplete demo">

</div>

<br>

Autocomplete that stays out of the way.

Start typing and `pi-autocomplete` predicts the rest of the word directly inside Pi's editor.  
Press **Tab** or **→** to accept. **Esc** to dismiss.

```sh
pi install npm:pi-autocomplete
```

That's it.

## How it works

**Obvious completion?** Use the dictionary.

**Ambiguous completion?** Ask the local model.

`pi-autocomplete` combines a fast frequency dictionary with your locally learned vocabulary. When that isn't enough, it falls back to a CPU-running [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M).

No remote inference. No prompt text sent to a model service.

## Made for typing

| | |
|---|---|
| `Tab` / `→` | Accept suggestion |
| `Esc` | Dismiss suggestion |
| Undo | Undo the last acceptance |
| `/ghost off` | Disable autocomplete |
| `/ghost on` | Enable it again |

Slash commands and Pi's own file completion keep priority.

## It learns your vocabulary

The bundled dictionary handles common English words immediately.

Words you actually use can become part of a small personal dictionary, ranked using frequency, recency and previous acceptances.

So over time:

```text
imple → implement
auth → authentication
middlew → middleware
```

without requiring model inference for every completion.

Personal vocabulary stays on your machine.

## Local by design

The predictor runs locally on CPU.

On first use, the required model files are downloaded and verified before loading. After that, the cached model is used locally.

Dictionary completion remains available while the model is loading – or even if the native predictor is unavailable.

Check everything with:

```text
/ghost status
```

## Platforms

Prebuilt native packages are available for:

- Windows x64
- Linux x64
- Linux ARM64
- macOS ARM64

No Rust toolchain is required for normal installation.

## Commands

```text
/ghost on
/ghost off
/ghost status
/ghost retry
/ghost dictionary clear
```

## Under the hood

`pi-autocomplete` is intentionally small.

The editor integration is TypeScript, while local model inference runs through a native Rust module on a dedicated thread.

Parts of the prose detection, completion and SmolLM predictor implementation were adapted from [Oh My Pi](https://github.com/can1357/oh-my-pi), with the exact upstream commit and file-level provenance recorded in [`vendor/omp/PROVENANCE.md`](vendor/omp/PROVENANCE.md).

The English frequency dictionary is derived from [wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer.

Full attribution and licenses are available in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check
```

Native development additionally requires Rust.

See [`docs/releasing.md`](docs/releasing.md) for the release pipeline and platform packaging.

---

<div align="center">

Built for [Pi](https://github.com/badlogic/pi-mono).

**Type less. Keep moving.**

</div>
