import type { Predictor, Suggestion } from "./completion/types.ts";
import type { PredictorOptions } from "./native/types.ts";
export interface RuntimeDependencies {
  prepare(signal: AbortSignal): Promise<string>;
  load(options: PredictorOptions): Predictor;
  onReady?(): void;
}
export class LazyPredictor implements Predictor {
  private stateDir: string;
  private dependencies: RuntimeDependencies;
  private startup: Promise<Predictor> | undefined;
  private engine: Predictor | undefined;
  private abort = new AbortController();
  private closing: Promise<void> | undefined;
  private closed = false;
  private observations: string[] = [];
  private engineReady = false;
  private flushing: Promise<void> | undefined;
  constructor(stateDir: string, dependencies: RuntimeDependencies) {
    this.stateDir = stateDir;
    this.dependencies = dependencies;
  }
  private get(): Promise<Predictor> {
    if (this.closed) return Promise.reject(new Error("Ghost predictor closed"));
    this.startup ??= (async () => {
      const modelDir = await this.dependencies.prepare(this.abort.signal);
      this.abort.signal.throwIfAborted();
      const engine = this.dependencies.load({
        modelDir,
        stateDir: this.stateDir,
      });
      this.engine = engine;
      await engine.ready();
      this.abort.signal.throwIfAborted();
      this.engineReady = true;
      await this.flushObservations();
      this.dependencies.onReady?.();
      return engine;
    })();
    return this.startup;
  }
  async ready(): Promise<void> {
    await this.get();
  }
  async complete(before: string, prefix: string): Promise<Suggestion | null> {
    return (await this.get()).complete(before, prefix);
  }
  async observe(prompts: string[]) {
    if (this.closed) return;
    for (const prompt of prompts) {
      if (prompt.length > 20_000) continue;
      this.observations.push(prompt);
      while (
        this.observations.length > 64 ||
        this.observations.reduce((size, text) => size + text.length, 0) > 20_000
      )
        this.observations.shift();
    }
    if (this.engineReady) await this.flushObservations();
  }
  private flushObservations(): Promise<void> {
    this.flushing ??= (async () => {
      while (this.observations.length && this.engine && !this.closed) {
        const prompts = this.observations.splice(0);
        await this.engine.observe(prompts);
      }
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  async feedback(
    before: string,
    prefix: string,
    suffix: string,
    accepted: boolean,
  ) {
    if (this.engine && !this.closed)
      await this.engine.feedback(before, prefix, suffix, accepted);
  }
  async persist() {
    if (this.engine && !this.closed) await this.engine.persist();
  }
  close(): Promise<void> {
    this.closed = true;
    this.observations = [];
    this.abort.abort();
    this.closing ??= (async () => {
      await this.startup?.catch(() => {});
      await this.flushing?.catch(() => {});
      await this.engine?.close();
    })();
    return this.closing;
  }
}
