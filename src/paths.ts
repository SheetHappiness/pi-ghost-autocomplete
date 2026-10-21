import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { join } from "node:path";
export function cacheRoot(): string {
  return (
    process.env.PI_GHOST_CACHE_DIR ||
    join(getAgentDir(), "ghost-autocomplete", "models")
  );
}
export function stateDirectory(session: string): string {
  const hash = createHash("sha256").update(session).digest("hex");
  return join(
    process.env.PI_GHOST_STATE_DIR ||
      join(getAgentDir(), "ghost-autocomplete", "sessions"),
    hash,
  );
}
