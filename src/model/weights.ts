import type { ModelAsset } from "./manifest.ts";
import { MODEL_ASSETS, MODEL_ID } from "./manifest.ts";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export interface WeightsOptions {
  cacheRoot: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}
export async function ensureWeights(options: WeightsOptions): Promise<string> {
  return prepareWeights(options, MODEL_ID, MODEL_ASSETS);
}
async function valid(path: string, asset: ModelAsset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === asset.sha256;
  } catch {
    return false;
  }
}
function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}
async function acquire(
  path: string,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
      } finally {
        await handle.close();
      }
      return async () => {
        await rm(path, { force: true });
      };
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
    // Serialize stale-owner inspection and removal. Otherwise two waiters can
    // inspect the same dead owner and the second can rename a new live lock.
    let recovery: Awaited<ReturnType<typeof open>> | undefined;
    try {
      recovery = await open(path + ".recovery", "wx", 0o600);
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
    try {
      if (!recovery) {
        if (Date.now() >= deadline)
          throw new Error(`Model lock recovery timed out: ${path}.recovery`);
        await delay(50, undefined, { signal });
        continue;
      }
      let stale = false;
      const info = await stat(path);
      try {
        const owner = JSON.parse(await readFile(path, "utf8")) as {
          pid: number;
        };
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (e) {
            stale = code(e) === "ESRCH";
          }
        }
      } catch {
        stale = Date.now() - info.mtimeMs > 120_000;
      }
      if (stale) {
        // Rename rather than unlink a possibly open lock; Windows failures are safe.
        const abandoned = path + "." + randomUUID();
        await rename(path, abandoned);
        await rm(abandoned, { force: true });
        continue;
      }
    } catch (e) {
      if (code(e) !== "ENOENT") throw e;
    } finally {
      if (recovery) {
        await recovery.close();
        await rm(path + ".recovery", { force: true });
      }
    }
    if (Date.now() >= deadline) throw new Error("Model install lock timed out");
    await delay(50, undefined, { signal });
  }
}
/** Fixed manifest in production; injected manifests support deterministic offline tests. */
export async function prepareWeights(
  options: WeightsOptions,
  id: string,
  assets: readonly ModelAsset[],
): Promise<string> {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    assets.some(
      (a) => basename(a.name) !== a.name || a.name === "." || a.name === "..",
    )
  )
    throw new Error("Invalid model manifest path");
  options.signal?.throwIfAborted();
  await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
  const release = await acquire(
    join(options.cacheRoot, id + ".lock"),
    options.signal,
  );
  const destination = join(options.cacheRoot, id);
  let staging: string | undefined;
  try {
    if (
      (
        await Promise.all(
          assets.map((a) => valid(join(destination, a.name), a)),
        )
      ).every(Boolean)
    ) {
      options.signal?.throwIfAborted();
      return destination;
    }
    staging = join(options.cacheRoot, id + ".part-" + randomUUID());
    await mkdir(staging, { mode: 0o700 });
    const total = assets.reduce((sum, a) => sum + a.bytes, 0);
    let loaded = 0;
    for (const asset of assets) {
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000);
      const response = await fetch(asset.url, { signal });
      if (!response.ok || !response.body)
        throw new Error(
          `Model download HTTP ${response.status}: ${asset.name}`,
        );
      const file = await open(join(staging, asset.name), "wx", 0o600);
      const hash = createHash("sha256");
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > asset.bytes)
            throw new Error(`Model size mismatch: ${asset.name}`);
          hash.update(chunk);
          await file.writeFile(chunk);
          loaded += chunk.length;
          options.onProgress?.(loaded, total);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      if (size !== asset.bytes)
        throw new Error(`Model size mismatch: ${asset.name}`);
      if (hash.digest("hex") !== asset.sha256)
        throw new Error(`Model SHA-256 mismatch: ${asset.name}`);
    }
    options.signal?.throwIfAborted();
    await writeFile(
      join(staging, "ready.json"),
      JSON.stringify({ id, assets }),
      { mode: 0o600 },
    );
    let previous: string | undefined;
    try {
      await stat(destination);
      previous = destination + ".old-" + randomUUID();
      await rename(destination, previous);
    } catch (e) {
      if (code(e) !== "ENOENT") throw e;
    }
    try {
      await rename(staging, destination);
      staging = undefined;
    } catch (e) {
      if (previous) await rename(previous, destination);
      throw e;
    }
    if (previous)
      await rm(previous, { recursive: true, force: true }).catch(() => {});
    return destination;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await release();
  }
}
