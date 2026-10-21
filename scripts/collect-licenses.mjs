import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
const root = "licenses";
const sources = [
  [
    "SmolLM2-MODEL-CARD.md",
    "https://huggingface.co/HuggingFaceTB/SmolLM2-135M/raw/93efa2f097d58c2a74874c7e644dbc9b0cee75a2/README.md",
  ],
  [
    "QuantFactory-MODEL-CARD.md",
    "https://huggingface.co/QuantFactory/SmolLM2-135M-GGUF/raw/d948db3614be18259a175aafd7689a70f1cb4e2f/README.md",
  ],
  ["SmolLM2-APACHE-2.0.txt", "https://www.apache.org/licenses/LICENSE-2.0.txt"],
];
const manifest = [];
for (const [name, url] of sources) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(root, name), data);
  manifest.push({
    name,
    url,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
// Inspect pinned repository file lists: retain every LICENSE/NOTICE artifact present.
for (const [repo, revision] of [
  ["HuggingFaceTB/SmolLM2-135M", "93efa2f097d58c2a74874c7e644dbc9b0cee75a2"],
  [
    "QuantFactory/SmolLM2-135M-GGUF",
    "d948db3614be18259a175aafd7689a70f1cb4e2f",
  ],
]) {
  const response = await fetch(
    `https://huggingface.co/api/models/${repo}/revision/${revision}`,
  );
  if (!response.ok) throw new Error("model API unavailable");
  const model = await response.json();
  for (const entry of model.siblings.filter((s) =>
    /(^|\/)(LICENSE|NOTICE)(\.|$)/i.test(s.rfilename),
  )) {
    const url = `https://huggingface.co/${repo}/resolve/${revision}/${entry.rfilename}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("license unavailable");
    const data = Buffer.from(await r.arrayBuffer());
    const name =
      repo.replaceAll("/", "-") + "-" + entry.rfilename.replaceAll("/", "-");
    writeFileSync(join(root, name), data);
    manifest.push({
      name,
      url,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  manifest.push({
    repo,
    revision,
    license: model.cardData?.license,
    upstreamLicenseFiles: model.siblings
      .filter((s) => /(^|\/)(LICENSE|NOTICE)(\.|$)/i.test(s.rfilename))
      .map((s) => s.rfilename),
  });
}
writeFileSync(
  join(root, "model-provenance.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const result = spawnSync(
  process.env.CARGO || "cargo",
  [
    "metadata",
    "--manifest-path",
    "native/Cargo.toml",
    "--locked",
    "--format-version",
    "1",
  ],
  { encoding: "utf8" },
);
if (result.status !== 0) throw new Error(result.stderr);
const metadata = JSON.parse(result.stdout);
const inventory = [];
for (const p of metadata.packages.filter((p) => p.source)) {
  const dir = dirname(p.manifest_path);
  const target = join(root, "rust", p.name + "-" + p.version);
  mkdirSync(target, { recursive: true });
  const files = readdirSync(dir).filter((n) =>
    /^(LICENSES?|LICENCES?|COPYING|NOTICE|AUTHORS)([._-]|$)/i.test(n),
  );
  for (const name of files)
    cpSync(join(dir, name), join(target, name), { recursive: true });
  let fetched;
  if (!files.length && p.repository === "https://github.com/napi-rs/napi-rs") {
    const vcs = JSON.parse(
      readFileSync(join(dir, ".cargo_vcs_info.json"), "utf8"),
    );
    const url = `https://raw.githubusercontent.com/napi-rs/napi-rs/${vcs.git.sha1}/LICENSE`;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Missing napi license: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(target, "LICENSE"), data);
    files.push("LICENSE");
    fetched = { url, sha256: createHash("sha256").update(data).digest("hex") };
  }
  inventory.push({
    name: p.name,
    version: p.version,
    license: p.license,
    repository: p.repository,
    files,
    fetched,
  });
  if (!files.length)
    throw new Error(`Manual license collection needed: ${p.name}`);
}
writeFileSync(
  join(root, "rust-dependencies.json"),
  JSON.stringify(inventory, null, 2) + "\n",
);
console.log(
  `Preserved ${manifest.length} model records and licenses for ${inventory.length} crates.`,
);
