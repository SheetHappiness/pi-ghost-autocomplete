import type {
  Predictor,
  Snapshot,
  Query,
  CompletionController,
} from "./types.ts";

const key = (snapshot: Snapshot): string =>
  `${snapshot.text.length}:${snapshot.text}${snapshot.line}:${snapshot.col}:${snapshot.session.length}:${snapshot.session}`;
type Request = {
  snapshot: Snapshot;
  key: string;
  query: Query;
  generation: number;
};

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
    if (!query) {
      this.current = undefined;
      this.queued = undefined;
      return;
    }
    const snapshotKey = key(snapshot);
    this.current = {
      snapshot: { ...snapshot },
      key: snapshotKey,
      query,
      generation: this.generation,
    };
    if (snapshotKey === this.dismissed || this.cache.has(snapshotKey)) {
      this.queued = undefined;
      return;
    }
    if (this.active) {
      this.queued = this.inflightKey !== snapshotKey ? this.current : undefined;
    } else this.run(this.current);
  }

  private inflightKey: string | undefined;

  private run(request: Request): void {
    this.active = true;
    this.inflightKey = request.key;
    void this.predictor
      .complete(request.query.before, request.query.prefix)
      .then((result) => {
        if (
          this.disposed ||
          request.generation !== this.generation ||
          request.key === this.dismissed
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
        this.cache.set(request.key, suffix);
        if (this.cache.size > 256)
          this.cache.delete(this.cache.keys().next().value!);
        if (this.current?.key === request.key) this.onUpdate();
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
          queued.key !== this.dismissed &&
          this.current?.key === queued.key
        )
          this.run(queued);
      });
  }

  visible(snapshot: Snapshot): string | null {
    if (this.disposed || this.failed || !this.current) return null;
    const snapshotKey = key(snapshot);
    if (this.current.key !== snapshotKey || snapshotKey === this.dismissed)
      return null;
    const query = this.current.query;
    const projected =
      this.shown?.request.query.before === query.before &&
      this.shown.word.startsWith(query.prefix)
        ? this.shown.word.slice(query.prefix.length)
        : null;
    const suffix = this.cache.get(snapshotKey) ?? projected;
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
