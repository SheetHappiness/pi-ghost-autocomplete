import { maskNonProse } from "../completion/markdown-prose.ts";
import {
  isProseWord,
  lineContext,
  ProseSource,
} from "../completion/prose-gate.ts";
import type { Suggestion } from "../completion/types.ts";
import {
  DEFAULT_DICTIONARY_POLICY as defaults,
  decay,
  lexical,
} from "./ranking.ts";

export interface WordStats {
  word: string;
  promptCount: number;
  updatedAt: number;
}
export interface PrefixStats {
  prefix: string;
  word: string;
  acceptCount: number;
  updatedAt: number;
}
export interface DictionaryState {
  words: WordStats[];
  pairs: PrefixStats[];
}
export type CommonWords = readonly (readonly [string, number])[];
export const normalizeWord = (word: string) =>
  word.normalize("NFC").replaceAll("’", "'").toLowerCase();
export const validWord = (word: string) =>
  /^[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*$/u.test(word) &&
  [...word].length >= 2 &&
  [...word].length <= 64;
const pairKey = (prefix: string, word: string) => `${prefix}\0${word}`;

export function wordsFromPrompt(text: string): string[] {
  if (text.length > 20_000 || text.includes("[paste #")) return [];
  const lines = text.split("\n"),
    source = new ProseSource(),
    words = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      mask = maskNonProse(line);
    for (const match of line.matchAll(/[\p{L}\p{M}'’]+/gu)) {
      const start = match.index,
        end = start + match[0].length;
      const word = normalizeWord(match[0]);
      if (
        validWord(word) &&
        isProseWord(line, mask, start, end) &&
        source.isProse(lineContext(lines, i, text), start, end)
      )
        words.add(word);
    }
  }
  return [...words];
}

export class DictionaryIndex {
  private common = new Map<string, number>();
  private words = new Map<string, WordStats>();
  private pairs = new Map<string, PrefixStats>();
  private keys: string[] = [];
  private pairsByPrefix = new Map<string, Map<string, PrefixStats>>();
  private dirty = true;
  private policy: typeof defaults;

  constructor(common: CommonWords, options: Partial<typeof defaults> = {}) {
    this.policy = { ...defaults, ...options };
    for (const [raw, frequency] of common) {
      const word = normalizeWord(raw);
      if (
        validWord(word) &&
        Number.isFinite(frequency) &&
        frequency > 0 &&
        frequency <= 1
      )
        this.common.set(word, frequency);
    }
  }

  replace(state: DictionaryState): void {
    this.words = new Map(state.words.map((w) => [w.word, { ...w }]));
    this.pairs = new Map(
      state.pairs.map((p) => [pairKey(p.prefix, p.word), { ...p }]),
    );
    this.dirty = true;
  }

  learnPrompt(text: string, now: number): void {
    this.learnWords(wordsFromPrompt(text), now);
  }

  learnWords(words: readonly string[], now: number): void {
    for (const word of new Set(words)) {
      if (!validWord(word)) continue;
      const old = this.words.get(word);
      const at = Math.max(now, old?.updatedAt ?? now);
      this.words.set(word, {
        word,
        promptCount:
          (old ? decay(old.promptCount, old.updatedAt, at) : 0) +
          decay(1, now, at),
        updatedAt: at,
      });
    }
    this.dirty = true;
    this.prune(now);
  }

  accept(prefix: string, suffix: string, now: number): void {
    const word = normalizeWord(prefix + suffix);
    prefix = normalizeWord(prefix);
    if (!validWord(word) || !word.startsWith(prefix) || word === prefix) return;
    const key = pairKey(prefix, word),
      old = this.pairs.get(key);
    const at = Math.max(now, old?.updatedAt ?? now);
    this.pairs.set(key, {
      prefix,
      word,
      acceptCount:
        (old ? decay(old.acceptCount, old.updatedAt, at) : 0) +
        decay(1, now, at),
      updatedAt: at,
    });
    if (!this.words.has(word))
      this.words.set(word, { word, promptCount: 0, updatedAt: now });
    this.dirty = true;
    this.prune(now);
  }

  private prune(now: number): void {
    if (this.pairs.size > this.policy.maxPairs) {
      const pairs = [...this.pairs.values()].sort(
        (a, b) =>
          decay(b.acceptCount, b.updatedAt, now) -
            decay(a.acceptCount, a.updatedAt, now) ||
          lexical(pairKey(a.prefix, a.word), pairKey(b.prefix, b.word)),
      );
      this.pairs = new Map(
        pairs
          .slice(0, this.policy.maxPairs)
          .map((p) => [pairKey(p.prefix, p.word), p]),
      );
    }
    if (this.words.size > this.policy.maxWords) {
      const accepts = new Map<string, number>();
      for (const p of this.pairs.values())
        accepts.set(
          p.word,
          (accepts.get(p.word) ?? 0) +
            3 * decay(p.acceptCount, p.updatedAt, now),
        );
      const score = (w: WordStats) =>
        decay(w.promptCount, w.updatedAt, now) + (accepts.get(w.word) ?? 0);
      const words = [...this.words.values()].sort(
        (a, b) => score(b) - score(a) || lexical(a.word, b.word),
      );
      this.words = new Map(
        words.slice(0, this.policy.maxWords).map((w) => [w.word, w]),
      );
      for (const [key, p] of this.pairs)
        if (!this.words.has(p.word)) this.pairs.delete(key);
    }
  }

  snapshot(now: number): DictionaryState {
    this.prune(now);
    return {
      words: [...this.words.values()].map((w) => ({ ...w })),
      pairs: [...this.pairs.values()].map((p) => ({ ...p })),
    };
  }

  lookup(rawPrefix: string, now: number): Suggestion | undefined {
    const prefix = normalizeWord(rawPrefix),
      policy = this.policy;
    if ([...prefix].filter((c) => /\p{L}/u.test(c)).length < policy.minPrefix)
      return;
    const lower = rawPrefix.toLowerCase(),
      upper = rawPrefix.toUpperCase();
    const title =
      rawPrefix[0]?.toUpperCase() + rawPrefix.slice(1).toLowerCase();
    if (rawPrefix !== lower && rawPrefix !== upper && rawPrefix !== title)
      return;
    if (this.common.has(prefix) || this.words.has(prefix)) return;
    if (this.dirty) {
      // UTF-16 order is used consistently for binary search; ranking ties use code points.
      this.keys = [
        ...new Set([...this.common.keys(), ...this.words.keys()]),
      ].sort();
      this.pairsByPrefix.clear();
      for (const pair of this.pairs.values()) {
        let words = this.pairsByPrefix.get(pair.prefix);
        if (!words) {
          words = new Map();
          this.pairsByPrefix.set(pair.prefix, words);
        }
        words.set(pair.word, pair);
      }
      this.dirty = false;
    }
    let low = 0,
      high = this.keys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.keys[mid] < prefix) low = mid + 1;
      else high = mid;
    }
    let top: { word: string; score: number; supported: boolean } | undefined;
    let runner = 0,
      sum = 0;
    const prefixPairs = this.pairsByPrefix.get(prefix);
    for (
      let i = low;
      i < this.keys.length && this.keys[i].startsWith(prefix);
      i++
    ) {
      const word = this.keys[i],
        personal = this.words.get(word),
        pair = prefixPairs?.get(word);
      const common = this.common.get(word) ?? 0;
      const count = personal
        ? decay(personal.promptCount, personal.updatedAt, now)
        : 0;
      const accepted = pair ? decay(pair.acceptCount, pair.updatedAt, now) : 0;
      const score = common * 1e6 + count + 3 * accepted;
      // One observation never exceeds 1; two recent observations decay slightly below 2.
      const supported =
        common >= policy.minCommonFrequency || count > 1 || accepted > 0;
      sum += score;
      if (
        !top ||
        score > top.score ||
        (score === top.score && lexical(word, top.word) < 0)
      ) {
        runner = Math.max(runner, top?.score ?? 0);
        top = { word, score, supported };
      } else runner = Math.max(runner, score);
    }
    if (
      !top?.supported ||
      top.score < policy.minScore ||
      !sum ||
      top.score / sum < policy.minShare ||
      (runner && top.score / runner < policy.minMargin)
    )
      return;
    let suffix = top.word.slice(prefix.length);
    if (rawPrefix === upper) suffix = suffix.toUpperCase();
    if (rawPrefix.includes("’")) suffix = suffix.replaceAll("'", "’");
    return suffix ? { suffix, confidence: 1 } : undefined;
  }
}
