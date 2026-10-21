import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { npm } from "./npm.mjs";
const [packed] = JSON.parse(
  npm(["pack", "--ignore-scripts", "--dry-run", "--json"]),
);
const names = packed.files.map((f) => f.path);
for (const name of [
  "src/pi-ghost-autocomplete.ts",
  "src/editor/ghost-text-editor.ts",
  "licenses/OMP-MIT.txt",
  "licenses/SmolLM2-APACHE-2.0.txt",
  "THIRD_PARTY_NOTICES.md",
])
  assert.ok(names.includes(name), name);
assert.ok(
  !names.some((p) =>
    /node_modules|\.gguf$|\.part|memory\.json|\/target\//.test(p),
  ),
);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const file of manifest.pi.extensions) assert.ok(existsSync(file));
console.log(
  `Verified ${names.length} parent package files, no weights or private state.`,
);
