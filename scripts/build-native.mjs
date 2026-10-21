import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const result = spawnSync(
  process.env.CARGO || "cargo",
  [
    "build",
    "--manifest-path",
    "native/Cargo.toml",
    "--release",
    "--locked",
    "-p",
    "ghost-native",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
mkdirSync("artifacts", { recursive: true });
const name =
  process.platform === "win32"
    ? "ghost_native.dll"
    : process.platform === "darwin"
      ? "libghost_native.dylib"
      : "libghost_native.so";
copyFileSync(
  resolve(process.env.CARGO_TARGET_DIR || "native/target", "release", name),
  "artifacts/ghost-native.node",
);
