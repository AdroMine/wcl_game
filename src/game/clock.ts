// Server clock offset estimation and countdown formatting. The client never decides when a phase ends.

/** Keeps the best (least delayed) recent samples of serverNow - Date.now() and smooths them. */
export class ClockOffset {
  private samples: number[] = [];
  private value: number;

  constructor(initial = 0) {
    this.value = initial;
  }

  /** `serverNow` was the server clock when the message was sent; it reached us just now. */
  add(serverNow: number): number {
    const sample = serverNow - Date.now();
    this.samples.push(sample);
    if (this.samples.length > 8) this.samples.shift();
    // Network delay only ever makes a sample smaller, so the largest recent sample is the best estimate.
    const best = Math.max(...this.samples);
    if (this.samples.length === 1) this.value = best;
    else this.value += (best - this.value) * 0.3;
    return this.value;
  }

  get(): number {
    return this.value;
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
