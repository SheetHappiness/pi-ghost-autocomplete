import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { npm } from "./npm.mjs";
const targets = {
  "win32-x64-msvc": ["win32", "x64"],
  "linux-x64-gnu": ["linux", "x64"],
  "linux-arm64-gnu": ["linux", "arm64"],
  "darwin-arm64": ["darwin", "arm64"],
};
const [target, binary] = process.argv.slice(2);
if (!targets[target] || !binary || !existsSync(binary))
  throw new Error("Usage: assemble-platform.mjs <target> <actual-binary-path>");
const p = JSON.parse(readFileSync("package.json", "utf8"));
const dir = resolve("platforms", target);
mkdirSync(dir, { recursive: true });
const [os, cpu] = targets[target];
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify(
    {
      name: `@sheethappiness/pi-ghost-autocomplete-${target}`,
      version: p.version,
      description: "SmolLM2 CPU native predictor for Pi",
      license: "MIT",
      repository: p.repository,
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      main: "ghost-native.node",
      os: [os],
      cpu: [cpu],
      ...(os === "linux" ? { libc: ["glibc"] } : {}),
      engines: { node: ">=22.19.0" },
      files: [
        "ghost-native.node",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "licenses",
        "PROVENANCE.md",
      ],
    },
    null,
    2,
  ) + "\n",
);
copyFileSync(binary, join(dir, "ghost-native.node"));
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  copyFileSync(name, join(dir, name));
cpSync("licenses", join(dir, "licenses"), { recursive: true });
copyFileSync("vendor/omp/PROVENANCE.md", join(dir, "PROVENANCE.md"));
mkdirSync("artifacts", { recursive: true });
const [packed] = JSON.parse(
  npm(
    [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      resolve("artifacts"),
    ],
    { cwd: dir },
  ),
);
console.log(
  `${packed.filename}: ${packed.size} bytes, ${packed.entryCount} files`,
);
