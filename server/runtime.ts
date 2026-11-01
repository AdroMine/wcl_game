// The single writer. Owns the GameState, applies every command through the engine reducer (measuring
// the time it takes), tracks metrics and tells subscribers (SSE hub, persistence) when state changed.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { reduce } from './engine/index.ts';
import type { Command, ErrorCode, GameEvent, GameState } from './engine/index.ts';

export interface ApplyResult {
  /** True when the command was accepted or was a duplicate/no-op (i.e. not rejected). */
  ok: boolean;
  error?: ErrorCode;
  /** True when the state version moved (a real change). */
  changed: boolean;
  version: number;
  events: GameEvent[];
}

export interface ChangeInfo {
  state: GameState;
  prev: GameState;
  events: GameEvent[];
  phaseChanged: boolean;
}

export type RuntimeListener = (info: ChangeInfo) => void;

const APPLY_RING = 4096;

export class Runtime {
  state: GameState;
  /** Random id of this server process; clients use it to notice restarts. */
  readonly sid: string;
  readonly startedAt: number;
  private readonly clock: () => number;
  private listeners: RuntimeListener[] = [];

  // metrics
  private applyMs = new Float64Array(APPLY_RING);
  private applyCount = 0;
  private maxApplyMs = 0;
  commandsTotal = 0;
  commandsChanged = 0;
  readonly errorCounts: Record<string, number> = {};
  private secondBuckets = new Map<number, number>();
  private loopHist = monitorEventLoopDelay({ resolution: 10 });
  private recentLoopP99: number[] = [];
  private loopTimer: NodeJS.Timeout | null = null;

  constructor(state: GameState, opts: { clock?: () => number; sid?: string } = {}) {
    this.state = state;
    this.clock = opts.clock ?? Date.now;
    this.sid = opts.sid ?? randomBytes(6).toString('base64url');
    this.startedAt = this.clock();
  }

  startMonitoring(): void {
    this.loopHist.enable();
    this.loopTimer = setInterval(() => {
      this.recentLoopP99.push(this.loopHist.percentile(99) / 1e6);
      if (this.recentLoopP99.length > 12) this.recentLoopP99.shift();
      this.loopHist.reset();
    }, 5000);
    this.loopTimer.unref();
  }

  stopMonitoring(): void {
    this.loopHist.disable();
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  subscribe(fn: RuntimeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  now(): number {
    return this.clock();
  }

  /** Apply one engine command. Never throws: an unexpected engine exception is reported as INVALID_PAYLOAD. */
  apply(command: Command, now: number = this.clock()): ApplyResult {
    const prev = this.state;
    const t0 = performance.now();
    let res: ReturnType<typeof reduce>;
    try {
      res = reduce(prev, command, { now });
    } catch (e) {
      console.error('engine exception while applying', command.type, e instanceof Error ? e.message : 'unknown');
      this.errorCounts.ENGINE_EXCEPTION = (this.errorCounts.ENGINE_EXCEPTION ?? 0) + 1;
      return { ok: false, error: 'INVALID_PAYLOAD', changed: false, version: prev.version, events: [] };
    }
    const dt = performance.now() - t0;
    this.applyMs[this.applyCount % APPLY_RING] = dt;
    this.applyCount++;
    if (dt > this.maxApplyMs) this.maxApplyMs = dt;
    this.commandsTotal++;
    const sec = Math.floor(now / 1000);
    this.secondBuckets.set(sec, (this.secondBuckets.get(sec) ?? 0) + 1);
    if (this.secondBuckets.size > 30) {
      for (const k of this.secondBuckets.keys()) if (k < sec - 20) this.secondBuckets.delete(k);
    }
    this.state = res.state;
    const changed = res.state.version !== prev.version;
    if (res.error) this.errorCounts[res.error] = (this.errorCounts[res.error] ?? 0) + 1;
    if (changed) {
      this.commandsChanged++;
      const info: ChangeInfo = { state: res.state, prev, events: res.events, phaseChanged: res.state.phaseSeq !== prev.phaseSeq };
      for (const l of this.listeners) {
        try {
          l(info);
        } catch (e) {
          console.error('runtime listener failed', e instanceof Error ? e.message : 'unknown');
        }
      }
    }
    return { ok: !res.error, error: res.error, changed, version: res.state.version, events: res.events };
  }

  /** Replace the whole state (restore). The caller has validated it. */
  replaceState(next: GameState): void {
    const prev = this.state;
    this.state = next;
    const info: ChangeInfo = { state: next, prev, events: [], phaseChanged: true };
    for (const l of this.listeners) {
      try {
        l(info);
      } catch (e) {
        console.error('runtime listener failed', e instanceof Error ? e.message : 'unknown');
      }
    }
  }

  // ---- metrics ---------------------------------------------------------------

  private sortedApply(): number[] {
    const n = Math.min(this.applyCount, APPLY_RING);
    return Array.from(this.applyMs.subarray(0, n)).sort((a, b) => a - b);
  }

  p99ApplyMs(): number {
    const a = this.sortedApply();
    if (a.length === 0) return 0;
    return a[Math.min(a.length - 1, Math.floor(a.length * 0.99))];
  }

  p50ApplyMs(): number {
    const a = this.sortedApply();
    return a.length === 0 ? 0 : a[Math.floor(a.length * 0.5)];
  }

  getMaxApplyMs(): number {
    return this.maxApplyMs;
  }

  /** Commands per second averaged over the last 5 completed seconds. */
  commandsPerSec(): number {
    const sec = Math.floor(this.clock() / 1000);
    let n = 0;
    for (let s = sec - 5; s < sec; s++) n += this.secondBuckets.get(s) ?? 0;
    return Math.round((n / 5) * 10) / 10;
  }

  eventLoopLagMs(): number {
    const cur = this.loopHist.count > 0 ? this.loopHist.percentile(99) / 1e6 : 0;
    // The histogram's floor is its sampling resolution (10 ms), so report the excess over it.
    return Math.round(Math.max(0, Math.max(cur, ...this.recentLoopP99) - 10) * 100) / 100;
  }

  resetMetrics(): void {
    this.applyCount = 0;
    this.maxApplyMs = 0;
    this.recentLoopP99 = [];
    this.loopHist.reset();
    this.secondBuckets.clear();
  }
}
