import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPredictor, platformPackage } from "../src/native/load.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
test("platform binary allowlist and unsupported targets", () => {
  assert.equal(
    platformPackage("win32", "x64"),
    "@sheethappiness/pi-ghost-autocomplete-win32-x64-msvc",
  );
  assert.equal(
    platformPackage("linux", "arm64"),
    "@sheethappiness/pi-ghost-autocomplete-linux-arm64-gnu",
  );
  assert.throws(() => platformPackage("android", "arm64"), /Unsupported/);
  assert.throws(() => platformPackage("linux", "ia32"), /Unsupported/);
});
test("missing binary is actionable", () => {
  const previous = process.env.PI_GHOST_NATIVE_PATH;
  process.env.PI_GHOST_NATIVE_PATH = join(
    tmpdir(),
    "ghost-missing-" + randomUUID() + ".node",
  );
  try {
    assert.throws(
      () => loadPredictor({ modelDir: "missing", stateDir: "missing" }),
      /native.*unavailable/i,
    );
  } finally {
    if (previous === undefined) delete process.env.PI_GHOST_NATIVE_PATH;
    else process.env.PI_GHOST_NATIVE_PATH = previous;
  }
});
