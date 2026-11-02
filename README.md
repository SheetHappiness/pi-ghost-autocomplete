<div align="center">

# pi-autocomplete

Ghost text autocomplete for Pi.

[![npm](https://img.shields.io/npm/v/pi-autocomplete?style=flat&label=npm)](https://www.npmjs.com/package/pi-autocomplete)
[![Pi](https://img.shields.io/badge/Pi-extension-222?style=flat)](https://github.com/badlogic/pi-mono)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-000?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SmolLM2](https://img.shields.io/badge/SmolLM2-135M-yellow?style=flat)](https://huggingface.co/HuggingFaceTB/SmolLM2-135M)
[![License](https://img.shields.io/github/license/SheetHappiness/pi-ghost-autocomplete?style=flat)](LICENSE)

<br>

<img src="./assets/32.gif" alt="pi-autocomplete demo" width="900">

</div>

## Install

```sh
pi install npm:pi-autocomplete
```

Start typing normally. A dim suggestion appears after the cursor.

Use `Tab` or `→` to accept it, and `Esc` to dismiss it.

## How it works

The plugin uses a small hybrid autocomplete system.

For common words it first checks a local frequency dictionary and your personal vocabulary. If the prefix is ambiguous, it falls back to a local SmolLM2-135M model running on CPU.

So something like:

```text
imple    → implement
auth     → authentication
middlew  → middleware
```

can usually be completed without calling the model at all.

Everything runs locally.

## Personal dictionary

The plugin can learn words from the prose you submit and from suggestions you accept.

Ranking uses a mix of:

- common word frequency
- your own word frequency
- recency
- previous accepted completions

The personal dictionary is stored locally and shared between Pi sessions.

To clear it:

```text
/ghost dictionary clear
```

## Commands

```text
/ghost on
/ghost off
/ghost status
/ghost retry
/ghost dictionary clear
```

`/ghost status` shows dictionary and model readiness separately.

## Notes

Slash commands and Pi file completion keep priority over ghost suggestions.

The dictionary still works while the model is loading or if the native predictor fails.

The model is downloaded on first use and then cached locally.

## Platforms

Prebuilt packages are available for:

- Windows x64
- Linux x64
- Linux ARM64
- macOS ARM64

You don't need Rust installed for normal use.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check
```

Native development also requires Rust.

## Credits

Some of the prose detection, completion logic and native predictor code was adapted from [Oh My Pi](https://github.com/can1357/oh-my-pi).

The exact source commit and file-level changes are documented in [`vendor/omp/PROVENANCE.md`](vendor/omp/PROVENANCE.md).

The fallback model is [SmolLM2-135M](https://huggingface.co/HuggingFaceTB/SmolLM2-135M) by Hugging Face.

The bundled English frequency dictionary is derived from [wordfreq](https://github.com/rspeer/wordfreq).

Full third-party notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT
