// Token buckets. One map per limiter; idle full buckets are evicted so the map cannot grow forever.
export interface BucketOptions {
  /** Tokens added per second. */
  ratePerSec: number;
  /** Maximum stored tokens (burst size). */
  burst: number;
  /** Hard cap on tracked keys. */
  maxKeys?: number;
}

export class RateLimiter {
  private readonly rate: number;
  private readonly burst: number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = 0;

  constructor(opts: BucketOptions) {
    this.rate = opts.ratePerSec;
    this.burst = opts.burst;
    this.maxKeys = opts.maxKeys ?? 20000;
  }

  /** Try to take `cost` tokens. Returns true when allowed. */
  take(key: string, now: number, cost = 1): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now, true);
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    } else {
      const elapsed = Math.max(0, now - b.at) / 1000;
      b.tokens = Math.min(this.burst, b.tokens + elapsed * this.rate);
      b.at = now;
    }
    if (now - this.lastSweep > 60_000) this.sweep(now, false);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return true;
    }
    return false;
  }

  /** True when at least one token is available (does not consume). */
  has(key: string, now: number): boolean {
    const b = this.buckets.get(key);
    if (!b) return true;
    return b.tokens + (Math.max(0, now - b.at) / 1000) * this.rate >= 1;
  }

  /** Seconds until `cost` tokens are available (for Retry-After). */
  retryAfterSec(key: string, cost = 1): number {
    const b = this.buckets.get(key);
    if (!b || this.rate <= 0) return 1;
    return Math.max(1, Math.ceil((cost - b.tokens) / this.rate));
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number, force: boolean): void {
    this.lastSweep = now;
    for (const [k, b] of this.buckets) {
      const full = b.tokens + (Math.max(0, now - b.at) / 1000) * this.rate >= this.burst;
      if (full) this.buckets.delete(k);
    }
    if (force && this.buckets.size >= this.maxKeys) {
      // Still full of active keys (an attack): drop the oldest quarter.
      let n = Math.floor(this.maxKeys / 4);
      for (const k of this.buckets.keys()) {
        if (n-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }
}

export interface RateLimitConfig {
  playerCommands: BucketOptions;
  playerViews: BucketOptions;
  ip: BucketOptions;
  adminFailures: BucketOptions;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  // 10 commands per second per player, burst 20.
  playerCommands: { ratePerSec: 10, burst: 20 },
  // Polling fallback: about 2 views per second per player, burst 10.
  playerViews: { ratePerSec: 2, burst: 10 },
  // A whole pub may share one IP: allow far more than 300 requests per second.
  ip: { ratePerSec: 600, burst: 1500 },
  // Failed admin logins per IP.
  adminFailures: { ratePerSec: 0.2, burst: 10 },
};
