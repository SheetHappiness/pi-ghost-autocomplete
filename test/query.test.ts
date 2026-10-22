import assert from "node:assert/strict";
import { test } from "node:test";
import { queryFor } from "../src/completion/query.ts";
import { lineContext } from "../src/completion/prose-gate.ts";
const query = (text: string) => {
  const lines = text.split("\n");
  return queryFor(lines, lines.length - 1, lines.at(-1)!.length);
};
test("prose at logical end only, Unicode and two letter minimum", () => {
  assert.deepEqual(query("please hel"), { before: "please ", prefix: "hel" });
  assert.deepEqual(query("e\u0301t"), { before: "", prefix: "e\u0301t" });
  assert.ok(query("don'"));
  assert.ok(query("прив"));
  assert.ok(query("世界"));
  assert.equal(query("a"), undefined);
  assert.equal(queryFor(["hello world"], 0, 3), undefined);
});
test("commands, paths, code, identifiers and paste markers are excluded", () => {
  for (const text of [
    "/help",
    "@file",
    "read ./file",
    "C:\\Windows",
    "read /file",
    "camelCase",
    "word2",
    "-> hel",
    "=> hel",
    "```ts\nhello",
    "~~~\nhello",
    "`hello`",
    "[paste #1]\nhello",
  ]) {
    assert.equal(query(text), undefined, text);
  }
  assert.ok(query("```\ncode\n```\nhello"));
  assert.ok(query("`code` hello"));
});
test("size caps and surrogate safe context tail", () => {
  assert.equal(query("a".repeat(1001)), undefined);
  assert.equal(query(("a".repeat(999) + "\n").repeat(21) + "hello"), undefined);
  const q = query("😀" + "x\n".repeat(999) + " hel")!;
  assert.ok(q);
  assert.ok(q.before.length <= 2000);
  assert.ok(!/^[\uDC00-\uDFFF]/.test(q.before));
});

test("query and prose context reuse a precomputed editor text", () => {
  const lines = ["hello"];
  lines.join = () => {
    throw new Error("editor text should be reused");
  };
  const editorText = "hello";

  assert.deepEqual(queryFor(lines, 0, 5, editorText), {
    before: "",
    prefix: "hello",
  });
  assert.equal(lineContext(lines, 0, editorText).editorText, editorText);
});

test("precomputed editor text still detects a paste marker", () => {
  const lines = ["[paste #1]", "hello"];
  lines.join = () => {
    throw new Error("editor text should be reused");
  };
  assert.equal(queryFor(lines, 1, 5, "[paste #1]\nhello"), undefined);
});
