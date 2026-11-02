import type { PersonalDictionaryStore } from "../dictionary/store.ts";
import type { Predictor, Suggestion } from "./types.ts";

export class HybridPredictor implements Predictor {
  private model: Predictor;
  private dictionary: PersonalDictionaryStore;
  private diagnostic: (message: string) => void;
  private startup?: Promise<void>;
  private closing?: Promise<void>;
  private closed = false;
  private dictionaryFailed = false;
  private modelFailed = false;
  private modelState = "loading";
  constructor(
    model: Predictor,
    dictionary: PersonalDictionaryStore,
    diagnostic = (_message: string) => {},
  ) {
    this.model = model;
    this.dictionary = dictionary;
    this.diagnostic = diagnostic;
  }
  get dictionaryStatus(): string {
    return this.dictionaryFailed ? "unavailable" : this.dictionary.status;
  }
  get modelStatus(): string {
    return this.modelState;
  }
  private failModel(error: unknown): void {
    if (this.closed || this.modelFailed) return;
    this.modelFailed = true;
    this.modelState = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    this.diagnostic(`Ghost model ${this.modelState}`);
  }
  ready(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.startup ??= Promise.all([
      this.dictionary.load().catch((e) => {
        if (this.closed) return;
        this.dictionaryFailed = true;
        this.diagnostic(`Ghost dictionary unavailable: ${String(e)}`);
      }),
      this.model
        .ready()
        .then(() => {
          if (!this.closed) this.modelState = "ready";
        })
        .catch((e) => this.failModel(e)),
    ]).then(() => {});
    return this.startup;
  }
  fastComplete(_before: string, prefix: string): Suggestion | undefined {
    if (this.closed || this.dictionaryFailed) return;
    return this.dictionary.lookup(prefix);
  }
  async complete(before: string, prefix: string): Promise<Suggestion | null> {
    if (this.closed) return null;
    const fast = this.fastComplete(before, prefix);
    if (fast) return fast;
    if (this.modelFailed) return null;
    try {
      return await this.model.complete(before, prefix);
    } catch (e) {
      this.failModel(e);
      return null;
    }
  }
  async observe(prompts: string[]): Promise<void> {
    if (this.closed) return;
    for (const prompt of prompts) this.dictionary.recordPrompt(prompt);
    if (!this.modelFailed)
      void this.model.observe(prompts).catch((e) => this.failModel(e));
  }
  async feedback(
    _before: string,
    prefix: string,
    suffix: string,
    accepted: boolean,
  ): Promise<void> {
    if (!this.closed && accepted)
      this.dictionary.recordAcceptance(prefix, suffix);
    // Native SmolLM2 feedback is a no-op. Rejections also include context changes.
  }
  async persist(): Promise<void> {
    if (!this.closed)
      await Promise.all([
        this.dictionary.persist(),
        this.model.persist().catch((e) => this.failModel(e)),
      ]);
  }
  async clearDictionary(): Promise<void> {
    if (!this.closed) await this.dictionary.clear();
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.all([
      this.dictionary.close(),
      this.model.close(),
    ]).then(() => {});
    return this.closing;
  }
}
