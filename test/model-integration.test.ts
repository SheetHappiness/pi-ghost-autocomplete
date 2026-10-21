import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWeights } from "../src/model/weights.ts";
import { loadPredictor } from "../src/native/load.ts";

test(
  "real verified model completes, persists, reopens and rejects state version mismatch",
  { skip: process.env.PI_GHOST_MODEL_TEST !== "1" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ghost-model-test-"));
    const modelDir = await ensureWeights({
      cacheRoot: process.env.PI_GHOST_CACHE_DIR || join(root, "models"),
    });
    const stateDir = join(root, "state");
    const options = { modelDir, stateDir };
    let engine = loadPredictor(options);
    try {
      await engine.ready();
      const hint = await engine.complete("hello ", "wor");
      assert.ok(hint);
      assert.match(hint.suffix, /^[\p{L}\p{M}']+$/u);
      await engine.feedback("hello ", "wor", hint.suffix, true);
      await engine.observe(["please explain the implementation"]);
      await engine.persist();
      await engine.close();
      const state = JSON.parse(
        await readFile(join(stateDir, "memory.json"), "utf8"),
      );
      assert.ok(state.recent.length > 0);
      engine = loadPredictor(options);
      await engine.ready();
      await engine.close();
      await writeFile(
        join(stateDir, "memory.json"),
        JSON.stringify({ ...state, version: 999 }),
      );
      engine = loadPredictor(options);
      await assert.rejects(engine.ready(), /state version/);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
