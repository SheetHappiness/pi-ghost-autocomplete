import {
  CURSOR_MARKER,
  renderFakeCursor,
  visibleWidth,
} from "@earendil-works/pi-tui";

/** Decorate blank padding only. Keep the public host cursor tokens intact. */
export function renderGhost(
  rows: readonly string[],
  width: number,
  suffix: string,
): string[] {
  const result = [...rows];
  if (!/^[\p{L}\p{M}']+$/u.test(suffix)) return result;
  const token = CURSOR_MARKER + renderFakeCursor(" ");
  if (rows.join("").split(CURSOR_MARKER).length !== 2) return result;
  const index = rows.findIndex((row) => row.includes(token));
  if (index < 0) return result;
  const row = rows[index];
  const end = row.indexOf(token) + token.length;
  const tail = row.slice(end);
  const cells = visibleWidth(suffix);
  if (!/^ *$/.test(tail) || cells > tail.length || visibleWidth(row) > width)
    return result;
  result[index] =
    row.slice(0, end) + "\x1b[2m" + suffix + "\x1b[22m" + tail.slice(cells);
  return result;
}
