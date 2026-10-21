import type { Predictor } from "./types.ts";
import type { PredictorOptions } from "./types.ts";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
const require = createRequire(import.meta.url);
export function assertNativeAvailable(): void {
  const path = process.env.PI_GHOST_NATIVE_PATH;
  if (path && !isAbsolute(path))
    throw new Error("PI_GHOST_NATIVE_PATH must be absolute");
  try {
    require.resolve(path || platformPackage());
  } catch (cause) {
    throw new Error(
      "Ghost native predictor unavailable for this installation",
      { cause },
    );
  }
}
export function platformPackage(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const target = `${platform}-${arch}`;
  const allowed: Record<string, string> = {
    "win32-x64": "win32-x64-msvc",
    "linux-x64": "linux-x64-gnu",
    "linux-arm64": "linux-arm64-gnu",
    "darwin-arm64": "darwin-arm64",
  };
  const suffix = allowed[target];
  if (!suffix) throw new Error(`Unsupported ghost predictor target: ${target}`);
  if (platform === "linux" && process.platform === "linux") {
    const report = process.report.getReport() as {
      header: { glibcVersionRuntime?: string };
    };
    if (!report.header.glibcVersionRuntime)
      throw new Error("Unsupported ghost predictor libc: requires glibc");
  }
  return `@sheethappiness/pi-ghost-autocomplete-${suffix}`;
}
export function loadPredictor(options: PredictorOptions): Predictor {
  const local = process.env.PI_GHOST_NATIVE_PATH;
  if (local && !isAbsolute(local))
    throw new Error(
      "PI_GHOST_NATIVE_PATH must be an absolute development artifact path",
    );
  try {
    const native = require(local || platformPackage()) as {
      TextPredictor: new (options: PredictorOptions) => Predictor;
    };
    return new native.TextPredictor(options);
  } catch (cause) {
    throw new Error(
      `Ghost native predictor unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
