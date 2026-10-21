import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
export function npm(args, options = {}) {
  const dir = dirname(process.execPath);
  const cli = [
    process.env.npm_execpath,
    join(dir, "node_modules/npm/bin/npm-cli.js"),
    join(dir, "../lib/node_modules/npm/bin/npm-cli.js"),
  ].find((p) => p && existsSync(p));
  if (!cli)
    throw new Error(
      "Cannot locate npm CLI next to Node; run this script through npm run",
    );
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
}
