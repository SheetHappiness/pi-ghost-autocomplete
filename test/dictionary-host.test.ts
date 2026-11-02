import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadExtensionFromFactory,
  createExtensionRuntime,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import {
  createEventBus,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  ProcessTerminal,
  TuiMainScreen,
  setKeybindings,
} from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
  initTheme,
  getEditorTheme,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import ghostAutocomplete from "../src/pi-ghost-autocomplete.ts";
import { PersonalDictionaryStore } from "../src/dictionary/store.ts";
import type { Predictor } from "../src/completion/types.ts";
import type { GhostTextEditor } from "../src/editor/ghost-text-editor.ts";

test("Pi dictionary works before model ready, learns interactive input, clears, and closes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ghost-host-dictionary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "dictionary.json"),
    messages: string[] = [];
  let finish!: (s: string) => void,
    preparations = 0,
    completions = 0;
  let dictionary!: PersonalDictionaryStore;
  const model: Predictor = {
    async ready() {},
    async complete() {
      completions++;
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
        load: () => model,
        prepare() {
          preparations++;
          return new Promise((r) => {
            finish = r;
          });
        },
        createDictionary(diagnostic) {
          dictionary = new PersonalDictionaryStore(path, {
            common: [["because", 0.001]],
            onDiagnostic: diagnostic,
          });
          return dictionary;
        },
      }),
    process.cwd(),
    createEventBus(),
    createExtensionRuntime(),
  );
  let factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
  const ctx = {
    mode: "tui",
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (f: typeof factory) => {
        factory = f;
      },
      setStatus() {},
      notify(m: string) {
        messages.push(m);
      },
    },
    sessionManager: { getSessionId: () => "dictionary-host" },
  } as unknown as ExtensionContext;
  const emit = async (name: string, event: object = { type: name }) => {
    for (const h of extension.handlers.get(name) ?? []) await h(event, ctx);
  };
  const command = (text: string) =>
    extension.commands.get("ghost")!.handler(text, ctx as never);
  await emit("session_start");
  assert.equal(preparations, 1);
  await dictionary.load();
  initTheme("dark", false);
  const terminal = new ProcessTerminal();
  terminal.write = () => {};
  const tui = new TuiMainScreen(terminal);
  tui.requestRender = () => {};
  const keys = new KeybindingsManager();
  setKeybindings(keys);
  const editor = factory!(tui, getEditorTheme(), keys) as GhostTextEditor;
  editor.focused = true;
  editor.setText("becau");
  editor.render(80);
  editor.handleInput("\t");
  assert.equal(editor.getText(), "because");
  assert.equal(completions, 0);
  const event = { type: "input", source: "interactive", text: "capricorn" };
  await emit("input", event);
  await emit("input", event);
  assert.equal(dictionary.lookup("capric"), undefined);
  await emit("input", { ...event });
  assert.equal(dictionary.lookup("capric")?.suffix, "orn");
  await emit("input", { ...event, source: "rpc", text: "rpcword" });
  await emit("input", { ...event, source: "rpc", text: "rpcword" });
  assert.equal(dictionary.lookup("rpcw"), undefined);
  await command("status");
  assert.match(messages.pop()!, /dictionary ready; model preparing/);
  await command("dictionary clear");
  assert.equal(dictionary.lookup("capric"), undefined);
  finish("model");
  await new Promise((r) => setImmediate(r));
  await command("off");
  assert.equal(factory, undefined);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    version: 1,
    words: [],
    pairs: [],
  });
  await emit("session_shutdown");
});

test("shutdown reports unsaved dictionary data after the model close UI timeout", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ghost-shutdown-dictionary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "dictionary.json"),
    messages: string[] = [];
  let dictionary!: PersonalDictionaryStore;
  const model: Predictor = {
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
        async prepare() {
          return "model";
        },
        load: () => model,
        createDictionary(diagnostic) {
          dictionary = new PersonalDictionaryStore(path, {
            common: [],
            lockTimeoutMs: 1900,
            onDiagnostic: diagnostic,
          });
          return dictionary;
        },
      }),
    process.cwd(),
    createEventBus(),
    createExtensionRuntime(),
  );
  let factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
  const ctx = {
    mode: "tui",
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (f: typeof factory) => {
        factory = f;
      },
      setStatus() {},
      notify(m: string) {
        messages.push(m);
      },
    },
    sessionManager: { getSessionId: () => "shutdown-dictionary" },
  } as unknown as ExtensionContext;
  for (const h of extension.handlers.get("session_start") ?? [])
    await h({ type: "session_start" }, ctx);
  await dictionary.load();
  dictionary.recordPrompt("capricorn");
  await mkdir(path + ".lock");
  for (const h of extension.handlers.get("session_shutdown") ?? [])
    await h({ type: "session_shutdown" }, ctx);
  await dictionary.close();
  assert.ok(
    messages.some((m) => m.includes("unsaved")),
    messages.join("; "),
  );
});
