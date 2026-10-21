import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { npm } from "../scripts/npm.mjs";

test("release preflight requires every matching native archive before the parent", async () => {
  const { releasePlan } = await import("../scripts/release.mjs");
  const root = mkdtempSync(join(tmpdir(), "ghost-release-"));
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  const parent = {
    name: "@test/ghost",
    version: "1.2.3",
    license: "MIT",
    optionalDependencies: { "@test/ghost-win32-x64-msvc": "1.2.3" },
  };
  function pack(manifest, native = false) {
    const dir = join(root, native ? "native" : "parent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "LICENSE"), "test license");
    writeFileSync(join(dir, "THIRD_PARTY_NOTICES.md"), "test attribution");
    if (native)
      writeFileSync(join(dir, "ghost-native.node"), "test binary fixture");
    npm(["pack", "--ignore-scripts", "--pack-destination", artifacts], {
      cwd: dir,
    });
  }
  try {
    pack(parent);
    assert.throws(
      () => releasePlan(parent, artifacts),
      /missing.*@test\/ghost-win32/i,
    );
    pack(
      {
        name: "@test/ghost-win32-x64-msvc",
        version: "1.2.3",
        os: ["linux"],
        cpu: ["x64"],
        main: "ghost-native.node",
      },
      true,
    );
    assert.throws(() => releasePlan(parent, artifacts), /platform/i);
    pack(
      {
        name: "@test/ghost-win32-x64-msvc",
        version: "1.2.3",
        os: ["win32"],
        cpu: ["x64"],
        main: "ghost-native.node",
      },
      true,
    );
    const plan = releasePlan(parent, artifacts);
    assert.deepEqual(
      plan.map((entry) => entry.name),
      ["@test/ghost-win32-x64-msvc", "@test/ghost"],
    );
    assert.match(plan[0].integrity, /^sha512-/);
    pack({ ...parent, version: "1.2.2" });
    rmSync(join(artifacts, "test-ghost-1.2.3.tgz"));
    assert.throws(
      () => releasePlan(parent, artifacts),
      /missing.*@test\/ghost@1.2.3/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
