export interface Summary {
  n: number;
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function summarize(values: number[]): Summary {
  const a = values.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
  if (a.length === 0) return { n: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 };
  return { n: a.length, min: a[0], p50: percentile(a, 50), p90: percentile(a, 90), p99: percentile(a, 99), max: a[a.length - 1], mean: a.reduce((s, v) => s + v, 0) / a.length };
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
export const mb = (bytes: number) => bytes / 1048576;

/** Least-squares slope of y over x (units of y per unit of x). */
export function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
