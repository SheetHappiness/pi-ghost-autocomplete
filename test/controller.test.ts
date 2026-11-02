import assert from "node:assert/strict";
import { test } from "node:test";
import { GhostController } from "../src/completion/controller.ts";
import type {
  Predictor,
  Suggestion,
  Snapshot,
} from "../src/completion/types.ts";
const snap = (text = "hel", session = "one"): Snapshot => ({
  text,
  line: 0,
  col: text.length,
  session,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const calls: string[] = [];
  const feedback: boolean[] = [];
  const replies: ((result: Suggestion | null) => void)[] = [];
  const backend: Predictor = {
    async ready() {},
    complete(_b, prefix) {
      calls.push(prefix);
      return new Promise((r) => replies.push(r));
    },
    async observe() {},
    async feedback(_b, _p, _s, accepted) {
      feedback.push(accepted);
    },
    async persist() {},
    async close() {},
  };
  let updates = 0;
  const controller = new GhostController(backend, () => updates++);
  return {
    controller,
    backend,
    calls,
    replies,
    feedback,
    updates: () => updates,
  };
}
test("one active plus newest queued, duplicate frames do not duplicate work", async () => {
  const f = setup();
  for (const text of ["he", "hel", "hell", "hell"])
    f.controller.update(snap(text), { before: "", prefix: text });
  assert.deepEqual(f.calls, ["he"]);
  f.replies.shift()!({ suffix: "llo", confidence: 1 });
  await tick();
  assert.deepEqual(f.calls, ["he", "hell"]);
  assert.equal(f.controller.visible(snap("hell")), null);
  f.replies.shift()!({ suffix: "o", confidence: 1 });
  await tick();
  assert.equal(f.controller.visible(snap("hell")), "o");
});
test("Escape tombstone, reset, sessions and dispose reject late results", async () => {
  for (const operation of ["dismiss", "reset", "dispose", "session"]) {
    const f = setup();
    const s = snap();
    f.controller.update(s, { before: "", prefix: "hel" });
    assert.equal(f.replies.length, 1);
    if (operation === "dismiss") f.controller.dismiss(s);
    else if (operation === "session")
      f.controller.update(snap("hel", "two"), undefined);
    else f.controller[operation as "reset" | "dispose"]();
    f.replies.shift()!({ suffix: "lo", confidence: 1 });
    await tick();
    assert.equal(f.controller.visible(s), null, operation);
  }
});
test("projection and divergence feedback once; reject malformed outputs", async () => {
  const f = setup();
  const s = snap();
  f.controller.update(s, { before: "", prefix: "hel" });
  f.replies.shift()!({ suffix: "lo", confidence: 1 });
  await tick();
  assert.equal(f.controller.visible(s), "lo");
  f.controller.update(snap("hell"), { before: "", prefix: "hell" });
  assert.equal(f.controller.visible(snap("hell")), "o");
  f.controller.update(snap("help"), { before: "", prefix: "help" });
  f.controller.update(snap("help"), { before: "", prefix: "help" });
  assert.deepEqual(f.feedback, [false]);
  for (const suffix of ["", "x y", "\n", "\x1b[31m", "1", "ok\u202e"]) {
    const g = setup();
    g.controller.update(s, { before: "", prefix: "hel" });
    g.replies.shift()!({ suffix, confidence: 1 });
    await tick();
    assert.equal(g.controller.visible(s), null);
  }
});
test("startup failure suspends retries and stale errors cannot touch disposed UI", async () => {
  let calls = 0,
    errors = 0;
  const backend: Predictor = {
    async ready() {},
    async complete() {
      calls++;
      throw new Error("offline");
    },
    async observe() {},
    async feedback() {},
    async persist() {},
    async close() {},
  };
  const controller = new GhostController(
    backend,
    () => {},
    () => {
      errors++;
    },
  );
  controller.update(snap(), { before: "", prefix: "hel" });
  await tick();
  for (const text of ["hel", "hell", "hel"]) {
    controller.update(snap(text), { before: "", prefix: text });
    await tick();
  }
  assert.equal(calls, 1);
  assert.equal(errors, 1);
  let reject: (reason: Error) => void = () => {};
  const late = {
    ...backend,
    complete() {
      return new Promise<null>((_r, j) => {
        reject = j;
      });
    },
  };
  const disposed = new GhostController(
    late,
    () => {},
    () => errors++,
  );
  disposed.update(snap(), { before: "", prefix: "hel" });
  disposed.dispose();
  reject(new Error("late"));
  await tick();
  assert.equal(errors, 1);
});
test("newest snapshot returning to active request clears obsolete queued work", async () => {
  const f = setup();
  for (const text of ["he", "hel", "he"])
    f.controller.update(snap(text), { before: "", prefix: text });
  f.replies.shift()!({ suffix: "llo", confidence: 1 });
  await tick();
  assert.deepEqual(f.calls, ["he"]);
});

test("fast dictionary hit bypasses active LLM and survives late results and Escape", async () => {
  const f = setup();
  // The real controller receives a synchronous local source and a deferred model boundary.
  const predictor = f.backend;
  predictor.fastComplete = (_before, prefix) =>
    prefix === "becau" ? { suffix: "se", confidence: 1 } : undefined;
  f.controller.update(snap("hel"), { before: "", prefix: "hel" });
  f.controller.update(snap("becau"), { before: "", prefix: "becau" });
  assert.equal(f.controller.visible(snap("becau")), "se");
  assert.deepEqual(f.calls, ["hel"]);
  f.replies.shift()!({ suffix: "lo", confidence: 1 });
  await tick();
  assert.equal(f.controller.visible(snap("becau")), "se");
  f.controller.dismiss(snap("becau"));
  f.controller.update(snap("becau"), { before: "", prefix: "becau" });
  assert.equal(f.controller.visible(snap("becau")), null);
  assert.deepEqual(f.feedback, [false]);
});

test("dictionary ready after an in-flight miss wins for the same snapshot", async () => {
  const f = setup();
  const predictor = f.backend;
  f.controller.update(snap("becau"), { before: "", prefix: "becau" });
  predictor.fastComplete = () => ({ suffix: "se", confidence: 1 });
  f.controller.update(snap("becau"), { before: "", prefix: "becau" });
  assert.equal(f.controller.visible(snap("becau")), "se");
  f.replies.shift()!({ suffix: "wrong", confidence: 1 });
  await tick();
  assert.equal(f.controller.visible(snap("becau")), "se");
  f.controller.accepted(snap("becau"));
  f.controller.accepted(snap("becau"));
  assert.deepEqual(f.feedback, [true]);
});

test("fast source cannot bypass suffix validation", () => {
  for (const result of [
    { suffix: "\x1b[31m", confidence: 1 },
    { suffix: "two words", confidence: 1 },
    { suffix: "ok", confidence: NaN },
  ]) {
    const f = setup();
    f.backend.fastComplete = () => result;
    f.controller.update(snap(), { before: "", prefix: "hel" });
    assert.equal(f.controller.visible(snap()), null);
  }
});
