// Jitter helpers. Every retry in the web app goes through these, so 200 phones never retry in lockstep.

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Delay before reconnect attempt number `failures` (0 = first retry).
 * First retry: 1 to 5 s. Then the delay doubles (cap 30 s) with full jitter between 50% and 100%.
 */
export function reconnectDelayMs(failures: number): number {
  if (failures <= 0) return rand(1000, 5000);
  const base = Math.min(30000, 2000 * 2 ** failures);
  return rand(base * 0.5, base);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
