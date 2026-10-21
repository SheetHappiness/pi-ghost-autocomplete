import type {
  Predictor,
  Snapshot,
  Query,
  CompletionController,
} from "./types.ts";
const key = (snapshot: Snapshot) => JSON.stringify(snapshot);
type Request = { snapshot: Snapshot; query: Query; generation: number };
export class GhostController implements CompletionController {
  private predictor: Predictor;
  private onUpdate: () => void;
  private onError: (error: unknown) => void;
  private current: Request | undefined;
  private active = false;
  private queued: Request | undefined;
  private generation = 0;
  private disposed = false;
  private failed = false;
  private dismissed: string | undefined;
  private cache = new Map<string, string | null>();
  private shown: { request: Request; word: string; suffix: string } | undefined;
  constructor(
    predictor: Predictor,
    onUpdate: () => void,
    onError = (_error: unknown) => {},
  ) {
    this.predictor = predictor;
    this.onUpdate = onUpdate;
    this.onError = onError;
  }
  update(snapshot: Snapshot, query: Query | undefined): void {
    if (this.disposed || this.failed) return;
    if (this.current && this.current.snapshot.session !== snapshot.session)
      this.reset();
    if (
      this.shown &&
      (this.shown.request.query.before !== query?.before ||
        !this.shown.word.startsWith(query?.prefix ?? "\0"))
    )
      this.report(false);
    this.current = query
      ? { snapshot: { ...snapshot }, query, generation: this.generation }
      : undefined;
    if (!this.current) {
      this.queued = undefined;
      return;
    }
    const k = key(snapshot);
    if (k === this.dismissed || this.cache.has(k)) {
      this.queued = undefined;
      return;
    }
    if (this.active) {
      this.queued = this.inflightKey !== k ? this.current : undefined;
    } else this.run(this.current);
  }
  private inflightKey: string | undefined;
  private run(request: Request): void {
    this.active = true;
    this.inflightKey = key(request.snapshot);
    void this.predictor
      .complete(request.query.before, request.query.prefix)
      .then((result) => {
        if (
          this.disposed ||
          request.generation !== this.generation ||
          key(request.snapshot) === this.dismissed
        )
          return;
        const suffix =
          result &&
          Number.isFinite(result.confidence) &&
          result.confidence >= 0.15 &&
          result.suffix.length <= 128 &&
          /^[\p{L}\p{M}']+$/u.test(result.suffix)
            ? result.suffix
            : null;
        this.cache.set(key(request.snapshot), suffix);
        if (this.cache.size > 256)
          this.cache.delete(this.cache.keys().next().value!);
        if (
          this.current &&
          key(this.current.snapshot) === key(request.snapshot)
        )
          this.onUpdate();
      })
      .catch((error) => this.failure(error, request.generation))
      .finally(() => {
        this.active = false;
        this.inflightKey = undefined;
        const queued = this.queued;
        this.queued = undefined;
        if (
          !this.disposed &&
          !this.failed &&
          queued &&
          queued.generation === this.generation &&
          key(queued.snapshot) !== this.dismissed &&
          this.current &&
          key(queued.snapshot) === key(this.current.snapshot)
        )
          this.run(queued);
      });
  }
  visible(snapshot: Snapshot): string | null {
    if (
      this.disposed ||
      this.failed ||
      !this.current ||
      key(this.current.snapshot) !== key(snapshot) ||
      key(snapshot) === this.dismissed
    )
      return null;
    const query = this.current.query;
    const projected =
      this.shown?.request.query.before === query.before &&
      this.shown.word.startsWith(query.prefix)
        ? this.shown.word.slice(query.prefix.length)
        : null;
    const suffix = this.cache.get(key(snapshot)) ?? projected;
    if (suffix)
      this.shown = {
        request: this.current,
        word: query.prefix + suffix,
        suffix,
      };
    return suffix || null;
  }
  private report(accepted: boolean): void {
    const shown = this.shown;
    this.shown = undefined;
    const generation = this.generation;
    if (shown)
      void this.predictor
        .feedback(
          shown.request.query.before,
          shown.request.query.prefix,
          shown.suffix,
          accepted,
        )
        .catch((error) => this.failure(error, generation));
    this.cache.clear();
  }
  private failure(error: unknown, generation: number): void {
    if (this.disposed || this.failed || generation !== this.generation) return;
    this.failed = true;
    this.queued = undefined;
    this.cache.clear();
    this.shown = undefined;
    this.onError(error);
  }
  dismiss(snapshot: Snapshot): void {
    this.dismissed = key(snapshot);
    this.report(false);
    this.generation++;
    this.queued = undefined;
  }
  accepted(snapshot: Snapshot): void {
    this.report(true);
    this.dismissed = key(snapshot);
    this.generation++;
    this.queued = undefined;
  }
  reset(): void {
    this.generation++;
    this.cache.clear();
    this.current = undefined;
    this.queued = undefined;
    this.shown = undefined;
    this.dismissed = undefined;
  }
  dispose(): void {
    this.reset();
    this.disposed = true;
  }
}
