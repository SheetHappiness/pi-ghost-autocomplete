import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPredictor } from "../src/native/load.ts";
test(
  "actual addon startup error, repeated close, reject after close",
  { skip: !process.env.PI_GHOST_NATIVE_PATH },
  async () => {
    const engine = loadPredictor({
      modelDir: "missing-model",
      stateDir: "missing-state",
    });
    await assert.rejects(engine.ready(), /config.json|model/i);
    await engine.close();
    await engine.close();
    await assert.rejects(engine.complete("please ", "hel"), /closed/);
  },
);
