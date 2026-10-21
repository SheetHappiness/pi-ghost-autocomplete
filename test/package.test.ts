import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
test("Pi package has exact platform deps, no runtime host or install hooks", () => {
  const p = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.deepEqual(p.pi.extensions, ["./src/pi-ghost-autocomplete.ts"]);
  assert.ok(existsSync(new URL(p.pi.extensions[0], root)));
  assert.equal(Object.keys(p.optionalDependencies ?? {}).length, 4);
  for (const value of Object.values(p.optionalDependencies))
    assert.equal(value, p.version);
  assert.equal(p.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
  for (const hook of ["install", "preinstall", "postinstall", "prepare"])
    assert.equal(p.scripts[hook], undefined);
});
test("redistributed source and binary attribution exists", () => {
  for (const path of [
    "LICENSE",
    "licenses/OMP-MIT.txt",
    "licenses/SmolLM2-APACHE-2.0.txt",
    "licenses/model-provenance.json",
    "THIRD_PARTY_NOTICES.md",
    "vendor/omp/PROVENANCE.md",
  ])
    assert.ok(existsSync(new URL(path, root)), path);
  const notice = readFileSync(new URL("licenses/OMP-MIT.txt", root), "utf8");
  assert.match(notice, /Can Bölük/);
  assert.match(notice, /Stencil/);
});
