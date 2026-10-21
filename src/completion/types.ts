export interface Query {
  before: string;
  prefix: string;
}
export interface Snapshot {
  text: string;
  line: number;
  col: number;
  session: string;
}
export interface Suggestion {
  suffix: string;
  confidence: number;
}
export interface Predictor {
  ready(): Promise<void>;
  complete(before: string, prefix: string): Promise<Suggestion | null>;
  observe(prompts: string[]): Promise<void>;
  feedback(
    before: string,
    prefix: string,
    suffix: string,
    accepted: boolean,
  ): Promise<void>;
  persist(): Promise<void>;
  close(): Promise<void>;
}
export interface CompletionController {
  update(snapshot: Snapshot, query: Query | undefined): void;
  visible(snapshot: Snapshot): string | null;
  dismiss(snapshot: Snapshot): void;
  accepted(snapshot: Snapshot): void;
}
