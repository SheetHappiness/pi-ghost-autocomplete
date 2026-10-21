import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURSOR_MARKER,
  renderFakeCursor,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { renderGhost } from "../src/editor/render-ghost.ts";

test("decorates the cursor row without changing width or marker", () => {
  const row = `hel${CURSOR_MARKER}${renderFakeCursor(" ")}      `;
  const rendered = renderGhost([row], 10, "lo");
  assert.ok(rendered[0].includes("lo"));
  assert.equal(visibleWidth(rendered[0]), visibleWidth(row));
  assert.equal(rendered[0].split(CURSOR_MARKER).length, 2);
  assert.deepEqual(renderGhost([row], 10, "toolong"), [row]);
});
