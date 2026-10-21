import { npm } from "./npm.mjs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const targets = {
  "win32-x64": "win32-x64-msvc",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "darwin-arm64": "darwin-arm64",
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target)
  throw new Error(
    "Supported targets: Windows x64, glibc Linux x64/ARM64 and macOS ARM64.",
  );
const artifactRoot = resolve(process.argv[2] || "artifacts");
const parent = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const agentDir = resolve(
  process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
);
const files = [
  `${parent.name.replace(/^@/, "").replace("/", "-")}-${parent.version}.tgz`,
  `sheethappiness-pi-ghost-autocomplete-${target}-${parent.version}.tgz`,
].map((n) => join(artifactRoot, n));
if (files.some((p) => !existsSync(p)))
  throw new Error(
    "Both parent and matching native tarballs must exist in the artifact directory.",
  );
console.log(
  npm([
    "install",
    "--prefix",
    join(agentDir, "npm"),
    "--ignore-scripts",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
    ...files,
  ]),
);
const installed = join(agentDir, "npm/node_modules", parent.name);
// Use the user's Pi executable only when they explicitly run this installer.
const command = process.platform === "win32" ? "pi.cmd" : "pi";
if (process.platform === "win32") {
  // Avoid cmd string construction: invoke the host's node CLI when installed next to Pi.
  console.log(
    `Native packages installed. Register the extension with: pi install "${installed}"`,
  );
} else {
  const result = spawnSync(command, ["install", installed], {
    stdio: "inherit",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });
  if (result.status !== 0)
    throw new Error(`Register the extension manually: pi install ${installed}`);
}
