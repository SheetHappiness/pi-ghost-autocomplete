import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  DictionaryIndex,
  normalizeWord,
  validWord,
  wordsFromPrompt,
  type CommonWords,
  type DictionaryState,
  type WordStats,
  type PrefixStats,
} from "./lexicon.ts";
import type { Suggestion } from "../completion/types.ts";

interface Options {
  common?: CommonWords;
  now?: () => number;
  read?: (path: string) => Promise<string>;
  debounceMs?: number;
  lockTimeoutMs?: number;
  onDiagnostic?: (message: string) => void;
}
type Delta =
  | { words: string[]; at: number }
  | { prefix: string; suffix: string; at: number };
const empty = (): DictionaryState => ({ words: [], pairs: [] });

export class PersonalDictionaryStore {
  private path: string;
  private options: Options;
  private index = new DictionaryIndex([]);
  private pending: Delta[] = [];
  private loading?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private loaded = false;
  private warnings = new Set<string>();
  private now: () => number;
  constructor(path: string, options: Options = {}) {
    this.path = path;
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  get status(): string {
    return this.closed ? "closed" : this.loaded ? "ready" : "loading";
  }
  private warn(message: string): void {
    if (this.warnings.has(message)) return;
    this.warnings.add(message);
    this.options.onDiagnostic?.(message);
  }

  load(): Promise<void> {
    this.loading ??= (async () => {
      let common: CommonWords = [];
      try {
        common =
          this.options.common ??
          JSON.parse(
            await readFile(
              new URL("./common-en.json", import.meta.url),
              "utf8",
            ),
          );
        if (!Array.isArray(common)) throw new Error("invalid common asset");
      } catch (e) {
        this.warn(`Dictionary common load failed: ${String(e)}`);
      }
      this.index = new DictionaryIndex(common);
      try {
        this.index.replace(await this.readState());
      } catch (e) {
        this.warn(`Dictionary personal load failed: ${String(e)}`);
      }
      for (const delta of this.pending) this.apply(this.index, delta);
      this.loaded = true;
    })();
    return this.loading;
  }

  lookup(prefix: string): Suggestion | undefined {
    return this.loaded && !this.closed
      ? this.index.lookup(prefix, this.now())
      : undefined;
  }

  recordPrompt(text: string): void {
    const words = wordsFromPrompt(text);
    if (words.length) this.record({ words, at: this.now() });
  }
  recordAcceptance(prefix: string, suffix: string): void {
    const normalized = normalizeWord(prefix + suffix);
    if (
      !validWord(normalized) ||
      !suffix ||
      !normalized.startsWith(normalizeWord(prefix))
    )
      return;
    this.record({ prefix, suffix, at: this.now() });
  }
  private record(delta: Delta): void {
    if (this.closed) return;
    // Fail explicitly rather than grow unbounded while storage remains inaccessible.
    if (this.pending.length >= 4096) {
      this.warn(
        "Dictionary pending buffer full; new learning is paused until storage recovers",
      );
      return;
    }
    this.pending.push(delta);
    if (this.loaded) this.apply(this.index, delta);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.persist().catch((e) =>
        this.warn(`Dictionary save failed: ${String(e)}`),
      );
    }, this.options.debounceMs ?? 2000);
    this.timer.unref();
  }
  private apply(index: DictionaryIndex, delta: Delta): void {
    if ("words" in delta) index.learnWords(delta.words, delta.at);
    else index.accept(delta.prefix, delta.suffix, delta.at);
  }

  private async readState(): Promise<DictionaryState> {
    let text: string;
    try {
      text = await (this.options.read ?? ((p) => readFile(p, "utf8")))(
        this.path,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw e;
    }
    let data: { version?: number; words?: unknown; pairs?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      this.warn(
        "Dictionary state is malformed; using an empty personal dictionary",
      );
      return empty();
    }
    if (
      !data ||
      data.version !== 1 ||
      !Array.isArray(data.words) ||
      !Array.isArray(data.pairs)
    ) {
      this.warn(
        "Dictionary state version/shape is unsupported; using an empty personal dictionary",
      );
      return empty();
    }
    const time = this.now();
    const validCount = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e9;
    const validTime = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= time;
    const wordOK = (w: unknown): w is string =>
      typeof w === "string" && validWord(w) && normalizeWord(w) === w;
    const words = (data.words as WordStats[]).filter(
      (w) =>
        w &&
        wordOK(w.word) &&
        validCount(w.promptCount) &&
        validTime(w.updatedAt),
    );
    const pairs = (data.pairs as PrefixStats[]).filter(
      (p) =>
        p &&
        wordOK(p.word) &&
        typeof p.prefix === "string" &&
        p.prefix.length >= 2 &&
        normalizeWord(p.prefix) === p.prefix &&
        p.word.startsWith(p.prefix) &&
        p.word !== p.prefix &&
        validCount(p.acceptCount) &&
        validTime(p.updatedAt),
    );
    const bounded = new DictionaryIndex([]);
    bounded.replace({ words, pairs });
    return bounded.snapshot(time);
  }

  persist(): Promise<void> {
    if (this.closed) return this.closing ?? Promise.resolve();
    return this.enqueue(false);
  }
  clear(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return this.enqueue(true);
  }
  private enqueue(clear: boolean): Promise<void> {
    const next = this.writing.catch(() => {}).then(() => this.commit(clear));
    this.writing = next;
    return next;
  }
  private async commit(clear: boolean): Promise<void> {
    await this.load();
    if (!clear && !this.pending.length) return;
    await mkdir(dirname(this.path), { recursive: true });
    const lock = this.path + ".lock",
      deadline = Date.now() + (this.options.lockTimeoutMs ?? 2000);
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (Date.now() >= deadline)
          throw new Error(
            "Dictionary lock timeout; pending changes remain unsaved",
          );
        await delay(10);
      }
    }
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const merged = new DictionaryIndex([]);
      if (!clear) merged.replace(await this.readState());
      const count = this.pending.length;
      if (!clear)
        for (const delta of this.pending.slice(0, count))
          this.apply(merged, delta);
      await writeFile(
        temp,
        JSON.stringify({ version: 1, ...merged.snapshot(this.now()) }) + "\n",
        "utf8",
      );
      await rename(temp, this.path);
      this.pending.splice(0, count);
      this.index.replace(merged.snapshot(this.now()));
      for (const delta of this.pending) this.apply(this.index, delta);
    } finally {
      await rm(temp, { force: true });
      await rmdir(lock);
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closing = this.enqueue(false).catch((e) =>
      this.warn(`Dictionary close has unsaved changes: ${String(e)}`),
    );
    return this.closing;
  }
}
