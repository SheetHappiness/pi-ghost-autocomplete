import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURSOR_MARKER,
  ProcessTerminal,
  TuiMainScreen,
  visibleWidth,
  setKeybindings,
  renderFakeCursor,
  type AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { GhostTextEditor } from "../src/editor/ghost-text-editor.ts";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type {
  CompletionController,
  Snapshot,
} from "../src/completion/types.ts";

const identity = (s: string) => s;
const theme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
class FakeController implements CompletionController {
  dismissed = false;
  update() {}
  visible(s: Snapshot) {
    return !this.dismissed && s.text.endsWith("hel") ? "lo" : null;
  }
  dismiss() {
    this.dismissed = true;
  }
  accepted() {
    this.dismissed = true;
  }
}
function setup() {
  const keys = new KeybindingsManager();
  setKeybindings(keys);
  const controller = new FakeController();
  // Extra arguments become part of the implementation after this red gate.
  const terminal = new ProcessTerminal();
  terminal.write = () => {};
  const tui = new TuiMainScreen(terminal);
  tui.requestRender = () => {};
  const editor = new GhostTextEditor(
    tui,
    theme,
    keys,
    undefined,
    controller,
    "test",
  );
  editor.focused = true;
  return { editor, controller, keys };
}
test("real CustomEditor render is pure and Enter excludes ghost", () => {
  const { editor } = setup();
  editor.setText("hel");
  const change = () => {};
  editor.onChange = change;
  const rows = editor.render(20);
  assert.ok(rows.some((row) => row.includes("lo")));
  for (let i = 0; i < 3; i++) editor.render(20);
  assert.equal(editor.getText(), "hel");
  assert.equal(editor.getExpandedText(), "hel");
  assert.equal(editor.onChange, change);
  assert.equal(rows.join("").split(CURSOR_MARKER).length, 2);
  for (const row of rows) assert.equal(visibleWidth(row), 20);
  let submitted = "";
  editor.onSubmit = (value) => {
    submitted = value;
  };
  editor.handleInput("\r");
  assert.equal(submitted, "hel");
});
for (const key of ["\t", "\x1b[C"])
  test(`accept ${JSON.stringify(key)} is atomic, no space`, () => {
    const { editor, keys } = setup();
    editor.setText("hel");
    editor.render(20);
    editor.handleInput(key);
    assert.equal(editor.getText(), "hello");
    const undo = keys.getKeys("tui.editor.undo")[0];
    const undoInput: Record<string, string> = {
      "alt+z": "\x1bz",
      "ctrl+z": "\x1a",
      "ctrl+-": "\x1f",
    };
    assert.ok(undoInput[undo], `Unmapped host Undo binding: ${undo}`);
    editor.handleInput(undoInput[undo]);
    assert.equal(editor.getText(), "hel");
  });
