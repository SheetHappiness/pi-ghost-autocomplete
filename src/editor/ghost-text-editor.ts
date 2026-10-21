import {
  CustomEditor,
  type KeybindingsManager,
  type CustomEditorOptions,
} from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import type { CompletionController, Snapshot } from "../completion/types.ts";
import { renderGhost } from "./render-ghost.ts";
import { queryFor } from "../completion/query.ts";

export class GhostTextEditor extends CustomEditor {
  private ghostController: CompletionController;
  private ghostKeys: KeybindingsManager;
  private session: string;
  private pasting = false;
  private painted: { snapshot: string; suffix: string } | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keys: KeybindingsManager,
    options: CustomEditorOptions | undefined,
    controller: CompletionController,
    session: string,
  ) {
    super(tui, theme, keys, options);
    this.ghostController = controller;
    this.ghostKeys = keys;
    this.session = session;
  }
  private snapshot(): Snapshot {
    return { text: this.getText(), ...this.getCursor(), session: this.session };
  }
  private reconcile(): void {
    if (!this.ghostController) return;
    const snapshot = this.snapshot();
    this.ghostController.update(
      snapshot,
      this.eligible()
        ? queryFor(this.getLines(), snapshot.line, snapshot.col)
        : undefined,
    );
  }
  private eligible(): boolean {
    const { line, col } = this.getCursor();
    const text = this.getLines()[line] ?? "";
    return (
      this.focused &&
      !this.pasting &&
      col === text.length &&
      !this.isShowingAutocomplete() &&
      !text.trimStart().startsWith("/") &&
      !/[\\/@_:{}\[\]<>=]/.test(text.split(/\s/).at(-1) ?? "")
    );
  }
  override render(width: number): string[] {
    // Pi 1.3.0 wordWrapLine recurses indefinitely for a two-cell grapheme
    // at layout width 1 (terminal width 1/2). Wait for a usable terminal width.
    if (width < 3) {
      this.painted = undefined;
      return [" ".repeat(Math.max(0, width))];
    }
    const rows = super.render(width);
    this.reconcile();
    this.painted = undefined;
    if (!this.eligible()) return rows;
    const snapshot = this.snapshot();
    const suffix = this.ghostController.visible(snapshot);
    if (!suffix) return rows;
    const decorated = renderGhost(rows, width, suffix);
    if (decorated.some((row, i) => row !== rows[i]))
      this.painted = { snapshot: JSON.stringify(snapshot), suffix };
    return decorated;
  }
  override handleInput(data: string): void {
    // The host gives extension shortcuts precedence. Avoid calling them twice on delegation.
    const shortcut = this.onExtensionShortcut;
    if (shortcut?.(data)) return;
    this.onExtensionShortcut = undefined;
    try {
      if (data.includes("\x1b[200~")) this.pasting = true;
      if (this.pasting) {
        this.painted = undefined;
        super.handleInput(data);
        if (data.includes("\x1b[201~")) this.pasting = false;
        return;
      }
      // These precede ordinary editor handling in the actual CustomEditor.
      if (
        this.ghostKeys.matches(data, "app.clipboard.pasteImage") ||
        this.ghostKeys.matches(data, "tui.editor.historyPrevious") ||
        this.ghostKeys.matches(data, "tui.editor.historyNext") ||
        [...this.actionHandlers.keys()].some(
          (action) =>
            action !== "app.interrupt" &&
            action !== "app.exit" &&
            this.ghostKeys.matches(data, action),
        )
      ) {
        super.handleInput(data);
        return;
      }
      const snapshot = this.snapshot();
      const painted = this.painted;
      const visible =
        this.eligible() &&
        painted?.snapshot === JSON.stringify(snapshot) &&
        this.ghostController.visible(snapshot) === painted.suffix;
      if (visible && this.ghostKeys.matches(data, "app.interrupt")) {
        this.ghostController.dismiss(snapshot);
        this.painted = undefined;
        this.tui.requestRender();
        return;
      }
      const kb = getKeybindings();
      if (
        visible &&
        (kb.matches(data, "tui.input.tab") ||
          kb.matches(data, "tui.editor.cursorRight"))
      ) {
        this.ghostController.accepted(snapshot);
        this.insertTextAtCursor(painted!.suffix);
        this.painted = undefined;
        return;
      }
      super.handleInput(data);
    } finally {
      this.onExtensionShortcut = shortcut;
      this.reconcile();
    }
  }
  override setText(text: string): void {
    super.setText(text);
    this.painted = undefined;
    this.reconcile();
  }
  override insertTextAtCursor(text: string): void {
    super.insertTextAtCursor(text);
    this.painted = undefined;
    this.reconcile();
  }
  override handleMouse(event: TuiMouseEvent) {
    this.painted = undefined;
    const result = super.handleMouse(event);
    this.reconcile();
    return result;
  }
  override invalidate(): void {
    this.painted = undefined;
    super.invalidate();
  }
}
