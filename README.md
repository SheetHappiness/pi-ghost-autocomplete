<div align="center">

# pi-autocomplete

### Ghost text autocomplete for Pi

**Local. Fast. Quietly useful.**

<br>

[![npm](https://img.shields.io/npm/v/pi-autocomplete?style=for-the-badge&label=npm&color=CB3837)](https://www.npmjs.com/package/pi-autocomplete)
[![Pi](https://img.shields.io/badge/Pi-extension-111111?style=for-the-badge)](https://github.com/badlogic/pi-mono)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SmolLM2](https://img.shields.io/badge/SmolLM2-135M-FFD21E?style=for-the-badge)](https://huggingface.co/HuggingFaceTB/SmolLM2-135M)
[![CPU](https://img.shields.io/badge/runtime-CPU-6e7681?style=for-the-badge)](#how-it-works)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/SheetHappiness/pi-ghost-autocomplete?style=for-the-badge)](LICENSE)

<br>
<br>

<img src="./assets/32.gif" alt="pi-autocomplete demo" width="900">

<br>

</div>

---

## Autocomplete that stays out of the way

Start typing.

A dim completion appears directly after your cursor.

Press **Tab** or **→** to accept it.  
Press **Esc** to ignore it.

```sh
pi install npm:pi-autocomplete
```

That's it.

## How it works

`pi-autocomplete` uses a simple hybrid predictor:

```text
typing
  ↓
dictionary
  ↓
personal vocabulary
  ↓
SmolLM2 fallback
  ↓
ghost text
```

Common and confident completions are handled by a bundled English frequency dictionary.

Words you use are learned locally and become part of your personal vocabulary.

When the prefix is ambiguous, autocomplete falls back to a local **SmolLM2-135M** model running on CPU.

No remote model service is required.

## Example

```text
imple      → implement
auth       → authentication
middlew    → middleware
configu    → configuration
```

The suggestion stays ghosted until you accept it.

## Controls

| Key | Action |
|---|---|
| `Tab` | Accept completion |
| `→` | Accept completion |
| `Esc` | Dismiss |
| Undo | Undo last acceptance |

Pi's slash commands and file completion keep priority.

## Commands

```text
/ghost on
/ghost off
/ghost status
/ghost retry
/ghost dictionary clear
```

## Personal vocabulary

Autocomplete learns from the prose you submit and suggestions you accept.

Ranking combines:

- common English frequency
- your own word frequency
- recency
- previous acceptance for a prefix

The personal dictionary is stored locally.

## Local by design

The model runs through a native Rust predictor on a dedicated thread.

The first interactive session prepares the model in the background.

After that, it uses the local cache.

Dictionary completions keep working even while the model is loading or if the native predictor is unavailable.

```text
/ghost status
```

shows dictionary and model readiness separately.

## Stack

<div align="center">

**Pi** · **TypeScript** · **Rust** · **SmolLM2-135M** · **Node.js**

</div>

The Pi extension and editor integration are written in TypeScript.

Local model execution runs through a native Rust module.

The predictor uses [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M) as its fallback.

The fast path is dictionary-first, so obvious completions don't need the model at all.

## Platforms

Prebuilt native packages are published for:

| Platform | Architecture |
|---|---|
| Windows | x64 |
| Linux | x64 |
| Linux | ARM64 |
| macOS | ARM64 |

Normal installation does **not** require a Rust toolchain.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check
```

Native development additionally requires Rust.

Release and packaging details are documented in [`docs/releasing.md`](docs/releasing.md).

## Credits

Parts of the prose detection, word-completion logic and native predictor were adapted from [**Oh My Pi**](https://github.com/can1357/oh-my-pi).

The exact upstream commit and file-level changes are documented in:

[`vendor/omp/PROVENANCE.md`](vendor/omp/PROVENANCE.md)

The local fallback model is [**SmolLM2-135M**](https://huggingface.co/HuggingFaceTB/SmolLM2-135M) by Hugging Face.

The bundled English frequency dictionary is derived from [**wordfreq**](https://github.com/rspeer/wordfreq) by Robyn Speer.

Licenses and full third-party attribution:

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

---

<div align="center">

Built for [**Pi**](https://github.com/badlogic/pi-mono).

### Type less. Keep moving.

</div>
