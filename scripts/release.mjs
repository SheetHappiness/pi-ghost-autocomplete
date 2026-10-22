import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { npm } from "./npm.mjs";
import { setTimeout } from "node:timers/promises";

export async function verifyPublished(entry, read = npm, { attempts = 60, intervalMs = 10000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let integrity;
    try {
      integrity = JSON.parse(read([
        "view", `${entry.name}@${entry.version}`, "dist.integrity", "--json",
        "--registry", "https://registry.npmjs.org/",
      ]));
    } catch (error) {
      if (!String(error).includes("E404")) throw error;
      if (attempt + 1 === attempts)
        throw new Error(`Published package still unavailable: ${entry.name}@${entry.version}. Do not republish; check npm processing status.`);
      await setTimeout(intervalMs);
      continue;
    }
    assert.equal(integrity, entry.integrity, `Published integrity mismatch: ${entry.name}`);
    return;
  }
}

const platforms = {
  "win32-x64-msvc": ["win32", "x64"],
  "linux-x64-gnu": ["linux", "x64"],
  "linux-arm64-gnu": ["linux", "arm64"],
  "darwin-arm64": ["darwin", "arm64"],
};

export function releasePlan(parent, directory) {
  const archives = readdirSync(directory)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => {
      const path = resolve(directory, name);
      const manifest = JSON.parse(
        execFileSync("tar", ["-xOf", path, "package/package.json"], {
          encoding: "utf8",
        }),
      );
      return { path, manifest };
    });
  const dependencies = Object.entries(parent.optionalDependencies ?? {});
  assert.ok(dependencies.length, "Parent must declare native packages");
  const expected = [...dependencies, [parent.name, parent.version]];
  return expected.map(([name, version]) => {
    assert.equal(version, parent.version, `Version mismatch: ${name}`);
    const matches = archives.filter(
      (entry) =>
        entry.manifest.name === name && entry.manifest.version === version,
    );
    assert.equal(
      matches.length,
      1,
      `Missing or duplicate archive: ${name}@${version}`,
    );
    const { path, manifest } = matches[0];
    const files = execFileSync("tar", ["-tzf", path], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/);
    assert.ok(
      files.includes("package/LICENSE") &&
        files.includes("package/THIRD_PARTY_NOTICES.md"),
      `Missing licenses: ${name}`,
    );
    assert.ok(
      !files.some((file) =>
        /(?:^|\/)(?:node_modules|target|\.env)(?:\/|$)|\.(?:gguf|part)$|memory\.json$/.test(
          file,
        ),
      ),
      `Private/generated data: ${name}`,
    );
    if (name !== parent.name) {
      const target = Object.keys(platforms).find((target) =>
        name.endsWith(`-${target}`),
      );
      assert.ok(target, `Unknown platform: ${name}`);
      const [os, cpu] = platforms[target];
      assert.deepEqual(manifest.os, [os], `Incorrect platform OS: ${name}`);
      assert.deepEqual(manifest.cpu, [cpu], `Incorrect platform CPU: ${name}`);
      if (os === "linux")
        assert.deepEqual(manifest.libc, ["glibc"], `Incorrect libc: ${name}`);
      assert.equal(manifest.main, "ghost-native.node");
      assert.ok(
        files.includes("package/ghost-native.node"),
        `Missing native binary: ${name}`,
      );
    } else {
      assert.deepEqual(
        manifest.optionalDependencies,
        parent.optionalDependencies,
        "Parent dependency mismatch",
      );
      assert.ok(
        !files.some((file) => file.endsWith(".node")),
        "Parent must not bundle a platform binary",
      );
    }
    const integrity =
      "sha512-" +
      createHash("sha512").update(readFileSync(path)).digest("base64");
    return { name, version, path, integrity };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  assert.ok(
    args.length <= 2 && (!args[1] || args[1] === "--publish"),
    "Usage: node scripts/release.mjs <artifact-directory> [--publish]",
  );
  const parent = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const plan = releasePlan(parent, resolve(args[0] || "artifacts"));
  const registry = "https://registry.npmjs.org/";
  console.log(plan.map((entry) => `${entry.name}@${entry.version}`).join("\n"));
  if (args[1] !== "--publish") {
    for (const entry of plan)
      npm([
        "publish",
        entry.path,
        "--dry-run",
        "--ignore-scripts",
        "--access",
        "public",
        "--registry",
        registry,
      ]);
    console.log(
      "Release preflight passed. No packages published. Add --publish to publish native packages first, parent last.",
    );
  } else {
    for (const entry of plan) {
      let published;
      try {
        published = JSON.parse(
          npm([
            "view",
            `${entry.name}@${entry.version}`,
            "dist.integrity",
            "--json",
            "--registry",
            registry,
          ]),
        );
      } catch (error) {
        if (!String(error).includes("E404")) throw error;
      }
      if (published) {
        assert.equal(
          published,
          entry.integrity,
          `Published content differs: ${entry.name}@${entry.version}`,
        );
        console.log(`Already published with matching integrity: ${entry.name}`);
        continue;
      }
      npm(
        [
          "publish",
          entry.path,
          "--ignore-scripts",
          "--access",
          "public",
          "--registry",
          registry,
        ],
        { stdio: "inherit" },
      );
      console.log(`Waiting for npm availability and integrity: ${entry.name}`);
      await verifyPublished(entry);
    }
  }
}
