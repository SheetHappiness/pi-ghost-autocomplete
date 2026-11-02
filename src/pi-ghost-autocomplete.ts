import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GhostTextEditor } from "./editor/ghost-text-editor.ts";
import { GhostController } from "./completion/controller.ts";
import { LazyPredictor } from "./runtime.ts";
import { HybridPredictor } from "./completion/hybrid-predictor.ts";
import { PersonalDictionaryStore } from "./dictionary/store.ts";
import { ensureWeights } from "./model/weights.ts";
import { loadPredictor, assertNativeAvailable } from "./native/load.ts";
import { cacheRoot, stateDirectory, personalDictionaryPath } from "./paths.ts";
import type { Predictor } from "./completion/types.ts";
import type { PredictorOptions } from "./native/types.ts";
import type { WeightsOptions } from "./model/weights.ts";

type EditorFactory = Parameters<
  ExtensionContext["ui"]["setEditorComponent"]
>[0];
export interface GhostServices {
  prepare(options: WeightsOptions): Promise<string>;
  load(options: PredictorOptions): Predictor;
  checkNative(): void;
  createDictionary?(
    onDiagnostic: (message: string) => void,
  ): PersonalDictionaryStore;
}
export default function ghostAutocomplete(
  pi: ExtensionAPI,
  services: GhostServices = {
    prepare: ensureWeights,
    load: loadPredictor,
    checkNative: assertNativeAvailable,
  },
): void {
  let enabled = true;
  let runtime: HybridPredictor | undefined;
  let controller: GhostController | undefined;
  let factory: EditorFactory;
  let previous: EditorFactory;
  let context: ExtensionContext | undefined;
  let status = "waiting for prose";
  let ownership:
    | {
        active: boolean;
        factory: EditorFactory;
        timer?: ReturnType<typeof setInterval>;
      }
    | undefined;
  const observed = new WeakSet<object>();
  async function stop(ctx: ExtensionContext): Promise<void> {
    if (ownership) {
      ownership.active = false;
      if (ownership.timer) clearInterval(ownership.timer);
      ownership = undefined;
    }
    controller?.dispose();
    controller = undefined;
    if (factory && ctx.ui.getEditorComponent() === factory)
      ctx.ui.setEditorComponent(previous);
    factory = undefined;
    previous = undefined;
    if (ctx.mode === "tui") ctx.ui.setStatus("ghost", undefined);
    const old = runtime;
    runtime = undefined;
    if (old) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          old.close(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              if (context === ctx && !ownership)
                ctx.ui.notify(
                  "Ghost worker is still closing in the background",
                  "warning",
                );
              resolve();
            }, 1500);
          }),
        ]);
      } catch (error) {
        if (context === ctx && !ownership)
          ctx.ui.notify(`Ghost close failed: ${String(error)}`, "warning");
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  function start(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui" || !enabled) return;
    let reported = false;
    let repaint = () => {};
    const lease: {
      active: boolean;
      factory: EditorFactory;
      timer?: ReturnType<typeof setInterval>;
    } = { active: true, factory: undefined };
    ownership = lease;
    const owns = () =>
      lease.active && ctx.ui.getEditorComponent() === lease.factory;
    const retire = () => {
      if (ownership === lease && lease.active) void stop(ctx);
    };
    const assertOwned = () => {
      if (!owns()) {
        retire();
        throw new Error("Ghost editor replaced");
      }
    };
    const fail = (error: unknown) => {
      if (!owns()) {
        retire();
        return;
      }
      status = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
      if (!reported) {
        reported = true;
        ctx.ui.notify(`${status}. Use /ghost retry.`, "warning");
      }
    };
    const model = new LazyPredictor(
      stateDirectory(ctx.sessionManager.getSessionId()),
      {
        async prepare(signal) {
          assertOwned();
          services.checkNative();
          status = "preparing model";
          const model = await services.prepare({
            cacheRoot: cacheRoot(),
            signal,
            onProgress() {
              if (!owns()) retire();
            },
          });
          signal.throwIfAborted();
          assertOwned();
          return model;
        },
        load: services.load,
        onReady() {
          assertOwned();
          status = "ready";
        },
      },
    );
    const diagnostic = (message: string) => {
      // Persistence can finish after the model's UI timeout or after a new lease.
      // Deliver data-loss warnings to the current UI; gate stale startup messages.
      if (message.includes("unsaved"))
        (context ?? ctx).ui.notify(`${message}. Use /ghost retry.`, "warning");
      else if (owns())
        ctx.ui.notify(`${message}. Use /ghost retry.`, "warning");
    };
    const dictionary =
      services.createDictionary?.(diagnostic) ??
      new PersonalDictionaryStore(personalDictionaryPath(), {
        onDiagnostic: diagnostic,
      });
    runtime = new HybridPredictor(model, dictionary, diagnostic);
    controller = new GhostController(
      runtime,
      () => {
        if (owns()) repaint();
        else retire();
      },
      fail,
    );
    const owned = controller;
    previous = ctx.ui.getEditorComponent();
    factory = (tui, theme, keys) => {
      repaint = () => tui.requestRender();
      return new GhostTextEditor(
        tui,
        theme,
        keys,
        undefined,
        owned,
        ctx.sessionManager.getSessionId(),
      );
    };
    lease.factory = factory;
    status = "waiting for prose";
    ctx.ui.setEditorComponent(factory);
    // Pi has no custom-editor disposal hook. Detect replacement without owning callbacks.
    lease.timer = setInterval(() => {
      if (!owns()) retire();
    }, 250);
    lease.timer.unref();
    // Prepare in the background as soon as this session owns the editor.
    void runtime.ready().catch(fail);
    void dictionary
      .load()
      .then(() => {
        if (owns()) repaint();
      })
      .catch(() => {});
  }
  pi.on("session_start", async (_event, ctx) => {
    if (context) await stop(context);
    context = ctx;
    start(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    await stop(ctx);
    context = undefined;
  });
  pi.on("input", async (event, ctx) => {
    if (ownership && ctx.ui.getEditorComponent() !== ownership.factory)
      await stop(ctx);
    if (
      ctx.mode === "tui" &&
      enabled &&
      event.source === "interactive" &&
      !observed.has(event)
    ) {
      observed.add(event);
      controller?.reset();
      try {
        await runtime?.observe([event.text]);
      } catch (error) {
        ctx.ui.notify(`Ghost observation failed: ${String(error)}`, "warning");
      }
    }
    return { action: "continue" };
  });
  pi.registerCommand("ghost", {
    description:
      "Ghost word completion: on | off | status | retry | dictionary clear",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "status") {
        const model =
          runtime?.modelStatus === "loading" ? status : runtime?.modelStatus;
        ctx.ui.notify(
          `Ghost: ${enabled && runtime ? `dictionary ${runtime.dictionaryStatus}; model ${model}` : "off"}`,
          "info",
        );
        return;
      }
      if (action === "dictionary clear") {
        try {
          if (runtime) await runtime.clearDictionary();
          else {
            const dictionary =
              services.createDictionary?.((m) => ctx.ui.notify(m, "warning")) ??
              new PersonalDictionaryStore(personalDictionaryPath());
            try {
              await dictionary.clear();
            } finally {
              await dictionary.close();
            }
          }
          controller?.reset();
          ctx.ui.notify("Ghost personal dictionary cleared", "info");
        } catch (error) {
          ctx.ui.notify(
            `Ghost dictionary clear failed: ${String(error)}`,
            "warning",
          );
        }
        return;
      }
      if (!["on", "off", "retry"].includes(action)) {
        ctx.ui.notify(
          "Usage: /ghost on|off|status|retry|dictionary clear",
          "warning",
        );
        return;
      }
      await stop(ctx);
      enabled = action !== "off";
      context = ctx;
      if (enabled) start(ctx);
    },
  });
}
