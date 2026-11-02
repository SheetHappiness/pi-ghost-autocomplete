export const DEFAULT_DICTIONARY_POLICY = {
  minPrefix: 3,
  minScore: 1,
  minShare: 0.85,
  minMargin: 4,
  minCommonFrequency: 1e-6,
  maxWords: 20_000,
  maxPairs: 20_000,
};

export function decay(count: number, updatedAt: number, now: number): number {
  if (!count || now <= updatedAt) return count;
  return count * 2 ** (-Math.max(0, now - updatedAt) / (30 * 86_400_000));
}

export function lexical(a: string, b: string): number {
  const left = [...a],
    right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const d = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (d) return d;
  }
  return left.length - right.length;
}
