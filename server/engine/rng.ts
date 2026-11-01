// Seeded PRNG (mulberry32). The generator state lives in GameState.rng, so every
// random choice is reproducible and survives snapshot/restore.
import type { GameState } from './types.ts';

export function seedToState(seed: number): number {
  return (seed >>> 0) || 0x9e3779b9;
}

/** Next float in [0,1). Mutates d.rng. */
export function rngNext(d: Pick<GameState, 'rng'>): number {
  d.rng = (d.rng + 0x6d2b79f5) >>> 0;
  let t = d.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function rngInt(d: Pick<GameState, 'rng'>, n: number): number {
  return Math.floor(rngNext(d) * n);
}

export function rngPick<T>(d: Pick<GameState, 'rng'>, items: readonly T[]): T {
  return items[rngInt(d, items.length)];
}

/** Fisher-Yates; returns a new array. */
export function rngShuffle<T>(d: Pick<GameState, 'rng'>, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(d, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
