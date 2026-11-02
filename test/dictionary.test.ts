import assert from "node:assert/strict";
import { test } from "node:test";
import { DictionaryIndex } from "../src/dictionary/lexicon.ts";
import { decay } from "../src/dictionary/ranking.ts";

const now = 1_800_000_000_000;
const common = [
  ["because", 0.001],
  ["implementation", 0.00003],
  ["implementations", 0.000025],
] as const;

test("common hits abstain on ambiguity, complete words, and short prefixes", () => {
  const d = new DictionaryIndex(common);
  assert.deepEqual(d.lookup("becau", now), { suffix: "se", confidence: 1 });
  for (const p of ["be", "because", "implementa", "unknown"])
    assert.equal(d.lookup(p, now), undefined, p);
  assert.equal(d.lookup("Becau", now)?.suffix, "se");
  assert.equal(d.lookup("BECAU", now)?.suffix, "SE");
  assert.equal(d.lookup("bEcAu", now), undefined);
});

test("learning deduplicates each prompt and requires repeat support", () => {
  const d = new DictionaryIndex([]);
  d.learnPrompt("capricorn capricorn capricorn", now);
  assert.equal(d.lookup("capric", now), undefined);
  d.learnPrompt("We discuss capricorn again", now + 1000);
  assert.equal(d.lookup("capric", now + 1000)?.suffix, "orn");
  const e = new DictionaryIndex([]);
  e.accept("capric", "orn", now);
  assert.equal(e.lookup("capric", now)?.suffix, "orn");
  assert.equal(e.lookup("capri", now), undefined);
});

test("learning excludes markdown code, paths, commands, digits and paste markers", () => {
  const d = new DictionaryIndex([]);
  const text =
    "normalword `inlineword` /pathword camelWord item123 https://urlword.test\n```\nfencedword\n```\n/commandword argumentword";
  d.learnPrompt(text, now);
  d.learnPrompt(text, now);
  assert.equal(d.lookup("normal", now)?.suffix, "word");
  for (const p of [
    "inline",
    "path",
    "camel",
    "item",
    "url",
    "fenced",
    "command",
    "argument",
  ])
    assert.equal(d.lookup(p, now), undefined, p);
  d.learnPrompt("[paste #1] pastedword", now);
  d.learnPrompt("[paste #1] pastedword", now);
  assert.equal(d.lookup("pasted", now), undefined);
});

test("Unicode NFC and apostrophes preserve the original typed prefix", () => {
  const d = new DictionaryIndex([
    ["працювати", 0.001],
    ["caféine", 0.001],
    ["don't", 0.001],
  ]);
  assert.equal(d.lookup("прац", now)?.suffix, "ювати");
  assert.equal(d.lookup("cafe\u0301", now)?.suffix, "ine");
  assert.equal(d.lookup("don’", now)?.suffix, "t");
});

test("decay halves counts after 30 days; lookup covers the end of a large range", () => {
  assert.equal(decay(8, now, now + 30 * 86_400_000), 4);
  const words: [string, number][] = Array.from({ length: 1000 }, (_, n) => [
    "pref" + String.fromCodePoint(0x4e00 + n),
    1e-9,
  ]);
  words.push(["prefixwinner", 0.01]);
  assert.equal(
    new DictionaryIndex(words).lookup("pref", now)?.suffix,
    "ixwinner",
  );
});

test("personal and acceptance caps retain the strongest entries", () => {
  const d = new DictionaryIndex([], { maxWords: 2, maxPairs: 2 });
  d.accept("str", "ongest", now);
  d.accept("str", "ongest", now);
  d.accept("oth", "erword", now);
  d.accept("las", "tword", now);
  const state = d.snapshot(now);
  assert.equal(state.words.length, 2);
  assert.equal(state.pairs.length, 2);
  assert.equal(d.lookup("str", now)?.suffix, "ongest");
});

test("out-of-order writer observations decay to the newest timestamp", () => {
  const later = now + 30 * 86_400_000;
  const d = new DictionaryIndex([]);
  d.learnPrompt("capricorn", later);
  d.learnPrompt("capricorn", now);
  d.accept("capric", "orn", later);
  d.accept("capric", "orn", now);
  const state = d.snapshot(later);
  assert.equal(state.words[0].updatedAt, later);
  assert.equal(state.words[0].promptCount, 1.5);
  assert.equal(state.pairs[0].updatedAt, later);
  assert.equal(state.pairs[0].acceptCount, 1.5);
});
