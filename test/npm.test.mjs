import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { npm } from "../scripts/npm.mjs";

test("npm failures remain actionable when stdio is inherited or suppressed", () => {
  const root = mkdtempSync(join(tmpdir(), "ghost-npm-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ private: true }),
    );
    assert.throws(
      () => npm(["run", "missing-script"], { cwd: root, stdio: "ignore" }),
      /npm exited with code 1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
