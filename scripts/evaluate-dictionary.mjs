import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { DictionaryIndex } from "../src/dictionary/lexicon.ts";

const common = JSON.parse(
  await readFile(
    new URL("../src/dictionary/common-en.json", import.meta.url),
    "utf8",
  ),
);
const fixture = JSON.parse(
  await readFile(
    new URL("../test/fixtures/dictionary-evaluation.json", import.meta.url),
    "utf8",
  ),
);
const now = 1_800_000_000_000;
const report = {
  provenance: fixture.provenance,
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  cpu: cpus()[0]?.model,
};
for (const split of ["tuning", "evaluation"]) {
  const dictionary = new DictionaryIndex(common);
  let queries = 0,
    hits = 0,
    correct = 0,
    occurrences = 0,
    savedKeystrokes = 0;
  const errors = [];
  for (const sentence of fixture[split]) {
    const words = sentence.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) ?? [];
    for (const word of words) {
      occurrences++;
      let firstSaved = false;
      for (let n = 2; n < word.length; n++) {
        queries++;
        const hint = dictionary.lookup(word.slice(0, n), now);
        if (!hint) continue;
        hits++;
        if (word.slice(0, n) + hint.suffix === word) {
          correct++;
          if (!firstSaved) {
            savedKeystrokes += word.length - n;
            firstSaved = true;
          }
        } else if (errors.length < 20)
          errors.push({
            prefix: word.slice(0, n),
            expected: word,
            actual: word.slice(0, n) + hint.suffix,
          });
      }
    }
    // No evaluation word is learned until its whole sentence has been replayed.
    dictionary.learnPrompt(sentence, now);
  }
  report[split] = {
    occurrences,
    queries,
    hits,
    correct,
    precision: correct / (hits || 1),
    coverage: hits / (queries || 1),
    fallbackFraction: 1 - hits / (queries || 1),
    simulatedSavedKeystrokes: savedKeystrokes,
    errors,
  };
}
const benchmark = new DictionaryIndex(common);
for (let n = 0; n < 20_000; n++) {
  let k = n,
    suffix = "";
  do {
    suffix = String.fromCharCode(97 + (k % 26)) + suffix;
    k = Math.floor(k / 26);
  } while (k);
  benchmark.accept("zzpersonal", suffix, now);
}
const prefixes = [
  "becau",
  "implementa",
  "zzp",
  "zzpersonal",
  "con",
  "unfamiliar",
];
for (let n = 0; n < 1000; n++)
  benchmark.lookup(prefixes[n % prefixes.length], now);
const times = [];
for (let n = 0; n < 10_000; n++) {
  const t = performance.now();
  benchmark.lookup(prefixes[n % prefixes.length], now);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
report.lookup = {
  commonWords: common.length,
  personalWords: benchmark.snapshot(now).words.length,
  warmup: 1000,
  queries: 10000,
  p50Ms: times[5000],
  p95Ms: times[9500],
};
report.gates = {
  precision: report.evaluation.precision >= 0.95,
  latency: report.lookup.p95Ms <= 5,
  minimumOccurrences: report.evaluation.occurrences >= 300,
};
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.gates).some((v) => !v)) process.exitCode = 1;
