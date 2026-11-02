import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { npm } from "./npm.mjs";

const root = await mkdtemp(join(tmpdir(), "ghost-dictionary-package-"));
try {
  const [packed] = JSON.parse(
    npm(["pack", "--ignore-scripts", "--pack-destination", root, "--json"]),
  );
  for (const path of [
    "src/dictionary/common-en.json",
    "src/dictionary/PROVENANCE.md",
    "licenses/wordfreq-CC-BY-SA-4.0.txt",
    "licenses/wordfreq-NOTICE.md",
  ])
    assert.ok(
      packed.files.some((f) => f.path === path),
      path,
    );
  assert.ok(
    !packed.files.some((f) => /personal-v1\.json|memory\.json/.test(f.path)),
  );
  const extracted = join(root, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-xf", join(root, packed.filename), "-C", extracted]);
  const { PersonalDictionaryStore } = await import(
    pathToFileURL(join(extracted, "package/src/dictionary/store.ts")).href
  );
  const dictionary = new PersonalDictionaryStore(
    join(root, "state/personal-v1.json"),
  );
  await dictionary.load();
  assert.equal(dictionary.lookup("becau")?.suffix, "se");
  await dictionary.close();
  console.log(
    `Verified ${packed.filename}: bundled dictionary loads from an extracted tarball without project node_modules.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
