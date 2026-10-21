import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Container,
  ProcessTerminal,
  TuiMainScreen,
  setKeybindings,
} from "@earendil-works/pi-tui";
import {
  CustomEditor,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { InteractiveMode } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
import {
  initTheme,
  getEditorTheme,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
  loadExtensions,
  loadExtensionFromFactory,
  createExtensionRuntime,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import ghostAutocomplete from "../src/pi-ghost-autocomplete.ts";
import type { Predictor } from "../src/completion/types.ts";
import { GhostTextEditor } from "../src/editor/ghost-text-editor.ts";
import { fileURLToPath } from "node:url";

for (const outcome of ["ready", "failure"] as const) {
  test(`session startup prepares the model without input and reports ${outcome}`, async () => {
    let finish!: (dir: string) => void;
    let reject!: (error: Error) => void;
    let preparations = 0;
    let completions = 0;
    let closed = 0;
    const engine: Predictor = {
      async ready() {},
      async complete() {
        completions++;
        return null;
      },
      async observe() {},
      async feedback() {},
      async persist() {},
      async close() {
        closed++;
      },
    };
    const extension = await loadExtensionFromFactory(
      (pi) =>
        ghostAutocomplete(pi, {
          checkNative() {},
          prepare() {
            preparations++;
            return new Promise<string>((resolve, fail) => {
              finish = resolve;
              reject = fail;
            });
          },
          load() {
            return engine;
          },
        }),
      process.cwd(),
      createEventBus(),
      createExtensionRuntime(),
    );
    let factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
    const footerStatuses: string[] = [];
    const notifications: string[] = [];
    const ctx = {
      mode: "tui",
      ui: {
        getEditorComponent() {
          return factory;
        },
        setEditorComponent(value: typeof factory) {
          factory = value;
        },
        setStatus(_key: string, value: string | undefined) {
          if (value) footerStatuses.push(value);
        },
        notify(message: string) {
          notifications.push(message);
        },
      },
      sessionManager: {
        getSessionId() {
          return "startup";
        },
      },
    } as unknown as ExtensionContext;
    const emit = async (name: string) => {
      for (const handler of extension.handlers.get(name) ?? [])
        await handler({ type: name }, ctx);
    };
    try {
      // The startup handler must return while model preparation is still pending.
      await emit("session_start");
      assert.ok(factory);
      assert.equal(preparations, 1);
      assert.deepEqual(footerStatuses, []);
      await extension.commands.get("ghost")!.handler("status", ctx as never);
      assert.equal(notifications.pop(), "Ghost: preparing model");
      if (outcome === "ready") finish("model");
      else reject(new Error("offline"));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(footerStatuses, []);
      assert.equal(completions, 0);
      assert.equal(notifications.length, outcome === "ready" ? 0 : 1);
      if (outcome === "failure")
        assert.match(notifications[0], /offline.*\/ghost retry/);
      await extension.commands.get("ghost")!.handler("status", ctx as never);
      assert.equal(
        notifications.pop(),
        outcome === "ready" ? "Ghost: ready" : "Ghost: unavailable: offline",
      );
    } finally {
      finish?.("model");
      await emit("session_shutdown");
    }
    assert.equal(closed, outcome === "ready" ? 1 : 0);
  });
}

test("actual Pi factory wiring preserves host callbacks and delegated actions", () => {
  initTheme("dark", false);
  const keys = new KeybindingsManager();
  setKeybindings(keys);
  const terminal = new ProcessTerminal();
  terminal.write = () => {};
  const ui = new TuiMainScreen(terminal);
  ui.requestRender = () => {};
  const original = new CustomEditor(ui, getEditorTheme(), keys);
  original.setText("hel");
  let submitted = "";
  let changes = 0;
  let escapes = 0;
  original.onSubmit = (text) => {
    submitted = text;
  };
  original.onChange = () => changes++;
  original.onEscape = () => escapes++;
  const host = {
    editor: original,
    defaultEditor: original,
    keybindings: keys,
    ui,
    editorContainer: new Container(),
    disposeActiveSelector() {},
  };
  const method = (
    InteractiveMode.prototype as unknown as {
      setCustomEditorComponent: (
        factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0],
      ) => void;
    }
  ).setCustomEditorComponent;
  const controller = {
    update() {},
    visible() {
      return "lo";
    },
    dismiss() {},
    accepted() {},
  };
  method.call(
    host,
    (tui, theme, bindings) =>
      new GhostTextEditor(tui, theme, bindings, undefined, controller, "host"),
  );
  assert.ok(host.editor instanceof GhostTextEditor);
  assert.equal(host.editor.onSubmit, original.onSubmit);
  assert.equal(host.editor.onChange, original.onChange);
  host.editor.render(80);
  host.editor.handleInput("\r");
  assert.equal(submitted, "hel");
  assert.ok(changes >= 1);
  method.call(host, undefined);
  assert.equal(host.editor, original);
});
test("host extension loader and registered handlers stay inert in RPC, switch and shut down", async () => {
  const loaded = await loadExtensions(
    [
      fileURLToPath(
        new URL("../src/pi-ghost-autocomplete.ts", import.meta.url),
      ),
    ],
    process.cwd(),
  );
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.ok(extension.commands.has("ghost"));
  let factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
  let installed = 0;
  const ui = {
    getEditorComponent() {
      return factory;
    },
    setEditorComponent(value: typeof factory) {
      factory = value;
      installed++;
    },
    setStatus() {},
    notify() {},
  };
  const ctx = {
    mode: "rpc",
    ui,
    sessionManager: {
      getSessionId() {
        return "test";
      },
    },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: unknown) => {
    for (const handler of extension.handlers.get(name) ?? [])
      await handler(event, ctx);
  };
  await emit("session_start", { type: "session_start" });
  assert.equal(installed, 0);
  (ctx as unknown as { mode: string }).mode = "tui";
  await emit("session_start", { type: "session_start" });
  assert.equal(installed, 1);
  assert.ok(factory);
  await emit("input", { type: "input", text: "ignored", source: "rpc" });
  await emit("session_shutdown", { type: "session_shutdown" });
  assert.equal(factory, undefined);
});
test("replacing the custom editor aborts preparation and cannot overwrite replacement status", async () => {
  let prepared = 0;
  let signal: AbortSignal | undefined;
  const engine: Predictor = {
    async ready() {},
    async complete() {
      return null;
    },
    async observe() {},
    async feedback() {},
    async persist() {},
    async close() {},
  };
  const extension = await loadExtensionFromFactory(
    (pi) =>
      ghostAutocomplete(pi, {
        checkNative() {},
        load() {
          return engine;
        },
        prepare(options) {
          prepared++;
          signal = options.signal;
          return new Promise((_r, reject) =>
            options.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          );
        },
      }),
    process.cwd(),
    createEventBus(),
    createExtensionRuntime(),
  );
  let factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
  const notifications: string[] = [];
  const ui = {
    getEditorComponent() {
      return factory;
    },
    setEditorComponent(value: typeof factory) {
      factory = value;
    },
    setStatus() {},
    notify(message: string) {
      notifications.push(message);
    },
  };
  const ctx = {
    mode: "tui",
    ui,
    sessionManager: {
      getSessionId() {
        return "replacement";
      },
    },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: unknown) => {
    for (const handler of extension.handlers.get(name) ?? [])
      await handler(event, ctx);
  };
  await emit("session_start", { type: "session_start" });
  const terminal = new ProcessTerminal();
  terminal.write = () => {};
  const tui = new TuiMainScreen(terminal);
  tui.requestRender = () => {};
  const keys = new KeybindingsManager();
  setKeybindings(keys);
  const editor = factory!(tui, getEditorTheme(), keys) as GhostTextEditor;
  editor.focused = true;
  editor.setText("hello wor");
  editor.render(80);
  await new Promise((r) => setImmediate(r));
  assert.equal(prepared, 1);
  const replacement: NonNullable<typeof factory> = (t, theme, k) =>
    new CustomEditor(t, theme, k);
  factory = replacement;
  await emit("input", {
    type: "input",
    text: "new editor prompt",
    source: "interactive",
  });
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(signal?.aborted, true);
  assert.equal(factory, replacement);
  assert.deepEqual(notifications, []);
  await emit("session_shutdown", { type: "session_shutdown" });
});
