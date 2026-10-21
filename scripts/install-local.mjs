import { npm } from "./npm.mjs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const targets = { "win32-x64": "win32-x64-msvc", "linux-x64": "linux-x64-gnu" };
const target = targets[`${process.platform}-${process.arch}`];
if (!target)
  throw new Error(
    "This local release candidate contains Windows x64 and glibc Linux x64 binaries only.",
  );
const artifactRoot = resolve(process.argv[2] || "artifacts");
const agentDir = resolve(
  process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
);
const files = [
  "pi-ghost-autocomplete-0.1.0.tgz",
  `sheethappiness-pi-ghost-autocomplete-${target}-0.1.0.tgz`,
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
const installed = join(agentDir, "npm/node_modules/pi-ghost-autocomplete");
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
