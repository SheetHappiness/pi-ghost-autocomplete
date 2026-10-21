import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareWeights } from "../src/model/weights.ts";
import { MODEL_ASSETS } from "../src/model/manifest.ts";

test("production manifest stays pinned to OMP hashes and revisions", () => {
  assert.equal(
    MODEL_ASSETS.reduce((n, a) => n + a.bytes, 0),
    146915724,
  );
  assert.ok(
    MODEL_ASSETS.every(
      (a) =>
        /\/resolve\/[a-f0-9]{40}\//.test(a.url) &&
        /^[a-f0-9]{64}$/.test(a.sha256),
    ),
  );
});
test("verified install, concurrency, warm cache revalidation, repair and cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghost-weights-"));
  const bytes = Buffer.from("verified bytes");
  let requests = 0;
  let corrupt = false;
  const server = createServer((_req, res) => {
    requests++;
    res.end(corrupt ? "wrong" : bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const asset = {
    name: "weights",
    url: `http://127.0.0.1:${address.port}/weights`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const paths = await Promise.all([
      prepareWeights({ cacheRoot: root }, "fixture", [asset]),
      prepareWeights({ cacheRoot: root }, "fixture", [asset]),
    ]);
    assert.equal(paths[0], paths[1]);
    assert.equal(requests, 1);
    assert.deepEqual(await readFile(join(paths[0], "weights")), bytes);
    await writeFile(join(paths[0], "weights"), "corrupt");
    await prepareWeights({ cacheRoot: root }, "fixture", [asset]);
    assert.equal(requests, 2);
    corrupt = true;
    await assert.rejects(
      prepareWeights({ cacheRoot: root }, "bad", [asset]),
      /size|SHA-256/i,
    );
    assert.ok(
      !(await readdir(root)).some(
        (n) => n.includes(".part") || n.endsWith(".lock"),
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test("HTTP errors and cancellation do not create ready models", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghost-abort-"));
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end("offline");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const asset = {
    name: "test",
    url: `http://127.0.0.1:${address.port}/`,
    bytes: 1,
    sha256: "0".repeat(64),
  };
  try {
    await assert.rejects(
      prepareWeights({ cacheRoot: root }, "http", [asset]),
      /503/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      prepareWeights({ cacheRoot: root, signal: controller.signal }, "abort", [
        asset,
      ]),
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test("interrupted streaming and equal-size wrong digest leave no usable model", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghost-stream-"));
  const bytes = Buffer.from("abcdefgh");
  let slow = true;
  const server = createServer((_req, res) => {
    if (slow) {
      res.write(bytes.subarray(0, 2));
    } else res.end("xxxxxxxx");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const asset = {
    name: "model",
    url: `http://127.0.0.1:${address.port}/`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const controller = new AbortController();
    await assert.rejects(
      prepareWeights(
        {
          cacheRoot: root,
          signal: controller.signal,
          onProgress() {
            controller.abort();
          },
        },
        "interrupted",
        [asset],
      ),
    );
    assert.deepEqual(await readdir(root), []);
    slow = false;
    await assert.rejects(
      prepareWeights({ cacheRoot: root }, "bad-hash", [asset]),
      /SHA-256/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test("independent processes recover a dead owner lock and install only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "ghost-processes-"));
  const bytes = Buffer.from("cross process");
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    setTimeout(() => res.end(bytes), 50);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const asset = {
    name: "model",
    url: `http://127.0.0.1:${address.port}/`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise<void>((r) => dead.once("exit", () => r()));
    await writeFile(
      join(root, "shared.lock"),
      JSON.stringify({ pid: dead.pid }),
    );
    await Promise.all(
      Array.from(
        { length: 12 },
        () =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                "--experimental-strip-types",
                fileURLToPath(
                  new URL("./fixtures/weights-child.mjs", import.meta.url),
                ),
                root,
                "shared",
                JSON.stringify([asset]),
              ],
              { stdio: ["ignore", "ignore", "pipe"] },
            );
            let error = "";
            child.stderr.on("data", (d) => (error += d));
            child.once("error", reject);
            child.once("exit", (code) =>
              code === 0 ? resolve() : reject(new Error(error)),
            );
          }),
      ),
    );
    assert.equal(requests, 1);
    assert.deepEqual(await readFile(join(root, "shared/model")), bytes);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "Windows locked cache replacement fails cleanly and succeeds after unlock",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ghost-locked-"));
    const bytes = Buffer.from("valid");
    const server = createServer((_req, res) => res.end(bytes));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const asset = {
      name: "model",
      url: `http://127.0.0.1:${address.port}/`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    let holder: ReturnType<typeof spawn> | undefined;
    try {
      const path = await prepareWeights({ cacheRoot: root }, "locked", [asset]);
      await writeFile(join(path, "model"), "wrong");
      holder = spawn(
        join(
          process.env.SystemRoot!,
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        [
          "-NoProfile",
          "-File",
          fileURLToPath(new URL("./fixtures/hold-file.ps1", import.meta.url)),
        ],
        {
          env: { ...process.env, PI_GHOST_TEST_LOCK: join(path, "model") },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      await new Promise<void>((resolve, reject) => {
        holder!.stdout!.once("data", (data) =>
          String(data).includes("locked")
            ? resolve()
            : reject(new Error(String(data))),
        );
        holder!.once("error", reject);
        holder!.once("exit", (code) => {
          if (code) reject(new Error(`lock helper exited ${code}`));
        });
      });
      await assert.rejects(
        prepareWeights({ cacheRoot: root }, "locked", [asset]),
        /EPERM|EACCES|EBUSY|rename/,
      );
      assert.ok(
        !(await readdir(root)).some(
          (n) => n.endsWith(".lock") || n.includes(".part"),
        ),
      );
      const exited = new Promise<void>((r) => holder!.once("exit", () => r()));
      holder.stdin!.end("\n");
      await exited;
      holder = undefined;
      await prepareWeights({ cacheRoot: root }, "locked", [asset]);
      assert.deepEqual(await readFile(join(path, "model")), bytes);
    } finally {
      holder?.stdin?.end("\n");
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
