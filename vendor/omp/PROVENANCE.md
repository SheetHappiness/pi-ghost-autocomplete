# OMP source provenance

Source: https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99

MIT license retained in licenses/OMP-MIT.txt.

- prompt/markdown-prose.ts: maskNonProse and its helpers, keywordInProse omitted; FENCE_RE inlined from render/render-utils.ts.
- prompt/prose-gate.ts: TypingWord/spelling-only field removed; import extensions added.
- prompt/word-completion.ts: textBefore copied, query gates adapted to logical line end and minimum two letters. Controller independently adapted to snapshot/session lifetime.
- components/editor.ts: acceptance/rendering behavior used as reference only, class not copied.

- crates/pi-predict/src/lib.rs: Query/Suggestion/Config/Predictor retained; Method/apple/ngram removed, open is Smol-only.
- src/prose.rs and smollm/{config,cpu,gguf,mod,search,session,tokenizer}.rs + preamble.txt copied. Metal loading/Device KV variant removed; CPU on every platform. Original unit tests retained; upstream benchmark documentation removed.