test("Escape dismisses once then delegates", () => {
  const { editor } = setup();
  let escaped = 0;
  editor.onEscape = () => escaped++;
  editor.setText("hel");
  editor.render(20);
  editor.handleInput("\x1b");
  assert.equal(escaped, 0);
  assert.ok(!editor.render(20).some((row) => row.includes("lo")));
  editor.handleInput("\x1b");
  assert.equal(escaped, 1);
});
test("extension shortcuts win and invisible hints cannot be accepted", () => {
  const { editor } = setup();
  let shortcuts = 0;
  editor.setText("hel");
  editor.render(20);
  editor.onExtensionShortcut = () => {
    shortcuts++;
    return true;
  };
  editor.handleInput("\t");
  assert.equal(editor.getText(), "hel");
  assert.equal(shortcuts, 1);
  editor.onExtensionShortcut = undefined;
  for (const width of [1, 2, 4, 5]) {
    editor.render(width);
    editor.handleInput("\x1b[C");
    assert.equal(editor.getText(), "hel");
  }
  editor.focused = false;
  editor.render(80);
  editor.handleInput("\x1b[C");
  assert.equal(editor.getText(), "hel");
});
test("slash and path contexts suppress even pending completion", () => {
  const { editor } = setup();
  for (const text of [
    "/hel",
    "@hel",
    "read ./hel",
    "read C:\\hel",
    "read /hel",
  ]) {
    editor.setText(text);
    editor.render(80);
    editor.handleInput("\x1b[C");
    assert.equal(editor.getText(), text);
  }
});
test("delayed slash/file completion retains Tab and Escape semantics", async () => {
  for (const prefix of ["/hel", "@hel"]) {
    const { editor } = setup();
    let release: (
      result: Awaited<ReturnType<AutocompleteProvider["getSuggestions"]>>,
    ) => void = () => {};
    const provider: AutocompleteProvider = {
      getSuggestions() {
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      applyCompletion(lines, line, col, item, prefix) {
        const updated = [...lines];
        updated[line] = lines[line].slice(0, col - prefix.length) + item.value;
        return {
          lines: updated,
          cursorLine: line,
          cursorCol: updated[line].length,
        };
      },
    };
    editor.setAutocompleteProvider(provider);
    editor.setText(prefix);
    editor.handleInput("\t");
    editor.render(80);
    assert.equal(editor.getText(), prefix);
    await new Promise((resolve) => setImmediate(resolve));
    release({
      items: [
        { value: "completed", label: "completed" },
        { value: "other", label: "other" },
      ],
      prefix,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(editor.isShowingAutocomplete(), true);
    editor.render(80);
    editor.handleInput("\t");
    assert.equal(editor.getText(), "completed");
  }
});
test("configured acceptance, external mutation, paste and history remain host actions", () => {
  const { editor, keys } = setup();
  keys.setUserBindings({
    "tui.input.tab": "ctrl+y",
    "tui.editor.cursorRight": "ctrl+f",
  });
  editor.setText("hel");
  editor.render(80);
  editor.handleInput("\x19");
  assert.equal(editor.getText(), "hello");
  editor.setText("hel");
  editor.render(80);
  editor.insertTextAtCursor("p");
  editor.handleInput("\t");
  assert.equal(editor.getText(), "help");
  editor.setText("hel");
  editor.render(80);
  editor.handleInput("\x1b[200~world\x1b[201~");
  assert.equal(editor.getText(), "helworld");
  editor.addToHistory("old prompt");
  editor.setText("");
  editor.handleInput("\x1b[A");
  assert.equal(editor.getText(), "old prompt");
});
test("Unicode, scrolling, wrap and resize preserve real text and cursor tokens", () => {
  const { editor } = setup();
  for (const text of [
    "😀 世界 e\u0301 hel",
    "line\n".repeat(100) + "hel",
    "a".repeat(76) + " hel",
  ]) {
    editor.setText(text);
    for (const width of [1, 2, 20, 80]) {
      const rows = editor.render(width);
      assert.equal(editor.getText(), text);
      assert.equal(editor.getExpandedText(), text);
      if (width >= 3) {
        assert.equal(rows.join("").split(CURSOR_MARKER).length, 2);
        assert.ok(rows.join("").includes(renderFakeCursor(" ")));
      }
      assert.deepEqual(editor.render(width), rows);
    }
  }
});
test("app action and clipboard bindings keep precedence when remapped onto ghost keys", () => {
  for (const action of [
    "app.model.cycleForward",
    "app.clipboard.pasteImage",
  ] as const) {
    const { editor, keys } = setup();
    let actions = 0;
    keys.setUserBindings({ "tui.input.tab": "ctrl+p", [action]: "ctrl+p" });
    if (action === "app.clipboard.pasteImage")
      editor.onPasteImage = () => actions++;
    else editor.onAction(action, () => actions++);
    editor.setText("hel");
    editor.render(80);
    editor.handleInput("\x10");
    assert.equal(actions, 1);
    assert.equal(editor.getText(), "hel");
  }
});
test("split bracketed paste buffers control keys without accepting ghost", () => {
  const { editor, keys } = setup();
  editor.setText("hel");
  editor.render(80);
  const terminal = new ProcessTerminal();
  terminal.write = () => {};
  const tui = new TuiMainScreen(terminal);
  tui.requestRender = () => {};
  const plain = new CustomEditor(tui, theme, keys);
  plain.setText("hel");
  for (const data of ["\x1b[200~", "\t", "\x1b[201~"]) {
    editor.handleInput(data);
    editor.render(80);
    plain.handleInput(data);
  }
  assert.equal(editor.getText(), plain.getText());
  assert.ok(!editor.getText().includes("hello"));
});
