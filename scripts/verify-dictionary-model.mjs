import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { ensureWeights } from "../src/model/weights.ts";
import { loadPredictor } from "../src/native/load.ts";
import { LazyPredictor } from "../src/runtime.ts";
import { PersonalDictionaryStore } from "../src/dictionary/store.ts";
import { HybridPredictor } from "../src/completion/hybrid-predictor.ts";

assert.ok(
  process.env.PI_GHOST_CACHE_DIR,
  "Set PI_GHOST_CACHE_DIR to a verified local model cache",
);
const root = await mkdtemp(join(tmpdir(), "ghost-real-hybrid-"));
let modelCalls = 0;
const model = new LazyPredictor(join(root, "model-state"), {
  prepare: (signal) =>
    ensureWeights({ cacheRoot: process.env.PI_GHOST_CACHE_DIR, signal }),
  load: (options) => {
    const engine = loadPredictor(options);
    return {
      ready: () => engine.ready(),
      complete: (...args) => {
        modelCalls++;
        return engine.complete(...args);
      },
      observe: (p) => engine.observe(p),
      feedback: (...args) => engine.feedback(...args),
      persist: () => engine.persist(),
      close: () => engine.close(),
    };
  },
});
const dictionary = new PersonalDictionaryStore(join(root, "dictionary.json"));
const warnings = [];
const hybrid = new HybridPredictor(model, dictionary, (m) => warnings.push(m));
const started = performance.now();
try {
  const startup = hybrid.ready();
  await dictionary.load();
  const dictionaryReadyMs = performance.now() - started;
  const modelStateAtDictionaryHit = hybrid.modelStatus;
  let time = performance.now();
  const hit = await hybrid.complete("", "becau");
  const dictionaryHitMs = performance.now() - time;
  assert.equal(hit?.suffix, "se");
  assert.equal(modelCalls, 0);
  await startup;
  assert.equal(hybrid.modelStatus, "ready", warnings.join("; "));
  const startupMs = performance.now() - started;
  const fallbackPrefix = "complet";
  assert.equal(
    hybrid.fastComplete("please explain the ", fallbackPrefix),
    undefined,
  );
  time = performance.now();
  const fallback = await hybrid.complete("please explain the ", fallbackPrefix);
  const fallbackMs = performance.now() - time;
  assert.equal(modelCalls, 1);
  console.log(
    JSON.stringify(
      {
        dictionaryReadyMs,
        modelStateAtDictionaryHit,
        dictionaryHitMs,
        startupMs,
        fallbackPrefix,
        fallbackMs,
        fallback,
        modelCalls,
        warnings,
      },
      null,
      2,
    ),
  );
} finally {
  await hybrid.close();
  await rm(root, { recursive: true, force: true });
}
