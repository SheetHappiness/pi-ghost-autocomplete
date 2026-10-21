import assert from "node:assert/strict";
import { test } from "node:test";
import { LazyPredictor } from "../src/runtime.ts";
import type { Predictor } from "../src/completion/types.ts";
test("lazy startup is single flight, observes only a ready backend and closes once", async () => {
  let prepare = 0,
    load = 0,
    closed = 0;
  const observed: string[] = [];
  const engine: Predictor = {
    async ready() {},
    async complete() {
      return { suffix: "lo", confidence: 1 };
    },
    async observe(p) {
      observed.push(...p);
    },
    async feedback() {},
    async persist() {},
    async close() {
      closed++;
    },
  };
  const runtime = new LazyPredictor("state", {
    async prepare() {
      prepare++;
      return "model";
    },
    load() {
      load++;
      return engine;
    },
  });
  assert.equal(prepare, 0);
  await runtime.observe(["before ready"]);
  assert.deepEqual(observed, []);
  const hints = await Promise.all([
    runtime.complete("", "hel"),
    runtime.complete("", "hel"),
  ]);
  assert.equal(prepare, 1);
  assert.equal(load, 1);
  assert.equal(hints[0]?.suffix, "lo");
  await runtime.observe(["submitted"]);
  assert.deepEqual(observed, ["before ready", "submitted"]);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(closed, 1);
  await assert.rejects(runtime.complete("", "hel"), /closed/);
});
test("startup failure is sticky until an explicit new runtime", async () => {
  let attempts = 0;
  const runtime = new LazyPredictor("state", {
    async prepare() {
      attempts++;
      throw new Error("offline");
    },
    load() {
      throw new Error("must not load");
    },
  });
  await assert.rejects(runtime.ready(), /offline/);
  await assert.rejects(runtime.ready(), /offline/);
  assert.equal(attempts, 1);
  await runtime.close();
});
test("shutdown during download aborts and cannot create native engine", async () => {
  let signal: AbortSignal | undefined;
  const runtime = new LazyPredictor("state", {
    prepare(s) {
      signal = s;
      return new Promise((_r, reject) =>
        s.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    },
    load() {
      throw new Error("late load");
    },
  });
  const ready = runtime.ready();
  await runtime.close();
  assert.equal(signal?.aborted, true);
  await assert.rejects(ready, /aborted|closed/);
});
test("submissions during preparation flush once, in order, without starting preparation themselves", async () => {
  let finish: (dir: string) => void = () => {};
  let preparations = 0;
  const observed: string[] = [];
  const engine: Predictor = {
    async ready() {},
    async complete() {
      return null;
    },
    async observe(p) {
      observed.push(...p);
    },
    async feedback() {},
    async persist() {},
    async close() {},
  };
  const runtime = new LazyPredictor("state", {
    prepare() {
      preparations++;
      return new Promise((r) => {
        finish = r;
      });
    },
    load() {
      return engine;
    },
  });
  await runtime.observe(["first"]);
  assert.equal(preparations, 0);
  const ready = runtime.ready();
  await runtime.observe(["second"]);
  finish("model");
  await ready;
  assert.deepEqual(observed, ["first", "second"]);
  await runtime.close();
});
