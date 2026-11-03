<div align="center">

# pi-autocomplete

**Ghost text autocomplete for Pi.**

[![npm](https://img.shields.io/npm/v/pi-autocomplete?style=flat&label=npm)](https://www.npmjs.com/package/pi-autocomplete)
[![Pi](https://img.shields.io/badge/Pi-extension-222?style=flat)](https://github.com/badlogic/pi-mono)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-000?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SmolLM2](https://img.shields.io/badge/SmolLM2-135M-yellow?style=flat)](https://huggingface.co/HuggingFaceTB/SmolLM2-135M)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.19-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/SheetHappiness/pi-ghost-autocomplete?style=flat)](LICENSE)


## What does it do?

`pi-autocomplete` adds **inline ghost-text completion** to Pi's prompt editor.

As you type, it tries to predict the rest of the current word and shows the suggestion directly after the cursor.

Press **`Tab`** or **`→`** to accept it.  
Press **`Esc`** to dismiss it.

It uses a local dictionary for obvious completions and falls back to a small local language model when the prefix is ambiguous.

<br>

![pi-autocomplete demo](./assets/32.gif)

</div>


The goal is simple: make repetitive typing in Pi a little faster without changing how the editor normally works.

## Install

```sh
pi install npm:pi-autocomplete
```

No Rust toolchain is needed for normal installation.

## How it works

The completion path is roughly:

```text
typed prefix
    ↓
common dictionary
    ↓
personal dictionary
    ↓
SmolLM2 fallback
    ↓
ghost suggestion
```

The plugin first checks a bundled English frequency dictionary together with locally learned vocabulary.

If it finds a confident match, the completion is returned immediately without model inference.

If the prefix is ambiguous, it falls back to **SmolLM2-135M** running locally on CPU.

The model is prepared in the background when an interactive Pi session starts.

## Personal dictionary

The plugin can learn vocabulary from the prose you submit and from suggestions you accept.

Ranking takes into account:

- common English frequency
- your own word frequency
- how recently you used the word
- previous acceptances for the same prefix

The personal dictionary is stored locally and shared between Pi sessions.

Repeated words inside one submitted prompt count once.

Code, paths, slash commands and paste markers are excluded from personal vocabulary learning.

To clear the learned dictionary:

```text
/ghost dictionary clear
```

## Controls

| Key | Action |
|---|---|
| `Tab` | Accept the current suggestion |
| `→` | Accept the current suggestion |
| `Esc` | Dismiss it |
| Undo | Undo one accepted completion |

Pi's own slash commands and file completion keep priority.

Suggestions that cannot fit correctly in the available terminal width are hidden instead of forcing broken rendering.

## Commands

```text
/ghost on
/ghost off
/ghost status
/ghost retry
/ghost dictionary clear
```

`/ghost status` reports dictionary and model readiness separately.

`/ghost retry` retries predictor initialization after a failure.

## Local model

The fallback model is [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M).

It runs through a native Rust predictor on a dedicated thread.

Model files are downloaded on first use, verified, and cached locally.

Prompt text is not sent to an external model service.

The dictionary remains usable while the model is loading or if the native predictor fails.

## Platforms

Prebuilt native packages are available for:

- Windows x64
- Linux x64
- Linux ARM64
- macOS ARM64

## Stack

**Pi** · **TypeScript** · **Rust** · **SmolLM2-135M** · **Node.js**

The Pi extension, editor integration and completion orchestration are written in TypeScript.

The local predictor is implemented as a native Rust module.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check
```

Native development additionally requires Rust.

Release and packaging details are documented in [`docs/releasing.md`](docs/releasing.md).

## Credits

Some of the prose detection, completion logic and native predictor code was adapted from [Oh My Pi](https://github.com/can1357/oh-my-pi).

The exact upstream commit and file-level changes are documented in [`vendor/omp/PROVENANCE.md`](vendor/omp/PROVENANCE.md).

The fallback model is [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M) by Hugging Face.

The bundled English frequency dictionary is derived from [wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer.

Full third-party attribution and licenses are available in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT
