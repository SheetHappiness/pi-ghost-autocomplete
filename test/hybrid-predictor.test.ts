import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HybridPredictor } from "../src/completion/hybrid-predictor.ts";
import { PersonalDictionaryStore } from "../src/dictionary/store.ts";
import type { Predictor } from "../src/completion/types.ts";

const tick = () => new Promise((r) => setImmediate(r));
async function setup(
  t: { after(fn: () => Promise<void>): void },
  ready = async () => {},
) {
  const dir = await mkdtemp(join(tmpdir(), "ghost-hybrid-"));
  const dictionary = new PersonalDictionaryStore(join(dir, "dictionary.json"), {
    common: [
      ["because", 0.001],
      ["implementation", 0.00002],
      ["implementations", 0.00002],
    ],
  });
  let calls = 0,
    closes = 0;
  const model: Predictor = {
    ready,
    async complete() {
      calls++;
      return { suffix: "tion", confidence: 0.8 };
    },
    async observe() {},
    async feedback() {},
    async persist() {},
    async close() {
      closes++;
    },
  };
  const diagnostics: string[] = [];
  const hybrid = new HybridPredictor(model, dictionary, (m) =>
    diagnostics.push(m),
  );
  t.after(async () => {
    await hybrid.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    hybrid,
    dictionary,
    model,
    diagnostics,
    calls: () => calls,
    closes: () => closes,
  };
}

test("dictionary serves hits while model loads; ambiguous queries fall back once", async (t) => {
  let release!: () => void;
  const f = await setup(
    t,
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const ready = f.hybrid.ready();
  await f.dictionary.load();
  assert.equal(f.hybrid.fastComplete("", "becau")?.suffix, "se");
  assert.equal((await f.hybrid.complete("", "becau"))?.suffix, "se");
  assert.equal(f.calls(), 0);
  release();
  await ready;
  assert.equal((await f.hybrid.complete("", "implementa"))?.suffix, "tion");
  assert.equal(f.calls(), 1);
});

test("model startup failure is reported once and dictionary stays usable", async (t) => {
  const f = await setup(t, async () => {
    throw new Error("offline");
  });
  await f.hybrid.ready();
  assert.equal(f.hybrid.fastComplete("", "becau")?.suffix, "se");
  assert.equal(await f.hybrid.complete("", "unknown"), null);
  assert.equal(await f.hybrid.complete("", "another"), null);
  assert.equal(f.calls(), 0);
  assert.equal(f.diagnostics.length, 1);
});

test("acceptance learns once; negative feedback is not negative training; close is idempotent", async (t) => {
  const f = await setup(t);
  await f.hybrid.ready();
  await f.hybrid.feedback("", "capric", "orn", false);
  assert.equal(f.hybrid.fastComplete("", "capric"), undefined);
  await f.hybrid.feedback("", "capric", "orn", true);
  assert.equal(f.hybrid.fastComplete("", "capric")?.suffix, "orn");
  await Promise.all([f.hybrid.close(), f.hybrid.close()]);
  assert.equal(f.closes(), 1);
  assert.equal(f.hybrid.fastComplete("", "becau"), undefined);
});

test("dictionary load failure leaves model completion available", async (t) => {
  const f = await setup(t);
  f.dictionary.load = async () => {
    throw new Error("bad dictionary");
  };
  await f.hybrid.ready();
  assert.equal((await f.hybrid.complete("", "unknown"))?.suffix, "tion");
  assert.equal(f.calls(), 1);
  assert.equal(f.diagnostics.length, 1);
});

test("model observations do not block personal learning", async (t) => {
  const f = await setup(t);
  await f.hybrid.ready();
  f.model.observe = () => new Promise<void>(() => {});
  await f.hybrid.observe(["capricorn", "capricorn"]);
  assert.equal(f.hybrid.fastComplete("", "capric")?.suffix, "orn");
  await tick();
});

test("explicit persist saves both dictionary and model state", async (t) => {
  const f = await setup(t);
  await f.hybrid.ready();
  let persisted = 0;
  f.model.persist = async () => {
    persisted++;
  };
  await f.hybrid.feedback("", "capric", "orn", true);
  await f.hybrid.persist();
  assert.equal(persisted, 1);
});
