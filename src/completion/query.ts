// Adapted from pinned OMP word-completion.ts. See provenance.
import { maskNonProse } from "./markdown-prose.ts";
import { isProseWord, lineContext, ProseSource } from "./prose-gate.ts";
import type { Query } from "./types.ts";
const BEFORE_LIMIT = 2000;
const prose = new ProseSource();
function textBefore(
  lines: readonly string[],
  cursorLine: number,
  start: number,
): string {
  const head = (lines[cursorLine] ?? "").slice(0, start);
  // Find the first line the capped tail reaches, then join once.
  let length = head.length;
  let first = cursorLine;
  while (first > 0 && length < BEFORE_LIMIT) {
    first--;
    length += (lines[first] ?? "").length + 1;
  }
  let text = head;
  if (first < cursorLine) {
    const parts: string[] = [];
    for (let line = first; line < cursorLine; line++)
      parts.push(lines[line] ?? "");
    parts.push(head);
    text = parts.join("\n");
  }
  if (text.length <= BEFORE_LIMIT) return text;
  let cut = text.length - BEFORE_LIMIT;
  // Never start on the low half of a surrogate pair.
  const unit = text.charCodeAt(cut);
  if (unit >= 0xdc00 && unit <= 0xdfff) cut++;
  return text.slice(cut);
}

export function queryFor(
  lines: readonly string[],
  lineIndex: number,
  col: number,
): Query | undefined {
  const line = lines[lineIndex];
  if (
    line === undefined ||
    col !== line.length ||
    lines.join("\n").includes("[paste #")
  )
    return;
  const match = /[\p{L}\p{M}']+$/u.exec(line);
  if (!match || [...match[0]].filter((c) => /\p{L}/u.test(c)).length < 2)
    return;
  const start = col - match[0].length;
  if (
    !isProseWord(line, maskNonProse(line), start, col) ||
    !prose.isProse(lineContext(lines, lineIndex), start, col)
  )
    return;
  return { before: textBefore(lines, lineIndex, start), prefix: match[0] };
}
